#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: workflow-adapter-url-registry
 *
 * Tier A — pure logic, no I/O, no VS Code host:
 *   1.  Label normalisation: scheme, case, trailing path and the three domain
 *       suffixes all reduce to the same label. `.cloud.reltio.com` must be
 *       stripped before `.reltio.com` or the label keeps a `.cloud` tail and
 *       silently misses.
 *   2.  Shared adapters: every environment on a shared row resolves to that
 *       row's host.
 *   3.  Dedicated adapters, including the irregular ones the naming-convention
 *       guess cannot reach (`-workflow-adapter`, and the `reltiocn.cn` domain).
 *   4.  Aliases: the parenthesised spellings in the source table resolve to the
 *       same host as their canonical name.
 *   5.  Ambiguity is reported, never resolved — an environment the source lists
 *       two ways must not silently pick one, because both hosts answer and a
 *       probe would confirm whichever was tried first.
 *   6.  No label resolves two different ways: the inverted index cannot contain
 *       a key that is also ambiguous, and no shared row may repeat an
 *       environment listed on another row.
 *   7.  Unknown environments return undefined, so the caller still falls through
 *       to the guess-then-prompt path.
 *   8.  Every bundled host is a bare hostname — no scheme, no path. The caller
 *       passes it through `toHttpsBase()`, which is what keeps the host
 *       allowlist the single choke point; a pre-schemed URL would invite a
 *       caller to skip that.
 *   9.  Prototype keys (`constructor`, `__proto__`) miss rather than returning
 *       an inherited member. The key comes from a workspace directory name.
 *  10.  The two `reltiocn.cn` hosts are refused by the default allowlist, and
 *       accepted once `reltio.trustedHostSuffixes` is extended — bundling a
 *       host must not grant it trust.
 *
 * Tier B — structural:
 *  11.  This script is registered in the runner's hardcoded SCRIPTS array.
 *
 * Tier C (manual) — documented in design.md's test plan.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');

const {
	lookupWorkflowAdapterUrl,
	environmentLabel,
	knownEnvironmentLabels,
} = importDist('workflow/workflowAdapterRegistry');

const { toHttpsBase, setTrustedHostSuffixes, UntrustedHostError } = importDist('api/reltioClient');

/** Assert a lookup resolves to exactly this host. */
function assertHost(environmentName, expectedHost) {
	const result = lookupWorkflowAdapterUrl(environmentName);
	assert.ok(result, `${environmentName} must be on the bundled table`);
	assert.strictEqual(result.kind, 'url', `${environmentName} must resolve unambiguously`);
	assert.strictEqual(result.host, expectedHost, `${environmentName} → ${expectedHost}`);
}

// ── 1. Label normalisation ──────────────────────────────────────────────────
{
	for (const spelling of [
		'na05-dev',
		'NA05-DEV',
		'na05-dev.reltio.com',
		'https://na05-dev.reltio.com',
		'https://na05-dev.reltio.com/',
		'  na05-dev.reltio.com  ',
	]) {
		assert.strictEqual(
			environmentLabel(spelling), 'na05-dev',
			`"${spelling}" must normalise to na05-dev`,
		);
	}

	// Longest-suffix-first: stripping `.reltio.com` before `.cloud.reltio.com`
	// would leave `demo-01.cloud`, which matches nothing and fails silently.
	assert.strictEqual(environmentLabel('demo-01.cloud.reltio.com'), 'demo-01');
	assert.strictEqual(environmentLabel('cn01-test.reltiocn.cn'), 'cn01-test');
}

// ── 2. Shared adapters ──────────────────────────────────────────────────────
{
	for (const env of ['dev', 'gus-training', 'mpe-03', 'test', 'test-usg']) {
		assertHost(env, 'test-workflow.reltio.com');
	}
	for (const env of ['361', 'r361', 'prod-usg']) {
		assertHost(env, 'prod-workflow.reltio.com');
	}
	for (const env of ['dev-h360', 'na02-test', 'test-h360']) {
		assertHost(env, 'test-h360-workflow.reltio.com');
	}
	for (const env of ['na02-prod', 'prod-h360']) {
		assertHost(env, 'prod-h360-workflow.reltio.com');
	}
	assertHost('gus-sales', 'sales-workflow.reltio.com');
	for (const env of ['eutst-01', 'idev-01', 'idev-02', 'tst-01', 'geu-tst-01']) {
		assertHost(env, 'tst-01-workflow.reltio.com');
	}
	for (const env of ['tst-01-ebf', 'tst-01-hf']) {
		assertHost(env, 'gtst-01-workflow.reltio.com');
	}

	// A shared adapter serves environments whose names share no prefix with it.
	// This is the case the `{env}-workflow` guess gets wrong every time, and the
	// reason the table exists at all.
	assert.notStrictEqual(
		lookupWorkflowAdapterUrl('gus-training').host, 'gus-training-workflow.reltio.com',
	);
}

// ── 3. Dedicated adapters ───────────────────────────────────────────────────
{
	// Regular `{label}-workflow.reltio.com` shape.
	for (const env of [
		'na05-prod', 'na07-test', 'na10-dev', 'na12-prod', 'na13-test',
		'eu02-dev', 'eu03-tst-01', 'mpe-02', 'gca-prod', 'guk-test',
		'gtst-01', 'gtst-01-ebf', 'na03-tst-01-ebf',
	]) {
		assertHost(env, `${env}-workflow.reltio.com`);
	}

	// `eutst-dr-01`/`tst-dr-01` are NOT regular-shape: the CSV shows they share
	// one adapter across two clusters (`SHARED_ADAPTERS`), confirmed in test 2b.
	// `na10-test`/`na10-prod` and the five other `na03-*-g` environments are NOT
	// regular-shape either — see the irregular-adapter assertions below.

	// Irregular: `-workflow-adapter` plus a different domain, or a host that
	// drops a suffix the environment label carries. None of these is reachable
	// by the naming-convention guess.
	assertHost('eprus-02-ssrv', 'eprus-02-ssrv-workflow-adapter.reltio.com');
	assertHost('epreu-01-ssrv', 'epreu-01-ssrv-workflow-adapter.reltio.com');
	assertHost('cn01-test', 'cn01-test-workflow-adapter.reltiocn.cn');
	assertHost('eprcnnw-01-ssrv', 'eprcnnw-01-ssrv-workflow-adapter.reltiocn.cn');

	// Confirmed against `workflow-adapter-urls.csv`: `-workflow-adapter` plus a
	// `customer-facing-na10` domain segment.
	assertHost('na10-test', 'na10-test-workflow-adapter.customer-facing-na10.reltio.com');
	assertHost('na10-prod', 'na10-prod-workflow-adapter.customer-facing-na10.reltio.com');

	// Confirmed against the CSV: the host drops the `-g` suffix the environment
	// label carries.
	assertHost('na03-test-g', 'na03-test-workflow.reltio.com');
	assertHost('na03-sales-g', 'na03-sales-workflow.reltio.com');
	assertHost('na03-prod-g', 'na03-prod-workflow.reltio.com');
	assertHost('na03-dev-g', 'na03-dev-workflow.reltio.com');
	assertHost('na03-tst-01-hf-g', 'na03-tst-01-hf-workflow.reltio.com');
	assertHost('na03-tst-01-g', 'na03-tst-01-workflow.reltio.com');
}

// ── 2b. A shared adapter confirmed by the CSV cross-check, not just the IRD ──
// `eutst-dr-01` looks like a solo dedicated adapter under the naming
// convention, but the CSV shows it shares `tst-dr-01`'s adapter across two
// Reltio clusters (`eks-iqa-us-01`, `eks-iqa-eu-01`).
{
	for (const env of ['tst-dr-01', 'eutst-dr-01']) {
		assertHost(env, 'tst-dr-01-workflow.reltio.com');
	}
}

// ── 4. Aliases ──────────────────────────────────────────────────────────────
{
	assertHost('ap-360', 'ap-360-workflow.reltio.com');
	assertHost('approd-01', 'ap-360-workflow.reltio.com');
	assert.strictEqual(environmentLabel('approd-01.reltio.com'), 'ap-360');
}

// ── 5. Ambiguity is reported, not resolved ──────────────────────────────────
// Only `eu-360` and `tst-04-hf` remain ambiguous. `mpe-01`, `geu-prod`,
// `geu-test` and `euprod-01` were ambiguous under the IRD source alone, but the
// CSV cross-check resolved them unambiguously (see test 5b) — `eu-360` has no
// corresponding CSV row, so it is the one member of that original group still
// unresolved.
{
	for (const env of ['eu-360', 'tst-04-hf']) {
		const result = lookupWorkflowAdapterUrl(env);
		assert.ok(result, `${env} must be recognised`);
		assert.strictEqual(result.kind, 'ambiguous', `${env} is listed two ways in the source table`);
		assert.ok(
			Array.isArray(result.candidates) && result.candidates.length >= 2,
			`${env} must offer both documented hosts`,
		);
		assert.strictEqual(result.host, undefined, 'an ambiguous result carries no single host');
	}

	// `tst-04-hf` appears under the shared gtst-01 adapter and as its own
	// dedicated one. Both must be offered rather than one being chosen.
	const tst04 = lookupWorkflowAdapterUrl('tst-04-hf');
	assert.ok(tst04.candidates.includes('tst-04-hf-workflow.reltio.com'));
	assert.ok(tst04.candidates.includes('gtst-01-workflow.reltio.com'));
}

// ── 5b. CSV cross-check resolved a transposed pair the IRD left ambiguous ───
{
	assertHost('mpe-01', 'eu-test-workflow.reltio.com');
	for (const env of ['geu-test', 'geu-prod', 'euprod-01']) {
		assertHost(env, 'mpe-01-workflow.reltio.com');
	}
}

// ── 6. No label resolves two ways ───────────────────────────────────────────
{
	const labels = knownEnvironmentLabels();
	const seen = new Set();
	for (const label of labels) {
		assert.ok(!seen.has(label), `"${label}" appears twice in the registry`);
		seen.add(label);
	}

	// Every label answers exactly one way, and an ambiguous label never also
	// carries a single host.
	for (const label of labels) {
		const result = lookupWorkflowAdapterUrl(label);
		assert.ok(result, `${label} must resolve`);
		const isUrl = result.kind === 'url';
		assert.strictEqual(
			isUrl ? typeof result.host : typeof result.candidates,
			isUrl ? 'string' : 'object',
			`${label} has a malformed result`,
		);
	}
}

// ── 7. Unknown environments fall through ────────────────────────────────────
{
	for (const env of ['not-a-real-env', 'acme-dev', '', 'reltio.com']) {
		assert.strictEqual(
			lookupWorkflowAdapterUrl(env), undefined,
			`"${env}" must fall through to the guess-then-prompt path`,
		);
	}
}

// ── 8. Bundled hosts are bare hostnames ─────────────────────────────────────
{
	for (const label of knownEnvironmentLabels()) {
		const result = lookupWorkflowAdapterUrl(label);
		const hosts = result.kind === 'url' ? [result.host] : result.candidates;
		for (const host of hosts) {
			assert.ok(!/^https?:\/\//i.test(host), `${label}: "${host}" must not carry a scheme`);
			assert.ok(!host.includes('/'), `${label}: "${host}" must be a bare host, no path`);
			assert.strictEqual(host, host.toLowerCase(), `${label}: "${host}" must be lowercase`);
		}
	}
}

// ── 9. A directory name cannot reach an inherited member ────────────────────
{
	for (const hostile of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
		assert.strictEqual(
			lookupWorkflowAdapterUrl(hostile), undefined,
			`"${hostile}" must miss rather than return an inherited member`,
		);
	}
}

// ── 10. Bundling a host grants it no trust ──────────────────────────────────
{
	// The China hosts are on the table so the user is told the right URL, and
	// still refused by the default allowlist until an operator opts in.
	setTrustedHostSuffixes(['reltio.com']);
	assert.throws(
		() => toHttpsBase('cn01-test-workflow-adapter.reltiocn.cn'),
		UntrustedHostError,
		'a bundled reltiocn.cn host must still fail the default allowlist',
	);

	setTrustedHostSuffixes(['reltio.com', 'reltiocn.cn']);
	assert.strictEqual(
		toHttpsBase('cn01-test-workflow-adapter.reltiocn.cn'),
		'https://cn01-test-workflow-adapter.reltiocn.cn',
		'extending the allowlist must be all it takes',
	);

	// Every reltio.com host on the table passes the default allowlist, so no
	// other entry is a dead end the user cannot reach.
	setTrustedHostSuffixes(['reltio.com']);
	for (const label of knownEnvironmentLabels()) {
		const result = lookupWorkflowAdapterUrl(label);
		const hosts = result.kind === 'url' ? [result.host] : result.candidates;
		for (const host of hosts) {
			if (!host.endsWith('.reltio.com')) continue;
			assert.strictEqual(toHttpsBase(host), `https://${host}`, `${host} must be usable as-is`);
		}
	}
}

// ── 11. Registered in the runner ────────────────────────────────────────────
{
	const runner = fs.readFileSync(path.join(__dirname, 'run-unit-tests.cjs'), 'utf8');
	assert.ok(
		runner.includes("'test-workflow-adapter-registry.cjs'"),
		'this script must be listed in run-unit-tests.cjs — the runner is not a glob',
	);
}

console.log('test-workflow-adapter-registry: OK');
