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

/**
 * Derives naming for a discovered L3 file in a git repo.
 * - environmentName: Repository folder name (single root for all configs)
 * - tenantId: Folder path or repo name at root, with filename disambiguation on conflicts
 */
export function deriveTenantNaming(
	root: vscode.Uri,
	l3Uri: vscode.Uri,
	allL3Uris: vscode.Uri[],
): { environmentName: string; tenantId: string } {
	const environmentName = root.path.split('/').filter(Boolean).pop() ?? 'git-config';
	const rootPath = root.path.replace(/\/+$/, '');

	// Get relative path
	let relative: string;
	if (process.platform === 'win32') {
		const startsWithRoot = l3Uri.path.toLowerCase().startsWith(rootPath.toLowerCase());
		relative = startsWithRoot ? l3Uri.path.slice(rootPath.length) : l3Uri.path;
	} else {
		relative = l3Uri.path.startsWith(rootPath) ? l3Uri.path.slice(rootPath.length) : l3Uri.path;
	}

	const relParts = relative.split('/').filter(Boolean);
	const filename = relParts[relParts.length - 1];
	const folders = relParts.slice(0, -1);

	// Base name: folder path or repo name if at root
	const baseName = folders.length > 0 ? folders.join('.') : environmentName;

	// Check for conflicts (multiple files in same folder)
	const conflictsInSameFolder = allL3Uris.filter(otherUri => {
		if (otherUri.path === l3Uri.path) return false;
		const otherRootPath = rootPath.replace(/\/+$/, '');
		let otherRelative: string;
		if (process.platform === 'win32') {
			const startsWithRoot = otherUri.path.toLowerCase().startsWith(otherRootPath.toLowerCase());
			otherRelative = startsWithRoot ? otherUri.path.slice(otherRootPath.length) : otherUri.path;
		} else {
			otherRelative = otherUri.path.startsWith(otherRootPath)
				? otherUri.path.slice(otherRootPath.length)
				: otherUri.path;
		}
		const otherParts = otherRelative.split('/').filter(Boolean);
		const otherFolders = otherParts.slice(0, -1);
		// Same folder if folder paths match
		return otherFolders.join('/') === folders.join('/');
	});

	// Add filename in parentheses if there are conflicts
	const tenantId = conflictsInSameFolder.length > 0 ? `${baseName} (${filename})` : baseName;

	return { environmentName, tenantId };
}
