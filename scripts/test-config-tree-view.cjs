#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: config-tree-view
 * Tier A: full tree walk on canonical fixture; jsonPath resolution
 * Tier C (manual): tree expand/collapse, context menu when clauses
 */
const { importDist } = require('./lib/import-dist.cjs');
const { loadCanonicalFixture } = require('./lib/load-canonical-fixture.cjs');
const { assertTreeWalkSelfOracle } = require('./lib/assert-tree-walk.cjs');

const { findNodeAtPath } = importDist('parser/configParser');
const { getConfigRootChildren, getConfigNodeChildren } = importDist('tree/configSubtree');
const { UriIndex } = importDist('navigation/uriIndex');

const { model, ast } = loadCanonicalFixture();
const index = new UriIndex();
index.build(model, ast);

assertTreeWalkSelfOracle(
	model,
	ast,
	findNodeAtPath,
	getConfigRootChildren,
	getConfigNodeChildren,
	index,
);

console.log('test-config-tree-view: OK');
