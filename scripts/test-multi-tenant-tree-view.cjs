#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: multi-tenant-tree-view
 * Tier A: pathTenantLoc, historyExposedStorageKey, fetch guard, tenantIdFromTreeContext
 * Tier C (manual): environment validate API, fetch L3 overwrite modal — ARCHITECTURE.md manual verification
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');
const { samplePath } = require('./lib/load-sample.cjs');

/**
 * Read the provider's TypeScript source.
 *
 * Storage choice is not observable through the compiled module's public
 * surface — both a `Map` and `workspaceState` satisfy every behavioural
 * assertion until a window is reloaded, which a CLI test cannot do. Reading the
 * source is the only way to pin it.
 */
function readProviderSource() {
	return fs.readFileSync(
		path.join(__dirname, '..', 'src', 'tree', 'multiTenantTreeProvider.ts'),
		'utf8',
	);
}

/**
 * The body of a class method, from its signature to the closing brace at method
 * indentation (one tab). Brace-counting would be more general; this file is tab
 * indented throughout, so the closing delimiter is unambiguous.
 */
function methodBody(source, methodName) {
	const start = source.indexOf(`\t${methodName}(`);
	assert.ok(start !== -1, `${methodName}() must exist in multiTenantTreeProvider.ts`);
	const end = source.indexOf('\n\t}', start);
	assert.ok(end !== -1, `${methodName}() must be terminated`);
	return source.slice(start, end);
}

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

// The History folder marker is session-scoped, not persisted.
//
// It exists so a fetch that legitimately returns zero rows still shows the
// folder — otherwise the command looks like it did nothing. Persisting it in
// `workspaceState` made that courtesy permanent: an empty History folder came
// back on every later window and on reconnecting the same tenant, with nothing
// in it and no way to dismiss it. These assertions pin the storage choice,
// because the regression is invisible until a window reload.
{
	const source = readProviderSource();
	assert.ok(
		/historyExposedThisSession\s*=\s*new Set/.test(source),
		'the exposed marker must live in an in-memory Set, not workspaceState',
	);
	assert.ok(
		!/workspaceState\.update\(\s*historyExposedStorageKey/.test(source),
		'the exposed marker must never be written to workspaceState — it would outlive the fetch',
	);
	assert.ok(
		!/workspaceState\.get<boolean>\(\s*historyExposedStorageKey/.test(source),
		'the exposed marker must not be read back from workspaceState',
	);

	// A removed tenant or environment must not leave a marker that decides what
	// a re-added one shows — the same reasoning as evicting the workflow cache.
	for (const method of ['removeTenant', 'removeEnvironment']) {
		assert.ok(
			methodBody(source, method).includes('historyExposedThisSession.delete'),
			`${method} must clear the marker, or a re-added tenant inherits it`,
		);
	}
}

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
