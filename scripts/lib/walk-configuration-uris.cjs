'use strict';

const URI_PREFIX = 'configuration/';

/**
 * Walk every `configuration/…` string in the AST with its parent property key.
 * @param {import('jsonc-parser').Node} ast
 * @param {(site: { uri: string, node: import('jsonc-parser').Node, propertyKey: string | null }) => void} onSite
 */
function walkConfigurationUriSites(ast, onSite) {
	function walk(node, parentPropertyKey) {
		if (!node) {
			return;
		}
		if (node.type === 'string') {
			const val = node.value;
			if (typeof val === 'string' && val.startsWith(URI_PREFIX)) {
				onSite({ uri: val, node, propertyKey: parentPropertyKey });
			}
			return;
		}
		if (node.type === 'property' && node.children && node.children.length >= 2) {
			const keyNode = node.children[0];
			const key = keyNode.type === 'string' ? keyNode.value : null;
			walk(node.children[1], key);
			return;
		}
		if (node.children) {
			for (const child of node.children) {
				walk(child, parentPropertyKey);
			}
		}
	}
	walk(ast, null);
}

module.exports = { walkConfigurationUriSites, URI_PREFIX };
