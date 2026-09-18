/**
 * Reltio Workflow Adapter client — read-only inspection API.
 *
 * All three functions are pure GET operations (no mutations). They use the
 * existing `toHttpsBase()` allowlist check and `fetchWithTimeout()` from
 * `reltioClient.ts` so the security choke point (token attached only after
 * host validation) is identical to every other Reltio API call in this
 * extension.
 *
 * API shape:
 *   Base:  toHttpsBase(adapterUrl)
 *   Prefix: /workflow-adapter/workflow/{tenantId}/
 *   Headers required on every call:
 *     Authorization: Bearer <token>
 *     EnvironmentURL: <platform environment URL>   ← header, NOT a query param
 *
 * The `xxx-client` header used by `reltioHeaders()` in reltioClient.ts is a
 * Reltio platform routing signal; it has no meaning on the Workflow Adapter
 * service, so it is intentionally omitted here.
 */
import * as crypto from 'crypto';
import { toHttpsBase, fetchWithTimeout, ReltioApiError, UntrustedHostError } from './reltioClient';

const WORKFLOW_TIMEOUT_MS = 15_000;

/**
 * Deploy uploads a file and the engine parses it before responding, so it gets a
 * longer budget than the read endpoints.
 */
const WORKFLOW_DEPLOY_TIMEOUT_MS = 30_000;

/**
 * The multipart field name the deployments endpoint expects.
 *
 * Confirmed against the Workflow Adapter's own OpenAPI spec (`POST /deployments`,
 * `requestBody.content.multipart/form-data.schema.required: ["file"]`) rather
 * than a live call. Held in one place regardless, since a spec and a running
 * Adapter can still drift.
 */
const DEPLOY_PART_FIELD = 'file';

/**
 * Cap on how much of an Adapter error body is echoed back to the user.
 *
 * Adapter error text reaches a `showErrorMessage` notification more or less
 * verbatim, and reflecting an unbounded server response into the UI is exactly
 * what finding 81120 (CWE-209, "Verbose Server Error Bodies Reflected Into
 * User-Facing Messages") was raised against in `reltioClient.ts`, where it is
 * capped by `MAX_ERROR_BODY_CHARS`. This is the same control for this client,
 * set lower because a toast is not a log viewer.
 */
const MAX_ERROR_DETAIL_CHARS = 500;

// ─── Public types ────────────────────────────────────────────────────────────

/** One entry from `GET .../jarDeployments` → `data[]`. */
export interface JarDeployment {
	/** S3 path where the JAR lives, e.g. `reltio.workflow-custom-jars/Acme/my-1.0.0.jar`. */
	module: string;
	/** Human-readable name given at registration time. */
	name: string;
	/** Human-readable description given at registration time. */
	description: string;
	createdBy: string;
	createTime: number;
}

/** One entry from `GET .../processDefinitions` → `data[]`. */
export interface ProcessDefinition {
	/** Composite key, e.g. `dataChangeRequestReview:3:70513367`. */
	id: string;
	/**
	 * The identifier used in the fetch-single endpoint and as a display key.
	 * E.g. `dataChangeRequestReview`.
	 */
	type: string;
	/** Human-friendly name from the BPMN `<process name="...">`. */
	displayName: string;
	deploymentId: string;
	/** Epoch-millisecond deploy timestamp. */
	deployTime: number;
	deployedBy: string;
	/**
	 * `true` = Reltio's out-of-the-box workflow, not customised.
	 * `false` = custom BPMN deployed by someone on this tenant.
	 */
	generic: boolean;
	fileName: string;
	manualStart: boolean;
}

// ─── Error types ─────────────────────────────────────────────────────────────

/**
 * Thrown when `fetchWithTimeout` itself fails (network error, DNS failure,
 * timeout, TLS error, etc.) as opposed to a well-formed HTTP error response.
 * The UI uses this class — not message-string matching — to decide whether
 * to offer an "Edit Adapter URL" recovery action.
 */
export class WorkflowConnectionError extends Error {
	constructor(cause: Error) {
		super(`Could not reach the Workflow Adapter: ${cause.message}`);
		this.name = 'WorkflowConnectionError';
		// Preserve original stack in Node / V8
		if (cause.stack) {
			this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
		}
	}
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Build the headers required by every Workflow Adapter call.
 * Never call this before `toHttpsBase()` has validated the adapter URL.
 */
function workflowHeaders(token: string, environmentUrl: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		// Passed as a header per the Workflow Adapter contract. Missing this header
		// returns: { "error": "Missing mandatory Parameter(s): [EnvironmentURL]" }
		EnvironmentURL: environmentUrl,
	};
}

/**
 * Map a non-`ok` Adapter response onto `ReltioApiError`, reading the body
 * best-effort and truncating it to `MAX_ERROR_DETAIL_CHARS`.
 *
 * Shared by every endpoint so the truncation cannot be forgotten at one call
 * site — which is how an unbounded body would reach the UI.
 */
async function adapterHttpError(response: Response): Promise<ReltioApiError> {
	let detail = '';
	try {
		detail = (await response.text()).trim();
	} catch {
		// best-effort: if reading the body fails just use the status line
	}
	if (detail.length > MAX_ERROR_DETAIL_CHARS) {
		detail = `${detail.slice(0, MAX_ERROR_DETAIL_CHARS)}…`;
	}
	return new ReltioApiError(
		`Workflow Adapter returned ${response.status}${detail ? `: ${detail}` : ''}.`,
		response.status,
	);
}

/**
 * The service prefix, without a tenant segment. Deploy lives directly under it
 * and identifies its tenant by query parameter instead of by path.
 */
function workflowServiceBase(adapterBase: string): string {
	return `${adapterBase}/workflow-adapter/workflow`;
}

/**
 * Build the URL prefix shared by the three read endpoints.
 * `tenantId` is URI-encoded so tenant IDs with special characters survive.
 */
function workflowBase(adapterBase: string, tenantId: string): string {
	return `${workflowServiceBase(adapterBase)}/${encodeURIComponent(tenantId)}`;
}

/**
 * Type guard for one `processDefinitions` row. Only `type` is required: it is
 * the value that goes into the fetch-single URL and the tree node id, so a row
 * without it cannot be acted on. The rest are rendered with fallbacks.
 */
function isProcessDefinition(v: unknown): v is ProcessDefinition {
	return (
		typeof v === 'object' &&
		v !== null &&
		typeof (v as Record<string, unknown>).type === 'string' &&
		((v as Record<string, unknown>).type as string).length > 0
	);
}

/**
 * Type guard for one `jarDeployments` row. `module` is the registration
 * identity and the tree node id, so a row without it cannot be acted on.
 */
function isJarDeployment(v: unknown): v is JarDeployment {
	return (
		typeof v === 'object' &&
		v !== null &&
		typeof (v as Record<string, unknown>).module === 'string' &&
		((v as Record<string, unknown>).module as string).length > 0
	);
}

/**
 * Shared fetch-and-parse logic for the two list endpoints, both of which
 * return `{ status, data: [...], total }`.
 * A missing or non-array `data` field is treated as an empty list rather than
 * an error, so a tenant with nothing deployed doesn't show a red notice.
 *
 * `isValid` is applied per row rather than the array being cast wholesale.
 * Asserting `as T[]` over server data is the pattern finding RP-195042 was
 * raised for: a malformed row would reach the tree constructors, where reading
 * a field off `null` throws and takes the whole Workflows branch down with it.
 * Rows that fail the guard are dropped, matching this client's existing habit
 * of degrading to a shorter list rather than a red error.
 */
async function fetchList<T>(
	url: string,
	token: string,
	environmentUrl: string,
	isValid: (v: unknown) => v is T,
): Promise<T[]> {
	let response: Response;
	try {
		response = await fetchWithTimeout(
			url,
			{ method: 'GET', headers: workflowHeaders(token, environmentUrl) },
			WORKFLOW_TIMEOUT_MS,
		);
	} catch (e) {
		throw new WorkflowConnectionError(e as Error);
	}

	if (!response.ok) {
		throw await adapterHttpError(response);
	}

	let body: unknown;
	try {
		body = await response.json() as unknown;
	} catch {
		// A non-JSON response for a list endpoint is unexpected; treat as empty.
		return [];
	}

	if (
		body !== null &&
		typeof body === 'object' &&
		'data' in body &&
		Array.isArray((body as Record<string, unknown>).data)
	) {
		return ((body as Record<string, unknown>).data as unknown[]).filter(isValid);
	}
	return [];
}

// ─── Multipart upload ────────────────────────────────────────────────────────

/**
 * One file part of a `multipart/form-data` body. Only a single part is ever
 * needed here, so this is deliberately not a general multipart implementation.
 */
export interface MultipartFilePart {
	readonly field: string;
	readonly fileName: string;
	readonly contentType: string;
	readonly content: string;
}

/** The `Content-Type` header value that pairs with `buildMultipartBody`. */
export function multipartContentType(boundary: string): string {
	return `multipart/form-data; boundary=${boundary}`;
}

/**
 * Pick a boundary that cannot appear inside the payload.
 *
 * A boundary that collides with the content would truncate the upload at that
 * point, which the server reports only as a parse failure. Uses a CSPRNG rather
 * than `Math.random()` — not because a boundary must be unguessable, but because
 * this codebase already had a finding raised for the latter and there is no
 * reason to reintroduce the pattern.
 */
export function generateBoundary(payload: string): string {
	for (let attempt = 0; attempt < 8; attempt += 1) {
		const candidate = `----ReltioIDE${crypto.randomBytes(16).toString('hex')}`;
		if (!payload.includes(candidate)) return candidate;
	}
	/* istanbul ignore next — 8 consecutive 128-bit collisions is not a real branch */
	throw new Error('Could not generate a multipart boundary absent from the payload.');
}

/**
 * Build the request body byte by byte.
 *
 * Hand-built rather than `FormData` for two reasons. `FormData` generates its
 * boundary internally at random, so a test cannot assert the bytes that actually
 * go on the wire; here the boundary is a parameter, which makes the whole
 * payload pinnable. And `tsconfig.json` sets `lib: ["ES2022"]` with no `"DOM"`,
 * so `FormData`/`Blob` type availability is not something to depend on.
 *
 * Lengths are UTF-8 byte lengths, never string lengths. A BPMN carrying an
 * accented process name is the specific case where those differ, and getting it
 * wrong malforms the request in a way the server reports unhelpfully.
 */
export function buildMultipartBody(part: MultipartFilePart, boundary: string): Uint8Array {
	// A quote or newline in either value would break out of the header and let a
	// caller inject arbitrary multipart headers. Process ids are already validated
	// upstream, so this is depth rather than the primary control.
	for (const [label, value] of [['field', part.field], ['fileName', part.fileName]] as const) {
		if (/["\r\n]/.test(value)) {
			throw new Error(`Multipart ${label} must not contain quotes or line breaks.`);
		}
	}

	const header =
		`--${boundary}\r\n` +
		`Content-Disposition: form-data; name="${part.field}"; filename="${part.fileName}"\r\n` +
		`Content-Type: ${part.contentType}\r\n` +
		'\r\n';
	const footer = `\r\n--${boundary}--\r\n`;

	return Buffer.concat([
		Buffer.from(header, 'utf-8'),
		Buffer.from(part.content, 'utf-8'),
		Buffer.from(footer, 'utf-8'),
	]);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns every custom JAR registered on the tenant, or an empty array when
 * none are registered.
 *
 * @param adapterUrl    User-supplied Workflow Adapter base URL. Validated and
 *                      scheme-enforced via `toHttpsBase()` before use.
 * @param tenantId      Reltio tenant ID, e.g. `AcmeTenant`.
 * @param environmentUrl Platform environment URL, e.g. `https://demo-01.reltio.com`.
 *                      Passed as the `EnvironmentURL` header — not a query param.
 * @param token         Bearer token from `TokenStore`. Never logged or persisted.
 * @throws {UntrustedHostError}     Adapter URL host is outside the allowlist.
 * @throws {WorkflowConnectionError} Network-level failure (DNS, timeout, TLS).
 * @throws {ReltioApiError}         HTTP 4xx/5xx from the Adapter.
 */
export async function listJarDeployments(
	adapterUrl: string,
	tenantId: string,
	environmentUrl: string,
	token: string,
): Promise<JarDeployment[]> {
	const base = toHttpsBase(adapterUrl);
	const url = `${workflowBase(base, tenantId)}/jarDeployments`;
	return fetchList<JarDeployment>(url, token, environmentUrl, isJarDeployment);
}

/**
 * Returns every process definition (BPMN workflow) deployed on the tenant.
 *
 * @param adapterUrl    User-supplied Workflow Adapter base URL.
 * @param tenantId      Reltio tenant ID.
 * @param environmentUrl Platform environment URL (`EnvironmentURL` header).
 * @param token         Bearer token.
 * @throws {UntrustedHostError}     Adapter URL host is outside the allowlist.
 * @throws {WorkflowConnectionError} Network-level failure.
 * @throws {ReltioApiError}         HTTP 4xx/5xx from the Adapter.
 */
export async function listProcessDefinitions(
	adapterUrl: string,
	tenantId: string,
	environmentUrl: string,
	token: string,
): Promise<ProcessDefinition[]> {
	const base = toHttpsBase(adapterUrl);
	const url = `${workflowBase(base, tenantId)}/processDefinitions`;
	return fetchList<ProcessDefinition>(url, token, environmentUrl, isProcessDefinition);
}

/**
 * Guess the Workflow Adapter host from the environment's own host, so the
 * customer is not asked to find and type it in by hand.
 *
 * The guess is `{first-label}-workflow.{rest}` — e.g. `tst-01.reltio.com` →
 * `tst-01-workflow.reltio.com`, the exact shape this codebase's own test
 * fixtures have used as an example (`demo-01-workflow.reltio.com`) since
 * before this function existed. Confirmed live, across two rounds of testing
 * against 28 real environments with genuine, authorized tokens: real and
 * answering on 15 of them (including `tst-01`, `na03-prod/test/dev/sales`,
 * `gca-prod/test`, `guk-prod/test`, `mpe-01/02`, `test`, `test-h360` — one
 * returned actual process-definition data, the rest the Adapter's own
 * `errorCode 10061 Tenant not registered`), DNS failures on 12 more
 * (`eutst-01`, `geu-tst-01`, `idev-01/02`, `gus-sales`, `dev`, `361`, `360`,
 * `mpe-03`, `test-usg`, `cn01-test`, `gus-training`). So this is a good guess
 * for many, not most, environments — it can miss, and a miss must look
 * exactly like "nothing to guess" to the caller, not an error.
 *
 * The confirmation step reads the response body, not just the HTTP status — a
 * host can resolve and answer HTTP without a Workflow Adapter actually living
 * there. Caught live: `geu-test-workflow.reltio.com` resolves (unlike a
 * genuinely nonexistent subdomain, which fails DNS) and answers with an empty
 * 404, but is not a real Adapter — no wildcard catch-all is at play, this
 * specific host just isn't one. So a DNS/connection failure OR a body that
 * doesn't parse as this service's own JSON shape (a `data` list, its
 * `{status:"failed", error:{...}}` envelope, or a Spring Security
 * `{error, error_description}` auth rejection) both mean "not confirmed",
 * exactly alike, rather than trusting any HTTP response as proof.
 *
 * Multi-label environment hosts (e.g. `*.cloud.reltio.com`) are untested; the
 * substitution point may not be the right one for them, which is fine — the
 * same fail-closed behaviour applies.
 */
export async function guessWorkflowAdapterUrl(
	environmentName: string,
	tenantId: string,
	environmentUrl: string,
	token: string,
): Promise<string | undefined> {
	let guess: string;
	try {
		guess = toHttpsBase(environmentName.replace(/^([^.]+)/, '$1-workflow'));
	} catch {
		return undefined;
	}

	let text: string;
	try {
		const response = await fetchWithTimeout(
			`${workflowBase(guess, tenantId)}/processDefinitions`,
			{ method: 'GET', headers: workflowHeaders(token, environmentUrl) },
			WORKFLOW_TIMEOUT_MS,
		);
		text = await response.text();
	} catch {
		return undefined; // DNS failure, connection refused, timeout — no adapter here.
	}

	try {
		const parsed = JSON.parse(text) as unknown;
		if (parsed === null || typeof parsed !== 'object') return undefined;
		const obj = parsed as Record<string, unknown>;
		const looksLikeAdapter =
			Array.isArray(obj.data) ||
			(obj.status === 'failed' && typeof obj.error === 'object' && obj.error !== null) ||
			(typeof obj.error === 'string' && typeof obj.error_description === 'string');
		return looksLikeAdapter ? guess : undefined;
	} catch {
		return undefined; // Not JSON at all — a generic web response, not this service.
	}
}

/**
 * Returns the raw BPMN XML for one deployed process type.
 *
 * Real production Adapters return the XML as plain text.
 * Some local/dev Adapters wrap it in a JSON envelope; this function detects
 * that case and unwraps it automatically, so callers always receive a string.
 * The XML is never parsed in this module — no XML parser means no XXE surface.
 *
 * @param adapterUrl    User-supplied Workflow Adapter base URL.
 * @param tenantId      Reltio tenant ID.
 * @param environmentUrl Platform environment URL (`EnvironmentURL` header).
 * @param token         Bearer token.
 * @param processType   The `type` field from a `ProcessDefinition`, e.g.
 *                      `dataChangeRequestReview`.
 * @throws {UntrustedHostError}     Adapter URL host is outside the allowlist.
 * @throws {WorkflowConnectionError} Network-level failure.
 * @throws {ReltioApiError}         HTTP 4xx/5xx from the Adapter.
 */
export async function getProcessDefinitionXml(
	adapterUrl: string,
	tenantId: string,
	environmentUrl: string,
	token: string,
	processType: string,
): Promise<string> {
	const base = toHttpsBase(adapterUrl);
	const url = `${workflowBase(base, tenantId)}/processDefinitions/${encodeURIComponent(processType)}`;

	let response: Response;
	try {
		response = await fetchWithTimeout(
			url,
			{ method: 'GET', headers: workflowHeaders(token, environmentUrl) },
			WORKFLOW_TIMEOUT_MS,
		);
	} catch (e) {
		throw new WorkflowConnectionError(e as Error);
	}

	if (!response.ok) {
		throw await adapterHttpError(response);
	}

	// Try JSON parse first — some local/dev Adapters wrap the XML in an object.
	// Only a value that actually looks like a BPMN document is accepted, and only
	// from a known carrier field. Taking the first string-valued field instead
	// returns `"OK"` for the Adapter's own `{status:"OK", data:"<definitions…"}`
	// envelope, because `status` is enumerated first — and Part 2 writes whatever
	// comes back to disk as both the editable BPMN and its baseline, so a wrong
	// unwrap silently replaces the customer's workflow with that word.
	const text = await response.text();
	try {
		const parsed = JSON.parse(text) as unknown;
		if (parsed !== null && typeof parsed === 'object') {
			const obj = parsed as Record<string, unknown>;
			for (const key of ['data', 'xml', 'content', 'definition']) {
				const value = obj[key];
				if (typeof value === 'string' && looksLikeXml(value)) return value;
			}
		}
	} catch {
		// Not JSON — that's the normal production case.
	}
	return text;
}

/**
 * A cheap shape check, not a parse — no XML parser is added to this project.
 * Enough to tell a BPMN document from a status word or an error string.
 */
function looksLikeXml(value: string): boolean {
	return value.trimStart().startsWith('<');
}

/**
 * Deploy one BPMN process definition to a tenant.
 *
 * The only non-GET call this extension makes to any service. It takes the XML as
 * a **string**, never a file URI: the test harness's `vscode` stub returns empty
 * bytes from `readFile`, so keeping the file read in the command handler leaves
 * this function a pure string-to-request transform that a test can actually
 * assert on.
 *
 * Note the URL shape — `deployments` sits directly under the service prefix with
 * no tenant path segment; the tenant travels as a query parameter instead. That
 * differs from every read endpoint in this file.
 *
 * The success body's shape — `{ status, deploymentId, warning? }` — is confirmed
 * against the Workflow Adapter's own OpenAPI spec (`components.schemas.Deployment
 * response`), not a live call, so it is parsed tolerantly: any field missing or
 * wrong-typed is treated as absent rather than thrown. `warning` matters because
 * the spec defines it for "operation is successful but there were some problems",
 * which is not something a caller should be able to silently miss.
 *
 * @param adapterUrl     Workflow Adapter base URL; allowlist-checked before the token is attached.
 * @param tenantId       Reltio tenant ID.
 * @param environmentUrl Platform environment URL, sent as the `EnvironmentURL` header.
 * @param token          Bearer token from `TokenStore`.
 * @param deploymentName Deployment label, sent as the `name` query parameter.
 * @param fileName       Part filename; kept identical to the draft's on-disk name.
 * @param xml            The BPMN document itself.
 * @throws {UntrustedHostError}      Adapter URL host is outside the allowlist.
 * @throws {WorkflowConnectionError} Network-level failure.
 * @throws {ReltioApiError}          HTTP 4xx/5xx — 403 means the role is missing, 404 a wrong URL.
 */
export async function deployProcessDefinition(
	adapterUrl: string,
	tenantId: string,
	environmentUrl: string,
	token: string,
	deploymentName: string,
	fileName: string,
	xml: string,
): Promise<DeploymentResult> {
	const base = toHttpsBase(adapterUrl);
	const url =
		`${workflowServiceBase(base)}/deployments` +
		`?tenantId=${encodeURIComponent(tenantId)}` +
		`&name=${encodeURIComponent(deploymentName)}`;

	const boundary = generateBoundary(xml);
	const body = buildMultipartBody(
		{ field: DEPLOY_PART_FIELD, fileName, contentType: 'application/xml', content: xml },
		boundary,
	);

	let response: Response;
	try {
		response = await fetchWithTimeout(
			url,
			{
				method: 'POST',
				headers: {
					...workflowHeaders(token, environmentUrl),
					'Content-Type': multipartContentType(boundary),
				},
				body,
			},
			WORKFLOW_DEPLOY_TIMEOUT_MS,
		);
	} catch (e) {
		throw new WorkflowConnectionError(e as Error);
	}

	if (!response.ok) {
		throw await adapterHttpError(response);
	}
	return parseDeploymentResult(await response.text());
}

/** The Adapter's `Deployment response` schema, both fields optional by spec. */
export interface DeploymentResult {
	readonly deploymentId?: string;
	readonly warning?: string;
}

/** Tolerant parse: an unexpected body yields `{}`, never a thrown error. */
function parseDeploymentResult(text: string): DeploymentResult {
	try {
		const parsed = JSON.parse(text) as unknown;
		if (parsed === null || typeof parsed !== 'object') return {};
		const obj = parsed as Record<string, unknown>;
		return {
			deploymentId: typeof obj.deploymentId === 'string' ? obj.deploymentId : undefined,
			warning: typeof obj.warning === 'string' ? obj.warning : undefined,
		};
	} catch {
		return {};
	}
}
