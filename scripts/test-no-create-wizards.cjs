#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: no-create-wizards
 * Tier A: nextDefaultLabel, skeleton builders, labelsFrom*
 * Tier C (manual): context menu insert, cursor placement — openspec/changes/no-create-wizards/
 */
const assert = require('assert');
const { importDist } = require('./lib/import-dist.cjs');

const {
	nextDefaultLabel,
	buildEntityTypeObject,
	buildRelationTypeObject,
	buildHierarchyTypeObject,
	buildAttributeObject,
	labelsFromEntityTypes,
} = importDist('commands/elementSkeletons');

assert.strictEqual(nextDefaultLabel('EntityType', []), 'EntityType1');
assert.strictEqual(nextDefaultLabel('EntityType', ['EntityType1']), 'EntityType2');
assert.strictEqual(nextDefaultLabel('EntityType', ['Foo', 'EntityType3']), 'EntityType4');
assert.strictEqual(nextDefaultLabel('Attribute', ['Attribute10']), 'Attribute11');

const et = buildEntityTypeObject('EntityType1');
assert.strictEqual(et.uri, 'configuration/entityTypes/EntityType1');
assert.ok(Array.isArray(et.attributes));

const rt = buildRelationTypeObject('RelationType1');
assert.ok(rt.uri.includes('RelationType1'));

const ht = buildHierarchyTypeObject('HierarchyType1');
assert.ok(ht.uri.includes('HierarchyType1'));

const attr = buildAttributeObject('configuration/entityTypes/X', 'Attribute1', 'String');
assert.strictEqual(attr.type, 'String');
assert.ok(String(attr.uri).includes('Attribute1'));

const labels = labelsFromEntityTypes([
	{ uri: 'configuration/entityTypes/A', label: 'Alpha' },
]);
assert.deepStrictEqual(labels, ['Alpha']);

console.log('test-no-create-wizards: OK');
