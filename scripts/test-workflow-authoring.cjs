#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: workflow-authoring
 *
 * Tier A — pure logic, no I/O, no VS Code host:
 *   1.  Multipart bytes exactly: CRLF placement, Content-Disposition line,
 *       terminating `--{boundary}--`.
 *   2.  UTF-8 byte length, not string length — a non-ASCII process name is the
 *       case where the two differ and the request silently malforms.
 *   3.  Header injection: a quote or line break in the field/filename is refused.
 *   4.  Boundary generation avoids a value present in the payload.
 *   5.  Deploy URL: `/workflow-adapter/workflow/deployments`, percent-encoded
 *       `tenantId` and `name` query params, and NO tenant path segment.
 *   6.  Deploy request: POST, Authorization + EnvironmentURL + multipart
 *       Content-Type carrying the same boundary, and no `xxx-client`.
 *   7.  Untrusted host rejected before `fetch` is called; 4xx/5xx and network
 *       failures map to the right error classes.
 *   8.  `buildBpmnSkeleton` escapes XML metacharacters and is executable.
 *   9.  Process-id validator accept/reject table.
 *  10.  `resolveDraftContext` round-trips a URI from `getWorkflowDraftUri`, and
 *       refuses paths that are not drafts.
 *  11.  `rewriteProcessIdentity` rewrites only the first `<process>` element and
 *       survives a namespace prefix.
 *
 * Tier B — structural:
 *  12.  Commands declared in package.json; every workflow action reachable by
 *       right-click and not only as a hover icon (`group: "inline"` renders in
 *       the row action bar, never in the context menu); every workflow row type
 *       offers at least one right-click action; every tree `when` clause scoped
 *       with `view == reltioConfigTree &&`; and every declared command actually
 *       registered in `src/`, since a declared-but-unregistered command fails
 *       at click time with "command not found" while passing every other check.
 *  13.  This script is registered in the hardcoded SCRIPTS array — the runner is
 *       not a glob, so an unregistered test silently never runs.
 *
 *  14.  BPMN normalisation: re-serialisation (whitespace, comments, BOM, an
 *       added BPMNDI block) is not a change; a real content edit is.
 *  15.  Local-change and server-drift detection built on that normalisation.
 *  16.  A `.bpmn20.baseline.xml` file never parses as a local BPMN, so baselines
 *       cannot appear as phantom drafts.
 *
 * Tier C (manual) — documented in design.md's test plan.
 */

const assert = require('assert');
const { importDist } = require('./lib/import-dist.cjs');
const fs = require('fs');
const path = require('path');
const vscode = require('./lib/vscode-stub.cjs');

const {
	buildMultipartBody,
	multipartContentType,
	generateBoundary,
	deployProcessDefinition,
	guessWorkflowAdapterUrl,
} = importDist('api/workflowAdapterClient');

const { UntrustedHostError, ReltioApiError } = importDist('api/reltioClient');
const { WorkflowConnectionError } = importDist('api/workflowAdapterClient');

const {
	buildBpmnSkeleton,
	draftFileName,
	processIdFromDraftFileName,
	isValidProcessId,
	processIdValidationMessage,
	resolveDraftContext,
	rewriteProcessIdentity,
} = importDist('workspace/workflowDrafts');

const { EnvironmentManager } = importDist('workspace/environmentManager');

const {
	normalizeBpmn,
	hasLocalBpmnChanges,
	remoteBpmnMatchesBaseline,
	processIdFromBpmnFileName,
	bpmnFileName,
	bpmnBaselineFileName,
} = importDist('workspace/workflowBpmnFiles');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Fake `fetch` that captures method, headers and body as well as the URL. */
async function withFetch(responder, fn) {
	const original = globalThis.fetch;
	const calls = [];
	globalThis.fetch = async (url, init) => {
		calls.push({
			url: String(url),
			method: init?.method,
			headers: init?.headers ?? {},
			body: init?.body,
		});
		return responder(String(url), init);
	};
	try {
		return { result: await fn(), calls };
	} finally {
		globalThis.fetch = original;
	}
}

const okResponse = () => ({
	status: 200,
	ok: true,
	json: async () => ({}),
	text: async () => '',
});

const errResponse = (status) => ({
	status,
	ok: false,
	json: async () => ({}),
	text: async () => 'boom',
});

const jsonResponse = (status, body) => ({
	status,
	ok: status >= 200 && status < 300,
	json: async () => body,
	text: async () => JSON.stringify(body),
});

const CRLF = '\r\n';

// ─── Tests ───────────────────────────────────────────────────────────────────

(async () => {

	// ── 1. Exact multipart layout ─────────────────────────────────────────────
	{
		const body = buildMultipartBody(
			{ field: 'file', fileName: 'p.bpmn20.xml', contentType: 'application/xml', content: '<x/>' },
			'BOUND',
		);
		const text = Buffer.from(body).toString('utf-8');
		const expected =
			`--BOUND${CRLF}` +
			`Content-Disposition: form-data; name="file"; filename="p.bpmn20.xml"${CRLF}` +
			`Content-Type: application/xml${CRLF}` +
			`${CRLF}` +
			`<x/>${CRLF}` +
			`--BOUND--${CRLF}`;
		assert.strictEqual(text, expected, 'multipart body must match the expected byte layout exactly');
		assert.ok(body instanceof Uint8Array, 'multipart body must be bytes, not a string');
		assert.strictEqual(
			multipartContentType('BOUND'),
			'multipart/form-data; boundary=BOUND',
			'Content-Type must carry the same boundary',
		);
	}

	// ── 2. UTF-8 byte length, not string length ───────────────────────────────
	{
		// "Überprüfung" and an em dash: 13 characters, more than 13 bytes.
		const content = '<name>Überprüfung — café</name>';
		const body = buildMultipartBody(
			{ field: 'file', fileName: 'ü.bpmn20.xml', contentType: 'application/xml', content },
			'B',
		);
		const bytes = Buffer.from(body);
		assert.ok(
			bytes.length > Buffer.byteLength('--B', 'utf-8') + content.length,
			'body must be measured in UTF-8 bytes, not UTF-16 code units',
		);
		assert.strictEqual(
			bytes.toString('utf-8').includes(content),
			true,
			'non-ASCII content must survive the round trip intact',
		);
		assert.strictEqual(
			Buffer.byteLength(content, 'utf-8') > content.length,
			true,
			'fixture must actually be multi-byte, or this test proves nothing',
		);
	}

	// ── 3. Header injection is refused ────────────────────────────────────────
	{
		for (const bad of ['a"b', `a${CRLF}X-Evil: 1`, 'a\nb']) {
			assert.throws(
				() => buildMultipartBody(
					{ field: 'file', fileName: bad, contentType: 'application/xml', content: '<x/>' },
					'B',
				),
				/quotes or line breaks/,
				`filename ${JSON.stringify(bad)} must be refused`,
			);
			assert.throws(
				() => buildMultipartBody(
					{ field: bad, fileName: 'p.bpmn20.xml', contentType: 'application/xml', content: '<x/>' },
					'B',
				),
				/quotes or line breaks/,
				`field ${JSON.stringify(bad)} must be refused`,
			);
		}
	}

	// ── 4. Boundary avoids the payload ────────────────────────────────────────
	{
		const b1 = generateBoundary('<x/>');
		assert.ok(/^----ReltioIDE[0-9a-f]{32}$/.test(b1), `unexpected boundary shape: ${b1}`);
		const b2 = generateBoundary('<x/>');
		assert.notStrictEqual(b1, b2, 'boundaries must not repeat between calls');
		// A payload containing a previously generated boundary must not get it again.
		assert.notStrictEqual(generateBoundary(`junk ${b1} junk`), b1);
	}

	// ── 5. Deploy URL shape ───────────────────────────────────────────────────
	{
		const { calls } = await withFetch(okResponse, () =>
			deployProcessDefinition(
				'demo-01-workflow.reltio.com',
				'Acme/Tenant',
				'https://demo-01.reltio.com',
				'tok',
				'my deployment',
				'p.bpmn20.xml',
				'<x/>',
			));
		const url = calls[0].url;
		assert.ok(url.includes('/workflow-adapter/workflow/deployments'), `wrong deploy path: ${url}`);
		assert.ok(url.includes('tenantId=Acme%2FTenant'), `tenantId must be percent-encoded: ${url}`);
		assert.ok(url.includes('name=my%20deployment'), `name must be percent-encoded: ${url}`);
		assert.ok(
			!/\/workflow\/[^/?]+\/deployments/.test(url),
			`deploy must NOT carry a tenant path segment: ${url}`,
		);
	}

	// ── 6. Deploy request shape ───────────────────────────────────────────────
	{
		const { calls } = await withFetch(okResponse, () =>
			deployProcessDefinition(
				'demo-01-workflow.reltio.com', 'T', 'https://demo-01.reltio.com',
				'mytoken', 'dep', 'p.bpmn20.xml', '<x/>',
			));
		const call = calls[0];
		assert.strictEqual(call.method, 'POST', 'deploy must be a POST');
		assert.strictEqual(call.headers['Authorization'], 'Bearer mytoken');
		assert.strictEqual(call.headers['EnvironmentURL'], 'https://demo-01.reltio.com');
		assert.ok(!('xxx-client' in call.headers), 'xxx-client must not be sent to the Adapter');

		const ct = call.headers['Content-Type'];
		assert.ok(ct.startsWith('multipart/form-data; boundary='), `wrong Content-Type: ${ct}`);
		const boundary = ct.slice('multipart/form-data; boundary='.length);
		const sent = Buffer.from(call.body).toString('utf-8');
		assert.ok(sent.startsWith(`--${boundary}${CRLF}`), 'body must open with the declared boundary');
		assert.ok(sent.endsWith(`--${boundary}--${CRLF}`), 'body must close with the declared boundary');
		assert.ok(sent.includes('filename="p.bpmn20.xml"'), 'part filename must match the draft name');
	}

	// ── 7. Deploy response parsing ────────────────────────────────────────────
	// Shape confirmed against the Adapter's own OpenAPI spec (components.schemas
	// ["Deployment response"]): { status, deploymentId, warning? }, both of the
	// latter optional. A caller must see `warning` — it means "succeeded, but
	// there were some problems" — and must not crash on a body that doesn't
	// match, since the spec was not fired against a live Adapter.
	{
		const withBody = body => ({ status: 200, ok: true, text: async () => body });

		const full = await withFetch(
			() => withBody(JSON.stringify({ status: 'OK', deploymentId: '23686246', warning: 'slow deploy' })),
			() => deployProcessDefinition(
				'demo-01-workflow.reltio.com', 'T', 'https://demo-01.reltio.com', 'tok', 'd', 'p.bpmn20.xml', '<x/>',
			),
		);
		assert.deepStrictEqual(full.result, { deploymentId: '23686246', warning: 'slow deploy' });

		const bare = await withFetch(
			() => withBody(JSON.stringify({ status: 'OK' })),
			() => deployProcessDefinition(
				'demo-01-workflow.reltio.com', 'T', 'https://demo-01.reltio.com', 'tok', 'd', 'p.bpmn20.xml', '<x/>',
			),
		);
		assert.deepStrictEqual(bare.result, { deploymentId: undefined, warning: undefined });

		const garbage = await withFetch(
			() => withBody('not json'),
			() => deployProcessDefinition(
				'demo-01-workflow.reltio.com', 'T', 'https://demo-01.reltio.com', 'tok', 'd', 'p.bpmn20.xml', '<x/>',
			),
		);
		assert.deepStrictEqual(
			garbage.result, {},
			'an unparseable body must not throw — it must be treated as no metadata',
		);
	}

	// ── 8. Error mapping ──────────────────────────────────────────────────────
	{
		let fetched = false;
		globalThis.fetch = async () => { fetched = true; return okResponse(); };
		await assert.rejects(
			() => deployProcessDefinition('https://evil.com', 'T', 'https://demo-01.reltio.com', 'tok', 'd', 'p.bpmn20.xml', '<x/>'),
			e => e instanceof UntrustedHostError,
			'an untrusted adapter host must be refused',
		);
		assert.strictEqual(fetched, false, 'fetch must not be called for an untrusted host');
		delete globalThis.fetch;

		for (const status of [401, 403, 404, 500]) {
			await assert.rejects(
				() => withFetch(() => errResponse(status), () =>
					deployProcessDefinition('demo-01-workflow.reltio.com', 'T', 'https://demo-01.reltio.com', 'tok', 'd', 'p.bpmn20.xml', '<x/>')),
				e => e instanceof ReltioApiError && e.statusCode === status,
				`HTTP ${status} must map to ReltioApiError with that status`,
			);
		}

		globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
		await assert.rejects(
			() => deployProcessDefinition('demo-01-workflow.reltio.com', 'T', 'https://demo-01.reltio.com', 'tok', 'd', 'p.bpmn20.xml', '<x/>'),
			e => e instanceof WorkflowConnectionError,
			'a network failure must map to WorkflowConnectionError',
		);
		delete globalThis.fetch;
	}

	// ── 9. Skeleton is escaped and executable ─────────────────────────────────
	{
		const xml = buildBpmnSkeleton('myProcess', 'A & B <hostile> "quoted"');
		assert.ok(xml.includes('id="myProcess"'), 'skeleton must carry the process id');
		assert.ok(xml.includes('isExecutable="true"'), 'skeleton must be executable');
		assert.ok(xml.includes('&amp;') && xml.includes('&lt;') && xml.includes('&quot;'),
			'display name must be XML-escaped');
		assert.ok(!/name="[^"]*<hostile>/.test(xml), 'raw markup must never survive into an attribute');
		assert.ok(xml.includes('<startEvent') && xml.includes('<userTask') && xml.includes('<endEvent'),
			'skeleton must be a complete start → task → end process');
	}

	// ── 10. Process-id validation ──────────────────────────────────────────────
	{
		for (const good of ['a', 'myProcess', '_x', 'a.b-c_1', 'A'.repeat(64)]) {
			assert.ok(isValidProcessId(good), `${JSON.stringify(good)} should be valid`);
			assert.strictEqual(processIdValidationMessage(good), undefined);
		}
		for (const bad of ['', ' ', '1abc', 'a b', '../x', 'a/b', 'a\\b', 'a"b', 'A'.repeat(65), 'ünicode']) {
			assert.ok(!isValidProcessId(bad), `${JSON.stringify(bad)} should be rejected`);
			assert.ok(
				typeof processIdValidationMessage(bad) === 'string',
				`${JSON.stringify(bad)} should produce a validation message`,
			);
		}
		assert.strictEqual(draftFileName('abc'), 'abc.bpmn20.xml');
		assert.strictEqual(processIdFromDraftFileName('abc.bpmn20.xml'), 'abc');
		assert.strictEqual(processIdFromDraftFileName('abc.xml'), undefined, 'wrong suffix is not a draft');
		assert.strictEqual(processIdFromDraftFileName('../x.bpmn20.xml'), undefined, 'traversal is not a draft');
	}

	// ── 11. Draft context round trip ──────────────────────────────────────────
	{
		const mgr = new EnvironmentManager(vscode.Uri.file('/ws'));
		const uri = mgr.getWorkflowDraftUri('demo-01.reltio.com', 'AcmeTenant', draftFileName('vipApproval'));
		const ctx = resolveDraftContext(uri.path);
		assert.deepStrictEqual(
			ctx,
			{ environmentName: 'demo-01.reltio.com', tenantId: 'AcmeTenant', processId: 'vipApproval' },
			`getWorkflowDraftUri → resolveDraftContext must round-trip, got ${JSON.stringify(ctx)}`,
		);

		// Anything that is not a draft in a tenant's workflows folder resolves to undefined,
		// so a stray editor tab can never be deployed at a tenant it has nothing to do with.
		for (const bad of [
			'/ws/demo-01.reltio.com.reltio.environment/AcmeTenant.reltio.tenant/L3.reltio.json',
			'/ws/AcmeTenant.reltio.tenant/workflows/vipApproval.bpmn20.xml',
			'/ws/demo-01.reltio.com.reltio.environment/AcmeTenant.reltio.tenant/vipApproval.bpmn20.xml',
			'/tmp/vipApproval.bpmn20.xml',
		]) {
			assert.strictEqual(resolveDraftContext(bad), undefined, `should not resolve: ${bad}`);
		}
	}

	// ── 12. Identity rewrite hits only the first process ──────────────────────
	{
		const xml = [
			'<?xml version="1.0"?>',
			'<definitions>',
			'  <process id="orig" name="Original" isExecutable="true">',
			'    <startEvent id="start" />',
			'  </process>',
			'  <process id="second" name="Second">',
			'  </process>',
			'</definitions>',
		].join('\n');

		const out = rewriteProcessIdentity(xml, 'origCopy', 'Original Copy');
		assert.ok(out.includes('id="origCopy"'), 'new id must be written');
		assert.ok(out.includes('name="Original Copy"'), 'new name must be written');
		assert.ok(out.includes('id="second"'), 'the second process must be untouched');
		assert.ok(out.includes('name="Second"'), 'the second process name must be untouched');
		assert.ok(out.includes('isExecutable="true"'), 'other attributes must survive the rewrite');
		assert.ok(!out.includes('id="orig"'), 'the original id must be gone');

		// Namespace-prefixed elements are the normal shape of an exported BPMN.
		const ns = '<bpmn:process id="a" name="A"></bpmn:process>';
		const nsOut = rewriteProcessIdentity(ns, 'b', 'B');
		assert.ok(nsOut.includes('<bpmn:process id="b" name="B">'), `namespace rewrite failed: ${nsOut}`);

		// Escaping applies here too — a display name is free text.
		assert.ok(
			rewriteProcessIdentity(ns, 'c', 'A & B').includes('name="A &amp; B"'),
			'rewritten name must be XML-escaped',
		);

		assert.strictEqual(
			rewriteProcessIdentity('<definitions></definitions>', 'x', 'X'),
			undefined,
			'XML with no <process> element must be refused, not silently returned unchanged',
		);
	}


	// ── 13. Tier B: commands and menu wiring ──────────────────────────────────
	{
		const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
		const declared = new Set((pkg.contributes.commands ?? []).map(c => c.command));
		const authoring = [
			'reltio.newWorkflowDraft',
			'reltio.duplicateWorkflowDraft',
			'reltio.deployWorkflow',
			'reltio.deleteWorkflowDraft',
		];
		for (const id of authoring) {
			assert.ok(declared.has(id), `package.json must declare command "${id}"`);
		}

		const menu = pkg.contributes.menus?.['view/item/context'] ?? [];

		// Every workflow action must be reachable by RIGHT-CLICK, not only as a
		// hover icon. A `group` of "inline" renders in the row's action bar and is
		// NOT shown in the context menu — shipping inline-only made five of these
		// actions invisible to anyone who right-clicks, which is how the rest of
		// this tree behaves. The repo's own pattern is to declare a command twice
		// (see reltio.fetchL3: "3_getconfig@01" plus "inline@1").
		const mustBeRightClickable = [
			'reltio.newWorkflowDraft',
			'reltio.duplicateWorkflowDraft',
			'reltio.deployWorkflow',
			'reltio.deleteWorkflowDraft',
			'reltio.refreshWorkflows',
			'reltio.openWorkflowBpmn',
			'reltio.copyJarModulePath',
		];
		for (const id of mustBeRightClickable) {
			const entries = menu.filter(m => m.command === id);
			assert.ok(entries.length > 0, `view/item/context must include an entry for "${id}"`);
			const contextEntries = entries.filter(e => !String(e.group ?? '').startsWith('inline'));
			assert.ok(
				contextEntries.length > 0,
				`"${id}" only has inline entries, so it never appears on right-click`,
			);
			for (const entry of entries) {
				assert.ok(
					String(entry.when ?? '').startsWith('view == reltioConfigTree &&'),
					`"${id}" when-clause must be scoped to the tree view, got: ${entry.when}`,
				);
			}
		}

		// Every workflow tree row should offer something on right-click.
		const contextValues = [
			'reltio.workflows.folder',
			'reltio.workflows.processDefinitions.folder',
			'reltio.workflows.processDefinition',
			'reltio.workflows.jarDeployments.folder',
			'reltio.workflows.jarDeployment',
			'reltio.workflows.drafts.folder',
			'reltio.workflows.draft',
		];
		for (const cv of contextValues) {
			const hit = menu.some(
				m => !String(m.group ?? '').startsWith('inline') && String(m.when ?? '').includes(cv),
			);
			assert.ok(hit, `no right-click action is offered on "${cv}" rows`);
		}

		// Deploy is also reachable from an open draft's editor title bar.
		const editorTitle = pkg.contributes.menus?.['editor/title'] ?? [];
		assert.ok(
			editorTitle.some(m => m.command === 'reltio.deployWorkflow' && /bpmn20/.test(String(m.when))),
			'editor/title must offer Deploy on a .bpmn20.xml file',
		);

		// Declared, menu'd and documented is not the same as implemented.
		// `reltio.copyJarModulePath` shipped with a command entry, two menu
		// entries and a mention in a bundled skill, but no registerCommand call —
		// so right-clicking a JAR and choosing it failed with "command not
		// found". Every assertion above passed while that was true, because they
		// all read package.json and none read the source.
		const sourceDir = path.join(__dirname, '..', 'src');
		const rawSource = (function readAll(dir) {
			return fs.readdirSync(dir, { withFileTypes: true }).reduce((acc, entry) => {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) return acc + readAll(full);
				return entry.name.endsWith('.ts') ? acc + fs.readFileSync(full, 'utf-8') : acc;
			}, '');
		})(sourceDir);
		// Most registrations put the id on its own line, so close the gap rather
		// than requiring the call and the id to be adjacent in the source.
		const sourceText = rawSource.replace(/registerCommand\(\s*/g, 'registerCommand(');

		for (const id of declared) {
			assert.ok(
				sourceText.includes(`registerCommand('${id}'`),
				`command "${id}" is declared in package.json but never registered in src/`,
			);
		}
	}

	// ── 14. Tier B: the test runner actually runs this script ─────────────────
	{
		const runner = fs.readFileSync(path.join(__dirname, 'run-unit-tests.cjs'), 'utf-8');
		assert.ok(
			runner.includes("'test-workflow-authoring.cjs'"),
			'test-workflow-authoring.cjs must be registered in the SCRIPTS array, or it never runs',
		);
	}


	// ── 15. BPMN comparison: normalisation ────────────────────────────────────
	// The engine re-serialises on deploy, so raw text comparison would report
	// "locally changed" on every definition from the moment it was fetched. These
	// pin what normalisation ignores and, just as importantly, what it must not.
	{
		const deployed = [
			'<?xml version="1.0" encoding="UTF-8"?>',
			'<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">',
			'  <process id="p" name="P" isExecutable="true">',
			'    <userTask id="t" name="Review" />',
			'  </process>',
			'</definitions>',
		].join('\n');

		// What an engine typically hands back: different indentation, a comment,
		// CRLF endings, a BOM, and a diagram block never present in the source.
		const reserialised =
			'\uFEFF' +
			'<?xml version="1.0" encoding="UTF-8"?>\r\n' +
			'<!-- generated -->\r\n' +
			'<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">\r\n' +
			'\t<process id="p" name="P" isExecutable="true">\r\n' +
			'\t\t<userTask id="t" name="Review" />\r\n' +
			'\t</process>\r\n' +
			'\t<bpmndi:BPMNDiagram id="d"><bpmndi:BPMNPlane/></bpmndi:BPMNDiagram>\r\n' +
			'</definitions>';

		assert.strictEqual(
			normalizeBpmn(deployed),
			normalizeBpmn(reserialised),
			'cosmetic re-serialisation must not read as a change, or the warning is worthless',
		);
		assert.ok(!normalizeBpmn(reserialised).includes('BPMNDiagram'), 'BPMNDI block must be stripped');
		assert.ok(!normalizeBpmn(reserialised).includes('generated'), 'comments must be stripped');
		assert.ok(!normalizeBpmn(reserialised).startsWith('\uFEFF'), 'BOM must be stripped');

		const edited = deployed.replace('name="Review"', 'name="Senior review"');
		assert.notStrictEqual(
			normalizeBpmn(deployed),
			normalizeBpmn(edited),
			'a genuine content change must survive normalisation',
		);
	}

	// ── 16. Local-change and server-drift detection ───────────────────────────
	{
		const base     = '<definitions><process id="p" name="P"/></definitions>';
		const cosmetic = '<definitions>\n  <process id="p" name="P"/>\n</definitions>';
		const real     = '<definitions><process id="p" name="Changed"/></definitions>';

		assert.strictEqual(hasLocalBpmnChanges(base, base), false, 'identical text is not a change');
		assert.strictEqual(hasLocalBpmnChanges(cosmetic, base), false, 'reindenting is not a change');
		assert.strictEqual(hasLocalBpmnChanges(real, base), true, 'an edited attribute is a change');
		assert.strictEqual(
			hasLocalBpmnChanges(base, undefined), false,
			'no baseline means never fetched — a draft, not an edit; callers distinguish those',
		);

		assert.strictEqual(remoteBpmnMatchesBaseline(base, cosmetic), true, 'server re-serialisation is not drift');
		assert.strictEqual(remoteBpmnMatchesBaseline(base, real), false, 'a real server-side edit is drift');
	}

	// ── 17. A baseline file is never mistaken for a draft ─────────────────────
	// Both live in workflows/. If a baseline parsed as a local BPMN, every
	// downloaded definition would also appear as a phantom draft.
	{
		assert.strictEqual(processIdFromBpmnFileName(bpmnFileName('vipApproval')), 'vipApproval');
		assert.strictEqual(
			processIdFromBpmnFileName(bpmnBaselineFileName('vipApproval')), undefined,
			'a .bpmn20.baseline.xml file must not parse as a local BPMN',
		);
		assert.strictEqual(processIdFromBpmnFileName('notes.txt'), undefined);
		assert.strictEqual(processIdFromBpmnFileName('.bpmn20.xml'), undefined, 'an empty process id is not valid');
	}

	// ── 18. guessWorkflowAdapterUrl: naming-convention guess, confirmed by
	//        reading the response body, not just trusting DNS or HTTP status ──
	// Response bodies below are the real ones observed live: a success list
	// carries `data`, a genuine Adapter error is `{status:"failed",error:{...}}`,
	// and the host that broke the "any HTTP response proves it" version of this
	// function (`geu-test-workflow.reltio.com`) returned an empty-body 404.
	{
		const { result, calls } = await withFetch(
			() => jsonResponse(200, { status: 'OK', data: [] }),
			() => guessWorkflowAdapterUrl('tst-01.reltio.com', 'T', 'https://tst-01.reltio.com', 'tok'),
		);
		assert.strictEqual(result, 'https://tst-01-workflow.reltio.com', 'must insert "-workflow" before the first dot');
		assert.ok(calls[0].url.startsWith('https://tst-01-workflow.reltio.com/'), `wrong probe host: ${calls[0].url}`);
	}
	{
		// A real Adapter that answers with its own error envelope (wrong tenant,
		// here) still proves the guess is right — this is the exact body
		// `na03-prod`/`na03-test`/`gca-prod`/`guk-prod` and others returned live.
		const { result } = await withFetch(
			() => jsonResponse(400, {
				status: 'failed',
				error: { errorCode: 10061, errorMessage: 'Tenant [x] is not registered.' },
			}),
			() => guessWorkflowAdapterUrl('na03-prod.reltio.com', 'x', 'https://na03-prod.reltio.com', 'tok'),
		);
		assert.strictEqual(result, 'https://na03-prod-workflow.reltio.com');
	}
	{
		// A Spring Security auth rejection is also a recognizable Adapter shape.
		const { result } = await withFetch(
			() => jsonResponse(401, { error: 'invalid_token', error_description: 'Token is invalid' }),
			() => guessWorkflowAdapterUrl('mpe-01.reltio.com', 'x', 'https://mpe-01.reltio.com', 'tok'),
		);
		assert.strictEqual(result, 'https://mpe-01-workflow.reltio.com');
	}
	{
		// The host resolves and answers HTTP, but with an empty body that is not
		// this service's shape at all — observed live at
		// geu-test-workflow.reltio.com. Must not be mistaken for a real Adapter
		// just because *something* answered.
		const { result } = await withFetch(
			() => ({ status: 404, ok: false, text: async () => '' }),
			() => guessWorkflowAdapterUrl('geu-test.reltio.com', 'x', 'https://geu-test.reltio.com', 'tok'),
		);
		assert.strictEqual(result, undefined, 'a non-Adapter-shaped body must not be mistaken for a real Adapter');
	}
	{
		globalThis.fetch = async () => { throw new Error('ENOTFOUND'); };
		const result = await guessWorkflowAdapterUrl(
			'eutst-01.reltio.com', 'T', 'https://eutst-01.reltio.com', 'tok',
		);
		delete globalThis.fetch;
		assert.strictEqual(result, undefined, 'a DNS/connection failure means the guess is wrong, not an error');
	}
	{
		const result = await guessWorkflowAdapterUrl('evil.com', 'T', 'https://evil.com', 'tok');
		assert.strictEqual(result, undefined, 'an untrusted guessed host must not be returned');
	}

	console.log('test-workflow-authoring: OK');
})().catch(e => {
	console.error(e);
	process.exit(1);
});
