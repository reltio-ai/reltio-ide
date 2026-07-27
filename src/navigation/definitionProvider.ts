import * as vscode from 'vscode';
import type { Node } from 'jsonc-parser';
import { parseTree } from 'jsonc-parser';
import type { UriIndex } from './uriIndex';

const URI_PREFIX = 'configuration/';

export class ReltioDefinitionProvider implements vscode.DefinitionProvider {
	private index: UriIndex | undefined;

	setIndex(index: UriIndex): void {
		this.index = index;
	}

	provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken,
	): vscode.Location | undefined {
		if (!this.index) return undefined;

		const ast = parseTree(document.getText(), undefined, { allowTrailingComma: true });
		if (!ast) return undefined;

		const offset = document.offsetAt(position);
		const node = findStringNodeAtOffset(ast, offset);
		if (!node) return undefined;

		const val = node.value as string;
		if (typeof val !== 'string' || !val.startsWith(URI_PREFIX)) return undefined;

		const targetNode = this.index.getDefinitionNode(val);
		if (!targetNode) return undefined;

		const targetPos = document.positionAt(targetNode.offset + 1);
		return new vscode.Location(document.uri, targetPos);
	}
}

export function findStringNodeAtOffset(root: Node, offset: number): Node | undefined {
	return walkForStringAt(root, offset);
}

function walkForStringAt(node: Node, offset: number): Node | undefined {
	if (offset < node.offset || offset >= node.offset + node.length) return undefined;

	if (node.type === 'string' && offset >= node.offset && offset < node.offset + node.length) {
		return node;
	}

	if (node.children) {
		for (const child of node.children) {
			const found = walkForStringAt(child, offset);
			if (found) return found;
		}
	}

	return undefined;
}
