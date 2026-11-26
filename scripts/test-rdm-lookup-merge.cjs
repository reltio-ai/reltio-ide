#!/usr/bin/env node
'use strict';
/**
 * Area: RDM (src/rdm/lookupValueDraft.ts, src/rdm/lookupCsv.ts, src/rdm/lookupLoadBridge.ts) and
 * Common Utils (extractRdmConfig in src/api/reltioClient.ts).
 *
 * Regression checks for merging lookup values into what RDM already stores. The base merge, the
 * panel message rules and discovery are in test-rdm-lookup-value-authoring.cjs and
 * test-rdm-configuration-fetch.cjs; this script adds what those do not assert.
 *
 * RDM-002  Pure-function units: merge immutability, panel message validation, discovery shape.
 *          #1     A deep-frozen stored value goes through mergeLookupValue, planLookupValues,
 *                 planWarnings and unknownSourceWarnings without an exception, so none of them
 *                 writes to it.
 *          #5     One submission breaking several rules (a "/" code, a repeated code, 101 codes)
 *                 is rejected with every error listed.
 *          #6     extractRdmConfig on a physical configuration carrying messaging credentials and
 *                 storage accounts returns exactly the discovery fields, the service URI trimmed.
 *          Already covered elsewhere, not repeated: wrong types, unknown type, extra fields,
 *          padded strings, 101 codes alone (test-rdm-lookup-value-authoring.cjs); null, strings,
 *          missing rdmConfig, blank serviceUri, invalid rdmTenants, id order, the result's keys
 *          (test-rdm-configuration-fetch.cjs). Removed as duplicates (former #2-#4, #7): the
 *          stored value unchanged and the merged copy separate (#1 and
 *          test-rdm-lookup-value-authoring.cjs), no credential in the result (#6).
 * RDM-004  Load into existing codes keeps stored values.
 *          #2     A load that adds a SAP mapping to stored B, while the CSV states other enabled
 *                 and endDate values, posts B with enabled, endDate, version and every other
 *                 stored field as fetched.
 *          #4     The plan warns, with the line, that the stored enabled and endDate are kept.
 *          Removed as duplicates (former #1, #3, #5-#9, and the mapping and outcome parts of #2
 *          and #4): the load and its single request, the stored mappings untouched, only SAP
 *          appended, conflicts skipped with a warning, an identical row already present, and a
 *          load with nothing to append (test-rdm-lookup-csv-load.cjs,
 *          test-rdm-lookup-value-authoring.cjs).
 *
 * Tier C (manual): none for these behaviors.
 */
const assert = require('node:assert');
const { importDist } = require('./lib/import-dist.cjs');
const vscode = require('./lib/vscode-stub.cjs');

const { mergeLookupValue, planLookupValues, parseLookupValuesMessage } = importDist('rdm/lookupValueDraft');
const { readLookupCsv, planWarnings, unknownSourceWarnings } = importDist('rdm/lookupCsv');
const { handleLookupLoadRequest } = importDist('rdm/lookupLoadBridge');
const { extractRdmConfig } = importDist('api/reltioClient');

const ORG = 'rdm/lookupTypes/OrganizationStatuses';
const TARGET = { rdmTenantId: 'RdmT', lookupTypeName: 'OrganizationStatuses', lookupTypeUri: ORG };
const HEADER = 'code,type,enabled,startDate,endDate,sourceMappings.source,sourceMappings.code,sourceMappings.value';
const COLS = HEADER.split(',');
const row = fields => COLS.map(c => fields[c] ?? '').join(',');
const file = (...rows) => [HEADER, ...rows].join('\n');
const mapRow = (code, source, atSource, value) =>
	row({ code, type: ORG, 'sourceMappings.source': source, 'sourceMappings.code': atSource, 'sourceMappings.value': value });
const csv = text => readLookupCsv(text, Buffer.byteLength(text));
const copy = v => JSON.parse(JSON.stringify(v));

function deepFreeze(value) {
	if (value && typeof value === 'object') {
		for (const v of Object.values(value)) deepFreeze(v);
		Object.freeze(value);
	}
	return value;
}

/** B as stored: two mappings, a version and an end date the merge must carry back. */
const storedB = () => ({
	tenantId: 'RdmT',
	type: ORG,
	code: 'B',
	enabled: true,
	sourceMappings: [
		{ source: 'BvD', values: [{ code: 'B', value: 'Business', enabled: true, canonicalValue: true, downStreamDefaultValue: true }] },
		{ source: 'DnB', values: [{ code: 'DB', value: 'Biz DnB', enabled: true, canonicalValue: false, downStreamDefaultValue: true }] },
	],
	startDate: 0,
	endDate: 1800000000000,
	updatedBy: 'someone@example.com',
	version: 7,
});
const CONFIG = {
	lookupTypes: [{ uri: ORG }],
	sources: [{ uri: 'rdm/sources/BvD', abbreviation: 'BvD' }, { uri: 'rdm/sources/SAP', abbreviation: 'SAP' }, { uri: 'rdm/sources/DnB', abbreviation: 'DnB' }],
};

// ---------------------------------------------------------------------------
// RDM-002 — frozen stored values are never mutated
// ---------------------------------------------------------------------------

{
	const frozen = deepFreeze(storedB());
	const parsed = csv(file(mapRow('B', 'Reltio', 'B', 'Business')));
	const type = parsed.types[0];
	const [draft] = type.values;

	try {
		mergeLookupValue(frozen, draft);
		const plan = planLookupValues([draft], [frozen], TARGET);
		planWarnings(plan, type);
		unknownSourceWarnings(type, [frozen], deepFreeze(copy(CONFIG)));
	} catch (e) {
		assert.fail(`RDM-002 #1: merging into a frozen stored value threw: ${e.message}`);
	}
}

// ---------------------------------------------------------------------------
// RDM-002 — every rule breach is listed at once
// ---------------------------------------------------------------------------

{
	const values = Array.from({ length: 101 }, (_, i) => ({
		code: `C${i}`,
		mappings: [{ source: 'DnB', code: '', value: `V${i}`, canonicalValue: false, downStreamDefaultValue: true }],
	}));
	values[5].code = 'A/B';
	values[7].code = 'C0';
	const parsed = parseLookupValuesMessage({ type: 'submitLookupValues', render: 'r1', values });
	assert.strictEqual(parsed.kind, 'rejected', 'RDM-002 #5: a submission breaking several rules is rejected');
	assert.deepStrictEqual(parsed.errors, [
		'At most 100 codes can be added at once; this form has 101.',
		'Code 6 (A/B): a code cannot contain "/".',
		'Code 8 (C0): the same code is already in code 1.',
	], 'RDM-002 #5: every breach is listed, not only the first');
}

// ---------------------------------------------------------------------------
// RDM-002 — discovery keeps nothing but the RDM fields
// ---------------------------------------------------------------------------

{
	const SECRETS = ['msg-secret-1', 'storage-key-2', 'internal.host.example', 'sa-private-key-3'];
	const physical = {
		tenantId: 'T1',
		messaging: { destinations: [{ type: 'sqs', accessKey: 'AKIA', secretKey: SECRETS[0] }] },
		storage: { serviceAccounts: [{ name: 'gcs', key: SECRETS[1], privateKey: SECRETS[3] }] },
		internalHost: SECRETS[2],
		rdmConfig: {
			serviceUri: ' https://rdm.reltio.com ',
			credentials: { secret: SECRETS[0] },
			rdmTenants: [{ rdmTenantId: 'RdmB', token: SECRETS[1] }, { rdmTenantId: 'RdmA' }],
		},
	};
	const out = extractRdmConfig(physical);
	assert.deepStrictEqual(out, { serviceUri: 'https://rdm.reltio.com', rdmTenantIds: ['RdmB', 'RdmA'], rejectedRdmTenantIds: [] },
		'RDM-002 #6: the service URI is trimmed and the ids keep their order');
}

// ---------------------------------------------------------------------------
// RDM-004 — the bridge, every external effect injected
// ---------------------------------------------------------------------------

const CONFIG_REL = 'dev/T1/RDM/RdmT/config.json';
const CSV_REL = 'data/statuses.csv';

function makeDeps(csvText, serverValues) {
	const calls = { fetch: 0, post: [], approve: [] };
	const server = new Map(serverValues.map(v => [v.code, copy(v)]));
	const store = { [`/ws/${CONFIG_REL}`]: JSON.stringify(CONFIG), [`/ws/${CSV_REL}`]: csvText };
	const deps = {
		workspaceRoot: vscode.Uri.file('/ws'),
		isEnabled: () => true,
		isRepositoryMode: () => false,
		resolveTenant: async uri => (uri.path.startsWith('/ws/dev/T1/') ? { environmentName: 'dev', tenantId: 'T1' } : undefined),
		rdmConfigUri: (env, tenant, id) => vscode.Uri.file(`/ws/${env}/${tenant}/RDM/${id}/config.json`),
		getToken: () => 'TOKEN',
		tryRefresh: async () => false,
		resolveServiceUri: async () => 'https://rdm.reltio.com',
		approve: async a => {
			calls.approve.push(a);
			return true;
		},
		readFile: async uri => new TextEncoder().encode(store[uri.path]),
		statFile: async uri => ({ size: Buffer.byteLength(store[uri.path]) }),
		fetchValues: async () => {
			calls.fetch++;
			return [...server.values()].map(copy);
		},
		postValues: async (service, id, body) => {
			calls.post.push(copy(body));
			for (const v of body) server.set(v.code, copy(v));
			return body.map(v => ({ uri: `${id}/OrganizationStatuses/${v.code}`, value: v }));
		},
	};
	return { deps, calls, server };
}
const request = mode => ({ requestId: 'r1', mode, csvFile: CSV_REL, rdmConfigFile: CONFIG_REL });

(async () => {
	// RDM-004 #2, #4: stored fields are carried back, and the plan says they are kept.
	{
		const text = file(
			row({ code: 'B', type: ORG, enabled: 'false', endDate: '1900000000000' }), // 2
			mapRow('B', 'SAP', 'B', 'Business'), // 3
		);
		const { deps, calls } = makeDeps(text, [storedB()]);
		const result = await handleLookupLoadRequest(request('load'), deps);
		// Without a request, #2 compares nothing and fails on its own message.
		const [b = {}] = calls.post[0] ?? [];
		const { sourceMappings, ...rest } = b;
		const { sourceMappings: storedMappings, ...storedRest } = storedB();
		assert.deepStrictEqual(rest, storedRest, 'RDM-004 #2: enabled, endDate, version and every other stored field are sent as fetched');
		const kept = (result.warnings ?? []).map(w => w.message).filter(m => /Stored values are never changed/.test(m));
		assert.deepStrictEqual(kept, [
			'Line 2: B is stored with enabled true, not false. Stored values are never changed, so it stays true.',
			'Line 2: B is stored with endDate 1800000000000, not 1900000000000. Stored values are never changed, so it stays 1800000000000.',
		], 'RDM-004 #4: a warning says each stored value is kept, with the line that asked otherwise');
	}

	console.log('test-rdm-lookup-merge: OK');
})().catch(e => {
	console.error(e);
	process.exit(1);
});
