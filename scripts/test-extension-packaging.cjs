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

console.log('test-extension-packaging: OK');
