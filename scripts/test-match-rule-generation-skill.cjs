#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: match-rule-generation-skill
 *
 * Tier A: match-verification bridge (every status, reason and failure kind; identity from the
 *         extension, never the request; 401 refresh; stop at first failure), verifyMatches client
 *         wire format, agent-skill install / conflict / refresh / retire / opt-out on an
 *         in-memory filesystem.
 * Tier B: skill content checked against the code and the shipped corpus: every worked example
 *         validates against the schema, every class named is used by a Velocity Pack, and SKILL.md
 *         covers every status, reason, failure kind and outcome the bridge can emit.
 * Tier C (manual): openspec/changes/match-rule-generation-skill/design.md
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const { importDist } = require('./lib/import-dist.cjs');
const { repoRoot } = require('./lib/load-canonical-fixture.cjs');
const { installMemoryFs } = require('./lib/memory-fs.cjs');
const vscode = require('./lib/vscode-stub.cjs');

const bridge = importDist('workspace/matchVerification');
const discovery = importDist('workspace/agentSkillDiscovery');
const client = importDist('api/reltioClient');
const { GIT_SOURCE_TOKEN } = importDist('api/tokenStore');

const U = p => vscode.Uri.file(p);
const ROOT = U('/ws');
const CONFIG = 'dev/T1/Business Config/BusinessConfig.json';
const TENANT = { environmentName: 'dev.reltio.com', tenantId: 'T1' };
const GROUP_URI = 'configuration/entityTypes/Individual/matchGroups/Candidate';
const entity = first => ({
	type: 'configuration/entityTypes/Individual',
	attributes: { FirstName: [{ value: first }] },
});
const request = (over = {}) => ({
	requestId: 'r1',
	configFile: CONFIG,
	matchGroups: [{ uri: GROUP_URI, label: 'Candidate', type: 'suspect', rule: { exact: ['x'] } }],
	pairs: [
		{ label: 'exact', first: entity('Robert'), second: entity('Robert') },
		{ label: 'near', first: entity('Robert'), second: entity('Bob') },
		{ label: 'different', first: entity('Robert'), second: entity('Alice') },
	],
	...over,
});

/** Deps whose every external effect is recorded, with overridable behaviour. */
function makeDeps(over = {}) {
	const calls = [];
	const deps = {
		workspaceRoot: ROOT,
		isEnabled: () => true,
		isRepositoryMode: () => false,
		resolveTenant: async uri => (uri.path.toLowerCase().startsWith('/ws/dev/t1/') ? TENANT : undefined),
		getToken: () => 'tok',
		tryRefresh: async () => false,
		verify: async (env, tenant, token, body) => {
			calls.push({ env, tenant, token, body });
			return { rules: { [GROUP_URI]: { matched: true, matchAction: 'POTENTIAL_MATCH', matchedByDocuments: true } } };
		},
		...over,
	};
	return { deps, calls };
}

const run = (raw, over) => {
	const { deps, calls } = makeDeps(over);
	return bridge.handleVerificationRequest(raw, deps).then(result => ({ result, calls }));
};

async function testBridgeGates() {
	let { result, calls } = await run(request(), { isEnabled: () => false });
	assert.deepStrictEqual([result.status, result.reason, result.requestId], ['not-verified', 'disabled', 'r1']);
	assert.strictEqual(calls.length, 0, 'disabled never calls the tenant');

	({ result, calls } = await run(request(), { isRepositoryMode: () => true }));
	assert.deepStrictEqual([result.status, result.reason], ['not-verified', 'repository-mode']);
	assert.strictEqual(calls.length, 0);

	({ result } = await run(request({ configFile: 'samples/scratch.reltio.json' })));
	assert.deepStrictEqual([result.status, result.reason], ['not-verified', 'no-tenant']);

	for (const token of [undefined, GIT_SOURCE_TOKEN]) {
		({ result, calls } = await run(request(), { getToken: () => token }));
		assert.deepStrictEqual([result.status, result.reason], ['not-verified', 'signed-out'], `token ${token}`);
		assert.strictEqual(calls.length, 0, 'never sends a missing or sentinel token');
	}
}

async function testBridgeRejectsMalformedRequests() {
	const tooMany = n => Array.from({ length: n }, (_, i) => ({ label: `p${i}`, first: entity('a'), second: entity('a') }));
	const cases = {
		'not an object': [],
		'no requestId': request({ requestId: '' }),
		'no configFile': request({ configFile: undefined }),
		'escapes workspace': request({ configFile: '../outside/BusinessConfig.json' }),
		'absolute outside': request({ configFile: '/etc/BusinessConfig.json' }),
		'no groups': request({ matchGroups: [] }),
		'group without uri': request({ matchGroups: [{ label: 'x' }] }),
		'too many groups': request({ matchGroups: Array.from({ length: bridge.MAX_MATCH_GROUPS + 1 }, (_, i) => ({ uri: `g${i}` })) }),
		'no pairs': request({ pairs: [] }),
		'too many pairs': request({ pairs: tooMany(bridge.MAX_PAIRS + 1) }),
		'pair missing second': request({ pairs: [{ label: 'x', first: entity('a') }] }),
	};
	for (const [name, raw] of Object.entries(cases)) {
		const { result, calls } = await run(raw);
		assert.strictEqual(result.status, 'failed', name);
		assert.strictEqual(result.error.kind, 'invalid-request', name);
		assert.strictEqual(calls.length, 0, `${name}: nothing sent`);
	}
}

async function testBridgeVerifies() {
	// The request tries to choose its own target. Identity must come from the extension's resolver.
	const verdicts = {
		exact: { matched: true, matchAction: 'POTENTIAL_MATCH', matchedByDocuments: true },
		near: { matched: false, matchedByDocuments: true },
		different: { matched: false, matchedByDocuments: false },
	};
	const calls = [];
	const { result } = await run(request({ environment: 'evil.example.com', tenant: 'X' }), {
		verify: async (env, tenant, token, body) => {
			calls.push({ env, tenant, token, body });
			const label = ['exact', 'near', 'different'][calls.length - 1];
			return { summary: ['s'], rules: { [GROUP_URI]: verdicts[label] } };
		},
	});
	assert.strictEqual(result.status, 'verified');
	assert.deepStrictEqual(result.tenant, { environment: 'dev.reltio.com', tenantId: 'T1' });
	assert.deepStrictEqual(result.pairs.map(p => p.outcome), ['suspect', 'no-shared-token', 'no-match']);
	assert.strictEqual(calls.length, 3, 'one call per pair');
	for (const c of calls) {
		assert.deepStrictEqual([c.env, c.tenant, c.token], ['dev.reltio.com', 'T1', 'tok']);
		assert.deepStrictEqual(Object.keys(c.body).sort(), ['first', 'matchGroups', 'second']);
		assert.strictEqual(c.body.matchGroups[0].uri, GROUP_URI);
	}

	// Strongest verdict across candidate rules wins; a rule the server did not report is no-match.
	const two = bridge.summarizePair('p', { rules: {
		a: { matched: true, matchAction: 'AUTO_MERGE' },
		b: { matched: true, matchAction: 'POTENTIAL_MATCH' },
	} }, ['a', 'b', 'missing']);
	assert.strictEqual(two.outcome, 'auto-merge');
	assert.deepStrictEqual([two.rules.missing.evaluated, two.rules.missing.matched], [false, false]);
	assert.strictEqual(bridge.summarizePair('p', { rules: { a: { matched: true, matchAction: 'SOMETHING' } } }, ['a']).outcome, 'matched');

	// Reltio's per-attribute breakdown is passed through for when the user asks for it.
	const breakdown = { relevance: 1, and: [{ exact: { Email: { ignoreInToken: false, relevance: 1 } }, relevance: 1 }] };
	const explained = bridge.summarizePair('p', { rules: { a: { matched: true, matchAction: 'POTENTIAL_MATCH', rule: breakdown } } }, ['a']);
	assert.deepStrictEqual(explained.rules.a.explanation, breakdown);
	assert.ok(!('explanation' in two.rules.a), 'no explanation key when the server sent none');
}

async function testBridgeAuthAndFailures() {
	const unauthorized = () => { throw new client.ReltioApiError('Unauthorized (401)', 401); };

	// 401 → silent refresh → one retry with the new token.
	let token = 'old';
	const tokens = [];
	let { result } = await run(request({ pairs: request().pairs.slice(0, 1) }), {
		getToken: () => token,
		tryRefresh: async () => { token = 'new'; return true; },
		verify: async (env, t, tok) => {
			tokens.push(tok);
			if (tok === 'old') unauthorized();
			return { rules: {} };
		},
	});
	assert.strictEqual(result.status, 'verified');
	assert.deepStrictEqual(tokens, ['old', 'new']);

	// 401 and the refresh fails → signed-out, which lets the agent fall back.
	({ result } = await run(request(), { verify: async () => unauthorized() }));
	assert.deepStrictEqual([result.status, result.reason], ['not-verified', 'signed-out']);

	// A 400 on the second pair stops the run, keeps the first result and the server's body.
	let n = 0;
	const sent = [];
	({ result } = await run(request(), {
		verify: async (...args) => {
			sent.push(args);
			if (++n === 2) throw new client.ReltioApiError('Verify matches failed: HTTP 400', 400, '{"errorMessage":"bad uri"}');
			return { rules: {} };
		},
	}));
	assert.strictEqual(result.status, 'failed');
	assert.deepStrictEqual(
		[result.error.kind, result.error.httpStatus, result.error.responseBody, result.error.pairLabel],
		['api-error', 400, '{"errorMessage":"bad uri"}', 'near'],
	);
	assert.strictEqual(result.pairs.length, 1);
	assert.strictEqual(sent.length, 2, 'stops at the first failing pair');

	({ result } = await run(request(), { verify: async () => { throw new client.UntrustedHostError('nope'); } }));
	assert.strictEqual(result.error.kind, 'untrusted-host');
	({ result } = await run(request(), { verify: async () => { throw new Error('Network error: ECONNRESET'); } }));
	assert.strictEqual(result.error.kind, 'network');
}

async function testVerifyMatchesClient() {
	const original = globalThis.fetch;
	const seen = [];
	const respond = (status, body) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body) });
	try {
		globalThis.fetch = async (url, init) => { seen.push({ url: String(url), init }); return respond(200, { rules: {} }); };
		const body = { first: 'entities/1', second: 'entities/2', matchGroups: [{ uri: GROUP_URI }] };
		await client.verifyMatches('dev.reltio.com', 'T 1', 'tok', body);
		assert.strictEqual(seen[0].url, 'https://dev.reltio.com/reltio/api/T%201/entities/_verifyMatches');
		assert.strictEqual(seen[0].init.method, 'POST');
		assert.strictEqual(seen[0].init.headers.Authorization, 'Bearer tok');
		assert.strictEqual(seen[0].init.headers['Content-Type'], 'application/json');
		assert.deepStrictEqual(JSON.parse(seen[0].init.body), body);

		globalThis.fetch = async () => respond(401, {});
		await assert.rejects(client.verifyMatches('dev.reltio.com', 'T1', 'tok', body), e => e.statusCode === 401);
		globalThis.fetch = async () => respond(400, { errorMessage: 'bad' });
		await assert.rejects(client.verifyMatches('dev.reltio.com', 'T1', 'tok', body),
			e => e.statusCode === 400 && e.responseBody.includes('bad'));

		seen.length = 0;
		globalThis.fetch = async (url, init) => { seen.push(url); return respond(200, {}); };
		await assert.rejects(client.verifyMatches('evil.example.com', 'T1', 'tok', body), client.UntrustedHostError);
		assert.strictEqual(seen.length, 0, 'token never sent to an untrusted host');
	} finally {
		globalThis.fetch = original;
	}
}

// --- Agent skill discovery ---------------------------------------------------------------------

/** Copies the real bundled skills into the memory filesystem as the extension's skill source. */
async function seedBundledSkills(src) {
	const realSrc = path.join(repoRoot, 'skills', 'reltio-default');
	for (const playbook of fs.readdirSync(realSrc)) {
		for (const file of fs.readdirSync(path.join(realSrc, playbook))) {
			await vscode.workspace.fs.writeFile(
				vscode.Uri.joinPath(src, playbook, file),
				fs.readFileSync(path.join(realSrc, playbook, file)),
			);
		}
	}
	return fs.readdirSync(realSrc);
}

const read = async uri => Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');

const guidesFor = host => discovery.HOST_LAYOUTS[host].guides.map(g => discovery.GUIDE_FILES[g]);

/** Runs `fn` and counts `workspace.fs.writeFile` calls made meanwhile. */
async function countWrites(fn) {
	const fsApi = vscode.workspace.fs;
	const original = fsApi.writeFile;
	let writes = 0;
	fsApi.writeFile = async (...args) => { writes++; return original.apply(fsApi, args); };
	try {
		return { result: await fn(), writes };
	} finally {
		fsApi.writeFile = original;
	}
}
const exists = async uri => vscode.workspace.fs.stat(uri).then(() => true, () => false);

async function testAgentSkillSync() {
	installMemoryFs();
	const src = U('/ext/skills/reltio-default');
	const playbooks = await seedBundledSkills(src);
	const { skills, invalid } = await discovery.readBundledSkills(src);
	assert.deepStrictEqual(invalid, [], 'every bundled skill meets the Agent Skills naming rules');
	assert.strictEqual(skills.length, playbooks.length);
	for (const s of skills) assert.strictEqual(s.name, `reltio-${s.playbook}`, `${s.playbook} name follows reltio-<playbook>`);

	// Something the user owns, and something unrelated, both of which must survive everything below.
	const userSkill = vscode.Uri.joinPath(ROOT, '.claude', 'skills', 'reltio-workspace-merge', 'SKILL.md');
	const unrelated = vscode.Uri.joinPath(ROOT, '.cursor', 'rules', 'team.mdc');
	await vscode.workspace.fs.writeFile(userSkill, Buffer.from('mine'));
	await vscode.workspace.fs.writeFile(unrelated, Buffer.from('team rule'));

	const first = await discovery.syncAgentSkills(ROOT, src, [], { install: true, host: 'cursor' });
	assert.deepStrictEqual(first.conflicts, ['.claude/skills/reltio-workspace-merge'], 'occupied path reported');
	assert.strictEqual(await read(userSkill), 'mine', 'user-owned folder untouched');
	assert.ok(!first.owned.includes('.claude/skills/reltio-workspace-merge'));

	const match = vscode.Uri.joinPath(ROOT, '.claude', 'skills', 'reltio-match-groups-from-concept');
	assert.ok(await exists(vscode.Uri.joinPath(match, 'SKILL.md')));
	assert.ok(await exists(vscode.Uri.joinPath(match, 'reference.md')), 'companion files travel with the skill');

	for (const rel of guidesFor('cursor')) {
		assert.ok(first.owned.includes(rel), `${rel} owned`);
		const text = await read(vscode.Uri.joinPath(ROOT, ...rel.split('/')));
		for (const s of skills) assert.ok(text.includes(s.name), `${rel} lists ${s.name}`);
		assert.ok(text.includes('Resync agent assets'), `${rel} says how to restore a missing skill`);
	}
	assert.ok((await read(vscode.Uri.joinPath(ROOT, '.cursor', 'rules', 'reltio-skills.mdc'))).includes('alwaysApply: true'));

	const gitignore = (await read(vscode.Uri.joinPath(ROOT, '.gitignore'))).split('\n');
	for (const rel of first.owned) {
		assert.ok(gitignore.includes(rel) || gitignore.includes(`${rel}/`), `${rel} gitignored`);
	}
	assert.ok(!gitignore.includes('.claude/') && !gitignore.includes('.cursor/'), 'never ignores the whole agent folder');

	// An unchanged workspace is not rewritten.
	let next = await countWrites(() => discovery.syncAgentSkills(ROOT, src, first.owned, { install: true, host: 'cursor' }));
	assert.strictEqual(next.writes, 0, 'second sync with nothing changed writes nothing');
	next = next.result;

	// Managed copies are generated: a hand edit, a stray file and a stale guide are all put back.
	const matchSkill = vscode.Uri.joinPath(match, 'SKILL.md');
	const original = await read(matchSkill);
	const stray = vscode.Uri.joinPath(match, 'notes.md');
	const guide = vscode.Uri.joinPath(ROOT, '.claude', 'rules', 'reltio-skills.md');
	await vscode.workspace.fs.writeFile(matchSkill, Buffer.from('edited'));
	await vscode.workspace.fs.writeFile(stray, Buffer.from('stray'));
	await vscode.workspace.fs.writeFile(guide, Buffer.from('stale'));
	next = await discovery.syncAgentSkills(ROOT, src, next.owned, { install: true, host: 'cursor' });
	assert.strictEqual(await read(matchSkill), original);
	assert.ok(!(await exists(stray)), 'stray file removed from a managed copy');
	assert.notStrictEqual(await read(guide), 'stale');

	// A skill dropped from the bundle is retired.
	const retired = vscode.Uri.joinPath(ROOT, '.claude', 'skills', 'reltio-retired', 'SKILL.md');
	await vscode.workspace.fs.writeFile(retired, Buffer.from('old'));
	next = await discovery.syncAgentSkills(ROOT, src, [...next.owned, '.claude/skills/reltio-retired'], { install: true, host: 'cursor' });
	assert.ok(!(await exists(retired)));
	assert.ok(!next.owned.includes('.claude/skills/reltio-retired'));

	// Opting out removes everything owned and nothing else.
	const off = await discovery.syncAgentSkills(ROOT, src, next.owned, { install: false, host: 'cursor' });
	assert.deepStrictEqual(off.owned, []);
	for (const rel of next.owned) assert.ok(!(await exists(vscode.Uri.joinPath(ROOT, ...rel.split('/')))), `${rel} removed`);
	assert.strictEqual(await read(userSkill), 'mine');
	assert.strictEqual(await read(unrelated), 'team rule');

	// A skill agents would reject is reported, not installed.
	installMemoryFs();
	const bad = U('/ext2/skills');
	await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(bad, 'Bad_Name', 'SKILL.md'), Buffer.from('---\nname: Bad_Name\ndescription: x\n---\n'));
	const rejected = await discovery.syncAgentSkills(ROOT, bad, [], { install: true, host: 'cursor' });
	assert.strictEqual(rejected.invalid.length, 1);
	assert.ok(!(await exists(vscode.Uri.joinPath(ROOT, '.claude', 'skills', 'Bad_Name'))));
}

async function testWorkspaceOverrides() {
	installMemoryFs();
	const src = U('/ext/skills/reltio-default');
	await seedBundledSkills(src);
	const overrides = vscode.Uri.joinPath(ROOT, 'skills', 'workspace');
	const installed = vscode.Uri.joinPath(ROOT, '.claude', 'skills', 'reltio-match-groups-from-concept');
	const defaultSkill = fs.readFileSync(path.join(repoRoot, 'skills', 'reltio-default', 'match-groups-from-concept', 'SKILL.md'), 'utf8');

	// An override of a bundled playbook wins file by file; defaults it does not replace stay.
	const teamSkill = '---\nname: reltio-match-groups-from-concept\ndescription: Team match rules playbook.\n---\n\nTeam body\n';
	await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(overrides, 'match-groups-from-concept', 'SKILL.md'), Buffer.from(teamSkill));
	// A playbook only the team has is installed as a skill of its own.
	await vscode.workspace.fs.writeFile(
		vscode.Uri.joinPath(overrides, 'team-notes', 'SKILL.md'),
		Buffer.from('---\nname: team-notes\ndescription: Team conventions.\n---\n'),
	);
	let r = await discovery.syncAgentSkills(ROOT, src, [], { install: true });
	assert.deepStrictEqual(r.invalid, []);
	assert.strictEqual(await read(vscode.Uri.joinPath(installed, 'SKILL.md')), teamSkill, 'override wins');
	assert.ok(await exists(vscode.Uri.joinPath(installed, 'reference.md')), 'default companion kept under an override');
	assert.ok(await exists(vscode.Uri.joinPath(ROOT, '.claude', 'skills', 'team-notes', 'SKILL.md')), 'override-only skill installed');
	assert.ok(r.owned.includes('.claude/skills/team-notes'));
	for (const rel of guidesFor('other')) {
		const text = await read(vscode.Uri.joinPath(ROOT, ...rel.split('/')));
		assert.ok(text.includes('Team match rules playbook.') && text.includes('team-notes'), `${rel} reflects the overrides`);
	}

	// Editing the override reaches the installed copy on the next sync; removing it restores the default.
	const edited = teamSkill.replace('Team body', 'Team body v2');
	await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(overrides, 'match-groups-from-concept', 'SKILL.md'), Buffer.from(edited));
	r = await discovery.syncAgentSkills(ROOT, src, r.owned, { install: true });
	assert.strictEqual(await read(vscode.Uri.joinPath(installed, 'SKILL.md')), edited);
	await vscode.workspace.fs.delete(vscode.Uri.joinPath(overrides, 'match-groups-from-concept'), { recursive: true });
	await vscode.workspace.fs.delete(vscode.Uri.joinPath(overrides, 'team-notes'), { recursive: true });
	r = await discovery.syncAgentSkills(ROOT, src, r.owned, { install: true });
	assert.strictEqual((await read(vscode.Uri.joinPath(installed, 'SKILL.md'))).replace(/\r\n/g, '\n'), defaultSkill.replace(/\r\n/g, '\n'));
	assert.ok(!(await exists(vscode.Uri.joinPath(ROOT, '.claude', 'skills', 'team-notes'))), 'removed override-only skill retired');

	// An override that renames the skill is reported, and neither it nor the default is installed:
	// serving the default would silently ignore the team's override.
	await vscode.workspace.fs.writeFile(
		vscode.Uri.joinPath(overrides, 'match-groups-from-concept', 'SKILL.md'),
		Buffer.from('---\nname: our-match-rules\ndescription: Renamed.\n---\n'),
	);
	r = await discovery.syncAgentSkills(ROOT, src, r.owned, { install: true });
	assert.strictEqual(r.invalid.length, 1);
	assert.ok(r.invalid[0].includes('skills/workspace/match-groups-from-concept'));
	assert.ok(!(await exists(installed)), 'nothing served in place of a broken override');
	assert.ok(!(await exists(vscode.Uri.joinPath(ROOT, '.claude', 'skills', 'our-match-rules'))));

	// The extension never writes to the override layer.
	assert.ok((await read(vscode.Uri.joinPath(overrides, 'match-groups-from-concept', 'SKILL.md'))).includes('our-match-rules'));
}

/**
 * Regression: emptying the folder and connecting again left the workspace without agent assets,
 * because the sync ran once per window session. Losing the mode must re-arm it.
 */
function testModeSyncTrigger() {
	const { createModeSyncTrigger } = importDist('workspace/reltioAgentSync');
	let syncs = 0;
	const onMode = createModeSyncTrigger(() => syncs++);
	onMode(undefined);
	assert.strictEqual(syncs, 0, 'no sync before a mode is chosen');
	onMode('tenant');
	onMode('tenant');
	assert.strictEqual(syncs, 1, 'once per mode');
	onMode(undefined);
	onMode('tenant');
	assert.strictEqual(syncs, 2, 'reconnecting after the folder was emptied syncs again');
	onMode(undefined);
	onMode('git');
	assert.strictEqual(syncs, 3, 'switching to repository mode syncs');
}

/** Each editor gets `.claude/` plus its own folders, and never another editor's. */
async function testHostLayouts() {
	const { detectHost } = discovery;
	assert.strictEqual(detectHost({ uriScheme: 'cursor', appName: 'Cursor' }), 'cursor');
	assert.strictEqual(detectHost({ uriScheme: 'vscode', appName: 'Visual Studio Code' }), 'vscode');
	assert.strictEqual(detectHost({ uriScheme: 'vscode-insiders' }), 'vscode');
	assert.strictEqual(detectHost({ appName: 'Cursor' }), 'cursor');
	assert.strictEqual(detectHost({ uriScheme: 'windsurf', appName: 'Windsurf' }), 'other');
	assert.strictEqual(detectHost(undefined), 'other');

	installMemoryFs();
	const src = U('/ext/skills/reltio-default');
	await seedBundledSkills(src);
	const { skills } = await discovery.readBundledSkills(src);
	const at = rel => vscode.Uri.joinPath(ROOT, ...rel.split('/'));
	const has = async (dir) => (await Promise.all(skills.map(s => exists(at(`${dir}/${s.name}/SKILL.md`))))).every(Boolean);
	// A team's CI workflows live in .github; switching editors must never touch them.
	const workflow = at('.github/workflows/ci.yml');
	await vscode.workspace.fs.writeFile(workflow, Buffer.from('ci'));

	// VS Code: .claude + .github, no .cursor at all.
	let r = await discovery.syncAgentSkills(ROOT, src, [], { install: true, host: 'vscode' });
	assert.ok(await has('.claude/skills') && await has('.github/skills'), 'VS Code: .claude and .github skills');
	assert.ok(!(await exists(at('.cursor'))), 'VS Code: no .cursor folder');
	const copilotGuide = await read(at(discovery.GUIDE_FILES.copilot));
	assert.ok(copilotGuide.includes("applyTo: '**'") && copilotGuide.includes('.github/skills/<name>/SKILL.md'));
	assert.ok(await exists(at(discovery.GUIDE_FILES.claude)));

	// Same workspace opened in Cursor: VS Code's copies go, Cursor's arrive, .claude stays.
	r = await discovery.syncAgentSkills(ROOT, src, r.owned, { install: true, host: 'cursor' });
	assert.ok(await has('.claude/skills') && await has('.cursor/skills'), 'Cursor: .claude and .cursor skills');
	assert.ok(!(await exists(at('.github/skills'))) && !(await exists(at(discovery.GUIDE_FILES.copilot))), 'Cursor: VS Code copies removed');
	assert.ok((await read(at(discovery.GUIDE_FILES.cursor))).includes('alwaysApply: true'));
	assert.strictEqual(await read(workflow), 'ci', 'unrelated .github content untouched');
	assert.ok(!(await exists(at('.github/instructions'))), 'emptied .github/instructions removed');
	assert.ok(await exists(at('.github')), '.github kept: it still holds the workflow');
	assert.ok(r.owned.every(rel => !rel.startsWith('.github/')));

	// Any other editor: .claude only.
	r = await discovery.syncAgentSkills(ROOT, src, r.owned, { install: true, host: 'other' });
	assert.ok(await has('.claude/skills'));
	assert.ok(!(await exists(at('.cursor/skills'))) && !(await exists(at(discovery.GUIDE_FILES.cursor))), 'other: Cursor copies removed');
	assert.deepStrictEqual(r.owned.filter(rel => !rel.startsWith('.claude/')), [], 'other: only .claude owned');
	assert.ok(!(await exists(at('.cursor'))), 'emptied .cursor removed entirely');
}

// --- Skill content against code and corpus -----------------------------------------------------

function velocityPackText() {
	const out = [];
	(function walk(dir) {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, e.name);
			if (e.isDirectory()) walk(p);
			else if (e.name.endsWith('.json')) out.push(fs.readFileSync(p, 'utf8'));
		}
	})(path.join(repoRoot, 'resources', 'velocity-packs'));
	return out.join('\n');
}

function testSkillContent() {
	const dir = path.join(repoRoot, 'skills', 'reltio-default', 'match-groups-from-concept');
	const skill = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
	const reference = fs.readFileSync(path.join(dir, 'reference.md'), 'utf8');
	const examples = fs.readFileSync(path.join(dir, 'examples.md'), 'utf8');

	// Every complete match group in the reference validates against the shipped schema.
	const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'schemas', 'reltio-metadata.schema.json'), 'utf8'));
	const ajv = new Ajv({ strict: false, allErrors: true });
	ajv.addSchema(schema, 'reltio');
	const validate = ajv.compile({ $ref: 'reltio#/$defs/MatchGroup' });
	const groups = [...reference.matchAll(/```json\r?\n([\s\S]*?)```/g)]
		.map(m => { try { return JSON.parse(m[1]); } catch { return undefined; } })
		.filter(g => g && typeof g.uri === 'string' && g.uri.includes('/matchGroups/'));
	assert.ok(groups.length >= 3, `worked examples found: ${groups.length}`);
	for (const g of groups) assert.ok(validate(g), `${g.uri}: ${ajv.errorsText(validate.errors)}`);

	// Grounding: every class the skill names is used by a shipped configuration, or is one of the
	// classes Reltio's internal match-rules knowledge base documents but no Velocity Pack happens to
	// use. The knowledge base itself is internal and stays out of this public repository, so only
	// the class names are listed here. Anything else is a class the skill made up.
	const DOCUMENTED_NOT_IN_PACKS = [
		'ProximateGeoToken', 'ProximateGeoComparator',
		'RangeNumericMatchToken', 'RangeNumericComparator',
		'CrossMultiComparator',
		'FuzzyTextAndNumberMatchToken', 'JaroWinklerComparator',
		'RegexpReplaceCleanser',
	];
	const corpus = velocityPackText();
	const named = new Set();
	for (const text of [skill, reference, examples]) {
		for (const m of text.matchAll(/com\.reltio\.[\w.]+/g)) named.add(m[0].replace(/\.$/, ''));
		for (const m of text.matchAll(/`(\w+(?:MatchToken|Token|Comparator|Distance|Cleanser))`/g)) named.add(m[1]);
	}
	for (const cls of named) {
		if (cls.endsWith('.token') || cls.endsWith('.comparator')) continue; // the prefixes themselves
		const simple = cls.split('.').pop();
		assert.ok(
			corpus.includes(cls) || DOCUMENTED_NOT_IN_PACKS.includes(simple),
			`${cls} is neither used by a Velocity Pack nor documented by Reltio`,
		);
	}
	for (const cls of DOCUMENTED_NOT_IN_PACKS) {
		assert.ok(!corpus.includes(cls), `${cls} is now in a Velocity Pack; drop it from DOCUMENTED_NOT_IN_PACKS`);
	}

	// useOvOnly: the skill writes booleans; the schema must accept them and the string form packs use.
	const ovSchema = schema.$defs.MatchGroup.properties.useOvOnly.type;
	assert.ok(ovSchema.includes('boolean') && ovSchema.includes('string'), 'useOvOnly accepts boolean and string');
	for (const g of groups) if ('useOvOnly' in g) assert.strictEqual(typeof g.useOvOnly, 'boolean', `${g.uri} writes useOvOnly as a boolean`);
	// The guidance must never point at customer-hosted files or name a customer.
	// Only placeholder or Reltio hosts: real dictionary URLs identify customers.
	for (const [url, host] of (skill + reference + examples).matchAll(/https?:\/\/([^\s/)`"]+)[^\s)`"]*/g)) {
		assert.ok(/(^|\.)example\.com$|(^|\.)reltio\.com$/.test(host), `${url}: only example.com placeholders or reltio.com hosts`);
	}

	// The schema slice shipped with the skill is current, and agents are pointed at it, not at a
	// path that only exists in this repository.
	const { render, TARGET } = require('./build-match-group-schema.cjs');
	assert.strictEqual(
		fs.readFileSync(TARGET, 'utf8').replace(/\r\n/g, '\n'),
		render(schema),
		'match-group.schema.json is stale: run node scripts/build-match-group-schema.cjs',
	);
	assert.ok(skill.includes('match-group.schema.json') && reference.includes('match-group.schema.json'));
	assert.ok(!/schemas\/reltio-metadata\.schema\.json/.test(skill + reference + examples), 'no repository-only schema path');
	const standalone = new Ajv({ strict: false }).compile(JSON.parse(fs.readFileSync(TARGET, 'utf8')));
	for (const g of groups) assert.ok(standalone(g), `${g.uri} validates against the bundled schema alone`);

	// Report format: both records with every attribute, no per-attribute scores by default.
	assert.ok(/\| Pair \| Record 1 \| Record 2 \| Expected \| Actual \|/.test(skill), 'report table has both records');
	assert.ok(skill.includes('every attribute') && skill.includes("Don't add per-attribute scores unless the user asks"));

	// examples.md: every block parses; complete groups validate as MatchGroup, fragments as MatchRule.
	const validateRule = ajv.compile({ $ref: 'reltio#/$defs/MatchRule' });
	const blocks = [...examples.matchAll(/```json\r?\n([\s\S]*?)```/g)].map(m => JSON.parse(m[1]));
	const full = blocks.filter(b => typeof b.uri === 'string' && b.uri.includes('/matchGroups/'));
	assert.ok(blocks.length >= 40 && full.length >= 30, `examples.md: ${blocks.length} blocks, ${full.length} complete groups`);
	for (const b of blocks) {
		const isGroup = full.includes(b);
		const v = isGroup ? validate : validateRule;
		assert.ok(v(b), `examples.md ${isGroup ? b.uri : JSON.stringify(b).slice(0, 60)}: ${ajv.errorsText(v.errors)}`);
		if (isGroup && 'useOvOnly' in b) assert.strictEqual(typeof b.useOvOnly, 'boolean', `${b.uri} writes useOvOnly as a boolean`);
	}
	// A group URI is unique within the file, as it must be on an entity type.
	const uris = full.map(b => b.uri);
	assert.strictEqual(new Set(uris).size, uris.length, 'example match group URIs are unique');
	assert.ok(skill.includes('examples.md'), 'SKILL.md points agents at examples.md');

	// The agent knows what to do with every result the bridge can produce.
	for (const value of [...bridge.RESULT_STATUSES, ...bridge.NOT_VERIFIED_REASONS, ...bridge.FAILURE_KINDS, ...bridge.PAIR_OUTCOMES]) {
		assert.ok(skill.includes(`\`${value}\``), `SKILL.md covers \`${value}\``);
	}
	const folder = bridge.MATCH_VERIFICATION_SEGMENTS.join('/');
	assert.ok(skill.includes(`${folder}/${bridge.REQUEST_FILE}`) && skill.includes(`${folder}/${bridge.RESULT_FILE}`));
	assert.ok(skill.includes(`${bridge.MAX_PAIRS} pairs`) && skill.includes(`${bridge.MAX_MATCH_GROUPS} match groups`), 'limits documented');

	// The commands it sends the user to exist under the names it uses.
	const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
	const titles = pkg.contributes.commands.map(c => c.title);
	assert.ok(titles.includes('Apply Configuration to Tenant') && skill.includes('Apply Configuration to Tenant'));
	assert.ok(titles.includes('Reltio: Resync agent assets (skills & Velocity Packs)'));

	// Both settings are declared, default on, under the keys the code reads.
	const props = pkg.contributes.configuration.properties;
	for (const key of [discovery.AGENT_SKILLS_SETTING, bridge.MATCH_VERIFICATION_SETTING]) {
		assert.strictEqual(props[`reltio.${key}`]?.default, true, `reltio.${key} declared, default true`);
	}
}

(async () => {
	await testBridgeGates();
	await testBridgeRejectsMalformedRequests();
	await testBridgeVerifies();
	await testBridgeAuthAndFailures();
	await testVerifyMatchesClient();
	await testAgentSkillSync();
	await testWorkspaceOverrides();
	await testHostLayouts();
	testModeSyncTrigger();
	testSkillContent();
	console.log('test-match-rule-generation-skill: OK');
})().catch(e => {
	console.error(e);
	process.exit(1);
});
