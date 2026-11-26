#!/usr/bin/env node
'use strict';
/**
 * Regression area: Extension Activation
 *
 * Tier A (static, no VS Code host):
 *   ACT-001  command manifest: declared, registered, allowlisted and menu/welcome-referenced ids agree.
 *   ACT-003  declared reltio.* settings equal the settings read; activation events and entry point.
 * Tier B (stub-driven activate(): the shared vscode stub is extended at runtime in this script,
 * and dist/ module exports are wrapped as spies, so the real compiled activate() runs end to end):
 *   ACT-004  one rebuild pipeline (build, then every provider, then diagnostics) and the activation order.
 *   ACT-002  Reltio document matching, rebuild triggers, trusted host suffixes, Classic UX.
 *   ACT-005  every disposable created during activation is disposed; token-file watchers.
 *   ACT-006  activation without a folder, workspace source choice, config-driven sync, document close.
 *   ACT-007  apply-defaults gating, OAuth session restore, background failures.
 *   ACT-008  first-run Setup Guide auto-open once; walkthrough suppression.
 *            #2(b) (OAuth credentials without an environment) is blocked by RP-209773.
 *   ACT-010  #2 (dynamic half): no token string reaches globalState, workspaceState or settings
 *            during session restore. The static half lives in test-harden-reltio-client-base-url.cjs.
 *   ACT-011  timers stop after dispose; Windows path handling.
 *            #1 rebuildUriIndex debounceTimer after dispose is blocked by RP-209776;
 *            #2 backslash L3.json / BusinessConfig.json matching is blocked by RP-209768.
 *   ACT-012  slow work stays off the activation critical path.
 * Tier C (manual): ACT-009 (fresh install in a real host, reload, Restricted Mode).
 *
 * Every assertion message starts with `<row id> #<check>`, matching the numbered checks in the
 * row's `scenario` / `expected` fields.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');
const vscode = require('./lib/vscode-stub.cjs');
const { installMemoryFs } = require('./lib/memory-fs.cjs');
const { loadCanonicalFixture, repoRoot } = require('./lib/load-canonical-fixture.cjs');

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const srcRoot = path.join(repoRoot, 'src');

/** Every non-webview .ts file under src/, as { rel, text }. */
function srcFiles() {
	const out = [];
	(function walk(dir) {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, e.name);
			if (e.isDirectory()) {
				if (dir === srcRoot && e.name === 'webview') continue;
				walk(p);
			} else if (e.name.endsWith('.ts')) {
				out.push({ rel: path.relative(srcRoot, p).replace(/\\/g, '/'), text: fs.readFileSync(p, 'utf8') });
			}
		}
	})(srcRoot);
	return out;
}

// ── ACT-001: command manifest consistency ───────────────────────────────────
/** Registered by a handler but deliberately absent from contributes.commands. */
const INTERNAL_COMMANDS = new Set([
	'reltio.revealInTreeView', // takes a nodeId argument; invoked from code, never from the palette
]);
/** Built-in VS Code commands that menus and welcome links may reference. */
const BUILTIN_COMMANDS = new Set(['workbench.action.files.openFolder']);

function testCommandManifest() {
	const declared = pkg.contributes.commands.map(c => c.command);
	const declaredSet = new Set(declared);
	const registered = new Set();
	for (const { text } of srcFiles()) {
		for (const m of text.matchAll(/registerCommand\(\s*'([^']+)'/g)) registered.add(m[1]);
	}
	assert.ok(declared.length > 0 && registered.size > 0, 'ACT-001 #1: found no declared or registered commands');

	// 1. Every declared command has a handler.
	for (const id of declared) {
		assert.ok(registered.has(id), `ACT-001 #1: ${id} is declared in package.json but never passed to registerCommand`);
	}
	// 2. Every handler is declared, unless deliberately internal.
	for (const id of registered) {
		assert.ok(
			declaredSet.has(id) || INTERNAL_COMMANDS.has(id),
			`ACT-001 #2: ${id} is registered but not declared in contributes.commands (add it, or to INTERNAL_COMMANDS deliberately)`,
		);
	}
	for (const id of INTERNAL_COMMANDS) {
		assert.ok(registered.has(id), `ACT-001 #2: allowlisted internal command ${id} is no longer registered; drop it from the allowlist`);
	}
	// 3. Every menu entry and welcome link points at a declared, registered command.
	const referenced = [];
	for (const [group, entries] of Object.entries(pkg.contributes.menus)) {
		for (const e of entries) if (e.command) referenced.push([e.command, `menus.${group}`]);
	}
	for (const v of pkg.contributes.viewsWelcome) {
		for (const m of v.contents.matchAll(/\(command:([A-Za-z0-9_.-]+)/g)) referenced.push([m[1], `viewsWelcome(${v.view})`]);
	}
	assert.ok(referenced.length > 0, 'ACT-001 #3: no menu or welcome command references found');
	for (const [id, where] of referenced) {
		if (BUILTIN_COMMANDS.has(id)) continue;
		assert.ok(declaredSet.has(id), `ACT-001 #3: ${where} references ${id}, which is not declared`);
		assert.ok(registered.has(id), `ACT-001 #3: ${where} references ${id}, which has no handler`);
	}
}

// ── ACT-003: settings and activation manifest ───────────────────────────────
/** Declared settings that are not read through getConfiguration('reltio').get (none today). */
const SETTINGS_NOT_READ = new Set([]);

function testSettingsAndActivationManifest() {
	const props = pkg.contributes.configuration.properties;
	const declared = new Set(Object.keys(props).filter(k => k.startsWith('reltio.')).map(k => k.slice('reltio.'.length)));
	assert.strictEqual(declared.size, 13, `ACT-003 #1: expected 13 declared reltio.* settings, found ${declared.size}`);

	const files = srcFiles();
	const constants = new Map();
	for (const { text } of files) {
		for (const m of text.matchAll(/export const ([A-Z_]+_SETTING) = '([^']+)'/g)) constants.set(m[1], m[2]);
	}
	const read = new Set();
	for (const { rel, text } of files) {
		// The key in `getConfiguration('reltio').get('<k>')`, directly or through a held handle.
		for (const m of text.matchAll(/getConfiguration\('reltio'\)\s*\.(?:get|inspect)(?:<[^>]*>)?\(\s*(?:'([^']+)'|([A-Z_]+_SETTING))/g)) {
			const key = m[1] ?? constants.get(m[2]);
			assert.ok(key, `ACT-003 #1: ${rel} reads a reltio setting through an unknown constant ${m[2]}`);
			read.add(key);
		}
		if (/(?:const|let) (\w+) = vscode\.workspace\.getConfiguration\('reltio'\)/.test(text)) {
			for (const h of text.matchAll(/(?:const|let) (\w+) = vscode\.workspace\.getConfiguration\('reltio'\)/g)) {
				const re = new RegExp(`\\b${h[1]}\\.(?:get|inspect)(?:<[^>]*>)?\\(\\s*'([^']+)'`, 'g');
				for (const m of text.matchAll(re)) read.add(m[1]);
			}
		}
		for (const m of text.matchAll(/affectsConfiguration\(\s*(?:'reltio\.([^']+)'|`reltio\.\$\{([A-Z_]+_SETTING)\}`)/g)) {
			const key = m[1] ?? constants.get(m[2]);
			assert.ok(key, `ACT-003 #1: ${rel} watches a reltio setting through an unknown constant ${m[2]}`);
			read.add(key);
		}
	}
	for (const k of declared) {
		if (SETTINGS_NOT_READ.has(k)) continue;
		assert.ok(read.has(k), `ACT-003 #1: setting reltio.${k} is declared but never read`);
	}
	for (const k of read) {
		assert.ok(declared.has(k), `ACT-003 #1: code reads reltio.${k}, which package.json does not declare`);
	}

	// 2. Entry point and activation events.
	assert.strictEqual(pkg.main, './dist/extension.js', 'ACT-003 #2: package.json main must be ./dist/extension.js');
	for (const ev of [
		'onStartupFinished',
		'workspaceContains:**/*.reltio.json',
		'workspaceContains:**/BusinessConfig.json',
		'workspaceContains:**/.reltio-environment.json',
		'workspaceContains:**/.reltio-config-source.json',
		'workspaceContains:**/*.reltio.environment',
	]) {
		assert.ok(pkg.activationEvents.includes(ev), `ACT-003 #2: activationEvents must include ${ev}`);
	}
	assert.ok(pkg.activationEvents.includes('onLanguage:json'), 'ACT-003 #2: activationEvents must include onLanguage:json');
	assert.strictEqual(pkg.activationEvents.length, 7, `ACT-003 #2: expected 7 activation events, found ${pkg.activationEvents.length}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// Stub-driven activate() harness (scripts/lib/activation-harness.cjs)
// ═════════════════════════════════════════════════════════════════════════════

const {
	rec,
	tracked,
	fire,
	configChange,
	emitWatcher,
	clock,
	flush,
	unhandled,
	migrationFailureMessage,
	UriIndex,
	TokenStore,
	memento,
	fakeSecrets,
	makeContext,
	doc,
	enc,
	addEnvironment,
	addGitSourceMarker,
	activateWith,
	sourceContexts,
} = require('./lib/activation-harness.cjs');

// ── ACT-002 ─────────────────────────────────────────────────────────────────
async function testDocumentMatchingAndTriggers() {
	// 1. Which documents count as Reltio documents (active-editor change → immediate rebuild).
	await activateWith({ folder: false });
	const cases = [
		['/ws/x.reltio.json', 1],
		['/ws/env/t/L3.json', 1],
		['/ws/env/t/l3.json', 1],
		['/ws/env/t/BusinessConfig.json', 1],
		['/ws/env/t/businessconfig.json', 1],
		['/ws/package.json', 0],
		['/ws/Workflows/bpmn/proc1.bpmn20.xml', 0],
	];
	for (const [file, expected] of cases) {
		const before = rec.builds;
		await fire('activeEditor', { document: doc(file) });
		assert.strictEqual(rec.builds - before, expected, `ACT-002 #1: ${file} must trigger ${expected} rebuild(s) on active-editor change`);
	}
	// BPMN files take the BPMN diagnostics branch of the change listener, not the Reltio one.
	{
		const bpmn = doc('/ws/Workflows/bpmn/proc1.bpmn20.xml', '<definitions/>');
		const before = { builds: rec.builds, l3: rec.l3Changed.length, bpmn: rec.bpmnUpdate.length };
		await fire('changeDoc', { document: bpmn });
		clock.tick(1000);
		assert.strictEqual(rec.bpmnUpdate.length - before.bpmn, 1, 'ACT-002 #1: a BPMN edit must reach the BPMN diagnostics manager');
		assert.strictEqual(rec.l3Changed.length - before.l3, 0, 'ACT-002 #1: a BPMN edit must not reach onL3DocumentChanged');
		assert.strictEqual(rec.builds - before.builds, 0, 'ACT-002 #1: a BPMN edit must not rebuild the UriIndex');
	}

	// 2. Rebuild triggers: debounced edits, immediate editor switch, one startup rebuild.
	{
		const d = doc('/ws/x.reltio.json');
		const before = { builds: rec.builds, l3: rec.l3Changed.length };
		await fire('changeDoc', { document: d });
		await fire('changeDoc', { document: d });
		assert.strictEqual(rec.builds - before.builds, 0, 'ACT-002 #2: edits must not rebuild before DEBOUNCE_MS');
		clock.tick(299);
		assert.strictEqual(rec.builds - before.builds, 0, 'ACT-002 #2: no rebuild before 300 ms');
		clock.tick(1);
		assert.strictEqual(rec.builds - before.builds, 1, 'ACT-002 #2: two quick edits must produce exactly one rebuild after DEBOUNCE_MS');
		assert.strictEqual(rec.l3Changed.length - before.l3, 2, 'ACT-002 #2: onL3DocumentChanged must be called once per edit event');
		const b2 = rec.builds;
		await fire('changeDoc', { document: doc('/ws/package.json') });
		clock.tick(1000);
		assert.strictEqual(rec.builds - b2, 0, 'ACT-002 #2: a non-Reltio edit must not rebuild');
		assert.strictEqual(rec.l3Changed.length - before.l3, 2, 'ACT-002 #2: a non-Reltio edit must not reach onL3DocumentChanged');
	}
	await activateWith({ folder: false, activeEditor: { document: doc('/ws/x.reltio.json') } });
	assert.strictEqual(rec.builds, 1, 'ACT-002 #2: activation with an active Reltio editor must rebuild exactly once');
	await activateWith({ folder: false, activeEditor: { document: doc('/ws/package.json') } });
	assert.strictEqual(rec.builds, 0, 'ACT-002 #2: activation with a non-Reltio active editor must not rebuild');

	// 3. Trusted host suffixes: set synchronously first, default, tracked on change.
	{
		const { syncTrusted } = await activateWith({ config: { 'reltio.trustedHostSuffixes': ['example.test'] } });
		assert.deepStrictEqual(syncTrusted, [['example.test']], 'ACT-002 #3: setTrustedHostSuffixes must receive the setting synchronously at activation start');
		assert.strictEqual(rec.log[0], 'setTrustedHostSuffixes', `ACT-002 #3: the allowlist must be applied before any other setup (first was ${rec.log[0]})`);
		rec.config.set('reltio.trustedHostSuffixes', ['other.test']);
		await fire('config', configChange('reltio.uxMode'));
		assert.strictEqual(rec.trusted.length, 1, 'ACT-002 #3: an unrelated setting change must not re-apply the allowlist');
		await fire('config', configChange('reltio.trustedHostSuffixes'));
		assert.deepStrictEqual(rec.trusted.slice(1), [['other.test']], 'ACT-002 #3: a trustedHostSuffixes change must re-apply the new list');
		const { syncTrusted: def } = await activateWith({});
		assert.deepStrictEqual(def, [['reltio.com']], 'ACT-002 #3: the default allowlist must be [reltio.com]');
	}

	// 4. Classic UX: no status bar and no guide; default: status bar and guide once.
	await activateWith({ config: { 'reltio.uxMode': 'classic' } });
	assert.strictEqual(rec.statusItems.length, 0, 'ACT-002 #4: classic mode must not create a status bar item');
	assert.strictEqual(rec.guideOpened, 0, 'ACT-002 #4: classic mode must not open the Setup Guide');
	await activateWith({ config: { 'reltio.uxMode': 'default' } });
	assert.strictEqual(rec.statusItems.length, 1, 'ACT-002 #4: default mode must create the status bar item');
	assert.strictEqual(rec.guideOpened, 1, 'ACT-002 #4: default mode must open the Setup Guide once in a workspace with no environments');
}

// ── ACT-004 ─────────────────────────────────────────────────────────────────
/** Index of the first log entry equal to `kind`, failing the test if it is absent. */
function logAt(kind, log) {
	const at = log.indexOf(kind);
	assert.ok(at >= 0, `ACT-004 #2: "${kind}" never happened during activation (log: ${log.join(', ')})`);
	return at;
}

async function testRebuildPipelineAndActivationOrder() {
	// 1. Every refresh (editor switch and debounced edit) is one build, then every provider, then the diagnostics.
	const pipeline = ['build', 'setIndex:link', 'setIndex:definition', 'setIndex:reference', 'setIndex:completion', 'diagnostics'];
	await activateWith({ folder: false });
	{
		const from = rec.log.length;
		await fire('activeEditor', { document: doc('/ws/x.reltio.json') });
		assert.deepStrictEqual(rec.log.slice(from), pipeline, 'ACT-004 #1: an editor switch must refresh as build, providers, diagnostics');
	}
	{
		const from = rec.log.length;
		await fire('changeDoc', { document: doc('/ws/x.reltio.json') });
		clock.tick(300);
		assert.deepStrictEqual(rec.log.slice(from), pipeline, 'ACT-004 #1: a debounced edit must refresh as build, providers, diagnostics');
	}
	await activateWith({ folder: false, activeEditor: { document: doc('/ws/x.reltio.json') } });
	assert.deepStrictEqual(rec.log.filter(k => pipeline.includes(k)), pipeline, 'ACT-004 #1: the startup refresh must run the same pipeline once');

	// 2. Activation order: allowlist first; tree view and providers exist before the first refresh; apply-defaults runs last.
	await activateWith({
		config: { 'reltio.applyDefaultsOnActivate': true },
		activeEditor: { document: doc('/ws/x.reltio.json') },
	});
	const log = rec.log;
	assert.strictEqual(rec.applyDefaults.length, 1, 'ACT-004 #2: setup must trigger apply-defaults once');
	assert.strictEqual(log[0], 'setTrustedHostSuffixes', 'ACT-004 #2: the host allowlist must be applied before any other setup');
	const at = k => logAt(k, log);
	const firstRefresh = at('build');
	for (const k of ['treeView', 'provider:link', 'provider:definition', 'provider:reference', 'provider:completion', 'command:reltio.resyncAgentAssets']) {
		assert.ok(at(k) < firstRefresh, `ACT-004 #2: ${k} must exist before the first refresh`);
	}
	assert.ok(firstRefresh < at('applyDefaults'), 'ACT-004 #2: apply-defaults must run after the first refresh');
}

// ── ACT-005 ─────────────────────────────────────────────────────────────────
const TOKEN_FILE_CONFIG = { 'reltio.defaultEnvironments': [{ host: 'dev.reltio.com', tenantId: 't1', tokenFile: 'secrets/token.json' }] };
const tokenWatchers = () => rec.watchers.filter(w => w.pattern instanceof vscode.RelativePattern && w.pattern.pattern === 'token.json');

async function testDisposablesAndTokenWatchers() {
	// 1. Every disposable created during activation is disposed with context.subscriptions.
	{
		const { context } = await activateWith({ config: TOKEN_FILE_CONFIG, setup: mem => addEnvironment(mem, 'dev', 'dev.reltio.com') });
		assert.ok(rec.disposables.length > 0, 'ACT-005 #1: nothing was recorded');
		for (const kind of ['treeView', 'watcher', 'outputChannel', 'statusBarItem', 'provider:link', 'listener:config']) {
			assert.ok(rec.disposables.some(d => d.kind === kind), `ACT-005 #1: expected activation to create a ${kind}`);
		}
		for (const s of context.subscriptions) s.dispose();
		const leaked = rec.disposables.filter(d => !d.disposed).map(d => d.kind);
		assert.deepStrictEqual(leaked, [], `ACT-005 #1: undisposed after context.subscriptions were disposed: ${leaked.join(', ')}`);
	}

	// 2a. An untrusted workspace creates no token-file watcher and reads nothing.
	await activateWith({ trusted: false, config: TOKEN_FILE_CONFIG });
	assert.strictEqual(tokenWatchers().length, 0, 'ACT-005 #2: an untrusted workspace must create no token-file watcher');
	assert.strictEqual(rec.tokenReloads.length, 0, 'ACT-005 #2: an untrusted workspace must not read the token file');

	// 2b. Trusted: one watcher, one startup read.
	await activateWith({ config: TOKEN_FILE_CONFIG });
	assert.strictEqual(tokenWatchers().length, 1, 'ACT-005 #2: a trusted workspace must create one token-file watcher');
	assert.strictEqual(rec.tokenReloads.length, 1, 'ACT-005 #2: a trusted workspace must read the token file once at startup');

	// 2c. Re-setup disposes the old watcher and its pending reload timer first.
	{
		const first = tokenWatchers()[0];
		emitWatcher(first, 'change', vscode.Uri.file('/ws/secrets/token.json')); // schedules a 300 ms reload
		await fire('config', configChange('reltio.defaultEnvironments'));
		assert.strictEqual(first.disposed, true, 'ACT-005 #2: a defaultEnvironments change must dispose the previous watcher');
		const live = tokenWatchers().filter(w => !w.disposed);
		assert.strictEqual(live.length, 1, `ACT-005 #2: exactly one live token-file watcher after re-setup (found ${live.length})`);
		assert.strictEqual(rec.tokenReloads.length, 2, 'ACT-005 #2: re-setup must read the token file once');
		clock.tick(1000);
		await flush();
		assert.strictEqual(rec.tokenReloads.length, 2, 'ACT-005 #2: the reload scheduled before re-setup must not fire');
		const reads = rec.tokenReloads.length;
		await fire('config', configChange('reltio.uxMode'));
		assert.strictEqual(rec.tokenReloads.length, reads, 'ACT-005 #2: an unrelated setting must not re-create watchers');
	}
}

// ── ACT-006 ─────────────────────────────────────────────────────────────────
async function testNoFolderSourceChoiceSyncAndClose() {
	// 1. No folder: resolves, all commands registered, tree view created, nothing workspace-bound runs.
	{
		const { promise } = await activateWith({
			folder: false,
			config: { ...TOKEN_FILE_CONFIG, 'reltio.applyDefaultsOnActivate': true },
		});
		await assert.doesNotReject(promise, 'ACT-006 #1: activate() must resolve without a folder');
		for (const c of pkg.contributes.commands) {
			assert.ok(rec.commands.has(c.command), `ACT-006 #1: ${c.command} must be registered without a folder`);
		}
		assert.strictEqual(rec.treeViews.length, 1, 'ACT-006 #1: the tree view must be created without a folder');
		assert.strictEqual(rec.scans, 0, 'ACT-006 #1: no environment scan without a folder');
		assert.strictEqual(rec.migrate.length, 0, 'ACT-006 #1: no layout migration without a folder');
		assert.strictEqual(rec.sync.length, 0, 'ACT-006 #1: no agent asset sync without a folder');
		assert.strictEqual(rec.guideOpened, 0, 'ACT-006 #1: no Setup Guide auto-open without a folder');
		assert.strictEqual(tokenWatchers().length + rec.tokenReloads.length, 0, 'ACT-006 #1: no token-file watcher without a folder');
		assert.strictEqual(rec.applyDefaults.length, 0, 'ACT-006 #1: no apply-defaults without a folder');
	}

	// 2. Workspace source choice.
	await activateWith({ setup: mem => addEnvironment(mem, 'dev', 'dev.reltio.com') });
	assert.strictEqual(sourceContexts()[0], 'tenant', 'ACT-006 #2: a tenant folder must select the tenant source');
	assert.strictEqual(rec.migrate.length, 1, 'ACT-006 #2: tenant mode must start the layout migration');
	await activateWith({
		setup: async mem => {
			rec.isGitRepo = true;
			await addGitSourceMarker(mem);
		},
	});
	assert.strictEqual(sourceContexts()[0], 'git', 'ACT-006 #2: a restorable .reltio-config-source.json must select the git source');
	assert.strictEqual(rec.migrate.length, 0, 'ACT-006 #2: git mode must not migrate tenant folders');
	await activateWith({});
	assert.strictEqual(sourceContexts()[0], null, 'ACT-006 #2: an empty folder must publish no workspace source');
	await activateWith({
		setup: async mem => {
			rec.isGitRepo = true;
			await addGitSourceMarker(mem);
			await addEnvironment(mem, 'dev', 'dev.reltio.com');
		},
	});
	assert.strictEqual(sourceContexts()[0], 'tenant', 'ACT-006 #2: tenant must take priority over a git restore');

	// 3. installAgentSkills changes sync only once a source is chosen.
	await activateWith({});
	await fire('config', configChange(`reltio.installAgentSkills`));
	assert.strictEqual(rec.sync.length, 0, 'ACT-006 #3: no sync before a workspace source is chosen');
	await activateWith({ setup: mem => addEnvironment(mem, 'dev', 'dev.reltio.com') });
	const atStart = rec.sync.length;
	await fire('config', configChange('reltio.uxMode'));
	assert.strictEqual(rec.sync.length, atStart, 'ACT-006 #3: an unrelated key must not trigger a sync');
	await fire('config', configChange('reltio.installAgentSkills'));
	assert.strictEqual(rec.sync.length - atStart, 1, 'ACT-006 #3: an installAgentSkills change must sync once in tenant mode');
	assert.deepStrictEqual(rec.sync[rec.sync.length - 1], { force: false }, 'ACT-006 #3: the sync must not force');

	// 4. Closing documents.
	{
		const bpmn = doc('/ws/Workflows/bpmn/proc1.bpmn20.xml', '<definitions/>');
		await fire('changeDoc', { document: bpmn });
		const updatesBefore = rec.bpmnUpdate.length;
		await fire('closeDoc', bpmn);
		clock.tick(1000);
		assert.strictEqual(rec.bpmnUpdate.length, updatesBefore, 'ACT-006 #4: closing a BPMN must cancel its pending diagnostics update');
		assert.deepStrictEqual(rec.bpmnClear, [bpmn.uri.toString()], 'ACT-006 #4: closing a BPMN must clear its diagnostics');
		const reltio = doc('/ws/x.reltio.json');
		await fire('closeDoc', reltio);
		assert.deepStrictEqual(rec.diagClear, [reltio.uri.toString()], 'ACT-006 #4: closing a Reltio document must clear its diagnostics');
		assert.strictEqual(rec.bpmnClear.length, 1, 'ACT-006 #4: closing a Reltio document must not touch BPMN diagnostics');
	}
}

// ── ACT-007 + ACT-010 #2 ────────────────────────────────────────────────────
async function testActivationWorkflows() {
	// 1. Apply-defaults gating matrix.
	for (const apply of [false, true]) {
		for (const trusted of [false, true]) {
			for (const folder of [false, true]) {
				await activateWith({ folder, trusted, config: { 'reltio.applyDefaultsOnActivate': apply } });
				const expected = apply && trusted && folder ? 1 : 0;
				assert.strictEqual(
					rec.applyDefaults.length,
					expected,
					`ACT-007 #1: applyDefaultsOnActivate=${apply}, trusted=${trusted}, folder=${folder} must apply ${expected} time(s)`,
				);
			}
		}
	}
	await activateWith({});
	assert.strictEqual(rec.applyDefaults.length, 0, 'ACT-007 #1: applyDefaultsOnActivate must default to false');
	{
		const logged = [];
		const realError = console.error;
		console.error = (...a) => logged.push(a);
		try {
			const { promise } = await activateWith({
				config: { 'reltio.applyDefaultsOnActivate': true },
				setup: () => {
					rec.applyDefaultsImpl = async () => {
						throw new Error('apply boom');
					};
				},
			});
			await assert.doesNotReject(promise, 'ACT-007 #1: activate() must resolve when apply-defaults throws');
		} finally {
			console.error = realError;
		}
		assert.ok(
			logged.some(a => String(a[0]).includes('applyDefaultEnvironments on activate failed') && a.some(x => x instanceof Error && x.message === 'apply boom')),
			'ACT-007 #1/#3: an apply-defaults failure must be logged with console.error',
		);
	}

	// 2. OAuth session restore.
	{
		const secrets = fakeSecrets({
			'reltio.refreshToken.a.reltio.com': 'rtA',
			'reltio.refreshToken.b.reltio.com': 'rtB',
			'reltio.refreshToken.c.reltio.com': 'rtC',
			'reltio.oauth.a.reltio.com.clientId': 'idA',
			'reltio.oauth.a.reltio.com.clientSecret': 'secA',
			'reltio.oauth.c.reltio.com.clientId': 'idC',
			'reltio.oauth.c.reltio.com.clientSecret': 'secC',
		});
		const ctx = makeContext({ secrets });
		let releaseA;
		const gateA = new Promise(r => (releaseA = r));
		const { promise } = await activateWith({
			ctx,
			awaitActivate: false,
			setup: async mem => {
				await addEnvironment(mem, 'a', 'a.reltio.com');
				await addEnvironment(mem, 'b', 'b.reltio.com');
				await addEnvironment(mem, 'c', 'c.reltio.com');
				rec.refreshImpl = async rt => {
					if (rt === 'rtA') {
						await gateA;
						return { accessToken: 'atA2-secret', refreshToken: 'rtA2-secret', expiresAt: Date.now() + 3600000 };
					}
					throw new Error('refresh rejected');
				};
			},
		});
		let resolved = false;
		void promise.then(() => (resolved = true));
		await flush();
		assert.strictEqual(resolved, true, 'ACT-007 #2: activate() must not wait for the session restore');
		assert.strictEqual(rec.setSession.length, 0, 'ACT-007 #2: A has not refreshed yet');
		releaseA();
		await flush();
		assert.deepStrictEqual(rec.setSession, ['a.reltio.com'], 'ACT-007 #2: A must get a session in the TokenStore');
		assert.strictEqual(secrets.map.get('reltio.refreshToken.a.reltio.com'), 'rtA2-secret', 'ACT-007 #2: A must save the rotated refresh token');
		assert.strictEqual(secrets.map.has('reltio.refreshToken.b.reltio.com'), false, 'ACT-007 #2: B (no client credentials) must have its refresh token deleted');
		assert.strictEqual(secrets.map.has('reltio.refreshToken.c.reltio.com'), false, 'ACT-007 #2: C (refresh failed) must have its refresh token deleted');
		assert.deepStrictEqual(rec.refresh.map(r => r[0]).sort(), ['rtA', 'rtC'], 'ACT-007 #2: B must never reach the refresh endpoint');
		const lastSession = rec.log.lastIndexOf('setSession:a.reltio.com');
		assert.ok(rec.log.indexOf('treeRefresh', lastSession) > lastSession, 'ACT-007 #2: the tree must refresh after the restore');

		// ACT-010 #2: no token string leaves SecretStorage.
		const tokens = ['rtA', 'rtB', 'rtC', 'atA2-secret', 'rtA2-secret'];
		const stores = {
			globalState: JSON.stringify([...ctx.globalState.map]),
			workspaceState: JSON.stringify([...ctx.workspaceState.map]),
			settings: JSON.stringify(rec.configWrites),
		};
		for (const [where, dump] of Object.entries(stores)) {
			for (const t of tokens) {
				assert.ok(!dump.includes(`"${t}"`), `ACT-010 #2: token ${t} must not be written to ${where}`);
			}
		}
	}

	// 3. Background failures.
	{
		const { promise } = await activateWith({
			setup: async mem => {
				await addEnvironment(mem, 'dev', 'dev.reltio.com');
				rec.migrateImpl = async () => {
					throw new Error('dirty worktree');
				};
			},
		});
		await assert.doesNotReject(promise, 'ACT-007 #3: activate() must resolve when the migration fails');
		assert.ok(
			rec.warnings.some(w => w.message === migrationFailureMessage(new Error('dirty worktree'))),
			'ACT-007 #3: a migration failure must show migrationFailureMessage as a warning',
		);
	}
	{
		const { promise } = await activateWith({
			setup: async mem => {
				await addEnvironment(mem, 'dev', 'dev.reltio.com');
				rec.syncImpl = async () => {
					throw new Error('disk full');
				};
			},
		});
		await assert.doesNotReject(promise, 'ACT-007 #3: activate() must resolve when the agent sync fails');
		const w = rec.warnings.find(x => x.message.includes('Reltio agent skills could not be installed: disk full'));
		assert.ok(w, 'ACT-007 #3: an agent sync failure must be shown as a warning');
		assert.deepStrictEqual(w.items, ['Resync Agent Assets'], "ACT-007 #3: the warning must offer 'Resync Agent Assets'");
	}
	{
		const before = unhandled.length;
		const { promise } = await activateWith({
			ctx: makeContext({ globalState: memento({ 'reltio.walkthroughSeen': true }), workspaceState: memento({ 'reltio.setupGuideAutoOpened': true }) }),
			setup: async mem => {
				await addEnvironment(mem, 'dev', 'dev.reltio.com');
				// Call 1 is the inline source selection; call 2 is the background session restore.
				rec.scanFailOnCall = 2;
			},
		});
		await assert.doesNotReject(promise, 'ACT-007 #3: activate() must resolve when the session-restore scan fails');
		await flush();
		assert.ok(rec.scans >= 2, 'ACT-007 #3: the session restore must have scanned');
		assert.strictEqual(unhandled.length, before, 'ACT-007 #3: a session-restore scan failure must be swallowed');
		assert.strictEqual(rec.warnings.length + rec.errors.length, 0, 'ACT-007 #3: a session-restore scan failure must not be shown');
	}
}

// ── ACT-008 ─────────────────────────────────────────────────────────────────
async function testFirstRunGuideAndWalkthrough() {
	// 1. Guide auto-opens once per workspace with no environments.
	{
		const workspaceState = memento();
		await activateWith({ ctx: makeContext({ workspaceState }) });
		assert.strictEqual(rec.guideOpened, 1, 'ACT-008 #1: the first activation in an empty folder must open the Setup Guide');
		assert.strictEqual(workspaceState.map.get('reltio.setupGuideAutoOpened'), true, 'ACT-008 #1: the auto-open must be recorded');
		await activateWith({ ctx: makeContext({ workspaceState }) });
		assert.strictEqual(rec.guideOpened, 0, 'ACT-008 #1: the second activation must not open the Setup Guide again');
		const ws2 = memento();
		await activateWith({ ctx: makeContext({ workspaceState: ws2 }), setup: mem => addEnvironment(mem, 'dev', 'dev.reltio.com') });
		assert.strictEqual(rec.guideOpened, 0, 'ACT-008 #1: a workspace with an environment must never open the Setup Guide');
		assert.strictEqual(ws2.map.has('reltio.setupGuideAutoOpened'), false, 'ACT-008 #1: and must not record an auto-open');
	}

	// 2. Walkthrough suppression for upgrade users.
	{
		const gs = memento();
		await activateWith({ ctx: makeContext({ globalState: gs }), setup: mem => addEnvironment(mem, 'dev', 'dev.reltio.com') });
		assert.strictEqual(gs.map.get('reltio.walkthroughSeen'), true, 'ACT-008 #2: (a) a workspace with an environment must mark the walkthrough seen');
	}
	// (b) no environment but stored OAuth client credentials: blocked by RP-209773 (the credential check only
	// iterates scanned environments, so it can never be true when there are none).
	{
		const gs = memento();
		await activateWith({ ctx: makeContext({ globalState: gs }) });
		assert.notStrictEqual(gs.map.get('reltio.walkthroughSeen'), true, 'ACT-008 #2: (c) a fresh workspace must leave the walkthrough flag unset');
	}
	{
		const gs = memento({ 'reltio.walkthroughSeen': true });
		await activateWith({ ctx: makeContext({ globalState: gs }) });
		assert.strictEqual(gs.map.get('reltio.walkthroughSeen'), true, 'ACT-008 #2: an already-true flag must never be reset');
	}
}

// ── ACT-011 ─────────────────────────────────────────────────────────────────
async function testTimersAfterDisposeAndWindowsPaths() {
	// 1. Pending timers do not fire after dispose.
	{
		const { context } = await activateWith({
			config: TOKEN_FILE_CONFIG,
			setup: mem => addEnvironment(mem, 'dev', 'dev.reltio.com'),
		});
		await flush();
		rec.locFromPath = p => (String(p).includes('/Workflows/') ? { environmentName: 'dev.reltio.com', tenantId: 't1' } : undefined);
		const bpmn = doc('/ws/Workflows/bpmn/proc1.bpmn20.xml', '<definitions/>');
		await fire('changeDoc', { document: bpmn }); // KeyedDebouncer (BPMN diagnostics)
		const repoWatcher = rec.watchers.find(w => w.pattern === '**/Workflows/**/*.xml');
		assert.ok(repoWatcher, 'ACT-011 #1: the workflow repo watcher must exist');
		emitWatcher(repoWatcher, 'create', vscode.Uri.file('/ws/dev/t1/Workflows/repo/a.xml')); // repo rediscovery
		const tokenWatcher = tokenWatchers()[0];
		emitWatcher(tokenWatcher, 'change', vscode.Uri.file('/ws/secrets/token.json')); // token-file reload
		const overrides = rec.watchers.find(w => w.pattern instanceof vscode.RelativePattern && w.pattern.pattern.endsWith('/**'));
		assert.ok(overrides, 'ACT-011 #1: the overrides watcher must exist');
		emitWatcher(overrides, 'change', vscode.Uri.file('/ws/skills/workspace/x.md')); // overrides resync
		const before = { bpmn: rec.bpmnUpdate.length, repo: rec.repoConfigLookups.length, reload: rec.tokenReloads.length, sync: rec.sync.length };
		for (const s of context.subscriptions) s.dispose();
		clock.tick(5000);
		await flush();
		assert.strictEqual(rec.bpmnUpdate.length, before.bpmn, 'ACT-011 #1: the BPMN diagnostics debounce must not fire after dispose');
		assert.strictEqual(rec.repoConfigLookups.length, before.repo, 'ACT-011 #1: the repo rediscovery debounce must not fire after dispose');
		assert.strictEqual(rec.tokenReloads.length, before.reload, 'ACT-011 #1: the token-file reload must not fire after dispose');
		assert.strictEqual(rec.sync.length, before.sync, 'ACT-011 #1: the overrides resync must not fire after dispose');
		// The plain rebuildUriIndex debounceTimer is not disposed: blocked by RP-209776.
	}
	// Control: the same timers do fire when nothing is disposed (so the checks above are meaningful).
	{
		await activateWith({ config: TOKEN_FILE_CONFIG, setup: mem => addEnvironment(mem, 'dev', 'dev.reltio.com') });
		await flush();
		rec.locFromPath = p => (String(p).includes('/Workflows/') ? { environmentName: 'dev.reltio.com', tenantId: 't1' } : undefined);
		const before = { bpmn: rec.bpmnUpdate.length, repo: rec.repoConfigLookups.length, reload: rec.tokenReloads.length, sync: rec.sync.length };
		await fire('changeDoc', { document: doc('/ws/Workflows/bpmn/proc1.bpmn20.xml', '<definitions/>') });
		emitWatcher(rec.watchers.find(w => w.pattern === '**/Workflows/**/*.xml'), 'create', vscode.Uri.file('/ws/dev/t1/Workflows/repo/a.xml'));
		emitWatcher(tokenWatchers()[0], 'change', vscode.Uri.file('/ws/secrets/token.json'));
		emitWatcher(rec.watchers.find(w => w.pattern instanceof vscode.RelativePattern && w.pattern.pattern.endsWith('/**')), 'change', vscode.Uri.file('/ws/skills/workspace/x.md'));
		clock.tick(5000);
		await flush();
		assert.strictEqual(rec.bpmnUpdate.length - before.bpmn, 1, 'ACT-011 #1: control: the BPMN debounce fires without dispose');
		assert.strictEqual(rec.repoConfigLookups.length - before.repo, 1, 'ACT-011 #1: control: the repo rediscovery fires without dispose');
		assert.strictEqual(rec.tokenReloads.length - before.reload, 1, 'ACT-011 #1: control: the token-file reload fires without dispose');
		assert.strictEqual(rec.sync.length - before.sync, 1, 'ACT-011 #1: control: the overrides resync fires without dispose');
	}

	// 2. Windows paths.
	await activateWith({ folder: false });
	{
		const before = rec.builds;
		await fire('activeEditor', { document: doc('C:\\ws\\x.reltio.json') });
		assert.strictEqual(rec.builds - before, 1, 'ACT-011 #2: a backslash *.reltio.json path must match');
		// 'C:\\ws\\env\\tenant\\L3.json' (basename match on backslash paths): blocked by RP-209768.
	}
	{
		await activateWith({ setup: mem => addEnvironment(mem, 'dev', 'dev.reltio.com') });
		rec.locFromPath = () => ({ environmentName: 'dev.reltio.com', tenantId: 't1' });
		rec.cachedRepoFiles = [{ fileUri: vscode.Uri.file('C:/WS/Workflows/Repo/A.bpmn20.xml') }];
		const watcher = rec.watchers.find(w => w.pattern === '**/Workflows/**/*.xml');
		const platform = Object.getOwnPropertyDescriptor(process, 'platform');
		try {
			Object.defineProperty(process, 'platform', { value: 'win32' });
			emitWatcher(watcher, 'change', vscode.Uri.file('c:/ws/workflows/repo/a.bpmn20.xml'));
			assert.deepStrictEqual(rec.invalidated, ['dev.reltio.com/t1'], 'ACT-011 #2: on win32 the repo watcher must compare paths case-insensitively');
			Object.defineProperty(process, 'platform', { value: 'linux' });
			emitWatcher(watcher, 'change', vscode.Uri.file('c:/ws/workflows/repo/a.bpmn20.xml'));
			assert.strictEqual(rec.invalidated.length, 1, 'ACT-011 #2: off win32 the comparison must stay case-sensitive');
		} finally {
			Object.defineProperty(process, 'platform', platform);
		}
	}
}

// ── ACT-012 ─────────────────────────────────────────────────────────────────
async function testOffCriticalPath() {
	const never = () => new Promise(() => {});
	const { promise } = await activateWith({
		awaitActivate: false,
		config: { 'reltio.applyDefaultsOnActivate': true },
		ctx: makeContext({
			secrets: fakeSecrets({
				'reltio.refreshToken.dev.reltio.com': 'rt',
				'reltio.oauth.dev.reltio.com.clientId': 'id',
				'reltio.oauth.dev.reltio.com.clientSecret': 'sec',
			}),
		}),
		setup: async mem => {
			await addEnvironment(mem, 'dev', 'dev.reltio.com');
			rec.migrateImpl = never;
			rec.refreshImpl = never;
			rec.applyDefaultsImpl = never;
			rec.deriveUxStateImpl = never;
		},
	});
	const outcome = await Promise.race([promise.then(() => 'resolved'), flush(200).then(() => 'pending')]);
	assert.strictEqual(outcome, 'resolved', 'ACT-012 #1: activate() must resolve while migration, session restore, UX refresh and apply-defaults are pending');
	assert.strictEqual(rec.migrate.length, 1, 'ACT-012 #1: the migration must have started');
	assert.strictEqual(rec.refresh.length, 1, 'ACT-012 #1: the session restore must have started');
	assert.strictEqual(rec.applyDefaults.length, 1, 'ACT-012 #1: apply-defaults must have started');
}

async function main() {
	testCommandManifest();
	testSettingsAndActivationManifest();
	await testDocumentMatchingAndTriggers();
	await testRebuildPipelineAndActivationOrder();
	await testDisposablesAndTokenWatchers();
	await testNoFolderSourceChoiceSyncAndClose();
	await testActivationWorkflows();
	await testFirstRunGuideAndWalkthrough();
	await testTimersAfterDisposeAndWindowsPaths();
	await testOffCriticalPath();
	await flush();
	assert.deepStrictEqual(unhandled.map(e => String(e && e.stack)), [], 'ACT-007 #3: no unhandled rejection may escape activation');
	console.log('test-extension-activation: OK');
	process.exit(0);
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
