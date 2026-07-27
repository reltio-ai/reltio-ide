import * as vscode from 'vscode';
import { parseTree } from 'jsonc-parser';
import type { UriIndex } from './uriIndex';
import { findStringNodeAtOffset } from './definitionProvider';

const URI_PREFIX = 'configuration/';

export class ReltioReferenceProvider implements vscode.ReferenceProvider {
	private index: UriIndex | undefined;

	setIndex(index: UriIndex): void {
		this.index = index;
	}

	provideReferences(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.ReferenceContext,
		_token: vscode.CancellationToken,
	): vscode.Location[] {
		if (!this.index) return [];

		const ast = parseTree(document.getText(), undefined, { allowTrailingComma: true });
		if (!ast) return [];

		const offset = document.offsetAt(position);
		const node = findStringNodeAtOffset(ast, offset);
		if (!node) return [];

		const val = node.value as string;
		if (typeof val !== 'string' || !val.startsWith(URI_PREFIX)) return [];

		let lookupUri: string;
		if (this.index.isDefinitionProperty(node)) {
			lookupUri = val;
		} else {
			lookupUri = this.index.getRealUri(val);
		}

		const locations: vscode.Location[] = [];

		if (context.includeDeclaration) {
			const defNode = this.index.getDefinitionNode(lookupUri);
			if (defNode) {
				locations.push(new vscode.Location(document.uri, document.positionAt(defNode.offset + 1)));
			}
		}

		const refs = this.index.getReferences(lookupUri);
		for (const ref of refs) {
			locations.push(new vscode.Location(document.uri, document.positionAt(ref.offset + 1)));
		}

		if (this.index.definitions.has(lookupUri)) {
			for (const [_virtUri, virt] of this.index.virtualDefinitions) {
				if (virt.realUri === lookupUri) {
					const virtRefs = this.index.getReferences(_virtUri);
					for (const ref of virtRefs) {
						locations.push(new vscode.Location(document.uri, document.positionAt(ref.offset + 1)));
					}
				}
			}
		}

		return locations;
	}
}
