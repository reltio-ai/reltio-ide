#!/usr/bin/env node
'use strict';
/**
 * Area: Common Utils (the RDM functions of src/api/reltioClient.ts).
 *
 * Contract checks for the requests the RDM client functions build, run against a stubbed global
 * `fetch` so the real functions are exercised and nothing reaches the network.
 *
 * RDM-003  Contracts: RDM request URLs, verbatim PUT body, and menu guard on RDM nodes.
 *          #1-#3  fetchTenantPhysicalConfiguration, fetchRdmConfiguration, fetchRdmLookupValues,
 *                 postRdmLookupValues and putRdmConfiguration build /reltio/tenants/{id},
 *                 /configuration/{id} and /lookups/{id}[/{type}] with encodeURIComponent, for ids
 *                 holding "/", "?", "#", "%" and spaces: one segment per id, no query, no fragment.
 *          #4-#6  putRdmConfiguration PUTs to /configuration/{rdmTenantId} with Content-Type
 *                 application/json, the body byte-identical to the text given (custom whitespace
 *                 and key order), and the token in Authorization.
 *          Menu guard (#3 of the row): already covered by test-rdm-tree-view.cjs and
 *          test-rdm-configuration-authoring.cjs (Delete and Rename gates against every RDM
 *          context value, RDM nodes in the reltio.rdm.* namespace). Not repeated here.
 *          Not asserted: an id of "." or ".." passes encodeURIComponent unchanged, so the URL
 *          parser collapses it into the parent segment. Reported to the developer as a finding;
 *          upstream checks (RDM_TENANT_ID_PATTERN, the bridge's path checks) keep such ids out today.
 *
 * Tier C (manual): none for these behaviors.
 */
const assert = require('node:assert');
const { importDist } = require('./lib/import-dist.cjs');

const client = importDist('api/reltioClient');
const {
	fetchTenantPhysicalConfiguration,
	fetchRdmConfiguration,
	fetchRdmLookupValues,
	postRdmLookupValues,
	putRdmConfiguration,
} = client;

const SERVICE = 'https://rdm.reltio.com';
const ENV_HOST = 'test.reltio.com';
const TOKEN = 'tok-123';

async function capture(call) {
	const calls = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		calls.push({ url, init });
		return new Response('[]', { status: 200 });
	};
	try {
		await call();
	} finally {
		globalThis.fetch = original;
	}
	return calls;
}

const enc = encodeURIComponent;
const IDS = ['a/b', 'q?x=1', 'h#frag', 'p%2F', 'with space', 'plain_Id-1'];

(async () => {
	// RDM-003 #1-#3: every function, every awkward id.
	for (const id of IDS) {
		const type = `T ${id}`;
		const cases = [
			['fetchTenantPhysicalConfiguration', () => fetchTenantPhysicalConfiguration(ENV_HOST, id, TOKEN), `https://${ENV_HOST}/reltio/tenants/${enc(id)}`, 3],
			['fetchRdmConfiguration', () => fetchRdmConfiguration(SERVICE, id, TOKEN), `${SERVICE}/configuration/${enc(id)}`, 2],
			['putRdmConfiguration', () => putRdmConfiguration(SERVICE, id, '{}', TOKEN), `${SERVICE}/configuration/${enc(id)}`, 2],
			['fetchRdmLookupValues', () => fetchRdmLookupValues(SERVICE, id, type, TOKEN), `${SERVICE}/lookups/${enc(id)}/${enc(type)}`, 3],
			['postRdmLookupValues', () => postRdmLookupValues(SERVICE, id, [], TOKEN), `${SERVICE}/lookups/${enc(id)}`, 2],
		];
		for (const [name, call, expected, segments] of cases) {
			const calls = await capture(call);
			assert.strictEqual(calls.length, 1, `RDM-003 #1: ${name} sends one request for "${id}"`);
			assert.strictEqual(calls[0].url, expected, `RDM-003 #1: ${name} encodes "${id}" with encodeURIComponent`);
			const parsed = new URL(calls[0].url);
			assert.strictEqual(parsed.search + parsed.hash, '', `RDM-003 #2: ${name} adds no query or fragment for "${id}"`);
			assert.strictEqual(parsed.pathname.split('/').length - 1, segments, `RDM-003 #3: ${name} keeps one path segment per id for "${id}"`);
		}
	}

	// RDM-003 #4-#6: the PUT body is the saved text, byte for byte.
	{
		const body = '{\r\n    "tenantId" : "RdmT",\n\t"lookupTypes": [ ],\n  "a": 1 ,"Z":{"x" :null}   \n}\n';
		const calls = await capture(() => putRdmConfiguration(SERVICE, 'RdmT', body, TOKEN));
		assert.strictEqual(calls.length, 1, 'RDM-003 #4: one PUT');
		const [{ url, init }] = calls;
		assert.strictEqual(url, `${SERVICE}/configuration/RdmT`, 'RDM-003 #4: PUT to /configuration/{rdmTenantId}');
		assert.strictEqual(init.method, 'PUT', 'RDM-003 #4: the method is PUT');
		assert.strictEqual(init.headers['Content-Type'], 'application/json', 'RDM-003 #5: Content-Type is application/json');
		assert.strictEqual(init.headers.Authorization, `Bearer ${TOKEN}`, 'RDM-003 #5: Authorization carries the token');
		assert.strictEqual(typeof init.body, 'string', 'RDM-003 #6: the body is sent as the text given');
		assert.ok(Buffer.from(init.body).equals(Buffer.from(body)), 'RDM-003 #6: the body is byte-identical to the input');
	}

	console.log('test-rdm-api-client: OK');
})().catch(e => {
	console.error(e);
	process.exit(1);
});
