import * as vscode from 'vscode';
import type { Node } from 'jsonc-parser';
import { parseTree } from 'jsonc-parser';
import type { UriIndex } from './uriIndex';
import { findStringNodeAtOffset } from './definitionProvider';
import {
	type UriCompletionScope,
	getUriCompletionScope,
} from './uriPropertyScopes';
import { collectStringValuesForPropertyName } from './samePropertyValues';
import { filterDefinitionUris } from './uriCompletionFilter';

const MAX_ITEMS = 400;

export class ReltioUriCompletionProvider implements vscode.CompletionItemProvider {
	private index: UriIndex | undefined;

	setIndex(index: UriIndex): void {
		this.index = index;
	}

	provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken,
		_context: vscode.CompletionContext,
	): vscode.CompletionItem[] | undefined {
		if (!this.index || document.languageId !== 'json') return undefined;
		const base = document.fileName.split(/[\\/]/).pop();
		if (!document.fileName.endsWith('.reltio.json') && base !== 'L3.json') return undefined;

		const text = document.getText();
		const ast = parseTree(text, undefined, { allowTrailingComma: true });
		if (!ast) return undefined;

		const offset = document.offsetAt(position);
		const stringNode = findStringNodeAtOffset(ast, offset);
		if (!stringNode || stringNode.type !== 'string') return undefined;

		const propertyKey = getPropertyKeyForValueNode(stringNode);
		if (!propertyKey) return undefined;

		const samePropertyValues = collectStringValuesForPropertyName(ast, propertyKey);
		const scope = getUriCompletionScope(propertyKey);

		const allDefs = this.index.getAllDefinitionUris();
		let modelUris: string[] = [];
		if (scope) {
			const entityForAttrs =
				scope === 'attributeUnderEntity'
					? getSiblingReferencedEntityTypeUri(stringNode)
					: undefined;
			modelUris = filterDefinitionUris(allDefs, scope, entityForAttrs);
		}

		const partial = getPartialUriInString(text, stringNode, offset);
		const filteredModel = partial
			? modelUris.filter(u => u.startsWith(partial))
			: modelUris;
		const filteredSame = partial
			? [...samePropertyValues].filter(v => v.startsWith(partial))
			: [...samePropertyValues];

		const seen = new Set<string>();
		const items: vscode.CompletionItem[] = [];

		const addItem = (value: string, source: 'model' | 'sameProperty') => {
			if (seen.has(value)) return;
			seen.add(value);
			const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.Reference);
			item.detail =
				source === 'sameProperty'
					? 'Used elsewhere in this file (same property)'
					: 'Definition URI in this configuration';
			item.sortText = source === 'sameProperty' ? `0-${value}` : `1-${value}`;
			const replaceRange = stringContentRange(document, stringNode);
			item.range = replaceRange;
			items.push(item);
		};

		for (const v of filteredSame.sort((a, b) => a.localeCompare(b))) {
			addItem(v, 'sameProperty');
		}
		for (const u of filteredModel.sort((a, b) => a.localeCompare(b))) {
			if (items.length >= MAX_ITEMS) break;
			addItem(u, 'model');
		}

		return items.length > 0 ? items : undefined;
	}
}

function getPropertyKeyForValueNode(valueNode: Node): string | undefined {
	let n: Node | undefined = valueNode.parent;
	for (let i = 0; i < 16 && n; i++) {
		if (n.type === 'property' && n.children && n.children.length >= 2) {
			const keyNode = n.children[0];
			if (keyNode.type === 'string') {
				return keyNode.value as string;
			}
		}
		n = n.parent;
	}
	return undefined;
}

function findContainingObjectNode(start: Node): Node | undefined {
	let n: Node | undefined = start;
	for (let i = 0; i < 12 && n; i++) {
		if (n.type === 'object') return n;
		n = n.parent;
	}
	return undefined;
}

function getSiblingReferencedEntityTypeUri(valueNode: Node): string | undefined {
	const obj = findContainingObjectNode(valueNode);
	if (!obj || obj.type !== 'object' || !obj.children) return undefined;
	for (const prop of obj.children) {
		if (prop.type !== 'property' || !prop.children || prop.children.length < 2) continue;
		const k = prop.children[0];
		if (k.type === 'string' && k.value === 'referencedEntityTypeURI') {
			const v = prop.children[1];
			if (v.type === 'string' && typeof v.value === 'string') {
				return v.value;
			}
		}
	}
	return undefined;
}

/** Text between quotes for partial matching while typing */
function getPartialUriInString(
	docText: string,
	stringNode: Node,
	offset: number,
): string {
	const innerStart = stringNode.offset + 1;
	const innerEnd = stringNode.offset + stringNode.length - 1;
	const clamped = Math.max(innerStart, Math.min(offset, innerEnd));
	return docText.slice(innerStart, clamped);
}

function stringContentRange(
	document: vscode.TextDocument,
	stringNode: Node,
): vscode.Range {
	const innerStart = stringNode.offset + 1;
	const innerEnd = stringNode.offset + stringNode.length - 1;
	return new vscode.Range(
		document.positionAt(innerStart),
		document.positionAt(Math.max(innerStart, innerEnd)),
	);
}
