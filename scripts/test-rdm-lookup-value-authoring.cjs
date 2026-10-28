#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: rdm-lookup-value-authoring
 * Tier A: parsing and validating what the panel submits; building the
 *         create body; the existing-code check; reconciling submitted codes
 *         against the create response and a re-fetch; source suggestions.
 * Tier B: the rendered panel's policy, script and inertness; the request
 *         `postRdmLookupValues` actually sends; the order of checks in the
 *         extension's handler; no command added.
 * Tier C (manual): live tenant — see design.md.
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');

const repoRoot = path.join(__dirname, '..');
const readText = p => fs.readFileSync(path.join(repoRoot, p), 'utf8');

const {
	parseLookupValuesMessage,
	validateLookupValues,
	buildLookupValuesCreateBody,
	codesInCreateResponse,
	MAX_LOOKUP_VALUES_PER_REQUEST,
	findExistingCodes,
	mergeLookupValue,
	planLookupValues,
	storedCodes,
	describeConflicts,
	describeSubmissionOutcome,
	sourceSuggestions,
} = importDist('rdm/lookupValueDraft');
const { renderLookupValuesHtml } = importDist('rdm/lookupValuesPanel');
const { postRdmLookupValues, ReltioApiError } = importDist('api/reltioClient');

const mapping = (source, value, extra = {}) => ({
	source,
	code: '',
	value,
	canonicalValue: false,
	downStreamDefaultValue: true,
	...extra,
});
const submit = values => ({ type: 'submitLookupValues', render: 'r1', values });

// ---------------------------------------------------------------------------
// Tier A — message shape
// ---------------------------------------------------------------------------

assert.deepStrictEqual(parseLookupValuesMessage({ type: 'ready', render: 'r1' }), { kind: 'ready', render: 'r1' });

const one = parseLookupValuesMessage(submit([{ code: 'HOME', mappings: [mapping('DnB', 'Home')] }]));
assert.strictEqual(one.kind, 'submit');
assert.strictEqual(one.render, 'r1');
assert.deepStrictEqual(one.values, [{ code: 'HOME', mappings: [mapping('DnB', 'Home')] }]);

// Malformed messages are ignored outright: no errors, no request.
const malformed = [
	undefined,
	null,
	'submitLookupValues',
	[],
	{ type: 'ready' }, // no render token
	{ type: 'ready', render: 7 },
	{ type: 'nope', render: 'r1' },
	{ type: 'submitLookupValues', render: 'r1' },
	{ type: 'submitLookupValues', render: 'r1', values: 'HOME' },
	submit(['HOME']),
	submit([{ code: 5, mappings: [] }]),
	submit([{ code: 'HOME' }]),
	submit([{ code: 'HOME', mappings: [null] }]),
	submit([{ code: 'HOME', mappings: [{ ...mapping('DnB', 'Home'), canonicalValue: 'true' }] }]),
	submit([{ code: 'HOME', mappings: [{ ...mapping('DnB', 'Home'), downStreamDefaultValue: 1 }] }]),
	submit([{ code: 'HOME', mappings: [{ ...mapping('DnB', 'Home'), value: null }] }]),
	submit([{ code: 'HOME', mappings: [{ source: 'DnB', value: 'Home', canonicalValue: true, downStreamDefaultValue: true }] }]),
];
for (const m of malformed) {
	assert.strictEqual(parseLookupValuesMessage(m), undefined, `must be ignored: ${JSON.stringify(m)}`);
}

// Only known fields survive: a message cannot carry its own target.
const smuggled = parseLookupValuesMessage({
	...submit([{ code: 'HOME', tenantId: 'Other', type: 'rdm/lookupTypes/Other', mappings: [{ ...mapping('DnB', 'Home'), uri: 'x' }] }]),
	tenantId: 'Other',
	rdmTenantId: 'Other',
	lookupTypeName: 'Other',
});
assert.strictEqual(smuggled.kind, 'submit');
assert.deepStrictEqual(Object.keys(smuggled), ['kind', 'render', 'values']);
assert.deepStrictEqual(Object.keys(smuggled.values[0]).sort(), ['code', 'mappings']);
assert.deepStrictEqual(
	Object.keys(smuggled.values[0].mappings[0]).sort(),
	['canonicalValue', 'code', 'downStreamDefaultValue', 'source', 'value'],
);

// Text is trimmed before it is checked or sent.
const padded = parseLookupValuesMessage(
	submit([{ code: '  HOME ', mappings: [{ ...mapping(' DnB ', ' Home '), code: ' HM ' }] }]),
);
assert.deepStrictEqual(padded.values[0], {
	code: 'HOME',
	mappings: [{ ...mapping('DnB', 'Home'), code: 'HM' }],
});

// ---------------------------------------------------------------------------
// Tier A — content rules (design D6)
// ---------------------------------------------------------------------------

const errorsFor = values => {
	const parsed = parseLookupValuesMessage(submit(values));
	assert.strictEqual(parsed.kind, 'rejected', `expected rejection for ${JSON.stringify(values)}`);
	return parsed.errors;
};
const ok = values => assert.strictEqual(parseLookupValuesMessage(submit(values)).kind, 'submit');

assert.deepStrictEqual(errorsFor([]), ['Add at least one code.']);
assert.deepStrictEqual(errorsFor([{ code: '   ', mappings: [mapping('DnB', 'x')] }]), ['Code 1: enter a code.']);
assert.match(errorsFor([{ code: 'A/B', mappings: [mapping('DnB', 'x')] }])[0], /^Code 1 \(A\/B\): .*"\/"/);
assert.deepStrictEqual(errorsFor([{ code: 'HOME', mappings: [] }]), ['Code 1 (HOME): add at least one source mapping.']);

// Errors name the block by position and code, and the mapping by position.
assert.deepStrictEqual(
	errorsFor([
		{ code: 'WORK', mappings: [mapping('DnB', 'Work')] },
		{ code: 'HOME', mappings: [mapping('DnB', '')] },
	]),
	['Code 2 (HOME): mapping 1 has no value.'],
);
assert.deepStrictEqual(errorsFor([{ code: 'HOME', mappings: [mapping('', 'Home')] }]), [
	'Code 1 (HOME): mapping 1 has no source.',
]);

// The same code twice in one batch.
assert.deepStrictEqual(
	errorsFor([
		{ code: 'HOME', mappings: [mapping('DnB', 'Home')] },
		{ code: 'WORK', mappings: [mapping('DnB', 'Work')] },
		{ code: 'HOME', mappings: [mapping('SAP', 'H')] },
	]),
	['Code 3 (HOME): the same code is already in code 1.'],
);
// Exact match, as on the server: codes differing only in case are distinct.
ok([
	{ code: 'HOME', mappings: [mapping('DnB', 'Home')] },
	{ code: 'home', mappings: [mapping('DnB', 'home')] },
]);

// The same source twice within one code is rejected; across codes it is normal.
assert.deepStrictEqual(
	errorsFor([{ code: 'HOME', mappings: [mapping('DnB', 'Home'), mapping('SAP', 'H'), mapping('DnB', 'Hm')] }]),
	['Code 1 (HOME): source "DnB" is in mappings 1 and 3.'],
);
ok([
	{ code: 'HOME', mappings: [mapping('DnB', 'Home')] },
	{ code: 'WORK', mappings: [mapping('DnB', 'Work')] },
]);

// Every problem is reported at once, not just the first.
assert.strictEqual(
	errorsFor([
		{ code: '', mappings: [] },
		{ code: 'X', mappings: [mapping('', '')] },
	]).length,
	4,
);

// How many mappings are canonical is the service's rule, not ours.
ok([{ code: 'HOME', mappings: [mapping('DnB', 'H', { canonicalValue: true }), mapping('SAP', 'H', { canonicalValue: true })] }]);
ok([{ code: 'HOME', mappings: [mapping('DnB', 'H'), mapping('SAP', 'H')] }]);

assert.deepStrictEqual(validateLookupValues([{ code: 'HOME', mappings: [mapping('DnB', 'Home')] }]), []);

// At most 100 codes per submission — the create endpoint's documented maximum.
assert.strictEqual(MAX_LOOKUP_VALUES_PER_REQUEST, 100);
const codesBlock = n => Array.from({ length: n }, (_, i) => ({ code: `C${i}`, mappings: [mapping('DnB', `V${i}`)] }));
ok(codesBlock(100));
assert.deepStrictEqual(errorsFor(codesBlock(101)), ['At most 100 codes can be added at once; this form has 101.']);

// ---------------------------------------------------------------------------
// Tier A — the request body (design D3, D8)
// ---------------------------------------------------------------------------

const target = {
	rdmTenantId: 'RdmSampleTenant',
	lookupTypeName: 'AddressTypes',
	lookupTypeUri: 'rdm/lookupTypes/AddressTypes',
};

// The supplied PRIMARY example, as the form would submit it.
const primary = {
	code: 'PRIMARY',
	mappings: [
		{ source: 'ReltioCleanser', code: 'PRIMARY', value: 'Primary', canonicalValue: true, downStreamDefaultValue: true },
		{ source: 'DnB', code: 'PRIM', value: 'Prim', canonicalValue: false, downStreamDefaultValue: true },
	],
};
// A plain lookup object per code — the shape of the team's working
// "Update RDM Lookup Mapping" request — not the `{ uri, value }` wrapper the
// service returns.
assert.deepStrictEqual(buildLookupValuesCreateBody([primary], target), [
	{
		tenantId: 'RdmSampleTenant',
		type: 'rdm/lookupTypes/AddressTypes',
		code: 'PRIMARY',
		enabled: true,
		sourceMappings: [
			{
				source: 'ReltioCleanser',
				values: [{ code: 'PRIMARY', value: 'Primary', enabled: true, canonicalValue: true, downStreamDefaultValue: true }],
			},
			{
				source: 'DnB',
				values: [{ code: 'PRIM', value: 'Prim', enabled: true, canonicalValue: false, downStreamDefaultValue: true }],
			},
		],
		startDate: 0,
		endDate: 0,
	},
]);

// Neither the response wrapper nor server-managed fields are sent.
assert.deepStrictEqual(
	Object.keys(buildLookupValuesCreateBody([primary], target)[0]).sort(),
	['code', 'enabled', 'endDate', 'sourceMappings', 'startDate', 'tenantId', 'type'],
	'a plain lookup object, not { uri, value }',
);
const sent = JSON.stringify(buildLookupValuesCreateBody([primary], target));
for (const field of ['updatedBy', 'updateDate', 'version', 'operation']) {
	assert.ok(!sent.includes(`"${field}":`), `${field} must not be sent`);
}

// `type` is the carried URI, not one rebuilt from the name.
const unusualUri = { ...target, lookupTypeUri: 'rdm/lookupTypes/Custom.AddressTypes' };
assert.strictEqual(buildLookupValuesCreateBody([primary], unusualUri)[0].type, 'rdm/lookupTypes/Custom.AddressTypes');

// A blank code at the source means "same as the value's code".
const defaulted = buildLookupValuesCreateBody([{ code: 'HOME', mappings: [mapping('DnB', 'Home')] }], target);
assert.strictEqual(defaulted[0].sourceMappings[0].values[0].code, 'HOME');

// Several codes: one element each, in form order, mapping order kept.
const batch = [
	{ code: 'WORK', mappings: [mapping('DnB', 'Work'), mapping('SAP', 'W')] },
	{ code: 'HOME', mappings: [mapping('SAP', 'H')] },
	{ code: 'MAILING', mappings: [mapping('DnB', 'Mailing')] },
];
const batchBody = buildLookupValuesCreateBody(batch, target);
assert.deepStrictEqual(batchBody.map(e => e.code), ['WORK', 'HOME', 'MAILING']);
assert.ok(batchBody.every(e => e.tenantId === 'RdmSampleTenant' && e.type === 'rdm/lookupTypes/AddressTypes'));
assert.deepStrictEqual(batchBody[0].sourceMappings.map(m => m.source), ['DnB', 'SAP']);

// ---------------------------------------------------------------------------
// Tier A — existing codes: append, never replace (design D9)
// ---------------------------------------------------------------------------

const serverHas = codes => codes.map(code => ({ code, sourceMappings: [] }));
const createdAs = codes => codes.map(code => ({ uri: `RdmSampleTenant/AddressTypes/${code}`, value: { code } }));

assert.deepStrictEqual(findExistingCodes(['HOME', 'WORK', 'PRIMARY'], serverHas(['PRIMARY', 'Billing'])), ['PRIMARY']);
assert.deepStrictEqual(findExistingCodes(['home'], serverHas(['HOME'])), [], 'exact match only');
for (const bad of [undefined, null, {}, 'x', [null, 7, { code: 3 }]]) {
	assert.deepStrictEqual(findExistingCodes(['HOME'], bad), []);
}
assert.deepStrictEqual([...codesInCreateResponse(createdAs(['X', 'Y']))], ['X', 'Y']);
assert.deepStrictEqual([...codesInCreateResponse([{ code: 'Bare' }])], ['Bare'], 'a bare lookup object is read too');

// The reported case: code A exists with a canonical Reltio mapping; the form adds DnB.
const storedA = () => ({
	tenantId: 'RdmSampleTenant',
	type: 'rdm/lookupTypes/OrganizationStatuses',
	code: 'A',
	enabled: true,
	localizations: [{ languageCode: 'fr', value: 'Acquise' }],
	sourceMappings: [
		{ source: 'Reltio', values: [{ code: 'A', value: 'Acquired', enabled: true, canonicalValue: true, downStreamDefaultValue: true }] },
	],
	startDate: 0,
	endDate: 0,
	updatedBy: 'someone@example.com',
	updateDate: 1700000000000,
	version: 3,
});
{
	const stored = storedA();
	const draft = { code: 'A', mappings: [mapping('DnB', 'Acquired', { canonicalValue: true })] };
	const merge = mergeLookupValue(stored, draft);
	assert.deepStrictEqual(stored, storedA(), 'the fetched value is not mutated');
	const { sourceMappings, ...rest } = merge.merged;
	const { sourceMappings: storedMappings, ...storedRest } = storedA();
	assert.deepStrictEqual(rest, storedRest, 'every other field is sent as fetched, version included');
	assert.deepStrictEqual(sourceMappings[0], storedMappings[0], 'the stored Reltio mapping is untouched');
	assert.deepStrictEqual(sourceMappings[1], {
		source: 'DnB',
		values: [{ code: 'A', value: 'Acquired', enabled: true, canonicalValue: false, downStreamDefaultValue: true }],
	}, 'DnB is appended, its code defaulting to the value code');
	assert.deepStrictEqual(merge.appended, [{ source: 'DnB', code: 'A' }]);
	assert.deepStrictEqual(merge.flagsDropped.map(f => f.flag), ['canonical'], 'A already has a canonical value');
	assert.deepStrictEqual([merge.alreadyPresent, merge.conflicts], [[], []]);
}

// Same source and code, same value: already present, nothing to send.
{
	const merge = mergeLookupValue(storedA(), { code: 'A', mappings: [{ ...mapping('Reltio', 'Acquired'), code: 'A' }] });
	assert.strictEqual(merge.merged, undefined);
	assert.deepStrictEqual(merge.alreadyPresent.map(n => [n.source, n.code]), [['Reltio', 'A']]);
}

// Same source and code, other value: a conflict; the stored value stays.
{
	const merge = mergeLookupValue(storedA(), { code: 'A', mappings: [mapping('Reltio', 'Active')] });
	assert.strictEqual(merge.merged, undefined);
	assert.deepStrictEqual(merge.conflicts, [{ valueCode: 'A', index: 0, source: 'Reltio', code: 'A', storedValue: 'Acquired', value: 'Active' }]);
	assert.match(describeConflicts(merge.conflicts), /Nothing was sent\. A: Reltio code "A" is stored as "Acquired", not "Active"/);
}

// A new code at an existing source joins that source's values; the source keeps its downstream default.
{
	const merge = mergeLookupValue(storedA(), { code: 'A', mappings: [{ ...mapping('Reltio', 'Acq'), code: 'ACQ' }] });
	assert.deepStrictEqual(merge.merged.sourceMappings[0].values.map(v => [v.code, v.downStreamDefaultValue]), [['A', true], ['ACQ', false]]);
	assert.deepStrictEqual(merge.flagsDropped.map(f => f.flag), ['downstream default']);
}

// A code with no canonical value takes the appended one as canonical.
{
	const stored = storedA();
	stored.sourceMappings[0].values[0].canonicalValue = false;
	const merge = mergeLookupValue(stored, { code: 'A', mappings: [mapping('DnB', 'Acquired', { canonicalValue: true })] });
	assert.strictEqual(merge.merged.sourceMappings[1].values[0].canonicalValue, true);
	assert.deepStrictEqual(merge.flagsDropped, []);
}

// The plan: new codes are created, existing ones appended to or left alone, in submission order.
const orgTarget = { rdmTenantId: 'RdmSampleTenant', lookupTypeName: 'OrganizationStatuses', lookupTypeUri: 'rdm/lookupTypes/OrganizationStatuses' };
const draftA = { code: 'A', mappings: [mapping('DnB', 'Acquired')] };
const draftNew = { code: 'NEW', mappings: [mapping('Reltio', 'New')] };
const draftSame = { code: 'A', mappings: [{ ...mapping('Reltio', 'Acquired'), code: 'A' }] };
{
	const plan = planLookupValues([draftA, draftNew], [storedA()], orgTarget);
	assert.deepStrictEqual(plan.items.map(i => i.kind), ['append', 'new']);
	assert.deepStrictEqual(plan.items[1].element, buildLookupValuesCreateBody([draftNew], orgTarget)[0]);
	assert.strictEqual(plan.items[0].element.version, 3);
	assert.deepStrictEqual(plan.items[0].expect, [{ source: 'DnB', code: 'A' }], 'an append only expects what it adds');
	assert.deepStrictEqual(planLookupValues([draftSame], [storedA()], orgTarget).items.map(i => [i.kind, i.element]), [['unchanged', undefined]]);
}

// Stored means: the code is there with every requested mapping.
{
	const withDnB = [{ ...storedA(), sourceMappings: [...storedA().sourceMappings, { source: 'DnB', values: [{ code: 'A', value: 'Acquired' }] }] }];
	const expect = [{ code: 'A', mappings: [{ source: 'DnB', code: 'A' }] }];
	assert.deepStrictEqual([...storedCodes([[storedA()]], expect)], [], 'present without the mapping is not stored');
	assert.deepStrictEqual([...storedCodes([withDnB], expect)], ['A']);
	assert.deepStrictEqual([...storedCodes([withDnB.map(v => ({ uri: 'x', value: v }))], expect)], ['A'], 'create-response shape');
}

// What the panel says afterwards.
{
	const plan = planLookupValues([draftA, draftNew], [storedA()], orgTarget);
	const both = [
		{ ...storedA(), sourceMappings: [...storedA().sourceMappings, { source: 'DnB', values: [{ code: 'A', value: 'Acquired' }] }] },
		{ code: 'NEW', sourceMappings: [{ source: 'Reltio', values: [{ code: 'NEW', value: 'New' }] }] },
	];
	const ok = describeSubmissionOutcome(plan, both, undefined);
	assert.deepStrictEqual(ok.remaining, []);
	assert.match(ok.message, /^Added 1 new value \(NEW\)\. Added mappings to A\./);

	const lost = describeSubmissionOutcome(plan, [storedA(), both[1]], undefined);
	assert.deepStrictEqual(lost.remaining, [draftA], 'an append that did not land stays in the form');
	assert.match(lost.message, /Not stored: A; the service accepted the request but did not store it\./);

	const lagging = describeSubmissionOutcome(plan, [storedA(), both[1]], undefined, [{ uri: 'x', value: both[0] }]);
	assert.deepStrictEqual(lagging.remaining, []);
	assert.match(lagging.message, /A may take a moment to appear in the table/);

	const failed = describeSubmissionOutcome(plan, [storedA()], 'HTTP 500: boom');
	assert.match(failed.message, /^Nothing was added\. Not stored: A, NEW\. The service reported: HTTP 500: boom/);

	const dropped = planLookupValues([{ code: 'A', mappings: [mapping('DnB', 'Acquired', { canonicalValue: true })] }], [storedA()], orgTarget);
	assert.match(describeSubmissionOutcome(dropped, both, undefined).message, /DnB on A was added as non-canonical: A already has a canonical value\./);

	const nothing = planLookupValues([draftSame], [storedA()], orgTarget);
	assert.match(describeSubmissionOutcome(nothing, [storedA()], undefined).message, /A already had every mapping/);
}

// ---------------------------------------------------------------------------
// Tier A — source suggestions
// ---------------------------------------------------------------------------

assert.deepStrictEqual(
	sourceSuggestions(
		[{ code: 'A', sourceMappings: [{ source: 'Reltio' }, { source: 'DnB' }, { source: ' ' }, null] }, 'x'],
		{ sources: [{ uri: 'rdm/sources/BvD' }, { uri: 'rdm/sources/DnB' }, { label: 'no uri' }, 5] },
	),
	['BvD', 'DnB', 'Reltio'],
	'union of both, de-duplicated and sorted',
);

// A mapping's `source` must match the source's abbreviation, so that is what is
// suggested; the uri segment only stands in when there is no abbreviation.
assert.deepStrictEqual(
	sourceSuggestions(undefined, {
		sources: [
			{ uri: 'rdm/sources/DunAndBradstreet', abbreviation: 'DnB' },
			{ uri: 'rdm/sources/Salesforce', abbreviation: ' ' },
			{ uri: 'rdm/sources/SAP' },
		],
	}),
	['DnB', 'Salesforce', 'SAP'],
);
assert.deepStrictEqual(sourceSuggestions(undefined, undefined), []);
assert.deepStrictEqual(sourceSuggestions('x', { sources: 'x' }), []);

// ---------------------------------------------------------------------------
// Tier B — the rendered panel (design D1)
// ---------------------------------------------------------------------------

const ctx = { rdmTenantId: 'RdmSampleTenant', lookupTypeName: 'AddressTypes' };
const rows = [{ code: 'Billing', source: 'DnB', valueAtSource: 'Billing' }];
const html = renderLookupValuesHtml(rows, [], ctx, { renderToken: 'abc123', sourceSuggestions: ['DnB', 'SAP'] });

const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)[1];
const nonce = /script-src 'nonce-([a-f0-9]+)'/.exec(csp)[1];
assert.strictEqual(
	csp,
	`default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';`,
	'nothing but nonce-gated styles and scripts',
);

const scriptTags = html.match(/<script\b[^>]*>/g) || [];
assert.strictEqual(scriptTags.length, 1, 'exactly one script');
assert.strictEqual(scriptTags[0], `<script nonce="${nonce}">`, 'inline and nonce-gated, no src');
for (const tag of html.match(/<style\b[^>]*>/g)) {
	assert.ok(tag.includes(`nonce="${nonce}"`));
}

// No inline handlers on any element (the script body itself is not markup).
const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
for (const tag of markup.match(/<[a-zA-Z][^>]*>/g)) {
	assert.ok(!/\son[a-z]+\s*=/i.test(tag), `no inline handler: ${tag}`);
}

for (const id of ['addValue', 'addCode', 'submit', 'cancel']) {
	assert.ok(markup.includes(`id="${id}"`), `${id} control present`);
}
assert.ok(/<button type="button" id="addValue">Add Value<\/button>/.test(markup));
assert.ok(/<button type="button" id="addCode"[^>]*>Add Code<\/button>/.test(markup));
assert.ok(/<form id="addForm" hidden/.test(markup), 'the form starts hidden');
assert.ok(markup.includes('<body data-render="abc123">'), 'the render token is on the page');
assert.ok(markup.includes('<option value="DnB"></option><option value="SAP"></option>'), 'suggestions offered');

// The existing read-only view is unchanged.
for (const header of ['Code', 'Source', 'Value at Source']) {
	assert.ok(markup.includes(`<th>${header}</th>`));
}
assert.ok(markup.includes('<summary>Raw response</summary>'));

// Markup in lookup data and suggestions stays inert.
const evil = `<img src=x onerror=alert(1)>`;
const evilHtml = renderLookupValuesHtml(
	[{ code: evil, source: `a"b`, valueAtSource: evil }],
	[{ code: evil }],
	ctx,
	{ sourceSuggestions: [`"><img src=x onerror=alert(1)>`, evil] },
);
assert.ok(!evilHtml.includes('<img'), 'no live element from data');
assert.ok(evilHtml.includes('&lt;img src=x onerror=alert(1)&gt;'));
assert.ok(evilHtml.includes('<option value="&quot;&gt;&lt;img'), 'an attribute value cannot be broken out of');

// The script is a constant: no data is ever interpolated into it.
const scriptOf = h => /<script\b[^>]*>([\s\S]*?)<\/script>/.exec(h)[1];
assert.strictEqual(scriptOf(html), scriptOf(evilHtml), 'script text does not depend on data');
const script = scriptOf(html);
assert.ok(/const trustedOrigin = window\.origin;/.test(script), 'origin captured at start');
assert.ok(/if \(event\.origin !== trustedOrigin\) return;/.test(script), 'other origins ignored');
for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function']) {
	assert.ok(!script.includes(sink), `script must not use ${sink}`);
}
assert.ok(script.includes("type: 'submitLookupValues', render: render"), 'submissions carry the render token');
assert.ok(script.includes("type: 'ready', render: render"), 'the page announces itself');
assert.ok(/submitButton\.disabled = busy/.test(script) && /setBusy\(true\)/.test(script), 'Submit is disabled in flight');

// A fresh nonce and token per render.
const again = renderLookupValuesHtml(rows, [], ctx);
assert.notStrictEqual(/nonce="([a-f0-9]+)"/.exec(again)[1], nonce);
assert.ok(/<body data-render="[a-f0-9]{32}">/.test(again), 'a token is generated when none is given');

// Panel options: scripts on, no local resources.
const panelSource = readText('src/rdm/lookupValuesPanel.ts');
assert.ok(/enableScripts: true/.test(panelSource));
assert.ok(/localResourceRoots: \[\]/.test(panelSource));
// Only the current render's messages are honoured.
assert.ok(/parsed\.render !== render\.token/.test(panelSource));

// ---------------------------------------------------------------------------
// Tier B — the request postRdmLookupValues sends (design D5, D8)
// ---------------------------------------------------------------------------

async function withFetch(respond, fn) {
	const calls = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		calls.push({ url, init });
		return respond();
	};
	try {
		let value;
		const result = await fn().then(v => {
			value = v;
			return undefined;
		}, e => e);
		return { calls, result, value };
	} finally {
		globalThis.fetch = original;
	}
}

(async () => {
	const body = buildLookupValuesCreateBody(batch, target);
	const stored = createdAs(['WORK', 'HOME', 'MAILING']);

	const okCall = await withFetch(
		() => new Response(JSON.stringify(stored), { status: 200 }),
		() => postRdmLookupValues('https://rdm.reltio.com', 'RdmSampleTenant', body, 'tok'),
	);
	assert.strictEqual(okCall.result, undefined);
	assert.strictEqual(okCall.calls.length, 1, 'one request for the whole batch');
	// The endpoint of the team's working request: no `/rdm`, no `_update`.
	assert.strictEqual(okCall.calls[0].url, 'https://rdm.reltio.com/lookups/RdmSampleTenant');
	assert.strictEqual(okCall.calls[0].init.method, 'POST');
	assert.deepStrictEqual(JSON.parse(okCall.calls[0].init.body), body);
	assert.strictEqual(okCall.calls[0].init.headers.Authorization, 'Bearer tok');
	assert.strictEqual(okCall.calls[0].init.headers['Content-Type'], 'application/json');
	assert.deepStrictEqual(okCall.value, stored, 'the create response is returned for reconciliation');

	// A success without a JSON body still succeeds; the re-fetch decides.
	const emptyBody = await withFetch(
		() => new Response('', { status: 200 }),
		() => postRdmLookupValues('https://rdm.reltio.com', 'RdmSampleTenant', body, 'tok'),
	);
	assert.strictEqual(emptyBody.result, undefined);
	assert.strictEqual(emptyBody.value, undefined);

	// The tenant id cannot add a path segment.
	const encoded = await withFetch(
		() => new Response('[]', { status: 200 }),
		() => postRdmLookupValues('https://rdm.reltio.com', 'a/b c', body, 'tok'),
	);
	assert.strictEqual(encoded.calls[0].url, 'https://rdm.reltio.com/lookups/a%2Fb%20c');

	// 401 is distinguishable, so the caller can route it to the re-login flow.
	const unauthorized = await withFetch(
		() => new Response('', { status: 401 }),
		() => postRdmLookupValues('https://rdm.reltio.com', 'T', body, 'tok'),
	);
	assert.ok(unauthorized.result instanceof ReltioApiError && unauthorized.result.statusCode === 401);

	// The service's own error words reach the user.
	const rejected = await withFetch(
		() =>
			new Response(JSON.stringify({ errorMessage: 'Invalid source', errorDetailMessage: 'Unknown source FOO' }), {
				status: 400,
			}),
		() => postRdmLookupValues('https://rdm.reltio.com', 'T', body, 'tok'),
	);
	assert.strictEqual(rejected.result.statusCode, 400);
	assert.strictEqual(rejected.result.message, 'HTTP 400: Invalid source Unknown source FOO');
	assert.ok(!/L3/.test(rejected.result.message), 'no L3 framing for lookup values');

	const plain = await withFetch(
		() => new Response('  upstream down  ', { status: 503 }),
		() => postRdmLookupValues('https://rdm.reltio.com', 'T', body, 'tok'),
	);
	assert.strictEqual(plain.result.message, 'HTTP 503: upstream down');

	// Hosts outside the allowlist are refused before anything is sent.
	for (const host of ['https://rdm.example.com', 'https://rdm.reltio.com/rdm']) {
		const refused = await withFetch(
			() => new Response('[]', { status: 200 }),
			() => postRdmLookupValues(host, 'T', body, 'tok'),
		);
		assert.ok(refused.result instanceof Error, `${host} must be refused`);
		assert.strictEqual(refused.calls.length, 0, `nothing is sent to ${host}`);
	}

	// -------------------------------------------------------------------------
	// Tier B — the extension's handler checks before it writes (design D4, D7)
	// -------------------------------------------------------------------------

	const ext = readText('src/extension.ts');
	const start = ext.indexOf('async function submitLookupValues(');
	assert.ok(start > 0, 'the submit handler exists');
	const handler = ext.slice(start, ext.indexOf('\n\t}\n', start));
	const at = s => {
		const i = handler.indexOf(s);
		assert.ok(i >= 0, `handler uses ${s}`);
		return i;
	};
	assert.ok(at('planLookupValues(') < at('postRdmLookupValues('), 'existing codes are merged before posting');
	assert.ok(at('fetchRdmLookupValues(') < at('planLookupValues('), 'the merge uses a fresh fetch');
	assert.ok(at('describeConflicts(') < at('postRdmLookupValues('), 'a conflict refuses before posting');
	assert.ok(at('postRdmLookupValues(') < at('describeSubmissionOutcome('), 'the outcome is judged after posting');
	assert.ok(handler.lastIndexOf('fetchRdmLookupValues(') > at('postRdmLookupValues('), 'by re-fetching');
	assert.ok(/created = await/.test(handler), 'the create response is kept');
	assert.ok(/describeSubmissionOutcome\(plan, refetched, postError, created\)/.test(handler), 'and used in the outcome');
	assert.ok(/planLookupValues\(values, current, ctx\)/.test(handler), 'identifiers come from the render context');
	assert.ok(!/render\.context\s*=/.test(handler), 'the handler never rewrites the context');
	assert.ok(ext.includes('setLookupValuesSubmitHandler(submitLookupValues)'), 'the handler is registered');

	// -------------------------------------------------------------------------
	// Tier B — no command is added
	// -------------------------------------------------------------------------

	const pkg = JSON.parse(readText('package.json'));
	const commands = (pkg.contributes.commands || []).map(c => `${c.command} ${c.title}`);
	assert.ok(!commands.some(c => /add ?value|lookupvalue(?!s)|addRdmLookupValue/i.test(c)), 'Add Value is a panel control, not a command');

	console.log('test-rdm-lookup-value-authoring: OK');
})().catch(e => {
	console.error(e);
	process.exit(1);
});
