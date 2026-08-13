import * as vscode from 'vscode';

/** Matches `*.reltio.json` and, for git-sourced repositories, an L3 file named exactly `L3.json`. */
function isAutoSaveTarget(fileName: string): boolean {
	if (fileName.endsWith('.reltio.json')) return true;
	const base = fileName.split(/[\\/]/).pop();
	return base === 'L3.json';
}

/**
 * Saves dirty `*.reltio.json` (or a git-sourced `L3.json`) when focus moves away so disk matches
 * external agents and extension parse/index passes (reduces conflicts from unsaved buffers).
 */
export function registerReltioAutoSave(context: vscode.ExtensionContext): void {
	let lastEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			const cfg = vscode.workspace.getConfiguration('reltio');
			if (!cfg.get<boolean>('autoSaveOnEditorSwitch', true)) {
				lastEditor = editor ?? undefined;
				return;
			}
			const prev = lastEditor;
			lastEditor = editor ?? undefined;
			if (
				prev?.document &&
				isAutoSaveTarget(prev.document.fileName) &&
				prev.document.isDirty
			) {
				void prev.document.save();
			}
		}),
	);

	context.subscriptions.push(
		vscode.window.onDidChangeWindowState(state => {
			const cfg = vscode.workspace.getConfiguration('reltio');
			if (!cfg.get<boolean>('autoSaveOnWindowBlur', false) || state.focused) {
				return;
			}
			for (const doc of vscode.workspace.textDocuments) {
				if (isAutoSaveTarget(doc.fileName) && doc.isDirty) {
					void doc.save();
				}
			}
		}),
	);
}
