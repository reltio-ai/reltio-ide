'use strict';
/**
 * Stub-driven activate() harness, shared by tests that run the real compiled extension.
 *
 * Moved unchanged from test-extension-activation.cjs (RP-208563) so other areas can drive the
 * commands activate() registers. Requiring this module extends the shared vscode stub, installs
 * the fake clock and wraps dist/ exports as spies, exactly as that script did inline; require it
 * before any other dist/ import. `rec` is one object reset in place by activateWith(), so a
 * destructured reference stays live. Each test script runs in its own process, so these
 * process-wide changes never reach another script.
 */
const fs = require('fs');
const path = require('path');
const { importDist } = require('./import-dist.cjs');
const vscode = require('./vscode-stub.cjs');
const { installMemoryFs } = require('./memory-fs.cjs');
const { loadCanonicalFixture, repoRoot } = require('./load-canonical-fixture.cjs');

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

// ═════════════════════════════════════════════════════════════════════════════
// Stub-driven activate() harness
// ═════════════════════════════════════════════════════════════════════════════

// Top-level stub members must exist before any dist/ import: compiled modules copy them on load.
vscode.RelativePattern = class RelativePattern {
	constructor(base, pattern) {
		this.base = base;
		this.pattern = pattern;
	}
};
vscode.QuickPickItemKind = vscode.QuickPickItemKind ?? { Separator: -1, Default: 0 };
vscode.ProgressLocation.Window = vscode.ProgressLocation.Window ?? 10;
vscode.window.createTextEditorDecorationType = () => ({ dispose() {} });

/** Minimal fake clock: dist/ code calls the global setTimeout, so swapping it controls every debounce. */
const clock = (() => {
	let now = 0;
	let seq = 0;
	const timers = new Map();
	return {
		install() {
			global.setTimeout = (fn, ms = 0, ...args) => {
				const h = { id: ++seq, at: now + ms, fn, args, unref() { return h; }, ref() { return h; }, hasRef() { return true; } };
				timers.set(h.id, h);
				return h;
			};
			global.clearTimeout = h => {
				if (h && typeof h === 'object') timers.delete(h.id);
			};
		},
		tick(ms) {
			const target = now + ms;
			for (;;) {
				const due = [...timers.values()].filter(t => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
				if (!due) break;
				timers.delete(due.id);
				now = due.at;
				due.fn(...due.args);
			}
			now = target;
		},
		reset() {
			timers.clear();
		},
	};
})();
const realSetImmediate = setImmediate;
// activate()'s token-file reload logs every read; keep the run output readable.
const realLog = console.log;
console.log = (...a) => {
	if (typeof a[0] === 'string' && a[0].startsWith('[reltio] tokenFile')) return;
	realLog(...a);
};
/** Lets pending promise chains (memory fs, spies) settle without using timers. */
async function flush(rounds = 30) {
	for (let i = 0; i < rounds; i++) await new Promise(r => realSetImmediate(r));
}

/** The current recording. One object, reset in place, so every importer sees the live one. */
const rec = {};
const unhandled = [];
process.on('unhandledRejection', e => unhandled.push(e));

function newRecording() {
	for (const k of Object.keys(rec)) delete rec[k];
	Object.assign(rec, {
		log: [],
		disposables: [],
		listeners: {},
		watchers: [],
		statusItems: [],
		treeViews: [],
		commands: new Map(),
		executed: [],
		warnings: [],
		infos: [],
		errors: [],
		config: new Map(),
		configWrites: [],
		trusted: [],
		guideOpened: 0,
		migrate: [],
		migrateImpl: async () => ({ migrated: [], skipped: [], renamedFolders: [], prunedFolders: [] }),
		sync: [],
		syncImpl: async () => ({ conflicts: [], invalid: [] }),
		isGitRepo: false,
		refresh: [],
		refreshImpl: async () => {
			throw new Error('no refresh endpoint');
		},
		applyDefaults: [],
		applyDefaultsImpl: async () => ({ errors: [], scaffolded: 0, authenticated: 0, fetched: 0 }),
		tokenReloads: [],
		builds: 0,
		diagUpdate: [],
		diagClear: [],
		bpmnUpdate: [],
		bpmnClear: [],
		l3Changed: [],
		treeRefresh: 0,
		setSession: [],
		scans: 0,
		scanFailOnCall: 0,
		repoConfigLookups: [],
		invalidated: [],
		cachedRepoFiles: undefined,
		locFromPath: undefined,
		deriveUxStateImpl: undefined,
	});
	return rec;
}

function tracked(kind, extra = {}) {
	const d = Object.assign({ kind, disposed: false }, extra);
	d.dispose = () => {
		d.disposed = true;
	};
	rec.disposables.push(d);
	rec.log.push(kind);
	return d;
}

function eventSource(name) {
	return listener => {
		const list = rec.listeners[name] || (rec.listeners[name] = []);
		const d = tracked(`listener:${name}`);
		list.push({ listener, d });
		return d;
	};
}

/** Calls every live listener for an event and waits for what they return. */
async function fire(name, arg) {
	const live = (rec.listeners[name] || []).filter(x => !x.d.disposed);
	await Promise.all(live.map(x => x.listener(arg)));
}

function configChange(...keys) {
	return { affectsConfiguration: k => keys.includes(k) };
}

function makeWatcher(pattern) {
	const w = tracked('watcher', { pattern, handlers: { create: [], change: [], delete: [] } });
	const sub = kind => l => {
		w.handlers[kind].push(l);
		return { dispose() {} };
	};
	w.onDidCreate = sub('create');
	w.onDidChange = sub('change');
	w.onDidDelete = sub('delete');
	rec.watchers.push(w);
	return w;
}

function emitWatcher(w, kind, uri) {
	if (w.disposed) return;
	for (const l of w.handlers[kind]) l(uri);
}

Object.assign(vscode.workspace, {
	getConfiguration: section => ({
		get: (k, fallback) => {
			const key = section ? `${section}.${k}` : k;
			return rec.config.has(key) ? rec.config.get(key) : fallback;
		},
		has: k => rec.config.has(section ? `${section}.${k}` : k),
		inspect: () => undefined,
		update: async (k, v) => {
			rec.configWrites.push([section, k, v]);
		},
	}),
	onDidChangeConfiguration: eventSource('config'),
	onDidChangeTextDocument: eventSource('changeDoc'),
	onDidSaveTextDocument: eventSource('saveDoc'),
	onDidOpenTextDocument: eventSource('openDoc'),
	onDidCloseTextDocument: eventSource('closeDoc'),
	createFileSystemWatcher: pattern => makeWatcher(pattern),
	registerTextDocumentContentProvider: () => tracked('contentProvider'),
	asRelativePath: p => String(typeof p === 'string' ? p : p.fsPath),
	isTrusted: true,
});
Object.assign(vscode.window, {
	onDidChangeActiveTextEditor: eventSource('activeEditor'),
	onDidChangeWindowState: eventSource('windowState'),
	createTreeView: id => {
		const t = tracked('treeView', { id, selection: [], reveal: async () => {}, onDidChangeSelection: () => ({ dispose() {} }) });
		rec.treeViews.push(t);
		return t;
	},
	createOutputChannel: name => tracked('outputChannel', { name, append() {}, appendLine() {}, show() {}, clear() {} }),
	createStatusBarItem: () => {
		const s = tracked('statusBarItem', { text: '', tooltip: '', command: '', show() {}, hide() {} });
		rec.statusItems.push(s);
		return s;
	},
	showWarningMessage: async (message, ...items) => {
		rec.warnings.push({ message, items });
		return undefined;
	},
	showInformationMessage: async (message, ...items) => {
		rec.infos.push({ message, items });
		return undefined;
	},
	showErrorMessage: async (message, ...items) => {
		rec.errors.push({ message, items });
		return undefined;
	},
	activeTextEditor: undefined,
});
Object.assign(vscode.commands, {
	registerCommand: (id, fn) => {
		rec.commands.set(id, fn);
		return tracked(`command:${id}`);
	},
	executeCommand: async (id, ...args) => {
		rec.executed.push([id, ...args]);
		return undefined;
	},
});
Object.assign(vscode.languages, {
	registerDocumentLinkProvider: () => tracked('provider:link'),
	registerDefinitionProvider: () => tracked('provider:definition'),
	registerReferenceProvider: () => tracked('provider:reference'),
	registerCompletionItemProvider: () => tracked('provider:completion'),
});
newRecording();

// ── Spies on dist/ module exports (compiled call sites read them at call time) ──
const reltioClient = importDist('api/reltioClient');
const realSetTrusted = reltioClient.setTrustedHostSuffixes;
reltioClient.setTrustedHostSuffixes = suffixes => {
	rec.trusted.push(suffixes);
	rec.log.push('setTrustedHostSuffixes');
	return realSetTrusted(suffixes);
};
importDist('ux/setupGuidePanel').openSetupGuidePanel = () => {
	rec.guideOpened++;
};
const layoutMigration = importDist('workspace/layoutMigration');
const { migrationFailureMessage } = layoutMigration;
layoutMigration.migrateWorkspace = (...args) => {
	rec.migrate.push(args);
	return rec.migrateImpl(...args);
};
importDist('workspace/reltioAgentSync').syncReltioAgentAssets = (_ctx, opts) => {
	rec.sync.push(opts);
	return rec.syncImpl(opts);
};
const gitConfigSource = importDist('workspace/gitConfigSource');
gitConfigSource.isGitRepo = async () => rec.isGitRepo;
gitConfigSource.findEnclosingGitRepository = async () => undefined;
importDist('api/oauthLogin').refreshTokens = (rt, creds) => {
	rec.refresh.push([rt, creds]);
	return rec.refreshImpl(rt, creds);
};
const applyDefaultsModule = importDist('workspace/applyDefaultEnvironments');
applyDefaultsModule.applyDefaultEnvironments = opts => {
	rec.applyDefaults.push(opts);
	rec.log.push('applyDefaults');
	return rec.applyDefaultsImpl(opts);
};
applyDefaultsModule.reloadTokenFileIntoStore = async binding => {
	rec.tokenReloads.push(binding.canonicalFsPath);
	return { ok: true, hosts: [] };
};
const uxStateModule = importDist('ux/uxState');
const realDeriveUxState = uxStateModule.deriveUxState;
uxStateModule.deriveUxState = input => (rec.deriveUxStateImpl ? rec.deriveUxStateImpl(input) : realDeriveUxState(input));

const { UriIndex } = importDist('navigation/uriIndex');
const realBuild = UriIndex.prototype.build;
UriIndex.prototype.build = function (...args) {
	rec.builds++;
	rec.log.push('build');
	return realBuild.apply(this, args);
};
for (const [mod, cls, label] of [
	['navigation/documentLinkProvider', 'ReltioDocumentLinkProvider', 'link'],
	['navigation/definitionProvider', 'ReltioDefinitionProvider', 'definition'],
	['navigation/referenceProvider', 'ReltioReferenceProvider', 'reference'],
	['navigation/uriCompletionProvider', 'ReltioUriCompletionProvider', 'completion'],
]) {
	const proto = importDist(mod)[cls].prototype;
	const realSetIndex = proto.setIndex;
	proto.setIndex = function (...args) {
		rec.log.push(`setIndex:${label}`);
		return realSetIndex.apply(this, args);
	};
}
const { DiagnosticsManager } = importDist('navigation/diagnosticsManager');
DiagnosticsManager.prototype.update = function (doc) {
	rec.diagUpdate.push(doc.uri.toString());
	rec.log.push('diagnostics');
};
DiagnosticsManager.prototype.clear = function (uri) {
	rec.diagClear.push(uri.toString());
};
const { BpmnDiagnosticsManager } = importDist('workflow/bpmnDiagnosticsManager');
BpmnDiagnosticsManager.prototype.update = function (doc) {
	rec.bpmnUpdate.push(doc.uri.toString());
};
BpmnDiagnosticsManager.prototype.clear = function (uri) {
	rec.bpmnClear.push(uri.toString());
};
const { MultiTenantTreeProvider } = importDist('tree/multiTenantTreeProvider');
MultiTenantTreeProvider.prototype.onL3DocumentChanged = function (doc) {
	rec.l3Changed.push(doc.uri.toString());
};
const realTreeRefresh = MultiTenantTreeProvider.prototype.refresh;
MultiTenantTreeProvider.prototype.refresh = function (...args) {
	rec.treeRefresh++;
	rec.log.push('treeRefresh');
	return realTreeRefresh.apply(this, args);
};
const realCachedRepoFiles = MultiTenantTreeProvider.prototype.getCachedWorkflowRepoFiles;
MultiTenantTreeProvider.prototype.getCachedWorkflowRepoFiles = function (...args) {
	return rec.cachedRepoFiles !== undefined ? rec.cachedRepoFiles : realCachedRepoFiles.apply(this, args);
};
MultiTenantTreeProvider.prototype.invalidateWorkflowRepoSync = function (env, tenant) {
	rec.invalidated.push(`${env}/${tenant}`);
};
const { TokenStore } = importDist('api/tokenStore');
const realSetSession = TokenStore.prototype.setSession;
TokenStore.prototype.setSession = function (env, session) {
	rec.setSession.push(env);
	rec.log.push(`setSession:${env}`);
	return realSetSession.call(this, env, session);
};
const { EnvironmentManager } = importDist('workspace/environmentManager');
const realScan = EnvironmentManager.prototype.scanEnvironments;
EnvironmentManager.prototype.scanEnvironments = function (...args) {
	rec.scans++;
	if (rec.scanFailOnCall === rec.scans) return Promise.reject(new Error('scan failed'));
	return realScan.apply(this, args);
};
const realLocFromPath = EnvironmentManager.prototype.locFromPath;
EnvironmentManager.prototype.locFromPath = function (p) {
	return rec.locFromPath ? rec.locFromPath(p) : realLocFromPath.call(this, p);
};
const realRepoConfigUri = EnvironmentManager.prototype.getWorkflowRepoConfigUri;
EnvironmentManager.prototype.getWorkflowRepoConfigUri = function (env, tenant) {
	rec.repoConfigLookups.push(`${env}/${tenant}`);
	return realRepoConfigUri.call(this, env, tenant);
};

const ext = importDist('extension');
clock.install();

// ── Fixtures ──
const fixtureText = loadCanonicalFixture().text;

function memento(initial = {}) {
	const map = new Map(Object.entries(initial));
	return {
		map,
		get: (k, fallback) => (map.has(k) ? map.get(k) : fallback),
		update: async (k, v) => {
			if (v === undefined) map.delete(k);
			else map.set(k, v);
		},
		keys: () => [...map.keys()],
		setKeysForSync() {},
	};
}

function fakeSecrets(initial = {}) {
	const map = new Map(Object.entries(initial));
	return {
		map,
		get: async k => map.get(k),
		store: async (k, v) => {
			map.set(k, v);
		},
		delete: async k => {
			map.delete(k);
		},
		onDidChange: () => ({ dispose() {} }),
	};
}

function makeContext({ workspaceState, globalState, secrets } = {}) {
	return {
		subscriptions: [],
		workspaceState: workspaceState ?? memento(),
		globalState: globalState ?? memento(),
		secrets: secrets ?? fakeSecrets(),
		extensionUri: vscode.Uri.file('/ext'),
		extensionPath: '/ext',
		globalStorageUri: vscode.Uri.file('/global'),
		storageUri: vscode.Uri.file('/storage'),
		logUri: vscode.Uri.file('/log'),
		extensionMode: 1,
		extension: { id: 'Reltio.reltio-ide', packageJSON: pkg },
		environmentVariableCollection: {},
		asAbsolutePath: p => path.join('/ext', p),
	};
}

function doc(fileName, text = fixtureText) {
	return { uri: vscode.Uri.file(fileName), fileName, getText: () => text, languageId: 'json', version: 1, isDirty: false };
}

const enc = s => Buffer.from(typeof s === 'string' ? s : JSON.stringify(s));

async function addEnvironment(mem, folderName, host) {
	await mem.writeFile(`/ws/${folderName}/.reltio-environment.json`, enc({ kind: 'environment', host }));
}

async function addGitSourceMarker(mem) {
	await mem.writeFile('/ws/cfg/L3.json', enc(fixtureText));
	await mem.writeFile('/ws/.reltio-config-source.json', enc({ sources: [{ l3RelativePath: 'cfg/L3.json', environmentName: 'repo', tenantId: 'cfg' }] }));
}

/**
 * Fresh recording + memory fs, then the real activate(). Returns the context and memory fs.
 * `setup` runs after the recording is reset and before activate().
 */
async function activateWith({ folder = true, trusted = true, config = {}, activeEditor, ctx, setup, awaitActivate = true } = {}) {
	newRecording();
	clock.reset();
	const mem = installMemoryFs();
	await mem.createDirectory('/ws');
	vscode.workspace.workspaceFolders = folder ? [{ uri: vscode.Uri.file('/ws'), name: 'ws', index: 0 }] : [];
	vscode.workspace.isTrusted = trusted;
	vscode.window.activeTextEditor = activeEditor;
	for (const [k, v] of Object.entries(config)) rec.config.set(k, v);
	if (setup) await setup(mem);
	const context = ctx ?? makeContext();
	const promise = ext.activate(context);
	const syncTrusted = rec.trusted.slice();
	if (awaitActivate) {
		await promise;
		await flush();
	}
	return { context, mem, promise, syncTrusted };
}

const sourceContexts = () => rec.executed.filter(c => c[0] === 'setContext' && c[1] === 'reltio.workspaceSource').map(c => c[2]);

module.exports = {
	rec,
	newRecording,
	tracked,
	eventSource,
	fire,
	configChange,
	makeWatcher,
	emitWatcher,
	clock,
	flush,
	unhandled,
	reltioClient,
	migrationFailureMessage,
	UriIndex,
	MultiTenantTreeProvider,
	TokenStore,
	EnvironmentManager,
	ext,
	fixtureText,
	memento,
	fakeSecrets,
	makeContext,
	doc,
	enc,
	addEnvironment,
	addGitSourceMarker,
	activateWith,
	sourceContexts,
};
