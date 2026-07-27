import * as path from 'path';
import * as vscode from 'vscode';
import type { EnvironmentManager } from './environmentManager';
import type { TokenStore } from '../api/tokenStore';

/** Safe shape only — never embed bearer/OAuth secrets in settings. */
export interface DefaultEnvironmentEntry {
	host: string;
	tenantId: string;
	tokenFile?: string;
}

export interface ApplyDefaultsDeps {
	workspaceRoot: vscode.Uri;
	environmentManager: EnvironmentManager;
	tokenStore: TokenStore;
	normalizeEnvironmentName: (raw: string) => string;
	onEnvironmentCreated: (host: string) => void;
	onTenantCreated: (host: string, tenantId: string) => void;
	writeL3FromApi?: (
		host: string,
		tenantId: string,
		token: string,
	) => Promise<'written' | '401' | 'error'>;
	fetchL3: boolean;
}

export interface ApplyDefaultsResult {
	scaffolded: number;
	authenticated: number;
	fetched: number;
	errors: string[];
}

const ILLICIT_SECRET_KEYS = [
	'token',
	'accessToken',
	'access_token',
	'refreshToken',
	'refresh_token',
	'clientSecret',
	'client_secret',
] as const;

/**
 * Canonical validator for host/tenantId before they become filesystem path segments.
 * Rejects empty values, path separators, `..`, and other traversal markers.
 */
export function isSafePathSegment(value: string): boolean {
	if (!value || value.trim() !== value) {
		return false;
	}
	if (value === '.' || value === '..') {
		return false;
	}
	if (value.includes('..')) {
		return false;
	}
	if (/[\\/\0]/.test(value)) {
		return false;
	}
	return true;
}

/**
 * Read `reltio.defaultEnvironments` and normalize entries.
 * Ignores illicit inline secret fields if present (never loads them).
 */
export function readDefaultEnvironmentEntries(): DefaultEnvironmentEntry[] {
	const raw = vscode.workspace
		.getConfiguration('reltio')
		.get<unknown>('defaultEnvironments', []);
	if (!Array.isArray(raw)) return [];

	const out: DefaultEnvironmentEntry[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const record = item as Record<string, unknown>;
		const host = typeof record.host === 'string' ? record.host.trim() : '';
		const tenantId = typeof record.tenantId === 'string' ? record.tenantId.trim() : '';
		if (!host || !tenantId) continue;

		const tokenFile =
			typeof record.tokenFile === 'string' && record.tokenFile.trim()
				? record.tokenFile.trim()
				: undefined;

		out.push({ host, tenantId, tokenFile });
	}
	return out;
}

/** True when a settings object contains forbidden inline secret keys (logged as error, ignored). */
export function entryHasIllicitSecretFields(record: Record<string, unknown>): string[] {
	return ILLICIT_SECRET_KEYS.filter(k => {
		const v = record[k];
		return typeof v === 'string' && v.trim().length > 0;
	});
}

/**
 * Resolve `tokenFile` under the workspace root.
 * Fail closed: rejects absolute paths and any path that escapes the workspace.
 */
export function resolveTokenFileUri(
	workspaceRoot: vscode.Uri,
	tokenFile: string,
): { uri: vscode.Uri; canonicalFsPath: string } | { error: string } {
	if (!tokenFile.trim()) {
		return { error: 'tokenFile is empty' };
	}
	if (path.isAbsolute(tokenFile)) {
		return {
			error: `tokenFile must be workspace-relative (absolute paths rejected): ${tokenFile}`,
		};
	}

	const rootFs = path.resolve(workspaceRoot.fsPath);
	const candidate = path.resolve(rootFs, tokenFile);
	const relative = path.relative(rootFs, candidate);
	if (
		relative === '' ||
		relative.startsWith('..') ||
		path.isAbsolute(relative)
	) {
		return { error: `tokenFile escapes workspace root: ${tokenFile}` };
	}

	return { uri: vscode.Uri.file(candidate), canonicalFsPath: candidate };
}

export async function readAccessTokenFromFile(uri: vscode.Uri): Promise<string | { error: string }> {
	let bytes: Uint8Array;
	try {
		bytes = await vscode.workspace.fs.readFile(uri);
	} catch {
		return { error: `token file not found or unreadable: ${uri.fsPath}` };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
	} catch {
		return { error: `token file is not valid JSON: ${uri.fsPath}` };
	}

	if (!parsed || typeof parsed !== 'object') {
		return { error: `token file must be a JSON object: ${uri.fsPath}` };
	}

	const accessToken = (parsed as Record<string, unknown>).access_token;
	if (typeof accessToken !== 'string' || !accessToken.trim()) {
		return { error: `token file missing string access_token: ${uri.fsPath}` };
	}
	return accessToken.trim();
}

/**
 * Detect hosts that specify more than one distinct tokenFile.
 * TokenStore is keyed by host, so conflicting files would make auth order-dependent.
 */
export function findConflictingTokenFiles(
	entries: DefaultEnvironmentEntry[],
	normalizeEnvironmentName: (raw: string) => string,
	workspaceRoot: vscode.Uri,
): Map<string, string[]> {
	const filesByHost = new Map<string, Set<string>>();
	for (const entry of entries) {
		if (!entry.tokenFile) continue;
		const host = normalizeEnvironmentName(entry.host);
		if (!host || !isSafePathSegment(host)) continue;
		const resolved = resolveTokenFileUri(workspaceRoot, entry.tokenFile);
		if ('error' in resolved) continue;
		const set = filesByHost.get(host) ?? new Set<string>();
		set.add(resolved.canonicalFsPath);
		filesByHost.set(host, set);
	}

	const conflicts = new Map<string, string[]>();
	for (const [host, files] of filesByHost) {
		if (files.size > 1) {
			conflicts.set(host, [...files].sort());
		}
	}
	return conflicts;
}

/**
 * Scaffold environments/tenants from workspace settings and optionally load bearer
 * tokens from local token **files** (never from settings values).
 */
export async function applyDefaultEnvironments(
	deps: ApplyDefaultsDeps,
): Promise<ApplyDefaultsResult> {
	const result: ApplyDefaultsResult = {
		scaffolded: 0,
		authenticated: 0,
		fetched: 0,
		errors: [],
	};

	try {
		const config = vscode.workspace.getConfiguration('reltio');
		const rawList = config.get<unknown>('defaultEnvironments', []);
		if (!Array.isArray(rawList) || rawList.length === 0) {
			result.errors.push(
				'reltio.defaultEnvironments is empty — add host/tenantId entries in settings.',
			);
			return result;
		}

		const entries = readDefaultEnvironmentEntries();
		if (entries.length === 0) {
			result.errors.push(
				'reltio.defaultEnvironments has no valid entries (each needs host and tenantId).',
			);
			return result;
		}

		// Warn about illicit inline secrets without loading them.
		for (const item of rawList) {
			if (!item || typeof item !== 'object') continue;
			const record = item as Record<string, unknown>;
			const illicit = entryHasIllicitSecretFields(record);
			if (illicit.length > 0) {
				const label =
					typeof record.host === 'string' && record.host.trim()
						? `${record.host.trim()}`
						: 'entry';
				const tenant =
					typeof record.tenantId === 'string' && record.tenantId.trim()
						? `/${record.tenantId.trim()}`
						: '';
				result.errors.push(
					`${label}${tenant}: Ignored inline secret field(s) [${illicit.join(', ')}] — use tokenFile path only, never put tokens in settings.`,
				);
			}
		}

		const tokenConflicts = findConflictingTokenFiles(
			entries,
			deps.normalizeEnvironmentName,
			deps.workspaceRoot,
		);
		for (const [host, files] of tokenConflicts) {
			result.errors.push(
				`${host}: conflicting tokenFile values for the same host — use one path (got ${files.length} distinct files). Token load skipped for this host.`,
			);
		}

		const existing = await deps.environmentManager.scanEnvironments();
		const existingHosts = new Set(existing.map(e => e.name));
		const existingTenants = new Map<string, Set<string>>();
		for (const env of existing) {
			existingTenants.set(env.name, new Set(env.tenants.map(t => t.tenantId)));
		}

		/** Track which hosts already loaded a token this run (identical tokenFile is ok). */
		const authenticatedHosts = new Set<string>();

		for (const entry of entries) {
			const host = deps.normalizeEnvironmentName(entry.host);
			if (!host) {
				result.errors.push(`Could not parse host: ${entry.host}`);
				continue;
			}
			if (!isSafePathSegment(host)) {
				result.errors.push(
					`Invalid host (must be a single path segment without separators or '..'): ${entry.host}`,
				);
				continue;
			}

			const tenantId = entry.tenantId.trim();
			if (!tenantId) {
				result.errors.push(`Empty tenantId for host ${host}`);
				continue;
			}
			if (!isSafePathSegment(tenantId)) {
				result.errors.push(
					`Invalid tenantId (must be a single path segment without separators or '..'): ${entry.tenantId}`,
				);
				continue;
			}

			try {
				if (!existingHosts.has(host)) {
					await deps.environmentManager.createEnvironment(host);
					deps.onEnvironmentCreated(host);
					existingHosts.add(host);
					existingTenants.set(host, new Set());
					result.scaffolded++;
				}

				const tenants = existingTenants.get(host) ?? new Set<string>();
				if (!tenants.has(tenantId)) {
					await deps.environmentManager.createTenant(host, tenantId);
					deps.onTenantCreated(host, tenantId);
					tenants.add(tenantId);
					existingTenants.set(host, tenants);
					result.scaffolded++;
				}
			} catch (e) {
				result.errors.push(`Failed to scaffold ${host}/${tenantId}: ${(e as Error).message}`);
				continue;
			}

			if (!entry.tokenFile) {
				continue;
			}

			if (tokenConflicts.has(host)) {
				continue;
			}

			const resolved = resolveTokenFileUri(deps.workspaceRoot, entry.tokenFile);
			if ('error' in resolved) {
				result.errors.push(`${host}: ${resolved.error}`);
				continue;
			}

			const tokenOrErr = await readAccessTokenFromFile(resolved.uri);
			if (typeof tokenOrErr !== 'string') {
				result.errors.push(`${host}: ${tokenOrErr.error}`);
				continue;
			}

			if (!authenticatedHosts.has(host)) {
				deps.tokenStore.setToken(host, tokenOrErr);
				authenticatedHosts.add(host);
				result.authenticated++;
			}

			if (deps.fetchL3 && deps.writeL3FromApi) {
				const writeResult = await deps.writeL3FromApi(host, tenantId, tokenOrErr);
				if (writeResult === 'written') {
					result.fetched++;
				} else if (writeResult === '401') {
					result.errors.push(
						`${host}/${tenantId}: token rejected (401) — refresh the token file and re-apply.`,
					);
				} else {
					result.errors.push(`${host}/${tenantId}: Fetch Configuration failed.`);
				}
			}
		}
	} catch (e) {
		result.errors.push(`Unexpected failure: ${(e as Error).message}`);
	}

	return result;
}

export function summarizeApplyResult(result: ApplyDefaultsResult): string {
	const parts = [
		`scaffolded ${result.scaffolded}`,
		`authenticated ${result.authenticated}`,
	];
	if (result.fetched > 0) {
		parts.push(`fetched L3 ${result.fetched}`);
	}
	let msg = `Default environments applied (${parts.join(', ')}).`;
	if (result.errors.length > 0) {
		msg += ` ${result.errors.length} issue(s): ${result.errors.join(' | ')}`;
	}
	return msg;
}

/** One unique token file → all hosts that share it. */
export interface TokenFileBinding {
	canonicalFsPath: string;
	uri: vscode.Uri;
	hosts: string[];
}

/**
 * Index defaultEnvironments by unique resolved tokenFile path.
 * Many hosts sharing one file become a single binding (one watch / one read).
 * Hosts with conflicting tokenFiles are omitted.
 */
export function indexTokenFilesByCanonicalPath(
	entries: DefaultEnvironmentEntry[],
	normalizeEnvironmentName: (raw: string) => string,
	workspaceRoot: vscode.Uri,
): TokenFileBinding[] {
	const conflicts = findConflictingTokenFiles(entries, normalizeEnvironmentName, workspaceRoot);
	const byFile = new Map<string, { uri: vscode.Uri; hosts: Set<string> }>();

	for (const entry of entries) {
		if (!entry.tokenFile) continue;
		const host = normalizeEnvironmentName(entry.host);
		if (!host || !isSafePathSegment(host) || conflicts.has(host)) continue;

		const resolved = resolveTokenFileUri(workspaceRoot, entry.tokenFile);
		if ('error' in resolved) continue;

		const bucket = byFile.get(resolved.canonicalFsPath) ?? {
			uri: resolved.uri,
			hosts: new Set<string>(),
		};
		bucket.hosts.add(host);
		byFile.set(resolved.canonicalFsPath, bucket);
	}

	return [...byFile.entries()]
		.map(([canonicalFsPath, { uri, hosts }]) => ({
			canonicalFsPath,
			uri,
			hosts: [...hosts].sort(),
		}))
		.sort((a, b) => a.canonicalFsPath.localeCompare(b.canonicalFsPath));
}

/**
 * Read a token file **once** and set the same bearer on every host in the binding.
 */
export async function reloadTokenFileIntoStore(
	binding: TokenFileBinding,
	tokenStore: TokenStore,
): Promise<{ ok: true; hosts: string[] } | { error: string }> {
	const tokenOrErr = await readAccessTokenFromFile(binding.uri);
	if (typeof tokenOrErr !== 'string') {
		return { error: tokenOrErr.error };
	}
	for (const host of binding.hosts) {
		tokenStore.setToken(host, tokenOrErr);
	}
	return { ok: true, hosts: binding.hosts };
}
