import * as vscode from 'vscode';

const MAX_DEPTH = 10;

/** Depth-limited search for a file named `BusinessConfig.json` (case-insensitive), skipping dotfolders (e.g. `.git`). */
export async function discoverL3Files(root: vscode.Uri): Promise<vscode.Uri[]> {
	const found: vscode.Uri[] = [];
	await walk(root, 0, found);
	return found;
}

async function walk(dir: vscode.Uri, depth: number, found: vscode.Uri[]): Promise<void> {
	if (depth > MAX_DEPTH) return;
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(dir);
	} catch {
		return;
	}
	for (const [name, type] of entries) {
		if (name.startsWith('.')) continue;
		const child = vscode.Uri.joinPath(dir, name);
		if (type === vscode.FileType.Directory) {
			await walk(child, depth + 1, found);
		} else if (name.toLowerCase() === 'businessconfig.json') {
			found.push(child);
		}
	}
}

/**
 * True when `uri` parses as strict JSON. Used as a lightweight sanity check before trusting a
 * discovered/picked/restored file as a git config source — deliberately not full schema validation
 * (a work-in-progress L3 that doesn't yet fully conform to the schema is still legitimate to open),
 * and deliberately not JSONC-tolerant: a file being *adopted* as a new source is expected to be
 * clean output (fetched/exported), unlike an already-open document a user might be mid-editing with
 * comments — jsonc-parser's error-recovery is lenient enough that it still returns a node for
 * genuinely broken content, so it isn't a useful gate here.
 */
export async function isParsableL3File(uri: vscode.Uri): Promise<boolean> {
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		JSON.parse(new TextDecoder().decode(bytes));
		return true;
	} catch {
		return false;
	}
}

/** Top-level sections a file must carry to be adopted as a business configuration. */
const REQUIRED_SECTIONS = ['sources', 'entityTypes'] as const;

/**
 * Gate for `reltio.addFileAsTenant`. A config repository holds plenty of JSON that is not a business
 * configuration (`Permissions.json` is a top-level array, `Lookups.json` is `{}`), and adopting one of
 * those yields a tree row that cannot be browsed or edited.
 *
 * True when the file is a JSON object whose top-level `uri` is `configuration` and which carries every
 * section in `REQUIRED_SECTIONS`. Deliberately a shallow shape check, not validation against
 * `schemas/reltio-metadata.schema.json`: that schema sets `additionalProperties: false`, so drift
 * between it and live L3 would start rejecting legitimate configs.
 */
export async function isBusinessConfigFile(uri: vscode.Uri): Promise<boolean> {
	let parsed: unknown;
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		parsed = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return false;
	}

	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;

	const model = parsed as Record<string, unknown>;
	if (model.uri !== 'configuration') return false;

	return REQUIRED_SECTIONS.every(section => Array.isArray(model[section]));
}

/** Naming and tree placement for one discovered L3 file. */
export interface TenantNaming {
	/** Repository folder name — the single environment row. */
	environmentName: string;
	/** Stable identity used by the marker file and `EnvironmentManager` lookups. Qualified on collision. */
	tenantId: string;
	/**
	 * The row's label in the tree. Always the plain leaf name, never qualified: the row already
	 * sits under its folder rows, so repeating the path in the label would be redundant noise.
	 */
	label: string;
	/** Folder rows between the environment and this config, outermost first. */
	folders: string[];
}

/** Path of `l3Uri` relative to `root`, split into segments. Windows drive letters compare case-insensitively. */
function relativeParts(root: vscode.Uri, l3Uri: vscode.Uri): string[] {
	const rootPath = root.path.replace(/\/+$/, '');
	let relative: string;
	if (process.platform === 'win32') {
		const startsWithRoot = l3Uri.path.toLowerCase().startsWith(rootPath.toLowerCase());
		relative = startsWithRoot ? l3Uri.path.slice(rootPath.length) : l3Uri.path;
	} else {
		relative = l3Uri.path.startsWith(rootPath) ? l3Uri.path.slice(rootPath.length) : l3Uri.path;
	}
	return relative.split('/').filter(Boolean);
}

/**
 * Derives naming for every discovered L3 file at once, so identities can be made unique.
 *
 * The tree mirrors the repository layout: `repo / DP / dp_lif`. A folder holding exactly one
 * config collapses onto that config's row, so the deepest folder name *is* the config row.
 * A folder holding several configs keeps its own row and gains one child row per filename.
 * A config at the repository root is named after its file, since the repository row is
 * already shown above it.
 *
 * `tenantId` is the row's own name. Because it is the marker-file key, duplicates across
 * different folders are qualified with their folder path so lookups stay unambiguous. That
 * qualifier is identity only: `label` keeps the plain name for display.
 */
export function deriveTenantNamings(root: vscode.Uri, allL3Uris: vscode.Uri[]): TenantNaming[] {
	const environmentName = root.path.split('/').filter(Boolean).pop() ?? 'git-config';

	const byFolder = new Map<string, number>();
	for (const uri of allL3Uris) {
		const key = relativeParts(root, uri).slice(0, -1).join('/');
		byFolder.set(key, (byFolder.get(key) ?? 0) + 1);
	}

	const draft = allL3Uris.map(uri => {
		const parts = relativeParts(root, uri);
		const filename = parts[parts.length - 1];
		const folders = parts.slice(0, -1);
		const sharesFolder = (byFolder.get(folders.join('/')) ?? 0) > 1;

		// The filename names the row whenever no folder can name it: either the config shares
		// its folder with siblings (so the folder keeps its own row), or it sits at the
		// repository root. Borrowing the repository name at the root would duplicate the
		// environment row above it, and the row would rename itself the moment a second
		// root config appeared. The filename reads the same in both cases.
		if (sharesFolder || folders.length === 0) {
			return { environmentName, tenantId: filename, label: filename, folders };
		}
		const leaf = folders[folders.length - 1];
		return { environmentName, tenantId: leaf, label: leaf, folders: folders.slice(0, -1) };
	});

	// Qualify only genuine clashes, so the common case keeps the short leaf name. `label` is
	// deliberately left alone: the qualifier exists to keep lookups unambiguous, not to be read.
	const counts = new Map<string, number>();
	for (const d of draft) counts.set(d.tenantId, (counts.get(d.tenantId) ?? 0) + 1);
	return draft.map((d, i) => {
		if ((counts.get(d.tenantId) ?? 0) < 2) return d;
		const qualifier = relativeParts(root, allL3Uris[i]).slice(0, -1).join('/');
		return { ...d, tenantId: qualifier ? `${d.tenantId} (${qualifier})` : d.tenantId };
	});
}

/** Naming for a single file. Prefer `deriveTenantNamings` when handling a whole repository. */
export function deriveTenantNaming(
	root: vscode.Uri,
	l3Uri: vscode.Uri,
	allL3Uris: vscode.Uri[],
): TenantNaming {
	const all = allL3Uris.some(u => u.path === l3Uri.path) ? allL3Uris : [...allL3Uris, l3Uri];
	const index = all.findIndex(u => u.path === l3Uri.path);
	return deriveTenantNamings(root, all)[index];
}
