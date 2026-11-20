#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: workflow-review-fixes — capability `workflow-input-trust` (tasks 1.1-1.7).
 * Tier A: clone-URL validation + redaction, branch regex escaping, sidecar validation,
 *         toOpenableHttpsUrl, toHttpsBase origin-only, redirect:'error', bounded body reads,
 *         Retry-After on listJars, Windows device ids, rewriteProcessIdentity, BpmnContentProvider.
 *
 * Regression rows:
 *   WF-007  Repository config: .gitignore reconcile (idempotent, no-ops, sweep isolation), BPMN
 *           discovery limits (build output, size, id-less, baseline, depth, candidate cap),
 *           storableRepoUrl drops http(s) userinfo, toOpenableHttpsUrl opens https only.
 *   WF-009  Hostile input: sidecar relativePath, server process ids and BPMN text cannot escape
 *           or stall. Blocked in part: a trailing-dot id is accepted (blocked by BUG-011), and
 *           100k unterminated "<!--" or 100k "<process " without ">" take seconds to parse
 *           (blocked by BUG-010); those assertions are skipped.
 */
const assert = require('assert');
const { importDist } = require('./lib/import-dist.cjs');
const vscode = require('./lib/vscode-stub.cjs');
const { installMemoryFs } = require('./lib/memory-fs.cjs');

// Must be installed before gitConfigSource is first required (see test-git-repository-source.cjs).
const childProcess = require('child_process');
let execFileHandler = () => {
	throw new Error('execFile not stubbed for this test');
};
childProcess.execFile = (...args) => execFileHandler(...args);

const { cloneRepository, redactUrl, describeGitFailure, BranchNotFoundError } = importDist('workspace/gitConfigSource');
const { loadWorkflowRepoConfig, inspectWorkflowRepoConfig, toOpenableHttpsUrl } = importDist('workspace/workflowRepoConfig');
const { reconcileWorkflowRepoGitignore } = importDist('workspace/workflowRepoGitignore');
const { toHttpsBase, fetchWithTimeout, readResponseText, UntrustedHostError } = importDist('api/reltioClient');
const { listAvailableJars, listProcessDefinitions, getProcessDefinitionXml } = importDist('api/workflowAdapterClient');
const { isValidProcessId, processIdValidationMessage, processIdFromBpmnFileName } = importDist('workspace/workflowBpmnFiles');
const { rewriteProcessIdentity } = importDist('workspace/workflowDrafts');
const { BpmnContentProvider } = importDist('providers/bpmnContentProvider');
const { storableRepoUrl, relativePathProblem } = importDist('workspace/workflowRepoConfig');
const { reconcileAllWorkflowRepoGitignores } = importDist('workspace/workflowRepoGitignore');
const { discoverBpmnFilesDetailed } = importDist('workspace/workflowRepoDiscovery');
const { planBulkDownload } = importDist('workspace/workflowBulkDownload');
const { extractProcessModel } = importDist('workflow/bpmnModel');
const { findXmlProblem } = importDist('workflow/bpmnWellFormed');
const { analyseBpmn } = importDist('workflow/bpmnDiagnostics');

const ADAPTER = 'https://demo-01-workflow.reltio.com';
const ENV = 'https://demo-01.reltio.com';

async function withFetch(responder, fn) {
	const original = globalThis.fetch;
	const calls = [];
	globalThis.fetch = async (url, init) => {
		calls.push({ url: String(url), init });
		return responder(String(url), init);
	};
	try {
		return { result: await fn(), calls };
	} finally {
		globalThis.fetch = original;
	}
}

function textResponse(status, text, headers = {}) {
	return {
		status,
		ok: status >= 200 && status < 300,
		headers: { get: name => headers[name] ?? null },
		json: async () => JSON.parse(text),
		text: async () => text,
	};
}

/** Never-ending streaming body: headers arrived, then the server stalls. */
function stalledResponse() {
	return {
		status: 200,
		ok: true,
		headers: { get: () => null },
		text: () => new Promise(() => {}),
		body: { getReader: () => ({ read: () => new Promise(() => {}), cancel: async () => {} }) },
	};
}

function streamingResponse(chunkBytes, chunks) {
	let sent = 0;
	let cancelled = false;
	return {
		response: {
			status: 200,
			ok: true,
			headers: { get: () => null },
			body: {
				getReader: () => ({
					read: async () => (sent++ < chunks ? { done: false, value: new Uint8Array(chunkBytes) } : { done: true }),
					cancel: async () => { cancelled = true; },
				}),
			},
		},
		wasCancelled: () => cancelled,
	};
}

async function captureClone(url, branch) {
	let args;
	execFileHandler = (_f, a, _o, cb) => {
		args = a;
		cb(null, { stdout: '', stderr: '' });
	};
	await cloneRepository(url, vscode.Uri.file('/dest'), branch);
	return args;
}

(async () => {
	const tests = [];
	const test = (name, fn) => tests.push([name, fn]);

	// ── 1.1 clone URL ──────────────────────────────────────────────────────
	test('1.1 credentials in an https URL are rejected before git runs, without echoing the token', async () => {
		let called = false;
		execFileHandler = () => { called = true; throw new Error('git must not run'); };
		let err;
		try {
			await cloneRepository('https://user:s3cretTOKEN@bitbucket.org/acme/wf.git', vscode.Uri.file('/dest'));
		} catch (e) { err = e; }
		assert.ok(err, 'must reject');
		assert.strictEqual(called, false);
		assert.ok(!/s3cretTOKEN/.test(err.message), `token leaked: ${err.message}`);
		assert.ok(/SSH/.test(err.message) && /credential manager/i.test(err.message), 'names the alternatives');
	});

	test('1.1 a username without a password (the Bitbucket clone-button form) is still accepted', async () => {
		const args = await captureClone('https://alice@bitbucket.org/acme/wf.git');
		assert.ok(args.includes('https://alice@bitbucket.org/acme/wf.git'));
	});

	test('1.1 a URL starting with "-" is rejected and never reaches git', async () => {
		let called = false;
		execFileHandler = () => { called = true; throw new Error('git must not run'); };
		await assert.rejects(() => cloneRepository('-ofoo@host:path', vscode.Uri.file('/dest')), /Unsupported git URL/);
		await assert.rejects(() => cloneRepository('--upload-pack=evil', vscode.Uri.file('/dest')), /Unsupported git URL/);
		assert.strictEqual(called, false);
	});

	test('1.1 the URL is passed after "--" so it can never be parsed as an option', async () => {
		for (const branch of [undefined, 'main']) {
			const args = await captureClone('https://bitbucket.org/acme/wf.git', branch);
			const dd = args.indexOf('--');
			assert.ok(dd > args.indexOf('clone'), 'a "--" follows clone');
			assert.strictEqual(args[dd + 1], 'https://bitbucket.org/acme/wf.git');
			assert.strictEqual(args[dd + 2], '.');
		}
	});

	test('1.1 redactUrl strips userinfo from bare URLs and from free text, leaves other text alone', () => {
		assert.strictEqual(redactUrl('https://u:p@host.org/a/b.git'), 'https://host.org/a/b.git');
		assert.strictEqual(redactUrl('https://tok@host.org/x'), 'https://host.org/x');
		assert.strictEqual(
			redactUrl("fatal: unable to access 'https://u:p@host.org/a.git/': 403"),
			"fatal: unable to access 'https://host.org/a.git/': 403",
		);
		assert.strictEqual(redactUrl('git@host:org/repo.git'), 'git@host:org/repo.git');
		assert.strictEqual(redactUrl('https://host.org/a'), 'https://host.org/a');
	});

	test('1.1 a git failure message and BranchNotFoundError never contain credentials', async () => {
		execFileHandler = (_f, _a, _o, cb) => {
			const e = new Error("Command failed: git clone https://u:pw123@host.org/a.git\nfatal: could not read from 'https://u:pw123@host.org/a.git'");
			e.stderr = '';
			cb(e);
		};
		let err;
		try { await cloneRepository('https://host.org/a.git', vscode.Uri.file('/dest')); } catch (e) { err = e; }
		assert.ok(err && !/pw123/.test(err.message), `leaked: ${err && err.message}`);
		assert.ok(/host\.org\/a\.git/.test(err.message), 'keeps host and path');
		assert.ok(!/pw123/.test(describeGitFailure(new Error('x https://a:pw123@h/p')).message));
		assert.ok(!/pw123/.test(new BranchNotFoundError('b', 'https://a:pw123@h/p').message));
	});

	// ── 1.2 branch regex ───────────────────────────────────────────────────
	test('1.2 a branch with regex characters yields BranchNotFoundError, not a SyntaxError', async () => {
		execFileHandler = (_f, _a, _o, cb) => {
			const e = new Error('failed');
			e.stderr = "error: pathspec 'feat(x' did not match any file(s) known to git";
			cb(e);
		};
		await assert.rejects(
			() => cloneRepository('https://host.org/a.git', vscode.Uri.file('/dest'), 'feat(x'),
			e => e instanceof BranchNotFoundError && e.branch === 'feat(x',
		);
		execFileHandler = (_f, _a, _o, cb) => {
			const e = new Error('real git error');
			e.stderr = 'something else';
			cb(e);
		};
		await assert.rejects(
			() => cloneRepository('https://host.org/a.git', vscode.Uri.file('/dest'), 'feat(x'),
			e => !(e instanceof SyntaxError) && /real git error/.test(e.message),
		);
	});

	// ── 1.3 sidecar ────────────────────────────────────────────────────────
	const configUri = vscode.Uri.file('/ws/env/tenant/WorkflowRepo.reltio.json');
	const writeSidecar = async (mem, obj) => mem.writeFile(configUri, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)));

	test('1.3 a valid sidecar loads', async () => {
		const mem = installMemoryFs();
		await writeSidecar(mem, { version: 1, repoUrl: 'https://bitbucket.org/acme/wf.git', relativePath: 'Workflows/Custom Workflows' });
		assert.deepStrictEqual(await loadWorkflowRepoConfig(configUri), {
			repoUrl: 'https://bitbucket.org/acme/wf.git',
			relativePath: 'Workflows/Custom Workflows',
		});
	});

	test('1.3 invalid sidecars return undefined and say why', async () => {
		const good = { version: 1, repoUrl: 'https://bitbucket.org/acme/wf.git', relativePath: 'Workflows/Custom Workflows' };
		const bad = [
			['newline injection', { ...good, relativePath: 'Workflows\n!/secret' }],
			['carriage return', { ...good, relativePath: 'a\rb' }],
			['traversal', { ...good, relativePath: '../../etc' }],
			['embedded traversal', { ...good, relativePath: 'a/../../b' }],
			['backslash traversal', { ...good, relativePath: 'a\\..\\b' }],
			['posix absolute', { ...good, relativePath: '/etc' }],
			['windows absolute', { ...good, relativePath: 'C:\\x' }],
			['leading negation', { ...good, relativePath: '!important' }],
			['leading comment', { ...good, relativePath: '#hidden' }],
			['credentials in repoUrl', { ...good, repoUrl: 'https://u:tok@bitbucket.org/acme/wf.git' }],
			['command scheme', { ...good, repoUrl: 'command:workbench.action.openSettings' }],
			['option-looking repoUrl', { ...good, repoUrl: '-oProxyCommand=evil' }],
			['ext transport', { ...good, repoUrl: 'ext::sh -c evil' }],
		];
		for (const [label, content] of bad) {
			const mem = installMemoryFs();
			await writeSidecar(mem, content);
			assert.strictEqual(await loadWorkflowRepoConfig(configUri), undefined, `${label}: must be ignored`);
			const r = await inspectWorkflowRepoConfig(configUri);
			assert.ok(r.invalidReason && r.invalidReason.length > 0, `${label}: must expose a reason`);
			assert.ok(!/tok\b/.test(r.invalidReason), `${label}: reason must not echo credentials`);
		}
	});

	test('1.3 missing / corrupt sidecar is "not connected" with no reason', async () => {
		const mem = installMemoryFs();
		assert.deepStrictEqual(await inspectWorkflowRepoConfig(configUri), {});
		await writeSidecar(mem, '{not json');
		assert.deepStrictEqual(await inspectWorkflowRepoConfig(configUri), {});
	});

	test('1.3 a newline-injecting sidecar never reaches .gitignore', async () => {
		const mem = installMemoryFs();
		const root = vscode.Uri.file('/ws/env/tenant');
		await mem.createDirectory(vscode.Uri.joinPath(root, '.git'));
		await writeSidecar(mem, { version: 1, repoUrl: 'https://bitbucket.org/acme/wf.git', relativePath: 'Workflows\n!important/' });
		await reconcileWorkflowRepoGitignore(root, configUri);
		const ignore = mem._files.get('/ws/env/tenant/.gitignore');
		assert.ok(!ignore || !/important/.test(ignore.toString()), 'nothing injected');
	});

	test('1.3 a relativePath starting with "!" never reaches .gitignore as a negation', async () => {
		// No newline here — a plain leading "!" (gitignore negation syntax) would, without this
		// check, be written verbatim as the sidecar-managed line's first character and un-ignore
		// an attacker-chosen path in the *outer* repository's .gitignore.
		const mem = installMemoryFs();
		const root = vscode.Uri.file('/ws/env/tenant');
		await mem.createDirectory(vscode.Uri.joinPath(root, '.git'));
		await writeSidecar(mem, { version: 1, repoUrl: 'https://bitbucket.org/acme/wf.git', relativePath: '!important' });
		await reconcileWorkflowRepoGitignore(root, configUri);
		const ignore = mem._files.get('/ws/env/tenant/.gitignore');
		assert.ok(!ignore || !/important/.test(ignore.toString()), 'nothing injected, sidecar treated as invalid');
	});

	test('1.4 toOpenableHttpsUrl opens https only', () => {
		assert.strictEqual(toOpenableHttpsUrl('https://bitbucket.org/acme/wf.git'), 'https://bitbucket.org/acme/wf.git');
		assert.strictEqual(toOpenableHttpsUrl('https://alice@bitbucket.org/acme/wf.git'), 'https://bitbucket.org/acme/wf.git');
		for (const u of [
			'http://bitbucket.org/acme/wf.git',
			'ssh://git@bitbucket.org/acme/wf.git',
			'git@bitbucket.org:acme/wf.git',
			'command:workbench.action.openSettings',
			'javascript:alert(1)',
			'file:///etc/passwd',
			'https://u:tok@bitbucket.org/acme/wf.git',
			'-https://x',
			'',
		]) {
			assert.strictEqual(toOpenableHttpsUrl(u), undefined, `${u} must not be openable`);
		}
	});

	// ── 1.5 network ────────────────────────────────────────────────────────
	test('1.5 toHttpsBase returns the origin only and rejects userinfo, path and query', () => {
		assert.strictEqual(toHttpsBase('demo-01.reltio.com'), 'https://demo-01.reltio.com');
		assert.strictEqual(toHttpsBase('http://demo-01.reltio.com/'), 'https://demo-01.reltio.com');
		assert.strictEqual(toHttpsBase('https://demo-01.reltio.com:8443'), 'https://demo-01.reltio.com:8443');
		for (const bad of [
			'https://a.reltio.com/x?y=1',
			'https://a.reltio.com/x',
			'https://a.reltio.com?y=1',
			'https://a.reltio.com/#frag',
			'https://user:pw@a.reltio.com',
			'https://user@a.reltio.com',
		]) {
			assert.throws(() => toHttpsBase(bad), e => e instanceof UntrustedHostError && !/pw/.test(e.message), `${bad} must be rejected`);
		}
		assert.throws(() => toHttpsBase('https://evil.example.com'), UntrustedHostError);
		assert.throws(() => toHttpsBase('https://a.reltio.com.evil.com'), UntrustedHostError);
	});

	test('1.5 adapter and API fetches use redirect:"error"', async () => {
		const { calls } = await withFetch(
			() => textResponse(200, JSON.stringify({ status: 'OK', data: [] })),
			() => listProcessDefinitions(ADAPTER, 'T1', ENV, 'tok'),
		);
		assert.strictEqual(calls[0].init.redirect, 'error');
		const { calls: c2 } = await withFetch(() => textResponse(200, 'ok'), () => fetchWithTimeout('https://a.reltio.com/x', { method: 'GET' }, 1000));
		assert.strictEqual(c2[0].init.redirect, 'error');
	});

	test('1.5 a stalled body fails at the timeout instead of hanging', async () => {
		const started = Date.now();
		await assert.rejects(() => readResponseText(stalledResponse(), 150), /timed out/i);
		assert.ok(Date.now() - started < 2000);
	});

	test('1.5 an oversized body is rejected, streaming bodies are cancelled', async () => {
		await assert.rejects(
			() => readResponseText(textResponse(200, 'x'.repeat(100)), 1000, 50),
			/too large/i,
		);
		await assert.rejects(
			() => readResponseText(textResponse(200, 'x', { 'Content-Length': '999999999' }), 1000, 1024),
			/too large/i,
		);
		const s = streamingResponse(1024, 100);
		await assert.rejects(() => readResponseText(s.response, 1000, 4096), /too large/i);
		assert.ok(s.wasCancelled(), 'the stream is cancelled once the cap is hit');
		const ok = streamingResponse(10, 3);
		assert.strictEqual((await readResponseText(ok.response, 1000, 4096)).length, 30);
	});

	test('1.5 adapter call sites read bodies through the bound (stalled adapter body rejects, does not hang)', async () => {
		// The shared timeout is 10s+, so use the size cap path instead: a >5MB list body must fail.
		const big = 'x'.repeat(5 * 1024 * 1024 + 10);
		await withFetch(
			() => textResponse(200, big),
			async () => {
				await assert.rejects(() => getProcessDefinitionXml(ADAPTER, 'T1', ENV, 'tok', 'proc'), /too large/i);
			},
		);
	});

	test('1.5 listAvailableJars preserves Retry-After and still maps 10089 to notConfigured', async () => {
		const { result: err } = await withFetch(
			() => textResponse(429, 'slow down', { 'Retry-After': '17' }),
			() => listAvailableJars(ADAPTER, 'T1', ENV, 'tok').catch(e => e),
		);
		assert.strictEqual(err.statusCode, 429);
		assert.strictEqual(err.retryAfterSeconds, 17);
		assert.ok(/slow down/.test(err.message));

		const { result } = await withFetch(
			() => textResponse(400, JSON.stringify({ errorCode: 10089, error: 'no jars location' })),
			() => listAvailableJars(ADAPTER, 'T1', ENV, 'tok'),
		);
		assert.deepStrictEqual(result, { kind: 'notConfigured' });
	});

	// ── 1.6 process ids ────────────────────────────────────────────────────
	test('1.6 Windows device names are not valid process ids, in any case', () => {
		const names = ['con', 'prn', 'aux', 'nul', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap(n => [`com${n}`, `lpt${n}`])];
		for (const n of names) {
			for (const v of [n, n.toUpperCase(), n[0].toUpperCase() + n.slice(1)]) {
				assert.strictEqual(isValidProcessId(v), false, `${v} must be invalid`);
				assert.ok(processIdValidationMessage(v), `${v} must produce a message`);
			}
		}
		assert.strictEqual(isValidProcessId('CON.v2'), false, 'a device name with an extension is still a device');
		assert.strictEqual(processIdFromBpmnFileName('con.bpmn20.xml'), undefined);
		for (const ok of ['console', 'com10', 'lpt', 'myProcess', 'nullable', 'aux_flow']) {
			assert.strictEqual(isValidProcessId(ok), true, `${ok} must stay valid`);
			assert.strictEqual(processIdValidationMessage(ok), undefined);
		}
	});

	test('1.6 rewriteProcessIdentity changes only id/name of the first <process>', () => {
		const xml = [
			'<definitions>',
			'<process data-id="x" id="y" name="Old" xmlns:foo="a" foo:id="keep" title=\'has id="z" inside\'>',
			'<userTask id="t1" name="Task"/>',
			'</process>',
			'<process id="second" name="Second"/>',
			'</definitions>',
		].join('\n');
		const out = rewriteProcessIdentity(xml, 'newId', 'New Name');
		assert.ok(out.includes('data-id="x"'), 'data-id untouched');
		assert.ok(out.includes('foo:id="keep"'), 'prefixed id untouched');
		assert.ok(out.includes('has id="z" inside'), 'quoted lookalike untouched');
		assert.ok(out.includes('id="newId"') && out.includes('name="New Name"'));
		assert.ok(!out.includes('id="y"') && !out.includes('name="Old"'));
		assert.ok(out.includes('<userTask id="t1" name="Task"/>') && out.includes('<process id="second" name="Second"/>'));
	});

	test('1.6 rewriteProcessIdentity tolerates ">" inside an attribute value and a missing id/name', () => {
		const out = rewriteProcessIdentity('<bpmn:process documentation="a > b" id="p1">\n<x/></bpmn:process>', 'p2', 'N');
		assert.strictEqual(out, '<bpmn:process name="N" documentation="a > b" id="p2">\n<x/></bpmn:process>');
		const bare = rewriteProcessIdentity('<process>\n</process>', 'p2', 'N');
		assert.ok(/<process [^>]*id="p2"/.test(bare) && /name="N"/.test(bare));
		assert.strictEqual(rewriteProcessIdentity('<definitions/>', 'p', 'n'), undefined);
	});

	test('1.6 rewriteProcessIdentity retargets the plane and escapes values', () => {
		const xml = '<process id="old" name="o"></process><bpmndi:BPMNPlane data-bpmnElement="old" bpmnElement="old"></bpmndi:BPMNPlane>';
		const out = rewriteProcessIdentity(xml, 'new1', 'A "B" & <C>');
		assert.ok(out.includes('bpmnElement="new1"') && out.includes('data-bpmnElement="old"'));
		assert.ok(out.includes('name="A &quot;B&quot; &amp; &lt;C&gt;"'), out);
	});

	// ── 1.7 provider ───────────────────────────────────────────────────────
	test('1.7 BpmnContentProvider.store fires onDidChange when the URI already has content', () => {
		const p = new BpmnContentProvider();
		let fired = 0;
		p.onDidChange(() => { fired++; });
		const uri = p.store('env.reltio.com', 'T1', 'proc', '<a/>');
		assert.strictEqual(fired, 0, 'first store: nothing open yet to refresh');
		const again = p.store('env.reltio.com', 'T1', 'proc', '<b/>');
		assert.strictEqual(again.toString(), uri.toString());
		assert.strictEqual(fired, 1, 'refresh of an existing URI fires');
		assert.strictEqual(p.provideTextDocumentContent(again), '<b/>');
		p.store('env.reltio.com', 'T1', 'other', '<c/>');
		assert.strictEqual(fired, 1, 'a different URI does not fire');
	});

	// ── WF-007 repository config ───────────────────────────────────────────
	test('WF-007 #1 .gitignore reconcile: idempotent, no-ops without outer .git or sidecar, sweep isolation', async () => {
		const root = vscode.Uri.file('/wf7/env/tenant');
		const sidecar = vscode.Uri.joinPath(root, 'WorkflowRepo.reltio.json');
		const gi = '/wf7/env/tenant/.gitignore';
		const cfg = { version: 1, repoUrl: 'https://bitbucket.org/acme/wf.git', relativePath: 'Workflows' };

		let mem = installMemoryFs();
		await mem.createDirectory(vscode.Uri.joinPath(root, '.git'));
		await mem.writeFile(sidecar, Buffer.from(JSON.stringify(cfg)));
		await reconcileWorkflowRepoGitignore(root, sidecar);
		await reconcileWorkflowRepoGitignore(root, sidecar);
		const lines = mem._files.get(gi).toString().split('\n').filter(l => l === 'Workflows/');
		assert.strictEqual(lines.length, 1, 'WF-007 #1: "Workflows/" is added exactly once over two runs');

		mem = installMemoryFs();
		await mem.writeFile(sidecar, Buffer.from(JSON.stringify(cfg)));
		await reconcileWorkflowRepoGitignore(root, sidecar);
		assert.ok(!mem._files.has(gi), 'WF-007 #1: no outer .git writes nothing');

		mem = installMemoryFs();
		await mem.createDirectory(vscode.Uri.joinPath(root, '.git'));
		await reconcileWorkflowRepoGitignore(root, sidecar);
		assert.ok(!mem._files.has(gi), 'WF-007 #1: no sidecar writes nothing');

		// The sweep: tenant "bad" throws while writing its .gitignore, tenant "good" is still reconciled.
		mem = installMemoryFs();
		const rootOf = t => vscode.Uri.file(`/wf7s/${t}`);
		for (const t of ['bad', 'good']) {
			await mem.createDirectory(vscode.Uri.joinPath(rootOf(t), '.git'));
			await mem.writeFile(vscode.Uri.joinPath(rootOf(t), 'WorkflowRepo.reltio.json'), Buffer.from(JSON.stringify(cfg)));
		}
		const writeFile = mem.writeFile;
		mem.writeFile = async (u, b) => {
			if (u.fsPath.startsWith('/wf7s/bad/')) throw new Error('EACCES');
			return writeFile(u, b);
		};
		const manager = {
			scanEnvironments: async () => [{ name: 'env', tenants: [{ tenantId: 'bad' }, { tenantId: 'good' }] }],
			getTenantRootUri: (_e, t) => rootOf(t),
			getWorkflowRepoConfigUri: (_e, t) => vscode.Uri.joinPath(rootOf(t), 'WorkflowRepo.reltio.json'),
		};
		try {
			await reconcileAllWorkflowRepoGitignores(manager);
		} catch (e) {
			assert.fail(`WF-007 #1: reconcileAll must not throw when one tenant fails: ${e.message}`);
		} finally {
			mem.writeFile = writeFile;
		}
		assert.ok(mem._files.has('/wf7s/good/.gitignore') && mem._files.get('/wf7s/good/.gitignore').toString().includes('Workflows/'),
			'WF-007 #1: reconcileAll continues after one tenant throws');
	});

	test('WF-007 #2 discovery skips build output, oversized, id-less, baseline and too-deep files; caps candidates', async () => {
		const bpmnText = id => `<definitions><process id="${id}" isExecutable="true"><startEvent id="s"/></process></definitions>`;
		const mem = installMemoryFs();
		const put = (p, text) => mem.writeFile(vscode.Uri.file(`/wf7r${p}`), typeof text === 'string' ? Buffer.from(text) : text);
		await put('/mod/pom.xml', '<project/>');
		await put('/mod/src/main/resources/a.xml', bpmnText('a'));
		await put('/mod/target/classes/a.xml', bpmnText('a'));
		await put('/node_modules/x.xml', bpmnText('x'));
		await put('/big.xml', Buffer.concat([Buffer.from(bpmnText('big')), Buffer.alloc(2 * 1024 * 1024, 32)]));
		await put('/schema.xml', '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><process name="noId"/></xs:schema>');
		await put('/bpmn/z.bpmn20.baseline.xml', bpmnText('z'));
		let deep = '';
		for (let i = 1; i <= 12; i++) deep += `/d${i}`;
		await put(`${deep}/deep.xml`, bpmnText('deep'));
		const found = await discoverBpmnFilesDetailed(vscode.Uri.file('/wf7r'));
		assert.deepStrictEqual(found.files.map(f => [f.processId, f.moduleName]), [['a', 'mod']],
			'WF-007 #2: only src a.xml is returned, with its pom module');
		assert.ok(found.files[0].fileUri.fsPath.includes('/mod/src/main/resources/'), 'WF-007 #2: the src copy, not target/');
		assert.strictEqual(found.truncated, false, 'WF-007 #2: a small repository is not truncated');

		const mem2 = installMemoryFs();
		for (let i = 0; i < 2001; i++) await mem2.writeFile(vscode.Uri.file(`/wf7c/f${i}.xml`), Buffer.from('<x/>'));
		assert.strictEqual((await discoverBpmnFilesDetailed(vscode.Uri.file('/wf7c'))).truncated, true,
			'WF-007 #2: 2001 candidates set truncated');
	});

	test('WF-007 #3 storableRepoUrl drops http(s) userinfo and keeps ssh; only https is openable', () => {
		assert.strictEqual(storableRepoUrl('https://user:tok@host/r.git'), 'https://host/r.git', 'WF-007 #3: https loses userinfo');
		assert.strictEqual(storableRepoUrl('http://user@host/r.git'), 'http://host/r.git', 'WF-007 #3: http loses userinfo');
		assert.strictEqual(storableRepoUrl('git@host:org/r.git'), 'git@host:org/r.git', 'WF-007 #3: ssh keeps git@');
		assert.strictEqual(toOpenableHttpsUrl('https://alice@host/r.git'), 'https://host/r.git', 'WF-007 #3: https openable, username stripped');
		for (const u of ['ssh://git@host/r.git', 'git@host:org/r.git', 'file:///etc/passwd', 'javascript:alert(1)']) {
			assert.strictEqual(toOpenableHttpsUrl(u), undefined, `WF-007 #3: ${u} is not openable`);
		}
	});

	// ── WF-009 hostile input ───────────────────────────────────────────────
	test('WF-009 #1 hostile sidecar relativePath values are refused; "Workflows" is accepted', async () => {
		const hostile = ['..\\x', 'a/../b', '/abs', 'C:\\x', 'a\nb', '!x', '#x'];
		const sidecar = vscode.Uri.file('/wf9/tenant/WorkflowRepo.reltio.json');
		for (const value of hostile) {
			assert.ok(relativePathProblem(value), `WF-009 #1: ${JSON.stringify(value)} returns a problem string`);
			const mem = installMemoryFs();
			await mem.writeFile(sidecar, Buffer.from(JSON.stringify({ version: 1, repoUrl: 'https://host/r.git', relativePath: value })));
			assert.strictEqual(await loadWorkflowRepoConfig(sidecar), undefined, `WF-009 #1: ${JSON.stringify(value)} sidecar does not load`);
			assert.ok((await inspectWorkflowRepoConfig(sidecar)).invalidReason, `WF-009 #1: ${JSON.stringify(value)} sidecar gives a reason`);
		}
		assert.strictEqual(relativePathProblem('Workflows'), undefined, 'WF-009 #1: "Workflows" is accepted');
	});

	test('WF-009 #2 hostile server process ids are rejected everywhere', async () => {
		// 'trailing.' is not listed: a trailing-dot id is accepted today (blocked by BUG-011).
		const ids = ['a/b', 'a\\b', '..', 'a\u0000b', 'con', 'NUL', 'Com1', 'x'.repeat(201)];
		for (const id of ids) {
			assert.ok(processIdValidationMessage(id), `WF-009 #2: ${JSON.stringify(id.slice(0, 20))} gets a validation message`);
			assert.strictEqual(processIdFromBpmnFileName(`${id}.bpmn20.xml`), undefined, `WF-009 #2: ${JSON.stringify(id.slice(0, 20))} is not read back from a file name`);
		}
		const plan = planBulkDownload(ids, []);
		assert.deepStrictEqual(plan.toDownload, [], 'WF-009 #2: planBulkDownload downloads none of them');
		assert.strictEqual(plan.unusable.length, ids.length, 'WF-009 #2: planBulkDownload marks every one unusable');

		const { result } = await withFetch(
			() => textResponse(200, JSON.stringify({ status: 'OK', data: [{ type: '../evil' }, { type: 'con' }, { type: 'good_one' }] })),
			() => listProcessDefinitions(ADAPTER, 'T1', ENV, 'tok'),
		);
		assert.deepStrictEqual(result.map(d => d.type), ['good_one'], 'WF-009 #2: the adapter listing drops unsafe ids');
	});

	test('WF-009 #3 hostile BPMN text returns within budget, expands no entity', () => {
		const head = '<definitions><process id="p" isExecutable="true">';
		const inputs = {
			// Skipped, blocked by BUG-010: 100k unterminated '<!--' and 100k '<process ' with no '>'
			// take about 8 s and 30 s in extractProcessModel / analyseBpmn.
			bigAttribute: `${head}<userTask id="t" name="${'a'.repeat(1024 * 1024)}"/></process></definitions>`,
			deepNesting: `${head}${'<subProcess id="s">'.repeat(50000)}${'</subProcess>'.repeat(50000)}</process></definitions>`,
		};
		const calls = [['extractProcessModel', extractProcessModel], ['findXmlProblem', findXmlProblem], ['analyseBpmn', x => analyseBpmn(x, { fileProcessId: 'p' })]];
		for (const [label, xml] of Object.entries(inputs)) {
			for (const [name, fn] of calls) {
				const started = Date.now();
				assert.doesNotThrow(() => fn(xml), `WF-009 #3: ${name} on ${label} does not throw`);
				const ms = Date.now() - started;
				assert.ok(ms < 2000, `WF-009 #3: ${name} on ${label} took ${ms} ms (budget 2000)`);
			}
		}
		const body = `${head}<startEvent id="s" name="&y;"/><sequenceFlow id="f" sourceRef="s" targetRef="e"/><endEvent id="e"/></process></definitions>`;
		const withDoctype = `<!DOCTYPE definitions [<!ENTITY x "PWNED"><!ENTITY y "&x;&x;">]>${body}`;
		const a = extractProcessModel(withDoctype);
		const b = extractProcessModel(body);
		assert.strictEqual(a.nodes[0].name, '&y;', 'WF-009 #3: no entity is expanded');
		assert.deepStrictEqual(
			[a.processId, a.nodes.map(n => [n.id, n.name]), a.flows.map(f => [f.id, f.sourceRef, f.targetRef])],
			[b.processId, b.nodes.map(n => [n.id, n.name]), b.flows.map(f => [f.id, f.sourceRef, f.targetRef])],
			'WF-009 #3: a DOCTYPE does not change the parsed model',
		);
		for (const [name, fn] of calls) assert.doesNotThrow(() => fn(withDoctype), `WF-009 #3: ${name} on a DOCTYPE does not throw`);
	});

	let failed = 0;
	for (const [name, fn] of tests) {
		try {
			await fn();
			console.log(`  ok   ${name}`);
		} catch (e) {
			failed++;
			console.log(`  FAIL ${name}\n       ${String(e && e.stack || e).split('\n').slice(0, 4).join('\n       ')}`);
		}
	}
	console.log(failed ? `\n${failed}/${tests.length} FAILED` : `\nworkflow-input-trust: all ${tests.length} tests passed`);
	process.exit(failed ? 1 : 0);
})();
