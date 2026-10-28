#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: rdm-lookup-csv-load
 * Tier A: CSV parsing, conversion to lookup values, checks with line numbers,
 *         lookup type from the file name, chunking and per-code outcomes.
 * Tier B: the bridge with injected dependencies — identity from workspace
 *         files only, plan never writes, load only after approval, existing
 *         codes appended to and never replaced, chunks, failures, no token in results; the bundled
 *         skill and the manifest.
 * Tier C (manual): live tenant in Claude Code and Cursor — see design.md.
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');

const repoRoot = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(repoRoot, p), 'utf8');

const vscode = require('./lib/vscode-stub.cjs');
const csvLib = importDist('rdm/lookupCsv');
const bridge = importDist('rdm/lookupLoadBridge');
const { ReltioApiError, UntrustedHostError } = importDist('api/reltioClient');
const { GIT_SOURCE_TOKEN } = importDist('api/tokenStore');

const { parseCsvRecords, readLookupCsv, unknownSourceWarnings, resolveLookupType, chunk, loadOutcomes, countOutcomes } = csvLib;
const csv = text => readLookupCsv(text, Buffer.byteLength(text));

// A synthetic sample in the shape the user supplied.
const SAMPLE = [
	'Code,Source,Value at Source',
	'Single,Reltio,S',
	'Single,BvD,Unmarried',
	'Single,ReltioCleanser,Never married',
	'Married,Reltio,M',
	'Married,BvD,Spouse present',
	'Married,ReltioCleanser,Legally wed',
	'Divorced,Reltio,D',
	'Divorced,BvD,Marriage dissolved',
	'Unknown,BvD,Not disclosed',
	'Unknown,ReltioCleanser,Not specified',
].join('\n');

// ---------------------------------------------------------------------------
// Tier A — RFC 4180 parsing
// ---------------------------------------------------------------------------

{
	const { records, error } = parseCsvRecords('a,"b, c","say ""hi"""\r\nx,"multi\nline",z\n');
	assert.strictEqual(error, undefined);
	assert.deepStrictEqual(records, [
		{ line: 1, fields: ['a', 'b, c', 'say "hi"'] },
		{ line: 2, fields: ['x', 'multi\nline', 'z'] },
	]);
	// Lines keep counting through a line break inside quotes.
	assert.strictEqual(parseCsvRecords('h\n"a\nb"\nc').records[2].line, 4);
	assert.deepStrictEqual(parseCsvRecords('h\n"never closed\n').error.lines, [2]);
}

// ---------------------------------------------------------------------------
// Tier A — the sample becomes lookup values
// ---------------------------------------------------------------------------

{
	const out = csv(SAMPLE);
	assert.deepStrictEqual(out.errors, []);
	assert.deepStrictEqual(out.warnings, []);
	assert.deepStrictEqual(out.values.map(v => v.code), ['Single', 'Married', 'Divorced', 'Unknown'], 'first-appearance order');
	assert.deepStrictEqual(out.linesByCode.Single, [2, 3, 4]);
	assert.deepStrictEqual(out.values[0].mappings, [
		{ source: 'Reltio', code: 'S', value: 'S', canonicalValue: true, downStreamDefaultValue: true },
		{ source: 'BvD', code: 'Unmarried', value: 'Unmarried', canonicalValue: false, downStreamDefaultValue: true },
		{ source: 'ReltioCleanser', code: 'Never married', value: 'Never married', canonicalValue: false, downStreamDefaultValue: true },
	], 'Value at Source is the source code and value; only the first row is canonical');
	// A code whose first row is not Reltio still gets its first row as canonical.
	assert.deepStrictEqual(out.values[3].mappings.map(m => m.canonicalValue), [true, false]);
}

// BOM, CRLF, blank lines, header in another order and case, an extra column.
{
	const text = '﻿value at source , SOURCE,Notes,code\r\n\r\nS,Reltio,x,Single\r\n';
	const out = csv(text);
	assert.deepStrictEqual(out.errors, []);
	assert.deepStrictEqual(out.values, [{ code: 'Single', mappings: [{ source: 'Reltio', code: 'S', value: 'S', canonicalValue: true, downStreamDefaultValue: true }] }]);
	assert.deepStrictEqual(out.linesByCode.Single, [3], 'blank lines still count');
	assert.strictEqual(out.warnings.length, 1);
	assert.match(out.warnings[0].message, /ignored column "Notes"/);
}

// Optional columns: Code at Source, Canonical, Downstream Default, every boolean spelling.
{
	const out = csv([
		'Code,Source,Value at Source,Code at Source,Canonical,Downstream Default',
		'Single,SAP,Single person,S1,no,',
		'Single,Reltio,S,,YES,0',
		'Married,SAP,M,,TRUE,false',
		'Married,BvD,Mar,,1,No',
	].join('\n'));
	assert.deepStrictEqual(out.errors, []);
	assert.deepStrictEqual(out.values[0].mappings[0], { source: 'SAP', code: 'S1', value: 'Single person', canonicalValue: false, downStreamDefaultValue: true });
	assert.deepStrictEqual(out.values[0].mappings[1], { source: 'Reltio', code: 'S', value: 'S', canonicalValue: true, downStreamDefaultValue: false });
	assert.deepStrictEqual(out.values[1].mappings.map(m => [m.canonicalValue, m.downStreamDefaultValue]), [[true, false], [true, false]]);
}

// ---------------------------------------------------------------------------
// Tier A — errors and warnings, with lines
// ---------------------------------------------------------------------------

const errorsOf = text => csv(text).errors;

assert.match(errorsOf('Code,Source\nA,B')[0].message, /^Line 1: missing column "Value at Source"/);
assert.deepStrictEqual(errorsOf('Code,Source\nA,B')[0].lines, [1]);
assert.match(errorsOf('Source\nB')[0].message, /missing columns "Code", "Value at Source"/);
assert.match(errorsOf('Code,Source,Value at Source')[0].message, /no data rows/);
assert.match(errorsOf('')[0].message, /empty/);

{
	const errs = errorsOf('Code,Source,Value at Source\n,Reltio,S\nA/B,Reltio,S\nC,,S\nD,Reltio,\nE,Reltio,X\n');
	assert.deepStrictEqual(errs.map(e => e.lines[0]), [2, 3, 4, 5]);
	assert.match(errs[0].message, /^Line 2: "Code" is empty/);
	assert.match(errs[1].message, /^Line 3: a code cannot contain "\/"/);
	assert.match(errs[2].message, /^Line 4: "Source" is empty/);
	assert.match(errs[3].message, /^Line 5: "Value at Source" is empty/);
}
{
	const errs = errorsOf('Code,Source,Value at Source\nSingle,BvD,U\nSingle,Reltio,S\nSingle,BvD,X');
	assert.strictEqual(errs.length, 1);
	assert.deepStrictEqual(errs[0].lines, [2, 4], 'both lines of a duplicate source are named');
}
assert.match(errorsOf('Code,Source,Value at Source,Canonical\nA,B,C,maybe')[0].message, /^Line 2: "Canonical" must be/);
assert.match(errorsOf('Code,Source,Value at Source,Downstream Default\nA,B,C,2')[0].message, /^Line 2: "Downstream Default" must be/);
assert.match(errorsOf('Code,Source,Value at Source\n"A,B,C')[0].message, /never closed/);

// Limits.
{
	const rows = Array.from({ length: csvLib.MAX_CSV_ROWS + 1 }, (_, i) => `C${i},Reltio,V${i}`);
	assert.match(errorsOf(['Code,Source,Value at Source', ...rows].join('\n'))[0].message, /limit is 10000/);
	assert.match(readLookupCsv('Code,Source,Value at Source\nA,B,C', csvLib.MAX_CSV_BYTES + 1).errors[0].message, /larger than 2 MB/);
}

// No canonical mapping is a warning, not an error.
{
	const out = csv('Code,Source,Value at Source,Canonical\nA,Reltio,a,no\nA,BvD,b,no');
	assert.deepStrictEqual(out.errors, []);
	assert.match(out.warnings[0].message, /Code "A" has no canonical mapping/);
	assert.deepStrictEqual(out.warnings[0].lines, [2, 3]);
}

// Unknown sources: neither declared (by abbreviation) nor used by the lookup type.
{
	const out = csv('Code,Source,Value at Source\nA,Reltio,a\nA,BVD,b\nB,BVD,c\nB,SAP,d');
	const config = { sources: [{ uri: 'rdm/sources/Reltio', abbreviation: 'Reltio' }, { uri: 'rdm/sources/DnB', abbreviation: 'BvD' }] };
	const current = [{ code: 'X', sourceMappings: [{ source: 'SAP' }] }];
	const warnings = unknownSourceWarnings(out, current, config);
	assert.strictEqual(warnings.length, 1, 'SAP is used by the lookup type; Reltio is declared');
	assert.deepStrictEqual(warnings[0].lines, [3, 4]);
	assert.match(warnings[0].message, /Source "BVD"/);
}

// ---------------------------------------------------------------------------
// Tier A — lookup type from the file name
// ---------------------------------------------------------------------------

const CONFIG = {
	lookupTypes: [{ uri: 'rdm/lookupTypes/MaritalStatuses' }, { uri: 'rdm/lookupTypes/AddressTypes' }],
	sources: [
		{ uri: 'rdm/sources/Reltio', abbreviation: 'Reltio' },
		{ uri: 'rdm/sources/BvD', abbreviation: 'BvD' },
		{ uri: 'rdm/sources/ReltioCleanser', abbreviation: 'ReltioCleanser' },
	],
};
assert.deepStrictEqual(resolveLookupType('MaritalStatuses.csv', CONFIG), { name: 'MaritalStatuses', uri: 'rdm/lookupTypes/MaritalStatuses' });
assert.match(resolveLookupType('maritalstatuses.csv', CONFIG).error, /Did you mean "MaritalStatuses"\? Rename the file to "MaritalStatuses.csv"/);
assert.match(resolveLookupType('Genders.csv', CONFIG).error, /no lookup type "Genders"/);
assert.ok('error' in resolveLookupType('MaritalStatuses.csv', null));

// ---------------------------------------------------------------------------
// Tier A — chunking and outcomes
// ---------------------------------------------------------------------------

assert.deepStrictEqual(chunk(Array.from({ length: 250 }, (_, i) => i), 100).map(c => c.length), [100, 100, 50]);
assert.deepStrictEqual(chunk([], 100), []);

{
	const item = (code, kind, expect) => ({ draft: { code, mappings: [] }, kind, expect: kind === 'unchanged' ? [] : expect ?? [{ source: 'Reltio', code }] });
	const has = (code, ...sources) => ({ code, sourceMappings: sources.map(source => ({ source, values: [{ code, value: code }] })) });
	const items = [
		item('U', 'unchanged'),
		item('A', 'new'),
		item('B', 'append', [{ source: 'BvD', code: 'B' }]),
		item('C', 'new'),
		item('D', 'new'),
		item('P', 'append', [{ source: 'BvD', code: 'P' }]),
	];
	const outcomes = loadOutcomes({
		items,
		sent: ['A', 'B', 'C', 'P'],
		createResponses: [[{ uri: 'x', value: has('A', 'Reltio') }]],
		refetched: [has('B', 'Reltio', 'BvD'), has('P', 'Reltio')],
	});
	assert.deepStrictEqual(outcomes, [
		{ code: 'U', outcome: 'unchanged' },
		{ code: 'A', outcome: 'added' },
		{ code: 'B', outcome: 'appended' },
		{ code: 'C', outcome: 'not-stored' },
		{ code: 'D', outcome: 'not-sent' },
		{ code: 'P', outcome: 'not-stored' },
	], 'P is there, but without the mapping that was appended');
	const noRefetch = loadOutcomes({
		items: [item('A', 'new'), item('C', 'new')],
		sent: ['A', 'C'],
		createResponses: [[{ uri: 'x', value: has('A', 'Reltio') }]],
		refetched: undefined,
	});
	assert.deepStrictEqual(noRefetch.map(o => o.outcome), ['added', 'unconfirmed']);
	assert.deepStrictEqual(countOutcomes(outcomes), { added: 1, appended: 1, unchanged: 1, 'not-stored': 2, 'not-sent': 1, unconfirmed: 0 });
}

// ---------------------------------------------------------------------------
// Tier B — the bridge, every external effect injected
// ---------------------------------------------------------------------------

const TOKEN = 'SECRET-TOKEN-1234';
const ROOT = vscode.Uri.file('/ws');
const CONFIG_REL = 'dev/T1/RDM/RdmT/config.json';
const CSV_REL = 'data/MaritalStatuses.csv';

function makeDeps(over = {}, files = {}) {
	const calls = { fetch: [], post: [], approve: [], read: [] };
	const copy = v => JSON.parse(JSON.stringify(v));
	const server = new Map((over.serverValues ?? []).map(v => [v.code, copy(v)]));
	const store = {
		[`/ws/${CONFIG_REL}`]: JSON.stringify(CONFIG),
		[`/ws/${CSV_REL}`]: SAMPLE,
		...files,
	};
	const deps = {
		workspaceRoot: ROOT,
		isEnabled: () => true,
		isRepositoryMode: () => false,
		resolveTenant: async uri => (uri.path.toLowerCase().startsWith('/ws/dev/t1/') ? { environmentName: 'dev', tenantId: 'T1' } : undefined),
		rdmConfigUri: (env, tenant, id) => vscode.Uri.file(`/ws/${env}/${tenant}/RDM/${id}/config.json`),
		getToken: () => TOKEN,
		tryRefresh: async () => false,
		resolveServiceUri: async () => 'https://rdm.reltio.com',
		approve: async a => {
			calls.approve.push(a);
			return over.approved ?? true;
		},
		readFile: async uri => {
			calls.read.push(uri.path);
			if (!(uri.path in store)) throw new Error('not found');
			return new TextEncoder().encode(store[uri.path]);
		},
		fetchValues: async (service, rdmTenantId, type, token) => {
			calls.fetch.push({ service, rdmTenantId, type, token });
			return [...server.values()].map(copy);
		},
		postValues: async (service, rdmTenantId, body, token) => {
			calls.post.push({ service, rdmTenantId, body, token });
			for (const v of body) server.set(v.code, copy(v));
			return body.map(v => ({ uri: `${rdmTenantId}/${v.type.split('/').pop()}/${v.code}`, value: v }));
		},
		...over,
	};
	return { deps, calls, server };
}

/** Single as stored: one canonical Reltio mapping, and fields the merge must carry back. */
const singleStored = () => ({
	tenantId: 'RdmT',
	type: 'rdm/lookupTypes/MaritalStatuses',
	code: 'Single',
	enabled: true,
	sourceMappings: [{ source: 'Reltio', values: [{ code: 'S', value: 'S', enabled: true, canonicalValue: true, downStreamDefaultValue: true }] }],
	startDate: 0,
	endDate: 0,
	updatedBy: 'someone@example.com',
	version: 7,
});

const request = over => ({ requestId: 'r1', mode: 'plan', csvFile: CSV_REL, rdmConfigFile: CONFIG_REL, ...over });
const run = (raw, over, files) => {
	const { deps, calls, server } = makeDeps(over, files);
	return bridge.handleLookupLoadRequest(raw, deps).then(result => ({ result, calls, server }));
};

async function testGates() {
	let r = await run(request(), { isEnabled: () => false });
	assert.strictEqual(r.result.status, 'not-run');
	assert.strictEqual(r.result.reason, 'disabled');
	assert.strictEqual(r.calls.read.length + r.calls.fetch.length, 0, 'disabled reads and fetches nothing');

	r = await run(request(), { isRepositoryMode: () => true });
	assert.strictEqual(r.result.reason, 'repository-mode');

	for (const [raw, pattern] of [
		['x', /JSON object/],
		[request({ mode: 'apply' }), /"mode"/],
		[request({ csvFile: undefined }), /"csvFile" is required/],
		[request({ rdmConfigFile: '' }), /"rdmConfigFile" is required/],
		[request({ csvFile: '../other/MaritalStatuses.csv' }), /inside the workspace/],
		[request({ csvFile: '/etc/MaritalStatuses.csv' }), /inside the workspace/],
		[request({ csvFile: 'data/MaritalStatuses.txt' }), /\.csv file/],
		[request({ rdmConfigFile: 'dev/T1/Business Config/BusinessConfig.json' }), /RDM\/<rdmTenantId>\/config\.json/],
		[request({ rdmConfigFile: 'dev/T1/old/RDM/RdmT/config.json' }), /not T1's RDM configuration/],
	]) {
		r = await run(raw);
		assert.strictEqual(r.result.status, 'failed', JSON.stringify(raw));
		assert.strictEqual(r.result.error.kind, 'invalid-request');
		assert.match(r.result.error.message, pattern);
		assert.strictEqual(r.calls.fetch.length + r.calls.post.length, 0);
	}
	r = await run(request({ requestId: '' }));
	assert.strictEqual(r.result.requestId, null);
	assert.strictEqual(r.result.error.kind, 'invalid-request');

	r = await run(request({ rdmConfigFile: 'prod/T9/RDM/RdmT/config.json' }));
	assert.strictEqual(r.result.reason, 'no-tenant');

	r = await run(request(), { getToken: () => undefined });
	assert.strictEqual(r.result.reason, 'signed-out');
	r = await run(request(), { getToken: () => GIT_SOURCE_TOKEN });
	assert.strictEqual(r.result.reason, 'signed-out', 'a repository placeholder is not a session');

	r = await run(request(), { resolveServiceUri: async () => undefined });
	assert.strictEqual(r.result.reason, 'no-rdm-service');
	r = await run(request(), { resolveServiceUri: async () => '401' });
	assert.strictEqual(r.result.reason, 'signed-out');

	r = await run(request(), { fetchValues: async () => { throw new UntrustedHostError('Refusing to contact untrusted host'); } });
	assert.strictEqual(r.result.error.kind, 'untrusted-host');
	r = await run(request(), { fetchValues: async () => { throw new ReltioApiError('Fetch failed: HTTP 500', 500); } });
	assert.deepStrictEqual([r.result.error.kind, r.result.error.httpStatus], ['api-error', 500]);
}

async function testIdentityAndLookupType() {
	// Identity fields in the request are ignored.
	const r = await run(request({ tenantId: 'Other', rdmTenantId: 'Evil', lookupType: 'AddressTypes', environment: 'prod' }));
	assert.strictEqual(r.result.status, 'planned');
	assert.deepStrictEqual(r.result.tenant, { environment: 'dev', tenantId: 'T1' });
	assert.strictEqual(r.result.rdmTenantId, 'RdmT');
	assert.strictEqual(r.result.lookupType, 'MaritalStatuses');
	assert.deepStrictEqual(r.calls.fetch.map(f => [f.rdmTenantId, f.type]), [['RdmT', 'MaritalStatuses']]);

	const near = await run(request({ csvFile: 'data/maritalstatuses.csv' }), {}, { '/ws/data/maritalstatuses.csv': SAMPLE });
	assert.strictEqual(near.result.error.kind, 'unknown-lookup-type');
	assert.match(near.result.error.message, /MaritalStatuses/);
	assert.strictEqual(near.calls.fetch.length, 0);
}

async function testPlan() {
	const r = await run(request(), { serverValues: [singleStored()] });
	assert.strictEqual(r.result.status, 'planned');
	assert.deepStrictEqual(r.result.counts, { new: 3, append: 1, unchanged: 0 });
	assert.strictEqual(r.result.appendMappingCount, 2, 'BvD and ReltioCleanser are added to Single; Reltio is already there');
	assert.deepStrictEqual(r.result.codes[0], { code: 'Single', lines: [2, 3, 4], classification: 'append' });
	assert.deepStrictEqual(r.result.codes.slice(1).map(c => c.classification), ['new', 'new', 'new']);
	assert.strictEqual(r.calls.post.length, 0, 'a plan never writes');
	assert.strictEqual(r.calls.approve.length, 0, 'a plan never prompts');

	// A conflicting row and a canonical flag the stored value keeps: warnings with lines, never errors.
	const conflicts = await run(request(), { serverValues: [singleStored()] }, {
		[`/ws/${CSV_REL}`]: 'Code,Source,Value at Source,Code at Source,Canonical\nSingle,Reltio,Solo,S,\nSingle,BvD,Unmarried,,yes',
	});
	assert.deepStrictEqual(conflicts.result.errors, []);
	assert.deepStrictEqual(conflicts.result.codes.map(c => c.classification), ['append']);
	const [conflict, flag] = conflicts.result.warnings;
	assert.deepStrictEqual(conflict.lines, [2]);
	assert.match(conflict.message, /Single already maps Reltio code "S" to "S", not "Solo"\. The stored value is kept/);
	assert.deepStrictEqual(flag.lines, [3]);
	assert.match(flag.message, /already has a canonical value, so BvD is added as non-canonical/);

	const unchanged = await run(request(), { serverValues: [singleStored()] }, { [`/ws/${CSV_REL}`]: 'Code,Source,Value at Source\nSingle,Reltio,S' });
	assert.deepStrictEqual(unchanged.result.counts, { new: 0, append: 0, unchanged: 1 });

	const bad = await run(request(), {}, { [`/ws/${CSV_REL}`]: 'Code,Source,Value at Source\nSingle,BvD,U\nSingle,BvD,X' });
	assert.strictEqual(bad.result.status, 'planned');
	assert.strictEqual(bad.result.errors.length, 1);
	assert.match(bad.result.message, /must be fixed/);
}

async function testLoad() {
	// Errors: refused before any dialog or post.
	let r = await run(request({ mode: 'load' }), {}, { [`/ws/${CSV_REL}`]: 'Code,Source,Value at Source\nSingle,,U' });
	assert.strictEqual(r.result.error.kind, 'invalid-csv');
	assert.strictEqual(r.result.errors.length, 1);
	assert.strictEqual(r.calls.approve.length + r.calls.post.length, 0);

	// Not approved: nothing written.
	r = await run(request({ mode: 'load' }), { serverValues: [singleStored()], approved: false });
	assert.strictEqual(r.result.status, 'cancelled');
	assert.deepStrictEqual(r.result.counts, { new: 3, append: 1, unchanged: 0 });
	assert.strictEqual(r.calls.post.length, 0);
	assert.deepStrictEqual(r.calls.approve, [{
		environmentName: 'dev', tenantId: 'T1', rdmTenantId: 'RdmT', lookupType: 'MaritalStatuses', csvFile: CSV_REL,
		newCount: 3, appendCount: 1, appendMappingCount: 2, unchangedCount: 0, warningCount: 0,
	}]);

	// Approved: one request, in CSV order — Single merged, the rest created.
	r = await run(request({ mode: 'load' }), { serverValues: [singleStored()] });
	assert.strictEqual(r.result.status, 'loaded');
	assert.strictEqual(r.calls.post.length, 1);
	const body = r.calls.post[0].body;
	assert.deepStrictEqual(body.map(v => v.code), ['Single', 'Married', 'Divorced', 'Unknown']);
	const { sourceMappings, ...singleRest } = body[0];
	const { sourceMappings: storedMappings, ...storedRest } = singleStored();
	assert.deepStrictEqual(singleRest, storedRest, 'the existing value is sent back as fetched, version included');
	assert.deepStrictEqual(sourceMappings[0], storedMappings[0], 'the stored Reltio mapping is not changed');
	assert.deepStrictEqual(sourceMappings.slice(1).map(m => [m.source, m.values[0].code, m.values[0].canonicalValue]), [
		['BvD', 'Unmarried', false],
		['ReltioCleanser', 'Never married', false],
	], 'only the missing mappings are appended');
	assert.ok(body.slice(1).every(v => v.tenantId === 'RdmT' && v.type === 'rdm/lookupTypes/MaritalStatuses' && v.enabled === true));
	assert.deepStrictEqual(body[1].sourceMappings[1], {
		source: 'BvD',
		values: [{ code: 'Spouse present', value: 'Spouse present', enabled: true, canonicalValue: false, downStreamDefaultValue: true }],
	});
	assert.deepStrictEqual(r.result.counts, { added: 3, appended: 1, unchanged: 0, 'not-stored': 0, 'not-sent': 0, unconfirmed: 0 });
	assert.strictEqual(r.result.codes[0].outcome, 'appended');
	assert.strictEqual(r.server.get('Single').sourceMappings.length, 3);

	// A load without a plan still fetches first, then asks.
	assert.ok(r.calls.fetch.length >= 1 && r.calls.approve.length === 1);

	// Rerun against what was stored: every code unchanged, no dialog, nothing sent.
	r = await run(request({ mode: 'load' }), { serverValues: [...r.server.values()] });
	assert.strictEqual(r.result.status, 'loaded');
	assert.strictEqual(r.calls.approve.length, 0);
	assert.strictEqual(r.calls.post.length, 0);
	assert.strictEqual(r.result.counts.unchanged, 4);
}

async function testChunksAndFailures() {
	const big = ['Code,Source,Value at Source', ...Array.from({ length: 250 }, (_, i) => `C${i},Reltio,V${i}`)].join('\n');
	const files = { [`/ws/${CSV_REL}`]: big };

	let r = await run(request({ mode: 'load' }), {}, files);
	assert.deepStrictEqual(r.calls.post.map(p => p.body.length), [100, 100, 50]);
	assert.deepStrictEqual(r.calls.post.map(p => p.body[0].code), ['C0', 'C100', 'C200'], 'in CSV order');
	assert.strictEqual(r.result.counts.added, 250);

	// The second chunk fails: the third is never sent.
	let posts = 0;
	const failing = makeDeps({}, files);
	failing.deps.postValues = async (service, id, body, token) => {
		posts++;
		if (posts === 2) throw new ReltioApiError('HTTP 400: Invalid source', 400);
		return body.map(v => ({ uri: `x/${v.code}`, value: v }));
	};
	const res = await bridge.handleLookupLoadRequest(request({ mode: 'load' }), failing.deps);
	assert.strictEqual(posts, 2);
	assert.deepStrictEqual(res.counts, { added: 100, appended: 0, unchanged: 0, 'not-stored': 100, 'not-sent': 50, unconfirmed: 0 });
	assert.deepStrictEqual([res.error.kind, res.error.httpStatus], ['api-error', 400]);
	assert.match(res.message, /Invalid source/);

	// 401 on a post: refresh, then one retry with the new session.
	const tokens = [];
	let first = true;
	r = await run(request({ mode: 'load' }), {
		getToken: () => (first ? TOKEN : 'NEW-TOKEN'),
		tryRefresh: async () => { first = false; return true; },
		postValues: async (service, id, body, token) => {
			tokens.push(token);
			if (token === TOKEN) throw new ReltioApiError('Unauthorized (401)', 401);
			return body.map(v => ({ uri: `x/${v.code}`, value: v }));
		},
	});
	assert.deepStrictEqual(tokens, [TOKEN, 'NEW-TOKEN']);
	assert.strictEqual(r.result.counts.added, 4);

	// The re-fetch fails and the response lists nothing: sent codes are unconfirmed.
	let fetches = 0;
	r = await run(request({ mode: 'load' }), {
		fetchValues: async () => {
			if (++fetches > 1) throw new Error('Network error');
			return [];
		},
		postValues: async () => undefined,
	});
	assert.strictEqual(r.result.counts.unconfirmed, 4);
}

async function testNoTokenInResults() {
	const results = [];
	for (const [raw, over] of [
		[request(), {}],
		[request({ mode: 'load' }), {}],
		[request({ mode: 'load' }), { approved: false }],
		[request(), { fetchValues: async () => { throw new ReltioApiError('HTTP 500', 500); } }],
	]) {
		const log = [];
		const r = await run(raw, { ...over, log: l => log.push(l) });
		results.push(JSON.stringify(r.result), ...log);
	}
	for (const text of results) assert.ok(!text.includes(TOKEN), 'the session token never appears in a result or log line');
}

// The approval dialog states everything the extension resolved.
{
	const t = bridge.approvalText({
		environmentName: 'dev', tenantId: 'T1', rdmTenantId: 'RdmT', lookupType: 'MaritalStatuses',
		csvFile: CSV_REL, newCount: 1, appendCount: 2, appendMappingCount: 3, unchangedCount: 0, warningCount: 1,
	});
	assert.strictEqual(t.message, 'Load into MaritalStatuses?');
	assert.strictEqual(
		t.detail,
		`1 new code, and 3 new mappings for 2 existing codes. Nothing stored is changed or removed. Tenant T1 on dev, RDM tenant RdmT, from ${CSV_REL}. 0 codes already stored. 1 warning.`,
	);
}

// ---------------------------------------------------------------------------
// Tier B — the skill, the bundle, the manifest, the wiring
// ---------------------------------------------------------------------------

{
	const rel = 'skills/reltio-default/rdm-lookup-values-from-csv/SKILL.md';
	const skill = read(rel);
	const front = skill.split('---')[1];
	assert.match(front, /^\s*name: reltio-rdm-lookup-values-from-csv$/m);
	const description = /^description: (.+)$/m.exec(front)[1];
	assert.ok(description.length > 0 && description.length <= 1024, 'agents reject a description over 1024 characters');
	assert.deepStrictEqual(
		skill.split('\n').filter(l => l.startsWith('## ')).map(l => l.slice(3)),
		['When to use', 'Inputs', 'Procedure', 'Outputs'],
		'house sections',
	);
	assert.ok(!/(?<![\w./-])(openspec|docs|src)\//.test(skill), 'no internal-only paths in a shipped skill');

	// The skill documents the protocol the extension actually speaks.
	assert.ok(skill.includes('.reltio/reltio-agent/rdm-lookup-load/request.json'));
	for (const token of ['planned', 'loaded', 'cancelled', 'not-run', 'failed', ...bridge.NOT_RUN_REASONS, ...bridge.FAILURE_KINDS, ...csvLib.LOAD_OUTCOMES]) {
		assert.ok(skill.includes(`\`${token}\``), `the skill must say what to do for \`${token}\``);
	}
	assert.ok(/Never ask for, read or pass on a token/.test(skill), 'the skill keeps the agent away from the session');

	const assets = JSON.parse(read('resources/reltio-agent-assets.json'));
	assert.ok(Number(assets.skillsBundleVersion) >= 23, 'the bundle version is raised so workspaces receive the skill');

	const pointer = read('.cursor/skills/reltio-rdm-lookup-values-from-csv/SKILL.md');
	assert.ok(pointer.includes(rel));
	assert.ok(pointer.includes('.reltio/reltio-agent/skills/default/rdm-lookup-values-from-csv/SKILL.md'));

	const pkg = JSON.parse(read('package.json'));
	const setting = pkg.contributes.configuration.properties['reltio.enableRdmLookupLoad'];
	assert.ok(setting && setting.type === 'boolean' && setting.default === true);
	assert.ok(
		!pkg.contributes.commands.some(c => /csv|lookupload/i.test(`${c.command} ${c.title}`)),
		'the CSV load is agent-only: no command',
	);

	const ext = read('src/extension.ts');
	assert.ok(ext.includes('registerLookupLoadBridge({'), 'the bridge is registered');
	assert.ok(/showWarningMessage\(message, \{ modal: true, detail \}, 'Load'\)\) === 'Load'/.test(ext), 'only the Load button approves');
}

(async () => {
	await testGates();
	await testIdentityAndLookupType();
	await testPlan();
	await testLoad();
	await testChunksAndFailures();
	await testNoTokenInResults();
	console.log('test-rdm-lookup-csv-load: OK');
})().catch(e => {
	console.error(e);
	process.exit(1);
});
