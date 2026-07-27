#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: hide-reference-attribute-for-relation-types
 * Tier A: contextValueFor / ConfigTreeItem.contextValue is ancestor-aware for
 *         attributesFolder and nestedAttribute nodes descended from relationTypes[].
 * Tier C (manual): context menu visibility — see design.md Test plan.
 */
const assert = require('node:assert');
const { importDist } = require('./lib/import-dist.cjs');

const { ConfigTreeItem } = importDist('tree/treeNodes');

function contextValueOf(nodeType, jsonPath) {
	const item = new ConfigTreeItem('Label', nodeType, jsonPath, 0);
	return item.contextValue;
}

// Relation-type ancestry: attributesFolder / nestedAttribute get the `.relationType` suffix.
assert.strictEqual(
	contextValueOf('attributesFolder', ['relationTypes', 0, 'attributes']),
	'reltio.folder.attributesFolder.relationType',
);
assert.strictEqual(
	contextValueOf('nestedAttribute', ['relationTypes', 0, 'attributes', 2]),
	'reltio.item.nestedAttribute.relationType',
);
// Nested arbitrarily deep inside a relation type's attribute tree — still relation-type ancestry.
assert.strictEqual(
	contextValueOf('nestedAttribute', ['relationTypes', 0, 'attributes', 2, 'attributes', 0]),
	'reltio.item.nestedAttribute.relationType',
);

// Entity-type ancestry: unchanged, no suffix.
assert.strictEqual(
	contextValueOf('attributesFolder', ['entityTypes', 0, 'attributes']),
	'reltio.folder.attributesFolder',
);
assert.strictEqual(
	contextValueOf('nestedAttribute', ['entityTypes', 0, 'attributes', 2]),
	'reltio.item.nestedAttribute',
);

// relationType item itself is already distinct from entityType — no suffix needed or added.
assert.strictEqual(
	contextValueOf('relationType', ['relationTypes', 0]),
	'reltio.item.relationType',
);

// Other node types are never suffixed, even under relationTypes[].
assert.strictEqual(
	contextValueOf('simpleAttribute', ['relationTypes', 0, 'attributes', 1]),
	'reltio.item.simpleAttribute',
);
assert.strictEqual(
	contextValueOf('referenceAttribute', ['relationTypes', 0, 'attributes', 1]),
	'reltio.item.referenceAttribute',
);

// Other attribute-bearing types (groupType, interactionType, categoryType) are unaffected.
for (const root of ['groupTypes', 'interactionTypes', 'categoryTypes']) {
	assert.strictEqual(
		contextValueOf('attributesFolder', [root, 0, 'attributes']),
		'reltio.folder.attributesFolder',
	);
}

console.log('test-hide-reference-attribute-for-relation-types: OK');
