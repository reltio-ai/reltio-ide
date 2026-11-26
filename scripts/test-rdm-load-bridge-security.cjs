#!/usr/bin/env node
'use strict';
/**
 * Area: RDM (src/rdm/lookupLoadBridge.ts) and Common Utils (the RDM functions and toHttpsBase in
 * src/api/reltioClient.ts).
 *
 * Security checks for the agent-facing CSV load bridge and the RDM client functions it calls.
 * The base gates (plan never posts, a cancelled load posts nothing, CSV errors stop a load, ".."
 * and outside paths refused, no token in bridge results with injected functions) are in
 * test-rdm-lookup-csv-load.cjs; this script adds what that does not assert.
 *
 * RDM-007  Security: path confinement, token secrecy and trusted RDM hosts.
 *          #2     Paths with a backslash "..", a ".." in the middle or another drive fail as
 *                 invalid-request with no fetch, post or approval.
 *          #3-#4  With the real client functions and every RDM request failing (400, 401, 500,
 *                 network), the token and its Authorization value appear in no result, result.json
 *                 text or log line; the same holds for every error the five RDM client
 *                 functions throw.
 *          #5-#6  fetchRdmConfiguration, putRdmConfiguration, fetchRdmLookupValues and
 *                 postRdmLookupValues refuse an untrusted service host with UntrustedHostError and
 *                 no request; a trusted host receives the token, in Authorization only.
 *          Removed as duplicates: #1, approval (a cancelled and an approved load are in
 *          test-rdm-lookup-csv-load.cjs, and every falsy answer takes the same branch); the
 *          outside-the-workspace and other-tenant rows of #2 (test-rdm-lookup-csv-load.cjs, which
 *          also checks the message); the look-alike hosts of #5
 *          (test-harden-reltio-client-base-url.cjs, through the same toHttpsBase); and the
 *          trusted-host URL and single request of #6 (RDM-003 #1 in test-rdm-api-client.cjs).
 *          Not asserted: the bridge treats any truthy approval as approval (`if (!approved)`).
 *          The extension passes a strict boolean (`=== 'Load'`, asserted in
 *          test-rdm-lookup-csv-load.cjs), so this is noted for hardening, not reported as a bug.
 *
 * Tier C (manual): the modal approval dialog itself — RDM-011 and design.md.
 */
const assert = require('node:assert');
const { importDist } = require('./lib/import-dist.cjs');
const vscode = require('./lib/vscode-stub.cjs');

const { handleLookupLoadRequest } = importDist('rdm/lookupLoadBridge');
const client = importDist('api/reltioClient');
const { UntrustedHostError } = client;

const TOKEN = 'SECRET-TOKEN';
const ORG = 'rdm/lookupTypes/OrganizationStatuses';
const CONFIG = { lookupTypes: [{ uri: ORG }], sources: [{ uri: 'rdm/sources/SAP', abbreviation: 'SAP' }] };
const CSV_TEXT = [
	'code,type,sourceMappings.source,sourceMappings.code,sourceMappings.value',
	`A,${ORG},SAP,A,Acquired`,
	`B,${ORG},SAP,B,Business`,
].join('\n');
const CONFIG_REL = 'dev/T1/RDM/RdmT/config.json';
const CSV_REL = 'data/statuses.csv';

function makeDeps(over = {}, rootPath = '/ws') {
	const calls = { fetch: 0, post: 0, approve: 0, read: [], log: [] };
	const store = {
		[`${rootPath}/${CONFIG_REL}`]: JSON.stringify(CONFIG),
		[`${rootPath}/${CSV_REL}`]: CSV_TEXT,
	};
	const key = uri => uri.path.replace(/\\/g, '/').replace(/^\/(?=[A-Za-z]:)/, '');
	const root = vscode.Uri.file(rootPath);
	const deps = {
		workspaceRoot: root,
		isEnabled: () => true,
		isRepositoryMode: () => false,
		resolveTenant: async uri => (key(uri).toLowerCase().startsWith(`${rootPath}/dev/t1/`.toLowerCase().replace(/\\/g, '/'))
			? { environmentName: 'dev', tenantId: 'T1' }
			: undefined),
		rdmConfigUri: (env, tenant, id) => vscode.Uri.joinPath(root, env, tenant, 'RDM', id, 'config.json'),
		getToken: () => TOKEN,
		tryRefresh: async () => false,
		resolveServiceUri: async () => 'https://rdm.reltio.com',
		approve: async () => {
			calls.approve++;
			return true;
		},
		readFile: async uri => {
			calls.read.push(key(uri));
			const text = store[key(uri)];
			if (text === undefined) throw new Error('not found');
			return new TextEncoder().encode(text);
		},
		statFile: async uri => {
			const text = store[key(uri)];
			if (text === undefined) throw new Error('not found');
			return { size: Buffer.byteLength(text) };
		},
		fetchValues: async () => {
			calls.fetch++;
			return [];
		},
		postValues: async (service, id, body) => {
			calls.post++;
			return body.map(v => ({ uri: `x/${v.code}`, value: v }));
		},
		log: line => calls.log.push(line),
		...over,
	};
	return { deps, calls };
}
const request = over => ({ requestId: 'r1', mode: 'load', csvFile: CSV_REL, rdmConfigFile: CONFIG_REL, ...over });

/** Replaces global fetch for one call; every request is recorded. */
async function withFetch(respond, fn) {
	const requests = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		requests.push({ url, init });
		return respond(url, init);
	};
	try {
		return { value: await fn(), requests };
	} catch (error) {
		return { error, requests };
	} finally {
		globalThis.fetch = original;
	}
}

(async () => {
	// ---------------------------------------------------------------------------
	// RDM-007 #2 — paths stay inside the workspace and the tenant
	// ---------------------------------------------------------------------------
	const escapes = [
		['/ws', { csvFile: '..\\outside.csv' }],
		['/ws', { csvFile: 'data\\..\\..\\outside.csv' }],
		['/ws', { csvFile: 'data/../../ws/data/statuses.csv' }],
		['/ws', { csvFile: 'D:\\data\\statuses.csv' }],
		['/ws', { rdmConfigFile: '..\\ws\\dev\\T1\\RDM\\RdmT\\config.json' }],
		['/ws', { rdmConfigFile: 'dev\\T1\\..\\T2\\RDM\\RdmT\\config.json' }],
		['C:\\ws', { csvFile: 'D:\\ws\\data\\statuses.csv' }],
		['C:\\ws', { csvFile: 'C:\\ws\\..\\data\\statuses.csv' }],
		['C:\\ws', { rdmConfigFile: 'E:\\ws\\dev\\T1\\RDM\\RdmT\\config.json' }],
	];
	for (const [root, over] of escapes) {
		const { deps, calls } = makeDeps({}, root);
		const result = await handleLookupLoadRequest(request(over), deps);
		const label = `${root} ${JSON.stringify(over)}`;
		assert.deepStrictEqual([result.status, result.error && result.error.kind], ['failed', 'invalid-request'],
			`RDM-007 #2: ${label} fails as invalid-request`);
		assert.strictEqual(calls.fetch + calls.post + calls.approve, 0, `RDM-007 #2: ${label} fetches, posts and asks nothing`);
	}

	// ---------------------------------------------------------------------------
	// RDM-007 #3-#4 — the token never leaves the request headers
	// ---------------------------------------------------------------------------
	const failures = [
		['HTTP 400', () => new Response(JSON.stringify({ errorMessage: 'Bad request' }), { status: 400 })],
		['HTTP 401', () => new Response('', { status: 401 })],
		['HTTP 500', () => new Response('internal error', { status: 500 })],
		['network', () => { throw new TypeError('fetch failed'); }],
	];
	const leaks = text => text.includes(TOKEN) || text.includes(`Bearer ${TOKEN}`);
	for (const [name, fail] of failures) {
		for (const failOn of ['GET', 'POST']) {
			const { deps, calls } = makeDeps({ fetchValues: undefined, postValues: undefined });
			delete deps.fetchValues;
			delete deps.postValues;
			const run = await withFetch(
				(url, init) => (init.method === failOn ? fail() : new Response('[]', { status: 200 })),
				() => handleLookupLoadRequest(request(), deps),
			);
			assert.ok(run.requests.length > 0 && run.requests.every(r => r.init.headers.Authorization === `Bearer ${TOKEN}`),
				`RDM-007 #3: the real client sent the token on each request (${name} on ${failOn})`);
			const resultJson = `${JSON.stringify(run.value, null, 2)}\n`;
			for (const text of [resultJson, ...calls.log]) {
				assert.ok(!leaks(text), `RDM-007 #3: no result, result.json or log line holds the token (${name} on ${failOn})`);
			}
		}
	}

	const clientCalls = [
		['fetchTenantPhysicalConfiguration', () => client.fetchTenantPhysicalConfiguration('test.reltio.com', 'T1', TOKEN)],
		['fetchRdmConfiguration', () => client.fetchRdmConfiguration('https://rdm.reltio.com', 'RdmT', TOKEN)],
		['putRdmConfiguration', () => client.putRdmConfiguration('https://rdm.reltio.com', 'RdmT', '{}', TOKEN)],
		['fetchRdmLookupValues', () => client.fetchRdmLookupValues('https://rdm.reltio.com', 'RdmT', 'OrganizationStatuses', TOKEN)],
		['postRdmLookupValues', () => client.postRdmLookupValues('https://rdm.reltio.com', 'RdmT', [], TOKEN)],
	];
	for (const [fn, call] of clientCalls) {
		for (const [name, fail] of failures) {
			const run = await withFetch(fail, call);
			assert.ok(run.error, `RDM-007 #4: ${fn} throws on ${name}`);
			const seen = [run.error.message, run.error.stack, run.error.responseBody, JSON.stringify(run.error)].filter(Boolean).join('\n');
			assert.ok(!leaks(seen), `RDM-007 #4: the error ${fn} throws on ${name} does not hold the token`);
		}
	}

	// ---------------------------------------------------------------------------
	// RDM-007 #5-#6 — the RDM service host must be trusted
	// ---------------------------------------------------------------------------
	const serviceCalls = [
		['fetchRdmConfiguration', host => client.fetchRdmConfiguration(host, 'RdmT', TOKEN)],
		['putRdmConfiguration', host => client.putRdmConfiguration(host, 'RdmT', '{}', TOKEN)],
		['fetchRdmLookupValues', host => client.fetchRdmLookupValues(host, 'RdmT', 'OrganizationStatuses', TOKEN)],
		['postRdmLookupValues', host => client.postRdmLookupValues(host, 'RdmT', [], TOKEN)],
	];
	for (const [fn, call] of serviceCalls) {
		for (const host of ['https://evil.example.com']) {
			const run = await withFetch(() => new Response('[]', { status: 200 }), () => call(host));
			assert.ok(run.error instanceof UntrustedHostError, `RDM-007 #5: ${fn} refuses ${host} with UntrustedHostError`);
			assert.strictEqual(run.requests.length, 0, `RDM-007 #5: ${fn} sends nothing to ${host}`);
		}
		const trusted = await withFetch(() => new Response('[]', { status: 200 }), () => call('https://rdm.reltio.com'));
		// Without a request, #6 finds no header and fails on its own message.
		const [{ url, init } = { url: '', init: { headers: {} } }] = trusted.requests;
		assert.strictEqual(init.headers.Authorization, `Bearer ${TOKEN}`, `RDM-007 #6: ${fn} sends the token in Authorization`);
		const elsewhere = JSON.stringify({ url, headers: { ...init.headers, Authorization: undefined }, body: init.body });
		assert.ok(!elsewhere.includes(TOKEN), `RDM-007 #6: ${fn} puts the token nowhere but Authorization`);
	}

	console.log('test-rdm-load-bridge-security: OK');
})().catch(e => {
	console.error(e);
	process.exit(1);
});
