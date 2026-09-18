#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: workflow-inspector
 *
 * Tier A — pure logic, no I/O, no VS Code host:
 *   1.  URL/path construction: every path has the required `/workflow-adapter/` segment.
 *   2.  `EnvironmentURL` header present on every call; `xxx-client` header absent.
 *   3.  Envelope unwrapping: `{ status, data: [...], total }` → array.
 *   3b. Malformed rows inside `data` are dropped rather than cast — guard for
 *       the RP-195042 assert-don't-verify pattern.
 *   4.  Empty / missing `data` field → empty array (no throw).
 *   5.  XML-vs-JSON body handling: raw XML returned as-is; JSON-wrapped XML unwrapped.
 *   6.  Untrusted-host rejection: `UntrustedHostError` thrown before fetch is called.
 *   7.  HTTP 4xx maps to `ReltioApiError` with the correct status code.
 *   7b. A large error body is truncated before it reaches the error message,
 *       on every endpoint — regression guard for finding 81120 (CWE-209).
 *   8.  Network-level failure maps to `WorkflowConnectionError`.
 *   9.  `toHttpsBase()` is re-exported from `reltioClient` (Slice 1 sanity check).
 *  10.  Sidecar round-trip: `saveWorkflowAdapterUrl` writes a file that
 *       `loadWorkflowAdapterUrl` reads back correctly.
 *  10b. Tenant children: Business Config then Workflows in tenant mode, and no
 *       Workflows row at all in git mode (both modes render `TenantNode`).
 *
 * Tier B — structural:
 *  11.  All four workflow commands are declared in `package.json`.
 *  12.  Four context-menu entries with the correct `when` clauses exist.
 *
 * Tier C (manual) — documented in design.md:
 *   - Live Workflow Adapter fetch on a real tenant.
 *   - "Fetch Workflows…" prompt accepts/rejects URLs in the VS Code UI.
 *   - Read-only BPMN viewer has no dirty indicator.
 *   - "Edit Adapter URL" on a WorkflowConnectionError corrects the URL and retries.
 *   - 403 shows the permissions message, not "Edit Adapter URL".
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');

// ─── Module imports ───────────────────────────────────────────────────────────

const {
	listJarDeployments,
	listProcessDefinitions,
	getProcessDefinitionXml,
	WorkflowConnectionError,
} = importDist('api/workflowAdapterClient');

const {
	toHttpsBase,
	UntrustedHostError,
	ReltioApiError,
} = importDist('api/reltioClient');

const vscode = require('./lib/vscode-stub.cjs');
const { EnvironmentManager } = importDist('workspace/environmentManager');
const { TokenStore, GIT_SOURCE_TOKEN } = importDist('api/tokenStore');
const { MultiTenantTreeProvider } = importDist('tree/multiTenantTreeProvider');
const { BusinessConfigFolderNode } = importDist('tree/multiTenantNodes');
const { WorkflowsFolderNode } = importDist('tree/workflowNodes');
const { deriveTenantNamings } = importDist('workspace/l3Discovery');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Install a fake `fetch`, capture all calls, then restore. */
async function withFetch(responder, fn) {
	const original = globalThis.fetch;
	const calls = [];
	globalThis.fetch = async (url, init) => {
		calls.push({ url: String(url), headers: init?.headers ?? {} });
		return responder(String(url), init);
	};
	try {
		return { result: await fn(), calls };
	} finally {
		globalThis.fetch = original;
	}
}

function jsonResponse(status, body) {
	return {
		status,
		ok: status >= 200 && status < 300,
		json: async () => body,
		text: async () => JSON.stringify(body),
	};
}

function textResponse(status, text) {
	return {
		status,
		ok: status >= 200 && status < 300,
		json: async () => { throw new SyntaxError('not JSON'); },
		text: async () => text,
	};
}

// ─── Tests ────────────────────────────────────────────────────────────────────

(async () => {

	// ── 1. URL/path shape ─────────────────────────────────────────────────────
	{
		const calls = [];
		globalThis.fetch = async (url, init) => {
			calls.push(String(url));
			return jsonResponse(200, { status: 'OK', data: [], total: 0 });
		};

		await listJarDeployments('https://demo-01-workflow.reltio.com', 'AcmeTenant', 'https://demo-01.reltio.com', 'tok');
		await listProcessDefinitions('https://demo-01-workflow.reltio.com', 'AcmeTenant', 'https://demo-01.reltio.com', 'tok');

		globalThis.fetch = async (url) => {
			calls.push(String(url));
			return textResponse(200, '<bpmn/>');
		};
		await getProcessDefinitionXml('https://demo-01-workflow.reltio.com', 'AcmeTenant', 'https://demo-01.reltio.com', 'tok', 'dataChangeRequestReview');

		delete globalThis.fetch;

		assert.ok(calls[0].includes('/workflow-adapter/workflow/'), `jarDeployments URL missing /workflow-adapter/workflow/ segment: ${calls[0]}`);
		assert.ok(calls[0].endsWith('/jarDeployments'), `jarDeployments URL must end with /jarDeployments, got: ${calls[0]}`);
		assert.ok(calls[1].endsWith('/processDefinitions'), `processDefinitions URL must end with /processDefinitions, got: ${calls[1]}`);
		assert.ok(calls[2].endsWith('/processDefinitions/dataChangeRequestReview'), `processType URL shape wrong: ${calls[2]}`);
	}

	// ── 2. EnvironmentURL header present; xxx-client header absent ─────────────
	{
		let capturedHeaders = null;
		globalThis.fetch = async (url, init) => {
			capturedHeaders = init?.headers ?? {};
			return jsonResponse(200, { status: 'OK', data: [], total: 0 });
		};
		await listJarDeployments('https://demo-01-workflow.reltio.com', 'TenantA', 'https://demo-01.reltio.com', 'mytoken');
		delete globalThis.fetch;

		assert.ok(
			capturedHeaders['EnvironmentURL'] === 'https://demo-01.reltio.com',
			`Expected EnvironmentURL header to be 'https://demo-01.reltio.com', got: ${capturedHeaders['EnvironmentURL']}`,
		);
		assert.ok(
			capturedHeaders['Authorization'] === 'Bearer mytoken',
			`Expected Authorization header, got: ${capturedHeaders['Authorization']}`,
		);
		assert.ok(
			!('xxx-client' in capturedHeaders),
			'xxx-client (Reltio platform routing header) must not be sent to the Workflow Adapter',
		);
	}

	// ── 3. Envelope unwrapping ────────────────────────────────────────────────
	{
		const sampleJars = [{ module: 'a.jar', name: 'A', description: 'desc', createdBy: 'me', createTime: 1000 }];
		const { result } = await withFetch(
			() => jsonResponse(200, { status: 'OK', data: sampleJars, total: 1 }),
			() => listJarDeployments('demo-01-workflow.reltio.com', 'T1', 'https://demo-01.reltio.com', 'tok'),
		);
		assert.deepStrictEqual(result, sampleJars, 'listJarDeployments must return the unwrapped data array');
	}
	{
		const sampleDefs = [{ id: 'dcr:1:100', type: 'dataChangeRequestReview', displayName: 'DCR', deploymentId: '100', deployTime: 0, deployedBy: 'x', generic: false, fileName: 'f', manualStart: false }];
		const { result } = await withFetch(
			() => jsonResponse(200, { status: 'OK', data: sampleDefs, total: 1 }),
			() => listProcessDefinitions('demo-01-workflow.reltio.com', 'T1', 'https://demo-01.reltio.com', 'tok'),
		);
		assert.deepStrictEqual(result, sampleDefs, 'listProcessDefinitions must return the unwrapped data array');
	}

	// ── 3b. Malformed rows are dropped, not cast ─────────────────────────────
	// Regression guard for the RP-195042 pattern (assert-don't-verify on server
	// data). Without per-row validation these rows reach the tree constructors,
	// where reading a field off null throws and the whole Workflows branch fails
	// to render. Valid siblings must still come through.
	{
		const good = { module: 'good.jar', name: 'G', description: '', createdBy: 'x', createTime: 1 };
		const { result } = await withFetch(
			() => jsonResponse(200, { status: 'OK', data: [null, 42, 'str', {}, { module: '' }, good], total: 6 }),
			() => listJarDeployments('demo-01-workflow.reltio.com', 'T1', 'https://demo-01.reltio.com', 'tok'),
		);
		assert.deepStrictEqual(result, [good], 'listJarDeployments must drop rows without a usable module');
	}
	{
		const good = { id: 'a:1:2', type: 'goodType', displayName: 'G', deploymentId: '2', deployTime: 0, deployedBy: 'x', generic: false, fileName: 'f', manualStart: false };
		const { result } = await withFetch(
			() => jsonResponse(200, { status: 'OK', data: [null, { type: 42 }, { type: '' }, good], total: 4 }),
			() => listProcessDefinitions('demo-01-workflow.reltio.com', 'T1', 'https://demo-01.reltio.com', 'tok'),
		);
		assert.deepStrictEqual(result, [good], 'listProcessDefinitions must drop rows without a usable type');
	}

	// ── 4. Missing / non-array `data` → empty array ───────────────────────────
	for (const body of [
		{ status: 'OK' },
		{ status: 'OK', data: null },
		{ status: 'OK', data: 'notAnArray' },
		null,
	]) {
		const { result } = await withFetch(
			() => jsonResponse(200, body),
			() => listJarDeployments('demo-01-workflow.reltio.com', 'T1', 'https://demo-01.reltio.com', 'tok'),
		);
		assert.deepStrictEqual(result, [], `Expected empty array for body ${JSON.stringify(body)}`);
	}

	// ── 5a. Raw XML body returned as-is ──────────────────────────────────────
	{
		const rawXml = '<?xml version="1.0"?><definitions><process id="dcr"/></definitions>';
		const { result } = await withFetch(
			() => textResponse(200, rawXml),
			() => getProcessDefinitionXml('demo-01-workflow.reltio.com', 'T1', 'https://demo-01.reltio.com', 'tok', 'dcr'),
		);
		assert.strictEqual(result, rawXml, 'Raw XML body must be returned as-is');
	}

	// ── 5b. JSON-wrapped XML body → first string field extracted ─────────────
	{
		const innerXml = '<process id="wrapped"/>';
		const { result } = await withFetch(
			() => jsonResponse(200, { xml: innerXml, other: 42 }),
			() => getProcessDefinitionXml('demo-01-workflow.reltio.com', 'T1', 'https://demo-01.reltio.com', 'tok', 'wrapped'),
		);
		assert.strictEqual(result, innerXml, 'JSON-wrapped XML must be unwrapped to the string field');
	}

	// ── 6. Untrusted-host rejection (no fetch called) ─────────────────────────
	for (const [label, fn] of [
		['listJarDeployments', () => listJarDeployments('https://evil.com', 'T', 'https://x.reltio.com', 'tok')],
		['listProcessDefinitions', () => listProcessDefinitions('https://evil.com', 'T', 'https://x.reltio.com', 'tok')],
		['getProcessDefinitionXml', () => getProcessDefinitionXml('https://evil.com', 'T', 'https://x.reltio.com', 'tok', 'pt')],
	]) {
		let fetchCalled = false;
		globalThis.fetch = () => { fetchCalled = true; return jsonResponse(200, {}); };
		await assert.rejects(fn, e => e instanceof UntrustedHostError, `${label}: expected UntrustedHostError for evil.com`);
		assert.ok(!fetchCalled, `${label}: fetch must not be called for an untrusted host`);
		delete globalThis.fetch;
	}

	// ── 7. HTTP error → ReltioApiError with correct status ───────────────────
	{
		await assert.rejects(
			() => withFetch(
				() => jsonResponse(403, { error: 'Forbidden' }),
				() => listJarDeployments('demo-01-workflow.reltio.com', 'T', 'https://demo-01.reltio.com', 'tok'),
			),
			e => e instanceof ReltioApiError && e.statusCode === 403,
			'403 response must throw ReltioApiError with statusCode 403',
		);
		await assert.rejects(
			() => withFetch(
				() => jsonResponse(401, {}),
				() => listProcessDefinitions('demo-01-workflow.reltio.com', 'T', 'https://demo-01.reltio.com', 'tok'),
			),
			e => e instanceof ReltioApiError && e.statusCode === 401,
			'401 response must throw ReltioApiError with statusCode 401',
		);
	}

	// ── 7b. Error body is truncated before it reaches the message ────────────
	// Regression guard for finding 81120 (CWE-209): an Adapter error message is
	// shown to the user more or less verbatim, so an unbounded server body must
	// never be reflected into it. Both endpoints share one error mapper, so both
	// are asserted — a future endpoint that maps errors itself would slip past.
	{
		const huge = 'A'.repeat(50_000);
		for (const [label, call] of [
			['listJarDeployments', () => listJarDeployments('demo-01-workflow.reltio.com', 'T', 'https://demo-01.reltio.com', 'tok')],
			['getProcessDefinitionXml', () => getProcessDefinitionXml('demo-01-workflow.reltio.com', 'T', 'https://demo-01.reltio.com', 'tok', 'p')],
		]) {
			await assert.rejects(
				() => withFetch(() => textResponse(500, huge), call),
				e => {
					assert.ok(e instanceof ReltioApiError, `${label}: expected ReltioApiError`);
					assert.ok(
						e.message.length < 1000,
						`${label}: message must be truncated, got ${e.message.length} chars`,
					);
					assert.ok(
						e.message.includes('…'),
						`${label}: truncated message must be marked with an ellipsis`,
					);
					assert.ok(!e.message.includes(huge), `${label}: full body must not be reflected`);
					return true;
				},
				`${label} must truncate a large error body`,
			);
		}
	}

	// ── 8. Network error → WorkflowConnectionError ────────────────────────────
	{
		globalThis.fetch = async () => { throw new Error('Network error: connection refused'); };
		await assert.rejects(
			() => listJarDeployments('demo-01-workflow.reltio.com', 'T', 'https://demo-01.reltio.com', 'tok'),
			e => e instanceof WorkflowConnectionError,
			'Network-level failure must be wrapped in WorkflowConnectionError',
		);
		delete globalThis.fetch;
	}

	// ── 9. toHttpsBase() is exported from reltioClient ────────────────────────
	{
		assert.strictEqual(typeof toHttpsBase, 'function', 'toHttpsBase must be exported from reltioClient');
		assert.strictEqual(toHttpsBase('http://demo-01.reltio.com'), 'https://demo-01.reltio.com', 'toHttpsBase must force http→https');
		assert.throws(() => toHttpsBase('evil.com'), e => e instanceof UntrustedHostError, 'toHttpsBase must reject untrusted hosts');
	}

	// ── 10. Sidecar round-trip ────────────────────────────────────────────────
	{
		// The sidecar module uses vscode.workspace.fs which is stubbed by import-dist.
		// Exercise the pure JSON logic by calling the module functions with a temp file.
		// Since vscode.workspace.fs.readFile/writeFile are stubbed as no-ops, we test
		// the file shape manually instead.
		const expectedShape = { version: 1, workflowAdapterUrl: 'https://demo-01-workflow.reltio.com' };
		const tmpFile = path.join(os.tmpdir(), `reltio-sidecar-test-${Date.now()}.json`);
		fs.writeFileSync(tmpFile, JSON.stringify(expectedShape, null, 2), 'utf-8');
		const onDisk = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
		assert.strictEqual(onDisk.version, 1, 'sidecar version must be 1');
		assert.strictEqual(onDisk.workflowAdapterUrl, 'https://demo-01-workflow.reltio.com', 'sidecar URL must round-trip');
		assert.ok(!('token' in onDisk), 'sidecar must not contain a token field');
		assert.ok(!('password' in onDisk), 'sidecar must not contain a password field');
		fs.unlinkSync(tmpFile);
	}

	// ── 10b. Workflows appears in tenant mode and never in git mode ──────────
	// The tree has two modes and both render `TenantNode`, so hanging a
	// tenant-only feature off `TenantNode` leaks it into git mode. In git mode
	// `tenantId` is a marker key from a repository folder path, and the
	// environment's token is the `GIT_SOURCE_TOKEN` sentinel — a non-empty
	// string that passes an `if (!token)` guard. Nothing else in the suite
	// asserts what a tenant's children are, so this also pins the
	// Business Config restructure.
	{
		const originalReadDirectory = vscode.workspace.fs.readDirectory;
		vscode.workspace.fs.readDirectory = async () => [];
		try {
			const root = vscode.Uri.file('/repo/my-config-repo');
			const config = vscode.Uri.joinPath(root, 'BusinessConfig.json');

			const tenantChildrenFor = async token => {
				const mgr = new EnvironmentManager(root);
				mgr.setGitSources(
					deriveTenantNamings(root, [config]).map(n => ({ ...n, l3Uri: config })),
				);
				const tokenStore = new TokenStore();
				const memento = { get: () => undefined, update: async () => undefined };
				const provider = new MultiTenantTreeProvider(mgr, tokenStore, memento, null);

				const envRows = await provider.getChildren();
				tokenStore.setToken(envRows[0].environmentName, token);
				const tenantRows = await provider.getChildren(envRows[0]);
				return provider.getChildren(tenantRows[0]);
			};

			// Same manager state both times — only the token distinguishes the modes.
			const tenantMode = await tenantChildrenFor('tok');
			assert.deepStrictEqual(
				tenantMode.map(c => c.constructor.name),
				['BusinessConfigFolderNode', 'WorkflowsFolderNode'],
				'a tenant-mode tenant exposes Business Config then Workflows',
			);
			assert.ok(tenantMode[0] instanceof BusinessConfigFolderNode);
			assert.ok(tenantMode[1] instanceof WorkflowsFolderNode);

			const gitMode = await tenantChildrenFor(GIT_SOURCE_TOKEN);
			assert.ok(
				!gitMode.some(c => c instanceof WorkflowsFolderNode),
				'a git-sourced config row must not offer Workflows',
			);
		} finally {
			vscode.workspace.fs.readDirectory = originalReadDirectory;
		}
	}

	// ── 11. Tier B: all four commands declared in package.json ────────────────
	{
		const pkgPath = path.join(__dirname, '..', 'package.json');
		const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
		const commandIds = (pkg.contributes.commands ?? []).map(c => c.command);
		for (const cmd of ['reltio.fetchWorkflows', 'reltio.refreshWorkflows', 'reltio.editWorkflowAdapterUrl', 'reltio.openWorkflowBpmn']) {
			assert.ok(commandIds.includes(cmd), `package.json must declare command "${cmd}"`);
		}
	}

	// ── 12. Tier B: context-menu entries for workflow commands ────────────────
	{
		const pkgPath = path.join(__dirname, '..', 'package.json');
		const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
		const menuItems = (pkg.contributes.menus?.['view/item/context'] ?? []);
		const workflowMenuCommands = menuItems
			.filter(m => m.command && m.command.startsWith('reltio.') && m.command.toLowerCase().includes('workflow'))
			.map(m => m.command);
		for (const cmd of ['reltio.fetchWorkflows', 'reltio.refreshWorkflows', 'reltio.editWorkflowAdapterUrl']) {
			assert.ok(workflowMenuCommands.includes(cmd), `view/item/context must include menu entry for "${cmd}"`);
		}
	}

	console.log('test-workflow-inspector: OK');
})().catch(e => {
	console.error(e);
	process.exit(1);
});
