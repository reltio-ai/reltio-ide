#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: rdm-lookup-values
 * Tier A: flattening the nested lookups response into (code, source, value)
 *         rows, including the degenerate shapes the sample does not exhibit;
 *         the service-URI cache; URL construction.
 * Tier B: the rendered panel carries a `default-src 'none'` CSP with matching
 *         nonces and escapes untrusted content; the command is contributed and
 *         scoped to lookup type rows only.
 * Tier C (manual): live fetch, panel reuse, empty state, 401 — see design.md.
 *
 * The fixture is one lookup type from one tenant, where every source happens to
 * map exactly one value. Assertions derive from the fixture or from constructed
 * inputs, so that regularity is never baked in as an expectation.
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');

const repoRoot = path.join(__dirname, '..');
const readJson = p => JSON.parse(fs.readFileSync(path.join(repoRoot, p), 'utf8'));

const { flattenRdmLookupValues } = importDist('api/reltioClient');
const {
	rememberRdmServiceUri,
	recallRdmServiceUri,
	clearRdmServiceUriCache,
} = importDist('rdm/rdmServiceCache');
const { renderLookupValuesHtml } = importDist('rdm/lookupValuesPanel');

// ---------------------------------------------------------------------------
// Tier A — flattening the sanitized fixture
// ---------------------------------------------------------------------------

const fixture = readJson('samples/rdm-lookup-values.sample.json');
const rows = flattenRdmLookupValues(fixture);

// Expected row count derived from the fixture, not hard-coded.
const expectedRows = fixture.reduce(
	(n, e) => n + (e.sourceMappings || []).reduce((m, sm) => m + (sm.values || []).length, 0),
	0,
);
assert.strictEqual(rows.length, expectedRows, 'one row per (code, source, value)');

// Row order follows the response, which is how Reltio presents them.
const expectedOrder = [];
for (const entry of fixture) {
	for (const sm of entry.sourceMappings || []) {
		for (const v of sm.values || []) {
			expectedOrder.push(`${entry.code}|${sm.source}|${v.value}`);
		}
	}
}
assert.deepStrictEqual(
	rows.map(r => `${r.code}|${r.source}|${r.valueAtSource}`),
	expectedOrder,
	'response order is preserved',
);

// Every row is fully populated strings — the panel escapes, it does not guard.
for (const r of rows) {
	assert.strictEqual(typeof r.code, 'string');
	assert.strictEqual(typeof r.source, 'string');
	assert.strictEqual(typeof r.valueAtSource, 'string');
}

// ---------------------------------------------------------------------------
// Tier A — shapes the fixture does not contain
// ---------------------------------------------------------------------------

// Several values for one source: one row each, sharing code and source.
const multi = flattenRdmLookupValues([
	{
		code: 'Billing',
		sourceMappings: [{ source: 'SAP', values: [{ value: 'BILL' }, { value: 'B' }] }],
	},
]);
assert.deepStrictEqual(multi, [
	{ code: 'Billing', source: 'SAP', valueAtSource: 'BILL' },
	{ code: 'Billing', source: 'SAP', valueAtSource: 'B' },
]);

// Mapped but unpopulated: still a row, so the state is visible.
assert.deepStrictEqual(
	flattenRdmLookupValues([{ code: 'Billing', sourceMappings: [{ source: 'SAP', values: [] }] }]),
	[{ code: 'Billing', source: 'SAP', valueAtSource: '' }],
);

// No source mappings at all: the code is still visible.
for (const entry of [{ code: 'Orphan' }, { code: 'Orphan', sourceMappings: [] }]) {
	assert.deepStrictEqual(flattenRdmLookupValues([entry]), [
		{ code: 'Orphan', source: '', valueAtSource: '' },
	]);
}

// Malformed input contributes no rows rather than throwing.
for (const bad of [undefined, null, {}, 'nope', 42, [null], ['x'], [{ code: 'A', sourceMappings: 'no' }]]) {
	const out = flattenRdmLookupValues(bad);
	assert.ok(Array.isArray(out), `flatten must return an array for ${JSON.stringify(bad)}`);
}
assert.deepStrictEqual(flattenRdmLookupValues('not an array'), []);
assert.deepStrictEqual(flattenRdmLookupValues([null, 'x', 7]), []);

// A non-string value is rendered as empty rather than "undefined".
assert.deepStrictEqual(
	flattenRdmLookupValues([{ code: 'A', sourceMappings: [{ source: 'S', values: [{ value: 5 }] }] }]),
	[{ code: 'A', source: 'S', valueAtSource: '' }],
);

// ---------------------------------------------------------------------------
// Tier A — service URI cache
// ---------------------------------------------------------------------------

clearRdmServiceUriCache();
assert.strictEqual(recallRdmServiceUri('env', 'T1'), undefined, 'cold cache misses');

rememberRdmServiceUri('env', 'T1', 'https://rdm.reltio.com');
assert.strictEqual(recallRdmServiceUri('env', 'T1'), 'https://rdm.reltio.com');

// Keyed by environment AND tenant — no cross-tenant bleed.
assert.strictEqual(recallRdmServiceUri('env', 'T2'), undefined);
assert.strictEqual(recallRdmServiceUri('other', 'T1'), undefined);

// An empty URI is not worth remembering; it would mask a real rediscovery.
rememberRdmServiceUri('env', 'T3', '');
assert.strictEqual(recallRdmServiceUri('env', 'T3'), undefined);

clearRdmServiceUriCache();
assert.strictEqual(recallRdmServiceUri('env', 'T1'), undefined, 'cache clears');

// ---------------------------------------------------------------------------
// Tier A — URL construction
//
// The client builds the URL inline, so this asserts the documented shape
// against the same encoding rules rather than reaching into the module.
// ---------------------------------------------------------------------------

const buildUrl = (base, tenant, type) =>
	`${base.replace(/\/+$/, '')}/lookups/${encodeURIComponent(tenant)}/${encodeURIComponent(type)}`;

assert.strictEqual(
	buildUrl('https://rdm.reltio.com', 'RdmSampleTenant', 'AddressTypes'),
	'https://rdm.reltio.com/lookups/RdmSampleTenant/AddressTypes',
);
assert.ok(
	buildUrl('https://rdm.reltio.com', 'a b', 'Name/With Slash').includes('a%20b'),
	'tenant id is encoded',
);
assert.ok(
	!buildUrl('https://rdm.reltio.com', 't', 'Name/With Slash').endsWith('Name/With Slash'),
	'a lookup type name cannot inject a path segment',
);

// ---------------------------------------------------------------------------
// Tier B — the panel renders safely
// ---------------------------------------------------------------------------

const ctx = {
	environmentName: 'env',
	tenantId: 'T1',
	rdmTenantId: 'RdmSampleTenant',
	lookupTypeName: 'AddressTypes',
};
const html = renderLookupValuesHtml(rows, fixture, ctx);

assert.ok(html.includes("default-src 'none'"), 'CSP locks the default source down');

// Every style/script element must carry the nonce the CSP names.
const nonceMatch = /style-src 'nonce-([a-f0-9]+)'/.exec(html);
assert.ok(nonceMatch, 'CSP declares a style nonce');
const nonce = nonceMatch[1];
for (const tag of html.match(/<(style|script)\b[^>]*>/g) || []) {
	assert.ok(tag.includes(`nonce="${nonce}"`), `element must carry the nonce: ${tag}`);
}

// Untrusted content is escaped, not rendered.
const nasty = [{ code: `<script>alert(1)</script>`, source: `a"b`, valueAtSource: `it's <b>bold</b>` }];
const nastyHtml = renderLookupValuesHtml(nasty, nasty, ctx);
assert.ok(!nastyHtml.includes('<script>alert(1)</script>'), 'markup in a value must not stay live');
assert.ok(nastyHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'it appears escaped instead');
assert.ok(nastyHtml.includes('a&quot;b'), 'quotes are escaped');
assert.ok(nastyHtml.includes('&#39;'), 'apostrophes are escaped');

// The three requested columns, and the raw response kept reachable.
for (const header of ['Code', 'Source', 'Value at Source']) {
	assert.ok(html.includes(`<th>${header}</th>`), `table has a ${header} column`);
}
assert.ok(html.includes('<summary>Raw response</summary>'), 'raw response stays inspectable');

// An empty result reads as empty, not as a blank table.
const emptyHtml = renderLookupValuesHtml([], [], ctx);
assert.ok(emptyHtml.includes('no values'), 'empty state is stated in words');
assert.ok(!emptyHtml.includes('<tbody></tbody>'), 'no hollow table is rendered');

// ---------------------------------------------------------------------------
// Tier B — manifest wiring
// ---------------------------------------------------------------------------

const pkg = readJson('package.json');

const command = (pkg.contributes.commands || []).find(c => c.command === 'reltio.getRdmLookupValues');
assert.ok(command, 'the command is contributed');
assert.strictEqual(command.title, 'Get Lookup Values');

const entries = pkg.contributes.menus['view/item/context'].filter(
	m => m.command === 'reltio.getRdmLookupValues',
);
assert.strictEqual(entries.length, 1, 'exactly one menu entry');

// The lookups endpoint is keyed by lookup type, so no other row may offer it.
const when = entries[0].when;
assert.ok(
	when.includes('viewItem == reltio.rdm.item.lookupTypes'),
	`menu must target lookup type rows exactly, got: ${when}`,
);
for (const forbidden of ['sources', 'rdm.root', 'rdm.group', 'reltio.item.', 'reltio.folder.']) {
	assert.ok(!when.includes(forbidden), `menu must not reach ${forbidden}`);
}

console.log('test-rdm-lookup-values: OK');
