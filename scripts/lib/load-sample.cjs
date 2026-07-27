'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const samplesRoot = path.resolve(repoRoot, 'samples');

/** Known sample fixture paths relative to `samples/`. */
const SAMPLE_FILES = {
	example: 'example.reltio.json',
	r360: 'r360.reltio.json',
	ppl: 'ppl-example.reltio.json',
	tenantL3:
		'geu-tst-01.reltio.com.reltio.environment/householddemo.reltio.tenant/L3.reltio.json',
};

/**
 * Resolve a allowlisted sample key to an absolute path under `samples/`.
 * Rejects any resolved path that escapes the samples root (defense in depth).
 */
function resolveSamplePath(key) {
	const rel = SAMPLE_FILES[key];
	if (!rel) {
		throw new Error(`Unknown sample key: ${key}`);
	}
	if (path.isAbsolute(rel) || rel.includes('..')) {
		throw new Error(`Invalid sample relative path for key: ${key}`);
	}
	const candidate = path.resolve(samplesRoot, rel);
	const relative = path.relative(samplesRoot, candidate);
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error(`Sample path escapes samples root for key: ${key}`);
	}
	return candidate;
}

function loadSampleText(key) {
	return fs.readFileSync(resolveSamplePath(key), 'utf8');
}

function samplePath(key) {
	return resolveSamplePath(key);
}

module.exports = { loadSampleText, samplePath, samplesRoot, repoRoot, SAMPLE_FILES };
