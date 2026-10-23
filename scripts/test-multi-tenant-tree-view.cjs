#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: multi-tenant-tree-view
 * Tier A: pathTenantLoc, historyExposedStorageKey, fetch guard, tenantIdFromTreeContext
 * Tier C (manual): environment validate API, fetch L3 overwrite modal — ARCHITECTURE.md manual verification
 *
 * Added in the security/code-quality review pass: the `beginWorkflowFetch()`/`mark*()` fetch-
 * generation guard on `MultiTenantTreeProvider` — a later-started fetch must win over an earlier
 * one that happens to resolve after it, for all four workflow-cache halves.
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
const { historyExposedStorageKey, MultiTenantTreeProvider } = importDist('tree/multiTenantTreeProvider');
const { TokenStore } = importDist('api/tokenStore');
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

// Fetch-generation guard: a later-started fetch must win regardless of resolution order
// (security/code-quality review pass). `environmentManager` can be `null` here — none of the
// `mark*`/getter methods exercised below touch it.
{
	const memento = { get: () => undefined, update: async () => undefined };
	const provider = new MultiTenantTreeProvider(null, new TokenStore(), memento, null);
	const env = 'env1';
	const tenant = 'tenantA';

	// markProcessDefinitionsLoaded: an older fetch resolving after a newer one must not win.
	{
		const genOld = provider.beginWorkflowFetch('processDefinitions', env, tenant);
		const genNew = provider.beginWorkflowFetch('processDefinitions', env, tenant);
		assert.notStrictEqual(genOld, genNew, 'each beginWorkflowFetch() call must claim a distinct generation');

		// The newer, later-started fetch resolves first...
		provider.markProcessDefinitionsLoaded(env, tenant, [{ type: 'new-def' }], genNew);
		assert.deepStrictEqual(provider.getCachedProcessDefinitions(env, tenant).map(d => d.type), ['new-def']);

		// ...then the older, slower fetch resolves after it — its stale result must be dropped.
		provider.markProcessDefinitionsLoaded(env, tenant, [{ type: 'old-def' }], genOld);
		assert.deepStrictEqual(
			provider.getCachedProcessDefinitions(env, tenant).map(d => d.type),
			['new-def'],
			'a fetch that started before the currently-cached one must not overwrite its result',
		);
	}

	// markJarDeploymentsLoaded: same guard, independent of the process-definitions one above.
	{
		const genOld = provider.beginWorkflowFetch('jarDeployments', env, tenant);
		const genNew = provider.beginWorkflowFetch('jarDeployments', env, tenant);
		provider.markJarDeploymentsLoaded(env, tenant, [{ module: 'new.jar' }], undefined, genNew);
		provider.markJarDeploymentsLoaded(env, tenant, [{ module: 'old.jar' }], undefined, genOld);
		assert.deepStrictEqual(
			provider.getCachedJarDeployments(env, tenant).map(j => j.module),
			['new.jar'],
			'markJarDeploymentsLoaded must drop a result from a fetch older than the one already applied',
		);
	}

	// markWorkflowsLoaded: same guard, on the combined fetch.
	{
		const genOld = provider.beginWorkflowFetch('workflows', env, tenant);
		const genNew = provider.beginWorkflowFetch('workflows', env, tenant);
		provider.markWorkflowsLoaded(env, tenant, [{ type: 'new-def' }], [{ module: 'new.jar' }], undefined, genNew);
		provider.markWorkflowsLoaded(env, tenant, [{ type: 'old-def' }], [{ module: 'old.jar' }], undefined, genOld);
		assert.deepStrictEqual(provider.getCachedProcessDefinitions(env, tenant).map(d => d.type), ['new-def']);
		assert.deepStrictEqual(provider.getCachedJarDeployments(env, tenant).map(j => j.module), ['new.jar']);
	}

	// markWorkflowRepoSync: same guard, keyed independently per tenant+kind.
	{
		const genOld = provider.beginWorkflowFetch('repoSync', env, tenant);
		const genNew = provider.beginWorkflowFetch('repoSync', env, tenant);
		provider.markWorkflowRepoSync(env, tenant, 2, new Map(), [], [], genNew);
		provider.markWorkflowRepoSync(env, tenant, 99, new Map(), [], [], genOld);
		assert.strictEqual(
			provider.getCachedWorkflowRepoTrackedCount(env, tenant),
			2,
			'markWorkflowRepoSync must drop a result from a fetch older than the one already applied',
		);
	}

	// A call made without a generation (the pre-existing call shape) is never guarded — this is
	// what keeps any caller that has no concurrency concern free to ignore the parameter entirely.
	{
		const other = 'tenantB';
		provider.markProcessDefinitionsLoaded(env, other, [{ type: 'a' }]);
		provider.markProcessDefinitionsLoaded(env, other, [{ type: 'b' }]);
		assert.deepStrictEqual(provider.getCachedProcessDefinitions(env, other).map(d => d.type), ['b']);
	}
}

console.log('test-multi-tenant-tree-view: OK');
