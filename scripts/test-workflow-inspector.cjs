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
 *   8.  Network-level failure maps to `WorkflowConnectionError`, on
 *       `listJarDeployments`, `listAvailableJars` and `registerJarDeployment` alike.
 *   9.  `toHttpsBase()` is re-exported from `reltioClient` (Slice 1 sanity check).
 *  10.  Sidecar round-trip, through `installMemoryFs()` and the real
 *       `saveWorkflowAdapterUrl`/`loadWorkflowAdapterUrl` — missing, corrupt and
 *       wrong-version files all load as `undefined` rather than throwing.
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
 *
 * Added in the security/code-quality review pass:
 *  22.  `BpmnContentProvider`'s cache is capped — inserting past the cap evicts the oldest entry.
 *  23.  A 429 response's `Retry-After` header reaches `ReltioApiError.retryAfterSeconds`.
 *  24.  `classifyWorkflowError()` — the pure branch set behind `reportWorkflowError()` in
 *       extension.ts: 401/403/404-on-deploy/429/WorkflowConnectionError/UntrustedHostError/generic.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');

// ─── Module imports ───────────────────────────────────────────────────────────

const {
	listJarDeployments,
	listAvailableJars,
	registerJarDeployment,
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
const { installMemoryFs } = require('./lib/memory-fs.cjs');
const { EnvironmentManager } = importDist('workspace/environmentManager');
const { saveWorkflowAdapterUrl, loadWorkflowAdapterUrl } = importDist('workspace/workflowAdapterConfig');
const { TokenStore, GIT_SOURCE_TOKEN } = importDist('api/tokenStore');
const { MultiTenantTreeProvider } = importDist('tree/multiTenantTreeProvider');
const { BusinessConfigFolderNode } = importDist('tree/multiTenantNodes');
const {
	WorkflowsFolderNode,
	ProcessDefinitionNode,
	JarDeploymentNode,
	JarDeploymentsFolderNode,
	UnregisteredJarsFolderNode,
	UnregisteredJarNode,
	jarModuleFileName,
} = importDist('tree/workflowNodes');
const { deriveTenantNamings } = importDist('workspace/l3Discovery');
const { BpmnContentProvider } = importDist('providers/bpmnContentProvider');
const { classifyWorkflowError } = importDist('workflow/workflowErrorReporting');

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

	// ── 3c. A path-traversal-shaped `type` is dropped, not just a non-empty one ──
	// `type` reaches `bpmnFileName(processId)` unmodified (environmentManager's
	// getWorkflowBpmnUri/getWorkflowBpmnBaselineUri), so an adapter response that
	// returns e.g. `../../../../whatever` must be rejected by the same rule as
	// user-typed input (`isValidProcessId`), not merely required to be non-empty.
	{
		const good = { id: 'a:1:2', type: 'goodType', displayName: 'G', deploymentId: '2', deployTime: 0, deployedBy: 'x', generic: false, fileName: 'f', manualStart: false };
		const traversal = { ...good, type: '../../../../etc/evil' };
		const dotdot = { ...good, type: '..' };
		const absolute = { ...good, type: '/etc/passwd' };
		const { result } = await withFetch(
			() => jsonResponse(200, { status: 'OK', data: [traversal, dotdot, absolute, good], total: 4 }),
			() => listProcessDefinitions('demo-01-workflow.reltio.com', 'T1', 'https://demo-01.reltio.com', 'tok'),
		);
		assert.deepStrictEqual(result, [good], 'listProcessDefinitions must drop a path-traversal-shaped type, keeping only the valid row');
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
	// Every endpoint that calls `fetchWithTimeout` wraps it in its own try/catch — a raw,
	// non-HTTP failure (DNS, connection refused, timeout) never reaches the caller as the
	// underlying error, only as `WorkflowConnectionError`. `listAvailableJars` and
	// `registerJarDeployment` had no coverage of their own try/catch doing this; only
	// `listJarDeployments` did, leaving the other two's wrapping unverified.
	{
		globalThis.fetch = async () => { throw new Error('Network error: connection refused'); };
		try {
			await assert.rejects(
				() => listJarDeployments('demo-01-workflow.reltio.com', 'T', 'https://demo-01.reltio.com', 'tok'),
				e => e instanceof WorkflowConnectionError,
				'listJarDeployments: network-level failure must be wrapped in WorkflowConnectionError',
			);
			await assert.rejects(
				() => listAvailableJars('demo-01-workflow.reltio.com', 'T', 'https://demo-01.reltio.com', 'tok'),
				e => e instanceof WorkflowConnectionError,
				'listAvailableJars: network-level failure must be wrapped in WorkflowConnectionError',
			);
			await assert.rejects(
				() => registerJarDeployment('demo-01-workflow.reltio.com', 'T', 'https://demo-01.reltio.com', 'tok', {
					module: 'acme/workflow/MyListener.jar',
					name: 'MyListener',
				}),
				e => e instanceof WorkflowConnectionError,
				'registerJarDeployment: network-level failure must be wrapped in WorkflowConnectionError',
			);
		} finally {
			delete globalThis.fetch;
		}
	}

	// ── 9. toHttpsBase() is exported from reltioClient ────────────────────────
	{
		assert.strictEqual(typeof toHttpsBase, 'function', 'toHttpsBase must be exported from reltioClient');
		assert.strictEqual(toHttpsBase('http://demo-01.reltio.com'), 'https://demo-01.reltio.com', 'toHttpsBase must force http→https');
		assert.throws(() => toHttpsBase('evil.com'), e => e instanceof UntrustedHostError, 'toHttpsBase must reject untrusted hosts');
	}

	// ── 10. Sidecar round-trip ────────────────────────────────────────────────
	// Goes through `installMemoryFs()` and the real `saveWorkflowAdapterUrl`/
	// `loadWorkflowAdapterUrl` rather than hand-rolling a JSON file with Node's own `fs` —
	// the previous version of this test wrote and read a temp file directly, which proved
	// `JSON.stringify`/`JSON.parse` round-trip a plain object (always true) and nothing about
	// the two functions it claimed to test.
	{
		const mem = installMemoryFs();
		const mgr = new EnvironmentManager(vscode.Uri.file('/ws-sidecar'));
		const configUri = mgr.getWorkflowAdapterConfigUri('demo-01.reltio.com', 'AcmeTenant');

		assert.strictEqual(
			await loadWorkflowAdapterUrl(configUri), undefined,
			'no sidecar on disk yet must load as undefined, not throw',
		);

		await saveWorkflowAdapterUrl(configUri, 'https://demo-01-workflow.reltio.com');
		assert.ok(mem._files.has(configUri.path), 'save must create the sidecar file');

		const onDisk = JSON.parse(Buffer.from(mem._files.get(configUri.path)).toString('utf-8'));
		assert.strictEqual(onDisk.version, 1, 'sidecar version must be 1');
		assert.strictEqual(onDisk.workflowAdapterUrl, 'https://demo-01-workflow.reltio.com', 'sidecar URL must round-trip');
		assert.ok(!('token' in onDisk), 'sidecar must not contain a token field');
		assert.ok(!('password' in onDisk), 'sidecar must not contain a password field');

		assert.strictEqual(
			await loadWorkflowAdapterUrl(configUri), 'https://demo-01-workflow.reltio.com',
			'loadWorkflowAdapterUrl must read back exactly what saveWorkflowAdapterUrl wrote',
		);

		// A corrupt or future-versioned sidecar is treated as "no URL saved", per the module's
		// own doc comment — never thrown, since the caller's fallback is a prompt, not a crash.
		await mem.writeFile(configUri, Buffer.from('{ not json', 'utf-8'));
		assert.strictEqual(await loadWorkflowAdapterUrl(configUri), undefined, 'corrupt JSON must load as undefined');

		await mem.writeFile(configUri, Buffer.from(JSON.stringify({ version: 2, workflowAdapterUrl: 'https://x.reltio.com' }), 'utf-8'));
		assert.strictEqual(await loadWorkflowAdapterUrl(configUri), undefined, 'an unexpected version must load as undefined');
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

	// ── 13. Row tooltips ────────────────────────────────────────────────────
	// The hover is the only place a user learns whether a definition is Reltio's
	// or their own before acting on it — redeploying an id that is already live
	// replaces a running workflow — so it leads, in bold, and the fields below
	// it degrade rather than printing "Invalid Date" or "undefined".
	{
		const definition = {
			id: 'review:3:4001',
			type: 'dataChangeRequestReview',
			displayName: 'Data Change Request Review',
			deployedBy: 'jane@acme.com',
			deployTime: Date.UTC(2026, 5, 12, 9, 30),
			generic: true,
		};

		const builtIn = new ProcessDefinitionNode('env', 'tenant', definition, 'none');
		assert.ok(
			builtIn.tooltip instanceof vscode.MarkdownString,
			'the tooltip must be a MarkdownString, not a plain string',
		);
		const text = builtIn.tooltip.value;
		assert.ok(text.startsWith('**OOTB workflow**'), `classification must lead in bold, got: ${text}`);
		assert.ok(text.includes('Name: Data Change Request Review'));
		assert.ok(text.includes('ID: dataChangeRequestReview'));
		assert.ok(
			!text.includes('Process ID:'),
			'the field is labelled "ID"; "Process ID" is the old wording',
		);
		assert.ok(text.includes('Deployed by: jane@acme.com'));
		assert.ok(/Deployed: \S/.test(text), 'a deploy timestamp must be rendered');
		assert.ok(!text.includes('Invalid Date'));

		// A trusted MarkdownString renders `command:` links, and every value here
		// is server-supplied.
		assert.strictEqual(builtIn.tooltip.isTrusted, false, 'tooltips must stay untrusted');

		const custom = new ProcessDefinitionNode(
			'env', 'tenant', { ...definition, generic: false }, 'none',
		);
		assert.ok(custom.tooltip.value.startsWith('**Custom workflow**'));

		// Only `type` is guaranteed by the row guard, so every other field is
		// genuinely optional at runtime and must be omitted, not rendered empty.
		const sparse = new ProcessDefinitionNode('env', 'tenant', { type: 'bare' }, 'none');
		const sparseText = sparse.tooltip.value;
		assert.ok(sparseText.includes('ID: bare'));
		assert.ok(!sparseText.includes('Process ID:'));
		assert.ok(sparseText.includes('Name: bare'), 'the id stands in for a missing name');
		assert.ok(!sparseText.includes('Deployed by:'), 'a missing field must be omitted entirely');
		assert.ok(!sparseText.includes('Invalid Date'));
		assert.ok(!sparseText.includes('undefined'));

		// Markdown metacharacters in a customer-authored process name must not
		// reformat the rest of the tooltip.
		const hostile = new ProcessDefinitionNode(
			'env', 'tenant', { type: 'x', displayName: '_italic_ *bold* [link](x)' }, 'none',
		);
		assert.ok(
			!hostile.tooltip.value.includes('_italic_'),
			'markdown metacharacters must be escaped',
		);
		assert.ok(hostile.tooltip.value.includes('\\_italic\\_'));

		// …but escaping must stay inline-only. A full CommonMark escape set takes
		// `.` and `-`, which renders an email as `jane@acme\.com` — legal markdown
		// and a value the user can no longer copy out of the hover.
		// (The JAR module path below is the other half of this check.)
		assert.ok(
			text.includes('jane@acme.com'),
			'an email address must survive escaping unmodified',
		);

		// Local state is still reported, below the identity rather than inside it.
		const changed = new ProcessDefinitionNode('env', 'tenant', definition, 'changed');
		assert.ok(changed.tooltip.value.includes('local changes'));

		const jar = new JarDeploymentNode('env', 'tenant', {
			name: 'acme-workflow',
			module: 'com.acme:workflow:1.2.0',
			createdBy: 'build@acme.com',
			createTime: Date.UTC(2026, 5, 12, 9, 30),
		});
		assert.ok(jar.tooltip instanceof vscode.MarkdownString);
		assert.ok(jar.tooltip.value.startsWith('**Custom JAR**'));
		assert.ok(jar.tooltip.value.includes('Module: com.acme:workflow:1.2.0'));
		assert.ok(!jar.tooltip.value.includes('Description:'), 'an absent description is omitted');
	}

	// ── 14. listAvailableJars: envelope unwrap ────────────────────────────────
	{
		const sampleJars = [{ module: 'reltio.workflow-custom-jars/Acme/my-1.0.0.jar', updateTime: 123, size: 456 }];
		const { result } = await withFetch(
			() => jsonResponse(200, { limitExceeded: false, total: 1, jars: sampleJars }),
			() => listAvailableJars('demo-01-workflow.reltio.com', 'T1', 'https://demo-01.reltio.com', 'tok'),
		);
		assert.deepStrictEqual(result, { kind: 'ok', jars: sampleJars });
	}

	// ── 15. listAvailableJars: POST with a JSON body, never omitted ──────────
	{
		let capturedInit = null;
		const { result } = await withFetch(
			(url, init) => { capturedInit = init; return jsonResponse(200, { jars: [] }); },
			() => listAvailableJars('demo-01-workflow.reltio.com', 'T1', 'https://demo-01.reltio.com', 'tok'),
		);
		assert.strictEqual(capturedInit.method, 'POST', 'listJars must be a POST');
		assert.strictEqual(capturedInit.body, '{}', 'listJars must always send a JSON body, even when empty');
		assert.deepStrictEqual(result, { kind: 'ok', jars: [] });
	}

	// ── 16. listAvailableJars: malformed rows dropped, not thrown ────────────
	{
		const good = { module: 'ok.jar', updateTime: 1, size: 1 };
		const { result } = await withFetch(
			() => jsonResponse(200, { jars: [null, { module: 42 }, { module: '' }, good] }),
			() => listAvailableJars('demo-01-workflow.reltio.com', 'T1', 'https://demo-01.reltio.com', 'tok'),
		);
		assert.deepStrictEqual(result, { kind: 'ok', jars: [good] });
	}

	// ── 17. listAvailableJars: errorCode 10089 → notConfigured, not thrown ───
	// This is the specific failure mode confirmed on a real tenant (`SunilTst`)
	// that has working registered JARs but no `jarsLocation` config — must read
	// as "not available here," not as a broken refresh.
	{
		const { result } = await withFetch(
			() => jsonResponse(400, { errorCode: 10089, error: 'Tenant has no configuration for JAR files location' }),
			() => listAvailableJars('demo-01-workflow.reltio.com', 'T1', 'https://demo-01.reltio.com', 'tok'),
		);
		assert.deepStrictEqual(result, { kind: 'notConfigured' });
	}

	// ── 18. listAvailableJars: any other error still throws ReltioApiError ───
	{
		await assert.rejects(
			() => withFetch(
				() => jsonResponse(500, { errorCode: 99999, error: 'boom' }),
				() => listAvailableJars('demo-01-workflow.reltio.com', 'T1', 'https://demo-01.reltio.com', 'tok'),
			),
			e => e instanceof ReltioApiError && e.statusCode === 500,
			'an error code other than 10089 must still throw ReltioApiError',
		);
		// Same for a body that isn't JSON at all.
		await assert.rejects(
			() => withFetch(
				() => textResponse(500, 'internal server error'),
				() => listAvailableJars('demo-01-workflow.reltio.com', 'T1', 'https://demo-01.reltio.com', 'tok'),
			),
			e => e instanceof ReltioApiError && e.statusCode === 500,
			'a non-JSON error body must still throw ReltioApiError, not be mistaken for notConfigured',
		);
	}

	// ── 19. registerJarDeployment: request shape and success/error paths ─────
	{
		let capturedUrl = null;
		let capturedInit = null;
		const { result } = await withFetch(
			(url, init) => { capturedUrl = url; capturedInit = init; return jsonResponse(200, { status: 'OK' }); },
			() => registerJarDeployment(
				'demo-01-workflow.reltio.com', 'T1', 'https://demo-01.reltio.com', 'tok',
				{ module: 'a/b.jar', name: 'My JAR', description: 'desc' },
			),
		);
		assert.strictEqual(result, undefined, 'a successful registration resolves with no value');
		assert.ok(capturedUrl.endsWith('/jarDeployments'), `register URL must end with /jarDeployments, got: ${capturedUrl}`);
		assert.strictEqual(capturedInit.method, 'POST');
		assert.deepStrictEqual(
			JSON.parse(capturedInit.body),
			{ module: 'a/b.jar', name: 'My JAR', description: 'desc' },
		);

		// Optional description defaults to '', never omitted or undefined on the wire.
		let capturedInit2 = null;
		await withFetch(
			(url, init) => { capturedInit2 = init; return jsonResponse(200, { status: 'OK' }); },
			() => registerJarDeployment(
				'demo-01-workflow.reltio.com', 'T1', 'https://demo-01.reltio.com', 'tok',
				{ module: 'a/b.jar', name: 'My JAR' },
			),
		);
		assert.strictEqual(JSON.parse(capturedInit2.body).description, '');

		await assert.rejects(
			() => withFetch(
				() => jsonResponse(400, { errorCode: 10055, error: 'name already exists' }),
				() => registerJarDeployment(
					'demo-01-workflow.reltio.com', 'T1', 'https://demo-01.reltio.com', 'tok',
					{ module: 'a/b.jar', name: 'dup' },
				),
			),
			e => e instanceof ReltioApiError && e.statusCode === 400 && e.message.includes('name already exists'),
			'a name collision must surface the Adapter\'s own message',
		);
	}

	// ── 20. Unregistered-JAR tree nodes ───────────────────────────────────────
	{
		const available = [{ module: 'reltio.workflow-custom-jars/Acme/new-1.0.0.jar', updateTime: Date.UTC(2026, 5, 1), size: 2048 }];

		// Folder count / collapsible state react to `unregistered`, independent of `deployments`.
		const emptyBoth = new JarDeploymentsFolderNode('env', 'tenant', [], undefined);
		assert.strictEqual(emptyBoth.collapsibleState, vscode.TreeItemCollapsibleState.None);
		const withUnregisteredOnly = new JarDeploymentsFolderNode('env', 'tenant', [], available);
		assert.strictEqual(withUnregisteredOnly.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
		assert.strictEqual(withUnregisteredOnly.label, 'JAR Deployments (0)', 'the folder count reflects registered JARs only');

		const subfolder = new UnregisteredJarsFolderNode('env', 'tenant', available);
		assert.strictEqual(subfolder.label, 'Unregistered (1)');
		assert.strictEqual(subfolder.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);

		const emptySubfolder = new UnregisteredJarsFolderNode('env', 'tenant', []);
		assert.strictEqual(emptySubfolder.collapsibleState, vscode.TreeItemCollapsibleState.None);

		const leaf = new UnregisteredJarNode('env', 'tenant', available[0]);
		assert.strictEqual(leaf.label, 'new-1.0.0.jar', 'label is the file name, not the full module path');
		assert.ok(leaf.tooltip.value.startsWith('**Not yet registered**'));
		assert.ok(leaf.tooltip.value.includes('Module: reltio.workflow-custom-jars/Acme/new-1.0.0.jar'));
		assert.ok(leaf.tooltip.value.includes('Size: 2.0 KB'));
		assert.strictEqual(leaf.command.command, 'reltio.registerJarDeployment', 'clicking a row must start registration');
		assert.strictEqual(leaf.contextValue, 'reltio.workflows.unregisteredJar');

		assert.strictEqual(jarModuleFileName('a/b/c.jar'), 'c.jar');
		assert.strictEqual(jarModuleFileName('nofolder.jar'), 'nofolder.jar', 'a bare module with no slash is its own file name');
	}

	// ── 21. Tier B: registerJarDeployment command + context menu declared ────
	{
		const pkgPath = path.join(__dirname, '..', 'package.json');
		const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
		const commandIds = (pkg.contributes.commands ?? []).map(c => c.command);
		assert.ok(commandIds.includes('reltio.registerJarDeployment'), 'package.json must declare reltio.registerJarDeployment');

		const menuItems = pkg.contributes.menus?.['view/item/context'] ?? [];
		assert.ok(
			menuItems.some(m => m.command === 'reltio.registerJarDeployment' && m.when?.includes('reltio.workflows.unregisteredJar')),
			'view/item/context must offer Register JAR on an unregistered-JAR row',
		);
		assert.ok(
			menuItems.some(m => m.command === 'reltio.refreshJarDeployments' && m.when?.includes('reltio.workflows.unregisteredJars.folder')),
			'view/item/context must offer Refresh JARs on the Unregistered subfolder too',
		);
	}

	// ── 22. BpmnContentProvider: cache is capped ──────────────────────────────
	// Added in the security/code-quality review pass: `store()` previously grew an
	// unbounded `Map` for the lifetime of the window. 50 (CAP below) must match
	// `MAX_CACHE_ENTRIES` in bpmnContentProvider.ts.
	{
		const provider = new BpmnContentProvider();
		const CAP = 50;
		const OVERFLOW = 5;
		const uris = [];
		for (let i = 0; i < CAP + OVERFLOW; i++) {
			uris.push(provider.store('env', 'tenant', `processType${i}`, `<xml id="${i}"/>`));
		}
		for (let i = 0; i < OVERFLOW; i++) {
			assert.ok(
				provider.provideTextDocumentContent(uris[i]).includes('unavailable'),
				`entry ${i} should have been evicted once the cache exceeded its cap`,
			);
		}
		for (let i = OVERFLOW; i < CAP + OVERFLOW; i++) {
			assert.strictEqual(
				provider.provideTextDocumentContent(uris[i]),
				`<xml id="${i}"/>`,
				`entry ${i} is within the last ${CAP} inserted and must still be cached`,
			);
		}
	}

	// ── 23. 429 response → ReltioApiError carries retryAfterSeconds ───────────
	{
		const responseWithRetryAfter = (status, body, retryAfterHeader) => ({
			status,
			ok: status >= 200 && status < 300,
			json: async () => body,
			text: async () => JSON.stringify(body),
			headers: { get: name => (name === 'Retry-After' ? retryAfterHeader : null) },
		});

		await assert.rejects(
			() => withFetch(
				() => responseWithRetryAfter(429, { error: 'Too Many Requests' }, '30'),
				() => listJarDeployments('demo-01-workflow.reltio.com', 'T', 'https://demo-01.reltio.com', 'tok'),
			),
			e => {
				assert.ok(e instanceof ReltioApiError && e.statusCode === 429, 'must throw ReltioApiError with statusCode 429');
				assert.strictEqual(e.retryAfterSeconds, 30, 'a numeric Retry-After header must be parsed to seconds');
				return true;
			},
		);

		// No Retry-After header at all → retryAfterSeconds stays undefined, never invented.
		await assert.rejects(
			() => withFetch(
				() => responseWithRetryAfter(429, {}, null),
				() => listProcessDefinitions('demo-01-workflow.reltio.com', 'T', 'https://demo-01.reltio.com', 'tok'),
			),
			e => {
				assert.ok(e instanceof ReltioApiError && e.statusCode === 429);
				assert.strictEqual(e.retryAfterSeconds, undefined, 'absent header must not produce an invented retry time');
				return true;
			},
		);
	}

	// ── 24. classifyWorkflowError: the full branch set ────────────────────────
	// Pure logic behind `reportWorkflowError()` in extension.ts — see workflowErrorReporting.ts.
	{
		const ctx = operation => ({ tenantId: 'AcmeTenant', operation });

		assert.deepStrictEqual(
			classifyWorkflowError(new ReltioApiError('nope', 401), ctx('fetch')),
			{ kind: 'reauthenticate' },
			'401 must hand back a reauthenticate action, regardless of operation',
		);

		const deploy403 = classifyWorkflowError(new ReltioApiError('nope', 403), ctx('deploy'));
		assert.strictEqual(deploy403.kind, 'message');
		assert.ok(deploy403.message.includes('Deploy refused (403)') && deploy403.message.includes('ROLE_WORKFLOW_MANAGER'));

		const register403 = classifyWorkflowError(new ReltioApiError('nope', 403), ctx('register'));
		assert.ok(register403.message.includes('Registration refused (403)'));

		const fetch403 = classifyWorkflowError(new ReltioApiError('nope', 403), ctx('fetch'));
		assert.ok(fetch403.message.includes('Access denied (403)'));

		const deploy404 = classifyWorkflowError(new ReltioApiError('nope', 404), ctx('deploy'));
		assert.strictEqual(deploy404.kind, 'message-with-edit-adapter-url', '404 on deploy must offer Edit Adapter URL');
		assert.ok(deploy404.message.includes('Deploy failed (404)'));

		const fetch404 = classifyWorkflowError(new ReltioApiError('Workflow Adapter returned 404.', 404), ctx('fetch'));
		assert.strictEqual(fetch404.kind, 'message', '404 outside deploy must not offer Edit Adapter URL');
		assert.strictEqual(fetch404.message, 'Workflow Adapter returned 404.');

		const withRetry = classifyWorkflowError(new ReltioApiError('rate limited', 429, 30), ctx('fetch'));
		assert.strictEqual(withRetry.kind, 'message');
		assert.ok(withRetry.message.includes('Rate limited (429)'));
		assert.ok(withRetry.message.includes('retry-after of 30 seconds'), 'a real Retry-After header must be reflected in the message');

		const withoutRetry = classifyWorkflowError(new ReltioApiError('rate limited', 429), ctx('fetch'));
		assert.ok(withoutRetry.message.includes('Wait a moment before retrying.'));
		assert.ok(!withoutRetry.message.includes('retry-after of'), 'no invented wait time without a real Retry-After header');

		const connErr = classifyWorkflowError(new WorkflowConnectionError(new Error('could not reach host')), ctx('fetch'));
		assert.strictEqual(connErr.kind, 'message-with-edit-adapter-url');
		assert.ok(connErr.message.includes('could not reach host'));

		const untrustedErr = classifyWorkflowError(new UntrustedHostError('untrusted host'), ctx('open'));
		assert.strictEqual(untrustedErr.kind, 'message-with-edit-adapter-url');
		assert.strictEqual(untrustedErr.message, 'untrusted host');

		const generic = classifyWorkflowError(new Error('boom'), ctx('fetch'));
		assert.deepStrictEqual(generic, { kind: 'message', message: 'boom' }, 'anything else falls through to the generic message');
	}

	console.log('test-workflow-inspector: OK');
})().catch(e => {
	console.error(e);
	process.exit(1);
});
