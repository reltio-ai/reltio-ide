import type { Node } from 'jsonc-parser';

/**
 * Collect every string value assigned to properties named `propertyKey` anywhere in the AST
 * (including all elements if the value is an array of strings). Used to surface “reuse values
 * already present for this property in this file” instead of arbitrary word-based fragments.
 */
export function collectStringValuesForPropertyName(root: Node, propertyKey: string): Set<string> {
	const out = new Set<string>();
	walk(root, propertyKey, out);
	return out;
}

function walk(node: Node, propertyKey: string, out: Set<string>): void {
	if (node.type === 'property' && node.children && node.children.length >= 2) {
		const keyNode = node.children[0];
		const valNode = node.children[1];
		if (keyNode.type === 'string' && keyNode.value === propertyKey) {
			collectFromValueNode(valNode, out);
		}
	}
	if (node.children) {
		for (const c of node.children) {
			walk(c, propertyKey, out);
		}
	}
}

function collectFromValueNode(valNode: Node, out: Set<string>): void {
	if (valNode.type === 'string') {
		const v = valNode.value;
		if (typeof v === 'string' && v.length > 0) {
			out.add(v);
		}
		return;
	}
	if (valNode.type === 'array' && valNode.children) {
		for (const c of valNode.children) {
			if (c.type === 'string') {
				const v = c.value;
				if (typeof v === 'string' && v.length > 0) {
					out.add(v);
				}
			}
		}
	}
}
