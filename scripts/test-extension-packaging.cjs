#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: extension-packaging
 * Tier B: package.json contributes, .vscodeignore allows dist and resources
 * Tier C (manual): npm run package produces installable VSIX
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { repoRoot } = require('./lib/load-sample.cjs');

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
assert.ok(pkg.main?.includes('dist/extension'), 'main points to bundle');
assert.ok(pkg.engines?.vscode, 'vscode engine');
assert.ok(Array.isArray(pkg.contributes?.commands) && pkg.contributes.commands.length > 0);

const ignore = fs.readFileSync(path.join(repoRoot, '.vscodeignore'), 'utf8');
assert.ok(ignore.includes('!dist/**'), 'dist whitelisted for VSIX');

// Every webview bundle must be built by `npm run build`.
//
// This is the one packaging mistake that survives review and every other test:
// a panel whose script is missing loads, renders nothing, and reports no error,
// so the feature looks broken rather than unbuilt. `build` is a chain of
// sub-scripts, and adding a webview means adding a link to it — two separate
// edits with nothing tying them together.
for (const target of ['build:ext', 'build:webview', 'build:bpmnview']) {
	assert.ok(pkg.scripts[target], `${target} must exist`);
	assert.ok(
		pkg.scripts.build.includes(target),
		`npm run build must invoke ${target}, or the VSIX ships without its output`,
	);
}

// Each webview target must also copy its stylesheet; esbuild bundles the script
// only, so a CSS file is carried by an explicit copy that is easy to omit.
for (const target of ['build:webview', 'build:bpmnview']) {
	assert.ok(
		pkg.scripts[target].includes('.css'),
		`${target} must copy its stylesheet into dist/`,
	);
}

console.log('test-extension-packaging: OK');
