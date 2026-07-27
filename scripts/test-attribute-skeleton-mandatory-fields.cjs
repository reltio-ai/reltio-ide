#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: attribute-skeleton-mandatory-fields
 * Tier A: buildAttributeObject includes the Reltio-UI-mandatory fields for
 *         Nested (dataLabelPattern) and Reference (relationshipLabelPattern)
 *         attribute kinds; Simple (String) is unaffected.
 * Tier C (manual): insert each kind via the tree, confirm the field appears — see design.md Test plan.
 */
const assert = require('node:assert');
const { importDist } = require('./lib/import-dist.cjs');

const { buildAttributeObject } = importDist('commands/elementSkeletons');

// RP-189634: Nested attribute skeletons include dataLabelPattern.
const nested = buildAttributeObject('configuration/entityTypes/Location', 'Attribute1', 'Nested');
assert.strictEqual(nested.type, 'Nested');
assert.strictEqual(nested.dataLabelPattern, '');
assert.ok(Array.isArray(nested.attributes));

// RP-189645: Reference attribute skeletons include relationshipLabelPattern.
const reference = buildAttributeObject('configuration/entityTypes/Contact', 'Attribute1', 'Reference');
assert.strictEqual(reference.type, 'Reference');
assert.strictEqual(reference.referencedEntityTypeURI, '');
assert.strictEqual(reference.relationshipTypeURI, '');
assert.strictEqual(reference.relationshipLabelPattern, '');

// Simple attributes are unaffected — neither field is mandatory in the Reltio UI for String type.
const simple = buildAttributeObject('configuration/entityTypes/Contact', 'Attribute1', 'String');
assert.strictEqual(simple.type, 'String');
assert.strictEqual('dataLabelPattern' in simple, false);
assert.strictEqual('relationshipLabelPattern' in simple, false);

console.log('test-attribute-skeleton-mandatory-fields: OK');
