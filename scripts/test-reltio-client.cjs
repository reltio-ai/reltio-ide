#!/usr/bin/env node
'use strict';
/**
 * Regression area: Common Utils
 *
 * Tier A: `src/api/reltioClient.ts` against a stubbed `fetch`.
 *   UTIL-008  response validation, HTTP status mapping, put-configuration error formatting and
 *             the countEntities POST-to-GET fallback.
 *   UTIL-012  fetchWithTimeout timeouts and network errors, bounded readResponseText, and the
 *             truncated error body on verifyMatches.
 * (UTIL-010 URL hardening extends test-harden-reltio-client-base-url.cjs.)
 * Tier C: none.
 */
const assert = require('assert');
const { importDist } = require('./lib/import-dist.cjs');

const client = importDist('api/reltioClient');
const { ReltioApiError } = client;

const HOST = 'test.reltio.com';

/** Install a fake `fetch` answering each call in turn from `responders`, capture the calls, restore afterwards. */
async function withFetch(responders, fn) {
	const list = Array.isArray(responders) ? responders : [responders];
	const original = globalThis.fetch;
	const calls = [];
	globalThis.fetch = async (url, init) => {
		calls.push({ url: String(url), init });
		const r = list[Math.min(calls.length - 1, list.length - 1)];
		return r(String(url), init);
	};
	try {
		return { result: await fn(), calls };
	} finally {
		globalThis.fetch = original;
	}
}

const json = (status, body) => () => ({
	status,
	ok: status >= 200 && status < 300,
	json: async () => body,
	text: async () => JSON.stringify(body),
});
const text = (status, body) => () => ({
	status,
	ok: status >= 200 && status < 300,
	json: async () => JSON.parse(body),
	text: async () => body,
});

/** The error `fn` rejected with, or undefined when it resolved; lets every message start with the row ID. */
async function rejection(fn) {
	try {
		await fn();
	} catch (e) {
		return e;
	}
	return undefined;
}

/** Asserts `fn` rejects with an error whose message matches `pattern`. */
async function rejectsMatching(fn, pattern, label) {
	const e = await rejection(fn);
	assert.ok(e, `${label}: expected a rejection`);
	assert.ok(pattern instanceof RegExp ? pattern.test(e.message) : e.message === pattern, `${label}: got ${JSON.stringify(e.message)}`);
	return e;
}

/** Asserts `fn` rejects with a ReltioApiError whose message and status match. */
async function rejectsWith(fn, message, statusCode, label) {
	const e = await rejection(fn);
	assert.ok(e instanceof ReltioApiError, `${label}: expected ReltioApiError, got ${e && e.name}: ${e && e.message}`);
	if (message instanceof RegExp) assert.ok(message.test(e.message), `${label}: message ${JSON.stringify(e.message)} does not match ${message}`);
	else assert.strictEqual(e.message, message, `${label}: message`);
	assert.strictEqual(e.statusCode, statusCode, `${label}: statusCode`);
}

// ── UTIL-008 ────────────────────────────────────────────────────────────────
async function testResponseValidation() {
	// 1. Shape validation on 200 responses.
	const lt = body => withFetch(json(200, body), () => client.listTenants(HOST, 'tok'));
	await rejectsWith(() => lt({ tenants: [] }), 'List enhanced tenants: expected JSON array', 200, 'UTIL-008 #1: listTenants object body');
	await rejectsWith(() => lt([null]), 'List enhanced tenants: invalid row shape', 200, 'UTIL-008 #1: listTenants null row');
	await rejectsWith(() => lt([{ tenantName: 'x' }]), 'List enhanced tenants: row missing tenantId', 200, 'UTIL-008 #1: listTenants row missing tenantId');

	const hist = body => withFetch(json(200, body), () => client.fetchConfigurationHistory(HOST, 't', 'tok', 0, 10));
	const row = over => ({ updatedBy: 'u', timestamp: '2026-01-01', configuration: {}, ...over });
	const without = key => { const r = row(); delete r[key]; return r; };
	await rejectsWith(() => hist({ rows: [] }), 'Configuration history: expected JSON array', 200, 'UTIL-008 #1: history object body');
	await rejectsWith(() => hist([null]), 'Configuration history: invalid row shape', 200, 'UTIL-008 #1: history null row');
	await rejectsWith(() => hist([without('updatedBy')]), 'Configuration history: row missing updatedBy', 200, 'UTIL-008 #1: history row missing updatedBy');
	await rejectsWith(() => hist([without('timestamp')]), 'Configuration history: row missing timestamp', 200, 'UTIL-008 #1: history row missing timestamp');
	await rejectsWith(() => hist([without('configuration')]), 'Configuration history: row missing configuration', 200, 'UTIL-008 #1: history row missing configuration');
	const { result } = await hist([row({ updatedBy: 'a', timestamp: 1700000000000 }), row({ updatedBy: 'b' })]);
	assert.deepStrictEqual(
		result.map(r => [r.updatedBy, r.timestamp]),
		[['a', '1700000000000'], ['b', '2026-01-01']],
		'UTIL-008 #1: numeric timestamp stringified, valid rows kept in order',
	);

	// 2. Status mapping, and the tenant id is encoded into the URL.
	const tenant = 'a/b c';
	const body = { first: 'x', second: 'y', matchGroups: [] };
	const ops = [
		['fetchL3Configuration', () => client.fetchL3Configuration(HOST, tenant, 'tok'), n => `Fetch L3 failed: HTTP ${n}`],
		['putL3Configuration', () => client.putL3Configuration(HOST, tenant, 'tok', '{}'), n => `Put configuration failed (HTTP ${n}).`],
		['searchEntities', () => client.searchEntities(HOST, tenant, 'tok', { filter: 'f', max: 1, offset: 0 }), n => `Search entities failed: HTTP ${n}`],
		['countEntities', () => client.countEntities(HOST, tenant, 'tok', 'f'), n => `Count entities failed: HTTP ${n}`],
		['verifyMatches', () => client.verifyMatches(HOST, tenant, 'tok', body), n => `Verify matches failed: HTTP ${n}`],
	];
	for (const [name, call, failed] of ops) {
		for (const status of [401, 403, 500]) {
			await rejectsWith(
				() => withFetch(text(status, ''), call),
				status === 401 ? 'Unauthorized (401)' : failed(status),
				status,
				`UTIL-008 #2: ${name} HTTP ${status}`,
			);
		}
		const { calls } = await withFetch(text(401, ''), () => call().catch(() => undefined));
		assert.ok(calls[0].url.includes('/reltio/api/a%2Fb%20c/'), `UTIL-008 #2: ${name} URL contains a%2Fb%20c (${calls[0].url})`);
	}

	// 3. putL3Configuration error formatting.
	const put = bodyText => () => withFetch(text(400, bodyText), () => client.putL3Configuration(HOST, 't', 'tok', '{}'));
	const putMessage = async bodyText => {
		try {
			await put(bodyText)();
		} catch (e) {
			assert.ok(e instanceof ReltioApiError && e.statusCode === 400, 'UTIL-008 #3: put failure is a ReltioApiError with HTTP 400');
			return e.message;
		}
		assert.fail('UTIL-008 #3: putL3Configuration must reject on HTTP 400');
	};
	{
		const m = await putMessage(JSON.stringify({ severity: 'Error', errorMessage: 'Bad attribute', errorCode: 123, errorDetailMessage: 'Detail here' }));
		assert.ok(m.startsWith('Reltio did not apply this configuration (HTTP 400, error code 123).'), `UTIL-008 #3: intro has HTTP status and code: ${m}`);
		for (const part of ['Severity: Error', 'Bad attribute', 'Detail here']) assert.ok(m.includes(part), `UTIL-008 #3: message includes ${part}`);
	}
	{
		const m = await putMessage(JSON.stringify({ errorMessage: 'Same text', errorDetailMessage: 'Same text', errorCode: 5 }));
		assert.strictEqual(m.split('Same text').length - 1, 1, `UTIL-008 #3: a detail equal to the message is omitted: ${m}`);
	}
	{
		const m = await putMessage(JSON.stringify({ errorCode: 77 }));
		assert.ok(m.includes('error code 77') && m.includes('See Reltio documentation for error code 77.'), `UTIL-008 #3: code-only adds a documentation hint: ${m}`);
	}
	assert.strictEqual(await putMessage('plain failure text'), 'plain failure text', 'UTIL-008 #3: plain text is shown as-is');
	assert.strictEqual(await putMessage(''), 'Put configuration failed (HTTP 400).', 'UTIL-008 #3: empty body');
	assert.strictEqual(await putMessage('{not json'), '{not json', "UTIL-008 #3: invalid JSON starting with '{' falls back to raw text");

	// 4. countEntities POST 405 then GET.
	for (const [bodyText, want] of [['42', 42], ['{"total":7}', 7], ['{"total":"9"}', 9], ['5', 5]]) {
		const { result: n, calls } = await withFetch([text(405, ''), text(200, bodyText)], () => client.countEntities(HOST, 't', 'tok', 'f'));
		assert.strictEqual(n, want, `UTIL-008 #4: GET fallback body ${bodyText} returns ${want}`);
		assert.deepStrictEqual(calls.map(c => c.init.method), ['POST', 'GET'], 'UTIL-008 #4: POST then GET');
	}
	await rejectsWith(
		() => withFetch([text(405, ''), text(200, '{"x":1}')], () => client.countEntities(HOST, 't', 'tok', 'f')),
		/unexpected response shape/,
		200,
		'UTIL-008 #4: unexpected shape',
	);
	await rejectsWith(
		() => withFetch([text(405, ''), text(401, '')], () => client.countEntities(HOST, 't', 'tok', 'f')),
		'Unauthorized (401)',
		401,
		'UTIL-008 #4: 401 after fallback',
	);
}

// ── UTIL-012 ────────────────────────────────────────────────────────────────
/** Records every timer handle created and cleared while `fn` runs. */
async function trackTimers(fn) {
	const realSet = globalThis.setTimeout;
	const realClear = globalThis.clearTimeout;
	const created = [];
	const cleared = new Set();
	globalThis.setTimeout = (...args) => { const h = realSet(...args); created.push(h); return h; };
	globalThis.clearTimeout = h => { cleared.add(h); return realClear(h); };
	try {
		await fn();
	} finally {
		globalThis.setTimeout = realSet;
		globalThis.clearTimeout = realClear;
	}
	return { created, cleared };
}

async function testReliability() {
	const url = 'https://test.reltio.com/reltio/status';
	const original = globalThis.fetch;
	try {
		// 1a. A request that never answers times out.
		globalThis.fetch = (_u, init) => new Promise((_, reject) => {
			init.signal.addEventListener('abort', () => {
				const e = new Error('aborted');
				e.name = 'AbortError';
				reject(e);
			});
		});
		let t = await trackTimers(() => rejectsMatching(
			() => client.fetchWithTimeout(url, { method: 'GET' }, 20),
			`Request timed out after 20ms: ${url}`,
			'UTIL-012 #1: a hang gives "Request timed out after 20ms: <url>"',
		));
		assert.ok(t.created.length >= 1 && t.created.every(h => t.cleared.has(h)), 'UTIL-012 #1: the timer is cleared after a timeout');

		// 1b. A network failure carries its cause.
		globalThis.fetch = async () => {
			const e = new TypeError('fetch failed');
			e.cause = { message: 'ECONNREFUSED' };
			throw e;
		};
		t = await trackTimers(() => rejectsMatching(
			() => client.fetchWithTimeout(url, { method: 'GET' }, 1000),
			'Network error: fetch failed (ECONNREFUSED)',
			'UTIL-012 #1: network failure gives "Network error: fetch failed (ECONNREFUSED)"',
		));
		assert.ok(t.created.length >= 1 && t.created.every(h => t.cleared.has(h)), 'UTIL-012 #1: the timer is cleared after a network error');
	} finally {
		globalThis.fetch = original;
	}

	// 2. Bounded body reads.
	const headers = h => ({ get: k => h[k] ?? h[k.toLowerCase()] ?? null });
	const streamOf = chunks => {
		const state = { cancelled: false };
		const reader = {
			read: async () => (chunks.length ? { done: false, value: chunks.shift() } : { done: true, value: undefined }),
			cancel: async () => { state.cancelled = true; },
		};
		return { body: { getReader: () => reader }, state };
	};
	await rejectsMatching(
		() => client.readResponseText({ headers: headers({ 'Content-Length': '100' }), text: async () => 'x' }, 1000, 10),
		/too large/,
		'UTIL-012 #2: a Content-Length above the limit is too large',
	);
	{
		const s = streamOf([Buffer.alloc(8, 120), Buffer.alloc(8, 120)]);
		await rejectsMatching(() => client.readResponseText({ headers: headers({}), body: s.body }, 1000, 10), /too large/, 'UTIL-012 #2: a stream over maxBytes is too large');
		assert.ok(s.state.cancelled, 'UTIL-012 #2: the oversized stream is cancelled');
	}
	{
		const state = { cancelled: false };
		const reader = { read: () => new Promise(() => {}), cancel: async () => { state.cancelled = true; } };
		await rejectsMatching(
			() => client.readResponseText({ headers: headers({}), body: { getReader: () => reader } }, 20, 1000),
			/Reading the response timed out/,
			'UTIL-012 #2: a stalled reader gives "Reading the response timed out"',
		);
		assert.ok(state.cancelled, 'UTIL-012 #2: the stalled reader is cancelled');
	}
	await rejectsMatching(
		() => client.readResponseText({ headers: headers({}), body: {}, text: async () => 'x'.repeat(50) }, 1000, 10),
		/too large/,
		'UTIL-012 #2: a body without getReader over the limit is too large',
	);
	{
		const s = streamOf([Buffer.from('héllo ', 'utf8'), Buffer.from('✓', 'utf8')]);
		assert.strictEqual(await client.readResponseText({ headers: headers({}), body: s.body }, 1000, 1000), 'héllo ✓', 'UTIL-012 #2: a small body is returned as UTF-8');
	}

	// 3. verifyMatches error bodies are truncated; 401 carries none.
	const body = { first: 'x', second: 'y', matchGroups: [] };
	{
		const e = await rejectsMatching(
			() => withFetch(text(500, 'e'.repeat(50_000)), () => client.verifyMatches(HOST, 't', 'tok', body)),
			'Verify matches failed: HTTP 500',
			'UTIL-012 #3: message',
		);
		assert.ok(typeof e.responseBody === 'string' && e.responseBody.length > 0 && e.responseBody.length <= 12_000, `UTIL-012 #3: responseBody length ${e.responseBody && e.responseBody.length} must be <= 12,000`);
	}
	{
		const e = await rejectsMatching(
			() => withFetch(text(401, 'secret body'), () => client.verifyMatches(HOST, 't', 'tok', body)),
			'Unauthorized (401)',
			'UTIL-012 #3: 401 gives Unauthorized',
		);
		assert.strictEqual(e.responseBody, undefined, 'UTIL-012 #3: 401 carries no body');
	}
}

(async () => {
	client.setTrustedHostSuffixes(['reltio.com']);
	await testResponseValidation();
	await testReliability();
	console.log('test-reltio-client: OK');
})().catch(e => {
	console.error(e);
	process.exit(1);
});
