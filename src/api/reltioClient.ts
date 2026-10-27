import type { ExtractedRdmConfig, RdmLookupValueRow } from '../model/types';

const DEFAULT_TIMEOUT_MS = 10_000;
/**
 * A genuine Reltio platform header, not a placeholder name: it routes a request
 * to the UI node (`true`) vs. the data-load node (`false`) in Reltio's balancer.
 * Verified empirically against a live tenant — `true` vs. omitted/`false` changes
 * which records a listing endpoint returns, not just their count. Kept on every
 * call below except `/reltio/enhancedTenants`, which `listTenants` proved does not
 * need it (see `reltioHeadersWithoutClientId`); do not rename the wire value.
 */
const RELTIO_CLIENT_HEADER = 'xxx-client';

/** Suffixes `toHttpsBase()` trusts. Extend via `setTrustedHostSuffixes()`. */
let trustedHostSuffixes: string[] = ['reltio.com'];

/**
 * Extends (replaces) the host allowlist enforced by `toHttpsBase()`. Called from
 * `extension.ts` with the `reltio.trustedHostSuffixes` setting so this module can
 * stay free of a `vscode` import and remain testable against a stubbed `fetch`.
 */
export function setTrustedHostSuffixes(suffixes: readonly string[]): void {
	const cleaned = suffixes.map(s => s.trim().toLowerCase()).filter(Boolean);
	trustedHostSuffixes = cleaned.length > 0 ? cleaned : ['reltio.com'];
}

function isTrustedHost(hostname: string): boolean {
	const lower = hostname.toLowerCase();
	return trustedHostSuffixes.some(suffix => lower === suffix || lower.endsWith(`.${suffix}`));
}

/** Thrown by `toHttpsBase()` for a host outside the allowlist, or an unparseable base URL. */
export class UntrustedHostError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UntrustedHostError';
	}
}

function reltioHeaders(token?: string, extra?: Record<string, string>): Record<string, string> {
	return { [RELTIO_CLIENT_HEADER]: 'true', ...reltioHeadersWithoutClientId(token, extra) };
}

function reltioHeadersWithoutClientId(
	token?: string,
	extra?: Record<string, string>,
): Record<string, string> {
	const headers: Record<string, string> = { ...extra };
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}
	return headers;
}

export class ReltioApiError extends Error {
	constructor(
		message: string,
		readonly statusCode: number,
		/**
		 * The `Retry-After` header's value in seconds, when the response carried one and it parsed
		 * as a plain integer — `undefined` otherwise (no header, a non-429, or the less common
		 * HTTP-date form, which no caller of this error currently needs to handle). Lets a 429
		 * handler suggest an actual wait instead of inventing one.
		 */
		readonly retryAfterSeconds?: number,
		/** Raw response body, kept where a caller needs to show the server's own explanation. */
		readonly responseBody?: string,
	) {
		super(message);
		this.name = 'ReltioApiError';
	}
}

/**
 * Resolves an environment's stored host/URL into a base URL every Reltio API
 * call below is built from. Single enforcement point: forces an explicit
 * `http://` scheme to `https://` rather than preserving it, and rejects any
 * host outside the allowlist — before the caller attaches a bearer token.
 *
 * Exported so that callers with a separate service URL (e.g. the Workflow
 * Adapter) can run the same allowlist check before attaching a bearer token,
 * without duplicating the logic.
 */
export function toHttpsBase(baseUrl: string): string {
	const trimmed = baseUrl.trim().replace(/^\/+/, '');
	const withScheme = /^http:\/\//i.test(trimmed)
		? trimmed.replace(/^http:\/\//i, 'https://')
		: /^https:\/\//i.test(trimmed)
			? trimmed
			: `https://${trimmed}`;

	let parsed: URL;
	try {
		parsed = new URL(withScheme);
	} catch {
		// The input is not echoed: it may carry credentials.
		throw new UntrustedHostError('Invalid Reltio environment URL.');
	}
	// Only the origin is ever contacted. Userinfo would ride along into every request line and a
	// path or query would silently redirect calls to somewhere the allowlist never looked at.
	if (parsed.username || parsed.password) {
		throw new UntrustedHostError('A Reltio environment URL must not contain credentials.');
	}
	if ((parsed.pathname !== '/' && parsed.pathname !== '') || parsed.search || parsed.hash) {
		throw new UntrustedHostError(
			`A Reltio environment URL must be a bare host (https://${parsed.host}), without a path or query.`,
		);
	}
	const hostname = parsed.hostname;
	if (!hostname || !isTrustedHost(hostname)) {
		throw new UntrustedHostError(
			`Refusing to contact untrusted host "${hostname}". If this is a sanctioned Reltio environment, add it to the "reltio.trustedHostSuffixes" setting.`,
		);
	}
	return parsed.origin;
}

/**
 * Exported so that callers with a separate service URL (e.g. the Workflow
 * Adapter) can reuse the same timeout/abort logic without duplicating it.
 */
export async function fetchWithTimeout(
	url: string,
	init: RequestInit,
	timeoutMs: number,
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		// `redirect: 'error'`: a bearer token must never be replayed to wherever a 3xx points.
		return await fetch(url, { redirect: 'error', ...init, signal: controller.signal });
	} catch (e) {
		if ((e as Error).name === 'AbortError') {
			throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
		}
		const cause = (e as { cause?: { message?: string } }).cause?.message;
		throw new Error(`Network error: ${(e as Error).message}${cause ? ` (${cause})` : ''}`);
	} finally {
		clearTimeout(timer);
	}
}

/** Largest response body any adapter call will buffer. Real payloads (BPMN, job lists) are far smaller. */
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/**
 * Reads a response body as text, bounded in time and size. `fetchWithTimeout`'s timer stops once
 * headers arrive, so without this a server that sends headers and then stalls (or streams forever)
 * would hang the progress notification and exhaust memory.
 */
export async function readResponseText(
	response: Response,
	timeoutMs: number,
	maxBytes: number = MAX_RESPONSE_BYTES,
): Promise<string> {
	const declared = Number(response.headers?.get('Content-Length') ?? NaN);
	if (Number.isFinite(declared) && declared > maxBytes) {
		throw new Error(`Response body is too large (${declared} bytes, limit ${maxBytes}).`);
	}

	let timer: ReturnType<typeof setTimeout> | undefined;
	let cancel: (() => void) | undefined;
	const timedOut = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			cancel?.();
			reject(new Error(`Reading the response timed out after ${timeoutMs}ms.`));
		}, timeoutMs);
	});
	const read = async (): Promise<string> => {
		const reader = response.body?.getReader?.();
		if (!reader) {
			const text = await response.text();
			if (Buffer.byteLength(text, 'utf-8') > maxBytes) {
				throw new Error(`Response body is too large (limit ${maxBytes} bytes).`);
			}
			return text;
		}
		cancel = () => { void reader.cancel().catch(() => undefined); };
		const chunks: Uint8Array[] = [];
		let total = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) {
				cancel();
				throw new Error(`Response body is too large (limit ${maxBytes} bytes).`);
			}
			chunks.push(value);
		}
		return Buffer.concat(chunks).toString('utf-8');
	};
	try {
		return await Promise.race([read(), timedOut]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/**
 * Never throws — callers (setup wizard, `reltio.addEnvironment`) rely on a plain
 * boolean to end a busy/progress state. `toHttpsBase()` runs inside the same
 * try/catch as the fetch so an untrusted or malformed host resolves to `false`,
 * the same outcome as an unreachable one, rather than an unhandled rejection.
 */
export async function validateEnvironment(baseUrl: string): Promise<boolean> {
	try {
		const root = toHttpsBase(baseUrl);
		const url = `${root}/reltio/status`;
		const res = await fetchWithTimeout(
			url,
			{ method: 'GET', headers: reltioHeaders() },
			DEFAULT_TIMEOUT_MS,
		);
		return res.status === 200;
	} catch {
		return false;
	}
}


/** One row from `GET …/reltio/enhancedTenants`. */
export interface TenantRecord {
	tenantId: string;
	tenantName: string;
	customerName: string;
}

/**
 * Tenants visible to the caller, as tenant IDs in the order Reltio returned them.
 *
 * `showAll=true` matches the list the extension has always shown; omitting it
 * returns a strict subset. The endpoint is GET-only, POST answers HTTP 500.
 * `tenantName` and `customerName` are dropped because the tenant picker shows
 * the ID alone.
 */
export async function listTenants(baseUrl: string, token: string): Promise<string[]> {
	const root = toHttpsBase(baseUrl);
	const q = new URLSearchParams({ showAll: 'true' });
	const url = `${root}/reltio/enhancedTenants?${q.toString()}`;
	const res = await fetchWithTimeout(
		url,
		{
			method: 'GET',
			headers: reltioHeadersWithoutClientId(token),
		},
		DEFAULT_TIMEOUT_MS,
	);
	if (res.status === 401) {
		throw new ReltioApiError('Unauthorized (401)', 401);
	}
	if (!res.ok) {
		throw new ReltioApiError(`List enhanced tenants failed: HTTP ${res.status}`, res.status);
	}
	const data = (await res.json()) as unknown;
	if (!Array.isArray(data)) {
		throw new ReltioApiError('List enhanced tenants: expected JSON array', res.status);
	}
	return data.map(row => {
		if (!row || typeof row !== 'object') {
			throw new ReltioApiError('List enhanced tenants: invalid row shape', res.status);
		}
		const tenantId = (row as Record<string, unknown>).tenantId;
		if (typeof tenantId !== 'string' || !tenantId) {
			throw new ReltioApiError('List enhanced tenants: row missing tenantId', res.status);
		}
		return tenantId;
	});
}

/** One row from `GET …/configuration/_history`. */
export interface ConfigurationHistoryEntry {
	updatedBy: string;
	timestamp: string;
	configuration: unknown;
}

export async function fetchConfigurationHistory(
	baseUrl: string,
	tenantId: string,
	token: string,
	offset: number,
	max: number,
): Promise<ConfigurationHistoryEntry[]> {
	const root = toHttpsBase(baseUrl);
	const q = new URLSearchParams({ offset: String(offset), max: String(max) });
	const url = `${root}/reltio/api/${encodeURIComponent(tenantId)}/configuration/_history?${q.toString()}`;
	const res = await fetchWithTimeout(
		url,
		{
			method: 'GET',
			headers: reltioHeaders(token),
		},
		DEFAULT_TIMEOUT_MS,
	);
	if (res.status === 401) {
		throw new ReltioApiError('Unauthorized (401)', 401);
	}
	if (!res.ok) {
		throw new ReltioApiError(`Fetch configuration history failed: HTTP ${res.status}`, res.status);
	}
	const data = (await res.json()) as unknown;
	if (!Array.isArray(data)) {
		throw new ReltioApiError('Configuration history: expected JSON array', res.status);
	}
	const out: ConfigurationHistoryEntry[] = [];
	for (const row of data) {
		if (!row || typeof row !== 'object') {
			throw new ReltioApiError('Configuration history: invalid row shape', res.status);
		}
		const o = row as Record<string, unknown>;
		if (typeof o.updatedBy !== 'string') {
			throw new ReltioApiError('Configuration history: row missing updatedBy', res.status);
		}
		const ts = o.timestamp;
		if (typeof ts !== 'string' && typeof ts !== 'number') {
			throw new ReltioApiError('Configuration history: row missing timestamp', res.status);
		}
		if (!('configuration' in o)) {
			throw new ReltioApiError('Configuration history: row missing configuration', res.status);
		}
		out.push({
			updatedBy: o.updatedBy,
			timestamp: String(ts),
			configuration: o.configuration,
		});
	}
	return out;
}

export async function fetchL3Configuration(
	baseUrl: string,
	tenantId: string,
	token: string,
): Promise<string> {
	const root = toHttpsBase(baseUrl);
	const url = `${root}/reltio/api/${encodeURIComponent(tenantId)}/configuration`;
	const res = await fetchWithTimeout(
		url,
		{
			method: 'GET',
			headers: reltioHeaders(token),
		},
		DEFAULT_TIMEOUT_MS,
	);
	if (res.status === 401) {
		throw new ReltioApiError('Unauthorized (401)', 401);
	}
	if (!res.ok) {
		throw new ReltioApiError(`Fetch L3 failed: HTTP ${res.status}`, res.status);
	}
	return res.text();
}

/**
 * Tenant physical configuration — `GET …/reltio/tenants/{tenantId}`.
 *
 * Used only to discover the RDM service URI and RDM tenant ids. The response
 * also carries messaging credentials, storage service accounts and internal
 * hostnames, so callers must extract `rdmConfig` and discard the rest; it is
 * never written to disk.
 */
export async function fetchTenantPhysicalConfiguration(
	baseUrl: string,
	tenantId: string,
	token: string,
): Promise<unknown> {
	const root = toHttpsBase(baseUrl);
	const url = `${root}/reltio/tenants/${encodeURIComponent(tenantId)}`;
	const res = await fetchWithTimeout(
		url,
		{
			method: 'GET',
			headers: reltioHeaders(token),
		},
		DEFAULT_TIMEOUT_MS,
	);
	if (res.status === 401) {
		throw new ReltioApiError('Unauthorized (401)', 401);
	}
	if (!res.ok) {
		throw new ReltioApiError(`Fetch tenant physical configuration failed: HTTP ${res.status}`, res.status);
	}
	return (await res.json()) as unknown;
}

/**
 * Pull the RDM service URI and RDM tenant ids out of a tenant physical
 * configuration. Pure and total: any shape is accepted and anything missing or
 * malformed yields an empty result, because a tenant with no RDM is a normal
 * outcome rather than an error.
 */
export function extractRdmConfig(physicalConfiguration: unknown): ExtractedRdmConfig {
	// Same key set on every path, so callers never have to distinguish
	// "no serviceUri" from "no rdmConfig at all".
	const empty: ExtractedRdmConfig = { serviceUri: undefined, rdmTenantIds: [] };
	if (!physicalConfiguration || typeof physicalConfiguration !== 'object') {
		return empty;
	}
	const rdmConfig = (physicalConfiguration as Record<string, unknown>).rdmConfig;
	if (!rdmConfig || typeof rdmConfig !== 'object') {
		return empty;
	}
	const block = rdmConfig as Record<string, unknown>;

	const rawServiceUri = block.serviceUri;
	const serviceUri =
		typeof rawServiceUri === 'string' && rawServiceUri.trim() ? rawServiceUri.trim() : undefined;

	const rdmTenantIds: string[] = [];
	if (Array.isArray(block.rdmTenants)) {
		for (const entry of block.rdmTenants) {
			if (!entry || typeof entry !== 'object') {
				continue;
			}
			const id = (entry as Record<string, unknown>).rdmTenantId;
			if (typeof id === 'string' && id.trim()) {
				rdmTenantIds.push(id.trim());
			}
		}
	}
	return { serviceUri, rdmTenantIds };
}

/**
 * RDM tenant configuration — `GET {serviceUri}/configuration/{rdmTenantId}`.
 *
 * `serviceUri` comes from the tenant physical configuration and may be a
 * different host from the MDM environment; it is never constructed from the
 * environment name. Returns raw text so formatting is applied once on write,
 * mirroring `fetchL3Configuration`.
 *
 * Because that host arrives from a server response rather than from user
 * configuration, it goes through `toHttpsBase()` like any other base URL and is
 * therefore subject to the trusted-host allowlist — an RDM service outside
 * `reltio.trustedHostSuffixes` raises `UntrustedHostError` rather than being
 * contacted.
 */
export async function fetchRdmConfiguration(
	serviceUri: string,
	rdmTenantId: string,
	token: string,
): Promise<string> {
	const root = toHttpsBase(serviceUri);
	const url = `${root}/configuration/${encodeURIComponent(rdmTenantId)}`;
	const res = await fetchWithTimeout(
		url,
		{
			method: 'GET',
			headers: reltioHeaders(token),
		},
		DEFAULT_TIMEOUT_MS,
	);
	if (res.status === 401) {
		throw new ReltioApiError('Unauthorized (401)', 401);
	}
	if (!res.ok) {
		throw new ReltioApiError(`Fetch RDM configuration failed: HTTP ${res.status}`, res.status);
	}
	return res.text();
}

/**
 * Push an RDM configuration — `PUT {serviceUri}/configuration/{rdmTenantId}`.
 *
 * `body` is the document text as saved rather than a re-serialization, so what
 * reaches the service is what the user is looking at.
 *
 * Failures reuse `formatPutConfigurationFailureMessage`. Whether the RDM
 * service returns the same error envelope as the MDM configuration endpoint is
 * unverified — the formatter falls back to the trimmed response body when the
 * shape does not match, so this is strictly better than a bare status code
 * rather than a bet on the shape.
 */
export async function putRdmConfiguration(
	serviceUri: string,
	rdmTenantId: string,
	body: string,
	token: string,
): Promise<void> {
	const root = toHttpsBase(serviceUri);
	const url = `${root}/configuration/${encodeURIComponent(rdmTenantId)}`;
	const res = await fetchWithTimeout(
		url,
		{
			method: 'PUT',
			headers: reltioHeaders(token, { 'Content-Type': 'application/json' }),
			body,
		},
		DEFAULT_TIMEOUT_MS,
	);
	if (res.status === 401) {
		throw new ReltioApiError('Unauthorized (401)', 401);
	}
	if (!res.ok) {
		let fullText = '';
		try {
			fullText = await res.text();
		} catch {
			/* ignore */
		}
		throw new ReltioApiError(
			formatPutConfigurationFailureMessage(res.status, fullText),
			res.status,
		);
	}
}

/**
 * Values of one RDM lookup type — `GET {serviceUri}/lookups/{rdmTenantId}/{lookupTypeName}`.
 *
 * Fetched on demand for a single lookup type, never eagerly for all of them:
 * a tenant can define dozens, and the configuration file lists only their
 * definitions. Like `fetchRdmConfiguration`, the service URI comes from a
 * server response and so passes through `toHttpsBase()`, which enforces the
 * trusted-host allowlist.
 */
export async function fetchRdmLookupValues(
	serviceUri: string,
	rdmTenantId: string,
	lookupTypeName: string,
	token: string,
): Promise<unknown> {
	const root = toHttpsBase(serviceUri);
	const url = `${root}/lookups/${encodeURIComponent(rdmTenantId)}/${encodeURIComponent(lookupTypeName)}`;
	const res = await fetchWithTimeout(
		url,
		{
			method: 'GET',
			headers: reltioHeaders(token),
		},
		DEFAULT_TIMEOUT_MS,
	);
	if (res.status === 401) {
		throw new ReltioApiError('Unauthorized (401)', 401);
	}
	if (!res.ok) {
		throw new ReltioApiError(`Fetch RDM lookup values failed: HTTP ${res.status}`, res.status);
	}
	return (await res.json()) as unknown;
}

/**
 * Flatten the nested lookup response into one row per (code, source, value).
 *
 * Pure and total — anything unexpected contributes no rows rather than
 * throwing. Two deliberate non-omissions, because both are meaningful states
 * that a reader needs to see:
 *   - a source mapped with an empty `values` array still yields a row, with an
 *     empty value, so "mapped but unpopulated" is visible;
 *   - an entry with no source mappings still yields a row, so the code itself
 *     is visible.
 * Row order follows the response, which is how Reltio itself presents them.
 */
export function flattenRdmLookupValues(response: unknown): RdmLookupValueRow[] {
	if (!Array.isArray(response)) {
		return [];
	}
	const asText = (v: unknown): string => (typeof v === 'string' ? v : '');
	const rows: RdmLookupValueRow[] = [];

	for (const entry of response) {
		if (!entry || typeof entry !== 'object') {
			continue;
		}
		const code = asText((entry as Record<string, unknown>).code);
		const mappings = (entry as Record<string, unknown>).sourceMappings;

		if (!Array.isArray(mappings) || mappings.length === 0) {
			rows.push({ code, source: '', valueAtSource: '' });
			continue;
		}
		for (const mapping of mappings) {
			if (!mapping || typeof mapping !== 'object') {
				continue;
			}
			const source = asText((mapping as Record<string, unknown>).source);
			const values = (mapping as Record<string, unknown>).values;
			if (!Array.isArray(values) || values.length === 0) {
				rows.push({ code, source, valueAtSource: '' });
				continue;
			}
			for (const value of values) {
				if (!value || typeof value !== 'object') {
					continue;
				}
				rows.push({
					code,
					source,
					valueAtSource: asText((value as Record<string, unknown>).value),
				});
			}
		}
	}
	return rows;
}

export interface EntitySearchOptions {
	filter: string;
	max: number;
	offset: number;
	activeness?: 'active' | 'inactive' | 'all';
	options?: string;
	sort?: string;
	order?: 'asc' | 'desc';
}

export async function searchEntities(
	baseUrl: string,
	tenantId: string,
	token: string,
	options: EntitySearchOptions,
): Promise<unknown[]> {
	const root = toHttpsBase(baseUrl);
	const url = `${root}/reltio/api/${encodeURIComponent(tenantId)}/entities/_search`;
	const body: Record<string, unknown> = {
		filter: options.filter,
		max: options.max,
		offset: options.offset,
		scoreEnabled: false,
		activeness: options.activeness ?? 'all',
	};
	if (options.options) body.options = options.options;
	if (options.sort) body.sort = options.sort;
	if (options.order) body.order = options.order;

	const res = await fetchWithTimeout(
		url,
		{
			method: 'POST',
			headers: reltioHeaders(token, { 'Content-Type': 'application/json' }),
			body: JSON.stringify(body),
		},
		DEFAULT_TIMEOUT_MS,
	);
	if (res.status === 401) {
		throw new ReltioApiError('Unauthorized (401)', 401);
	}
	if (!res.ok) {
		throw new ReltioApiError(`Search entities failed: HTTP ${res.status}`, res.status);
	}
	const data = (await res.json()) as unknown;
	if (!Array.isArray(data)) {
		throw new ReltioApiError('Search entities: expected JSON array', res.status);
	}
	return data;
}

export async function countEntities(
	baseUrl: string,
	tenantId: string,
	token: string,
	filter: string,
): Promise<number> {
	const root = toHttpsBase(baseUrl);
	const body = JSON.stringify({ filter, activeness: 'all' });
	const postUrl = `${root}/reltio/api/${encodeURIComponent(tenantId)}/entities/_total`;
	const getUrl = `${postUrl}?${new URLSearchParams({ filter, activeness: 'all' }).toString()}`;
	let res = await fetchWithTimeout(
		postUrl,
		{
			method: 'POST',
			headers: reltioHeaders(token, { 'Content-Type': 'application/json' }),
			body,
		},
		DEFAULT_TIMEOUT_MS,
	);
	if (res.status === 404 || res.status === 405) {
		res = await fetchWithTimeout(
			getUrl,
			{
				method: 'GET',
				headers: reltioHeaders(token),
			},
			DEFAULT_TIMEOUT_MS,
		);
	}
	if (res.status === 401) {
		throw new ReltioApiError('Unauthorized (401)', 401);
	}
	if (!res.ok) {
		throw new ReltioApiError(`Count entities failed: HTTP ${res.status}`, res.status);
	}
	const text = await res.text();
	const trimmed = text.trim();
	if (/^\d+$/.test(trimmed)) return Number(trimmed);
	const data = JSON.parse(trimmed) as unknown;
	if (typeof data === 'number') return data;
	if (data && typeof data === 'object') {
		const total = (data as Record<string, unknown>).total;
		if (typeof total === 'number') return total;
		if (typeof total === 'string' && /^\d+$/.test(total)) return Number(total);
	}
	throw new ReltioApiError('Count entities: unexpected response shape', res.status);
}

/** Response body shape from Reltio when PUT /configuration fails validation (e.g. HTTP 400 + XSD check). */
export interface ReltioConfigurationApiErrorJson {
	severity?: string;
	errorMessage?: string;
	errorCode?: number;
	errorDetailMessage?: string;
}

function tryParseReltioConfigurationError(
	bodyText: string,
): ReltioConfigurationApiErrorJson | undefined {
	const t = bodyText.trim();
	if (!t.startsWith('{')) {
		return undefined;
	}
	try {
		const o = JSON.parse(t) as unknown;
		if (!o || typeof o !== 'object') {
			return undefined;
		}
		const r = o as Record<string, unknown>;
		if (!('errorMessage' in r) && !('errorCode' in r) && !('errorDetailMessage' in r)) {
			return undefined;
		}
		return {
			severity: typeof r.severity === 'string' ? r.severity : undefined,
			errorMessage: typeof r.errorMessage === 'string' ? r.errorMessage : undefined,
			errorCode: typeof r.errorCode === 'number' ? r.errorCode : undefined,
			errorDetailMessage: typeof r.errorDetailMessage === 'string' ? r.errorDetailMessage : undefined,
		};
	} catch {
		return undefined;
	}
}

/**
 * Comfortably larger than any real XSD/validation error body observed, while
 * still bounding a pathological or malicious server response from flooding the
 * VS Code error dialog.
 */
const MAX_ERROR_BODY_CHARS = 12_000;

function formatPutConfigurationFailureMessage(httpStatus: number, bodyText: string): string {
	const reltio = tryParseReltioConfigurationError(bodyText);
	if (reltio) {
		const intro = `Reltio did not apply this configuration (HTTP ${httpStatus}${
			reltio.errorCode != null ? `, error code ${reltio.errorCode}` : ''
		}). Fix the issues below in your L3 JSON, then try again.`;

		const chunks: string[] = [intro];
		if (reltio.severity) {
			chunks.push(`Severity: ${reltio.severity}`);
		}
		if (reltio.errorMessage) {
			chunks.push(reltio.errorMessage);
		}
		if (reltio.errorDetailMessage && reltio.errorDetailMessage !== reltio.errorMessage) {
			chunks.push(reltio.errorDetailMessage);
		}
		if (!reltio.errorMessage && !reltio.errorDetailMessage && reltio.errorCode != null) {
			chunks.push(`See Reltio documentation for error code ${reltio.errorCode}.`);
		}
		return chunks.join('\n\n');
	}

	const trimmed = bodyText.trim();
	if (!trimmed) {
		return `Put configuration failed (HTTP ${httpStatus}).`;
	}
	return trimmed.length > MAX_ERROR_BODY_CHARS
		? `${trimmed.slice(0, MAX_ERROR_BODY_CHARS)}…`
		: trimmed;
}

export async function putL3Configuration(
	baseUrl: string,
	tenantId: string,
	token: string,
	body: string,
): Promise<void> {
	const root = toHttpsBase(baseUrl);
	const url = `${root}/reltio/api/${encodeURIComponent(tenantId)}/configuration`;
	const res = await fetchWithTimeout(
		url,
		{
			method: 'PUT',
			headers: reltioHeaders(token, { 'Content-Type': 'application/json' }),
			body,
		},
		DEFAULT_TIMEOUT_MS,
	);
	if (res.status === 401) {
		throw new ReltioApiError('Unauthorized (401)', 401);
	}
	if (!res.ok) {
		let fullText = '';
		try {
			fullText = await res.text();
		} catch {
			/* ignore */
		}
		const message = formatPutConfigurationFailureMessage(res.status, fullText);
		throw new ReltioApiError(message, res.status);
	}
}

/** Match explanation evaluates candidates server-side, so it gets a longer budget than config calls. */
const VERIFY_MATCHES_TIMEOUT_MS = 30_000;

/** An inline entity (`type` + `attributes`, optionally `crosswalks`) or a stored-entity URI. */
export type VerifyMatchesEntity = string | Record<string, unknown>;

export interface VerifyMatchesRequestBody {
	first: VerifyMatchesEntity;
	second: VerifyMatchesEntity;
	/** Candidate match groups, evaluated instead of the tenant's deployed rules. */
	matchGroups: unknown[];
}

/** One rule's verdict in a `_verifyMatches` explanation (the fields this extension reads). */
export interface VerifyMatchesRuleExplanation {
	label?: string;
	/** True only when the rule matched *and* the pair shares a match token (candidate discovery). */
	matched?: boolean;
	/** True when the rule logic is satisfied, regardless of whether a match token is shared. */
	matchedByDocuments?: boolean;
	matchAction?: string;
	bypassed?: boolean;
	relevance?: number;
	/** The rule's operator tree with a relevance per operand and attribute, as Reltio evaluated it. */
	rule?: unknown;
}

export interface VerifyMatchesExplanation {
	summary?: string[];
	rules?: Record<string, VerifyMatchesRuleExplanation>;
	[key: string]: unknown;
}

/**
 * Explains how two entities match under the candidate `matchGroups` in `body`.
 *
 * Read-only: the endpoint evaluates and explains, and never creates, merges or changes an entity.
 * Used by the match-verification bridge so an agent can test a rule before it is written to the
 * configuration, let alone deployed.
 */
export async function verifyMatches(
	baseUrl: string,
	tenantId: string,
	token: string,
	body: VerifyMatchesRequestBody,
): Promise<VerifyMatchesExplanation> {
	const root = toHttpsBase(baseUrl);
	const url = `${root}/reltio/api/${encodeURIComponent(tenantId)}/entities/_verifyMatches`;
	const res = await fetchWithTimeout(
		url,
		{
			method: 'POST',
			headers: reltioHeaders(token, { 'Content-Type': 'application/json' }),
			body: JSON.stringify(body),
		},
		VERIFY_MATCHES_TIMEOUT_MS,
	);
	if (res.status === 401) {
		throw new ReltioApiError('Unauthorized (401)', 401);
	}
	if (!res.ok) {
		let text = '';
		try {
			text = await res.text();
		} catch {
			/* ignore */
		}
		throw new ReltioApiError(`Verify matches failed: HTTP ${res.status}`, res.status, undefined, text.slice(0, MAX_ERROR_BODY_CHARS));
	}
	return (await res.json()) as VerifyMatchesExplanation;
}
