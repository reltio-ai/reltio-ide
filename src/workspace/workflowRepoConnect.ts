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
 * Removes this extension's own generated `README.md` from the clone target, but
 * only when it is the sole entry present and its content carries the marker
 * every generated README includes. Anything else — a real file, a subfolder, a
 * README the user edited — is left completely alone; `isFolderEmpty()` then
 * reports honestly on whatever remains.
 */
export async function clearGeneratedReadmeBeforeClone(root: vscode.Uri): Promise<void> {
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(root);
	} catch {
		return; // Folder does not exist yet — nothing to clear.
	}
	if (entries.length !== 1) return;
	const [name, type] = entries[0];
	if (name !== 'README.md' || type !== vscode.FileType.File) return;

	const readmeUri = vscode.Uri.joinPath(root, name);
	try {
		const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(readmeUri));
		if (!text.includes(GENERATED_README_MARKER)) return;
	} catch {
		return;
	}
	await vscode.workspace.fs.delete(readmeUri, { useTrash: false });
}
