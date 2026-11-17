#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: rdm-lookup-csv-load
 * Tier A: CSV parsing, conversion of RDM's export format to lookup values grouped
 *         by lookup type, checks with line numbers, lookup types from the `type`
 *         column, chunking and per-code outcomes.
 * Tier B: the bridge with injected dependencies — identity from workspace
 *         files only, plan never writes, load only after approval, existing
 *         codes appended to and never replaced, several lookup types per file,
 *         chunks, failures, no token in results; the bundled skill and the manifest.
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
const { buildLookupValuesCreateBody } = importDist('rdm/lookupValueDraft');
const { ReltioApiError, UntrustedHostError } = importDist('api/reltioClient');
const { GIT_SOURCE_TOKEN } = importDist('api/tokenStore');

const { parseCsvRecords, readLookupCsv, unknownSourceWarnings, resolveLookupTypes, chunk, loadOutcomes, countOutcomes } = csvLib;
const csv = text => readLookupCsv(text, Buffer.byteLength(text));

// RDM's export header, exactly as the user supplied it.
const HEADER =
	'code,type,enabled,startDate,endDate,parents,sourceMappings.source,sourceMappings.code,sourceMappings.value,' +
	'sourceMappings.enabled,sourceMappings.canonicalValue,sourceMappings.downStreamDefaultValue,' +
	'localizations.languageCode,localizations.value,attributes.name,attributes.value';
const COLS = HEADER.split(',');
const ORG = 'rdm/lookupTypes/OrganizationStatuses';
const ADDR = 'rdm/lookupTypes/AddressTypes';

/** One row from named fields, every other column blank, as RDM exports it. */
const row = fields => COLS.map(c => fields[c] ?? '').join(',');
const codeRow = (code, type = ORG, extra = {}) => row({ code, type, enabled: 'true', startDate: '0', endDate: '0', ...extra });
const mapRow = (code, source, atSource, value, canonical, type = ORG, extra = {}) =>
	row({
		code,
		type,
		'sourceMappings.source': source,
		'sourceMappings.code': atSource,
		'sourceMappings.value': value,
		'sourceMappings.enabled': 'true',
		'sourceMappings.canonicalValue': canonical,
		'sourceMappings.downStreamDefaultValue': 'true',
		...extra,
	});
const file = (...rows) => [HEADER, ...rows].join('\n');

// Rows from the export the user supplied. Line numbers on the right.
const SAMPLE = file(
	codeRow('A'), // 2
	mapRow('A', 'BvD', 'A', 'Acquired', 'false'), // 3
	codeRow('B'), // 4
	mapRow('B', 'BvD', 'B', 'Business', 'true'), // 5
	mapRow('B', 'SAP', 'B', 'Business', 'false'), // 6
	codeRow('Bankrupt'), // 7
	codeRow('C'), // 8
	mapRow('C', 'BvD', 'COMPANY', 'Company', 'true'), // 9
	mapRow('C', 'SAP', 'COMP', 'Comp', 'false'), // 10
);
const mapping = (source, code, value, canonicalValue, extra = {}) => ({
	source,
	code,
	value,
	canonicalValue,
	downStreamDefaultValue: true,
	enabled: true,
	...extra,
});

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
// Tier A — the export becomes lookup values
// ---------------------------------------------------------------------------

{
	const out = csv(SAMPLE);
	assert.deepStrictEqual(out.errors, []);
	assert.deepStrictEqual(out.warnings, []);
	assert.deepStrictEqual(out.types.map(t => t.name), ['OrganizationStatuses'], 'the lookup type comes from the type column');
	const [org] = out.types;
	assert.deepStrictEqual(org.values.map(v => v.code), ['A', 'B', 'Bankrupt', 'C'], 'first-appearance order');
	assert.deepStrictEqual(org.linesByCode.B, [4, 5, 6]);
	assert.deepStrictEqual(org.mappingLines.B, [5, 6]);
	assert.strictEqual(org.fieldLine.B, 4);
	assert.deepStrictEqual(org.values[1], {
		code: 'B',
		mappings: [mapping('BvD', 'B', 'Business', true), mapping('SAP', 'B', 'Business', false)],
		enabled: true,
		startDate: 0,
		endDate: 0,
	});
	assert.deepStrictEqual(org.values[2], { code: 'Bankrupt', mappings: [], enabled: true, startDate: 0, endDate: 0 }, 'a code with no mappings is still a value');
	assert.deepStrictEqual(org.values[3].mappings, [mapping('BvD', 'COMPANY', 'Company', true), mapping('SAP', 'COMP', 'Comp', false)], 'code and value at the source are separate');
}

// BOM, CRLF, blank lines, columns in another order and case, an extra column.
{
	const text = '\uFEFFTYPE, Code ,sourceMappings.VALUE,sourceMappings.code,SourceMappings.Source,Notes\r\n\r\nrdm/lookupTypes/OrganizationStatuses,B,Business,B,BvD,x\r\n';
	const out = csv(text);
	assert.deepStrictEqual(out.errors, []);
	assert.deepStrictEqual(out.types[0].values, [{ code: 'B', mappings: [mapping('BvD', 'B', 'Business', true)] }]);
	assert.deepStrictEqual(out.types[0].linesByCode.B, [3], 'blank lines still count');
	assert.strictEqual(out.warnings.length, 1);
	assert.match(out.warnings[0].message, /ignored column "Notes"/);
}

// Blanks fall back, every boolean spelling, a bare type name, and two codes at one source.
{
	const out = csv(file(
		row({ code: 'X', type: 'OrganizationStatuses', 'sourceMappings.source': 'SAP', 'sourceMappings.value': 'Single person' }),
		row({
			code: 'X', type: ORG, 'sourceMappings.source': 'SAP', 'sourceMappings.code': 'S1',
			'sourceMappings.canonicalValue': 'YES', 'sourceMappings.downStreamDefaultValue': '0', 'sourceMappings.enabled': 'no',
		}),
		codeRow('Y', ORG, { enabled: 'FALSE', startDate: '1700000000000', endDate: '' }),
	));
	assert.deepStrictEqual(out.errors, []);
	assert.strictEqual(out.types.length, 1, 'rdm/lookupTypes/X and a bare X are one lookup type');
	const [x, y] = out.types[0].values;
	assert.deepStrictEqual(x.mappings, [
		mapping('SAP', 'Single person', 'Single person', true),
		mapping('SAP', 'S1', 'S1', true, { downStreamDefaultValue: false, enabled: false }),
	], 'a blank code or value takes the other; a blank canonical means the first mapping only');
	assert.deepStrictEqual(y, { code: 'Y', mappings: [], enabled: false, startDate: 1700000000000 }, 'a blank endDate is left unset');

	// One source with two codes becomes one source mapping with two values.
	const [body] = buildLookupValuesCreateBody([x], { rdmTenantId: 'RdmT', lookupTypeName: 'OrganizationStatuses', lookupTypeUri: ORG });
	assert.deepStrictEqual(body.sourceMappings.map(m => [m.source, m.values.map(v => v.code)]), [['SAP', ['Single person', 'S1']]]);
	assert.deepStrictEqual([body.enabled, body.startDate, body.endDate], [true, 0, 0], 'a value without code fields is created enabled and unbounded');
	assert.strictEqual(body.sourceMappings[0].values[1].enabled, false, 'a mapping keeps its enabled flag');
}

// Several lookup types in one file: grouped, in order; the same code in two types is two values.
{
	const out = csv(file(
		codeRow('A'),
		codeRow('Billing', ADDR),
		mapRow('A', 'BvD', 'A', 'Acquired', 'true'),
		mapRow('A', 'BvD', 'A', 'Billing address', 'true', ADDR),
	));
	assert.deepStrictEqual(out.errors, []);
	assert.deepStrictEqual(out.types.map(t => [t.name, t.values.map(v => v.code)]), [
		['OrganizationStatuses', ['A']],
		['AddressTypes', ['Billing', 'A']],
	]);
	assert.deepStrictEqual(out.types[1].linesByCode.A, [5]);
}

// Parents, localizations and attributes: reported with their lines, never loaded.
{
	const out = csv(file(
		codeRow('A', ORG, { parents: 'rdm/lookupTypes/Parent/P' }),
		row({ code: 'A', type: ORG, 'localizations.languageCode': 'fr', 'localizations.value': 'Acquis' }),
		row({ code: 'A', type: ORG, 'attributes.name': 'n', 'attributes.value': 'v' }),
		row({ code: 'B', type: ORG, 'localizations.languageCode': 'de', 'localizations.value': 'Geschäft' }),
	));
	assert.deepStrictEqual(out.errors, []);
	assert.deepStrictEqual(out.warnings.map(w => w.lines), [[2], [3, 5], [4]]);
	assert.match(out.warnings[0].message, /^Line 2: parents are not loaded\. Only codes and their source mappings load from a CSV/);
	assert.match(out.warnings[1].message, /^Lines 3, 5: localizations are not loaded/);
	assert.match(out.warnings[2].message, /^Line 4: attributes are not loaded/);
	assert.deepStrictEqual(out.types[0].values, [
		{ code: 'A', mappings: [], enabled: true, startDate: 0, endDate: 0 },
		{ code: 'B', mappings: [] },
	], 'the codes still load; the unsupported parts do not');
}

// ---------------------------------------------------------------------------
// Tier A — errors and warnings, with lines
// ---------------------------------------------------------------------------

const errorsOf = text => csv(text).errors;

assert.match(errorsOf('Code,Source,Value at Source\nSingle,Reltio,S')[0].message, /earlier Code, Source, Value at Source layout/);
assert.match(errorsOf(`code,type\nA,${ORG}`)[0].message, /^Line 1: missing columns "sourceMappings.source", "sourceMappings.code", "sourceMappings.value"/);
assert.deepStrictEqual(errorsOf(`code,type\nA,${ORG}`)[0].lines, [1]);
assert.match(errorsOf(HEADER)[0].message, /no data rows/);
assert.match(errorsOf('')[0].message, /empty/);

{
	const errs = errorsOf(file(
		codeRow(''), // 2
		codeRow('A/B'), // 3
		codeRow('A', ''), // 4
		codeRow('A', 'rdm/entityTypes/X'), // 5
		codeRow('A', ORG, { enabled: 'maybe' }), // 6
		codeRow('A', ORG, { startDate: '2024-01-01' }), // 7
		mapRow('A', '', 'x', 'x', 'true'), // 8
		mapRow('A', 'BvD', '', '', 'true'), // 9
		mapRow('A', 'BvD', 'A', 'A', 'perhaps'), // 10
	));
	assert.deepStrictEqual(errs.map(e => e.lines[0]), [2, 3, 4, 5, 6, 7, 8, 9, 10]);
	const expected = [
		/^Line 2: "code" is empty/,
		/^Line 3: a code cannot contain "\/"/,
		/^Line 4: "type" is empty/,
		/^Line 5: "type" must name a lookup type/,
		/^Line 6: "enabled" must be/,
		/^Line 7: "startDate" must be a whole number/,
		/^Line 8: "sourceMappings.source" is empty/,
		/^Line 9: "sourceMappings.code" and "sourceMappings.value" are both empty/,
		/^Line 10: "sourceMappings.canonicalValue" must be/,
	];
	errs.forEach((e, i) => assert.match(e.message, expected[i]));
}
{
	const errs = errorsOf(file(codeRow('A'), mapRow('A', 'BvD', 'A', 'x', 'true'), codeRow('A'), mapRow('A', 'BvD', 'A', 'y', 'false')));
	assert.deepStrictEqual(errs.map(e => e.lines), [[2, 4], [3, 5]], 'both lines of a duplicate are named');
	assert.match(errs[0].message, /code "A" of OrganizationStatuses has enabled, startDate or endDate on two rows/);
	assert.match(errs[1].message, /code "A" of OrganizationStatuses maps BvD code "A" twice/);
}
assert.match(errorsOf(`${HEADER}\n"A,B,C`)[0].message, /never closed/);

// Limits.
{
	const rows = Array.from({ length: csvLib.MAX_CSV_ROWS + 1 }, (_, i) => codeRow(`C${i}`));
	assert.match(errorsOf(file(...rows))[0].message, /limit is 10000/);
	assert.match(readLookupCsv(SAMPLE, csvLib.MAX_CSV_BYTES + 1).errors[0].message, /larger than 2 MB/);
}

// Unknown sources: neither declared (by abbreviation) nor used by the lookup type.
{
	const out = csv(file(
		mapRow('A', 'Reltio', 'a', 'a', 'true'),
		mapRow('A', 'BVD', 'b', 'b', 'false'),
		mapRow('B', 'BVD', 'c', 'c', 'true'),
		mapRow('B', 'SAP', 'd', 'd', 'false'),
	));
	const config = { sources: [{ uri: 'rdm/sources/Reltio', abbreviation: 'Reltio' }, { uri: 'rdm/sources/DnB', abbreviation: 'BvD' }] };
	const current = [{ code: 'X', sourceMappings: [{ source: 'SAP' }] }];
	const warnings = unknownSourceWarnings(out.types[0], current, config);
	assert.strictEqual(warnings.length, 1, 'SAP is used by the lookup type; Reltio is declared');
	assert.deepStrictEqual(warnings[0].lines, [3, 4]);
	assert.match(warnings[0].message, /source "BVD" is not declared in the RDM configuration or used by OrganizationStatuses/);
}

// ---------------------------------------------------------------------------
// Tier A — lookup types from the type column
// ---------------------------------------------------------------------------

const CONFIG = {
	lookupTypes: [{ uri: 'rdm/lookupTypes/OrganizationStatuses' }, { uri: 'rdm/lookupTypes/AddressTypes' }],
	sources: [
		{ uri: 'rdm/sources/Reltio', abbreviation: 'Reltio' },
		{ uri: 'rdm/sources/BvD', abbreviation: 'BvD' },
		{ uri: 'rdm/sources/SAP', abbreviation: 'SAP' },
	],
};
{
	const { resolved, errors } = resolveLookupTypes(csv(SAMPLE), CONFIG);
	assert.deepStrictEqual(errors, []);
	assert.deepStrictEqual(resolved.get('OrganizationStatuses'), { name: 'OrganizationStatuses', uri: ORG });

	const near = resolveLookupTypes(csv(file(codeRow('A', 'rdm/lookupTypes/organizationstatuses'))), CONFIG).errors;
	assert.deepStrictEqual(near[0].lines, [2]);
	assert.match(near[0].message, /Did you mean "OrganizationStatuses"\? Correct the type column to rdm\/lookupTypes\/OrganizationStatuses/);
	assert.match(resolveLookupTypes(csv(file(codeRow('A', 'Genders'))), CONFIG).errors[0].message, /no lookup type "Genders"\. Add it/);
	assert.strictEqual(resolveLookupTypes(csv(SAMPLE), null).errors.length, 1);
}

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
const CSV_REL = 'data/RdmT_lookups_1793868681973.csv';

function makeDeps(over = {}, files = {}) {
	const calls = { fetch: [], post: [], approve: [], read: [] };
	const copy = v => JSON.parse(JSON.stringify(v));
	// What the RDM tenant holds, per lookup type.
	const server = new Map();
	const put = v => {
		const name = v.type.split('/').pop();
		if (!server.has(name)) server.set(name, new Map());
		server.get(name).set(v.code, copy(v));
	};
	(over.serverValues ?? []).forEach(put);
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
			return [...(server.get(type)?.values() ?? [])].map(copy);
		},
		postValues: async (service, rdmTenantId, body, token) => {
			calls.post.push({ service, rdmTenantId, body, token });
			body.forEach(put);
			return body.map(v => ({ uri: `${rdmTenantId}/${v.type.split('/').pop()}/${v.code}`, value: v }));
		},
		...over,
	};
	return { deps, calls, server };
}

/** B as stored: one canonical BvD mapping, and fields the merge must carry back. */
const bStored = () => ({
	tenantId: 'RdmT',
	type: ORG,
	code: 'B',
	enabled: true,
	sourceMappings: [{ source: 'BvD', values: [{ code: 'B', value: 'Business', enabled: true, canonicalValue: true, downStreamDefaultValue: true }] }],
	startDate: 0,
	endDate: 0,
	updatedBy: 'someone@example.com',
	version: 7,
});
const NO_CANONICAL_A = 'Code "A" of OrganizationStatuses has no canonical mapping.';

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

async function testIdentityAndLookupTypes() {
	// Identity fields in the request are ignored.
	const r = await run(request({ tenantId: 'Other', rdmTenantId: 'Evil', lookupType: 'AddressTypes', environment: 'prod' }));
	assert.strictEqual(r.result.status, 'planned');
	assert.deepStrictEqual(r.result.tenant, { environment: 'dev', tenantId: 'T1' });
	assert.strictEqual(r.result.rdmTenantId, 'RdmT');
	assert.deepStrictEqual(r.result.lookupTypes, ['OrganizationStatuses']);
	assert.deepStrictEqual(r.calls.fetch.map(f => [f.rdmTenantId, f.type]), [['RdmT', 'OrganizationStatuses']]);

	// A type the configuration lacks: named, with lines, before anything is fetched.
	const near = await run(request(), {}, { [`/ws/${CSV_REL}`]: file(codeRow('A', 'rdm/lookupTypes/organizationstatuses')) });
	assert.strictEqual(near.result.error.kind, 'unknown-lookup-type');
	assert.match(near.result.error.message, /Did you mean "OrganizationStatuses"/);
	assert.deepStrictEqual(near.result.errors[0].lines, [2]);
	assert.strictEqual(near.calls.fetch.length, 0);

	// The file name doesn't decide anything, but an export from another RDM tenant is said.
	const other = 'data/OtherRdm_lookups_1700000000000.csv';
	const moved = await run(request({ csvFile: other }), {}, { [`/ws/${other}`]: SAMPLE });
	assert.strictEqual(moved.result.status, 'planned');
	assert.match(moved.result.warnings[0].message, /was exported from RDM tenant OtherRdm; it loads into RdmT/);
	const plain = await run(request({ csvFile: 'data/statuses.csv' }), {}, { '/ws/data/statuses.csv': SAMPLE });
	assert.deepStrictEqual(plain.result.warnings.map(w => w.message), [NO_CANONICAL_A], 'any name works');
}

async function testPlan() {
	const r = await run(request(), { serverValues: [bStored()] });
	assert.strictEqual(r.result.status, 'planned');
	assert.deepStrictEqual(r.result.counts, { new: 3, append: 1, unchanged: 0 });
	assert.strictEqual(r.result.appendMappingCount, 1, 'SAP is added to B; BvD is already there');
	assert.deepStrictEqual(r.result.codes[1], { lookupType: 'OrganizationStatuses', code: 'B', lines: [4, 5, 6], classification: 'append' });
	assert.deepStrictEqual(r.result.codes.map(c => c.classification), ['new', 'append', 'new', 'new']);
	assert.deepStrictEqual(r.result.warnings.map(w => [w.lines, w.message]), [[[2, 3], NO_CANONICAL_A]], 'a new code with mappings but none canonical');
	assert.strictEqual(r.calls.post.length, 0, 'a plan never writes');
	assert.strictEqual(r.calls.approve.length, 0, 'a plan never prompts');

	// A conflicting row, a canonical flag and an enabled flag the stored value keeps: warnings with lines, never errors.
	const kept = await run(request(), { serverValues: [bStored()] }, {
		[`/ws/${CSV_REL}`]: file(
			codeRow('B', ORG, { enabled: 'false' }),
			mapRow('B', 'BvD', 'B', 'Biz', 'true'),
			mapRow('B', 'SAP', 'B', 'Business', 'true'),
		),
	});
	assert.deepStrictEqual(kept.result.errors, []);
	assert.deepStrictEqual(kept.result.codes.map(c => c.classification), ['append']);
	const [conflict, flag, field] = kept.result.warnings;
	assert.deepStrictEqual([conflict.lines, flag.lines, field.lines], [[3], [4], [2]]);
	assert.match(conflict.message, /B already maps BvD code "B" to "Business", not "Biz"\. The stored value is kept/);
	assert.match(flag.message, /already has a canonical value, so SAP is added as non-canonical/);
	assert.match(field.message, /B is stored with enabled true, not false\. Stored values are never changed/);

	const unchanged = await run(request(), { serverValues: [bStored()] }, { [`/ws/${CSV_REL}`]: file(mapRow('B', 'BvD', 'B', 'Business', 'true')) });
	assert.deepStrictEqual(unchanged.result.counts, { new: 0, append: 0, unchanged: 1 });

	const bad = await run(request(), {}, { [`/ws/${CSV_REL}`]: file(mapRow('B', 'BvD', 'B', 'x', 'true'), mapRow('B', 'BvD', 'B', 'y', 'true')) });
	assert.strictEqual(bad.result.status, 'planned');
	assert.strictEqual(bad.result.errors.length, 1);
	assert.match(bad.result.message, /must be fixed/);
}

async function testLoad() {
	// Errors: refused before any dialog or post.
	let r = await run(request({ mode: 'load' }), {}, { [`/ws/${CSV_REL}`]: file(mapRow('B', '', 'B', 'x', 'true')) });
	assert.strictEqual(r.result.error.kind, 'invalid-csv');
	assert.strictEqual(r.result.errors.length, 1);
	assert.strictEqual(r.calls.approve.length + r.calls.post.length, 0);

	// Not approved: nothing written.
	r = await run(request({ mode: 'load' }), { serverValues: [bStored()], approved: false });
	assert.strictEqual(r.result.status, 'cancelled');
	assert.deepStrictEqual(r.result.counts, { new: 3, append: 1, unchanged: 0 });
	assert.strictEqual(r.calls.post.length, 0);
	assert.deepStrictEqual(r.calls.approve, [{
		environmentName: 'dev', tenantId: 'T1', rdmTenantId: 'RdmT', lookupTypes: ['OrganizationStatuses'], csvFile: CSV_REL,
		newCount: 3, appendCount: 1, appendMappingCount: 1, unchangedCount: 0, warningCount: 1,
	}]);

	// Approved: one request, in CSV order — B merged, the rest created.
	r = await run(request({ mode: 'load' }), { serverValues: [bStored()] });
	assert.strictEqual(r.result.status, 'loaded');
	assert.strictEqual(r.calls.post.length, 1);
	const body = r.calls.post[0].body;
	assert.deepStrictEqual(body.map(v => v.code), ['A', 'B', 'Bankrupt', 'C']);
	const { sourceMappings, ...bRest } = body[1];
	const { sourceMappings: storedMappings, ...storedRest } = bStored();
	assert.deepStrictEqual(bRest, storedRest, 'the existing value is sent back as fetched, version included');
	assert.deepStrictEqual(sourceMappings[0], storedMappings[0], 'the stored BvD mapping is not changed');
	assert.deepStrictEqual(sourceMappings[1], {
		source: 'SAP',
		values: [{ code: 'B', value: 'Business', enabled: true, canonicalValue: false, downStreamDefaultValue: true }],
	}, 'only the missing mapping is appended');
	for (const v of [body[0], body[2], body[3]]) {
		assert.deepStrictEqual([v.tenantId, v.type, v.enabled, v.startDate, v.endDate], ['RdmT', ORG, true, 0, 0]);
	}
	assert.deepStrictEqual(body[2].sourceMappings, [], 'a code with no mappings is created as it is');
	assert.deepStrictEqual(body[3].sourceMappings, [
		{ source: 'BvD', values: [{ code: 'COMPANY', value: 'Company', enabled: true, canonicalValue: true, downStreamDefaultValue: true }] },
		{ source: 'SAP', values: [{ code: 'COMP', value: 'Comp', enabled: true, canonicalValue: false, downStreamDefaultValue: true }] },
	]);
	assert.deepStrictEqual(r.result.counts, { added: 3, appended: 1, unchanged: 0, 'not-stored': 0, 'not-sent': 0, unconfirmed: 0 });
	assert.deepStrictEqual(r.result.codes[1], { lookupType: 'OrganizationStatuses', code: 'B', lines: [4, 5, 6], outcome: 'appended' });
	assert.strictEqual(r.server.get('OrganizationStatuses').get('B').sourceMappings.length, 2);

	// A load without a plan still fetches first, then asks.
	assert.ok(r.calls.fetch.length >= 1 && r.calls.approve.length === 1);

	// Rerun against what was stored: every code unchanged, no dialog, nothing sent.
	r = await run(request({ mode: 'load' }), { serverValues: [...r.server.get('OrganizationStatuses').values()] });
	assert.strictEqual(r.result.status, 'loaded');
	assert.strictEqual(r.calls.approve.length, 0);
	assert.strictEqual(r.calls.post.length, 0);
	assert.strictEqual(r.result.counts.unchanged, 4);
}

async function testSeveralLookupTypes() {
	const files = {
		[`/ws/${CSV_REL}`]: file(
			codeRow('A'),
			mapRow('A', 'BvD', 'A', 'Acquired', 'true'),
			codeRow('A', ADDR, { enabled: 'false', startDate: '1700000000000' }),
			mapRow('A', 'SAP', 'A', 'Alternate', 'true', ADDR),
		),
	};
	let r = await run(request({ mode: 'load' }), {}, files);
	assert.strictEqual(r.result.status, 'loaded');
	assert.deepStrictEqual(r.result.lookupTypes, ['OrganizationStatuses', 'AddressTypes']);
	assert.deepStrictEqual(r.calls.approve[0].lookupTypes, ['OrganizationStatuses', 'AddressTypes']);
	assert.deepStrictEqual(r.calls.post.map(p => p.body.map(v => [v.type, v.code])), [[[ORG, 'A']], [[ADDR, 'A']]], 'one request per lookup type');
	assert.deepStrictEqual([r.calls.post[1].body[0].enabled, r.calls.post[1].body[0].startDate], [false, 1700000000000]);
	assert.deepStrictEqual(r.result.codes.map(c => [c.lookupType, c.code, c.outcome]), [
		['OrganizationStatuses', 'A', 'added'],
		['AddressTypes', 'A', 'added'],
	]);
	assert.deepStrictEqual(r.calls.fetch.map(f => f.type), ['OrganizationStatuses', 'AddressTypes', 'OrganizationStatuses', 'AddressTypes'], 'planned and re-fetched per type');

	// The second type fails: its A is not confirmed by the first type's A.
	r = await run(request({ mode: 'load' }), {
		postValues: async (service, id, body) => {
			if (body[0].type === ADDR) throw new ReltioApiError('HTTP 400: Invalid source', 400);
			return body.map(v => ({ uri: `x/${v.code}`, value: v }));
		},
	}, files);
	assert.deepStrictEqual(r.result.codes.map(c => c.outcome), ['added', 'not-stored']);
	assert.strictEqual(r.result.error.httpStatus, 400);

	// A type with nothing to add is not named in the dialog.
	const aStored = { tenantId: 'RdmT', type: ORG, code: 'A', enabled: true, sourceMappings: [{ source: 'BvD', values: [{ code: 'A', value: 'Acquired', canonicalValue: true }] }] };
	r = await run(request({ mode: 'load' }), { serverValues: [aStored], approved: false }, files);
	assert.deepStrictEqual(r.calls.approve[0].lookupTypes, ['AddressTypes']);
}

async function testChunksAndFailures() {
	const big = file(...Array.from({ length: 250 }, (_, i) => mapRow(`C${i}`, 'Reltio', `V${i}`, `V${i}`, 'true')));
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
	const approval = {
		environmentName: 'dev', tenantId: 'T1', rdmTenantId: 'RdmT', lookupTypes: ['OrganizationStatuses'],
		csvFile: CSV_REL, newCount: 1, appendCount: 2, appendMappingCount: 3, unchangedCount: 0, warningCount: 1,
	};
	const t = bridge.approvalText(approval);
	assert.strictEqual(t.message, 'Load into OrganizationStatuses?');
	assert.strictEqual(
		t.detail,
		`1 new code, and 3 new mappings for 2 existing codes. Nothing stored is changed or removed. Tenant T1 on dev, RDM tenant RdmT, from ${CSV_REL}. 0 codes already stored. 1 warning.`,
	);
	const several = bridge.approvalText({ ...approval, lookupTypes: ['OrganizationStatuses', 'AddressTypes'] });
	assert.strictEqual(several.message, 'Load into 2 lookup types?');
	assert.ok(several.detail.startsWith('OrganizationStatuses, AddressTypes. 1 new code'), 'every lookup type is named');
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
	assert.ok(skill.includes('sourceMappings.canonicalValue') && skill.includes('`type`'), 'the skill documents the export format');
	assert.ok(!/named after the lookup type/.test(skill), 'the file name no longer names the lookup type');

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
	await testIdentityAndLookupTypes();
	await testPlan();
	await testLoad();
	await testSeveralLookupTypes();
	await testChunksAndFailures();
	await testNoTokenInResults();
	console.log('test-rdm-lookup-csv-load: OK');
})().catch(e => {
	console.error(e);
	process.exit(1);
});
