/**
 * Pre-clone preparation for the Custom Workflow Repository clone target.
 *
 * `Workflows/Custom Workflows/` is `tenantFolderStructure.ts`'s reserved, unmanaged
 * component-tree leaf, so `materializeTenantTree()` seeds it with a generated
 * `README.md` the moment the tenant folder exists — long before a customer gets
 * around to connecting a real repository. `git clone` refuses a non-empty
 * directory, so without clearing that placeholder first, every connect attempt
 * would fail with "folder is not empty" on a folder no one ever put anything in.
 */
import * as vscode from 'vscode';

/** Sentence every generated README carries — see `tenantFolderStructure.ts#renderReadme()`. */
const GENERATED_README_MARKER = 'not yet managed by Reltio IDE';

/**
 * Removes this extension's own generated `README.md` from the clone target (returning its text so a
 * failed clone can put it back), but
 * only when it is the sole entry present and its content carries the marker
 * every generated README includes. Anything else — a real file, a subfolder, a
 * README the user edited — is left completely alone; `isFolderEmpty()` then
 * reports honestly on whatever remains.
 */
export async function clearGeneratedReadmeBeforeClone(root: vscode.Uri): Promise<string | undefined> {
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(root);
	} catch {
		return undefined; // Folder does not exist yet — nothing to clear.
	}
	if (entries.length !== 1) return undefined;
	const [name, type] = entries[0];
	if (name !== 'README.md' || type !== vscode.FileType.File) return undefined;

	const readmeUri = vscode.Uri.joinPath(root, name);
	let text: string;
	try {
		text = new TextDecoder().decode(await vscode.workspace.fs.readFile(readmeUri));
		if (!text.includes(GENERATED_README_MARKER)) return undefined;
	} catch {
		return undefined;
	}
	await vscode.workspace.fs.delete(readmeUri, { useTrash: false });
	return text;
}

/**
 * Puts back what `clearGeneratedReadmeBeforeClone()` removed. A clone that fails (bad URL,
 * no network, auth) must leave the folder as it found it — otherwise the placeholder the
 * tenant tree seeded is gone and nothing recreates it until the next full materialization.
 */
export async function restoreGeneratedReadme(root: vscode.Uri, text: string | undefined): Promise<void> {
	if (text === undefined) return;
	try {
		await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, 'README.md'), new TextEncoder().encode(text));
	} catch {
		/* best effort: the folder is the user's, and a failed restore must not mask the clone error */
	}
}
