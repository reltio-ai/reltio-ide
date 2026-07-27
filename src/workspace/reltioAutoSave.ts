import * as vscode from 'vscode';

/**
 * Saves dirty `*.reltio.json` when focus moves away so disk matches external agents
 * and extension parse/index passes (reduces conflicts from unsaved buffers).
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
				prev.document.fileName.endsWith('.reltio.json') &&
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
				if (doc.fileName.endsWith('.reltio.json') && doc.isDirty) {
					void doc.save();
				}
			}
		}),
	);
}
