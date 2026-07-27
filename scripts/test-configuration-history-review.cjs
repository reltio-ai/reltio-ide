#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: configuration-history-review
 * Tier A: snapshot filename round-trip, labels, immediateOlderSnapshot
 * Tier C (manual): fetch history API, compare workflows — ARCHITECTURE.md configuration history
 */
const assert = require('assert');
const { importDist } = require('./lib/import-dist.cjs');
const vscode = require('./lib/vscode-stub.cjs');

const {
	historySnapshotFileName,
	tryParseHistorySnapshotName,
	formatHistoryTreeLabel,
	immediateOlderSnapshot,
} = importDist('workspace/configurationHistory');

const entry = { updatedBy: 'user@corp', timestamp: 1700000000000, configuration: {} };
const name = historySnapshotFileName(entry);
assert.ok(name.startsWith('L3-'), name);
assert.ok(name.endsWith('.reltio.json'));

const parsed = tryParseHistorySnapshotName(name);
assert.ok(parsed);
assert.strictEqual(parsed.timestampMs, 1700000000000);

const label = formatHistoryTreeLabel(1700000000000, 'user');
assert.match(label, /\d{2}-\d{2}-\d{4}/);

const newer = vscode.Uri.file('/h/L3-u---200.reltio.json');
const older = vscode.Uri.file('/h/L3-u---100.reltio.json');
const snaps = [
	{ fileUri: newer, timestampMs: 200, displayUser: 'u' },
	{ fileUri: older, timestampMs: 100, displayUser: 'u' },
];
assert.strictEqual(immediateOlderSnapshot(snaps, newer)?.fileUri.toString(), older.toString());
assert.strictEqual(immediateOlderSnapshot(snaps, older), undefined);

console.log('test-configuration-history-review: OK');
