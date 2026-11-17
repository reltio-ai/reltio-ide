import * as vscode from 'vscode';
import { parse as parseJsonc } from 'jsonc-parser';
import {
	fetchRdmLookupValues,
	postRdmLookupValues,
	ReltioApiError,
	UntrustedHostError,
} from '../api/reltioClient';
import { GIT_SOURCE_TOKEN } from '../api/tokenStore';
import { MAX_LOOKUP_VALUES_PER_REQUEST, planLookupValues, type LookupValuesPlan } from './lookupValueDraft';
import {
	chunk,
	countOutcomes,
	loadOutcomes,
	planWarnings,
	readLookupCsv,
	resolveLookupTypes,
	unknownSourceWarnings,
	type CsvFinding,
	type LoadOutcome,
	type LookupCsvType,
} from './lookupCsv';

/**
 * File bridge that lets an AI agent load lookup values from a CSV into a
 * tenant's RDM — the first bridge that writes, so every load is approved by
 * the user in a modal dialog the agent cannot answer.
 *
 * As with the match verification bridge, the agent never holds the session.
 * It writes `request.json` naming two workspace files, the CSV (as RDM exports
 * it) and the tenant's RDM configuration; the extension works out the
 * environment, tenant and RDM tenant from the configuration's path and the
 * lookup types from the CSV's `type` column, calls the RDM service, and writes
 * `result.json`.
 */
export const RDM_LOOKUP_LOAD_SEGMENTS = ['.reltio', 'reltio-agent', 'rdm-lookup-load'] as const;
export const REQUEST_FILE = 'request.json';
export const RESULT_FILE = 'result.json';
export const RDM_LOOKUP_LOAD_SETTING = 'enableRdmLookupLoad';

export const NOT_RUN_REASONS = ['disabled', 'repository-mode', 'no-tenant', 'signed-out', 'no-rdm-service'] as const;
export type NotRunReason = (typeof NOT_RUN_REASONS)[number];

export const FAILURE_KINDS = ['invalid-request', 'invalid-csv', 'unknown-lookup-type', 'api-error', 'untrusted-host', 'network'] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

export interface LoadError {
	kind: FailureKind;
	message: string;
	httpStatus?: number;
	responseBody?: string;
}

/** What the approval dialog states. Everything in it comes from the extension's own resolution. */
export interface LoadApproval {
	environmentName: string;
	tenantId: string;
	rdmTenantId: string;
	/** The lookup types the load writes to: those with a code to add or append to. */
	lookupTypes: string[];
	csvFile: string;
	newCount: number;
	/** Existing codes that get mappings appended, and how many mappings in all. */
	appendCount: number;
	appendMappingCount: number;
	unchangedCount: number;
	warningCount: number;
}

type Classification = 'new' | 'append' | 'unchanged';
type ClassCounts = Record<Classification, number>;

interface Target {
	tenant: { environment: string; tenantId: string };
	rdmTenantId: string;
	/** Every lookup type in the CSV, in order of first appearance. */
	lookupTypes: string[];
}

export type LookupLoadResult =
	| ({ requestId: string; status: 'planned'; message: string; completedAt: string } & Target & {
			codes: Array<{ lookupType: string; code: string; lines: number[]; classification: Classification }>;
			counts: ClassCounts;
			appendMappingCount: number;
			errors: CsvFinding[];
			warnings: CsvFinding[];
	  })
	| ({ requestId: string; status: 'loaded'; message: string; completedAt: string } & Target & {
			codes: Array<{ lookupType: string; code: string; lines: number[]; outcome: LoadOutcome }>;
			counts: Record<LoadOutcome, number>;
			warnings: CsvFinding[];
			error?: LoadError;
	  })
	| ({ requestId: string; status: 'cancelled'; message: string; completedAt: string } & Target & {
			counts: ClassCounts;
	  })
	| { requestId: string | null; status: 'not-run'; reason: NotRunReason; message: string; completedAt: string }
	| { requestId: string | null; status: 'failed'; error: LoadError; errors?: CsvFinding[]; message: string; completedAt: string };

export interface LookupLoadDeps {
	workspaceRoot: vscode.Uri;
	isEnabled: () => boolean;
	/** A workspace opened with Connect your Repository has no tenant session by design. */
	isRepositoryMode: () => boolean;
	/** Environment and tenant of a workspace file, from the extension's own tenant markers. */
	resolveTenant: (file: vscode.Uri) => Promise<{ environmentName: string; tenantId: string } | undefined>;
	/** Where that tenant's configuration for an RDM tenant lives. */
	rdmConfigUri: (environmentName: string, tenantId: string, rdmTenantId: string) => vscode.Uri;
	getToken: (environmentName: string) => string | undefined;
	tryRefresh: (environmentName: string) => Promise<boolean>;
	/** `'401'` when discovery needs a new session; `undefined` when the tenant has no RDM service. */
	resolveServiceUri: (environmentName: string, tenantId: string, token: string) => Promise<string | undefined | '401'>;
	/** Shows the modal approval; `true` only when the user chose Load. */
	approve: (approval: LoadApproval) => Promise<boolean>;
	readFile?: (uri: vscode.Uri) => Promise<Uint8Array>;
	/** Injected so tests never reach the network. */
	fetchValues?: typeof fetchRdmLookupValues;
	postValues?: typeof postRdmLookupValues;
	log?: (line: string) => void;
}

const now = (): string => new Date().toISOString();

function normalizedPath(p: string): string {
	return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** Resolves a request path against the workspace and refuses anything that escapes it. */
function resolveInWorkspace(root: vscode.Uri, value: string): vscode.Uri | undefined {
	const isAbsolute = /^([a-zA-Z]:[\\/]|\/)/.test(value);
	const uri = isAbsolute ? vscode.Uri.file(value) : vscode.Uri.joinPath(root, ...value.split(/[\\/]+/).filter(Boolean));
	const target = normalizedPath(uri.path);
	if (target.split('/').includes('..') || value.split(/[\\/]+/).includes('..')) return undefined;
	return target.startsWith(`${normalizedPath(root.path)}/`) ? uri : undefined;
}

const baseName = (uri: vscode.Uri): string => uri.path.slice(uri.path.lastIndexOf('/') + 1);

function relativeTo(root: vscode.Uri, uri: vscode.Uri): string {
	return uri.path.startsWith(`${root.path}/`) ? uri.path.slice(root.path.length + 1) : uri.path;
}

function notRun(requestId: string | null, reason: NotRunReason, message: string): LookupLoadResult {
	return { requestId, status: 'not-run', reason, message, completedAt: now() };
}

function failed(requestId: string | null, error: LoadError, errors?: CsvFinding[]): LookupLoadResult {
	return { requestId, status: 'failed', error, ...(errors ? { errors } : {}), message: error.message, completedAt: now() };
}

function toLoadError(e: unknown): LoadError {
	if (e instanceof ReltioApiError) {
		return {
			kind: 'api-error',
			message: e.message,
			httpStatus: e.statusCode,
			...(e.responseBody ? { responseBody: e.responseBody } : {}),
		};
	}
	if (e instanceof UntrustedHostError) return { kind: 'untrusted-host', message: e.message };
	return { kind: 'network', message: (e as Error)?.message ?? String(e) };
}

export function approvalText(a: LoadApproval): { message: string; detail: string } {
	const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
	const several = a.lookupTypes.length > 1;
	return {
		message: several ? `Load into ${a.lookupTypes.length} lookup types?` : `Load into ${a.lookupTypes[0]}?`,
		detail:
			(several ? `${a.lookupTypes.join(', ')}. ` : '') +
			`${plural(a.newCount, 'new code')}, and ${plural(a.appendMappingCount, 'new mapping')} for ${plural(a.appendCount, 'existing code')}. ` +
			'Nothing stored is changed or removed. ' +
			`Tenant ${a.tenantId} on ${a.environmentName}, RDM tenant ${a.rdmTenantId}, from ${a.csvFile}. ` +
			`${plural(a.unchangedCount, 'code')} already stored. ${plural(a.warningCount, 'warning')}.`,
	};
}

/**
 * Handles one `request.json`. Never throws: every outcome, a malformed
 * request included, becomes a result the agent can read and act on.
 */
export async function handleLookupLoadRequest(raw: unknown, deps: LookupLoadDeps): Promise<LookupLoadResult> {
	const log = deps.log ?? (() => undefined);
	const readFile = deps.readFile ?? (uri => vscode.workspace.fs.readFile(uri));
	const fetchValues = deps.fetchValues ?? fetchRdmLookupValues;
	const postValues = deps.postValues ?? postRdmLookupValues;
	const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
	const requestId = typeof body?.requestId === 'string' && body.requestId ? body.requestId : null;

	if (!deps.isEnabled()) {
		return notRun(requestId, 'disabled', 'Loading lookup values from CSV is turned off (reltio.enableRdmLookupLoad).');
	}
	if (deps.isRepositoryMode()) {
		return notRun(requestId, 'repository-mode', 'This workspace was opened with Connect your Repository, which has no tenant connection.');
	}
	const invalid = (message: string) => failed(requestId, { kind: 'invalid-request', message });
	if (!body) return invalid('request.json must hold a JSON object.');
	if (!requestId) return failed(null, { kind: 'invalid-request', message: '"requestId" is required and must be a non-empty string.' });

	// ── The request: only these three fields are read ──────────────────────
	const mode = body.mode;
	if (mode !== 'plan' && mode !== 'load') return invalid('"mode" must be "plan" or "load".');
	if (typeof body.csvFile !== 'string' || !body.csvFile.trim()) return invalid('"csvFile" is required: the workspace-relative path of the CSV.');
	if (typeof body.rdmConfigFile !== 'string' || !body.rdmConfigFile.trim()) {
		return invalid('"rdmConfigFile" is required: the workspace-relative path of the tenant\'s RDM/<rdmTenantId>/config.json.');
	}
	const csvUri = resolveInWorkspace(deps.workspaceRoot, body.csvFile.trim());
	if (!csvUri) return invalid(`"csvFile" must be a path inside the workspace (got "${body.csvFile}").`);
	if (!/\.csv$/i.test(csvUri.path)) return invalid(`"csvFile" must be a .csv file (got "${body.csvFile}").`);
	const configUri = resolveInWorkspace(deps.workspaceRoot, body.rdmConfigFile.trim());
	if (!configUri) return invalid(`"rdmConfigFile" must be a path inside the workspace (got "${body.rdmConfigFile}").`);

	// ── Identity, from the workspace's own tenant markers ──────────────────
	const segments = configUri.path.split('/');
	const rdmTenantId = segments[segments.length - 2] ?? '';
	if (segments[segments.length - 1] !== 'config.json' || segments[segments.length - 3] !== 'RDM' || !rdmTenantId) {
		return invalid(`"rdmConfigFile" must be a tenant's RDM/<rdmTenantId>/config.json (got "${body.rdmConfigFile}").`);
	}
	const loc = await deps.resolveTenant(configUri);
	if (!loc) return notRun(requestId, 'no-tenant', `"${body.rdmConfigFile}" is not inside a connected tenant folder.`);
	const { environmentName, tenantId } = loc;
	if (normalizedPath(deps.rdmConfigUri(environmentName, tenantId, rdmTenantId).path) !== normalizedPath(configUri.path)) {
		return invalid(`"${body.rdmConfigFile}" is not ${tenantId}'s RDM configuration for "${rdmTenantId}".`);
	}

	let configuration: unknown;
	try {
		configuration = parseJsonc(new TextDecoder().decode(await readFile(configUri)));
	} catch {
		return invalid(`"${body.rdmConfigFile}" could not be read.`);
	}

	let csvBytes: Uint8Array;
	try {
		csvBytes = await readFile(csvUri);
	} catch {
		return invalid(`"${body.csvFile}" could not be read.`);
	}
	const csv = readLookupCsv(new TextDecoder().decode(csvBytes), csvBytes.byteLength);
	const csvFile = relativeTo(deps.workspaceRoot, csvUri);

	if (mode === 'load' && csv.errors.length > 0) {
		return failed(requestId, { kind: 'invalid-csv', message: `${csvFile} has ${csv.errors.length} error(s); nothing was sent.` }, csv.errors);
	}
	// The lookup types come from the CSV's `type` column, each checked against the configuration.
	const { resolved, errors: typeErrors } = resolveLookupTypes(csv, configuration);
	if (typeErrors.length > 0) {
		return failed(requestId, { kind: 'unknown-lookup-type', message: typeErrors.map(e => e.message).join(' ') }, typeErrors);
	}
	const target: Target = { tenant: { environment: environmentName, tenantId }, rdmTenantId, lookupTypes: csv.types.map(t => t.name) };
	const typesText = target.lookupTypes.join(', ');
	log(`[${now()}] ${requestId}: ${mode} ${csvFile} → ${environmentName}/${tenantId} RDM ${rdmTenantId} ${typesText || '(no lookup type)'}`);

	// An export is named after the RDM tenant it came from. Loading it into another one (Dev to Prod) is allowed, and said.
	const exportedFrom = /^(.+)_lookups_\d+\.csv$/i.exec(baseName(csvUri))?.[1];
	const fileWarnings: CsvFinding[] =
		exportedFrom && exportedFrom !== rdmTenantId
			? [{ lines: [1], message: `${baseName(csvUri)} was exported from RDM tenant ${exportedFrom}; it loads into ${rdmTenantId}.` }]
			: [];

	// ── The session: never written anywhere ────────────────────────────────
	const signedOut = notRun(requestId, 'signed-out', `Not signed in to ${environmentName}. Sign in from the Reltio view, then try again.`);
	let token = deps.getToken(environmentName);
	if (!token || token === GIT_SOURCE_TOKEN) return signedOut;

	/** One call with the same silent refresh and single retry the other flows use. */
	const withSession = async <T>(call: (t: string) => Promise<T>): Promise<T | 'signed-out'> => {
		try {
			return await call(token!);
		} catch (e) {
			if (!(e instanceof ReltioApiError && e.statusCode === 401)) throw e;
			token = (await deps.tryRefresh(environmentName)) ? deps.getToken(environmentName) : undefined;
			if (!token) return 'signed-out';
			try {
				return await call(token);
			} catch (e2) {
				if (e2 instanceof ReltioApiError && e2.statusCode === 401) return 'signed-out';
				throw e2;
			}
		}
	};

	let serviceUri = await deps.resolveServiceUri(environmentName, tenantId, token);
	if (serviceUri === '401') {
		token = (await deps.tryRefresh(environmentName)) ? deps.getToken(environmentName) : undefined;
		if (!token) return signedOut;
		serviceUri = await deps.resolveServiceUri(environmentName, tenantId, token);
		if (serviceUri === '401') return signedOut;
	}
	if (!serviceUri) return notRun(requestId, 'no-rdm-service', `No RDM service is configured for ${tenantId}.`);
	const service = serviceUri;

	// ── Plan: every lookup type against a fresh fetch of its own ───────────
	interface TypePlan {
		group: LookupCsvType;
		current: unknown;
		plan: LookupValuesPlan;
	}
	const typePlans: TypePlan[] = [];
	for (const group of csv.types) {
		const lookupType = resolved.get(group.name)!;
		try {
			const fetched = await withSession(t => fetchValues(service, rdmTenantId, lookupType.name, t));
			if (fetched === 'signed-out') return signedOut;
			// Existing codes get their missing mappings appended to the stored value; nothing stored changes.
			const lookupTarget = { rdmTenantId, lookupTypeName: lookupType.name, lookupTypeUri: lookupType.uri };
			typePlans.push({ group, current: fetched, plan: planLookupValues(group.values, fetched, lookupTarget) });
		} catch (e) {
			return failed(requestId, toLoadError(e));
		}
	}
	const warnings = [
		...fileWarnings,
		...csv.warnings,
		...typePlans.flatMap(tp => [...unknownSourceWarnings(tp.group, tp.current, configuration), ...planWarnings(tp.plan, tp.group)]),
	];
	const lines = (tp: TypePlan, code: string) => tp.group.linesByCode[code] ?? [];
	const counts: ClassCounts = { new: 0, append: 0, unchanged: 0 };
	let appendMappingCount = 0;
	for (const tp of typePlans) {
		for (const i of tp.plan.items) {
			counts[i.kind]++;
			if (i.kind === 'append') appendMappingCount += i.expect.length;
		}
	}

	if (mode === 'plan') {
		const message = csv.errors.length > 0
			? `${csv.errors.length} error(s) must be fixed before loading.`
			: `${counts.new} new code(s) and ${appendMappingCount} new mapping(s) for ${counts.append} existing code(s) to load into ${typesText}; ` +
				`${counts.unchanged} code(s) already stored. Nothing stored is changed or removed.`;
		log(`  planned: ${counts.new} new, ${counts.append} append, ${counts.unchanged} unchanged, ${csv.errors.length} errors, ${warnings.length} warnings`);
		return {
			requestId,
			status: 'planned',
			...target,
			codes: typePlans.flatMap(tp =>
				tp.plan.items.map(i => ({ lookupType: tp.group.name, code: i.draft.code, lines: lines(tp, i.draft.code), classification: i.kind })),
			),
			counts,
			appendMappingCount,
			errors: csv.errors,
			warnings,
			message,
			completedAt: now(),
		};
	}

	// ── Load: approved by the user, then sent per lookup type in chunks ────
	// Kept per lookup type: the same code in two lookup types must never confirm the other.
	const sentByType = new Map<string, string[]>();
	const responsesByType = new Map<string, unknown[]>();
	const finish = (refetched: Map<string, unknown>, error?: LoadError): LookupLoadResult => {
		const codes = typePlans.flatMap(tp =>
			loadOutcomes({
				items: tp.plan.items,
				sent: sentByType.get(tp.group.name) ?? [],
				createResponses: responsesByType.get(tp.group.name) ?? [],
				refetched: refetched.get(tp.group.name),
			}).map(o => ({ lookupType: tp.group.name, code: o.code, lines: lines(tp, o.code), outcome: o.outcome })),
		);
		const outcomeCounts = countOutcomes(codes);
		const message =
			`${outcomeCounts.added} added, ${outcomeCounts.appended} appended to, ${outcomeCounts.unchanged} unchanged` +
			(outcomeCounts['not-stored'] ? `, ${outcomeCounts['not-stored']} not stored` : '') +
			(outcomeCounts['not-sent'] ? `, ${outcomeCounts['not-sent']} not sent` : '') +
			(outcomeCounts.unconfirmed ? `, ${outcomeCounts.unconfirmed} unconfirmed` : '') +
			`.${error ? ` ${error.message}` : ''}`;
		log(`  loaded: ${message}`);
		return {
			requestId,
			status: 'loaded',
			...target,
			codes,
			counts: outcomeCounts,
			warnings,
			...(error ? { error } : {}),
			message,
			completedAt: now(),
		};
	};

	const sending = typePlans.filter(tp => tp.plan.items.some(i => i.element));
	if (sending.length === 0) return finish(new Map(typePlans.map(tp => [tp.group.name, tp.current])));

	const approved = await deps.approve({
		environmentName,
		tenantId,
		rdmTenantId,
		lookupTypes: sending.map(tp => tp.group.name),
		csvFile,
		newCount: counts.new,
		appendCount: counts.append,
		appendMappingCount,
		unchangedCount: counts.unchanged,
		warningCount: warnings.length,
	});
	if (!approved) {
		log('  cancelled by the user');
		return {
			requestId,
			status: 'cancelled',
			...target,
			counts,
			message: 'The load was not approved in the IDE; nothing was sent.',
			completedAt: now(),
		};
	}

	let error: LoadError | undefined;
	send: for (const tp of sending) {
		const name = tp.group.name;
		const sent: string[] = [];
		const responses: unknown[] = [];
		sentByType.set(name, sent);
		responsesByType.set(name, responses);
		const chunks = chunk(tp.plan.items.filter(i => i.element), MAX_LOOKUP_VALUES_PER_REQUEST);
		for (const [i, part] of chunks.entries()) {
			try {
				const created = await withSession(t => postValues(service, rdmTenantId, part.map(p => p.element), t));
				if (created === 'signed-out') {
					error = {
						kind: 'api-error',
						message: `The session for ${environmentName} expired; ${name} codes from chunk ${i + 1} on, and any later lookup type, were not sent.`,
						httpStatus: 401,
					};
					break send;
				}
				sent.push(...part.map(p => p.draft.code));
				responses.push(created);
				log(`  ${name} chunk ${i + 1}/${chunks.length}: ${part.length} code(s) sent`);
			} catch (e) {
				// A failed or timed-out request may still have stored some of its codes.
				sent.push(...part.map(p => p.draft.code));
				error = toLoadError(e);
				log(`  ${name} chunk ${i + 1}/${chunks.length}: failed (${error.kind}${error.httpStatus ? ` ${error.httpStatus}` : ''}) ${error.message}`);
				break send;
			}
		}
	}

	const refetched = new Map<string, unknown>();
	for (const tp of sending) {
		if (!sentByType.get(tp.group.name)?.length) continue;
		try {
			const fetched = await withSession(t => fetchValues(service, rdmTenantId, tp.group.name, t));
			if (fetched !== 'signed-out') refetched.set(tp.group.name, fetched);
		} catch {
			// Not re-fetched: sent codes the create responses don't show are reported unconfirmed.
		}
	}
	return finish(refetched, error);
}

/**
 * Watches for `request.json` and answers each one in `result.json`.
 *
 * Writes are debounced (an agent may write the file in several chunks) and
 * handled one at a time, so two quick requests never interleave.
 */
export function registerLookupLoadBridge(deps: LookupLoadDeps): vscode.Disposable {
	const dir = vscode.Uri.joinPath(deps.workspaceRoot, ...RDM_LOOKUP_LOAD_SEGMENTS);
	const requestUri = vscode.Uri.joinPath(dir, REQUEST_FILE);
	const resultUri = vscode.Uri.joinPath(dir, RESULT_FILE);
	const watcher = vscode.workspace.createFileSystemWatcher(
		new vscode.RelativePattern(deps.workspaceRoot, `${RDM_LOOKUP_LOAD_SEGMENTS.join('/')}/${REQUEST_FILE}`),
	);

	let timer: ReturnType<typeof setTimeout> | undefined;
	let queue: Promise<void> = Promise.resolve();

	type Read = { kind: 'empty' } | { kind: 'json'; value: unknown } | { kind: 'invalid' };
	const readRequest = async (): Promise<Read> => {
		try {
			const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(requestUri)).trim();
			return text ? { kind: 'json', value: JSON.parse(text) } : { kind: 'empty' };
		} catch {
			return { kind: 'invalid' };
		}
	};

	const answerRequest = async (): Promise<void> => {
		let read = await readRequest();
		if (read.kind === 'invalid') {
			// Possibly caught mid-write; one short retry before calling it malformed.
			await new Promise(r => setTimeout(r, 500));
			read = await readRequest();
		}
		if (read.kind === 'empty') return;
		const result =
			read.kind === 'json'
				? await handleLookupLoadRequest(read.value, deps)
				: failed(null, { kind: 'invalid-request', message: 'request.json is not valid JSON.' });
		await vscode.workspace.fs.writeFile(resultUri, new TextEncoder().encode(`${JSON.stringify(result, null, 2)}\n`));
	};

	const schedule = (): void => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			queue = queue.then(answerRequest).catch(e => deps.log?.(`RDM lookup load error: ${(e as Error).message}`));
		}, 300);
	};

	const subscriptions = [watcher, watcher.onDidCreate(schedule), watcher.onDidChange(schedule)];
	return {
		dispose: () => {
			if (timer) clearTimeout(timer);
			for (const s of subscriptions) s.dispose();
		},
	};
}
