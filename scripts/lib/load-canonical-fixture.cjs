'use strict';

const fs = require('fs');
const path = require('path');
const { importDist } = require('./import-dist.cjs');

const repoRoot = path.join(__dirname, '..', '..');
const canonicalPath = path.join(repoRoot, 'samples', 'first-test.json');

let cached;

function loadCanonicalFixture() {
	if (cached) {
		return cached;
	}
	const text = fs.readFileSync(canonicalPath, 'utf8');
	const { parseDocument } = importDist('parser/configParser');
	const doc = parseDocument(text);
	cached = { text, path: canonicalPath, ...doc };
	return cached;
}

function resetCanonicalFixtureCache() {
	cached = undefined;
}

module.exports = {
	loadCanonicalFixture,
	resetCanonicalFixtureCache,
	canonicalPath,
	repoRoot,
};
