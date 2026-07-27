#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: insert-interaction-type
 * Tier A: buildInteractionTypeObject, labelsFromInteractionTypes
 * Tier C (manual): context menu insert, cursor placement — openspec/changes/insert-interaction-type/
 */
const assert = require('assert');
const { importDist } = require('./lib/import-dist.cjs');

const {
	buildInteractionTypeObject,
	labelsFromInteractionTypes,
	nextDefaultLabel,
} = importDist('commands/elementSkeletons');

const it1 = buildInteractionTypeObject('InteractionType1');
assert.strictEqual(it1.uri, 'configuration/interactionTypes/InteractionType1');
assert.strictEqual(it1.label, 'InteractionType1');
assert.ok(Array.isArray(it1.attributes));
assert.strictEqual(it1.attributes.length, 0);

assert.deepStrictEqual(labelsFromInteractionTypes(undefined), []);
assert.deepStrictEqual(labelsFromInteractionTypes([]), []);

const labels = labelsFromInteractionTypes([
	{ uri: 'configuration/interactionTypes/Purchase', label: 'Purchase' },
	{ uri: 'configuration/interactionTypes/Visit' },
]);
assert.deepStrictEqual(labels, ['Purchase', 'Visit']);

assert.strictEqual(nextDefaultLabel('InteractionType', labels), 'InteractionType1');
assert.strictEqual(nextDefaultLabel('InteractionType', ['InteractionType1', 'InteractionType3']), 'InteractionType4');

console.log('test-insert-interaction-type: OK');
