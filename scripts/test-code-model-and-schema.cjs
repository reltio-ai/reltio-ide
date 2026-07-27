#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: code-model-and-schema
 * Tier A: manifest-driven parse expectations on registered fixtures; edit-range helpers
 * Tier C (manual): JSON schema validation in editor — openspec/changes/code-model-and-schema/
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');
const { repoRoot } = require('./lib/load-canonical-fixture.cjs');

const {
	parseDocument,
	findNodeAtPath,
	findArrayInsertionPoint,
	findNodeRangeForDeletion,
	getJsonPathAtOffset,
} = importDist('parser/configParser');
const { UriIndex } = importDist('navigation/uriIndex');

const manifestPath = path.join(repoRoot, 'samples', 'code-model-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

for (const entry of manifest.fixtures) {
	const fixturePath = path.join(repoRoot, entry.path);
	const text = fs.readFileSync(fixturePath, 'utf8');
	const doc = parseDocument(text);
	const expect = entry.expect;

	if (expect.noParseErrors) {
		assert.strictEqual(doc.errors.length, 0, `${entry.path}: parse errors`);
	}
	if (expect.schemaVersion !== undefined) {
		assert.strictEqual(doc.model.schemaVersion, expect.schemaVersion, `${entry.path}: schemaVersion`);
	}
	if (expect.topLevelKeys) {
		const keys = Object.keys(doc.model).sort();
		assert.deepStrictEqual(keys, [...expect.topLevelKeys].sort(), `${entry.path}: topLevelKeys`);
	}
	if (expect.entityTypeCount !== undefined) {
		assert.strictEqual(
			(doc.model.entityTypes ?? []).length,
			expect.entityTypeCount,
			`${entry.path}: entityTypeCount`,
		);
	}
	if (expect.relationTypeCount !== undefined) {
		assert.strictEqual(
			(doc.model.relationTypes ?? []).length,
			expect.relationTypeCount,
			`${entry.path}: relationTypeCount`,
		);
	}
	if (expect.sourceCount !== undefined) {
		assert.strictEqual(
			(doc.model.sources ?? []).length,
			expect.sourceCount,
			`${entry.path}: sourceCount`,
		);
	}
	if (expect.definitionCount !== undefined || expect.unresolvedUriCount !== undefined) {
		const index = new UriIndex();
		index.build(doc.model, doc.ast);
		if (expect.definitionCount !== undefined) {
			assert.strictEqual(
				index.definitions.size,
				expect.definitionCount,
				`${entry.path}: definitionCount`,
			);
		}
		if (expect.unresolvedUriCount !== undefined) {
			assert.strictEqual(
				index.getAllUnresolved().length,
				expect.unresolvedUriCount,
				`${entry.path}: unresolvedUriCount`,
			);
		}
	}
}

const inline = '{"entityTypes":[{"uri":"configuration/entityTypes/A","label":"A"}]}';
const inlineDoc = parseDocument(inline);
const etNode = findNodeAtPath(inlineDoc.ast, ['entityTypes', 0, 'uri']);
assert.ok(etNode, 'findNodeAtPath uri node');
assert.strictEqual(etNode.value, 'configuration/entityTypes/A');

const uriOffset = inline.indexOf('configuration/entityTypes/A');
const jsonPath = getJsonPathAtOffset(inline, inlineDoc.ast, uriOffset);
assert.deepStrictEqual(jsonPath, ['entityTypes', 0, 'uri']);

const insert = findArrayInsertionPoint(inline, inlineDoc.ast, ['entityTypes']);
assert.ok(insert.offset >= 0, 'findArrayInsertionPoint');

const delRange = findNodeRangeForDeletion(inline, inlineDoc.ast, ['entityTypes', 0]);
assert.ok(delRange && delRange.length > 0, 'findNodeRangeForDeletion');

console.log('test-code-model-and-schema: OK');
