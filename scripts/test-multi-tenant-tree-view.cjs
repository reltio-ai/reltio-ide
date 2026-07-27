#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: multi-tenant-tree-view
 * Tier A: pathTenantLoc, historyExposedStorageKey, fetch guard, tenantIdFromTreeContext
 * Tier C (manual): environment validate API, fetch L3 overwrite modal — ARCHITECTURE.md manual verification
 */
const assert = require('assert');
const { importDist } = require('./lib/import-dist.cjs');
const { samplePath } = require('./lib/load-sample.cjs');

const { pathTenantLocFromL3Path } = importDist('util/pathTenantLoc');
const { historyExposedStorageKey } = importDist('tree/multiTenantTreeProvider');
const {
	hasUnpublishedLocalChangesFromText,
	remoteMatchesBaseline,
} = importDist('util/fetchConfigurationGuard');
const { tenantIdFromTreeContext } = importDist('util/tenantIdFromTreeContext');
const { jsonDeepEqual } = importDist('util/jsonDeepEqual');

const loc = pathTenantLocFromL3Path(samplePath('tenantL3'));
assert.ok(loc);
assert.strictEqual(loc.tenantId, 'householddemo');
assert.ok(loc.environmentName.includes('geu-tst-01'));

assert.strictEqual(
	historyExposedStorageKey('env', 'tid'),
	'reltio.history.exposed::env::tid',
);

assert.strictEqual(hasUnpublishedLocalChangesFromText('{"a":1}', undefined), true);
assert.strictEqual(hasUnpublishedLocalChangesFromText('{"a":1}', '{"a":1}'), false);
assert.strictEqual(hasUnpublishedLocalChangesFromText('{"a":2}', '{"a":1}'), true);

assert.strictEqual(remoteMatchesBaseline('{"x":1}', '{"x":1}'), true);
assert.strictEqual(remoteMatchesBaseline('{"x":1}', '{"x":2}'), false);

assert.strictEqual(tenantIdFromTreeContext({ tenantId: 'abc' }), 'abc');
assert.strictEqual(tenantIdFromTreeContext({ id: 'tenant:env/tenant1', contextValue: 'reltio.tenant' }), 'tenant1');
assert.strictEqual(tenantIdFromTreeContext({ contextValue: 'reltio.tenant.l3', label: 'mytenant' }), 'mytenant');

assert.strictEqual(jsonDeepEqual({ a: [1, 2] }, { a: [1, 2] }), true);
assert.strictEqual(jsonDeepEqual({ a: 1 }, { a: 2 }), false);

console.log('test-multi-tenant-tree-view: OK');
