'use strict';

const assert = require('assert');
const { walkConfigurationUriSites } = require('./walk-configuration-uris.cjs');

/**
 * Self-oracle: every non-definition `configuration/…` reference resolves via UriIndex.
 * @param {import('../../dist/navigation/uriIndex').UriIndex} index
 * @param {import('jsonc-parser').Node} ast
 */
function assertNavigationSelfOracle(index, ast) {
	const unresolved = index.getAllUnresolved();
	assert.strictEqual(
		unresolved.length,
		0,
		`expected zero unresolved URIs, got ${unresolved.length}: ${unresolved.map(u => u.uri).join(', ')}`,
	);

	walkConfigurationUriSites(ast, ({ uri, node, propertyKey }) => {
		if (propertyKey === 'uri') {
			return;
		}
		const defNode = index.getDefinitionNode(uri);
		assert.ok(defNode, `unresolved reference at offset ${node.offset}: ${uri}`);
		assert.notStrictEqual(
			defNode.offset,
			node.offset,
			`reference and definition share offset for ${uri}`,
		);
		if (propertyKey === 'outputMappingRef') {
			assert.strictEqual(
				defNode.type,
				'array',
				`outputMappingRef should resolve to outputMapping array for ${uri}`,
			);
		} else {
			assert.ok(
				index.isDefinitionProperty(defNode) || defNode.type === 'array',
				`definition node for ${uri} should be uri value or inline target`,
			);
		}
	});
}

module.exports = { assertNavigationSelfOracle };
