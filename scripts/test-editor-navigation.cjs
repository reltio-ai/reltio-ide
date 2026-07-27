#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: editor-navigation
 * Tier A: self-oracle on canonical fixture — reference→definition, zero unresolved
 * Tier C (manual): Go-to-Definition, Find References in Extension Development Host
 */
const assert = require('assert');
const { importDist } = require('./lib/import-dist.cjs');
const { loadCanonicalFixture } = require('./lib/load-canonical-fixture.cjs');
const { assertNavigationSelfOracle } = require('./lib/assert-navigation.cjs');
const { walkConfigurationUriSites } = require('./lib/walk-configuration-uris.cjs');

const { UriIndex } = importDist('navigation/uriIndex');
const { findStringNodeAtOffset } = importDist('navigation/definitionProvider');

const { text, model, ast } = loadCanonicalFixture();
const index = new UriIndex();
index.build(model, ast);

assertNavigationSelfOracle(index, ast);

const badJson =
	'{"entityTypes":[{"uri":"configuration/entityTypes/A","label":"A","attributes":[{"uri":"configuration/entityTypes/A/attributes/X","type":"Reference","referencedEntityTypeURI":"configuration/entityTypes/Missing"}]}]}';
const { parseDocument } = importDist('parser/configParser');
const badDoc = parseDocument(badJson);
const badIndex = new UriIndex();
badIndex.build(badDoc.model, badDoc.ast);
assert.ok(badIndex.getAllUnresolved().length > 0, 'bad reference detected');

let sampled = 0;
walkConfigurationUriSites(ast, ({ uri, node, propertyKey }) => {
	if (propertyKey === 'uri' || sampled >= 5) {
		return;
	}
	const found = findStringNodeAtOffset(ast, node.offset + 1);
	assert.ok(found, `findStringNodeAtOffset for ${uri}`);
	sampled++;
});
assert.ok(sampled >= 1, 'sampled reference offsets');

console.log('test-editor-navigation: OK');
