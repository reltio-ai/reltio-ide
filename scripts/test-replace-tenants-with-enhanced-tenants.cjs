#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: replace-tenants-with-enhanced-tenants
 * Tier A: listTenants URL/method/headers, record→tenantId mapping, malformed-response
 *         rejection, status-code handling; xxx-client still sent on other calls
 * Tier B: no source file outside fixtures references the retired /reltio/tenants list;
 *         the per-tenant GET /reltio/tenants/{tenantId} (RDM discovery) is the one exception
 * Tier C (manual): design.md Test plan: setup wizard and Add Tenant against a live
 *         external environment; the 403 reproduction needs an affected user's tenant
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');

const { listTenants, fetchL3Configuration, ReltioApiError } = importDist('api/reltioClient');

const repoRoot = path.join(__dirname, '..');
const HOST = 'na-dev-1.cloud.reltio.com';

/**
 * Synthetic stand-in for a `GET /reltio/enhancedTenants` body. Shape mirrors the
 * live response; ids and names are invented so no customer data is committed.
 */
const SAMPLE_RECORDS = [
	{ tenantId: 'tenantAlpha', tenantName: 'tenantAlpha-AcmeOne-INTERNAL', customerName: 'AcmeOne' },
	{ tenantId: 'tenantBravo', tenantName: 'tenantBravo-AcmeTwo-INTERNAL', customerName: 'AcmeTwo' },
	{ tenantId: 'tenantCharlie', tenantName: 'tenantCharlie-AcmeTwo-INTERNAL', customerName: 'AcmeTwo' },
];

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

(async () => {
	// 1 + 2. URL, query, method, and absence of the xxx-client header.
	{
		const { result, calls } = await withFetch(
			() => jsonResponse(200, SAMPLE_RECORDS),
			() => listTenants(HOST, 'tok-1'),
		);
		assert.strictEqual(calls.length, 1, 'expected exactly one request');
		const { url, init } = calls[0];
		assert.strictEqual(
			url,
			`https://${HOST}/reltio/enhancedTenants?showAll=true`,
			`unexpected tenant listing URL: ${url}`,
		);
		assert.strictEqual(init.method, 'GET', 'endpoint is GET-only, POST answers HTTP 500');
		assert.strictEqual(init.body, undefined, 'no request body on a GET');
		const headerNames = Object.keys(init.headers).map(h => h.toLowerCase());
		assert.ok(!headerNames.includes('xxx-client'), 'xxx-client must not be sent on the tenant call');
		assert.strictEqual(init.headers.Authorization, 'Bearer tok-1');

		// 3. Records reduce to tenantId, response order preserved.
		assert.deepStrictEqual(result, ['tenantAlpha', 'tenantBravo', 'tenantCharlie']);
	}

	// 2 (cont). Other endpoints still identify the client.
	{
		const { calls } = await withFetch(
			() => ({ status: 200, ok: true, text: async () => '{}' }),
			() => fetchL3Configuration(HOST, 'tenantAlpha', 'tok-1'),
		);
		const headerNames = Object.keys(calls[0].init.headers).map(h => h.toLowerCase());
		assert.ok(headerNames.includes('xxx-client'), 'xxx-client must remain on the L3 call');
	}

	// 4. Malformed rows are rejected rather than yielding undefined picker entries.
	const badBodies = [
		[{ tenantName: 'no-id-here', customerName: 'AcmeOne' }],
		[{ tenantId: '', tenantName: 'empty', customerName: 'AcmeOne' }],
		[{ tenantId: 42, tenantName: 'not-a-string', customerName: 'AcmeOne' }],
		[null],
		['tenantAlpha'],
	];
	for (const body of badBodies) {
		await assert.rejects(
			() => withFetch(() => jsonResponse(200, body), () => listTenants(HOST, 'tok-1')),
			e => e instanceof ReltioApiError,
			`expected ReltioApiError for body ${JSON.stringify(body)}`,
		);
	}

	// 5. A non-array body is rejected.
	await assert.rejects(
		() => withFetch(() => jsonResponse(200, { tenants: SAMPLE_RECORDS }), () => listTenants(HOST, 'tok-1')),
		e => e instanceof ReltioApiError && /expected JSON array/.test(e.message),
	);

	// 6. Status-code handling: 401 keeps its own path so handle401 still fires.
	await assert.rejects(
		() => withFetch(() => jsonResponse(401, {}), () => listTenants(HOST, 'tok-1')),
		e => e instanceof ReltioApiError && e.statusCode === 401,
	);
	for (const status of [403, 404, 500]) {
		await assert.rejects(
			() => withFetch(() => jsonResponse(status, {}), () => listTenants(HOST, 'tok-1')),
			e => e instanceof ReltioApiError && e.statusCode === status && e.message.includes(String(status)),
			`expected ReltioApiError carrying HTTP ${status}`,
		);
	}

	// An empty tenant list is valid, not an error.
	{
		const { result } = await withFetch(() => jsonResponse(200, []), () => listTenants(HOST, 'tok-1'));
		assert.deepStrictEqual(result, []);
	}

	// 7. Tier B: the retired tenant list is gone from shipped source.
	//
	// Only the list (`/reltio/tenants`, optionally with a query) is retired. The per-tenant
	// `GET /reltio/tenants/{tenantId}` is a different endpoint: the tenant physical configuration,
	// the only place RDM's service URI and tenant ids are found. It is allowed in exactly one
	// caller, fetchTenantPhysicalConfiguration, so a new use of the family still fails here.
	{
		const listOffenders = [];
		const perTenantCallers = [];
		const walk = dir => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					walk(full);
				} else if (/\.ts$/.test(entry.name)) {
					const text = fs.readFileSync(full, 'utf8');
					const rel = path.relative(repoRoot, full).split(path.sep).join('/');
					if (/\/reltio\/tenants(?![\w/])/.test(text)) {
						listOffenders.push(rel);
					}
					for (const m of text.matchAll(/`\$\{root\}\/reltio\/tenants\//g)) {
						perTenantCallers.push(rel);
					}
				}
			}
		};
		walk(path.join(repoRoot, 'src'));
		assert.deepStrictEqual(listOffenders, [], `src still references the retired /reltio/tenants list: ${listOffenders.join(', ')}`);
		assert.deepStrictEqual(
			perTenantCallers,
			['src/api/reltioClient.ts'],
			'GET /reltio/tenants/{tenantId} is built in exactly one place, fetchTenantPhysicalConfiguration',
		);
	}

	console.log('test-replace-tenants-with-enhanced-tenants: OK');
})().catch(e => {
	console.error(e);
	process.exit(1);
});
