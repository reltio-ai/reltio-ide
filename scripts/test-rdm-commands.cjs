#!/usr/bin/env node
'use strict';
/**
 * Area: RDM, through the real compiled activate() (src/extension.ts, area Extension Activation;
 * src/rdm/lookupLoadBridge.ts, area RDM).
 *
 * The RDM commands run end to end: scripts/lib/activation-harness.cjs runs activate() against
 * the shared vscode stub, an in-memory file system and a fake clock, and this script answers
 * every request with a fake global fetch. Nothing reaches the network or the disk.
 *
 * RDM-006  Apply RDM Configuration and Get Configuration guard against drift and missing baselines.
 *          #1     Apply without a baseline is an error and sends nothing.
 *          #2     Apply after the server changed warns, and sends nothing unless the user reviews.
 *          #3     Apply with the server unchanged asks once, then PUTs the saved text as it is.
 *          #4     Apply with unsaved edits the editor cannot save, or signed out, sends nothing.
 *          #5     Get Configuration names a changed RDM file, or one without a baseline, in one
 *                 modal; dismissing it sends nothing and changes nothing.
 *          #6     Fetch anyway replaces the file and its baseline with the server's copy.
 * RDM-011  The CSV load request file is answered once per settled request.
 *          #1     A request written in pieces gets one result, for the final text.
 *          #2     Requests that settle apart are each answered, in order.
 *          #3     Invalid JSON is read again once; still invalid, it is answered invalid-request.
 *          #4     An empty request file gets no result; result.json is JSON ending in a newline.
 *          #5     After the extension is disposed, a pending request is never answered.
 * RDM-012  Apply RDM Configuration keeps the file and baseline equal to the server's copy.
 *          #1     After the PUT, config.json and its baseline both hold the configuration read
 *                 back from the server, version included.
 *          #2     If that read fails, the user is warned and the pushed text becomes the baseline.
 *          #3     With the Git-repository placeholder token, Apply and Get Lookup Values say why
 *                 and send nothing.
 * RDM-013  The RDM fetch reports what it could not do.
 *          #1     A 403 on the tenant physical configuration shows nothing, but writes one line
 *                 naming the tenant and the 403 to the Reltio RDM output channel.
 *          #2     An RDM tenant id that is not a safe folder name is reported and never written.
 * RDM-014  Connecting tenants keeps local RDM edits and fetches one tenant at a time.
 *          #1     An RDM file with saved edits not yet applied is kept, its baseline too, and the
 *                 user is told which file was kept.
 *          #2     So is one with unsaved edits in an editor.
 *          #3     Three tenants connected together fetch their RDM one at a time, in order.
 *          #4     An expired session found while other tenants wait in that queue gives one
 *                 sign-in message for the environment, not one per tenant.
 *
 * Tier C (manual): the dialogs as they look in VS Code; a live tenant.
 */
const assert = require('node:assert');
const {
	rec,
	activateWith,
	flush,
	clock,
	emitWatcher,
	TokenStore,
	EnvironmentManager,
} = require('./lib/activation-harness.cjs');
const vscode = require('./lib/vscode-stub.cjs');
const { importDist } = require('./lib/import-dist.cjs');

const { RdmRootNode, RdmItemNode, TenantNode } = importDist('tree/multiTenantNodes');
const { GIT_SOURCE_TOKEN } = importDist('api/tokenStore');
const { prettyPrintJsonIfPossible } = importDist('api/formatJson');

const ENV = 'dev.reltio.com';
const TOKEN = 'TOKEN-rdm-commands';
const SERVICE = 'https://rdm.reltio.com';
const U = p => vscode.Uri.file(p);
const tenantDir = t => `/ws/${ENV}.reltio.environment/${t}.reltio.tenant`;
const configPath = (t, id = 'RdmT') => `${tenantDir(t)}/RDM/${id}/config.json`;
const baselinePath = (t, id = 'RdmT') => `${tenantDir(t)}/.reltio-ide/RDM/${id}.baseline.json`;
const pretty = v => JSON.stringify(v, null, 2);
/** A server response as the extension stores it. */
const stored = v => prettyPrintJsonIfPossible(JSON.stringify(v));
const SERVER = { tenantId: 'RdmT', version: 7, lookupTypes: [{ uri: 'rdm/lookupTypes/OrganizationStatuses' }], sources: [] };
const EDITED = { ...SERVER, lookupTypes: [...SERVER.lookupTypes, { uri: 'rdm/lookupTypes/AddressTypes' }] };

// ── The extension's own TokenStore: activate() subscribes to it right after creating it ──
let tokens;
const realOnSessionCleared = TokenStore.prototype.onSessionCleared;
TokenStore.prototype.onSessionCleared = function (listener) {
	tokens = this;
	return realOnSessionCleared.call(this, listener);
};

// ── Every output channel line, and scripted answers for modal warnings ──
const channelLines = [];
vscode.window.createOutputChannel = name => ({
	name,
	append() {},
	appendLine: line => channelLines.push({ name, line }),
	show() {},
	clear() {},
	dispose() {},
});
let answers = [];
vscode.window.showWarningMessage = async (message, ...items) => {
	rec.warnings.push({ message, items });
	return answers.shift();
};

/**
 * A fake RDM tenant and MDM environment behind the global fetch. `routes` are tried in order:
 * [method, url or RegExp, (init, call) => Response]. Every call is recorded; each one yields to
 * the event loop first, as a real request would, so concurrent chains really interleave.
 */
function serve(routes) {
	const calls = [];
	let seq = 0;
	globalThis.fetch = async (url, init = {}) => {
		const call = { method: init.method ?? 'GET', url: String(url), body: init.body, init, start: ++seq };
		calls.push(call);
		try {
			await new Promise(r => setImmediate(r));
			await new Promise(r => setImmediate(r));
			for (const [method, match, respond] of routes) {
				if (method === call.method && (typeof match === 'string' ? match === call.url : match.test(call.url))) {
					return respond(init, call);
				}
			}
			return new Response('not found', { status: 404 });
		} finally {
			call.end = ++seq;
		}
	};
	return calls;
}
/** The most of `calls` ever in flight at once. */
const maxOverlap = calls => Math.max(0, ...calls.map(c => calls.filter(o => o.start <= c.start && (o.end ?? Infinity) > c.start).length));
const json = (value, status = 200) => new Response(typeof value === 'string' ? value : JSON.stringify(value), { status });
const physical = (ids = ['RdmT']) => json({ rdmConfig: { serviceUri: SERVICE, rdmTenants: ids.map(rdmTenantId => ({ rdmTenantId })) } });
const PHYSICAL = new RegExp(`^https://${ENV.replace(/\./g, '\\.')}/reltio/tenants/`);
const L3 = new RegExp(`^https://${ENV.replace(/\./g, '\\.')}/reltio/api/[^/]+/configuration$`);
const RDM_CONFIG = `${SERVICE}/configuration/RdmT`;
const rdmCalls = calls => calls.filter(c => PHYSICAL.test(c.url) || c.url.startsWith(SERVICE));

/** A workspace with tenants t1..tN; `rdm` maps a tenant to its config.json and baseline text. */
async function start({ tenants = ['t1'], rdm = {}, config = {} } = {}) {
	answers = [];
	channelLines.length = 0;
	vscode.workspace.textDocuments = [];
	const { mem, context } = await activateWith({
		config,
		setup: async m => {
			for (const t of tenants) await m.createDirectory(tenantDir(t));
			for (const [t, files] of Object.entries(rdm)) {
				if (files.config !== undefined) await m.writeFile(configPath(t), Buffer.from(files.config));
				if (files.baseline !== undefined) await m.writeFile(baselinePath(t), Buffer.from(files.baseline));
			}
		},
	});
	assert.ok(tokens, 'harness: activate() created a TokenStore');
	tokens.setToken(ENV, TOKEN);
	const read = async p => Buffer.from(await mem.readFile(p)).toString();
	const exists = p => mem._files.has(p);
	return { mem, context, read, exists };
}
const command = id => {
	const fn = rec.commands.get(id);
	assert.ok(fn, `harness: ${id} is registered`);
	return fn;
};
const rootNode = (t = 't1') => new RdmRootNode(ENV, t, 'RdmT', U(configPath(t)), false);
const messages = list => list.map(m => m.message);

// ═════════════════════════════════════════════════════════════════════════════
// RDM-006 and RDM-012 — Apply RDM Configuration
// ═════════════════════════════════════════════════════════════════════════════
async function testApply() {
	// Looked up per call: each start() activates a fresh extension.
	const apply = node => command('reltio.applyRdmConfiguration')(node);

	// #1 No baseline: an error, and not a single request.
	{
		const ws = await start({ rdm: { t1: { config: pretty(EDITED) } } });
		const calls = serve([]);
		await apply(rootNode());
		assert.ok(messages(rec.errors).some(m => /No baseline on disk for RDM tenant "RdmT"/.test(m)),
			`RDM-006 #1: Apply without a baseline is refused (${JSON.stringify(messages(rec.errors))})`);
		assert.strictEqual(calls.length, 0, 'RDM-006 #1: nothing is sent without a baseline');
		assert.strictEqual(await ws.read(configPath('t1')), pretty(EDITED), 'RDM-006 #1: the file is untouched');
	}

	// #2 The server changed since the last fetch: a warning; dismissed, nothing is sent.
	{
		await start({ rdm: { t1: { config: pretty(EDITED), baseline: pretty(SERVER) } } });
		const calls = serve([
			['GET', PHYSICAL, () => physical()],
			['GET', RDM_CONFIG, () => json({ ...SERVER, version: 9, sources: [{ uri: 'rdm/sources/Other' }] })],
		]);
		await apply(rootNode());
		const warning = rec.warnings.find(w => /changed since your last fetch/.test(w.message));
		assert.ok(warning, `RDM-006 #2: a changed server is pointed out (${JSON.stringify(messages(rec.warnings))})`);
		assert.deepStrictEqual(warning.items.slice(1), ['Review changes', 'Skip'], 'RDM-006 #2: the user can only review or skip');
		assert.ok(!calls.some(c => c.method === 'PUT'), 'RDM-006 #2: dismissed, nothing is PUT');
	}

	// #3 + RDM-012 #1: unchanged server, Yes: the saved text is PUT, then the server's copy is kept.
	{
		const local = `${pretty(EDITED)}\n`;
		const ws = await start({ rdm: { t1: { config: local, baseline: pretty(SERVER) } } });
		const applied = { ...EDITED, version: 8, updatedBy: 'server' };
		let gets = 0;
		const calls = serve([
			['GET', PHYSICAL, () => physical()],
			['GET', RDM_CONFIG, () => json(++gets === 1 ? SERVER : applied)],
			['PUT', RDM_CONFIG, () => json('')],
		]);
		answers = ['Yes'];
		await apply(rootNode());
		const ask = rec.warnings.find(w => /matches your last fetch/.test(w.message));
		assert.ok(ask, 'RDM-006 #3: an unchanged server is confirmed once');
		const puts = calls.filter(c => c.method === 'PUT');
		assert.strictEqual(puts.length, 1, 'RDM-006 #3: one PUT');
		assert.strictEqual(puts[0].body, local, 'RDM-006 #3: the PUT body is the saved file, byte for byte');
		assert.strictEqual(await ws.read(configPath('t1')), stored(applied), 'RDM-012 #1: config.json holds the server copy read back after the PUT');
		assert.strictEqual(await ws.read(baselinePath('t1')), stored(applied), 'RDM-012 #1: the baseline holds the same copy');
		assert.ok(messages(rec.infos).some(m => /applied to "RdmT"/.test(m)), 'RDM-012 #1: the user is told it was applied');
	}

	// RDM-012 #2: the read-back fails: a warning, and the pushed text becomes the baseline.
	{
		const local = pretty(EDITED);
		const ws = await start({ rdm: { t1: { config: local, baseline: pretty(SERVER) } } });
		let gets = 0;
		serve([
			['GET', PHYSICAL, () => physical()],
			['GET', RDM_CONFIG, () => (++gets === 1 ? json(SERVER) : json('boom', 500))],
			['PUT', RDM_CONFIG, () => json('')],
		]);
		answers = ['Yes'];
		await apply(rootNode());
		assert.ok(messages(rec.warnings).some(m => /applied to "RdmT", but it could not be read back/.test(m)),
			`RDM-012 #2: a failed read-back is a warning (${JSON.stringify(messages(rec.warnings))})`);
		assert.strictEqual(await ws.read(baselinePath('t1')), local, 'RDM-012 #2: the pushed text becomes the baseline');
		assert.strictEqual(await ws.read(configPath('t1')), local, 'RDM-012 #2: the file keeps what was pushed');
	}

	// #4 Unsaved edits the editor cannot save, then signed out: nothing is sent either way.
	{
		await start({ rdm: { t1: { config: pretty(EDITED), baseline: pretty(SERVER) } } });
		const calls = serve([]);
		vscode.workspace.textDocuments = [{ uri: U(configPath('t1')), isDirty: true, isClosed: false, save: async () => false }];
		await apply(rootNode());
		vscode.workspace.textDocuments = [];
		assert.ok(messages(rec.errors).some(m => /Save RDM\/RdmT\/config\.json before applying/.test(m)), 'RDM-006 #4: unsaved edits stop Apply');
		tokens.clearSession(ENV);
		await apply(rootNode());
		assert.ok(messages(rec.errors).some(m => /Provide a token for this environment first/.test(m)), 'RDM-006 #4: signed out stops Apply');
		assert.strictEqual(calls.length, 0, 'RDM-006 #4: neither sends a request');
	}

	// RDM-012 #3: the Git-repository placeholder is not a session.
	{
		await start({ rdm: { t1: { config: pretty(EDITED), baseline: pretty(SERVER) } } });
		const calls = serve([]);
		tokens.setToken(ENV, GIT_SOURCE_TOKEN);
		await apply(rootNode());
		const item = new RdmItemNode(ENV, 't1', 'RdmT', U(configPath('t1')), 'lookupTypes', ['lookupTypes', 0],
			'OrganizationStatuses', 'rdm/lookupTypes/OrganizationStatuses', 'symbol-enum', 'OrganizationStatuses');
		await command('reltio.getRdmLookupValues')(item);
		const git = messages(rec.errors).filter(m => /opened from a Git repository/.test(m));
		assert.strictEqual(git.length, 2, `RDM-012 #3: Apply and Get Lookup Values each say why (${JSON.stringify(messages(rec.errors))})`);
		assert.strictEqual(calls.length, 0, 'RDM-012 #3: the placeholder is never sent');
	}
}

// ═════════════════════════════════════════════════════════════════════════════
// RDM-006 #5-#6 and RDM-013 — Get Configuration
// ═════════════════════════════════════════════════════════════════════════════
const RDM_CONFIG_U = `${SERVICE}/configuration/RdmU`;
const tenantNode = (t = 't1') => new TenantNode(ENV, t, false, false, true);

async function testGetConfiguration() {
	const getConfiguration = node => command('reltio.fetchL3')(node);
	const SERVER_U = { ...SERVER, tenantId: 'RdmU' };
	const routes = () => [
		['GET', L3, () => json({ uri: 'configuration/entityTypes' })],
		['GET', PHYSICAL, () => physical(['RdmT', 'RdmU'])],
		['GET', RDM_CONFIG, () => json(SERVER)],
		['GET', RDM_CONFIG_U, () => json(SERVER_U)],
	];
	// RdmT has saved edits not yet applied; RdmU has no baseline at all.
	const files = { config: pretty(EDITED), baseline: pretty(SERVER) };
	const setupDrift = async ws => {
		await ws.mem.writeFile(configPath('t1', 'RdmU'), Buffer.from(pretty(SERVER_U)));
	};

	// #5 One modal names both files; dismissed, nothing is sent and nothing changes.
	{
		const ws = await start({ rdm: { t1: files } });
		await setupDrift(ws);
		const calls = serve(routes());
		await getConfiguration(tenantNode());
		const modal = rec.warnings.find(w => /haven't been applied to the tenant/.test(w.message));
		assert.ok(modal, `RDM-006 #5: Get Configuration warns before overwriting (${JSON.stringify(messages(rec.warnings))})`);
		assert.ok(modal.message.includes('RDM/RdmT/config.json'), 'RDM-006 #5: the changed RDM file is named');
		assert.ok(modal.message.includes('RDM/RdmU/config.json'), 'RDM-006 #5: a file without a baseline counts as changed');
		assert.strictEqual(rec.warnings.filter(w => w.items.length > 0).length, 1, 'RDM-006 #5: one modal for every file');
		assert.strictEqual(calls.length, 0, 'RDM-006 #5: dismissed, nothing is fetched');
		assert.strictEqual(await ws.read(configPath('t1')), pretty(EDITED), 'RDM-006 #5: dismissed, the file is untouched');
	}

	// #6 Fetch anyway: both files and their baselines take the server's copy.
	{
		const ws = await start({ rdm: { t1: files } });
		await setupDrift(ws);
		serve(routes());
		answers = ['Fetch anyway'];
		await getConfiguration(tenantNode());
		await flush();
		for (const [id, server] of [['RdmT', SERVER], ['RdmU', SERVER_U]]) {
			assert.strictEqual(await ws.read(configPath('t1', id)), stored(server), `RDM-006 #6: Fetch anyway replaces RDM/${id}/config.json`);
			assert.strictEqual(await ws.read(baselinePath('t1', id)), stored(server), `RDM-006 #6: and refreshes its baseline`);
		}
	}

	// RDM-013 #1: a 403 on the physical configuration is silent, but leaves a trace for support.
	{
		const ws = await start();
		const calls = serve([
			['GET', L3, () => json({ uri: 'configuration/entityTypes' })],
			['GET', PHYSICAL, () => json('forbidden', 403)],
		]);
		await getConfiguration(tenantNode());
		await flush();
		assert.ok(calls.some(c => PHYSICAL.test(c.url)), 'RDM-013 #1: the physical configuration was asked for');
		const shown = [...messages(rec.errors), ...messages(rec.warnings)].filter(m => /RDM|403|physical/i.test(m));
		assert.deepStrictEqual(shown, [], 'RDM-013 #1: a 403 shows no message');
		const lines = channelLines.filter(l => l.name === 'Reltio RDM');
		assert.strictEqual(lines.length, 1, `RDM-013 #1: one line in the Reltio RDM channel (${JSON.stringify(channelLines)})`);
		assert.match(lines[0].line, /dev\.reltio\.com\/t1: RDM not fetched\..*HTTP 403/, 'RDM-013 #1: the line names the tenant and the 403');
		assert.ok(![...ws.mem._files.keys()].some(p => p.includes('/RDM/')), 'RDM-013 #1: no RDM file is written');
	}

	// RDM-013 #2: an id that could leave the tenant folder is reported and never written or fetched.
	{
		const ws = await start();
		const calls = serve([
			['GET', L3, () => json({ uri: 'configuration/entityTypes' })],
			['GET', PHYSICAL, () => physical(['RdmT', '../evil'])],
			['GET', RDM_CONFIG, () => json(SERVER)],
		]);
		await getConfiguration(tenantNode());
		await flush();
		assert.ok(messages(rec.errors).some(m => /not fetched for 1 of 2 RDM tenant\(s\): "\.\.\/evil" \(not a valid RDM tenant ID\)/.test(m)),
			`RDM-013 #2: the unsafe id is reported (${JSON.stringify(messages(rec.errors))})`);
		assert.strictEqual(await ws.read(configPath('t1')), stored(SERVER), 'RDM-013 #2: the safe id is still written');
		assert.ok(![...ws.mem._files.keys()].some(p => p.includes('evil')), 'RDM-013 #2: nothing is written for the unsafe id');
		assert.ok(!calls.some(c => c.url.includes('evil')), 'RDM-013 #2: nothing is fetched for it');
	}
}

// ═════════════════════════════════════════════════════════════════════════════
// RDM-014 — connecting tenants
// ═════════════════════════════════════════════════════════════════════════════

/** The extension's own connect operation, as apply-defaults receives it. */
async function connectOperation() {
	let connect;
	rec.applyDefaultsImpl = async opts => {
		connect = opts.writeL3FromApi;
		return { errors: [], scaffolded: 0, authenticated: 0, fetched: 0 };
	};
	await command('reltio.applyDefaultEnvironments')();
	assert.strictEqual(typeof connect, 'function', 'harness: apply-defaults hands over the connect operation');
	return connect;
}

async function testConnect() {
	const config = { 'reltio.fetchL3AfterApplyDefaults': true };
	const routes = (physicalResponse = () => physical()) => [
		['GET', L3, () => json({ uri: 'configuration/entityTypes' })],
		['GET', PHYSICAL, physicalResponse],
		['GET', RDM_CONFIG, () => json(SERVER)],
	];

	// #1 Saved edits not yet applied are kept, with their baseline, and the user is told.
	{
		const ws = await start({ config, rdm: { t1: { config: pretty(EDITED), baseline: pretty(SERVER) } } });
		const connect = await connectOperation();
		const calls = serve(routes());
		assert.strictEqual(await connect(ENV, 't1', TOKEN), 'written', 'RDM-014 #1: the Business Config is written');
		await flush(200);
		assert.ok(calls.some(c => PHYSICAL.test(c.url)), 'RDM-014 #1: RDM discovery ran');
		assert.ok(!calls.some(c => c.url === RDM_CONFIG), 'RDM-014 #1: the RDM configuration is not fetched over local edits');
		assert.strictEqual(await ws.read(configPath('t1')), pretty(EDITED), 'RDM-014 #1: the edited file is kept');
		assert.strictEqual(await ws.read(baselinePath('t1')), pretty(SERVER), 'RDM-014 #1: so is its baseline');
		assert.ok(messages(rec.warnings).some(m => /Kept your local changes to RDM\/RdmT\/config\.json for "t1"/.test(m)),
			`RDM-014 #1: the user is told which file was kept (${JSON.stringify(messages(rec.warnings))})`);
	}

	// #2 Unsaved edits in an editor count too.
	{
		const ws = await start({ config, rdm: { t1: { config: pretty(SERVER), baseline: pretty(SERVER) } } });
		const connect = await connectOperation();
		const calls = serve(routes());
		vscode.workspace.textDocuments = [{ uri: U(configPath('t1')), isDirty: true, isClosed: false, getText: () => pretty(EDITED) }];
		await connect(ENV, 't1', TOKEN);
		await flush(200);
		vscode.workspace.textDocuments = [];
		assert.ok(!calls.some(c => c.url === RDM_CONFIG), 'RDM-014 #2: nothing is fetched over unsaved edits');
		assert.strictEqual(await ws.read(configPath('t1')), pretty(SERVER), 'RDM-014 #2: the file on disk is not replaced');
		assert.ok(messages(rec.warnings).some(m => /Kept your local changes to RDM\/RdmT\/config\.json/.test(m)), 'RDM-014 #2: the user is told');
	}

	// #3 Three tenants connected together: their RDM is fetched one tenant at a time, in order.
	{
		const tenants = ['t1', 't2', 't3'];
		const ws = await start({ config, tenants });
		const connect = await connectOperation();
		const calls = serve(routes());
		for (const t of tenants) await connect(ENV, t, TOKEN);
		await flush(300);
		const rdm = rdmCalls(calls);
		assert.deepStrictEqual(rdm.filter(c => PHYSICAL.test(c.url)).map(c => c.url.split('/').pop()), tenants,
			'RDM-014 #3: each tenant is discovered, in the order connected');
		assert.strictEqual(maxOverlap(rdm), 1, `RDM-014 #3: never more than one RDM request at a time (got ${maxOverlap(rdm)})`);
		for (const t of tenants) {
			assert.strictEqual(await ws.read(configPath(t)), stored(SERVER), `RDM-014 #3: ${t} gets its RDM configuration`);
		}
	}

	// #4 An expired session found while other tenants wait in the queue: one sign-in message for
	// the environment, not one per tenant. RDM discovery is made slower than the Business Config
	// fetch, so later tenants join the queue while the first is still being discovered.
	{
		const tenants = ['t1', 't2', 't3'];
		await start({ config, tenants });
		const connect = await connectOperation();
		const slow401 = async () => {
			for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
			return json('', 401);
		};
		const calls = serve(routes(slow401));
		for (const t of tenants) await connect(ENV, t, TOKEN);
		await flush(300);
		assert.strictEqual(rdmCalls(calls).filter(c => PHYSICAL.test(c.url)).length >= tenants.length, true,
			'RDM-014 #4: every tenant tried RDM discovery');
		const expired = messages(rec.errors).filter(m => /Session expired for "dev\.reltio\.com"/.test(m));
		assert.strictEqual(expired.length, 1, `RDM-014 #4: one sign-in message for the environment (got ${expired.length})`);
	}
}

// ═════════════════════════════════════════════════════════════════════════════
// RDM-011 — the CSV load request file
// ═════════════════════════════════════════════════════════════════════════════
async function testRequestFile() {
	const ws = await start();
	const watcher = rec.watchers.find(w => String(w.pattern && w.pattern.pattern).includes('rdm-lookup-load/request.json'));
	assert.ok(watcher, 'harness: activate() watches the CSV load request file');
	const dir = '/ws/.reltio/reltio-agent/rdm-lookup-load';
	const results = [];
	const realWrite = ws.mem.writeFile;
	ws.mem.writeFile = async (uri, bytes) => {
		if ((typeof uri === 'string' ? uri : uri.fsPath).replace(/\\/g, '/') === `${dir}/result.json`) results.push(Buffer.from(bytes).toString());
		return realWrite(uri, bytes);
	};
	const put = text => realWrite(`${dir}/request.json`, Buffer.from(text));
	const write = async text => {
		await put(text);
		emitWatcher(watcher, 'change', U(`${dir}/request.json`));
	};
	const settle = async ms => {
		clock.tick(ms);
		await flush(60);
	};
	// A request the bridge answers without the network: its rdmConfigFile is not an RDM file.
	const request = id => JSON.stringify({ requestId: id, mode: 'plan', csvFile: 'data/x.csv', rdmConfigFile: 'not-rdm.json' });
	const ids = () => results.map(r => JSON.parse(r).requestId);

	// #1 Written in pieces: one answer, after it settles, for the final text.
	await write('{"requestId":"r1",');
	await settle(100);
	await write(request('r1'));
	await settle(299);
	assert.strictEqual(results.length, 0, 'RDM-011 #1: nothing is answered while the file is still being written');
	await settle(1);
	assert.deepStrictEqual(ids(), ['r1'], 'RDM-011 #1: one answer, for the final text');

	// #2 Requests that settle apart are each answered, in order.
	await write(request('r2'));
	await settle(300);
	await write(request('r3'));
	await settle(300);
	assert.deepStrictEqual(ids(), ['r1', 'r2', 'r3'], 'RDM-011 #2: each settled request is answered, in order');

	// #3 Caught mid-write: read again once, and the completed text is answered.
	await write('{"requestId":"r4", "mode": ');
	await settle(300);
	assert.strictEqual(results.length, 3, 'RDM-011 #3: a half-written file is not answered yet');
	await put(request('r4'));
	await settle(500);
	assert.deepStrictEqual(ids().slice(-1), ['r4'], 'RDM-011 #3: the second read answers the completed request');
	// Still invalid on the second read: invalid-request.
	await write('{ not json');
	await settle(300);
	await settle(500);
	const invalid = JSON.parse(results[results.length - 1]);
	assert.deepStrictEqual([invalid.requestId, invalid.status, invalid.error.kind], [null, 'failed', 'invalid-request'],
		'RDM-011 #3: still invalid, it is answered invalid-request');
	assert.strictEqual(invalid.message, 'request.json is not valid JSON.', 'RDM-011 #3: and says so');

	// #4 An empty file is not a request; every result is JSON ending in a newline.
	const before = results.length;
	await write('   ');
	await settle(300);
	await settle(500);
	assert.strictEqual(results.length, before, 'RDM-011 #4: an empty request file gets no result');
	for (const text of results) {
		assert.ok(text.endsWith('\n'), 'RDM-011 #4: result.json ends in a newline');
		assert.doesNotThrow(() => JSON.parse(text), 'RDM-011 #4: result.json is valid JSON');
	}

	// #5 Disposed before the request settles: it is never answered.
	await write(request('r5'));
	for (const d of ws.context.subscriptions) {
		try {
			d.dispose();
		} catch {
			// Disposing the rest of the extension is not what this checks.
		}
	}
	await settle(1000);
	assert.ok(!ids().includes('r5'), 'RDM-011 #5: after dispose, a pending request is never answered');
}

async function main() {
	await testApply();
	await testGetConfiguration();
	await testConnect();
	await testRequestFile();
	await flush();
	console.log('test-rdm-commands: OK');
	process.exit(0);
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
