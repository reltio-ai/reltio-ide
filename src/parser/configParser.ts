import {
	Node,
	ParseError,
	findNodeAtLocation,
	getLocation,
	parse,
	parseTree,
} from 'jsonc-parser';
import type { ReltioBusinessModel } from '../model/types';

export interface ParsedDocument {
	model: ReltioBusinessModel;
	ast: Node;
	errors: ParseError[];
}

export function parseDocument(text: string): ParsedDocument {
	const errors: ParseError[] = [];
	const model = parse(text, errors) as ReltioBusinessModel ?? {};
	const ast = parseTree(text, undefined, { allowTrailingComma: true }) as Node;
	return { model, ast, errors };
}

export function findNodeAtPath(
	ast: Node,
	path: (string | number)[],
): Node | undefined {
	return findNodeAtLocation(ast, path);
}

export function getJsonPathAtOffset(
	text: string,
	ast: Node,
	offset: number,
): (string | number)[] {
	const location = getLocation(text, offset);
	return location.path;
}

export function findArrayInsertionPoint(
	text: string,
	ast: Node,
	arrayPath: (string | number)[],
): { offset: number; isEmpty: boolean } {
	const arrayNode = findNodeAtLocation(ast, arrayPath);
	if (!arrayNode || arrayNode.type !== 'array') {
		return { offset: -1, isEmpty: true };
	}
	const children = arrayNode.children ?? [];
	if (children.length === 0) {
		const closeOffset = arrayNode.offset + arrayNode.length - 1;
		return { offset: closeOffset, isEmpty: true };
	}
	const lastChild = children[children.length - 1];
	const afterLast = lastChild.offset + lastChild.length;
	return { offset: afterLast, isEmpty: false };
}

export function findNodeRangeForDeletion(
	text: string,
	ast: Node,
	path: (string | number)[],
): { offset: number; length: number } | undefined {
	const node = findNodeAtLocation(ast, path);
	if (!node) {
		return undefined;
	}

	const parentPath = path.slice(0, -1);
	const parentNode = parentPath.length > 0
		? findNodeAtLocation(ast, parentPath)
		: ast;

	if (!parentNode) {
		return { offset: node.offset, length: node.length };
	}

	const siblings = parentNode.children ?? [];
	const idx = typeof path[path.length - 1] === 'number'
		? (path[path.length - 1] as number)
		: siblings.findIndex(c => c === node);

	let start = node.offset;
	let end = node.offset + node.length;

	if (siblings.length === 1) {
		// Only element — just remove it, keep array brackets
		return trimWhitespace(text, start, end);
	}

	if (idx < siblings.length - 1) {
		// Not the last element — extend forward to consume the comma + whitespace
		const nextSibling = siblings[idx + 1];
		end = nextSibling.offset;
		// Trim leading whitespace from start backwards
		while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) {
			start--;
		}
		if (start > 0 && text[start - 1] === '\n') {
			start--;
			if (start > 0 && text[start - 1] === '\r') {
				start--;
			}
		}
	} else {
		// Last element — extend backward to consume comma + whitespace before us
		const prevSibling = siblings[idx - 1];
		start = prevSibling.offset + prevSibling.length;
	}

	return { offset: start, length: end - start };
}

function trimWhitespace(
	text: string,
	start: number,
	end: number,
): { offset: number; length: number } {
	while (start > 0 && /[\s,]/.test(text[start - 1])) {
		start--;
	}
	while (end < text.length && /[\s]/.test(text[end])) {
		end++;
	}
	return { offset: start, length: end - start };
}
