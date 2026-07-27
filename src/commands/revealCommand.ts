import * as vscode from 'vscode';
import { findNodeAtPath } from '../parser/configParser';
import type { ConfigTreeItem } from '../tree/treeNodes';
import type { Node } from 'jsonc-parser';

const HIGHLIGHT_DURATION_MS = 1500;

const highlightDecoration = vscode.window.createTextEditorDecorationType({
	backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
	isWholeLine: false,
});

export async function revealInEditor(
	item: ConfigTreeItem,
	ast: Node | undefined,
	documentUri: vscode.Uri,
): Promise<void> {
	if (!ast) return;

	const node = findNodeAtPath(ast, item.jsonPath);
	if (!node) return;

	const document = await vscode.workspace.openTextDocument(documentUri);
	const editor = await vscode.window.showTextDocument(document, {
		preserveFocus: false,
		preview: false,
	});

	const startPos = document.positionAt(node.offset);
	const endPos = document.positionAt(node.offset + node.length);
	const range = new vscode.Range(startPos, endPos);

	editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
	editor.selection = new vscode.Selection(startPos, startPos);

	editor.setDecorations(highlightDecoration, [range]);
	setTimeout(() => {
		editor.setDecorations(highlightDecoration, []);
	}, HIGHLIGHT_DURATION_MS);
}
