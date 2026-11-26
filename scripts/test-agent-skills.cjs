#!/usr/bin/env node
'use strict';
/**
 * Regression area: Common Utils
 *
 * Tier A: `syncReltioAgentAssets` over an in-memory file system, plus the Reltio client header set.
 *   UTIL-002  stamp logic: a version bump recopies, an unchanged stamp skips, skills and packs
 *             version independently, a missing folder is restored, `force` restores edits.
 *   UTIL-004  contracts: the `xxx-client` / Authorization / Content-Type headers per call, and the
 *             early returns of a sync that has no assets file, an incomplete or invalid one, or no
 *             workspace folder.
 *   UTIL-006  the `skills/workspace/` override layer is never written, lands in the installed copy
 *             only, and opting out removes owned paths only while the managed layer stays synced.
 * (UTIL-007 lives in test-match-rule-generation-skill.cjs and UTIL-011 in
 *  test-workflow-skills-sync.cjs, which already cover those behaviours in part.)
 * Tier C: none.
 */
const assert = require('assert');
const vscode = require('./lib/vscode-stub.cjs');
const { importDist } = require('./lib/import-dist.cjs');
const { installMemoryFs } = require('./lib/memory-fs.cjs');

const { syncReltioAgentAssets } = importDist('workspace/reltioAgentSync');
const client = importDist('api/reltioClient');

const enc = text => Buffer.from(text, 'utf8');
const dec = bytes => Buffer.from(bytes).toString('utf8');
const skill = (name, body = '') => `---\nname: ${name}\ndescription: ${name} playbook.\n---\n${body}`;

const ws = { uri: vscode.Uri.file('/ws'), name: 'ws', index: 0 };
const context = {
	extensionUri: vscode.Uri.file('/ext'),
	extension: { packageJSON: { version: '9.9.9' } },
};
const MANAGED = '/ws/.reltio/reltio-agent';
const STAMP = `${MANAGED}/.sync-state.json`;

/** A fresh in-memory workspace and extension bundle with two valid skills and one Velocity Pack. */
async function world({ skills = '20', packs = '1' } = {}) {
	const mem = installMemoryFs();
	vscode.workspace.workspaceFolders = [ws];
	const put = (p, text) => mem.writeFile(p, enc(text));
	const setVersions = (s, p) => put('/ext/resources/reltio-agent-assets.json', JSON.stringify({ skillsBundleVersion: s, velocityPacksBundleVersion: p }));
	await setVersions(skills, packs);
	await put('/ext/skills/reltio-default/workflow-assistant/SKILL.md', skill('reltio-workflow-assistant', 'assistant v1\n'));
	await put('/ext/skills/reltio-default/match-groups-from-concept/SKILL.md', skill('reltio-match-groups-from-concept', 'bundled body\n'));
	await put('/ext/skills/reltio-default/match-groups-from-concept/reference.md', 'reference');
	await put('/ext/resources/velocity-packs/pack.json', '{"pack":1}');
	return {
		mem,
		put,
		setVersions,
		has: p => mem._files.has(p) || mem._dirs.has(p),
		/** File text, or undefined when absent, so a missing file fails an assertion rather than throwing. */
		text: p => (mem._files.has(p) ? dec(mem._files.get(p)) : undefined),
		stamp: () => (mem._files.has(STAMP) ? JSON.parse(dec(mem._files.get(STAMP))) : {}),
		/** Every file under `prefix`, with its bytes, for byte-identical comparisons. */
		snapshot: prefix => new Map([...mem._files].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, Buffer.from(v).toString('base64')])),
	};
}

/** Runs `fn` and records every write and delete under `prefix`. */
async function recordChanges(mem, prefix, fn) {
	const realWrite = mem.writeFile;
	const realDelete = mem.delete;
	const writes = [];
	const deletes = [];
	const norm = u => String(u.fsPath ?? u).replace(/\\/g, '/');
	mem.writeFile = async (uri, bytes) => { if (norm(uri).startsWith(prefix)) writes.push(norm(uri)); return realWrite(uri, bytes); };
	mem.delete = async (uri, opts) => { if (norm(uri).startsWith(prefix)) deletes.push(norm(uri)); return realDelete(uri, opts); };
	try {
		await fn();
	} finally {
		mem.writeFile = realWrite;
		mem.delete = realDelete;
	}
	return { writes, deletes };
}

/** Sets `reltio.installAgentSkills` for the duration of `fn`. */
async function withInstallSetting(value, fn) {
	const real = vscode.workspace.getConfiguration;
	vscode.workspace.getConfiguration = () => ({
		get: (key, fallback) => (key === 'installAgentSkills' ? value : fallback),
		update: async () => {},
	});
	try {
		return await fn();
	} finally {
		vscode.workspace.getConfiguration = real;
	}
}

// ── UTIL-002: stamp logic ───────────────────────────────────────────────────
async function testStampLogic() {
	// 1. A skills version bump deletes and recopies skills/default.
	{
		const w = await world({ skills: '20' });
		await syncReltioAgentAssets(context);
		assert.strictEqual(w.stamp().skillsBundleVersion, '20', 'UTIL-002 #1: fresh sync stamps 20');
		await w.put(`${MANAGED}/skills/default/stray.md`, 'stray');
		await w.put('/ext/skills/reltio-default/workflow-assistant/SKILL.md', skill('reltio-workflow-assistant', 'assistant v2\n'));
		await w.setVersions('21', '1');
		await syncReltioAgentAssets(context);
		assert.ok(!w.has(`${MANAGED}/skills/default/stray.md`), 'UTIL-002 #1: the stray file is gone after the bump');
		assert.ok((w.text(`${MANAGED}/skills/default/workflow-assistant/SKILL.md`) ?? '').includes('assistant v2'), 'UTIL-002 #1: the changed SKILL.md is recopied');
		assert.strictEqual(w.stamp().skillsBundleVersion, '21', 'UTIL-002 #1: the stamp becomes 21');
	}

	// 2. Unchanged versions: the second sync neither deletes nor recopies the managed layer.
	{
		const w = await world();
		await syncReltioAgentAssets(context);
		await w.put(`${MANAGED}/skills/default/marker.txt`, 'm1');
		await w.put(`${MANAGED}/velocity-packs/marker.txt`, 'm2');
		const { writes, deletes } = await recordChanges(w.mem, `${MANAGED}/`, () => syncReltioAgentAssets(context));
		assert.deepStrictEqual(writes, [], 'UTIL-002 #2: no managed-layer writes when versions are unchanged');
		assert.deepStrictEqual(deletes, [], 'UTIL-002 #2: no managed-layer deletes when versions are unchanged');
		assert.strictEqual(w.text(`${MANAGED}/skills/default/marker.txt`), 'm1', 'UTIL-002 #2: skills/default marker survives');
		assert.strictEqual(w.text(`${MANAGED}/velocity-packs/marker.txt`), 'm2', 'UTIL-002 #2: velocity-packs marker survives');
	}

	// 3. Only skills bump: packs are untouched and keep their own version.
	{
		const w = await world({ skills: '20', packs: '1' });
		await syncReltioAgentAssets(context);
		const ownedBefore = w.stamp().ownedAgentFiles ?? [];
		assert.ok(ownedBefore.length > 0, 'UTIL-002 #3: the fixture installs owned agent files');
		await w.put(`${MANAGED}/velocity-packs/marker.txt`, 'pack marker');
		await w.setVersions('21', '1');
		await syncReltioAgentAssets(context);
		const s = w.stamp();
		assert.strictEqual(s.skillsBundleVersion, '21', 'UTIL-002 #3: stamp shows skills 21');
		assert.strictEqual(s.velocityPacksBundleVersion, '1', 'UTIL-002 #3: stamp keeps packs 1');
		assert.deepStrictEqual(s.ownedAgentFiles, ownedBefore, 'UTIL-002 #3: ownedAgentFiles retained');
		assert.strictEqual(w.text(`${MANAGED}/velocity-packs/marker.txt`), 'pack marker', 'UTIL-002 #3: velocity-packs untouched');
	}

	// 4. A deleted folder is restored although the stamp is current; the other is not rewritten.
	{
		const w = await world();
		await syncReltioAgentAssets(context);
		await w.mem.delete(vscode.Uri.file(`${MANAGED}/velocity-packs`));
		const { writes } = await recordChanges(w.mem, `${MANAGED}/skills/default/`, () => syncReltioAgentAssets(context));
		const pack = `${MANAGED}/velocity-packs/pack.json`;
		assert.ok(w.has(pack) && w.text(pack) === '{"pack":1}', 'UTIL-002 #4: velocity-packs is recopied from resources/velocity-packs');
		assert.deepStrictEqual(writes, [], 'UTIL-002 #4: skills/default is not rewritten');
	}

	// 5. force restores a hand-edited managed file; a non-forced equal-stamp run leaves it alone.
	{
		const w = await world();
		await syncReltioAgentAssets(context);
		const file = `${MANAGED}/skills/default/workflow-assistant/SKILL.md`;
		const bundled = w.text(file);
		await w.put(file, 'hand edit');
		await syncReltioAgentAssets(context);
		assert.strictEqual(w.text(file), 'hand edit', 'UTIL-002 #5: a non-forced equal-stamp run leaves the edit alone');
		await syncReltioAgentAssets(context, { force: true });
		assert.strictEqual(w.text(file), bundled, 'UTIL-002 #5: force restores bundled content');
		const s = w.stamp();
		assert.strictEqual(s.skillsBundleVersion, '20', 'UTIL-002 #5: stamp stays at the bundled skills version');
		assert.strictEqual(s.velocityPacksBundleVersion, '1', 'UTIL-002 #5: stamp stays at the bundled packs version');
	}
}

// ── UTIL-004: contracts ─────────────────────────────────────────────────────
async function testContracts() {
	// 1. Headers per call.
	const original = globalThis.fetch;
	const calls = [];
	const respond = (url, init) => {
		calls.push({ url: String(url), init });
		const body = /enhancedTenants|_search/.test(url) ? [] : /_verifyMatches/.test(url) ? {} : '';
		return { status: 200, ok: true, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
	};
	const host = 'test.reltio.com';
	try {
		globalThis.fetch = async (url, init) => respond(String(url), init);
		const cases = [
			['listTenants', () => client.listTenants(host, 'tok'), { clientId: false, auth: true, contentType: false }],
			['fetchL3Configuration', () => client.fetchL3Configuration(host, 't', 'tok'), { clientId: true, auth: true, contentType: false }],
			['putL3Configuration', () => client.putL3Configuration(host, 't', 'tok', '{}'), { clientId: true, auth: true, contentType: true }],
			['searchEntities', () => client.searchEntities(host, 't', 'tok', { filter: 'f', max: 1, offset: 0 }), { clientId: true, auth: true, contentType: true }],
			['verifyMatches', () => client.verifyMatches(host, 't', 'tok', { first: 'a', second: 'b', matchGroups: [] }), { clientId: true, auth: true, contentType: true }],
			['validateEnvironment', () => client.validateEnvironment(host), { clientId: true, auth: false, contentType: false }],
		];
		for (const [name, call, want] of cases) {
			calls.length = 0;
			await call();
			assert.strictEqual(calls.length, 1, `UTIL-004 #1: ${name} sends one request`);
			const h = calls[0].init.headers;
			if (want.clientId) assert.strictEqual(h['xxx-client'], 'true', `UTIL-004 #1: ${name} sends xxx-client: true`);
			else assert.ok(!Object.keys(h).some(k => k.toLowerCase() === 'xxx-client'), `UTIL-004 #1: ${name} lacks xxx-client`);
			if (want.auth) assert.strictEqual(h.Authorization, 'Bearer tok', `UTIL-004 #1: ${name} sends Authorization 'Bearer tok'`);
			else assert.ok(!('Authorization' in h), `UTIL-004 #1: ${name} sends no Authorization without a token`);
			if (want.contentType) assert.strictEqual(h['Content-Type'], 'application/json', `UTIL-004 #1: ${name} (${calls[0].init.method}) sends Content-Type`);
		}
	} finally {
		globalThis.fetch = original;
	}

	// 2. Sync early returns.
	const noManaged = (w, label) => {
		assert.ok(!w.has(MANAGED), `UTIL-004 #2: ${label}: no .reltio/reltio-agent directory`);
		assert.ok(!w.has(STAMP), `UTIL-004 #2: ${label}: no stamp`);
	};
	for (const [label, prepare] of [
		['no assets file', w => w.mem.delete(vscode.Uri.file('/ext/resources/reltio-agent-assets.json'))],
		['missing velocityPacksBundleVersion', w => w.put('/ext/resources/reltio-agent-assets.json', JSON.stringify({ skillsBundleVersion: '20' }))],
		['invalid JSON', w => w.put('/ext/resources/reltio-agent-assets.json', '{not json')],
		['no workspace folders', async () => { vscode.workspace.workspaceFolders = []; }],
	]) {
		const w = await world();
		await prepare(w);
		let report;
		try {
			report = await syncReltioAgentAssets(context);
		} catch (e) {
			assert.fail(`UTIL-004 #2: ${label}: must not throw (threw ${e && e.message})`);
		}
		assert.deepStrictEqual(report, { conflicts: [], invalid: [] }, `UTIL-004 #2: ${label}: returns an empty report`);
		noManaged(w, label);
	}
	vscode.workspace.workspaceFolders = [ws];
}

// ── UTIL-006: override layer and opt-out ────────────────────────────────────
async function testOverrideLayer() {
	const OVERRIDES = '/ws/skills/workspace/';
	const teamMatch = skill('reltio-match-groups-from-concept', 'team override body\n');

	// 1 + 2. The override layer is byte-identical across every kind of sync, and lands in the install only.
	{
		const w = await world();
		await w.put(`${OVERRIDES}match-groups-from-concept/SKILL.md`, teamMatch);
		await w.put(`${OVERRIDES}team-only/SKILL.md`, skill('team-only', 'team\n'));
		await w.put(`${OVERRIDES}NOTES.md`, 'loose note');
		const before = w.snapshot(OVERRIDES);
		const same = label => assert.deepStrictEqual(w.snapshot(OVERRIDES), before, `UTIL-006 #1: skills/workspace is byte-identical after the ${label} sync`);

		await syncReltioAgentAssets(context);
		same('fresh');
		// 2. Managed default keeps bundled content; the installed copy shows the override.
		assert.ok((w.text(`${MANAGED}/skills/default/match-groups-from-concept/SKILL.md`) ?? '').includes('bundled body'), 'UTIL-006 #2: the managed default copy keeps bundled content');
		assert.strictEqual(w.text('/ws/.claude/skills/reltio-match-groups-from-concept/SKILL.md'), teamMatch, 'UTIL-006 #2: the installed .claude copy shows the override');

		await w.setVersions('21', '2');
		await syncReltioAgentAssets(context);
		same('version-bump');
		await syncReltioAgentAssets(context, { force: true });
		same('forced');
		await withInstallSetting(false, () => syncReltioAgentAssets(context));
		same('install=false');
	}

	// 3. Opting out removes stamp-owned paths only; the managed layer is still synced.
	{
		const w = await world();
		await syncReltioAgentAssets(context);
		const owned = w.stamp().ownedAgentFiles ?? [];
		assert.ok(owned.length > 0, 'UTIL-006 #3: the fixture installs owned paths');
		await w.put('/ws/.claude/skills/my-own/SKILL.md', 'user skill');
		await w.put('/ws/.claude/rules/team.md', 'team rule');
		await w.setVersions('21', '1');
		await w.put('/ext/skills/reltio-default/workflow-assistant/SKILL.md', skill('reltio-workflow-assistant', 'assistant v2\n'));
		await withInstallSetting(false, () => syncReltioAgentAssets(context));
		for (const rel of owned) assert.ok(!w.has(`/ws/${rel}`), `UTIL-006 #3: owned path ${rel} vanished`);
		assert.deepStrictEqual(w.stamp().ownedAgentFiles, [], 'UTIL-006 #3: ownedAgentFiles becomes []');
		assert.strictEqual(w.text('/ws/.claude/skills/my-own/SKILL.md'), 'user skill', 'UTIL-006 #3: the user skill remains');
		assert.strictEqual(w.text('/ws/.claude/rules/team.md'), 'team rule', 'UTIL-006 #3: the team rule remains');
		assert.strictEqual(w.stamp().skillsBundleVersion, '21', 'UTIL-006 #3: the managed layer is still synced (stamp 21)');
		assert.ok((w.text(`${MANAGED}/skills/default/workflow-assistant/SKILL.md`) ?? '').includes('assistant v2'), 'UTIL-006 #3: the managed layer holds the new bundle');
	}
}

(async () => {
	await testStampLogic();
	await testContracts();
	await testOverrideLayer();
	console.log('test-agent-skills: OK');
})().catch(e => {
	console.error(e);
	process.exit(1);
});
