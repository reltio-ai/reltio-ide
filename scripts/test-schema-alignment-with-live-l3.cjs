#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: schema-alignment-with-live-l3
 * Tier B: canonical model top-level keys ⊆ schema properties
 * Tier C (manual): editor diagnostics on invalid L3 property
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadCanonicalFixture, repoRoot } = require('./lib/load-canonical-fixture.cjs');

const schemaPath = path.join(repoRoot, 'schemas', 'reltio-metadata.schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
assert.ok(schema.properties, 'schema has properties');

const { model } = loadCanonicalFixture();
const schemaKeys = new Set(Object.keys(schema.properties));
for (const key of Object.keys(model)) {
	assert.ok(schemaKeys.has(key), `canonical model key missing from schema: ${key}`);
}

console.log('test-schema-alignment-with-live-l3: OK');
