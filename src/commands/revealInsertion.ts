import * as vscode from 'vscode';
import { findNodeAtPath, parseDocument } from '../parser/configParser';

/**
 * Open document, select the JSON value at `jsonPath`, and reveal in center.
 */
export async function revealInsertionInEditor(
	documentUri: vscode.Uri,
	jsonPath: (string | number)[],
): Promise<void> {
	const doc = await vscode.workspace.openTextDocument(documentUri);
	const text = doc.getText();
	const { ast } = parseDocument(text);
	const node = findNodeAtPath(ast, jsonPath);
	if (!node) return;

	const editor = await vscode.window.showTextDocument(doc);
	const start = doc.positionAt(node.offset);
	const end = doc.positionAt(node.offset + node.length);
	editor.selection = new vscode.Selection(start, end);
	editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
}
