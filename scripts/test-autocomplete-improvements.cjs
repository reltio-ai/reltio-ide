#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: autocomplete-improvements
 * Tier A: walk scoped nodes on canonical fixture; filter rules (no hardcoded URI lists)
 * Tier C (manual): Ctrl+Space URI completion in L3 — ARCHITECTURE.md manual QA
 */
const assert = require('assert');
const { importDist } = require('./lib/import-dist.cjs');
const { loadCanonicalFixture } = require('./lib/load-canonical-fixture.cjs');
const { assertCompletionScopeSelfOracle } = require('./lib/assert-completion-scopes.cjs');

const { getUriCompletionScope } = importDist('navigation/uriPropertyScopes');
const { filterDefinitionUris } = importDist('navigation/uriCompletionFilter');
const { collectStringValuesForPropertyName } = importDist('navigation/samePropertyValues');
const { UriIndex } = importDist('navigation/uriIndex');

assert.strictEqual(getUriCompletionScope('referencedEntityTypeURI'), 'entityType');
assert.strictEqual(getUriCompletionScope('outputMappingRef'), 'cleanseMapping');
assert.strictEqual(getUriCompletionScope('notARealKey'), undefined);

const { ast, model } = loadCanonicalFixture();
const index = new UriIndex();
index.build(model, ast);
const allDefs = index.getAllDefinitionUris();

assertCompletionScopeSelfOracle(ast, getUriCompletionScope, filterDefinitionUris, allDefs);

const uriValues = collectStringValuesForPropertyName(ast, 'uri');
assert.ok(uriValues.size >= allDefs.length / 2, 'uri property values collected from canonical AST');

console.log('test-autocomplete-improvements: OK');
