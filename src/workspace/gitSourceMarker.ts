import * as vscode from 'vscode';
import { IDE_STATE_DIR } from './tenantFolderStructure';

const MARKER_FILENAME = '.reltio-config-source.json';

export interface GitSourceMarker {
	l3RelativePath: string;
	environmentName: string;
	tenantId: string;
}

export interface MultiGitSourceMarker {
	sources: GitSourceMarker[];
}

/**
 * Identity of a natively-connected tenant whose folder is its own git repository.
 *
 * The tenant folder is the repository root, so the environment host and tenant ID are not
 * path segments any more and cannot be recovered from a tracked path. This marker carries them
 * instead. It is gitignored, so it never reaches the remote and two tenants cloned from one
 * repository stay byte-identical in everything git tracks.
 */
export interface TenantIdentityMarker {
	kind: 'tenant';
	environmentName: string;
	tenantId: string;
}

const ENVIRONMENT_MARKER_FILENAME = '.reltio-environment.json';

/**
 * Identity of an environment folder.
 *
 * Folder names are short labels (`dev`), but every API call needs the full host
 * (`dev.reltio.com`), so the host lives here rather than in the directory name. The marker sits in
 * the environment folder, which is *above* any tenant git root, so it is never committed.
 */
export interface EnvironmentIdentityMarker {
	kind: 'environment';
	host: string;
}

function markerUri(root: vscode.Uri): vscode.Uri {
	return vscode.Uri.joinPath(root, MARKER_FILENAME);
}

function environmentMarkerUri(root: vscode.Uri): vscode.Uri {
	return vscode.Uri.joinPath(root, ENVIRONMENT_MARKER_FILENAME);
}

/** Reads an environment folder's marker, or undefined when absent or malformed. */
export async function readEnvironmentIdentityMarker(
	environmentRoot: vscode.Uri,
): Promise<EnvironmentIdentityMarker | undefined> {
	try {
		const bytes = await vscode.workspace.fs.readFile(environmentMarkerUri(environmentRoot));
		const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<EnvironmentIdentityMarker>;
		return parsed?.kind === 'environment' && typeof parsed.host === 'string' && parsed.host
			? (parsed as EnvironmentIdentityMarker)
			: undefined;
	} catch {
		return undefined;
	}
}

export async function writeEnvironmentIdentityMarker(
	environmentRoot: vscode.Uri,
	host: string,
): Promise<void> {
	const marker: EnvironmentIdentityMarker = { kind: 'environment', host };
	await vscode.workspace.fs.writeFile(
		environmentMarkerUri(environmentRoot),
		new TextEncoder().encode(JSON.stringify(marker, null, 2)),
	);
}

function isTenantIdentityMarker(parsed: unknown): parsed is TenantIdentityMarker {
	const m = parsed as Partial<TenantIdentityMarker> | null;
	return (
		!!m &&
		m.kind === 'tenant' &&
		typeof m.environmentName === 'string' &&
		typeof m.tenantId === 'string'
	);
}

/** Reads the tenant-identity marker from a tenant folder, or undefined when absent or another shape. */
export async function readTenantIdentityMarker(
	tenantRoot: vscode.Uri,
): Promise<TenantIdentityMarker | undefined> {
	try {
		const bytes = await vscode.workspace.fs.readFile(markerUri(tenantRoot));
		const parsed = JSON.parse(new TextDecoder().decode(bytes));
		return isTenantIdentityMarker(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

/** Writes the tenant-identity marker and ensures it plus IDE state are gitignored. */
export async function writeTenantIdentityMarker(
	tenantRoot: vscode.Uri,
	marker: TenantIdentityMarker,
): Promise<void> {
	const enc = new TextEncoder();
	await vscode.workspace.fs.writeFile(markerUri(tenantRoot), enc.encode(JSON.stringify(marker, null, 2)));
	await ensureMarkerGitignored(tenantRoot);
}

/** Reads git source marker(s) - supports both single and multi-source formats. */
export async function readGitSourceMarker(root: vscode.Uri): Promise<GitSourceMarker | undefined> {
	const multi = await readMultiGitSourceMarker(root);
	return multi && multi.sources.length > 0 ? multi.sources[0] : undefined;
}

/** Reads all git sources from the marker file. */
export async function readMultiGitSourceMarker(root: vscode.Uri): Promise<MultiGitSourceMarker | undefined> {
	try {
		const bytes = await vscode.workspace.fs.readFile(markerUri(root));
		const parsed = JSON.parse(new TextDecoder().decode(bytes));

		// Support legacy single-source format
		if (
			typeof parsed?.l3RelativePath === 'string' &&
			typeof parsed?.environmentName === 'string' &&
			typeof parsed?.tenantId === 'string'
		) {
			return { sources: [parsed as GitSourceMarker] };
		}

		// Multi-source format
		if (Array.isArray(parsed?.sources)) {
			const valid = parsed.sources.every((s: any) =>
				typeof s?.l3RelativePath === 'string' &&
				typeof s?.environmentName === 'string' &&
				typeof s?.tenantId === 'string'
			);
			if (valid) {
				return parsed as MultiGitSourceMarker;
			}
		}

		return undefined;
	} catch {
		return undefined;
	}
}

export async function writeGitSourceMarker(root: vscode.Uri, marker: GitSourceMarker): Promise<void> {
	await writeMultiGitSourceMarker(root, { sources: [marker] });
}

export async function writeMultiGitSourceMarker(root: vscode.Uri, marker: MultiGitSourceMarker): Promise<void> {
	const enc = new TextEncoder();
	await vscode.workspace.fs.writeFile(markerUri(root), enc.encode(JSON.stringify(marker, null, 2)));
	await ensureMarkerGitignored(root);
}

/**
 * Entries every extension-managed repository must ignore.
 *
 * Each is `[entry, alternateSpellings]` — a directory is considered present whether or not the
 * user wrote the trailing slash, so we never append a near-duplicate of a line they already have.
 */
const REQUIRED_GITIGNORE_ENTRIES: ReadonlyArray<readonly [string, readonly string[]]> = [
	[MARKER_FILENAME, []],
	// Workspace-level agent assets (skills, Velocity Packs) synced on activation.
	['.reltio/', ['.reltio']],
	// Per-tenant IDE working state: drift baseline, ontology layout, history snapshots.
	[`${IDE_STATE_DIR}/`, [IDE_STATE_DIR]],
];

/**
 * Ensures the repository's `.gitignore` excludes the marker, synced agent assets and IDE working
 * state, so `git status` in a tenant shows only configuration the user meant to version.
 *
 * Creates the file when absent, preserves unrelated entries, and never duplicates a line.
 */
export async function ensureMarkerGitignored(root: vscode.Uri): Promise<void> {
	await ensureGitignoreEntries(root, REQUIRED_GITIGNORE_ENTRIES);
}

/** Shared append-if-missing over a `.gitignore`, used for both tenant and workspace-root files. */
export async function ensureGitignoreEntries(
	root: vscode.Uri,
	entries: ReadonlyArray<readonly [string, readonly string[]]>,
): Promise<void> {
	const gitignoreUri = vscode.Uri.joinPath(root, '.gitignore');
	let existing = '';
	try {
		existing = new TextDecoder().decode(await vscode.workspace.fs.readFile(gitignoreUri));
	} catch {
		existing = '';
	}

	const present = new Set(existing.split(/\r?\n/).map(line => line.trim()));
	const missing = entries.filter(
		([entry, alternates]) => !present.has(entry) && !alternates.some(a => present.has(a)),
	);
	if (missing.length === 0) {
		return;
	}

	let updated = existing.length > 0 && !existing.endsWith('\n') ? `${existing}\n` : existing;
	for (const [entry] of missing) {
		updated += `${entry}\n`;
	}

	await vscode.workspace.fs.writeFile(gitignoreUri, new TextEncoder().encode(updated));
}
