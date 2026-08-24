import * as vscode from 'vscode';

const MARKER_FILENAME = '.reltio-config-source.json';

export interface GitSourceMarker {
	l3RelativePath: string;
	environmentName: string;
	tenantId: string;
}

export interface MultiGitSourceMarker {
	sources: GitSourceMarker[];
}

function markerUri(root: vscode.Uri): vscode.Uri {
	return vscode.Uri.joinPath(root, MARKER_FILENAME);
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

/** Adds `.reltio-config-source.json` and `.reltio/` to the repo's `.gitignore` (creating it if needed), so marker and auto-synced agent assets never get committed. */
async function ensureMarkerGitignored(root: vscode.Uri): Promise<void> {
	const gitignoreUri = vscode.Uri.joinPath(root, '.gitignore');
	let existing = '';
	try {
		existing = new TextDecoder().decode(await vscode.workspace.fs.readFile(gitignoreUri));
	} catch {
		existing = '';
	}

	const lines = existing.split(/\r?\n/);
	const hasMarker = lines.some(line => line.trim() === MARKER_FILENAME);
	const hasReltioFolder = lines.some(line => line.trim() === '.reltio/' || line.trim() === '.reltio');

	if (hasMarker && hasReltioFolder) {
		return;
	}

	let updated = existing;
	const withTrailingNewline = updated.length > 0 && !updated.endsWith('\n') ? `${updated}\n` : updated;
	updated = withTrailingNewline;

	if (!hasMarker) {
		updated += `${MARKER_FILENAME}\n`;
	}
	if (!hasReltioFolder) {
		updated += `.reltio/\n`;
	}

	await vscode.workspace.fs.writeFile(gitignoreUri, new TextEncoder().encode(updated));
}
