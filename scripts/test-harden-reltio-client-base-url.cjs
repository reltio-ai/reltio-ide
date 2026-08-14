#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: harden-reltio-client-base-url
 * Tier A: toHttpsBase()'s host allowlist and forced-HTTPS behavior (RP-195041),
 *         exercised through every exported call helper, plus the
 *         setTrustedHostSuffixes() escape hatch.
 * Tier B: formatPutConfigurationFailureMessage() truncation is unchanged.
 * Tier C (manual): design.md Test plan — a real `*.reltio.environment` folder
 *         named after an untrusted host, and a legitimate non-reltio.com env.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');

const {
	validateEnvironment,
	listTenants,
	fetchL3Configuration,
	putL3Configuration,
	searchEntities,
	countEntities,
	fetchConfigurationHistory,
	setTrustedHostSuffixes,
	UntrustedHostError,
} = importDist('api/reltioClient');

/** Install a fake `fetch`, capture the call, restore afterwards. */
async function withFetch(responder, fn) {
	const original = globalThis.fetch;
	const calls = [];
	globalThis.fetch = async (url, init) => {
		calls.push({ url: String(url), init });
		return responder(String(url), init);
	};
	try {
		return { result: await fn(), calls };
	} finally {
		globalThis.fetch = original;
	}
}

function jsonResponse(status, body) {
	return {
		status,
		ok: status >= 200 && status < 300,
		json: async () => body,
		text: async () => JSON.stringify(body),
	};
}

/**
 * Every exported helper that resolves a base URL and is expected to throw/reject
 * for an untrusted host, paired with a minimal invocation. `validateEnvironment`
 * is deliberately excluded — see test 8: it never throws, by design.
 */
function callHelpers(host) {
	return [
		['listTenants', () => listTenants(host, 'tok')],
		['fetchL3Configuration', () => fetchL3Configuration(host, 'tenantAlpha', 'tok')],
		['fetchConfigurationHistory', () => fetchConfigurationHistory(host, 'tenantAlpha', 'tok', 0, 10)],
		[
			'searchEntities',
			() => searchEntities(host, 'tenantAlpha', 'tok', { filter: 'equals(type,"x")', max: 10, offset: 0 }),
		],
		['countEntities', () => countEntities(host, 'tenantAlpha', 'tok', 'equals(type,"x")')],
		[
			'putL3Configuration',
			() => putL3Configuration(host, 'tenantAlpha', 'tok', JSON.stringify({ entityTypes: [] })),
		],
	];
}

(async () => {
	setTrustedHostSuffixes(['reltio.com']);

	// 1. Trusted host, including a multi-label subdomain, is accepted.
	for (const host of ['test.reltio.com', 'na-dev-1.cloud.reltio.com', 'reltio.com']) {
		const { calls } = await withFetch(
			() => jsonResponse(200, []),
			() => listTenants(host, 'tok'),
		);
		assert.strictEqual(calls.length, 1, `expected a request to be sent for trusted host ${host}`);
		assert.ok(
			calls[0].url.startsWith(`https://${host}/`),
			`expected request to ${host}, got ${calls[0].url}`,
		);
	}

	// 2. Untrusted host is rejected before fetch is ever called, for every helper.
	for (const [name, invoke] of callHelpers('evil.com')) {
		const { calls } = await withFetch(() => jsonResponse(200, {}), async () => {
			await assert.rejects(
				invoke,
				e => e instanceof UntrustedHostError,
				`${name}: expected UntrustedHostError for untrusted host`,
			);
		});
		assert.strictEqual(calls.length, 0, `${name}: must not call fetch for an untrusted host`);
	}

	// 3. Lookalike hosts are rejected, not treated as reltio.com subdomains.
	for (const host of ['notreltio.com', 'reltio.com.evil.com', 'evilreltio.com']) {
		await assert.rejects(
			() => withFetch(() => jsonResponse(200, {}), () => listTenants(host, 'tok')),
			e => e instanceof UntrustedHostError,
			`expected ${host} to be rejected as a lookalike`,
		);
	}

	// 4. Explicit http:// is upgraded to https://, and the allowlist still applies.
	{
		const { calls } = await withFetch(
			() => jsonResponse(200, []),
			() => listTenants('http://test.reltio.com', 'tok'),
		);
		assert.strictEqual(calls.length, 1);
		assert.ok(
			calls[0].url.startsWith('https://test.reltio.com/'),
			`expected the request to go out over https, got ${calls[0].url}`,
		);
	}
	await assert.rejects(
		() => withFetch(() => jsonResponse(200, {}), () => listTenants('http://evil.com', 'tok')),
		e => e instanceof UntrustedHostError,
		'http:// must not bypass the allowlist',
	);

	// 5. setTrustedHostSuffixes() extends the allowlist, and a later call can restore the default.
	setTrustedHostSuffixes(['example.internal']);
	{
		const { calls } = await withFetch(
			() => jsonResponse(200, []),
			() => listTenants('lab.example.internal', 'tok'),
		);
		assert.strictEqual(calls.length, 1, 'expected the configured suffix to be trusted');
	}
	await assert.rejects(
		() => withFetch(() => jsonResponse(200, {}), () => listTenants('test.reltio.com', 'tok')),
		e => e instanceof UntrustedHostError,
		'reltio.com must not be trusted once the allowlist has been replaced',
	);
	setTrustedHostSuffixes(['reltio.com']);
	{
		const { calls } = await withFetch(
			() => jsonResponse(200, []),
			() => listTenants('test.reltio.com', 'tok'),
		);
		assert.strictEqual(calls.length, 1, 'expected reltio.com to be trusted again after resetting');
	}

	// 6. A malformed base URL is rejected with a clear error, not an unhandled exception.
	for (const host of ['', '   ', 'https://', 'not a url at all ://']) {
		await assert.rejects(
			() => withFetch(() => jsonResponse(200, {}), () => listTenants(host, 'tok')),
			e => e instanceof UntrustedHostError || e instanceof Error,
			`expected a clear rejection for malformed host ${JSON.stringify(host)}`,
		);
	}

	// 7. formatPutConfigurationFailureMessage still truncates long bodies at 12,000 chars
	//    (behavior-preserving regression check via the putL3Configuration failure path).
	{
		const longBody = 'x'.repeat(20_000);
		await assert.rejects(
			() =>
				withFetch(
					() => ({ status: 400, ok: false, text: async () => longBody }),
					() => putL3Configuration('test.reltio.com', 'tenantAlpha', 'tok', '{}'),
				),
			e => {
				assert.ok(e.message.length <= 12_001, `expected truncated message, got ${e.message.length} chars`);
				assert.ok(e.message.endsWith('…'), 'expected the truncation ellipsis');
				return true;
			},
		);
	}

	// 8. validateEnvironment() must never throw/reject — its callers (setup wizard,
	//    reltio.addEnvironment) rely on a plain boolean to clear a busy/progress
	//    state; an unhandled rejection here would hang that UI instead of showing
	//    "could not reach" (regression check for the toHttpsBase() rewrite).
	{
		const { result, calls } = await withFetch(
			() => jsonResponse(200, {}),
			() => validateEnvironment('evil.com'),
		);
		assert.strictEqual(result, false, 'untrusted host must resolve to false, not throw');
		assert.strictEqual(calls.length, 0, 'must not call fetch for an untrusted host');
	}
	{
		const { result } = await withFetch(
			() => ({ status: 200, ok: true, text: async () => '' }),
			() => validateEnvironment('test.reltio.com'),
		);
		assert.strictEqual(result, true, 'trusted, reachable host must still resolve to true');
	}

	// 9. reltio.trustedHostSuffixes must be application-scoped, so a workspace's own
	//    .vscode/settings.json cannot extend its own credential-trust boundary —
	//    trusted or not (regression check; this is the actual security boundary,
	//    since the setting is how an admin is meant to opt in, not how a repo can).
	{
		const pkgPath = path.join(__dirname, '..', 'package.json');
		const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
		const setting = pkg.contributes.configuration.properties['reltio.trustedHostSuffixes'];
		assert.ok(setting, 'reltio.trustedHostSuffixes must be declared in package.json');
		assert.strictEqual(
			setting.scope,
			'application',
			'reltio.trustedHostSuffixes must be scope "application" (User-settings only), ' +
				'otherwise a workspace can set it via .vscode/settings.json and defeat the allowlist',
		);
	}

	console.log('test-harden-reltio-client-base-url: OK');
})().catch(e => {
	console.error(e);
	process.exit(1);
});
