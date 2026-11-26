#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: rdm-tree-view
 * Tier A: the RDM sub-tree builder — sections as counted folders, entries as
 *         labelled leaves, omission of empty/absent/unrecognized sections, and
 *         jsonPath values that resolve in the parsed document so Show in Editor
 *         has a range to target.
 * Tier B: RDM context values cannot match the patterns that gate Delete and
 *         Rename, and the manifest adds one RDM-scoped menu entry and no command.
 * Tier C (manual): tree rendering, reveal into the RDM file, absent menus — see
 *         design.md Test plan.
 *
 * RDM configurations vary per tenant, so assertions derive from whatever the
 * fixture holds rather than from hard-coded counts or identifiers.
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');

const repoRoot = path.join(__dirname, '..');
const readJson = p => JSON.parse(fs.readFileSync(path.join(repoRoot, p), 'utf8'));

const vscode = require('./lib/vscode-stub.cjs');
const { parseRdmDocument, findNodeAtPath } = importDist('parser/configParser');
const { RdmGroupNode, RdmRootNode, RdmFolderNode, RdmItemNode } = importDist('tree/multiTenantNodes');
const {
	getRdmRootChildren,
	getRdmFolderChildren,
	getRdmItemParent,
	getRdmFolderParent,
} = importDist('tree/rdmSubtree');

const FIXTURE = 'samples/rdm-config.sample.json';
const fixtureText = fs.readFileSync(path.join(repoRoot, FIXTURE), 'utf8');
const { model, ast, errors } = parseRdmDocument(fixtureText);
assert.deepStrictEqual(errors, [], 'the sanitized RDM fixture must parse cleanly');

const fileUri = vscode.Uri.file(`/ws/env.reltio.environment/T1.reltio.tenant/RDM.RdmX.reltio.json`);
const rootFor = m => new RdmRootNode('env', 'T1', 'RdmX', fileUri, false);
const root = rootFor(model);

// ---------------------------------------------------------------------------
// Tier A — root label and sections
// ---------------------------------------------------------------------------

// The tenant row groups its RDM configurations under a single `RDM` row, and
// each configuration below it is labelled with the RDM tenant id alone.
const group = new RdmGroupNode('env', 'T1');
assert.strictEqual(group.label, 'RDM');
assert.strictEqual(group.contextValue, 'reltio.rdm.group');
assert.strictEqual(group.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);

assert.strictEqual(root.label, 'RdmX', 'an RDM configuration is labelled with its tenant id alone');
assert.strictEqual(root.contextValue, 'reltio.rdm.root');

const folders = getRdmRootChildren(model, root);

// Exactly the recognized sections that are non-empty, in table order.
const expectedSections = ['lookupTypes', 'sources'].filter(
	k => Array.isArray(model[k]) && model[k].length > 0,
);
assert.deepStrictEqual(
	folders.map(f => f.sectionKey),
	expectedSections,
	'one folder per non-empty recognized section',
);

// Counts come from the fixture, not from a hard-coded number.
for (const folder of folders) {
	const count = model[folder.sectionKey].length;
	assert.ok(
		String(folder.label).endsWith(`(${count})`),
		`${folder.sectionKey} label must carry its count: got ${folder.label}`,
	);
	assert.strictEqual(folder.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
}

// ---------------------------------------------------------------------------
// Tier A — entries are labelled leaves
// ---------------------------------------------------------------------------

for (const folder of folders) {
	const items = getRdmFolderChildren(model, folder);
	const entries = model[folder.sectionKey];
	assert.strictEqual(items.length, entries.length, `${folder.sectionKey}: one node per entry`);

	items.forEach((item, i) => {
		const entry = entries[i];
		assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None, 'entries are leaves');
		assert.strictEqual(item.description, entry.uri, 'the full uri shows as the description');
		if (entry.label) {
			assert.strictEqual(item.label, entry.label);
		}
		// jsonPath must address this entry in the document.
		assert.deepStrictEqual(item.jsonPath, [folder.sectionKey, i]);
	});
}

// Label falls back to the trailing uri segment when `label` is absent.
const noLabel = {
	lookupTypes: [{ uri: 'rdm/lookupTypes/EmailTypes' }],
};
const noLabelItems = getRdmFolderChildren(
	noLabel,
	new RdmFolderNode('env', 'T1', 'RdmX', fileUri, 'lookupTypes', 'Lookup Types', 1, 'symbol-enum'),
);
assert.strictEqual(noLabelItems[0].label, 'EmailTypes', 'falls back to the uri tail');
assert.strictEqual(noLabelItems[0].description, 'rdm/lookupTypes/EmailTypes');

// ---------------------------------------------------------------------------
// Tier A — omission rules
// ---------------------------------------------------------------------------

assert.deepStrictEqual(
	getRdmRootChildren({}, root).map(f => f.sectionKey),
	[],
	'absent sections are omitted',
);
assert.deepStrictEqual(
	getRdmRootChildren({ lookupTypes: [], sources: [] }, root).map(f => f.sectionKey),
	[],
	'empty sections are omitted',
);
assert.deepStrictEqual(
	getRdmRootChildren({ lookupTypes: 'not an array' }, root).map(f => f.sectionKey),
	[],
	'a non-array section is omitted rather than rendered',
);

// RDM configurations vary per tenant: an array key the tree does not recognize
// must be skipped, not rendered as an unlabelled folder.
const withUnknown = {
	lookupTypes: [{ uri: 'rdm/lookupTypes/A' }],
	someFutureSection: [{ uri: 'rdm/future/X' }],
};
assert.deepStrictEqual(
	getRdmRootChildren(withUnknown, root).map(f => f.sectionKey),
	['lookupTypes'],
	'unrecognized array sections are omitted',
);

// ---------------------------------------------------------------------------
// Tier A — jsonPath resolves, and parents round-trip
// ---------------------------------------------------------------------------

for (const folder of folders) {
	assert.ok(findNodeAtPath(ast, folder.jsonPath), `folder jsonPath must resolve: ${folder.jsonPath}`);
	for (const item of getRdmFolderChildren(model, folder)) {
		assert.ok(
			findNodeAtPath(ast, item.jsonPath),
			`item jsonPath must resolve so Show in Editor has a range: ${item.jsonPath}`,
		);

		const parentFolder = getRdmItemParent(model, item);
		assert.ok(parentFolder, 'every item resolves to a folder');
		assert.strictEqual(parentFolder.sectionKey, folder.sectionKey);
		assert.strictEqual(parentFolder.id, folder.id, 'parent folder id round-trips');
	}

	const parentRoot = getRdmFolderParent(folder);
	assert.strictEqual(parentRoot.id, root.id, 'parent root id round-trips');
}

// ---------------------------------------------------------------------------
// Tier A — an unreadable root is visible but inert
// ---------------------------------------------------------------------------

const broken = new RdmRootNode('env', 'T1', 'RdmX', fileUri, true);
assert.strictEqual(broken.label, 'RdmX', 'an unreadable file still shows its row');
assert.strictEqual(broken.collapsibleState, vscode.TreeItemCollapsibleState.None);
assert.ok(broken.description, 'the root indicates it could not be read');

// ---------------------------------------------------------------------------
// Tier B — RDM context values cannot inherit the L3 edit commands
//
// This is the regression guard for design D1. `reltio.deleteNode` and
// `reltio.renameNode` attach to /^reltio\.item\./ by regex, so any RDM node
// minted in that namespace would silently gain destructive commands that edit
// a document the node does not own.
// ---------------------------------------------------------------------------

const sampleFolder = new RdmFolderNode('env', 'T1', 'RdmX', fileUri, 'lookupTypes', 'Lookup Types', 1, 'symbol-enum');
const sampleItem = new RdmItemNode('env', 'T1', 'RdmX', fileUri, 'lookupTypes', ['lookupTypes', 0], 'A', 'rdm/lookupTypes/A', 'symbol-enum-member');
const rdmContextValues = [
	group.contextValue,
	root.contextValue,
	broken.contextValue,
	sampleFolder.contextValue,
	sampleItem.contextValue,
];

for (const cv of rdmContextValues) {
	assert.ok(cv.startsWith('reltio.rdm.'), `RDM context values live in their own namespace: ${cv}`);
	assert.ok(!/^reltio\.item\./.test(cv), `${cv} must not match the Delete/Rename pattern`);
	assert.ok(!/^reltio\.folder\./.test(cv), `${cv} must not match the L3 folder pattern`);
}

// ---------------------------------------------------------------------------
// Tier B — manifest wiring
// ---------------------------------------------------------------------------

const pkg = readJson('package.json');
const itemMenus = pkg.contributes.menus['view/item/context'];

// Delete and Rename stay gated to L3 items and can never reach an RDM node.
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

const rdmMenus = itemMenus.filter(m => typeof m.when === 'string' && m.when.includes('reltio\\.rdm\\.'));
assert.strictEqual(rdmMenus.length, 1, 'exactly one RDM-scoped menu entry');
assert.strictEqual(rdmMenus[0].command, 'reltio.revealInEditor', 'RDM nodes get Show in Editor only');

// Browsing the RDM sub-tree adds no command of its own — it reuses
// reltio.revealInEditor. Commands that *act on* RDM data belong to their own
// changes and are checked there, so this guard names what browsing must not
// introduce rather than banning the whole `rdm` prefix.
const browseCommands = (pkg.contributes.commands || [])
	.map(c => c.command)
	.filter(id => /rdmTree|revealRdm|openRdm/i.test(id));
assert.deepStrictEqual(browseCommands, [], 'the RDM sub-tree must reuse existing commands');

// Show in Ontology stays scoped to the two L3 folders it can actually render.
const ontology = itemMenus.filter(m => m.command === 'reltio.showOntologyFromTree');
for (const entry of ontology) {
	assert.ok(!/rdm/i.test(entry.when || ''), 'Show in Ontology is never offered for RDM');
}

console.log('test-rdm-tree-view: OK');
