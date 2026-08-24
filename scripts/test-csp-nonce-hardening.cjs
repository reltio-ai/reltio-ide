#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: csp-nonce-hardening
 * Tier A: getNonce() in both webview panels uses a CSPRNG, not Math.random().
 * Tier C (manual): open the Ontology preview and an Entity Detail panel, confirm both render
 *         (a malformed nonce would break the page's CSP and block the inline script/style).
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { repoRoot } = require('./lib/load-sample.cjs');

const files = [
	path.join(repoRoot, 'src', 'ontology', 'ontologyPanel.ts'),
	path.join(repoRoot, 'src', 'entityBrowser', 'entityDetailPanel.ts'),
];

for (const file of files) {
	const source = fs.readFileSync(file, 'utf8');
	assert.ok(
		!/Math\.random/.test(source),
		`${path.basename(file)} must not use Math.random() anywhere (getNonce is the only expected caller)`,
	);
	assert.ok(
		/import \* as crypto from 'crypto'/.test(source),
		`${path.basename(file)} must import the crypto module`,
	);
	assert.ok(
		/crypto\.randomBytes\(16\)\.toString\('hex'\)/.test(source),
		`${path.basename(file)} must derive its nonce from crypto.randomBytes(16).toString('hex')`,
	);
}

// The same call, run directly, produces a value that's safe to interpolate into both a
// CSP header (`nonce-<value>`) and an HTML attribute (`nonce="<value>"`) unescaped: a fixed
// 32-character lowercase-hex string, matching the previous implementation's length exactly.
const sample = crypto.randomBytes(16).toString('hex');
assert.ok(/^[0-9a-f]{32}$/.test(sample), `expected a 32-char lowercase-hex nonce, got: ${sample}`);

const a = crypto.randomBytes(16).toString('hex');
const b = crypto.randomBytes(16).toString('hex');
assert.notStrictEqual(a, b, 'two consecutive nonces must not collide');

console.log('test-csp-nonce-hardening: OK');
