'use strict';

const assert = require('assert');
const vscode = require('./vscode-stub.cjs');

/**
 * Recursively walk configuration tree items; assert jsonPaths resolve in AST.
 * @param {import('../../dist/model/types').ReltioBusinessModel} model
 * @param {import('jsonc-parser').Node} ast
 * @param {typeof import('../../dist/parser/configParser').findNodeAtPath} findNodeAtPath
 * @param {typeof import('../../dist/tree/configSubtree').getConfigRootChildren} getConfigRootChildren
 * @param {typeof import('../../dist/tree/configSubtree').getConfigNodeChildren} getConfigNodeChildren
 * @param {import('../../dist/navigation/uriIndex').UriIndex} [index]
 */
function assertTreeWalkSelfOracle(
	model,
	ast,
	findNodeAtPath,
	getConfigRootChildren,
	getConfigNodeChildren,
	index,
) {
	const l3Uri = vscode.Uri.file('samples/first-test.json');
	let itemCount = 0;

	function walkItems(items) {
		for (const item of items) {
			itemCount++;
			const node = findNodeAtPath(ast, item.jsonPath);
			assert.ok(
				node,
				`jsonPath ${JSON.stringify(item.jsonPath)} (${item.label}) did not resolve in AST`,
			);
			if (index && item.nodeType === 'entityType') {
				const idx = item.jsonPath[item.jsonPath.length - 1];
				const et = model.entityTypes?.[idx];
				if (et?.uri) {
					const defNode = index.getDefinitionNode(et.uri);
					assert.ok(defNode, `entity type definition node for ${et.uri}`);
					assert.ok(
						defNode.offset >= node.offset &&
							defNode.offset + defNode.length <= node.offset + node.length,
						`definition uri node should lie within tree item AST span for ${et.uri}`,
					);
				}
			}
			const children = getConfigNodeChildren(model, item);
			if (children.length > 0) {
				walkItems(children);
			}
		}
	}

	const roots = getConfigRootChildren(model, l3Uri);
	assert.ok(roots.length > 0, 'configuration tree should have root sections');
	walkItems(roots);
	assert.ok(itemCount > 50, `expected substantial tree walk, got ${itemCount} items`);
}

module.exports = { assertTreeWalkSelfOracle };
