#!/usr/bin/env node
'use strict';
/**
 * Regression area: Common Utils
 *
 * Tier A: the pure helpers under src/util/ and the path handling of agent skill discovery.
 *   UTIL-001  jsonDeepEqual, tryParseJson and dotted tenant-name parsing in pathTenantLocFromL3Path.
 *   UTIL-005  fetch-configuration guard: unpublished-changes check and remote-vs-baseline fail closed.
 *   UTIL-009  pathTenantLocFromL3Path and tenantIdFromTreeContext reject invalid shapes.
 *   UTIL-013  POSIX, Windows and mixed separators; nested skill files and CRLF frontmatter.
 *   UTIL-014  scale: deep / large jsonDeepEqual, idempotent resync of the real skills tree.
 * (UTIL-003 KeyedDebouncer is covered in test-workflow-review-fixes.cjs, which already owns it.)
 * Tier C: none.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');
const { installMemoryFs } = require('./lib/memory-fs.cjs');
const { repoRoot } = require('./lib/load-canonical-fixture.cjs');
const vscode = require('./lib/vscode-stub.cjs');

const { jsonDeepEqual } = importDist('util/jsonDeepEqual');
const {
	tryParseJson,
	hasUnpublishedLocalChangesFromText,
	remoteMatchesBaseline,
} = importDist('util/fetchConfigurationGuard');
const { pathTenantLocFromL3Path } = importDist('util/pathTenantLoc');
const { tenantIdFromTreeContext } = importDist('util/tenantIdFromTreeContext');
const discovery = importDist('workspace/agentSkillDiscovery');

const dec = bytes => Buffer.from(bytes).toString('utf8');

// ── UTIL-001: pure helpers ──────────────────────────────────────────────────
function testPureHelpers() {
	// 1. Key order does not matter.
	assert.strictEqual(jsonDeepEqual({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }), true, 'UTIL-001 #1: reordered keys are equal');

	// 2. Arrays: order and length matter; arrays never equal objects or null.
	for (const [a, b, label] of [
		[[1, 2], [2, 1], '[1,2] vs [2,1]'],
		[[1], [1, 2], '[1] vs [1,2]'],
		[[], {}, '[] vs {}'],
		[[], null, '[] vs null'],
		[{}, [], '{} vs []'],
	]) {
		assert.strictEqual(jsonDeepEqual(a, b), false, `UTIL-001 #2: ${label} must be false`);
	}

	// 3. null and primitives.
	assert.strictEqual(jsonDeepEqual(null, {}), false, 'UTIL-001 #3: null vs {} is false');
	assert.strictEqual(jsonDeepEqual(null, null), true, 'UTIL-001 #3: null vs null is true');
	assert.strictEqual(jsonDeepEqual(1, '1'), false, "UTIL-001 #3: 1 vs '1' is false");
	assert.strictEqual(jsonDeepEqual(0, false), false, 'UTIL-001 #3: 0 vs false is false');
	assert.strictEqual(jsonDeepEqual('a', 'a'), true, "UTIL-001 #3: 'a' vs 'a' is true");
	assert.strictEqual(jsonDeepEqual(1, 1.0), true, 'UTIL-001 #3: 1 vs 1.0 is true');

	// 4. Key counts and names.
	assert.strictEqual(jsonDeepEqual({ a: 1 }, { a: 1, b: 2 }), false, 'UTIL-001 #4: differing key counts are not equal');
	assert.strictEqual(jsonDeepEqual({ a: 1, b: undefined }, { a: 1, c: undefined }), false, 'UTIL-001 #4: differing key names are not equal');
	assert.strictEqual(jsonDeepEqual({ a: undefined }, {}), false, 'UTIL-001 #4: key-with-undefined is not equal to a missing key');

	// 5. tryParseJson.
	assert.deepStrictEqual(tryParseJson('{"a":1}'), { a: 1 }, 'UTIL-001 #5: valid JSON returns the value');
	assert.strictEqual(tryParseJson(''), undefined, 'UTIL-001 #5: empty text returns undefined');
	assert.strictEqual(tryParseJson('{bad'), undefined, 'UTIL-001 #5: malformed text returns undefined');
	assert.strictEqual(tryParseJson('null'), null, "UTIL-001 #5: 'null' returns null, not undefined");
	assert.strictEqual(tryParseJson('0'), 0, "UTIL-001 #5: '0' returns 0, not undefined");

	// 6. Dotted tenant and environment names.
	assert.deepStrictEqual(
		pathTenantLocFromL3Path('/ws/My Env.reltio.environment/abc.def-1.reltio.tenant/l3.json'),
		{ tenantId: 'abc.def-1', environmentName: 'My Env' },
		'UTIL-001 #6: dotted tenant id and spaced environment name survive',
	);
	assert.deepStrictEqual(
		pathTenantLocFromL3Path('/ws/Dev.reltio.environment/t1.reltio.tenant/t2.reltio.tenant/l3.json'),
		{ tenantId: 't1', environmentName: 'Dev' },
		'UTIL-001 #6: with two tenant segments the first match is used',
	);
}

// ── UTIL-005: fetch-configuration guard ─────────────────────────────────────
function testFetchGuard() {
	// 1. hasUnpublishedLocalChangesFromText
	assert.strictEqual(hasUnpublishedLocalChangesFromText('{"a":1}', undefined), true, 'UTIL-005 #1: undefined baseline counts as unpublished changes');
	assert.strictEqual(hasUnpublishedLocalChangesFromText('{"a":1}', '{bad'), true, 'UTIL-005 #1: unparsable baseline counts as unpublished changes');
	assert.strictEqual(hasUnpublishedLocalChangesFromText('{bad', '{"a":1}'), true, 'UTIL-005 #1: unparsable local counts as unpublished changes');
	assert.strictEqual(
		hasUnpublishedLocalChangesFromText('{\n  "b": [1, 2],\n  "a": {"x": true}\n}\n', '{"a":{"x":true},"b":[1,2]}'),
		false,
		'UTIL-005 #1: whitespace and key order alone are not unpublished changes',
	);
	assert.strictEqual(hasUnpublishedLocalChangesFromText('{"a":{"x":false}}', '{"a":{"x":true}}'), true, 'UTIL-005 #1: a real value difference is an unpublished change');

	// 2. remoteMatchesBaseline never claims a match it cannot prove.
	assert.strictEqual(remoteMatchesBaseline('{bad', '{"a":1}'), false, 'UTIL-005 #2: unparsable baseline never matches');
	assert.strictEqual(remoteMatchesBaseline('{"a":1}', '{bad'), false, 'UTIL-005 #2: unparsable remote never matches');
	assert.strictEqual(remoteMatchesBaseline('{bad', '{bad'), false, 'UTIL-005 #2: two unparsable texts never match');
	assert.strictEqual(remoteMatchesBaseline('{"a":1,"b":[2]}', '{ "b": [2], "a": 1 }'), true, 'UTIL-005 #2: equal JSON matches');
	assert.strictEqual(remoteMatchesBaseline('{"a":1}', '{"a":2}'), false, 'UTIL-005 #2: different JSON does not match');
}

// ── UTIL-009: invalid shapes ────────────────────────────────────────────────
function testInvalidShapes() {
	// 1. pathTenantLocFromL3Path
	for (const [p, label] of [
		['/ws/Dev.reltio.environment/l3.json', 'no tenant segment'],
		['t1.reltio.tenant/l3.json', 'tenant segment first (index 0)'],
		['/ws/plain/t1.reltio.tenant/l3.json', 'tenant preceded by a plain folder'],
		['', 'empty string'],
	]) {
		assert.strictEqual(pathTenantLocFromL3Path(p), undefined, `UTIL-009 #1: ${label} returns undefined`);
	}
	for (const p of [
		'/ws/Dev.reltio.environment/t1.reltio.tenant/l3.json/',
		'//ws//Dev.reltio.environment//t1.reltio.tenant//l3.json',
	]) {
		assert.deepStrictEqual(
			pathTenantLocFromL3Path(p),
			{ tenantId: 't1', environmentName: 'Dev' },
			`UTIL-009 #1: trailing or doubled separators still parse (${p})`,
		);
	}

	// 2. tenantIdFromTreeContext
	for (const [node, label] of [
		[undefined, 'undefined'],
		[null, 'null'],
		['str', "'str'"],
		[42, '42'],
		[{ tenantId: '' }, "{tenantId:''}"],
		[{ id: 'tenant:Dev' }, "{id:'tenant:Dev'}"],
		[{ id: 'tenant:Dev/' }, "{id:'tenant:Dev/'}"],
		[{ contextValue: 'other', label: 'x' }, "{contextValue:'other'}"],
		[{ contextValue: 'reltio.tenant', label: '' }, "{contextValue:'reltio.tenant',label:''}"],
	]) {
		assert.strictEqual(tenantIdFromTreeContext(node), undefined, `UTIL-009 #2: ${label} returns undefined`);
	}
	assert.strictEqual(
		tenantIdFromTreeContext({ tenantId: '', id: 'tenant:Dev/other', contextValue: 'reltio.tenant', label: 'fallback' }),
		undefined,
		'UTIL-009 #2: an empty tenantId returns undefined directly, without falling through to id or label',
	);
}

// ── UTIL-013: cross-platform paths ──────────────────────────────────────────
async function testCrossPlatform() {
	// 1. Both separators split the path.
	for (const p of [
		'C:\\ws\\Dev.reltio.environment\\t1.reltio.tenant\\l3.json',
		'/home/u/Dev.reltio.environment/t1.reltio.tenant/l3.json',
		'C:\\ws/Dev.reltio.environment\\t1.reltio.tenant/l3.json',
	]) {
		assert.deepStrictEqual(
			pathTenantLocFromL3Path(p),
			{ environmentName: 'Dev', tenantId: 't1' },
			`UTIL-013 #1: ${p} parses to Dev / t1`,
		);
	}

	// 2. Nested skill files, CRLF frontmatter and a Windows-drive workspace root.
	installMemoryFs();
	const root = vscode.Uri.file('C:\\Users\\dev\\ws');
	const src = vscode.Uri.file('C:\\ext\\skills\\reltio-default');
	const skillMd = '---\r\nname: reltio-crlf-skill\r\ndescription: Written on Windows.\r\n---\r\n\r\n# Body\r\n';
	const put = (uri, text) => vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
	await put(vscode.Uri.joinPath(src, 'crlf-skill', 'SKILL.md'), skillMd);
	await put(vscode.Uri.joinPath(src, 'crlf-skill', 'references', 'rules.md'), 'rules');
	await put(vscode.Uri.joinPath(src, 'crlf-skill', 'references', 'deep', 'more.md'), 'more');

	assert.deepStrictEqual(
		discovery.readFrontmatter(skillMd),
		{ name: 'reltio-crlf-skill', description: 'Written on Windows.' },
		'UTIL-013 #2: CRLF frontmatter parses name and description',
	);
	const r = await discovery.syncAgentSkills(root, src, [], { install: true, host: 'other' });
	assert.deepStrictEqual(r.invalid, [], 'UTIL-013 #2: the CRLF skill is valid');
	const installed = vscode.Uri.joinPath(root, '.claude', 'skills', 'reltio-crlf-skill');
	for (const [rel, text] of [['SKILL.md', skillMd], ['references/rules.md', 'rules'], ['references/deep/more.md', 'more']]) {
		const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(installed, ...rel.split('/')));
		assert.strictEqual(dec(bytes), text, `UTIL-013 #2: nested file ${rel} lands at its relative path`);
	}
	assert.ok(r.owned.includes('.claude/skills/reltio-crlf-skill'), 'UTIL-013 #2: the skill folder is owned');
	for (const rel of r.owned) assert.ok(!rel.includes('\\'), `UTIL-013 #2: owned entry ${rel} uses forward slashes`);
	const guide = dec(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, '.claude', 'rules', 'reltio-skills.md')));
	assert.ok(guide.includes('`reltio-crlf-skill`: Written on Windows.'), 'UTIL-013 #2: the guide lists the CRLF skill with its description');
}

// ── UTIL-014: scale ─────────────────────────────────────────────────────────
async function testScale() {
	// 1. Deep and wide structures. Real L3 configurations nest well under 100 levels; 1000 levels
	//    documents that the recursion has headroom an order of magnitude past that.
	const deep = () => {
		let o = { leaf: true };
		for (let i = 0; i < 1000; i++) o = { level: i, child: o };
		return o;
	};
	const wide = () => Array.from({ length: 100_000 }, (_, i) => ({ i }));
	let started = Date.now();
	assert.strictEqual(jsonDeepEqual(deep(), deep()), true, 'UTIL-014 #1: identical 1000-level objects are equal without stack overflow');
	assert.strictEqual(jsonDeepEqual(wide(), wide()), true, 'UTIL-014 #1: identical 100k-element arrays are equal');
	assert.ok(Date.now() - started < 5000, `UTIL-014 #1: deep and wide comparisons finish within 5s (${Date.now() - started}ms)`);

	// 2. Real skills tree, synced twice: the second run writes nothing.
	installMemoryFs();
	const root = vscode.Uri.file('/ws');
	const src = vscode.Uri.file('/ext/skills/reltio-default');
	const copy = (realDir, dest) => {
		const out = [];
		for (const e of fs.readdirSync(realDir, { withFileTypes: true })) {
			const p = path.join(realDir, e.name);
			const d = vscode.Uri.joinPath(dest, e.name);
			if (e.isDirectory()) out.push(...copy(p, d));
			else out.push(vscode.workspace.fs.writeFile(d, fs.readFileSync(p)));
		}
		return out;
	};
	await Promise.all(copy(path.join(repoRoot, 'skills', 'reltio-default'), src));
	const first = await discovery.syncAgentSkills(root, src, [], { install: true, host: 'other' });
	assert.ok(first.owned.length > 1, 'UTIL-014 #2: the first sync installs the real skills');

	const fsApi = vscode.workspace.fs;
	const realWrite = fsApi.writeFile;
	let writes = 0;
	fsApi.writeFile = async (...args) => { writes++; return realWrite.apply(fsApi, args); };
	started = Date.now();
	try {
		await discovery.syncAgentSkills(root, src, first.owned, { install: true, host: 'other' });
	} finally {
		fsApi.writeFile = realWrite;
	}
	const elapsed = Date.now() - started;
	assert.strictEqual(writes, 0, `UTIL-014 #2: the second sync writes 0 files (wrote ${writes})`);
	assert.ok(elapsed < 5000, `UTIL-014 #2: the second sync finishes within 5s (${elapsed}ms)`);
}

(async () => {
	testPureHelpers();
	testFetchGuard();
	testInvalidShapes();
	await testCrossPlatform();
	await testScale();
	console.log('test-common-utils: OK');
})().catch(e => {
	console.error(e);
	process.exit(1);
});
