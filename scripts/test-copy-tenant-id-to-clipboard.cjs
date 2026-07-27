#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: copy-tenant-id-to-clipboard
 * Tier A: tenantIdFromTreeContext duck-typing
 * Tier C (manual): context menu on reltio.tenant / reltio.tenant.l3, clipboard paste
 */
const assert = require('assert');
const { importDist } = require('./lib/import-dist.cjs');

const { tenantIdFromTreeContext } = importDist('util/tenantIdFromTreeContext');

assert.strictEqual(tenantIdFromTreeContext(undefined), undefined);
assert.strictEqual(tenantIdFromTreeContext({ tenantId: 'householddemo' }), 'householddemo');
assert.strictEqual(
	tenantIdFromTreeContext({ id: 'tenant:361.reltio.com/demo', label: 'ignored' }),
	'demo',
);
assert.strictEqual(
	tenantIdFromTreeContext({ contextValue: 'reltio.tenant', label: 'from-label' }),
	'from-label',
);
assert.strictEqual(
	tenantIdFromTreeContext({ contextValue: 'reltio.tenant.l3', label: { label: 'nested' } }),
	'nested',
);

console.log('test-copy-tenant-id-to-clipboard: OK');
