#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: setup-ux-redesign
 * Tier A: deriveUxState scenarios, l3FileUri
 * Tier C (manual): setup wizard QuickPick, status bar, walkthrough — openspec/changes/setup-ux-redesign/
 */
const assert = require('assert');
const { importDist } = require('./lib/import-dist.cjs');

const { deriveUxState, l3FileUri } = importDist('ux/uxState');

assert.strictEqual(l3FileUri('361', 'demo'), '361.reltio.environment/demo.reltio.tenant/L3.reltio.json');

(async () => {
	const empty = await deriveUxState({
		environments: [],
		hasToken: () => false,
		hasOAuthClient: async () => false,
		openedL3Files: new Set(),
	});
	assert.strictEqual(empty.global, 'G_EMPTY');

	const needsAuth = await deriveUxState({
		environments: [{ name: 'e1', tenants: [] }],
		hasToken: () => false,
		hasOAuthClient: async () => false,
		openedL3Files: new Set(),
	});
	assert.strictEqual(needsAuth.global, 'G_NEEDS_AUTH');

	const authedNoTenants = await deriveUxState({
		environments: [{ name: 'e1', tenants: [] }],
		hasToken: () => true,
		hasOAuthClient: async () => false,
		openedL3Files: new Set(),
	});
	assert.strictEqual(authedNoTenants.perEnv.get('e1'), 'E_AUTHED_NO_TENANTS');

	const withTenantNoL3 = await deriveUxState({
		environments: [{ name: 'e1', tenants: [{ tenantId: 't1', hasL3: false }] }],
		hasToken: () => true,
		hasOAuthClient: async () => false,
		openedL3Files: new Set(),
	});
	assert.strictEqual(withTenantNoL3.global, 'G_NEEDS_L3');
	assert.strictEqual(withTenantNoL3.perTenant.get('e1/t1'), 'T_NO_L3');

	const l3Key = l3FileUri('e1', 't1');
	const ready = await deriveUxState({
		environments: [{ name: 'e1', tenants: [{ tenantId: 't1', hasL3: true }] }],
		hasToken: () => true,
		hasOAuthClient: async () => false,
		openedL3Files: new Set([l3Key]),
	});
	assert.strictEqual(ready.global, 'G_READY');
	assert.strictEqual(ready.perTenant.get('e1/t1'), 'T_READY');

	console.log('test-setup-ux-redesign: OK');
})().catch(err => {
	console.error(err);
	process.exit(1);
});
