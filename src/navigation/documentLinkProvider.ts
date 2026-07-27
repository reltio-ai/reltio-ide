import * as vscode from 'vscode';
import type { UriIndex } from './uriIndex';

export class ReltioDocumentLinkProvider implements vscode.DocumentLinkProvider {
	private index: UriIndex | undefined;

	setIndex(index: UriIndex): void {
		this.index = index;
	}

	provideDocumentLinks(
		document: vscode.TextDocument,
		_token: vscode.CancellationToken,
	): vscode.DocumentLink[] {
		if (!this.index) return [];

		const links: vscode.DocumentLink[] = [];

		for (const [_uri, nodes] of this.index.references) {
			for (const node of nodes) {
				const startPos = document.positionAt(node.offset + 1);
				const endPos = document.positionAt(node.offset + node.length - 1);
				const range = new vscode.Range(startPos, endPos);

				const link = new vscode.DocumentLink(range);
				link.tooltip = 'Follow URI (Ctrl+click)';
				links.push(link);
			}
		}

		return links;
	}

	resolveDocumentLink(
		link: vscode.DocumentLink,
		_token: vscode.CancellationToken,
	): vscode.DocumentLink | undefined {
		return link;
	}
}
