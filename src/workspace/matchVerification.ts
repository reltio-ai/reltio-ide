import * as vscode from 'vscode';
import {
	ReltioApiError,
	UntrustedHostError,
	verifyMatches,
	type VerifyMatchesExplanation,
	type VerifyMatchesRequestBody,
} from '../api/reltioClient';
import { GIT_SOURCE_TOKEN } from '../api/tokenStore';

/**
 * File bridge that lets an AI agent test a candidate match rule against the live tenant.
 *
 * The agent cannot hold the user's Reltio session and the extension never calls an LLM, so the two
 * meet in a folder: the agent writes `request.json`, the extension calls the read-only
 * `_verifyMatches` API with the session it already holds, and writes `result.json`. The folder sits
 * under `.reltio/`, which every workspace and tenant `.gitignore` excludes.
 *
 * The request names the configuration file being edited, not an environment or tenant. Identity
 * comes from the extension's own scan of the tenant markers, so a request cannot point the user's
 * token at a host or tenant of its choosing.
 */
export const MATCH_VERIFICATION_SEGMENTS = ['.reltio', 'reltio-agent', 'match-verification'] as const;
export const REQUEST_FILE = 'request.json';
export const RESULT_FILE = 'result.json';
export const MATCH_VERIFICATION_SETTING = 'enableMatchVerification';

/** One call per pair, so these bound how hard a single request can hit the tenant. */
export const MAX_PAIRS = 10;
export const MAX_MATCH_GROUPS = 10;

/** Every `status` a result can carry. The skill documents what the agent does for each. */
export const RESULT_STATUSES = ['verified', 'not-verified', 'failed'] as const;

/** Why live verification did not run. The agent may fall back to static reasoning, labelled as such. */
export const NOT_VERIFIED_REASONS = ['disabled', 'repository-mode', 'no-tenant', 'signed-out'] as const;
export type NotVerifiedReason = (typeof NOT_VERIFIED_REASONS)[number];

/** Why verification ran and failed. The agent must not insert the rule. */
export const FAILURE_KINDS = ['invalid-request', 'api-error', 'untrusted-host', 'network'] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

/**
 * The pair's verdict across the candidate rules.
 *
 * `no-shared-token` is the case static reasoning gets wrong most often: the rule logic is satisfied,
 * but the two records share no match token, so real matching would never compare them.
 */
export const PAIR_OUTCOMES = ['no-match', 'no-shared-token', 'matched', 'suspect', 'auto-merge'] as const;
export type PairOutcome = (typeof PAIR_OUTCOMES)[number];

export interface RuleVerdict {
	evaluated: boolean;
	matched: boolean;
	matchedByDocuments: boolean;
	matchAction: string | null;
	bypassed: boolean;
	relevance?: number;
	/**
	 * Reltio's own breakdown of the rule (per operator and attribute), passed through untouched for
	 * when the user asks how each attribute scored. Absent when the server sent none.
	 */
	explanation?: unknown;
}

export interface PairResult {
	label: string;
	outcome: PairOutcome;
	rules: Record<string, RuleVerdict>;
	summary?: string[];
}

export type MatchVerificationResult =
	| {
			requestId: string | null;
			status: 'verified';
			tenant: { environment: string; tenantId: string };
			completedAt: string;
			pairs: PairResult[];
	  }
	| {
			requestId: string | null;
			status: 'not-verified';
			reason: NotVerifiedReason;
			message: string;
			completedAt: string;
	  }
	| {
			requestId: string | null;
			status: 'failed';
			error: {
				kind: FailureKind;
				message: string;
				httpStatus?: number;
				responseBody?: string;
				pairLabel?: string;
			};
			completedAt: string;
			/** Pairs that completed before the failure. */
			pairs?: PairResult[];
	  };

export interface MatchVerificationDeps {
	workspaceRoot: vscode.Uri;
	isEnabled: () => boolean;
	/** A workspace opened with Connect your Repository has no tenant session by design. */
	isRepositoryMode: () => boolean;
	resolveTenant: (configFile: vscode.Uri) => Promise<{ environmentName: string; tenantId: string } | undefined>;
	getToken: (environmentName: string) => string | undefined;
	tryRefresh: (environmentName: string) => Promise<boolean>;
	/** Injected so tests never reach the network. */
	verify?: typeof verifyMatches;
	log?: (line: string) => void;
}

interface ParsedRequest {
	configFile: vscode.Uri;
	matchGroups: Array<Record<string, unknown> & { uri: string }>;
	pairs: Array<{ label: string; first: VerifyMatchesRequestBody['first']; second: VerifyMatchesRequestBody['second'] }>;
}

const now = (): string => new Date().toISOString();

function isEntity(v: unknown): v is VerifyMatchesRequestBody['first'] {
	return (typeof v === 'string' && v.length > 0) || (!!v && typeof v === 'object' && !Array.isArray(v));
}

function normalizedPath(p: string): string {
	return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** Resolves `configFile` against the workspace and refuses anything that escapes it. */
function resolveConfigFile(root: vscode.Uri, value: string): vscode.Uri | undefined {
	const isAbsolute = /^([a-zA-Z]:[\\/]|\/)/.test(value);
	const uri = isAbsolute ? vscode.Uri.file(value) : vscode.Uri.joinPath(root, ...value.split(/[\\/]+/).filter(Boolean));
	const rootPath = normalizedPath(root.path);
	const target = normalizedPath(uri.path);
	if (target.split('/').includes('..')) return undefined;
	return target.startsWith(`${rootPath}/`) ? uri : undefined;
}

function parseRequest(raw: Record<string, unknown>, root: vscode.Uri): ParsedRequest | string {
	if (typeof raw.configFile !== 'string' || !raw.configFile.trim()) {
		return '"configFile" is required: the workspace-relative path of the BusinessConfig.json the rule is for.';
	}
	const configFile = resolveConfigFile(root, raw.configFile.trim());
	if (!configFile) return `"configFile" must be a path inside the workspace (got "${raw.configFile}").`;

	const groups = raw.matchGroups;
	if (!Array.isArray(groups) || groups.length === 0) {
		return '"matchGroups" must be a non-empty array holding the candidate match group(s).';
	}
	if (groups.length > MAX_MATCH_GROUPS) return `"matchGroups" holds ${groups.length} groups; the limit is ${MAX_MATCH_GROUPS}.`;
	for (const [i, g] of groups.entries()) {
		if (!g || typeof g !== 'object' || typeof (g as { uri?: unknown }).uri !== 'string') {
			return `matchGroups[${i}] needs a string "uri" so its verdict can be reported.`;
		}
	}

	const pairs = raw.pairs;
	if (!Array.isArray(pairs) || pairs.length === 0) return '"pairs" must be a non-empty array of { label, first, second }.';
	if (pairs.length > MAX_PAIRS) return `"pairs" holds ${pairs.length} pairs; the limit is ${MAX_PAIRS}.`;
	const parsedPairs: ParsedRequest['pairs'] = [];
	for (const [i, p] of pairs.entries()) {
		const pair = p as { label?: unknown; first?: unknown; second?: unknown } | null;
		if (!pair || !isEntity(pair.first) || !isEntity(pair.second)) {
			return `pairs[${i}] needs "first" and "second", each an inline entity object or an entity URI.`;
		}
		parsedPairs.push({
			label: typeof pair.label === 'string' && pair.label ? pair.label : `pair ${i + 1}`,
			first: pair.first,
			second: pair.second,
		});
	}
	return { configFile, matchGroups: groups as ParsedRequest['matchGroups'], pairs: parsedPairs };
}

function classifyAction(matchAction: string | null): PairOutcome {
	const action = (matchAction ?? '').toUpperCase();
	if (action.includes('MERGE') || action.includes('AUTO')) return 'auto-merge';
	if (action.includes('POTENTIAL') || action.includes('SUSPECT')) return 'suspect';
	return 'matched';
}

/** Weakest first: the pair reports the strongest outcome any candidate rule reached. */
const OUTCOME_STRENGTH: readonly PairOutcome[] = PAIR_OUTCOMES;

/** Collapses the explanation to a verdict per candidate rule and one outcome for the pair. */
export function summarizePair(
	label: string,
	explanation: VerifyMatchesExplanation,
	candidateUris: readonly string[],
): PairResult {
	const reported = explanation.rules ?? {};
	const rules: Record<string, RuleVerdict> = {};
	let outcome: PairOutcome = 'no-match';
	for (const uri of candidateUris) {
		const r = reported[uri];
		const verdict: RuleVerdict = {
			evaluated: !!r,
			matched: r?.matched === true,
			matchedByDocuments: r?.matchedByDocuments === true,
			matchAction: r?.matchAction ?? null,
			bypassed: r?.bypassed === true,
			...(typeof r?.relevance === 'number' ? { relevance: r.relevance } : {}),
			...(r?.rule !== undefined ? { explanation: r.rule } : {}),
		};
		rules[uri] = verdict;
		const ruleOutcome: PairOutcome = verdict.matched
			? classifyAction(verdict.matchAction)
			: verdict.matchedByDocuments
				? 'no-shared-token'
				: 'no-match';
		if (OUTCOME_STRENGTH.indexOf(ruleOutcome) > OUTCOME_STRENGTH.indexOf(outcome)) outcome = ruleOutcome;
	}
	return { label, outcome, rules, ...(explanation.summary ? { summary: explanation.summary } : {}) };
}

function notVerified(requestId: string | null, reason: NotVerifiedReason, message: string): MatchVerificationResult {
	return { requestId, status: 'not-verified', reason, message, completedAt: now() };
}

function failed(
	requestId: string | null,
	error: Extract<MatchVerificationResult, { status: 'failed' }>['error'],
	pairs: PairResult[] = [],
): MatchVerificationResult {
	return { requestId, status: 'failed', error, completedAt: now(), ...(pairs.length ? { pairs } : {}) };
}

function toFailure(e: unknown, pairLabel: string): Extract<MatchVerificationResult, { status: 'failed' }>['error'] {
	if (e instanceof ReltioApiError) {
		return {
			kind: 'api-error',
			message: e.message,
			httpStatus: e.statusCode,
			...(e.responseBody ? { responseBody: e.responseBody } : {}),
			pairLabel,
		};
	}
	if (e instanceof UntrustedHostError) return { kind: 'untrusted-host', message: e.message, pairLabel };
	return { kind: 'network', message: (e as Error)?.message ?? String(e), pairLabel };
}

/**
 * Handles one parsed `request.json`. Never throws: every outcome, including a malformed request,
 * becomes a result the agent can read and act on.
 */
export async function handleVerificationRequest(
	raw: unknown,
	deps: MatchVerificationDeps,
): Promise<MatchVerificationResult> {
	const log = deps.log ?? (() => undefined);
	const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
	const requestId = typeof body?.requestId === 'string' && body.requestId ? body.requestId : null;

	if (!deps.isEnabled()) {
		return notVerified(requestId, 'disabled', 'Match verification is turned off (reltio.enableMatchVerification).');
	}
	if (deps.isRepositoryMode()) {
		return notVerified(
			requestId,
			'repository-mode',
			'This workspace was opened with Connect your Repository, which has no tenant connection.',
		);
	}
	if (!body) return failed(requestId, { kind: 'invalid-request', message: 'request.json must hold a JSON object.' });
	if (!requestId) return failed(null, { kind: 'invalid-request', message: '"requestId" is required and must be a non-empty string.' });

	const parsed = parseRequest(body, deps.workspaceRoot);
	if (typeof parsed === 'string') return failed(requestId, { kind: 'invalid-request', message: parsed });

	const tenant = await deps.resolveTenant(parsed.configFile);
	if (!tenant) {
		return notVerified(
			requestId,
			'no-tenant',
			`"${body.configFile}" is not inside a connected tenant folder.`,
		);
	}
	const { environmentName, tenantId } = tenant;
	const signedOut = notVerified(
		requestId,
		'signed-out',
		`Not signed in to ${environmentName}. Sign in from the Reltio view, then run verification again.`,
	);

	let token = deps.getToken(environmentName);
	if (!token || token === GIT_SOURCE_TOKEN) return signedOut;

	const verify = deps.verify ?? verifyMatches;
	const candidateUris = parsed.matchGroups.map(g => g.uri);
	const pairs: PairResult[] = [];
	log(`[${now()}] ${requestId}: ${parsed.pairs.length} pair(s) against ${environmentName}/${tenantId}`);

	for (const pair of parsed.pairs) {
		const requestBody: VerifyMatchesRequestBody = {
			first: pair.first,
			second: pair.second,
			matchGroups: parsed.matchGroups,
		};
		let explanation: VerifyMatchesExplanation;
		try {
			explanation = await verify(environmentName, tenantId, token, requestBody);
		} catch (e) {
			if (!(e instanceof ReltioApiError && e.statusCode === 401)) {
				const error = toFailure(e, pair.label);
				log(`  ${pair.label}: failed (${error.kind}${error.httpStatus ? ` ${error.httpStatus}` : ''}) ${error.message}`);
				return failed(requestId, error, pairs);
			}
			// Same silent refresh the fetch and deploy flows use, then one retry.
			token = (await deps.tryRefresh(environmentName)) ? deps.getToken(environmentName) : undefined;
			if (!token) return signedOut;
			try {
				explanation = await verify(environmentName, tenantId, token, requestBody);
			} catch (e2) {
				if (e2 instanceof ReltioApiError && e2.statusCode === 401) return signedOut;
				const error = toFailure(e2, pair.label);
				log(`  ${pair.label}: failed (${error.kind}) ${error.message}`);
				return failed(requestId, error, pairs);
			}
		}
		const result = summarizePair(pair.label, explanation, candidateUris);
		log(`  ${pair.label}: ${result.outcome}`);
		pairs.push(result);
	}

	return {
		requestId,
		status: 'verified',
		tenant: { environment: environmentName, tenantId },
		completedAt: now(),
		pairs,
	};
}

/**
 * Watches for `request.json` and answers each one in `result.json`.
 *
 * Writes are debounced (an agent may write the file in several chunks) and handled one at a time,
 * so two quick requests never interleave their results.
 */
export function registerMatchVerificationBridge(deps: MatchVerificationDeps): vscode.Disposable {
	const dir = vscode.Uri.joinPath(deps.workspaceRoot, ...MATCH_VERIFICATION_SEGMENTS);
	const requestUri = vscode.Uri.joinPath(dir, REQUEST_FILE);
	const resultUri = vscode.Uri.joinPath(dir, RESULT_FILE);
	const watcher = vscode.workspace.createFileSystemWatcher(
		new vscode.RelativePattern(deps.workspaceRoot, `${MATCH_VERIFICATION_SEGMENTS.join('/')}/${REQUEST_FILE}`),
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
				? await handleVerificationRequest(read.value, deps)
				: failed(null, { kind: 'invalid-request', message: 'request.json is not valid JSON.' });
		await vscode.workspace.fs.writeFile(resultUri, new TextEncoder().encode(`${JSON.stringify(result, null, 2)}\n`));
	};

	const schedule = (): void => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			queue = queue.then(answerRequest).catch(e => deps.log?.(`Match verification error: ${(e as Error).message}`));
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
