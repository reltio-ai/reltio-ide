#!/usr/bin/env node
'use strict';
/**
 * Regression: Setup & Authentication
 * Rows: SETUP-001, SETUP-002, SETUP-003, SETUP-004, SETUP-005, SETUP-006, SETUP-007, SETUP-008,
 *       SETUP-009, SETUP-010, SETUP-012
 * Not automated: SETUP-011 (120 s login timeout) is manual (Tier C).
 *
 * Every assertion message starts with `<row id> #<check>`, matching the numbered checks in the
 * row's `scenario` / `expected` fields.
 *
 * The OAuth rows (SETUP-005, SETUP-008) bind the real callback server on localhost:8081 and
 * stub `fetch` and `vscode.env.openExternal`; no request leaves the machine.
 */
const assert = require('assert');
const http = require('http');
const net = require('net');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');
const vscode = require('./lib/vscode-stub.cjs');
const { installMemoryFs } = require('./lib/memory-fs.cjs');

// The setup wizard's tenant picker uses a separator item; the shared stub predates it. Set before
// any import: compiled modules copy the stub's top-level properties when they load.
vscode.QuickPickItemKind = vscode.QuickPickItemKind ?? { Separator: -1, Default: 0 };

const { TokenStore, GIT_SOURCE_TOKEN } = importDist('api/tokenStore');
const { SessionStore } = importDist('api/sessionStore');
const { OAuthCredentialsStore } = importDist('api/oauthCredentialsStore');
const oauthLogin = importDist('api/oauthLogin');
const { buildAuthorizationUrl, ssoCheck, refreshTokens, runBrowserLogin, OAuthLoginError } = oauthLogin;
const { EnvironmentManager, environmentShortLabel } = importDist('workspace/environmentManager');
const {
	applyDefaultEnvironments,
	entryHasIllicitSecretFields,
	findConflictingTokenFiles,
	indexTokenFilesByCanonicalPath,
	isSafePathSegment,
	readAccessTokenFromFile,
	readDefaultEnvironmentEntries,
	reloadTokenFileIntoStore,
	resolveTokenFileUri,
	summarizeApplyResult,
} = importDist('workspace/applyDefaultEnvironments');
const { TERMS_VERSION, ensureTermsAccepted, resetTermsAcceptance } = importDist('ux/termsOfUse');
const { launchSetupWizard } = importDist('ux/setupWizard');
const { openSetupGuidePanel } = importDist('ux/setupGuidePanel');

// `runBrowserLogin` arms a 120 s timeout it never clears. Unref long timers so a finished login
// does not hold this process open for two minutes; the timeout branch itself is SETUP-011 (manual).
const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...args) => {
	const t = realSetTimeout(fn, ms, ...args);
	if (typeof ms === 'number' && ms >= 60_000 && t && typeof t.unref === 'function') t.unref();
	return t;
};

const realFetch = global.fetch;
const CALLBACK = 'http://localhost:8081';
const ACCEPTED_VERSION_KEY = 'reltio.termsAcceptedVersion';

// --- shared fakes -----------------------------------------------------------

function makeSecrets() {
	const map = new Map();
	return {
		map,
		async store(k, v) {
			map.set(k, v);
		},
		async get(k) {
			return map.get(k);
		},
		async delete(k) {
			map.delete(k);
		},
	};
}

function makeMemento(initial) {
	const map = new Map(Object.entries(initial ?? {}));
	return {
		map,
		get: (k, def) => (map.has(k) ? map.get(k) : def),
		update: async (k, v) => {
			if (v === undefined) map.delete(k);
			else map.set(k, v);
		},
		keys: () => [...map.keys()],
	};
}

function jsonResponse(body, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Records every fetch and answers through `handler(url, init)`. */
function stubFetch(handler) {
	const calls = [];
	global.fetch = async (url, init = {}) => {
		calls.push({ url: String(url), init });
		return handler(String(url), init);
	};
	return calls;
}

/**
 * One request on a fresh connection. `agent: false` matters: Node's default agent keeps sockets
 * alive, so a later request could reach an earlier login's (already closed) callback server.
 */
function httpGet(url) {
	return new Promise((resolve, reject) => {
		http
			.get(url, { agent: false }, res => {
				let body = '';
				res.setEncoding('utf8');
				res.on('data', c => (body += c));
				res.on('end', () => resolve({ status: res.statusCode, body }));
			})
			.on('error', reject);
	});
}

/** Fails loudly instead of letting an unsettled promise end the script with exit code 0. */
function withTimeout(promise, ms, message) {
	let timer;
	return Promise.race([
		promise,
		new Promise((_, reject) => {
			timer = realSetTimeout(() => reject(new Error(message)), ms);
		}),
	]).finally(() => clearTimeout(timer));
}

async function settle(promise) {
	try {
		return { value: await promise };
	} catch (error) {
		return { error };
	}
}

/** True when a server can bind localhost:8081, i.e. nothing is left listening on it. */
function portIsFree() {
	return new Promise(resolve => {
		const srv = net.createServer();
		srv.once('error', () => resolve(false));
		srv.listen(8081, 'localhost', () => srv.close(() => resolve(true)));
	});
}

/** Waits until runBrowserLogin has opened the browser, and returns the URL it opened. */
async function waitForOpenExternal(opened, message) {
	for (let i = 0; i < 200 && opened.length === 0; i++) {
		await new Promise(r => realSetTimeout(r, 10));
	}
	assert.ok(opened.length > 0, message);
	return opened[opened.length - 1];
}

(async () => {
	const originalOpenExternal = vscode.env.openExternal;
	const opened = [];
	vscode.env.openExternal = async uri => {
		opened.push(uri.fsPath);
		return true;
	};

	// =========================================================================
	// SETUP-001 TokenStore: tokens, aliases, sessions, in-flight refresh, git sentinel
	// =========================================================================
	{
		// #1 set / overwrite / clear
		const s = new TokenStore();
		assert.strictEqual(s.getToken('e1'), undefined, 'SETUP-001 #1: getToken before setToken must be undefined');
		s.setToken('e1', 'a1');
		assert.strictEqual(s.getToken('e1'), 'a1', 'SETUP-001 #1: setToken value must be returned');
		s.setToken('e1', 'a2');
		assert.strictEqual(s.getToken('e1'), 'a2', 'SETUP-001 #1: second setToken must overwrite');
		s.clearToken('e1');
		assert.strictEqual(s.hasToken('e1'), false, 'SETUP-001 #1: hasToken must be false after clearToken');

		// #2 aliases: chain, cycle, depth cap, direct set drops alias
		const a = new TokenStore();
		a.setToken('a', 'tok-a');
		a.useTokenFrom('b', 'a');
		a.useTokenFrom('c', 'b');
		assert.strictEqual(a.getToken('c'), 'tok-a', 'SETUP-001 #2: chain c->b->a must resolve to a');
		a.useTokenFrom('x', 'y');
		a.useTokenFrom('y', 'x');
		assert.strictEqual(a.getToken('x'), undefined, 'SETUP-001 #2: alias cycle must return undefined');
		// e0 -> e1 -> ... -> e9 holds the token: ten environments visited, within the cap.
		const d = new TokenStore();
		d.setToken('e9', 'deep');
		for (let i = 0; i < 9; i++) d.useTokenFrom(`e${i}`, `e${i + 1}`);
		assert.strictEqual(d.getToken('e0'), 'deep', 'SETUP-001 #2: chain within MAX_ALIAS_DEPTH must resolve');
		// f0 -> ... -> f11 holds the token: 11 alias hops, beyond the cap.
		const o = new TokenStore();
		o.setToken('f11', 'too-deep');
		for (let i = 0; i < 11; i++) o.useTokenFrom(`f${i}`, `f${i + 1}`);
		assert.strictEqual(o.getToken('f0'), undefined, 'SETUP-001 #2: an 11-hop chain must return undefined');
		a.setToken('b', 'own-b');
		a.setToken('a', 'tok-a2');
		assert.strictEqual(a.getToken('b'), 'own-b', 'SETUP-001 #2: direct setToken on an aliased env must use its own token');
		// A direct token shadows any alias in getToken, so a stale alias is invisible through the
		// public API; read the (TS-private) alias map to prove it was dropped.
		assert.strictEqual(a.aliases.has('b'), false, 'SETUP-001 #2: direct setToken on an aliased env must drop the alias');

		// #3 sessions
		const ss = new TokenStore();
		ss.setSession('e1', { accessToken: 'acc', refreshToken: 'ref', expiresAt: 123 });
		ss.useTokenFrom('e2', 'e1');
		ss.setSession('e3', { accessToken: 'acc3', refreshToken: 'ref3', expiresAt: 1 });
		ss.useTokenFrom('e4', 'e3');
		const p = Promise.resolve(true);
		ss.setRefreshInFlight('e1', p);
		assert.strictEqual(ss.getToken('e1'), 'acc', 'SETUP-001 #3: setSession access token must be returned');
		assert.strictEqual(ss.getRefreshToken('e1'), 'ref', 'SETUP-001 #3: setSession refresh token must be returned');
		ss.clearSession('e1');
		assert.strictEqual(ss.getToken('e1'), undefined, 'SETUP-001 #3: clearSession must remove the access token');
		assert.strictEqual(ss.getRefreshToken('e1'), undefined, 'SETUP-001 #3: clearSession must remove the refresh token');
		assert.strictEqual(ss.getToken('e4'), 'acc3', 'SETUP-001 #3: clearSession must not touch other environments');
		ss.clearSession('e4');
		assert.strictEqual(ss.getToken('e4'), undefined, 'SETUP-001 #3: clearSession must remove the alias for that env');
		assert.strictEqual(ss.getToken('e3'), 'acc3', 'SETUP-001 #3: clearing an alias must keep its source session');
		ss.clearAll();
		assert.strictEqual(ss.getToken('e3'), undefined, 'SETUP-001 #3: clearAll must empty tokens');
		assert.strictEqual(ss.getRefreshToken('e3'), undefined, 'SETUP-001 #3: clearAll must empty sessions');
		assert.strictEqual(ss.getToken('e2'), undefined, 'SETUP-001 #3: clearAll must empty aliases');
		assert.strictEqual(ss.getRefreshInFlight('e1'), undefined, 'SETUP-001 #3: clearAll must empty in-flight refreshes');

		// #4 in-flight refresh
		const r = new TokenStore();
		const inflight = Promise.resolve(true);
		r.setRefreshInFlight('e1', inflight);
		assert.strictEqual(r.getRefreshInFlight('e1'), inflight, 'SETUP-001 #4: concurrent 401s must share the same promise');
		assert.strictEqual(r.getRefreshInFlight('e2'), undefined, 'SETUP-001 #4: another env must have no in-flight refresh');
		r.clearRefreshInFlight('e1');
		assert.strictEqual(r.getRefreshInFlight('e1'), undefined, 'SETUP-001 #4: clearRefreshInFlight must remove the promise');

		// #5 git sentinel
		assert.strictEqual(GIT_SOURCE_TOKEN, '__reltio-git-source__', 'SETUP-001 #5: GIT_SOURCE_TOKEN literal value changed');
		const g = new TokenStore();
		g.setToken('repo', GIT_SOURCE_TOKEN);
		assert.strictEqual(g.getToken('repo'), GIT_SOURCE_TOKEN, 'SETUP-001 #5: sentinel must round-trip unchanged');
	}

	// =========================================================================
	// SETUP-002 SessionStore and OAuthCredentialsStore persistence in SecretStorage
	// =========================================================================
	{
		// #1 save / load / list
		const secrets = makeSecrets();
		const memento = makeMemento();
		const store = new SessionStore(secrets, memento);
		await store.saveRefreshToken('e1', 'r1');
		await store.saveRefreshToken('e1', 'r1');
		await store.saveRefreshToken('e2', 'r2');
		assert.deepStrictEqual(
			[...secrets.map.keys()].sort(),
			['reltio.refreshToken.e1', 'reltio.refreshToken.e2'],
			'SETUP-002 #1: refresh tokens must be stored under reltio.refreshToken.<env>',
		);
		assert.strictEqual(await store.loadRefreshToken('e1'), 'r1', 'SETUP-002 #1: loadRefreshToken must return the saved token');
		assert.deepStrictEqual(await store.listEnvironments(), ['e1', 'e2'], 'SETUP-002 #1: listEnvironments must have no duplicates');
		const mementoJson = JSON.stringify([...memento.map.entries()]);
		assert.ok(!mementoJson.includes('r1') && !mementoJson.includes('r2'), 'SETUP-002 #1: no refresh token may be written to the Memento');
		assert.deepStrictEqual(memento.keys(), ['reltio.oauthEnvironments'], 'SETUP-002 #1: Memento must hold only the env name list');

		// #2 delete
		await store.deleteRefreshToken('e1');
		assert.strictEqual(secrets.map.has('reltio.refreshToken.e1'), false, 'SETUP-002 #2: deleteRefreshToken must remove the secret');
		assert.strictEqual(await store.loadRefreshToken('e1'), undefined, 'SETUP-002 #2: load after delete must be undefined');
		assert.deepStrictEqual(await store.listEnvironments(), ['e2'], 'SETUP-002 #2: deleted env must leave the list');
		await assert.doesNotReject(store.deleteRefreshToken('never-saved'), 'SETUP-002 #2: deleting an unknown env must not throw');

		// #3 OAuth client credentials and SSO tenant id
		const cSecrets = makeSecrets();
		const creds = new OAuthCredentialsStore(cSecrets);
		await creds.saveClientCredentials('e1', { clientId: 'id1', clientSecret: 'sec1' });
		await creds.saveSsoTenantId('e1', 't');
		assert.deepStrictEqual(
			[...cSecrets.map.keys()].sort(),
			['reltio.oauth.e1.clientId', 'reltio.oauth.e1.clientSecret', 'reltio.oauth.e1.ssoTenantId'],
			'SETUP-002 #3: keys must be reltio.oauth.<env>.clientId/clientSecret/ssoTenantId',
		);
		assert.deepStrictEqual(
			await creds.loadClientCredentials('e1'),
			{ clientId: 'id1', clientSecret: 'sec1' },
			'SETUP-002 #3: loadClientCredentials must return the saved pair',
		);
		assert.strictEqual(await creds.hasClientCredentials('e1'), true, 'SETUP-002 #3: hasClientCredentials must be true after save');
		assert.strictEqual(await creds.loadSsoTenantId('e1'), 't', 'SETUP-002 #3: loadSsoTenantId must return the saved id');
		await cSecrets.store('reltio.oauth.e2.clientId', 'only-id');
		assert.strictEqual(await creds.loadClientCredentials('e2'), undefined, 'SETUP-002 #3: missing secret must load undefined');
		assert.strictEqual(await creds.hasClientCredentials('e2'), false, 'SETUP-002 #3: missing secret must report has=false');
		await creds.deleteClientCredentials('e1');
		assert.ok(
			![...cSecrets.map.keys()].some(k => k.startsWith('reltio.oauth.e1.')),
			'SETUP-002 #3: deleteClientCredentials must remove all three keys for the env',
		);
	}

	// =========================================================================
	// SETUP-003 OAuth helpers: authorization URL, ssoCheck mapping, refreshTokens contract
	// =========================================================================
	{
		// #1 authorization URL
		const raw = buildAuthorizationUrl({ clientId: 'id a', clientSecret: 's' }, 'sso tenant', 'st&1');
		const u = new URL(raw);
		assert.strictEqual(u.host, 'auth.reltio.com', 'SETUP-003 #1: authorization host must be auth.reltio.com');
		assert.strictEqual(u.pathname, '/oauth/sso', 'SETUP-003 #1: authorization path must be /oauth/sso');
		assert.strictEqual(u.searchParams.get('tenant_id'), 'sso tenant', 'SETUP-003 #1: tenant_id param');
		assert.strictEqual(u.searchParams.get('response_type'), 'code', 'SETUP-003 #1: response_type=code');
		assert.strictEqual(u.searchParams.get('client_id'), 'id a', 'SETUP-003 #1: client_id param');
		assert.strictEqual(u.searchParams.get('redirect_uri'), CALLBACK, 'SETUP-003 #1: redirect_uri must be http://localhost:8081');
		assert.strictEqual(u.searchParams.get('state'), 'st&1', 'SETUP-003 #1: state must round-trip');
		assert.ok(raw.includes('state=st%261'), 'SETUP-003 #1: state must be percent-encoded in the raw URL');
		assert.ok(!u.searchParams.has('client_secret'), 'SETUP-003 #1: client secret must never be in the URL');
		assert.ok(![...u.searchParams.values()].includes('s'), 'SETUP-003 #1: client secret value must never be in the URL');

		// #2 ssoCheck mapping
		const creds = { clientId: 'cid', clientSecret: 'csecret' };
		let calls = stubFetch(async () => jsonResponse({ status: 'sso' }));
		assert.strictEqual(await ssoCheck('t1', creds, 'st'), 'sso', "SETUP-003 #2: {status:'sso'} must map to 'sso'");
		const body = new URLSearchParams(calls[0].init.body);
		assert.strictEqual(calls[0].init.method, 'POST', 'SETUP-003 #2: ssoCheck must POST');
		assert.strictEqual(body.get('tenant_id'), 't1', 'SETUP-003 #2: ssoCheck body tenant_id');
		assert.strictEqual(body.get('client_id'), 'cid', 'SETUP-003 #2: ssoCheck body client_id');
		assert.strictEqual(body.get('response_type'), 'code', 'SETUP-003 #2: ssoCheck body response_type');
		assert.strictEqual(body.get('state'), 'st', 'SETUP-003 #2: ssoCheck body state');
		assert.strictEqual(body.get('redirect_uri'), CALLBACK, 'SETUP-003 #2: ssoCheck body redirect_uri');
		assert.ok(!body.has('client_secret') && !String(calls[0].init.body).includes('csecret'), 'SETUP-003 #2: ssoCheck must not send the client secret');

		stubFetch(async () => jsonResponse({ status: 'native' }));
		assert.strictEqual(await ssoCheck('t1', creds, 'st'), 'native', "SETUP-003 #2: {status:'native'} must map to 'native'");

		const failing = [
			['HTTP 500', async () => jsonResponse({}, 500)],
			['rejected fetch', async () => {
				throw new Error('network down');
			}],
			['unexpected status', async () => jsonResponse({ status: 'weird', error: 'x' })],
		];
		for (const [label, handler] of failing) {
			stubFetch(handler);
			const res = await settle(ssoCheck('t1', creds, 'st'));
			assert.ok(res.error instanceof OAuthLoginError, `SETUP-003 #2: ${label} must throw OAuthLoginError`);
			assert.strictEqual(res.error.code, 'SSO_CHECK_FAILED', `SETUP-003 #2: ${label} must use code SSO_CHECK_FAILED`);
		}

		// #3 refreshTokens contract
		calls = stubFetch(async () => jsonResponse({ access_token: 'new', expires_in: 60 }));
		let before = Date.now();
		let session = await refreshTokens('old', creds);
		assert.strictEqual(session.accessToken, 'new', 'SETUP-003 #3: refreshed access token');
		assert.strictEqual(session.refreshToken, 'old', 'SETUP-003 #3: missing refresh_token must keep the old one');
		assert.ok(
			session.expiresAt >= before + 60_000 && session.expiresAt <= Date.now() + 60_000,
			'SETUP-003 #3: expiresAt must be about now+60s',
		);
		const rBody = new URLSearchParams(calls[0].init.body);
		assert.strictEqual(calls[0].url, 'https://auth.reltio.com/oauth/token', 'SETUP-003 #3: refresh must hit the token endpoint');
		assert.strictEqual(rBody.get('grant_type'), 'refresh_token', 'SETUP-003 #3: grant_type=refresh_token');
		assert.strictEqual(rBody.get('refresh_token'), 'old', 'SETUP-003 #3: refresh_token must be sent in the body');
		assert.strictEqual(
			calls[0].init.headers.Authorization,
			`Basic ${Buffer.from('cid:csecret').toString('base64')}`,
			'SETUP-003 #3: refresh must use Basic client auth',
		);

		stubFetch(async () => jsonResponse({ access_token: 'n2', refresh_token: 'r2' }));
		before = Date.now();
		session = await refreshTokens('old', creds);
		assert.strictEqual(session.refreshToken, 'r2', 'SETUP-003 #3: returned refresh_token must replace the old one');
		assert.ok(
			session.expiresAt >= before + 3_600_000 && session.expiresAt <= Date.now() + 3_600_000,
			'SETUP-003 #3: missing expires_in must default to 3600s',
		);
	}

	// =========================================================================
	// SETUP-004 Workspace layer: EnvironmentManager round trip and shared tokenFile binding
	// =========================================================================
	{
		// #1 EnvironmentManager round trip on an in-memory fs
		const mem = installMemoryFs();
		const root = vscode.Uri.file('/ws');
		await mem.createDirectory(root);
		assert.strictEqual(environmentShortLabel('dev.reltio.com'), 'dev', "SETUP-004 #1: short label of dev.reltio.com must be 'dev'");

		const writer = new EnvironmentManager(root);
		const envUri = await writer.createEnvironment('dev.reltio.com');
		assert.strictEqual(path.posix.basename(envUri.fsPath), 'dev', 'SETUP-004 #1: environment folder must use the short label');
		const marker = JSON.parse(Buffer.from(await mem.readFile('/ws/dev/.reltio-environment.json')).toString('utf8'));
		assert.strictEqual(marker.host, 'dev.reltio.com', 'SETUP-004 #1: environment marker must carry the full host');
		await writer.createTenant('dev.reltio.com', 't1');
		await writer.createEnvironment('abc.reltio.com');
		// A dot-prefixed folder carrying a valid marker must still be skipped.
		await mem.writeFile('/ws/.hidden/.reltio-environment.json', Buffer.from(JSON.stringify({ kind: 'environment', host: 'hidden.reltio.com' })));

		const reader = new EnvironmentManager(root);
		const envs = await reader.scanEnvironments();
		assert.deepStrictEqual(
			envs.map(e => e.name),
			['abc.reltio.com', 'dev.reltio.com'],
			'SETUP-004 #1: scan must return hosts (not labels), sorted, with dotfolders skipped',
		);
		assert.deepStrictEqual(
			envs.find(e => e.name === 'dev.reltio.com').tenants,
			[{ tenantId: 't1', hasL3: false, hasRdm: false }],
			'SETUP-004 #1: tenant t1 must be found with hasL3 false',
		);
		assert.deepStrictEqual(
			await reader.scanTenants('dev.reltio.com'),
			[{ tenantId: 't1', hasL3: false, hasRdm: false }],
			'SETUP-004 #1: scanTenants must return t1',
		);

		// #2 shared tokenFile binding
		const wsRoot = vscode.Uri.file(path.resolve('/ws'));
		const identity = h => h;
		const entries = [
			{ host: 'hostA', tenantId: 't1', tokenFile: 'a1.json' },
			{ host: 'hostA', tenantId: 't2', tokenFile: 'a2.json' },
			{ host: 'hostC', tenantId: 't1', tokenFile: 'shared.json' },
			{ host: 'hostB', tenantId: 't1', tokenFile: 'shared.json' },
		];
		const conflicts = findConflictingTokenFiles(entries, identity, wsRoot);
		assert.deepStrictEqual([...conflicts.keys()], ['hostA'], 'SETUP-004 #2: only hostA must be reported as a conflict');
		assert.deepStrictEqual(
			conflicts.get('hostA'),
			[path.resolve('/ws', 'a1.json'), path.resolve('/ws', 'a2.json')],
			'SETUP-004 #2: conflict must list sorted distinct paths',
		);
		const bindings = indexTokenFilesByCanonicalPath(entries, identity, wsRoot);
		assert.strictEqual(bindings.length, 1, 'SETUP-004 #2: hostA must be omitted and hostB+hostC share one binding');
		assert.deepStrictEqual(bindings[0].hosts, ['hostB', 'hostC'], 'SETUP-004 #2: binding hosts must be sorted');

		let reads = 0;
		vscode.workspace.fs = { ...vscode.workspace.fs, readFile: async () => (reads++, Buffer.from('{"access_token":"shared-tok"}')) };
		const tokens = new TokenStore();
		const reload = await reloadTokenFileIntoStore(bindings[0], tokens);
		assert.ok(reload.ok, 'SETUP-004 #2: reload must succeed');
		assert.strictEqual(reads, 1, 'SETUP-004 #2: reload must read the token file once');
		assert.strictEqual(tokens.getToken('hostB'), 'shared-tok', 'SETUP-004 #2: reload must set the token on hostB');
		assert.strictEqual(tokens.getToken('hostC'), 'shared-tok', 'SETUP-004 #2: reload must set the token on hostC');
	}

	// =========================================================================
	// SETUP-005 Browser login flow: happy path and typed failures
	// =========================================================================
	{
		const creds = { clientId: 'cid', clientSecret: 'S3CRET' };

		// #1 happy path
		let tokenCalls = [];
		stubFetch(async (url, init) => {
			if (url.endsWith('/oauth/ssoCheck')) return jsonResponse({ status: 'sso' });
			if (url.endsWith('/oauth/token')) {
				tokenCalls.push(init);
				return jsonResponse({ access_token: 'acc', refresh_token: 'ref', expires_in: 600 });
			}
			throw new Error(`unexpected fetch ${url}`);
		});
		opened.length = 0;
		const login = runBrowserLogin(creds, 'sso-t');
		const authUrl = new URL(await waitForOpenExternal(opened, 'SETUP-005 #1: browser must be opened'));
		const state = authUrl.searchParams.get('state');
		const page = await httpGet(`${CALLBACK}/?code=C&state=${state}`);
		assert.strictEqual(page.status, 200, 'SETUP-005 #1: valid callback must get a 200 page');
		assert.ok(page.body.includes('Login Successful!'), 'SETUP-005 #1: valid callback must get the success page');
		const session = await withTimeout(login, 5000, 'SETUP-005 #1: runBrowserLogin did not settle');
		assert.strictEqual(session.accessToken, 'acc', 'SETUP-005 #1: session access token');
		assert.strictEqual(session.refreshToken, 'ref', 'SETUP-005 #1: session refresh token');
		assert.ok(session.expiresAt > Date.now(), 'SETUP-005 #1: expiresAt must be in the future');
		assert.strictEqual(tokenCalls.length, 1, 'SETUP-005 #1: exactly one token exchange');
		const exBody = new URLSearchParams(tokenCalls[0].body);
		assert.strictEqual(exBody.get('grant_type'), 'authorization_code', 'SETUP-005 #1: grant_type=authorization_code');
		assert.strictEqual(exBody.get('code'), 'C', 'SETUP-005 #1: exchange must send the callback code');
		assert.strictEqual(exBody.get('redirect_uri'), CALLBACK, 'SETUP-005 #1: exchange must send redirect_uri');

		// #2 refresh failure is typed and leaks nothing
		const basic = Buffer.from('cid:S3CRET').toString('base64');
		for (const status of [400, 401]) {
			stubFetch(async () => jsonResponse({ error: 'invalid_grant' }, status));
			const res = await settle(refreshTokens('old-refresh', creds));
			assert.ok(res.error instanceof OAuthLoginError, `SETUP-005 #2: HTTP ${status} refresh must throw OAuthLoginError`);
			assert.strictEqual(res.error.code, 'REFRESH_FAILED', `SETUP-005 #2: HTTP ${status} must use REFRESH_FAILED`);
			assert.strictEqual(res.error.message, `Token refresh failed: HTTP ${status}`, `SETUP-005 #2: HTTP ${status} message`);
			for (const leak of ['old-refresh', 'S3CRET', basic]) {
				assert.ok(!res.error.message.includes(leak), `SETUP-005 #2: refresh error must not contain ${leak === basic ? 'the Basic header' : leak}`);
			}
		}

		// #3 native tenant: no listener, no browser
		stubFetch(async () => jsonResponse({ status: 'native' }));
		opened.length = 0;
		let res = await settle(withTimeout(runBrowserLogin(creds, 'native-t'), 5000, 'SETUP-005 #3: runBrowserLogin did not settle'));
		assert.ok(res.error instanceof OAuthLoginError, 'SETUP-005 #3: native tenant must throw OAuthLoginError');
		assert.strictEqual(res.error.code, 'NO_IDP_CONFIGURED', 'SETUP-005 #3: native tenant must use NO_IDP_CONFIGURED');
		assert.ok(res.error.message.includes('native-t'), 'SETUP-005 #3: message must name the tenant');
		assert.strictEqual(opened.length, 0, 'SETUP-005 #3: browser must not be opened');
		assert.strictEqual(await portIsFree(), true, 'SETUP-005 #3: no listener may be left on port 8081');

		// #4 port busy, then exchange failure
		const blocker = net.createServer();
		await new Promise(r => blocker.listen(8081, 'localhost', r));
		stubFetch(async () => jsonResponse({ status: 'sso' }));
		opened.length = 0;
		res = await settle(withTimeout(runBrowserLogin(creds, 'sso-t'), 5000, 'SETUP-005 #4: runBrowserLogin did not settle'));
		await new Promise(r => blocker.close(r));
		assert.ok(res.error instanceof OAuthLoginError, 'SETUP-005 #4: busy port must throw OAuthLoginError');
		assert.strictEqual(res.error.code, 'PORT_BUSY', 'SETUP-005 #4: busy port must use PORT_BUSY');
		assert.ok(res.error.message.includes('8081'), 'SETUP-005 #4: PORT_BUSY must mention 8081');
		assert.strictEqual(opened.length, 0, 'SETUP-005 #4: browser must not be opened when the port is busy');

		stubFetch(async url => (url.endsWith('/oauth/ssoCheck') ? jsonResponse({ status: 'sso' }) : jsonResponse({}, 401)));
		opened.length = 0;
		const failing = settle(runBrowserLogin(creds, 'sso-t'));
		const failState = new URL(await waitForOpenExternal(opened, 'SETUP-005 #4: browser must be opened')).searchParams.get('state');
		await httpGet(`${CALLBACK}/?code=SECRETCODE&state=${failState}`);
		res = await withTimeout(failing, 5000, 'SETUP-005 #4: runBrowserLogin did not settle');
		assert.ok(res.error instanceof OAuthLoginError, 'SETUP-005 #4: failed exchange must throw OAuthLoginError');
		assert.strictEqual(res.error.code, 'EXCHANGE_FAILED', 'SETUP-005 #4: failed exchange must use EXCHANGE_FAILED');
		assert.strictEqual(res.error.message, 'Token exchange failed: HTTP 401', 'SETUP-005 #4: EXCHANGE_FAILED message');
		assert.ok(
			!res.error.message.includes('S3CRET') && !res.error.message.includes('SECRETCODE'),
			'SETUP-005 #4: no error message may include the client secret or code',
		);
	}

	// =========================================================================
	// SETUP-008 OAuth callback server: CSRF state check and HTML escaping
	// =========================================================================
	{
		const creds = { clientId: 'cid', clientSecret: 'csec' };

		// #1 wrong state
		let tokenCalls = 0;
		stubFetch(async url => {
			if (url.endsWith('/oauth/ssoCheck')) return jsonResponse({ status: 'sso' });
			tokenCalls++;
			return jsonResponse({ access_token: 'x', refresh_token: 'y' });
		});
		opened.length = 0;
		let login = settle(runBrowserLogin(creds, 'sso-t'));
		const state = new URL(await waitForOpenExternal(opened, 'SETUP-008 #1: browser must be opened')).searchParams.get('state');
		assert.ok(/^[0-9a-f]{32}$/.test(state), 'SETUP-008 #1: state must be 32 hex characters');
		const page = await httpGet(`${CALLBACK}/?code=C&state=WRONG`);
		assert.strictEqual(page.status, 400, 'SETUP-008 #1: wrong state must get HTTP 400');
		assert.ok(page.body.includes('<h1>Login failed</h1>'), 'SETUP-008 #1: wrong state must get the error page');
		let res = await withTimeout(login, 5000, 'SETUP-008 #1: runBrowserLogin did not settle');
		assert.ok(res.error instanceof OAuthLoginError, 'SETUP-008 #1: wrong state must reject with OAuthLoginError');
		assert.strictEqual(res.error.code, 'STATE_MISMATCH', 'SETUP-008 #1: wrong state must use STATE_MISMATCH');
		assert.strictEqual(tokenCalls, 0, 'SETUP-008 #1: no token exchange after a state mismatch');

		opened.length = 0;
		login = settle(runBrowserLogin(creds, 'sso-t'));
		const state2 = new URL(await waitForOpenExternal(opened, 'SETUP-008 #1: browser must be opened')).searchParams.get('state');
		assert.notStrictEqual(state2, state, 'SETUP-008 #1: state must be random per login');
		// Markup in the attacker-controlled query must never be reflected into the page.
		const evil = await httpGet(`${CALLBACK}/?code=${encodeURIComponent('<script>x</script>')}&state=${encodeURIComponent('<b>&')}`);
		assert.strictEqual(evil.status, 400, 'SETUP-008 #1: forged callback must get HTTP 400');
		assert.ok(!evil.body.includes('<script>') && !evil.body.includes('<b>'), 'SETUP-008 #2: callback markup must not be reflected unescaped');
		const body = evil.body.slice(evil.body.indexOf('<p>') + 3, evil.body.indexOf('</p>'));
		assert.ok(!/[<>]/.test(body), 'SETUP-008 #2: error message text must not contain raw < or >');
		await withTimeout(login, 5000, 'SETUP-008 #1: runBrowserLogin did not settle');

		// #2 no code
		opened.length = 0;
		login = settle(runBrowserLogin(creds, 'sso-t'));
		await waitForOpenExternal(opened, 'SETUP-008 #2: browser must be opened');
		const noCode = await httpGet(`${CALLBACK}/?state=x`);
		assert.strictEqual(noCode.status, 400, 'SETUP-008 #2: callback without code must get HTTP 400');
		assert.ok(noCode.body.includes('<title>Login failed</title>'), "SETUP-008 #2: callback without code must get the 'Login failed' page");
		res = await withTimeout(login, 5000, 'SETUP-008 #2: runBrowserLogin did not settle');
		assert.ok(res.error, 'SETUP-008 #2: login promise must reject when the callback has no code');
		assert.strictEqual(await portIsFree(), true, 'SETUP-008 #2: server must close after its single response');
	}

	global.fetch = realFetch;

	// =========================================================================
	// SETUP-007 Default environments: scaffolding, idempotency, token file and L3 outcomes
	// =========================================================================
	const originalGetConfiguration = vscode.workspace.getConfiguration;
	const setDefaultEnvironments = list => {
		vscode.workspace.getConfiguration = () => ({
			get: (key, fallback) => (key === 'defaultEnvironments' ? list : fallback),
			update: async () => {},
		});
	};

	/** EnvironmentManager fake whose scan reflects what it has created. */
	function makeEnvManagerFake() {
		const envs = new Map();
		const fake = {
			createdEnvs: [],
			createdTenants: [],
			async scanEnvironments() {
				return [...envs.entries()].map(([name, ts]) => ({ name, tenants: [...ts].map(tenantId => ({ tenantId, hasL3: false })) }));
			},
			async createEnvironment(host) {
				fake.createdEnvs.push(host);
				envs.set(host, envs.get(host) ?? new Set());
			},
			async createTenant(host, tenantId) {
				fake.createdTenants.push(`${host}/${tenantId}`);
				envs.get(host).add(tenantId);
			},
		};
		return fake;
	}

	function makeApplyDeps(overrides) {
		const tokenStore = new TokenStore();
		const setTokenCalls = [];
		const origSet = tokenStore.setToken.bind(tokenStore);
		tokenStore.setToken = (h, t) => {
			setTokenCalls.push([h, t]);
			origSet(h, t);
		};
		return {
			deps: {
				workspaceRoot: vscode.Uri.file(path.resolve('/ws')),
				environmentManager: makeEnvManagerFake(),
				tokenStore,
				normalizeEnvironmentName: h => h,
				onEnvironmentCreated: () => {},
				onTenantCreated: () => {},
				fetchL3: false,
				...overrides,
			},
			setTokenCalls,
		};
	}

	{
		// #1 scaffolding and idempotency
		setDefaultEnvironments([
			{ host: 'dev.reltio.com', tenantId: 't1' },
			{ host: 'dev.reltio.com', tenantId: 't2' },
		]);
		const { deps } = makeApplyDeps();
		const first = await applyDefaultEnvironments(deps);
		assert.deepStrictEqual(deps.environmentManager.createdEnvs, ['dev.reltio.com'], 'SETUP-007 #1: environment must be created once');
		assert.deepStrictEqual(
			deps.environmentManager.createdTenants,
			['dev.reltio.com/t1', 'dev.reltio.com/t2'],
			'SETUP-007 #1: both tenants must be created',
		);
		assert.strictEqual(first.scaffolded, 3, 'SETUP-007 #1: first run must scaffold 3 items');
		const second = await applyDefaultEnvironments(deps);
		assert.strictEqual(second.scaffolded, 0, 'SETUP-007 #1: second run must scaffold nothing');
		assert.strictEqual(deps.environmentManager.createdEnvs.length, 1, 'SETUP-007 #1: second run must not recreate the environment');
		const summary = summarizeApplyResult({ scaffolded: 3, authenticated: 1, fetched: 2, errors: ['e-one', 'e-two'] });
		assert.ok(
			summary.includes('scaffolded 3') && summary.includes('authenticated 1') && summary.includes('fetched L3 2'),
			'SETUP-007 #1: summary must list counts',
		);
		assert.ok(summary.includes('2 issue(s)') && summary.includes('e-one') && summary.includes('e-two'), 'SETUP-007 #1: summary must list issues');

		const badConfigs = [
			['empty list', [], 'is empty'],
			['only invalid entries', [{ host: '' }, { tenantId: 't' }, 'junk'], 'no valid entries'],
			['host with ..', [{ host: 'a..b', tenantId: 't1' }], 'Invalid host'],
		];
		for (const [label, list, expected] of badConfigs) {
			setDefaultEnvironments(list);
			const { deps: d } = makeApplyDeps();
			const r = await applyDefaultEnvironments(d);
			assert.ok(r.errors.some(e => e.includes(expected)), `SETUP-007 #1: ${label} must return an explanatory error`);
			assert.strictEqual(d.environmentManager.createdEnvs.length + d.environmentManager.createdTenants.length, 0, `SETUP-007 #1: ${label} must create nothing`);
		}

		// #2 token file loading
		const files = {
			'good.json': Buffer.from('{"access_token":" tok "}'),
			'notjson.json': Buffer.from('not json'),
			'array.json': Buffer.from('[]'),
			'empty.json': Buffer.from('{"access_token":""}'),
		};
		vscode.workspace.fs = {
			...vscode.workspace.fs,
			readFile: async uri => {
				const name = path.basename(uri.fsPath);
				if (!files[name]) throw new Error('ENOENT');
				return files[name];
			},
		};
		const root = path.resolve('/ws');
		assert.strictEqual(await readAccessTokenFromFile(vscode.Uri.file(path.join(root, 'good.json'))), 'tok', 'SETUP-007 #2: valid token file must return the trimmed token');
		const bad = [
			['missing.json', 'not found or unreadable'],
			['notjson.json', 'not valid JSON'],
			['array.json', 'missing string access_token'],
			['empty.json', 'missing string access_token'],
		];
		for (const [name, expected] of bad) {
			const out = await readAccessTokenFromFile(vscode.Uri.file(path.join(root, name)));
			assert.ok(out && typeof out.error === 'string' && out.error.includes(expected), `SETUP-007 #2: ${name} must return {error} '${expected}'`);
		}
		setDefaultEnvironments([
			{ host: 'h1', tenantId: 't1', tokenFile: 'good.json' },
			...bad.map(([name], i) => ({ host: `h${i + 2}`, tenantId: 't1', tokenFile: name })),
		]);
		const { deps: tokenDeps } = makeApplyDeps();
		const tokenResult = await applyDefaultEnvironments(tokenDeps);
		assert.strictEqual(tokenResult.authenticated, 1, 'SETUP-007 #2: only the valid token file must authenticate');
		assert.strictEqual(tokenDeps.tokenStore.getToken('h1'), 'tok', 'SETUP-007 #2: the trimmed token must be loaded');
		for (const [i, [, expected]] of bad.entries()) {
			assert.ok(
				tokenResult.errors.some(e => e.startsWith(`h${i + 2}:`) && e.includes(expected)),
				`SETUP-007 #2: token file error '${expected}' must be added to result.errors`,
			);
		}

		// #3 fetchL3 outcomes
		const outcome = { t1: 'written', t2: '401', t3: 'error' };
		setDefaultEnvironments(['t1', 't2', 't3'].map(t => ({ host: 'h1', tenantId: t, tokenFile: 'good.json' })));
		const { deps: l3Deps } = makeApplyDeps({ fetchL3: true, writeL3FromApi: async (_h, t) => outcome[t] });
		const l3Result = await applyDefaultEnvironments(l3Deps);
		assert.strictEqual(l3Result.fetched, 1, "SETUP-007 #3: 'written' must increment fetched");
		assert.ok(l3Result.errors.some(e => e.includes('h1/t2') && e.includes('token rejected (401)')), "SETUP-007 #3: '401' must add 'token rejected (401)'");
		assert.ok(l3Result.errors.some(e => e.includes('h1/t3') && e.includes('Fetch Configuration failed.')), "SETUP-007 #3: 'error' must add 'Fetch Configuration failed.'");
		assert.strictEqual(l3Result.authenticated, 1, 'SETUP-007 #3: fetch outcomes must not change authenticated');
	}

	// =========================================================================
	// SETUP-010 Default environments: path traversal guards and ignored inline secrets
	// =========================================================================
	{
		// #1 path segment and tokenFile guards
		for (const unsafe of ['', ' a', '.', '..', 'a..b', 'a/b', 'a\\b', 'a\0b']) {
			assert.strictEqual(isSafePathSegment(unsafe), false, `SETUP-010 #1: ${JSON.stringify(unsafe)} must be unsafe`);
		}
		assert.strictEqual(isSafePathSegment('361.reltio.com'), true, 'SETUP-010 #1: a valid host must be safe');
		const root = vscode.Uri.file(path.resolve('/ws'));
		// 'C:\x.json' is an absolute path only where the path module is Windows; on POSIX it is a plain relative name.
		const escapes = ['../x.json', 'a/../../x', '/etc/x', ''];
		if (process.platform === 'win32') escapes.push('C:\\x.json');
		for (const escape of escapes) {
			const r = resolveTokenFileUri(root, escape);
			assert.ok(typeof r.error === 'string', `SETUP-010 #1: tokenFile ${JSON.stringify(escape)} must return {error}`);
		}
		const ok = resolveTokenFileUri(root, 'secrets/t.json');
		assert.strictEqual(ok.canonicalFsPath, path.join(path.resolve('/ws'), 'secrets', 't.json'), 'SETUP-010 #1: secrets/t.json must resolve under the workspace root');

		// #2 inline secrets are ignored and only named
		assert.deepStrictEqual(
			entryHasIllicitSecretFields({ host: 'h', tenantId: 't', token: 'abc', clientSecret: 'x' }),
			['token', 'clientSecret'],
			'SETUP-010 #2: inline secret fields must be detected',
		);
		const settings = [
			{ host: 'dev.reltio.com', tenantId: 't1', token: 'abc', clientSecret: 'x' },
			{ host: 'dev.reltio.com', tenantId: 't2' },
		];
		setDefaultEnvironments(settings);
		const entries = readDefaultEnvironmentEntries();
		for (const e of entries) {
			assert.deepStrictEqual(Object.keys(e).sort(), ['host', 'tenantId', 'tokenFile'], 'SETUP-010 #2: entries must carry only host/tenantId/tokenFile');
		}
		const { deps, setTokenCalls } = makeApplyDeps();
		const result = await applyDefaultEnvironments(deps);
		assert.deepStrictEqual(deps.environmentManager.createdEnvs, ['dev.reltio.com'], 'SETUP-010 #2: environment must still be scaffolded');
		assert.deepStrictEqual(
			deps.environmentManager.createdTenants,
			['dev.reltio.com/t1', 'dev.reltio.com/t2'],
			'SETUP-010 #2: tenants must still be scaffolded',
		);
		assert.ok(!setTokenCalls.some(([, t]) => t === 'abc'), "SETUP-010 #2: setToken must never be called with the inline 'abc'");
		const secretErr = result.errors.find(e => e.includes('Ignored inline secret field(s)'));
		assert.ok(secretErr && secretErr.includes('token') && secretErr.includes('clientSecret'), 'SETUP-010 #2: errors must list the ignored field names');
		assert.ok(!result.errors.some(e => e.includes('abc') || /\bx\b/.test(e)), 'SETUP-010 #2: errors must not contain secret values');
	}
	vscode.workspace.getConfiguration = originalGetConfiguration;

	// =========================================================================
	// SETUP-012 Legacy suffixed environment folders still discovered and removed
	// =========================================================================
	{
		const mem = installMemoryFs();
		await mem.createDirectory('/ws/.reltio/dev.reltio.com.reltio.environment/t1.reltio.tenant');
		await mem.createDirectory('/ws/dev.reltio.com.reltio.environment/t1.reltio.tenant');
		await mem.createDirectory('/ws/dev.reltio.com.reltio.environment/rootonly.reltio.tenant');
		await mem.createDirectory('/ws/old.reltio.com.reltio.environment/t1.reltio.tenant');
		const deleted = [];
		const origDelete = mem.delete;
		mem.delete = async uri => {
			deleted.push(uri.fsPath.replace(/\\/g, '/'));
			return origDelete(uri);
		};

		const mgr = new EnvironmentManager(vscode.Uri.file('/ws'));
		const envs = await mgr.scanEnvironments();
		assert.deepStrictEqual(envs.map(e => e.name), ['dev.reltio.com', 'old.reltio.com'], 'SETUP-012 #1: each host must appear once');
		assert.deepStrictEqual(
			envs[0].tenants.map(t => t.tenantId),
			['t1'],
			'SETUP-012 #1: duplicated host must come from the preferred .reltio/ copy',
		);
		assert.deepStrictEqual(envs[1].tenants.map(t => t.tenantId), ['t1'], 'SETUP-012 #1: legacy-only host must list tenant t1');

		await mgr.removeTenant('dev.reltio.com', 't1');
		assert.strictEqual(mem._dirs.has('/ws/.reltio/dev.reltio.com.reltio.environment/t1.reltio.tenant'), false, 'SETUP-012 #1: removeTenant must delete the legacy suffixed directory');
		assert.ok(!deleted.some(p => p.endsWith('/t1')), 'SETUP-012 #1: removeTenant must not target a bare-named path');
		await mgr.removeTenant('old.reltio.com', 't1');
		assert.strictEqual(mem._dirs.has('/ws/old.reltio.com.reltio.environment/t1.reltio.tenant'), false, 'SETUP-012 #1: removeTenant must delete a legacy-only tenant directory');
		assert.strictEqual(mem._dirs.has('/ws/dev.reltio.com.reltio.environment/t1.reltio.tenant'), true, 'SETUP-012 #1: the non-preferred root copy must be left alone');
	}

	// =========================================================================
	// SETUP-006 / SETUP-009 Setup wizard and terms gate
	// =========================================================================
	const saved = {
		readFile: vscode.workspace.fs.readFile,
		showWarningMessage: vscode.window.showWarningMessage,
		showErrorMessage: vscode.window.showErrorMessage,
		showInformationMessage: vscode.window.showInformationMessage,
		showQuickPick: vscode.window.showQuickPick,
		showInputBox: vscode.window.showInputBox,
		createQuickPick: vscode.window.createQuickPick,
		createWebviewPanel: vscode.window.createWebviewPanel,
		showTextDocument: vscode.window.showTextDocument,
		runBrowserLogin: oauthLogin.runBrowserLogin,
	};
	installMemoryFs();

	function makeTermsContext(initial) {
		return { extensionUri: vscode.Uri.file('/ext'), globalState: makeMemento(initial), workspaceState: makeMemento(), subscriptions: [] };
	}

	{
		// SETUP-006 #1 terms gate
		vscode.workspace.fs.readFile = async () => Buffer.from('Terms text');
		vscode.window.showErrorMessage = async () => undefined;
		vscode.window.showWarningMessage = async () => 'Accept';
		let ctx = makeTermsContext();
		assert.strictEqual(await ensureTermsAccepted(ctx), true, 'SETUP-006 #1: Accept must return true');
		assert.strictEqual(ctx.globalState.map.get(ACCEPTED_VERSION_KEY), TERMS_VERSION, 'SETUP-006 #1: Accept must store TERMS_VERSION');

		const refusals = [
			['decline', async () => 'Decline', async () => Buffer.from('Terms text')],
			['dismiss', async () => undefined, async () => Buffer.from('Terms text')],
			['unreadable', async () => 'Accept', async () => {
				throw new Error('ENOENT');
			}],
			['blank', async () => 'Accept', async () => Buffer.from('  \n ')],
		];
		for (const [label, warn, read] of refusals) {
			vscode.window.showWarningMessage = warn;
			vscode.workspace.fs.readFile = read;
			ctx = makeTermsContext();
			assert.strictEqual(await ensureTermsAccepted(ctx), false, `SETUP-006 #1: ${label} must return false`);
			assert.strictEqual(ctx.globalState.map.size, 0, `SETUP-006 #1: ${label} must persist no state`);
		}

		let prompts = 0;
		vscode.workspace.fs.readFile = async () => Buffer.from('Terms text');
		vscode.window.showWarningMessage = async () => (prompts++, 'Accept');
		ctx = makeTermsContext({ [ACCEPTED_VERSION_KEY]: TERMS_VERSION });
		assert.strictEqual(await ensureTermsAccepted(ctx), true, 'SETUP-006 #1: already accepted must return true');
		assert.strictEqual(prompts, 0, 'SETUP-006 #1: already accepted must show no modal');
		await resetTermsAcceptance(ctx);
		await ensureTermsAccepted(ctx);
		assert.strictEqual(prompts, 1, 'SETUP-006 #1: reset must re-prompt');
		ctx = makeTermsContext({ [ACCEPTED_VERSION_KEY]: '0' });
		await ensureTermsAccepted(ctx);
		assert.strictEqual(prompts, 2, 'SETUP-006 #1: an older stored version must prompt');
	}

	const HOST = 'dev.reltio.com';

	/**
	 * Drives launchSetupWizard with scripted answers. `steps[n]` is a queue of answers for the
	 * quick pick of step n (2, 4, 5); an exhausted queue answers undefined (cancel).
	 */
	async function runWizard({ steps, inputBox = [], login, autoAdd, presaveCreds = false, ssoTenantId, terms = TERMS_VERSION }) {
		const secrets = makeSecrets();
		const context = {
			extensionUri: vscode.Uri.file('/ext'),
			globalState: makeMemento(terms ? { [ACCEPTED_VERSION_KEY]: terms } : {}),
			workspaceState: makeMemento(),
			subscriptions: [],
		};
		const tokenStore = new TokenStore();
		const sessionStore = new SessionStore(secrets, context.globalState);
		const oauthCredentialsStore = new OAuthCredentialsStore(secrets);
		if (presaveCreds) await oauthCredentialsStore.saveClientCredentials(HOST, { clientId: 'cid', clientSecret: 'csec' });
		if (ssoTenantId) await oauthCredentialsStore.saveSsoTenantId(HOST, ssoTenantId);

		const log = { calls: [], errors: [], infos: [], stepShown: { 2: 0, 4: 0, 5: 0 }, configUpdates: [], storeUse: [] };
		const spy = (name, obj) => {
			for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(obj))) {
				if (key === 'constructor') continue;
				const orig = obj[key].bind(obj);
				obj[key] = (...args) => {
					log.storeUse.push(`${name}.${key}`);
					log.calls.push([`${name}.${key}`, args]);
					return orig(...args);
				};
			}
		};
		spy('tokenStore', tokenStore);
		spy('sessionStore', sessionStore);
		spy('oauthCredentialsStore', oauthCredentialsStore);
		log.storeUse.length = 0;
		log.calls.length = 0;

		const environmentManager = {
			createdEnvs: [],
			createdTenants: [],
			async createEnvironment(h) {
				environmentManager.createdEnvs.push(h);
			},
			async createTenant(h, t) {
				environmentManager.createdTenants.push(`${h}/${t}`);
			},
			getL3Uri: () => vscode.Uri.file('/ws/dev/t1/L3.reltio.json'),
		};

		const queues = { 2: [...(steps[2] ?? [])], 4: [...(steps[4] ?? [])], 5: [...(steps[5] ?? [])] };
		vscode.window.showQuickPick = async (items, opts) => {
			const n = Number(/\((\d) of/.exec(opts.title)[1]);
			log.stepShown[n]++;
			const want = queues[n].shift();
			if (want === undefined) return undefined;
			return items.find(i => i.value === want);
		};
		const inputs = [...inputBox];
		vscode.window.showInputBox = async () => {
			log.calls.push(['showInputBox']);
			return inputs.shift();
		};
		vscode.window.createQuickPick = () => {
			log.calls.push(['createQuickPick']);
			const qp = {
				items: [],
				selectedItems: [],
				value: '',
				onDidChangeValue() {},
				onDidAccept(cb) {
					qp.accept = cb;
				},
				onDidHide(cb) {
					qp.hide = cb;
				},
				show() {
					qp.value = HOST;
					qp.selectedItems = [{ value: HOST }];
					setImmediate(() => qp.accept());
				},
				dispose() {},
			};
			return qp;
		};
		vscode.window.showErrorMessage = async (msg, ...rest) => {
			log.errors.push({ msg, modal: Boolean(rest[0] && rest[0].modal) });
			return undefined;
		};
		vscode.window.showInformationMessage = async msg => {
			log.infos.push(msg);
			return undefined;
		};
		vscode.window.showWarningMessage = async () => 'Decline';
		vscode.window.showTextDocument = async () => {};
		vscode.workspace.getConfiguration = () => ({
			get: (_k, fallback) => fallback,
			update: async (...args) => log.configUpdates.push(args),
		});
		vscode.workspace.fs.readFile = async () => Buffer.from('Terms text');
		const fetchCalls = stubFetch(async url => {
			if (url.endsWith('/reltio/status')) return new Response('ok', { status: 200 });
			if (url.includes('/reltio/enhancedTenants')) return jsonResponse([{ tenantId: 't1', tenantName: 'T1', customerName: 'C' }]);
			throw new Error(`unexpected fetch ${url}`);
		});
		oauthLogin.runBrowserLogin = login ?? (async () => {
			throw new Error('runBrowserLogin not scripted');
		});

		await withTimeout(
			launchSetupWizard({
				context,
				environmentManager,
				tokenStore,
				sessionStore,
				oauthCredentialsStore,
				uxBus: { fire() {} },
				normalizeEnvironmentName: h => h,
				writeL3FromApi: async () => 'written',
				autoAddSsoTenant: autoAdd ?? (async () => undefined),
			}),
			10_000,
			'launchSetupWizard did not settle',
		);
		return { log, secrets, context, tokenStore, environmentManager, fetchCalls };
	}

	{
		// SETUP-006 #2 failed browser login cleans up credentials and goes back a step
		const failures = [
			['NO_IDP_CONFIGURED', new OAuthLoginError('Tenant "sso-t" has no external identity provider configured.', 'NO_IDP_CONFIGURED'), true, 'Paste a Bearer token'],
			['SSO_CHECK_FAILED', new OAuthLoginError('SSO check failed: HTTP 500', 'SSO_CHECK_FAILED'), true, 'Could not check SSO configuration'],
			['generic Error', new Error('boom'), false, 'Login failed: boom'],
		];
		for (const [label, err, modal, text] of failures) {
			const { log, secrets } = await runWizard({
				steps: { 2: ['browser'] },
				presaveCreds: true,
				ssoTenantId: 'sso-t',
				login: async () => {
					throw err;
				},
			});
			assert.ok(
				![...secrets.map.keys()].some(k => k.startsWith(`reltio.oauth.${HOST}.`)),
				`SETUP-006 #2: ${label} must delete the env's client credentials and SSO tenant id`,
			);
			assert.strictEqual(log.errors.length, 1, `SETUP-006 #2: ${label} must show one error`);
			assert.ok(log.errors[0].msg.includes(text), `SETUP-006 #2: ${label} must show a code-specific message`);
			assert.strictEqual(log.errors[0].modal, modal, `SETUP-006 #2: ${label} modal must be ${modal}`);
			assert.strictEqual(log.stepShown[2], 2, `SETUP-006 #2: ${label} must go back to step 2`);
		}

		// SETUP-006 #3 navigation
		let run = await runWizard({ steps: { 2: [] } });
		assert.strictEqual(run.log.stepShown[2], 1, 'SETUP-006 #3: step 2 must be shown');
		assert.deepStrictEqual(run.environmentManager.createdEnvs, [], 'SETUP-006 #3: cancel at step 2 must create no environment');

		run = await runWizard({ steps: { 2: ['token'], 4: [null, null], 5: ['back', 'finish'] }, inputBox: ['tok'] });
		assert.strictEqual(run.log.stepShown[4], 2, "SETUP-006 #3: 'Go back and modify inputs' must re-run step 4");
		assert.strictEqual(run.log.stepShown[5], 2, 'SETUP-006 #3: step 5 must be shown again after going back');
		assert.deepStrictEqual(run.environmentManager.createdEnvs, [HOST], 'SETUP-006 #3: skip must finish with the environment');
		assert.deepStrictEqual(run.environmentManager.createdTenants, [], 'SETUP-006 #3: skip must create no tenant');
		assert.ok(run.log.infos.some(m => m.includes('Add Tenant')), 'SETUP-006 #3: skip must show the Add Tenant hint');

		run = await runWizard({
			steps: { 2: ['token'], 5: ['finish'] },
			inputBox: ['tok'],
			ssoTenantId: 'sso-t',
			autoAdd: async () => 't-auto',
		});
		assert.strictEqual(run.log.stepShown[4], 0, 'SETUP-006 #3: auto-added tenant must skip the step 4 picker');
		assert.ok(!run.fetchCalls.some(c => c.url.includes('/reltio/enhancedTenants')), 'SETUP-006 #3: auto-added tenant must not list tenants');
		assert.deepStrictEqual(run.environmentManager.createdTenants, [], 'SETUP-006 #3: auto-added tenant must not be recreated');
		assert.deepStrictEqual(
			run.context.globalState.map.get('reltio.recentTenants'),
			{ [HOST]: ['t-auto'] },
			'SETUP-006 #3: auto-added tenant must still be recorded as recent',
		);
	}

	{
		// SETUP-009 #1 declined terms stop the wizard before any step
		const run = await runWizard({ steps: { 2: ['token'] }, terms: null });
		assert.ok(!run.log.calls.some(([n]) => n === 'createQuickPick' || n === 'showInputBox'), 'SETUP-009 #1: no wizard step may be shown after Decline');
		assert.strictEqual(run.log.stepShown[2], 0, 'SETUP-009 #1: step 2 must not be shown after Decline');
		assert.deepStrictEqual(run.environmentManager.createdEnvs, [], 'SETUP-009 #1: Decline must create no environment');
		assert.deepStrictEqual(run.log.storeUse, [], 'SETUP-009 #1: Decline must not touch token, session or credential stores');

		// SETUP-009 #2 browser session: only the refresh token is persisted
		const browser = await runWizard({
			steps: { 2: ['browser'], 4: [null], 5: ['finish'] },
			presaveCreds: true,
			ssoTenantId: 'sso-t',
			login: async () => ({ accessToken: 'A', refreshToken: 'R', expiresAt: Date.now() + 1000 }),
		});
		const setSession = browser.log.calls.find(([n]) => n === 'tokenStore.setSession');
		assert.ok(setSession, 'SETUP-009 #2: setSession must be called');
		assert.strictEqual(setSession[1][1].accessToken, 'A', 'SETUP-009 #2: setSession must get the access token');
		assert.strictEqual(setSession[1][1].refreshToken, 'R', 'SETUP-009 #2: setSession must get the refresh token');
		assert.strictEqual(browser.secrets.map.get(`reltio.refreshToken.${HOST}`), 'R', 'SETUP-009 #2: refresh token must be saved to secrets');
		assert.ok(![...browser.secrets.map.values()].includes('A'), 'SETUP-009 #2: access token must not be in secrets');
		for (const memento of [browser.context.globalState, browser.context.workspaceState]) {
			for (const [k, v] of memento.map) {
				assert.ok(!JSON.stringify(v).includes('"A"'), `SETUP-009 #2: access token must not be in Memento key ${k}`);
			}
		}
		assert.ok(!browser.log.configUpdates.some(args => JSON.stringify(args).includes('"A"')), 'SETUP-009 #2: access token must not be written to config');

		const token = await runWizard({ steps: { 2: ['token'], 4: [null], 5: ['finish'] }, inputBox: ['A'] });
		const names = token.log.calls.map(([n]) => n);
		assert.ok(names.includes('tokenStore.setToken'), 'SETUP-009 #2: paste-token path must call setToken');
		assert.ok(!names.includes('tokenStore.setSession'), 'SETUP-009 #2: paste-token path must not call setSession');
		assert.ok(!names.includes('sessionStore.saveRefreshToken'), 'SETUP-009 #2: paste-token path must not persist anything');
		assert.ok(![...token.secrets.map.values()].includes('A'), 'SETUP-009 #2: pasted token must not be in secrets');
	}

	global.fetch = realFetch;
	oauthLogin.runBrowserLogin = saved.runBrowserLogin;

	{
		// SETUP-009 #3 setup guide webview lockdown
		const created = [];
		let reveals = 0;
		let disposeListener;
		vscode.window.createWebviewPanel = (viewType, title, column, options) => {
			const panel = {
				options,
				webview: { html: '', asWebviewUri: u => u, cspSource: 'vscode-resource:' },
				reveal: () => reveals++,
				onDidDispose: cb => {
					disposeListener = cb;
					return { dispose() {} };
				},
			};
			created.push(panel);
			return panel;
		};
		const ctx = { extensionUri: vscode.Uri.file('/ext'), subscriptions: [] };
		vscode.workspace.fs.readFile = async () => {
			throw new Error('<img src=x onerror=alert(1)>');
		};
		openSetupGuidePanel(ctx);
		openSetupGuidePanel(ctx);
		await new Promise(r => setImmediate(r));
		assert.strictEqual(created.length, 1, 'SETUP-009 #3: only one Setup Guide panel may be created');
		assert.strictEqual(reveals, 1, 'SETUP-009 #3: the second call must reveal the existing panel');
		const opts = created[0].options;
		assert.strictEqual(opts.enableScripts, false, 'SETUP-009 #3: Setup Guide must have enableScripts false');
		assert.strictEqual(opts.localResourceRoots.length, 2, 'SETUP-009 #3: localResourceRoots must be limited');
		for (const r of opts.localResourceRoots) {
			assert.ok(r.fsPath.replace(/\\/g, '/').startsWith('/ext/'), 'SETUP-009 #3: localResourceRoots must stay inside the extension');
		}
		const html = created[0].webview.html;
		assert.ok(html.includes('Could not load Setup Guide'), "SETUP-009 #3: read failure must show 'Could not load Setup Guide'");
		assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;') && !html.includes('<img'), 'SETUP-009 #3: error text must be escaped');

		disposeListener();
		vscode.workspace.fs.readFile = async () => Buffer.from('{ not json');
		openSetupGuidePanel(ctx);
		await new Promise(r => setImmediate(r));
		assert.strictEqual(created.length, 2, 'SETUP-009 #3: a disposed panel must be recreated');
		assert.ok(created[1].webview.html.includes('Could not load Setup Guide'), 'SETUP-009 #3: invalid JSON must show the error page');
	}

	Object.assign(vscode.window, {
		showWarningMessage: saved.showWarningMessage,
		showErrorMessage: saved.showErrorMessage,
		showInformationMessage: saved.showInformationMessage,
		showQuickPick: saved.showQuickPick,
		showInputBox: saved.showInputBox,
		createQuickPick: saved.createQuickPick,
		createWebviewPanel: saved.createWebviewPanel,
		showTextDocument: saved.showTextDocument,
	});
	vscode.workspace.getConfiguration = originalGetConfiguration;
	vscode.env.openExternal = originalOpenExternal;

	console.log('test-setup-auth: OK');
})().catch(err => {
	console.error(err);
	process.exit(1);
});
