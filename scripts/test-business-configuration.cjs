#!/usr/bin/env node
'use strict';
/**
 * Regression area: Business Configuration (docs/test-proposals/business-configuration.json)
 *
 * Tier A/B: parser and JSON edit primitives, edit commands on an in-memory document, UriIndex,
 * diagnostics and auto-save on the vscode stub, configuration history snapshots on memory-fs,
 * edit workflows, security, performance and Windows path / CRLF handling.
 *   BIZCFG-001  parseDocument (trailing commas, empty input), findNodeRangeForDeletion,
 *               findArrayInsertionPoint, prettyPrintJsonIfPossible.
 *               #2 "UriIndex.build runs on an empty document" is blocked by BUG-005 (skipped).
 *   BIZCFG-002  deleteNode / renameNode produce minimal WorkspaceEdits, cancel and unchanged name
 *               are no-ops, lifecycleActions is read-only, nextDefaultLabel and every skeleton.
 *   BIZCFG-005  UriIndex rebuild reset, unresolved filtering (_vertical), virtual attribute URIs
 *               (cycles and long chains bounded), outputMapping reference definitions.
 *   BIZCFG-006  DiagnosticsManager severity setting; registerReltioAutoSave triggers.
 *   BIZCFG-007  history snapshot filename sanitizing / parsing, file body, listing and clearing.
 *   BIZCFG-009  re-index after a text edit; insertAttribute / insertMatchGroup into a missing array.
 *   BIZCFG-011  #2 history filenames stay inside the history folder. (#1, the verify token / host /
 *               network handling, is already asserted in test-match-rule-generation-skill.cjs
 *               testBridgeGates, testBridgeRejectsMalformedRequests and testBridgeAuthAndFailures.)
 *   BIZCFG-012  parse + index, pretty-print and graph build on large inputs.
 *   BIZCFG-013  deriveTenantNamings on win32 / linux, match verification Windows paths, CRLF and
 *               tab-indented edits.
 * (BIZCFG-003 lives in test-ontology-view.cjs, BIZCFG-004 in test-match-rule-generation-skill.cjs
 *  and BIZCFG-008 in test-skills-and-enablement-packs-library.cjs, which already cover those
 *  behaviours in part.)
 * Tier C (manual): BIZCFG-010 entity browser and ontology panel in the Extension Development Host.
 */
const assert = require('assert');
const vscode = require('./lib/vscode-stub.cjs');

// --- vscode stub extensions -----------------------------------------------------------------
// Top-level API members must exist before a dist module is imported: tsc's `__importStar` copies
// the stub's own keys at import time, so later additions would be invisible to `src/`.

class WorkspaceEdit {
	constructor() {
		this.ops = [];
	}
	replace(uri, range, text) {
		this.ops.push({ kind: 'replace', uri, range, text });
	}
	insert(uri, position, text) {
		this.ops.push({ kind: 'insert', uri, range: new vscode.Range(position, position), text });
	}
	delete(uri, range) {
		this.ops.push({ kind: 'delete', uri, range, text: '' });
	}
}
class Selection extends vscode.Range {}
vscode.WorkspaceEdit = WorkspaceEdit;
vscode.Selection = Selection;
vscode.TextEditorRevealType = { Default: 0, InCenter: 2 };

/** In-memory text documents keyed by fsPath; `applyEdit` mutates them like the editor would. */
const docs = new Map();
const appliedEdits = [];
const messages = [];

function positionAt(text, offset) {
	let line = 0;
	let lineStart = 0;
	for (let i = 0; i < offset; i++) {
		if (text.charCodeAt(i) === 10) {
			line++;
			lineStart = i + 1;
		}
	}
	return new vscode.Position(line, offset - lineStart);
}
function offsetAt(text, pos) {
	let line = 0;
	let i = 0;
	while (line < pos.line) {
		const nl = text.indexOf('\n', i);
		if (nl < 0) return text.length;
		i = nl + 1;
		line++;
	}
	return i + pos.character;
}
function makeDoc(uri) {
	const key = uri.fsPath;
	return {
		uri,
		fileName: key,
		getText: () => docs.get(key),
		positionAt: o => positionAt(docs.get(key), o),
		offsetAt: p => offsetAt(docs.get(key), p),
	};
}
function setDoc(path, text) {
	docs.set(path, text);
	return vscode.Uri.file(path);
}

vscode.workspace.openTextDocument = async uri => makeDoc(uri);
vscode.workspace.applyEdit = async edit => {
	appliedEdits.push(edit);
	const byDoc = new Map();
	for (const op of edit.ops) {
		const key = op.uri.fsPath;
		if (!byDoc.has(key)) byDoc.set(key, []);
		const text = docs.get(key);
		byDoc.get(key).push({ start: offsetAt(text, op.range.start), end: offsetAt(text, op.range.end), text: op.text });
	}
	for (const [key, list] of byDoc) {
		let text = docs.get(key);
		for (const o of list.sort((a, b) => b.start - a.start)) text = text.slice(0, o.start) + o.text + text.slice(o.end);
		docs.set(key, text);
	}
	return true;
};
vscode.window.showTextDocument = async () => ({ selection: undefined, revealRange() {} });
vscode.window.showInformationMessage = async m => {
	messages.push(m);
	return undefined;
};
vscode.window.showErrorMessage = async m => {
	messages.push(m);
	return undefined;
};

const { importDist } = require('./lib/import-dist.cjs');
const { loadCanonicalFixture } = require('./lib/load-canonical-fixture.cjs');
const { installMemoryFs } = require('./lib/memory-fs.cjs');

const { parseDocument, findNodeAtPath, findNodeRangeForDeletion, findArrayInsertionPoint } = importDist('parser/configParser');
const { prettyPrintJsonIfPossible } = importDist('api/formatJson');
const { UriIndex, isPlatformHostedConfigurationUri } = importDist('navigation/uriIndex');
const { DiagnosticsManager } = importDist('navigation/diagnosticsManager');
const { registerReltioAutoSave } = importDist('workspace/reltioAutoSave');
const edits = importDist('commands/editCommands');
const sk = importDist('commands/elementSkeletons');
const history = importDist('workspace/configurationHistory');
const { buildGraphModel } = importDist('ontology/modelToGraph');
const { deriveTenantNamings } = importDist('workspace/l3Discovery');
const bridge = importDist('workspace/matchVerification');

const fixture = loadCanonicalFixture();
const removeRange = (text, r) => text.slice(0, r.offset) + text.slice(r.offset + r.length);
/** True when `after` is `before` with one contiguous block inserted and nothing else changed. */
function isPureInsertion(before, after) {
	if (after.length <= before.length) return false;
	let k = 0;
	while (k < before.length && before[k] === after[k]) k++;
	return after.slice(0, k) + after.slice(k + after.length - before.length) === before;
}
const parsesStrict = (text, what) => {
	try {
		return JSON.parse(text);
	} catch (e) {
		assert.fail(`${what}: result is not valid JSON (${e.message})`);
	}
};

/** Runs `fn` with `reltio.<key>` settings overridden; unset keys fall back like the real API. */
async function withSettings(settings, fn) {
	const original = vscode.workspace.getConfiguration;
	vscode.workspace.getConfiguration = () => ({
		get: (key, fallback) => (key in settings ? settings[key] : fallback),
		update: async () => {},
	});
	try {
		return await fn();
	} finally {
		vscode.workspace.getConfiguration = original;
	}
}

async function withPlatform(platform, fn) {
	const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
	Object.defineProperty(process, 'platform', { value: platform, configurable: true });
	try {
		return await fn();
	} finally {
		Object.defineProperty(process, 'platform', descriptor);
	}
}

// --- BIZCFG-001 --------------------------------------------------------------------------------

function testParserPrimitives() {
	// 1. Trailing commas: lenient AST and model, errors reported, no throw.
	{
		const text = '{"entityTypes":[{"uri":"configuration/entityTypes/A",},]}';
		const doc = parseDocument(text);
		assert.ok(doc.ast && typeof doc.ast === 'object', 'BIZCFG-001 #1: ast is a non-null node');
		assert.strictEqual(doc.ast.type, 'object', 'BIZCFG-001 #1: ast root is the object node');
		assert.strictEqual(doc.model.entityTypes[0].uri, 'configuration/entityTypes/A', 'BIZCFG-001 #1: model.entityTypes[0].uri is set');
		assert.ok(doc.errors.length > 0, 'BIZCFG-001 #1: the trailing commas are listed in errors');
		for (const e of doc.errors) {
			assert.ok(text[e.offset] === '}' || text[e.offset] === ']', `BIZCFG-001 #1: error at ${e.offset} points at the token after a trailing comma`);
		}
	}

	// 2. Empty and whitespace-only input.
	for (const text of ['', '   ']) {
		let doc;
		assert.doesNotThrow(() => { doc = parseDocument(text); }, `BIZCFG-001 #2: parseDocument(${JSON.stringify(text)}) does not throw`);
		assert.deepStrictEqual(doc.model, {}, `BIZCFG-001 #2: parseDocument(${JSON.stringify(text)}).model is {}`);
		// Blocked by BUG-005: UriIndex.build(model, ast) throws "Cannot read properties of undefined
		// (reading 'type')" because parseDocument returns ast undefined for empty input. Skipped.
	}

	// 3. Deletion ranges on 3-element and 1-element arrays, LF and CRLF.
	for (const nl of ['\n', '\r\n']) {
		const label = nl === '\n' ? 'LF' : 'CRLF';
		const three = `{${nl}  "a": [${nl}    {"v": 1},${nl}    {"v": 2},${nl}    {"v": 3}${nl}  ],${nl}  "b": true${nl}}`;
		const threeDoc = parseDocument(three);
		for (const i of [0, 1, 2]) {
			const r = findNodeRangeForDeletion(three, threeDoc.ast, ['a', i]);
			assert.ok(r, `BIZCFG-001 #3: ${label} index ${i} has a range`);
			const out = removeRange(three, r);
			const parsed = parsesStrict(out, `BIZCFG-001 #3: ${label} delete index ${i}`);
			assert.deepStrictEqual(parsed.a.map(x => x.v), [1, 2, 3].filter((_, k) => k !== i), `BIZCFG-001 #3: ${label} delete index ${i} keeps the remaining elements in order`);
			assert.strictEqual(parsed.b, true, `BIZCFG-001 #3: ${label} delete index ${i} leaves the sibling property`);
			assert.ok(!/,\s*\]/.test(out) && !/\[\s*,/.test(out) && !/,\s*,/.test(out), `BIZCFG-001 #3: ${label} delete index ${i} leaves no dangling comma`);
			assert.strictEqual(parseDocument(out).errors.length, 0, `BIZCFG-001 #3: ${label} delete index ${i} parses without errors`);
		}
		const one = `{${nl}  "a": [${nl}    {"v": 1}${nl}  ]${nl}}`;
		const oneDoc = parseDocument(one);
		const out = removeRange(one, findNodeRangeForDeletion(one, oneDoc.ast, ['a', 0]));
		assert.deepStrictEqual(parsesStrict(out, `BIZCFG-001 #3: ${label} sole delete`), { a: [] }, `BIZCFG-001 #3: ${label} sole delete keeps the brackets`);
	}

	// 4. Insertion points.
	{
		const text = '{"empty": [ ], "full": [1, {"x": 2}], "obj": {"k": 1}}';
		const doc = parseDocument(text);
		const empty = findArrayInsertionPoint(text, doc.ast, ['empty']);
		assert.strictEqual(empty.isEmpty, true, 'BIZCFG-001 #4: empty array isEmpty true');
		assert.strictEqual(text[empty.offset], ']', 'BIZCFG-001 #4: empty array offset is at the closing bracket');
		assert.strictEqual(empty.offset, text.indexOf(']'), 'BIZCFG-001 #4: empty array offset is that array\'s closing bracket');
		const full = findArrayInsertionPoint(text, doc.ast, ['full']);
		assert.strictEqual(full.isEmpty, false, 'BIZCFG-001 #4: populated array isEmpty false');
		assert.strictEqual(full.offset, text.indexOf('{"x": 2}') + '{"x": 2}'.length, 'BIZCFG-001 #4: populated offset is right after the last element');
		assert.deepStrictEqual(findArrayInsertionPoint(text, doc.ast, ['missing']), { offset: -1, isEmpty: true }, 'BIZCFG-001 #4: missing path gives -1 / isEmpty true');
		assert.deepStrictEqual(findArrayInsertionPoint(text, doc.ast, ['obj']), { offset: -1, isEmpty: true }, 'BIZCFG-001 #4: object path gives -1 / isEmpty true');
	}

	// 5. prettyPrintJsonIfPossible.
	{
		const minified = '{"a":1,"b":[1,{"c":"d"}]}';
		const expected = `${JSON.stringify(JSON.parse(minified), null, 2)}\n`;
		assert.strictEqual(prettyPrintJsonIfPossible(minified), expected, 'BIZCFG-001 #5: minified JSON becomes 2-space JSON with one trailing newline');
		assert.strictEqual(prettyPrintJsonIfPossible(`${minified}\n\n\n`), expected, 'BIZCFG-001 #5: trailing newlines collapse to exactly one');
		const bom = prettyPrintJsonIfPossible(`\uFEFF${minified}`);
		assert.strictEqual(bom, expected, 'BIZCFG-001 #5: a leading BOM is dropped and the JSON pretty-printed');
		assert.ok(!bom.includes('\uFEFF'), 'BIZCFG-001 #5: output has no BOM');
		for (const raw of ['', '   \n\t', '{"a":', '{"a":1,}', '{"a":1 // c\n}']) {
			let out;
			assert.doesNotThrow(() => { out = prettyPrintJsonIfPossible(raw); }, `BIZCFG-001 #5: ${JSON.stringify(raw)} does not throw`);
			assert.strictEqual(out, raw, `BIZCFG-001 #5: ${JSON.stringify(raw)} is returned unchanged`);
		}
	}
}

// --- BIZCFG-002 --------------------------------------------------------------------------------

async function testEditCommands() {
	const path = '/ws/edit.reltio.json';
	const etIdx = fixture.model.entityTypes.findIndex(e => e.uri === 'configuration/entityTypes/Household');
	const etItem = { nodeLabel: 'Household', nodeType: 'entityType', jsonPath: ['entityTypes', etIdx] };
	const original = { warn: vscode.window.showWarningMessage, input: vscode.window.showInputBox };
	let warnings = 0;
	const confirmWith = answer => { vscode.window.showWarningMessage = async () => { warnings++; return answer; }; };
	const inputWith = answer => { vscode.window.showInputBox = async () => answer; };

	try {
		// 1. rename and delete produce minimal edits.
		{
			const uri = setDoc(path, fixture.text);
			const before = appliedEdits.length;
			inputWith('Home');
			const ok = await edits.renameNode(etItem, uri, parseDocument(fixture.text).ast);
			assert.strictEqual(ok, true, 'BIZCFG-002 #1: renameNode returns true');
			assert.strictEqual(appliedEdits.length, before + 1, 'BIZCFG-002 #1: renameNode applies one WorkspaceEdit');
			const edit = appliedEdits[appliedEdits.length - 1];
			assert.deepStrictEqual(edit.ops.map(o => o.kind), ['replace', 'replace'], 'BIZCFG-002 #1: rename holds only the label and uri replacements');
			assert.deepStrictEqual(edit.ops.map(o => o.text), ['"Home"', '"configuration/entityTypes/Home"'], 'BIZCFG-002 #1: new uri keeps the prefix and swaps the last segment');
			for (const op of edit.ops) {
				const start = offsetAt(fixture.text, op.range.start);
				const end = offsetAt(fixture.text, op.range.end);
				assert.ok(end - start < 100, `BIZCFG-002 #1: rename range ${start}-${end} covers one string value, not the document`);
			}
			const renamed = JSON.parse(docs.get(path));
			assert.strictEqual(renamed.entityTypes[etIdx].uri, 'configuration/entityTypes/Home', 'BIZCFG-002 #1: renamed uri in the document');
			assert.strictEqual(renamed.entityTypes[etIdx].label, 'Home', 'BIZCFG-002 #1: renamed label in the document');
		}
		{
			const uri = setDoc(path, fixture.text);
			confirmWith('Delete');
			const item = { nodeLabel: 'Household', nodeType: 'entityType', jsonPath: ['entityTypes', etIdx] };
			const ok = await edits.deleteNode(item, uri, parseDocument(fixture.text).ast);
			assert.strictEqual(ok, true, 'BIZCFG-002 #1: deleteNode returns true after "Delete"');
			const edit = appliedEdits[appliedEdits.length - 1];
			assert.deepStrictEqual(edit.ops.map(o => o.kind), ['delete'], 'BIZCFG-002 #1: delete holds a single range delete');
			const start = offsetAt(fixture.text, edit.ops[0].range.start);
			const end = offsetAt(fixture.text, edit.ops[0].range.end);
			assert.ok(start > 0 && end < fixture.text.length, 'BIZCFG-002 #1: the delete range does not span the whole document');
			const after = JSON.parse(docs.get(path));
			assert.deepStrictEqual(
				after.entityTypes.map(e => e.uri),
				fixture.model.entityTypes.map(e => e.uri).filter(u => u !== 'configuration/entityTypes/Household'),
				'BIZCFG-002 #1: only the deleted element is gone',
			);
		}

		// 2. Cancel and unchanged name are no-ops.
		{
			const uri = setDoc(path, fixture.text);
			const before = appliedEdits.length;
			confirmWith(undefined);
			assert.strictEqual(await edits.deleteNode(etItem, uri, parseDocument(fixture.text).ast), false, 'BIZCFG-002 #2: cancelled delete returns false');
			inputWith('Household');
			assert.strictEqual(await edits.renameNode(etItem, uri, parseDocument(fixture.text).ast), false, 'BIZCFG-002 #2: unchanged rename returns false');
			inputWith(undefined);
			assert.strictEqual(await edits.renameNode(etItem, uri, parseDocument(fixture.text).ast), false, 'BIZCFG-002 #2: dismissed rename returns false');
			assert.strictEqual(appliedEdits.length, before, 'BIZCFG-002 #2: no edit applied');
			assert.strictEqual(docs.get(path), fixture.text, 'BIZCFG-002 #2: document unchanged');
		}

		// 3. lifecycleActions is read-only.
		{
			const text = '{"entityTypes":[{"uri":"configuration/entityTypes/A","lifecycleActions":{"beforeSave":[]}}]}';
			const uri = setDoc(path, text);
			const item = { nodeLabel: 'lifecycleActions', nodeType: 'lifecycleActions', jsonPath: ['entityTypes', 0, 'lifecycleActions'] };
			const beforeEdits = appliedEdits.length;
			const beforeWarnings = warnings;
			messages.length = 0;
			confirmWith('Delete');
			inputWith('Renamed');
			assert.strictEqual(await edits.deleteNode(item, uri, parseDocument(text).ast), false, 'BIZCFG-002 #3: deleteNode on lifecycleActions returns false');
			assert.strictEqual(await edits.renameNode(item, uri, parseDocument(text).ast), false, 'BIZCFG-002 #3: renameNode on lifecycleActions returns false');
			assert.strictEqual(messages.filter(m => m.includes('lifecycleActions is read-only')).length, 2, 'BIZCFG-002 #3: both show "lifecycleActions is read-only"');
			assert.strictEqual(appliedEdits.length, beforeEdits, 'BIZCFG-002 #3: no edit applied');
			assert.strictEqual(warnings, beforeWarnings, 'BIZCFG-002 #3: no delete confirmation is offered');
			assert.strictEqual(docs.get(path), text, 'BIZCFG-002 #3: document unchanged');
		}
	} finally {
		vscode.window.showWarningMessage = original.warn;
		vscode.window.showInputBox = original.input;
	}

	// 4. Labels and skeletons.
	assert.strictEqual(sk.nextDefaultLabel('EntityType', ['EntityType1', 'EntityType7', 'Other']), 'EntityType8', 'BIZCFG-002 #4: next label after EntityType7 is EntityType8');
	assert.strictEqual(sk.nextDefaultLabel('a.b+', ['a.b+2', 'aXb+9', 'a.bb3']), 'a.b+3', 'BIZCFG-002 #4: regex characters in the prefix match literally');
	assert.strictEqual(sk.nextDefaultLabel('(x)', ['(x)4', 'x5']), '(x)5', 'BIZCFG-002 #4: parentheses in the prefix match literally');

	const root = [
		['entityTypes', sk.buildEntityTypeObject, ['dataLabelPattern', 'attributes']],
		['relationTypes', sk.buildRelationTypeObject, ['startObject', 'endObject']],
		['groupingTypes', sk.buildGroupingTypeObject, ['entityType', 'members']],
		['graphTypes', sk.buildGraphTypeObject, ['graphStructure', 'relationshipTypeURIs']],
		['hierarchyTypes', sk.buildHierarchyTypeObject, ['allowedEntityTypes']],
		['interactionTypes', sk.buildInteractionTypeObject, ['attributes']],
		['sources', sk.buildSourceObject, ['abbreviation']],
	];
	for (const [family, build, mandatory] of root) {
		const o = build('Label1');
		assert.strictEqual(o.uri, `configuration/${family}/Label1`, `BIZCFG-002 #4: ${family} skeleton uri`);
		assert.strictEqual(o.label, 'Label1', `BIZCFG-002 #4: ${family} skeleton label`);
		for (const f of mandatory) assert.ok(f in o, `BIZCFG-002 #4: ${family} skeleton has mandatory ${f}`);
	}
	const et = 'configuration/entityTypes/E';
	const mg = sk.buildMatchGroupObject(et, 'MatchGroup1');
	assert.strictEqual(mg.uri, `${et}/matchGroups/MatchGroup1`, 'BIZCFG-002 #4: match group skeleton uri');
	for (const f of ['type', 'label', 'rule']) assert.ok(f in mg, `BIZCFG-002 #4: match group skeleton has ${f}`);
	const sg = sk.buildSurvivorshipGroupObject(et, 'SurvivorshipGroup1');
	assert.strictEqual(sg.uri, `${et}/survivorshipGroups/SurvivorshipGroup1`, 'BIZCFG-002 #4: survivorship skeleton uri');
	for (const f of ['label', 'default', 'mapping']) assert.ok(f in sg, `BIZCFG-002 #4: survivorship skeleton has ${f}`);
	const cc = sk.buildCleanseConfigSkeleton(et);
	assert.deepStrictEqual(cc, { uri: `${et}/cleanseConfig`, mappings: [] }, 'BIZCFG-002 #4: cleanse skeleton uri and mappings');
}

// --- BIZCFG-005 --------------------------------------------------------------------------------

const idx = text => {
	const doc = parseDocument(text);
	const index = new UriIndex();
	index.build(doc.model, doc.ast);
	return { index, doc };
};

function testUriIndex() {
	// 1. A second build forgets the first document.
	{
		const a = JSON.stringify({
			entityTypes: [
				{ uri: 'configuration/entityTypes/A', attributes: [
					{ uri: 'configuration/entityTypes/A/attributes/RefB', name: 'RefB', type: 'Reference', referencedEntityTypeURI: 'configuration/entityTypes/B' },
				] },
				{ uri: 'configuration/entityTypes/B', attributes: [{ uri: 'configuration/entityTypes/B/attributes/Name', name: 'Name', type: 'String' }] },
			],
		});
		const { index } = idx(a);
		assert.ok(index.definitions.size > 0 && index.virtualDefinitions.size > 0 && index.references.size > 0, 'BIZCFG-005 #1: document A fills all three maps');
		const b = parseDocument('{"entityTypes":[{"uri":"configuration/entityTypes/Z"}]}');
		index.build(b.model, b.ast);
		assert.deepStrictEqual([...index.definitions.keys()], ['configuration/entityTypes/Z'], 'BIZCFG-005 #1: only B\'s definitions remain');
		assert.strictEqual(index.virtualDefinitions.size, 0, 'BIZCFG-005 #1: A\'s virtual definitions are gone');
		assert.strictEqual(index.references.size, 0, 'BIZCFG-005 #1: A\'s references are gone');
	}

	// 2. Platform-hosted URIs are not unresolved; each dangling reference node is reported.
	{
		const { index } = idx(JSON.stringify({
			referenceConfigurationURI: 'configuration/_vertical/foo',
			entityTypes: [
				{ uri: 'configuration/entityTypes/A', extendsTypeURI: 'configuration/entityTypes/Missing' },
				{ uri: 'configuration/entityTypes/B', extendsTypeURI: 'configuration/entityTypes/Missing' },
				{ uri: 'configuration/entityTypes/C', extendsTypeURI: 'configuration/entityTypes/A' },
			],
		}));
		assert.strictEqual(isPlatformHostedConfigurationUri('configuration/_vertical/foo'), true, 'BIZCFG-005 #2: _vertical is platform-hosted');
		assert.strictEqual(isPlatformHostedConfigurationUri('configuration/entityTypes/Missing'), false, 'BIZCFG-005 #2: a tenant URI is not platform-hosted');
		const unresolved = index.getAllUnresolved();
		assert.deepStrictEqual(unresolved.map(u => u.uri), ['configuration/entityTypes/Missing', 'configuration/entityTypes/Missing'], 'BIZCFG-005 #2: only Missing is unresolved, once per referencing node');
		assert.notStrictEqual(unresolved[0].node, unresolved[1].node, 'BIZCFG-005 #2: the two entries are the two referencing nodes');
	}

	// 3. Virtual attribute URIs through Reference attributes; cycles and long chains terminate.
	{
		const ref = (owner, name, target) => ({ uri: `configuration/entityTypes/${owner}/attributes/${name}`, name, type: 'Reference', referencedEntityTypeURI: `configuration/entityTypes/${target}` });
		const simple = (owner, name) => ({ uri: `configuration/entityTypes/${owner}/attributes/${name}`, name, type: 'String' });
		const chain = Array.from({ length: 8 }, (_, i) => ({
			uri: `configuration/entityTypes/C${i}`,
			attributes: i < 7 ? [simple(`C${i}`, 'Val'), ref(`C${i}`, 'Next', `C${i + 1}`)] : [simple(`C${i}`, 'Val')],
		}));
		const model = {
			entityTypes: [
				{ uri: 'configuration/entityTypes/A', attributes: [simple('A', 'Own'), ref('A', 'ToB', 'B')] },
				{ uri: 'configuration/entityTypes/B', attributes: [simple('B', 'Name'), ref('B', 'ToA', 'A')] },
				...chain,
			],
		};
		const { index } = idx(JSON.stringify(model));
		const virt = 'configuration/entityTypes/A/attributes/ToB/attributes/Name';
		assert.strictEqual(index.getDefinition(virt), index.definitions.get('configuration/entityTypes/B/attributes/Name'), 'BIZCFG-005 #3: the virtual attribute URI resolves to B\'s attribute');
		assert.strictEqual(index.getRealUri(virt), 'configuration/entityTypes/B/attributes/Name', 'BIZCFG-005 #3: getRealUri maps back to the real URI');
		assert.strictEqual(index.getRealUri('configuration/entityTypes/A'), 'configuration/entityTypes/A', 'BIZCFG-005 #3: a real URI maps to itself');
		// The A->B->A cycle is followed only to the depth bound.
		const cyc = 'configuration/entityTypes/A/attributes/ToB/attributes/ToA/attributes/Own';
		assert.strictEqual(index.getRealUri(cyc), 'configuration/entityTypes/A/attributes/Own', 'BIZCFG-005 #3: one hop through the cycle resolves');
		const hops = k => (k.match(/\/attributes\//g) || []).length;
		const maxHops = Math.max(...[...index.virtualDefinitions.keys()].map(hops));
		assert.ok(maxHops <= 5, `BIZCFG-005 #3: virtual URIs stop at MAX_VIRTUAL_DEPTH 5 (deepest has ${maxHops} attribute segments)`);
		const four = `configuration/entityTypes/C0/attributes${'/Next/attributes'.repeat(4)}/Val`;
		const five = `configuration/entityTypes/C0/attributes${'/Next/attributes'.repeat(5)}/Val`;
		assert.strictEqual(index.getRealUri(four), 'configuration/entityTypes/C4/attributes/Val', 'BIZCFG-005 #3: the 7-hop chain is followed to depth 4');
		assert.strictEqual(index.getDefinition(five), undefined, 'BIZCFG-005 #3: the 7-hop chain is cut at the depth bound');
	}

	// 4. outputMapping references resolve to the inline array.
	{
		const mapping = 'configuration/entityTypes/A/cleanse/infos/I/mappings/M';
		const text = JSON.stringify({
			entityTypes: [{ uri: 'configuration/entityTypes/A', cleanse: { infos: [{ uri: 'configuration/entityTypes/A/cleanse/infos/I', mappings: [
				{ uri: mapping, outputMapping: [{ attribute: 'x', cleanseAttribute: 'y' }] },
			] }] } }],
			other: { ref: `${mapping}/outputMapping` },
		});
		const { index, doc } = idx(text);
		const ref = `${mapping}/outputMapping`;
		assert.ok(index.virtualDefinitions.has(ref), 'BIZCFG-005 #4: virtualDefinitions holds the outputMapping reference');
		assert.strictEqual(index.virtualDefinitions.get(ref).realUri, mapping, 'BIZCFG-005 #4: realUri is the mapping URI');
		const target = index.getDefinitionNode(ref);
		assert.strictEqual(target, findNodeAtPath(doc.ast, ['entityTypes', 0, 'cleanse', 'infos', 0, 'mappings', 0, 'outputMapping']), 'BIZCFG-005 #4: getDefinitionNode returns the outputMapping array value node');
		assert.strictEqual(target.type, 'array', 'BIZCFG-005 #4: the target node is the array');
		assert.ok(!index.getAllUnresolved().some(u => u.uri === ref), 'BIZCFG-005 #4: the reference is not unresolved');
	}
}

// --- BIZCFG-006 --------------------------------------------------------------------------------

async function testDiagnosticsAndAutoSave() {
	// 1. Severity setting.
	{
		const missing = 'configuration/entityTypes/Missing';
		const text = `{\n  "entityTypes": [\n    {"uri": "configuration/entityTypes/A", "extendsTypeURI": "${missing}"}\n  ]\n}`;
		const uri = setDoc('/ws/diag.reltio.json', text);
		const { index } = idx(text);
		const cases = [
			['warning', vscode.DiagnosticSeverity.Warning],
			['error', vscode.DiagnosticSeverity.Error],
			['bogus', vscode.DiagnosticSeverity.Warning],
		];
		for (const [setting, severity] of cases) {
			const manager = new DiagnosticsManager();
			await withSettings({ unresolvedUriSeverity: setting }, () => manager.update(makeDoc(uri), index));
			const list = manager.collection.get(uri);
			assert.strictEqual(list.length, 1, `BIZCFG-006 #1: ${setting}: one diagnostic`);
			const d = list[0];
			assert.strictEqual(d.message, `Unresolved URI: ${missing}`, `BIZCFG-006 #1: ${setting}: message`);
			assert.strictEqual(d.source, 'reltio', `BIZCFG-006 #1: ${setting}: source is reltio`);
			assert.strictEqual(d.severity, severity, `BIZCFG-006 #1: ${setting}: severity ${severity}`);
			const covered = text.slice(offsetAt(text, d.range.start), offsetAt(text, d.range.end));
			assert.strictEqual(covered, missing, `BIZCFG-006 #1: ${setting}: range covers the URI without quotes`);
		}
		const off = new DiagnosticsManager();
		await withSettings({ unresolvedUriSeverity: 'off' }, () => off.update(makeDoc(uri), index));
		assert.deepStrictEqual(off.collection.get(uri), [], 'BIZCFG-006 #1: off sets an empty list');
		const dflt = new DiagnosticsManager();
		dflt.update(makeDoc(uri), index);
		assert.strictEqual(dflt.collection.get(uri)[0].severity, vscode.DiagnosticSeverity.Warning, 'BIZCFG-006 #1: unset defaults to Warning');
	}

	// 2. Auto-save triggers.
	{
		const saved = [];
		const doc = (fileName, isDirty = true) => ({ fileName, isDirty, save: async () => { saved.push(fileName); return true; } });
		const editor = d => ({ document: d });
		const reltio = doc('/ws/a.reltio.json');
		const notes = doc('/ws/notes.json');
		const l3 = doc('C:\\repo\\path\\L3.json');
		const cleanReltio = doc('/ws/clean.reltio.json', false);
		const originals = {
			editor: vscode.window.onDidChangeActiveTextEditor,
			state: vscode.window.onDidChangeWindowState,
			active: vscode.window.activeTextEditor,
			docs: vscode.workspace.textDocuments,
		};
		const register = () => {
			const l = {};
			vscode.window.onDidChangeActiveTextEditor = fn => { l.editor = fn; return { dispose() {} }; };
			vscode.window.onDidChangeWindowState = fn => { l.state = fn; return { dispose() {} }; };
			const context = { subscriptions: [] };
			registerReltioAutoSave(context);
			assert.strictEqual(context.subscriptions.length, 2, 'BIZCFG-006 #2: two listeners registered');
			return l;
		};
		try {
			// Editor switch, default on.
			vscode.window.activeTextEditor = editor(reltio);
			let l = register();
			await withSettings({}, async () => {
				l.editor(editor(notes));
				l.editor(editor(l3));
				l.editor(editor(cleanReltio));
				l.editor(editor(reltio));
				l.editor(undefined);
			});
			assert.deepStrictEqual(saved, ['/ws/a.reltio.json', 'C:\\repo\\path\\L3.json', '/ws/a.reltio.json'], 'BIZCFG-006 #2: editor switch saves only dirty .reltio.json and L3.json documents');

			// Editor switch disabled.
			saved.length = 0;
			vscode.window.activeTextEditor = editor(reltio);
			l = register();
			await withSettings({ autoSaveOnEditorSwitch: false }, async () => {
				l.editor(editor(l3));
				l.editor(editor(notes));
			});
			assert.deepStrictEqual(saved, [], 'BIZCFG-006 #2: autoSaveOnEditorSwitch false skips saving');

			// Window blur.
			vscode.workspace.textDocuments = [reltio, notes, l3, cleanReltio];
			saved.length = 0;
			await withSettings({}, async () => l.state({ focused: false }));
			assert.deepStrictEqual(saved, [], 'BIZCFG-006 #2: blur saves nothing by default');
			await withSettings({ autoSaveOnWindowBlur: true }, async () => l.state({ focused: true }));
			assert.deepStrictEqual(saved, [], 'BIZCFG-006 #2: focus gain saves nothing');
			await withSettings({ autoSaveOnWindowBlur: true }, async () => l.state({ focused: false }));
			assert.deepStrictEqual(saved, ['/ws/a.reltio.json', 'C:\\repo\\path\\L3.json'], 'BIZCFG-006 #2: enabled blur saves the dirty .reltio.json and L3.json documents');
		} finally {
			vscode.window.onDidChangeActiveTextEditor = originals.editor;
			vscode.window.onDidChangeWindowState = originals.state;
			vscode.window.activeTextEditor = originals.active;
			vscode.workspace.textDocuments = originals.docs;
		}
	}
}

// --- BIZCFG-007 / BIZCFG-011 #2 ----------------------------------------------------------------

async function testHistory() {
	const name = updatedBy => history.historySnapshotFileName({ updatedBy, timestamp: 1700000000000, configuration: {} });

	// BIZCFG-007 #1.
	assert.strictEqual(name('a/b:c*?'), 'L3-a_b_c__---1700000000000.reltio.json', 'BIZCFG-007 #1: illegal characters become _');
	const long = name('x'.repeat(200));
	assert.strictEqual(long, `L3-${'x'.repeat(80)}---1700000000000.reltio.json`, 'BIZCFG-007 #1: updatedBy is capped at 80 characters');
	assert.strictEqual(name(''), 'L3-unknown---1700000000000.reltio.json', 'BIZCFG-007 #1: empty updatedBy becomes unknown');
	assert.strictEqual(history.historySnapshotFileName({ timestamp: 5, configuration: {} }), 'L3-unknown---5.reltio.json', 'BIZCFG-007 #1: missing updatedBy becomes unknown');
	for (const n of [name('a/b:c*?'), long, name('')]) {
		assert.strictEqual(history.tryParseHistorySnapshotName(n)?.timestampMs, 1700000000000, `BIZCFG-007 #1: ${n} parses back to the same timestamp`);
	}
	for (const bad of ['L3-x.reltio.json', 'L3-u---12a4.reltio.json', 'L3-u---.reltio.json', 'X3-u---1.reltio.json', 'L3-u---1.json']) {
		assert.strictEqual(history.tryParseHistorySnapshotName(bad), undefined, `BIZCFG-007 #1: malformed ${bad} returns undefined`);
	}

	// BIZCFG-007 #2.
	{
		const mem = installMemoryFs();
		const dir = vscode.Uri.file('/ws/.reltio/history');
		const a = { updatedBy: 'alice', timestamp: 100, configuration: { uri: 'configuration', entityTypes: [{ uri: 'configuration/entityTypes/A' }] } };
		const b = { updatedBy: 'bob', timestamp: 200, configuration: { uri: 'configuration', n: 2 } };
		const ua = await history.writeHistorySnapshot(dir, a);
		await history.writeHistorySnapshot(dir, b);
		const body = mem._files.get(ua.fsPath).toString('utf8');
		assert.strictEqual(body, `${JSON.stringify(a.configuration, null, '\t')}\n`, 'BIZCFG-007 #2: body is the tab-indented configuration plus newline');
		const ua2 = await history.writeHistorySnapshot(dir, a);
		assert.strictEqual(ua2.fsPath, ua.fsPath, 'BIZCFG-007 #2: rewrite targets the same file');
		assert.strictEqual(mem._files.get(ua.fsPath).toString('utf8'), body, 'BIZCFG-007 #2: rewrite is idempotent');
		await mem.writeFile(vscode.Uri.joinPath(dir, 'notes.txt'), Buffer.from('stray'));
		await mem.writeFile(vscode.Uri.joinPath(dir, 'sub', 'L3-x---300.reltio.json'), Buffer.from('{}'));
		const list = await history.listLocalHistorySnapshots(dir);
		assert.deepStrictEqual(list.map(s => [s.timestampMs, s.displayUser]), [[200, 'bob'], [100, 'alice']], 'BIZCFG-007 #2: list is newest first and ignores stray files and subfolders');
		await history.clearHistoryDirectory(dir);
		const left = [...mem._files.keys()].filter(k => k.startsWith('/ws/.reltio/history/'));
		assert.deepStrictEqual(left, ['/ws/.reltio/history/sub/L3-x---300.reltio.json'], 'BIZCFG-007 #2: clear removes files and keeps subfolders');
		const missing = vscode.Uri.file('/ws/none');
		assert.deepStrictEqual(await history.listLocalHistorySnapshots(missing), [], 'BIZCFG-007 #2: missing directory lists []');
		await assert.doesNotReject(history.clearHistoryDirectory(missing), 'BIZCFG-007 #2: clearing a missing directory does not throw');
	}

	// BIZCFG-011 #2.
	{
		const dir = vscode.Uri.file('/ws/.reltio/history');
		for (const updatedBy of ['..\\..\\evil', '../x', 'a|b', 'c:<d>"e"']) {
			const n = history.historySnapshotFileName({ updatedBy, timestamp: 1700000000000, configuration: {} });
			assert.ok(!/[/\\:*?"<>|]/.test(n), `BIZCFG-011 #2: ${updatedBy} -> ${n} has no path separators or reserved characters`);
			assert.ok(n.endsWith('.reltio.json'), `BIZCFG-011 #2: ${n} still ends .reltio.json`);
			const joined = vscode.Uri.joinPath(dir, n);
			assert.strictEqual(joined.fsPath, `${dir.fsPath}/${n}`, `BIZCFG-011 #2: ${n} joins as a direct child of the history folder`);
			assert.strictEqual(history.tryParseHistorySnapshotName(n)?.timestampMs, 1700000000000, `BIZCFG-011 #2: ${n} keeps its numeric timestamp`);
		}
	}
}

// --- BIZCFG-009 --------------------------------------------------------------------------------

async function testEditWorkflows() {
	// 1. Re-index after edits (the rebuildUriIndex sequence: parseDocument -> UriIndex.build).
	{
		const newUri = 'configuration/entityTypes/NewType';
		const rebuild = text => idx(text).index;
		const insertEntity = (text, json) => {
			const { ast } = parseDocument(text);
			const at = findArrayInsertionPoint(text, ast, ['entityTypes']);
			return `${text.slice(0, at.offset)},${json}${text.slice(at.offset)}`;
		};
		let text = fixture.text;
		assert.strictEqual(rebuild(text).getAllUnresolved().length, 0, 'BIZCFG-009 #1: the fixture starts with no unresolved URIs');
		text = insertEntity(text, `{"uri":"configuration/entityTypes/Referrer","extendsTypeURI":"${newUri}"}`);
		let index = rebuild(text);
		assert.deepStrictEqual(index.getAllUnresolved().map(u => u.uri), [newUri], 'BIZCFG-009 #1: the reference alone is unresolved');
		const withDef = insertEntity(text, `{"uri":"${newUri}","label":"NewType"}`);
		index = rebuild(withDef);
		assert.ok(index.getDefinition(newUri), 'BIZCFG-009 #1: the new URI resolves via getDefinition');
		assert.strictEqual(index.getReferences(newUri).length, 1, 'BIZCFG-009 #1: getReferences lists the reference');
		assert.strictEqual(index.getAllUnresolved().length, 0, 'BIZCFG-009 #1: getAllUnresolved no longer reports it');
		const doc = parseDocument(withDef);
		const defIdx = doc.model.entityTypes.findIndex(e => e.uri === newUri);
		const removed = removeRange(withDef, findNodeRangeForDeletion(withDef, doc.ast, ['entityTypes', defIdx]));
		index = rebuild(removed);
		assert.strictEqual(index.getDefinition(newUri), undefined, 'BIZCFG-009 #1: removing the definition drops it');
		assert.deepStrictEqual(index.getAllUnresolved().map(u => u.uri), [newUri], 'BIZCFG-009 #1: the reference is unresolved again');
	}

	// 2. insertAttribute (Nested) and insertMatchGroup into missing optional arrays.
	{
		const text = '{\n  "uri": "configuration",\n  "entityTypes": [\n    {\n      "uri": "configuration/entityTypes/Bare",\n      "label": "Bare"\n    }\n  ]\n}\n';
		const item = { nodeLabel: 'Bare', nodeType: 'entityType', jsonPath: ['entityTypes', 0] };
		const cases = [
			['attributes', 'Attribute1', 'configuration/entityTypes/Bare/attributes/Attribute1', uri => edits.insertAttribute(item, uri, parseDocument(text).ast, 'Nested')],
			['matchGroups', 'MatchGroup1', 'configuration/entityTypes/Bare/matchGroups/MatchGroup1', uri => edits.insertMatchGroup(item, uri, parseDocument(text).ast)],
		];
		for (const [key, label, uriValue, run] of cases) {
			const uri = setDoc('/ws/bare.reltio.json', text);
			assert.strictEqual(await run(uri), true, `BIZCFG-009 #2: ${key} insert returns true`);
			const out = docs.get('/ws/bare.reltio.json');
			const parsed = parsesStrict(out, `BIZCFG-009 #2: ${key}`);
			const arr = parsed.entityTypes[0][key];
			assert.ok(Array.isArray(arr) && arr.length === 1, `BIZCFG-009 #2: a new ${key} array holds one skeleton`);
			assert.strictEqual(arr[0].label, label, `BIZCFG-009 #2: ${key} skeleton label ${label}`);
			assert.strictEqual(arr[0].uri, uriValue, `BIZCFG-009 #2: ${key} skeleton uri has the parent prefix`);
			if (key === 'attributes') assert.strictEqual(arr[0].type, 'Nested', 'BIZCFG-009 #2: the attribute is Nested');
			const { [key]: _added, ...rest } = parsed.entityTypes[0];
			assert.deepStrictEqual(rest, { uri: 'configuration/entityTypes/Bare', label: 'Bare' }, `BIZCFG-009 #2: ${key}: other properties unchanged`);
			assert.ok(isPureInsertion(text, out), `BIZCFG-009 #2: ${key}: the edit is a pure insertion, the original formatting is kept`);
		}
	}
}

// --- BIZCFG-012 --------------------------------------------------------------------------------

function time(fn) {
	const t = process.hrtime.bigint();
	const value = fn();
	return { ms: Number(process.hrtime.bigint() - t) / 1e6, value };
}

function testPerformance() {
	// 1. parse + index on ~2000 types / 50k attributes.
	{
		const TYPES = 2000;
		const ATTRS = 25;
		const entityTypes = Array.from({ length: TYPES }, (_, i) => {
			const uri = `configuration/entityTypes/T${i}`;
			return {
				uri,
				label: `T${i}`,
				attributes: Array.from({ length: ATTRS }, (_, j) => ({ uri: `${uri}/attributes/A${j}`, label: `A${j}`, name: `A${j}`, type: 'String' })),
			};
		});
		const text = JSON.stringify({ uri: 'configuration', entityTypes }, null, 2);
		for (let run = 1; run <= 5; run++) {
			const { ms, value: index } = time(() => idx(text).index);
			assert.ok(ms < 5000, `BIZCFG-012 #1: run ${run} parse + index took ${ms.toFixed(0)}ms (budget 5000ms; about 250ms locally, the budget absorbs coverage and GC pauses)`);
			assert.strictEqual(index.definitions.size, TYPES * (ATTRS + 1), `BIZCFG-012 #1: run ${run} definitions equal types + attributes`);
			assert.ok(index.getDefinition(`configuration/entityTypes/T${TYPES - 1}`), `BIZCFG-012 #1: run ${run} the last type resolves`);
		}
	}

	// 2. pretty-print scales linearly.
	{
		const replicate = n => `[${Array.from({ length: n }, () => fixture.text).join(',')}]`;
		const best = (text, runs) => {
			let min = Infinity;
			let out;
			for (let i = 0; i < runs; i++) {
				const r = time(() => prettyPrintJsonIfPossible(text));
				min = Math.min(min, r.ms);
				out = r.value;
			}
			return { ms: min, out };
		};
		const one = replicate(1);
		best(one, 2); // warm-up
		const t1 = best(one, 5);
		assert.strictEqual(t1.out, `${JSON.stringify(JSON.parse(one), null, 2)}\n`, 'BIZCFG-012 #2: 1x output equals JSON.stringify(parse, null, 2) plus newline');
		const ten = replicate(10);
		const t10 = best(ten, 2);
		assert.strictEqual(t10.out, `${JSON.stringify(JSON.parse(ten), null, 2)}\n`, 'BIZCFG-012 #2: 10x output equals JSON.stringify(parse, null, 2) plus newline');
		assert.ok(t10.ms <= Math.max(t1.ms, 10) * 20, `BIZCFG-012 #2: 10x took ${t10.ms.toFixed(0)}ms, more than 20x the 1x ${t1.ms.toFixed(1)}ms`);
		const forty = replicate(40);
		const t40 = best(forty, 2);
		assert.strictEqual(t40.out, `${JSON.stringify(JSON.parse(forty), null, 2)}\n`, 'BIZCFG-012 #2: 40x output equals JSON.stringify(parse, null, 2) plus newline');
		assert.ok(t40.ms <= Math.max(t1.ms, 10) * 80, `BIZCFG-012 #2: 40x took ${t40.ms.toFixed(0)}ms, more than 80x the 1x ${t1.ms.toFixed(1)}ms`);
	}

	// 3. buildGraphModel on 1000 types + 1000 relation types.
	{
		const N = 1000;
		const et = i => `configuration/entityTypes/E${i}`;
		const model = {
			entityTypes: Array.from({ length: N }, (_, i) => ({
				uri: et(i),
				attributes: [{ uri: `${et(i)}/attributes/Ref`, name: 'Ref', type: 'Reference', referencedEntityTypeURI: et((i + 1) % N) }],
			})),
			// Each relation type joins the same pair as a Reference attribute, in the opposite direction.
			relationTypes: Array.from({ length: N }, (_, i) => ({
				uri: `configuration/relationTypes/R${i}`,
				startObject: { objectTypeURI: et((i + 1) % N) },
				endObject: { objectTypeURI: et(i) },
			})),
		};
		const { ms, value: graph } = time(() => buildGraphModel(model));
		assert.ok(ms < 1000, `BIZCFG-012 #3: buildGraphModel took ${ms.toFixed(0)}ms (budget 1000ms)`);
		assert.strictEqual(graph.nodes.length, N, 'BIZCFG-012 #3: 1000 nodes');
		assert.strictEqual(new Set(graph.edges.map(e => e.id)).size, graph.edges.length, 'BIZCFG-012 #3: no duplicate edge ids');
		assert.strictEqual(graph.edges.length, N, 'BIZCFG-012 #3: one edge per sorted pair');
		for (const e of graph.edges) {
			assert.ok(e.relationshipLabels.length === 1 && e.referenceLabels.length === 1, `BIZCFG-012 #3: ${e.id} merges its relation type and reference attribute`);
		}
	}
}

// --- BIZCFG-013 --------------------------------------------------------------------------------

async function testWindowsAndLineEndings() {
	// 1a. deriveTenantNamings: case-insensitive on win32 (and darwin), strict on linux.
	{
		const root = vscode.Uri.file('c:/Repo');
		const file = vscode.Uri.file('C:/repo/DP/x/BusinessConfig.json');
		for (const platform of ['win32', 'darwin']) {
			const [n] = await withPlatform(platform, () => deriveTenantNamings(root, [file]));
			assert.deepStrictEqual([n.label, n.folders], ['x', ['DP']], `BIZCFG-013 #1: ${platform} trims the root case-insensitively (folder rows ['DP'])`);
		}
		const [linux] = await withPlatform('linux', () => deriveTenantNamings(root, [file]));
		assert.notDeepStrictEqual(linux.folders, ['DP'], 'BIZCFG-013 #1: linux compares the root strictly');
		assert.deepStrictEqual(linux.folders, ['C:', 'repo', 'DP'], 'BIZCFG-013 #1: linux keeps the untrimmed path segments');
	}

	// 1b. Match verification accepts backslash and mixed-case paths inside the root.
	{
		const seen = [];
		const deps = {
			workspaceRoot: vscode.Uri.file('C:/Repo'),
			isEnabled: () => true,
			isRepositoryMode: () => false,
			resolveTenant: async uri => { seen.push(uri.path); return { environmentName: 'dev.reltio.com', tenantId: 'T1' }; },
			getToken: () => 'tok',
			tryRefresh: async () => false,
			verify: async () => ({ rules: {} }),
		};
		const req = configFile => ({
			requestId: 'r', configFile,
			matchGroups: [{ uri: 'configuration/entityTypes/I/matchGroups/G' }],
			pairs: [{ label: 'p', first: 'entities/1', second: 'entities/2' }],
		});
		for (const configFile of ['DP\\x\\BusinessConfig.json', 'c:\\repo\\DP\\x\\BusinessConfig.json', 'C:/REPO/dp/x/BusinessConfig.json']) {
			const result = await bridge.handleVerificationRequest(req(configFile), deps);
			assert.strictEqual(result.status, 'verified', `BIZCFG-013 #1: ${configFile} is accepted inside the root`);
		}
		assert.ok(seen.every(p => !p.includes('\\') || /^\/[a-zA-Z]:\\/.test(p)), 'BIZCFG-013 #1: relative backslash paths are joined with forward slashes');
		assert.strictEqual(seen[0], '/C:/Repo/DP/x/BusinessConfig.json', 'BIZCFG-013 #1: the relative path resolves under the root');
	}

	// 2. CRLF and tab-indented fixtures.
	{
		assert.ok(fixture.text.includes('\r\n'), 'BIZCFG-013 #2: the canonical fixture is CRLF');
		/** Which line-ending styles a text uses: a pure CRLF file must stay pure CRLF, an LF file LF. */
		const eols = t => ({ crlf: t.includes('\r\n'), lf: /(^|[^\r])\n/.test(t), cr: /\r(?!\n)/.test(t) });
		const tabbed = JSON.stringify(fixture.model, null, '\t');
		for (const [label, text] of [['CRLF', fixture.text], ['tab', tabbed]]) {
			// Deletions: first, middle and last entity type.
			const doc = parseDocument(text);
			const n = doc.model.entityTypes.length;
			for (const i of [0, Math.floor(n / 2), n - 1]) {
				const out = removeRange(text, findNodeRangeForDeletion(text, doc.ast, ['entityTypes', i]));
				const parsed = parsesStrict(out, `BIZCFG-013 #2: ${label} delete ${i}`);
				assert.strictEqual(parsed.entityTypes.length, n - 1, `BIZCFG-013 #2: ${label} delete ${i} removes one entity type`);
				assert.deepStrictEqual(eols(out), eols(text), `BIZCFG-013 #2: ${label} delete ${i} keeps the original line endings`);
			}
			// Insertion into a missing optional array on a real entity type.
			const etIdx = doc.model.entityTypes.findIndex(e => !e.matchGroups);
			const item = { nodeLabel: 'x', nodeType: 'entityType', jsonPath: ['entityTypes', etIdx] };
			const path = `/ws/${label}.reltio.json`;
			const uri = setDoc(path, text);
			assert.strictEqual(await edits.insertMatchGroup(item, uri, doc.ast), true, `BIZCFG-013 #2: ${label} insertMatchGroup returns true`);
			const out = docs.get(path);
			const parsed = parsesStrict(out, `BIZCFG-013 #2: ${label} insert`);
			assert.strictEqual(parsed.entityTypes[etIdx].matchGroups.length, 1, `BIZCFG-013 #2: ${label} insert adds the match group`);
			assert.ok(isPureInsertion(text, out), `BIZCFG-013 #2: ${label} insert leaves every other line as it was`);
			const etNode = findNodeAtPath(doc.ast, ['entityTypes', etIdx]);
			const firstProp = etNode.children[0];
			const propIndent = text.slice(text.lastIndexOf('\n', firstProp.offset) + 1, firstProp.offset);
			const keyLine = out.split('\n').find(l => /"matchGroups": \[/.test(l));
			assert.strictEqual(keyLine.slice(0, keyLine.indexOf('"')), propIndent, `BIZCFG-013 #2: ${label} inserted property follows the parent property indent`);
		}
	}
}

(async () => {
	testParserPrimitives();
	await testEditCommands();
	testUriIndex();
	await testDiagnosticsAndAutoSave();
	await testHistory();
	await testEditWorkflows();
	testPerformance();
	await testWindowsAndLineEndings();
	console.log('test-business-configuration: OK');
})().catch(e => {
	console.error(e);
	process.exit(1);
});
