#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: apply-tenant-configuration-action
 * Tier A: mutate temp copy of canonical text; jsonDeepEqual / drift guards
 * Tier C (manual): Apply with confirmation, diff, 401/400 — ARCHITECTURE.md apply verification
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');
const { loadCanonicalFixture } = require('./lib/load-canonical-fixture.cjs');

const { jsonDeepEqual } = importDist('util/jsonDeepEqual');
const {
	remoteMatchesBaseline,
	hasUnpublishedLocalChangesFromText,
	tryParseJson,
} = importDist('util/fetchConfigurationGuard');
const { parseDocument } = importDist('parser/configParser');

assert.strictEqual(jsonDeepEqual(null, null), true);
assert.strictEqual(jsonDeepEqual([1, { a: 2 }], [1, { a: 2 }]), true);
assert.strictEqual(remoteMatchesBaseline('{"v":1}', '{"v":1}'), true);
assert.strictEqual(remoteMatchesBaseline('not json', '{}'), false);
assert.ok(tryParseJson('{"ok":true}'));

const { text, model } = loadCanonicalFixture();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reltio-apply-test-'));
const tmpFile = path.join(tmpDir, 'L3.reltio.json');
fs.writeFileSync(tmpFile, text, 'utf8');

const baseline = fs.readFileSync(tmpFile, 'utf8');
assert.strictEqual(hasUnpublishedLocalChangesFromText(baseline, baseline), false);

const parsed = JSON.parse(baseline);
parsed.label = 'apply-test-mutation';
const mutated = JSON.stringify(parsed, null, 2);
fs.writeFileSync(tmpFile, mutated, 'utf8');

assert.strictEqual(hasUnpublishedLocalChangesFromText(mutated, baseline), true);
assert.strictEqual(remoteMatchesBaseline(mutated, baseline), false);

const reloaded = parseDocument(fs.readFileSync(tmpFile, 'utf8'));
assert.strictEqual(reloaded.errors.length, 0, 'mutated canonical copy still parses');
assert.strictEqual(reloaded.model.label, 'apply-test-mutation');

fs.rmSync(tmpDir, { recursive: true, force: true });

console.log('test-apply-tenant-configuration-action: OK');
