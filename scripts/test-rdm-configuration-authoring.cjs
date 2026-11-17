#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: rdm-configuration-authoring
 * Tier A: the two RDM skeleton builders and their default naming; the
 *         creatable-root-array allowlist that keeps the RDM insert from
 *         inheriting L3's key set.
 * Tier B: the three commands are declared and scoped exactly as specified, and
 *         none of them can reach an L3 node.
 * Tier C (manual): insert, edit, apply against a live tenant — see design.md.
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');

const repoRoot = path.join(__dirname, '..');
const readJson = p => JSON.parse(fs.readFileSync(path.join(repoRoot, p), 'utf8'));

const {
	RDM_CREATABLE_ROOT_KEYS,
	buildRdmLookupTypeObject,
	buildRdmSourceObject,
	labelsFromRdmLookupTypes,
	labelsFromRdmSources,
} = importDist('rdm/rdmSkeletons');
const { nextDefaultLabel } = importDist('commands/elementSkeletons');
const { BOOTSTRAP_ROOT_ARRAY_KEYS } = importDist('commands/editCommands');

// ---------------------------------------------------------------------------
// Tier A — skeleton shapes, exactly as specified
// ---------------------------------------------------------------------------

assert.deepStrictEqual(buildRdmLookupTypeObject('LookupType1'), {
	uri: 'rdm/lookupTypes/LookupType1',
	label: 'LookupType1',
	enabled: true,
	startDate: 0,
	endDate: 0,
});

assert.deepStrictEqual(buildRdmSourceObject('Source1'), {
	uri: 'rdm/sources/Source1',
	label: 'Source1',
	abbreviation: 'Source1',
	canonicalValueProvider: false,
});

// uri is derived from the label, so a renamed default stays self-consistent.
assert.strictEqual(buildRdmLookupTypeObject('AddressTypes').uri, 'rdm/lookupTypes/AddressTypes');
assert.strictEqual(buildRdmSourceObject('SAP').uri, 'rdm/sources/SAP');
assert.strictEqual(buildRdmSourceObject('SAP').abbreviation, 'SAP');

// The schema requires uri on both; a skeleton must never omit it.
for (const obj of [buildRdmLookupTypeObject('X'), buildRdmSourceObject('Y')]) {
	assert.ok(typeof obj.uri === 'string' && obj.uri.length > 0, 'uri is always written');
}

// ---------------------------------------------------------------------------
// Tier A — label collection and default naming
// ---------------------------------------------------------------------------

// Tolerant of absent, empty and malformed sections.
for (const model of [undefined, {}, { lookupTypes: [] }, { lookupTypes: 'nope' }]) {
	assert.deepStrictEqual(labelsFromRdmLookupTypes(model), []);
}
assert.deepStrictEqual(
	labelsFromRdmLookupTypes({ lookupTypes: [{ label: 'A' }, {}, null, 'x', { label: '' }, { label: 'B' }] }),
	['A', 'B'],
	'only usable labels are collected',
);
for (const model of [undefined, {}, { sources: [] }, { sources: 42 }]) {
	assert.deepStrictEqual(labelsFromRdmSources(model), []);
}

// First insert, then increment past what exists.
assert.strictEqual(nextDefaultLabel('LookupType', []), 'LookupType1');
assert.strictEqual(nextDefaultLabel('LookupType', ['LookupType1']), 'LookupType2');
assert.strictEqual(nextDefaultLabel('Source', []), 'Source1');
assert.strictEqual(nextDefaultLabel('Source', ['Source1', 'Source2']), 'Source3');

// Unrelated labels never suppress the default, and a gap does not cause a collision.
assert.strictEqual(nextDefaultLabel('LookupType', ['AddressTypes', 'MaritalStatuses']), 'LookupType1');
assert.strictEqual(nextDefaultLabel('LookupType', ['LookupType1', 'LookupType5']), 'LookupType6');

// End to end: the label chosen for a populated configuration feeds the skeleton.
const populated = { lookupTypes: [{ label: 'LookupType1' }, { label: 'AddressTypes' }] };
const nextLabel = nextDefaultLabel('LookupType', labelsFromRdmLookupTypes(populated));
assert.strictEqual(nextLabel, 'LookupType2');
assert.strictEqual(buildRdmLookupTypeObject(nextLabel).uri, 'rdm/lookupTypes/LookupType2');

// ---------------------------------------------------------------------------
// Tier A — the creatable-root-array allowlist
//
// `sources` is in BOTH sets; `lookupTypes` is only in the RDM one. That overlap
// is exactly why the allowlist is a required parameter rather than a default:
// an RDM insert that inherited the L3 set would create `sources` happily and
// fail silently on `lookupTypes`.
// ---------------------------------------------------------------------------

assert.deepStrictEqual([...RDM_CREATABLE_ROOT_KEYS].sort(), ['lookupTypes', 'sources']);
assert.ok(BOOTSTRAP_ROOT_ARRAY_KEYS.has('sources'), 'the overlap this guards against still exists');
assert.ok(!BOOTSTRAP_ROOT_ARRAY_KEYS.has('lookupTypes'), 'the L3 set must not cover lookupTypes');

// The RDM set must not let an L3 section be created in an RDM document.
for (const l3Key of ['entityTypes', 'relationTypes', 'interactionTypes', 'graphTypes']) {
	assert.ok(!RDM_CREATABLE_ROOT_KEYS.has(l3Key), `RDM must not create ${l3Key}`);
}

// insertIntoArray now requires the allowlist — a caller cannot omit it.
const { insertIntoArray } = importDist('commands/editCommands');
assert.strictEqual(typeof insertIntoArray, 'function', 'insertIntoArray is exported for reuse');
assert.strictEqual(insertIntoArray.length, 5, 'the allowlist is a required fifth parameter');

// ---------------------------------------------------------------------------
// Tier B — commands and menu scoping
// ---------------------------------------------------------------------------

const pkg = readJson('package.json');
const commands = pkg.contributes.commands || [];
const itemMenus = pkg.contributes.menus['view/item/context'];

const expectedTitles = {
	'reltio.addRdmLookupType': 'Add a new Lookup Type',
	'reltio.addRdmSource': 'Add a new Source',
	'reltio.applyRdmConfiguration': 'Apply RDM Configuration',
};
for (const [id, title] of Object.entries(expectedTitles)) {
	const cmd = commands.find(c => c.command === id);
	assert.ok(cmd, `${id} is declared`);
	assert.strictEqual(cmd.title, title);
}

const whenFor = id => {
	const entries = itemMenus.filter(m => m.command === id);
	assert.strictEqual(entries.length, 1, `${id} has exactly one menu entry`);
	return entries[0].when;
};

// Add commands: the matching folder, plus the RDM tenant row so a section the
// configuration does not declare can still be created.
const addLookupWhen = whenFor('reltio.addRdmLookupType');
assert.ok(addLookupWhen.includes('reltio.rdm.folder.lookupTypes'), 'offered on the Lookup Types folder');
assert.ok(addLookupWhen.includes('reltio.rdm.root'), 'offered on the RDM tenant row');
assert.ok(!addLookupWhen.includes('reltio.rdm.folder.sources'), 'not offered on the Sources folder');

const addSourceWhen = whenFor('reltio.addRdmSource');
assert.ok(addSourceWhen.includes('reltio.rdm.folder.sources'), 'offered on the Sources folder');
assert.ok(addSourceWhen.includes('reltio.rdm.root'), 'offered on the RDM tenant row');
assert.ok(!addSourceWhen.includes('reltio.rdm.folder.lookupTypes'), 'not offered on the Lookup Types folder');

// Apply belongs to the RDM tenant row alone — it pushes one configuration file.
const applyWhen = whenFor('reltio.applyRdmConfiguration');
assert.ok(applyWhen.includes('reltio.rdm.root'), 'offered on the RDM tenant row');
for (const elsewhere of ['rdm.group', 'rdm.folder', 'rdm.item']) {
	assert.ok(!applyWhen.includes(elsewhere), `Apply must not reach ${elsewhere}`);
}

// None of the three may reach an L3 node, whose edit commands act on a
// different document entirely.
for (const id of Object.keys(expectedTitles)) {
	const when = whenFor(id);
	assert.ok(!/reltio\.item\./.test(when), `${id} must not match L3 items`);
	assert.ok(!/reltio\.folder\./.test(when), `${id} must not match L3 folders`);
	assert.ok(!/reltio\.tenant/.test(when), `${id} must not match the MDM tenant row`);
}

// The L3 edit commands stay unable to reach any RDM node.
for (const command of ['reltio.deleteNode', 'reltio.renameNode']) {
	const entries = itemMenus.filter(m => m.command === command);
	assert.strictEqual(entries.length, 1, `${command} has exactly one menu entry`);
	const when = entries[0].when;
	// Other changes may narrow this gate further (main excludes its LifeCycle Actions
	// leaf), so pin the property that matters rather than the exact string: it stays
	// scoped to L3 items, and no RDM context value can satisfy it.
	assert.ok(when.startsWith('viewItem =~ /^reltio\\.item\\./'), `${command} stays scoped to L3 items`);
	assert.ok(!/rdm/i.test(when), `${command} never names RDM`);
	const gate = new RegExp(/\/(\^reltio\\\.item\\\.)\//.exec(when)[1]);
	for (const cv of ['reltio.rdm.group', 'reltio.rdm.root', 'reltio.rdm.folder.lookupTypes',
		'reltio.rdm.folder.sources', 'reltio.rdm.item.lookupTypes', 'reltio.rdm.item.sources']) {
		assert.ok(!gate.test(cv), `${command} cannot reach ${cv}`);
	}
}

console.log('test-rdm-configuration-authoring: OK');
