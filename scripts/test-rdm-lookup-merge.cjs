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
 *          #1-#4  A deep-frozen stored value survives mergeLookupValue, planLookupValues,
 *                 planWarnings and unknownSourceWarnings unchanged and without an exception; the
 *                 merged result is a separate copy holding the new mapping.
 *          #5     One submission breaking several rules (a "/" code, a repeated code, 101 codes)
 *                 is rejected with every error listed.
 *          #6-#7  extractRdmConfig on a physical configuration carrying messaging credentials and
 *                 storage accounts returns only its own keys and none of those values.
 *                 (The row asks for exactly serviceUri and rdmTenantIds; the result also carries
 *                 rejectedRdmTenantIds by design, asserted in test-rdm-configuration-fetch.cjs.)
 *          Already covered elsewhere, not repeated: wrong types, unknown type, extra fields,
 *          padded strings, 101 codes alone (test-rdm-lookup-value-authoring.cjs); null, strings,
 *          missing rdmConfig, blank serviceUri, invalid rdmTenants, id order
 *          (test-rdm-configuration-fetch.cjs).
 * RDM-004  Load into existing codes keeps stored values and skips conflicting mappings.
 *          #1-#4  A load that adds a SAP mapping to stored B, while the CSV states other enabled
 *                 and endDate values, posts B as fetched plus only the SAP mapping, and warns that
 *                 the stored values are kept.
 *          #5-#9  A row conflicting with a stored mapping is skipped with a warning naming its
 *                 line, the stored value is never overwritten, an identical row counts as already
 *                 present, and a load with nothing to append sends nothing and asks nothing.
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
	const snapshot = storedB();
	const parsed = csv(file(mapRow('B', 'Reltio', 'B', 'Business')));
	const type = parsed.types[0];
	const [draft] = type.values;

	let merge;
	let plan;
	try {
		merge = mergeLookupValue(frozen, draft);
		plan = planLookupValues([draft], [frozen], TARGET);
		planWarnings(plan, type);
		unknownSourceWarnings(type, [frozen], deepFreeze(copy(CONFIG)));
	} catch (e) {
		assert.fail(`RDM-002 #1: merging into a frozen stored value threw: ${e.message}`);
	}
	assert.deepStrictEqual(frozen, snapshot, 'RDM-002 #2: the stored value deep-equals its snapshot after merge, plan and warnings');
	assert.notStrictEqual(merge.merged, frozen, 'RDM-002 #3: the merged value is a separate object');
	assert.notStrictEqual(merge.merged.sourceMappings, frozen.sourceMappings, 'RDM-002 #3: with its own mappings array');
	assert.deepStrictEqual(merge.merged.sourceMappings.map(m => m.source), ['BvD', 'DnB', 'Reltio'],
		'RDM-002 #4: the merged copy holds the stored mappings plus the new one');
	assert.deepStrictEqual(merge.appended, [{ source: 'Reltio', code: 'B' }], 'RDM-002 #4: only the new mapping is appended');
	assert.deepStrictEqual(plan.items.map(i => i.kind), ['append'], 'RDM-002 #4: the plan appends to the frozen value');
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
	assert.deepStrictEqual(Object.keys(out).sort(), ['rdmTenantIds', 'rejectedRdmTenantIds', 'serviceUri'],
		'RDM-002 #6: the result carries only the discovery keys');
	assert.deepStrictEqual(out, { serviceUri: 'https://rdm.reltio.com', rdmTenantIds: ['RdmB', 'RdmA'], rejectedRdmTenantIds: [] },
		'RDM-002 #6: the service URI is trimmed and the ids keep their order');
	const text = JSON.stringify(out);
	for (const secret of SECRETS) {
		assert.ok(!text.includes(secret), `RDM-002 #7: no credential or storage value leaks into the result (${secret})`);
	}
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
	// RDM-004 #1-#4: stored fields are carried back; only the new mapping is added.
	{
		const text = file(
			row({ code: 'B', type: ORG, enabled: 'false', endDate: '1900000000000' }), // 2
			mapRow('B', 'SAP', 'B', 'Business'), // 3
		);
		const { deps, calls } = makeDeps(text, [storedB()]);
		const result = await handleLookupLoadRequest(request('load'), deps);
		assert.strictEqual(result.status, 'loaded', `RDM-004 #1: the load completes (${result.message})`);
		assert.strictEqual(calls.post.length, 1, 'RDM-004 #1: one request');
		const [b] = calls.post[0];
		const { sourceMappings, ...rest } = b;
		const { sourceMappings: storedMappings, ...storedRest } = storedB();
		assert.deepStrictEqual(rest, storedRest, 'RDM-004 #2: enabled, endDate, version and every other stored field are sent as fetched');
		assert.deepStrictEqual(sourceMappings.slice(0, storedMappings.length), storedMappings, 'RDM-004 #2: existing mappings are untouched');
		assert.deepStrictEqual(sourceMappings.slice(storedMappings.length).map(m => [m.source, m.values.map(v => [v.code, v.value])]),
			[['SAP', [['B', 'Business']]]], 'RDM-004 #3: only the SAP mapping is added');
		const kept = result.warnings.map(w => w.message).filter(m => /Stored values are never changed/.test(m));
		assert.deepStrictEqual(kept, [
			'Line 2: B is stored with enabled true, not false. Stored values are never changed, so it stays true.',
			'Line 2: B is stored with endDate 1800000000000, not 1900000000000. Stored values are never changed, so it stays 1800000000000.',
		], 'RDM-004 #4: a warning says each stored value is kept, with the line that asked otherwise');
		assert.deepStrictEqual(result.codes.map(c => [c.code, c.outcome]), [['B', 'appended']], 'RDM-004 #4: B is reported appended');
	}

	// RDM-004 #5-#9: a conflicting row is skipped; an identical row is already present.
	{
		const text = file(
			mapRow('B', 'BvD', 'B', 'Biz'), // 2: conflicts with the stored "Business"
			mapRow('B', 'DnB', 'DB', 'Biz DnB'), // 3: identical to what is stored
		);
		const type = csv(text).types[0];
		const plan = planLookupValues(type.values, [storedB()], TARGET);
		assert.deepStrictEqual(plan.conflicts.map(c => [c.source, c.code, c.storedValue, c.value]), [['BvD', 'B', 'Business', 'Biz']],
			'RDM-004 #5: the conflicting row is a conflict, with both values');
		assert.deepStrictEqual(plan.alreadyPresent.map(n => [n.source, n.code, type.mappingLines.B[n.index]]), [['DnB', 'DB', 3]],
			'RDM-004 #6: the identical row counts as already present');
		assert.deepStrictEqual(plan.items.map(i => [i.kind, i.element]), [['unchanged', undefined]],
			'RDM-004 #6: nothing is appendable, so nothing would be sent');

		const planned = await handleLookupLoadRequest(request('plan'), makeDeps(text, [storedB()]).deps);
		const conflict = planned.warnings.find(w => /already maps/.test(w.message));
		assert.ok(conflict, 'RDM-004 #7: the plan warns about the conflicting row');
		assert.deepStrictEqual(conflict.lines, [2], 'RDM-004 #7: the warning names the conflicting line');
		assert.strictEqual(conflict.message,
			'Line 2: B already maps BvD code "B" to "Business", not "Biz". The stored value is kept and this row is skipped.',
			'RDM-004 #7: the warning says the stored value is kept and the row skipped');
		assert.deepStrictEqual(planned.errors, [], 'RDM-004 #7: a conflict is a warning, not an error');

		const { deps, calls, server } = makeDeps(text, [storedB()]);
		const loaded = await handleLookupLoadRequest(request('load'), deps);
		assert.strictEqual(loaded.status, 'loaded', 'RDM-004 #8: the load finishes');
		assert.strictEqual(calls.post.length, 0, 'RDM-004 #8: nothing is sent when nothing is appendable');
		assert.strictEqual(calls.approve.length, 0, 'RDM-004 #8: and nobody is asked to approve');
		assert.deepStrictEqual(loaded.codes.map(c => [c.code, c.outcome]), [['B', 'unchanged']], 'RDM-004 #8: B is unchanged');
		assert.strictEqual(server.get('B').sourceMappings[0].values[0].value, 'Business', 'RDM-004 #9: the stored "Business" is never overwritten');
	}

	console.log('test-rdm-lookup-merge: OK');
})().catch(e => {
	console.error(e);
	process.exit(1);
});
