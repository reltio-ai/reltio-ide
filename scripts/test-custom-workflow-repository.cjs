#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: custom-workflow-repository (Part 3)
 *
 * Tier A — pure logic, with a real in-memory filesystem (`createMemoryFs()`, mirrored
 *   from `test-git-ready-tenant-folder-structure.cjs`) standing in for `vscode.workspace.fs`
 *   so directory discovery is genuine, not hand-listed:
 *   1. `discoverBpmnFiles()`: content-driven gate (D4) — extension alone is never
 *      enough, a non-empty `<process id>` is required; dotfolder skip; the
 *      depth limit shared with `l3Discovery.ts`.
 *   2. `resolveRepoBpmnContext()`: round trip via `EnvironmentManager.locFromPath()`,
 *      the legacy-suffix fallback (D6, mirroring `resolveDraftContext`'s own),
 *      and the negative cases (wrong folder, no process id, no locatable tenant).
 *   3. `compareBpmnContent()`: both states (D5), byte-exact.
 *   4. Sidecar (`workflowRepoConfig.ts`): read/write round trip, every tolerant-
 *      failure case, and D9's always-overwrite behavior.
 *   5. D10's reconciliation check, both connection orders, idempotency, the
 *      alternate-spelling match, and the no-op cases — plus a mutation-check
 *      that a single tenant's failure cannot block the rest of the sweep.
 *
 * Tier B — structural: the five new commands declared in package.json,
 *   registered in `src/`, and reachable by right-click with correctly scoped
 *   `when` clauses; this script registered in the test runner.
 *
 * Tier C (manual) — documented in design.md's own test plan (10.1–10.6).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');
const vscode = require('./lib/vscode-stub.cjs');

const { discoverBpmnFiles, resolveRepoBpmnContext } = importDist('workspace/workflowRepoDiscovery');
const { compareBpmnContent } = importDist('workspace/workflowRepoSync');
const {
	loadWorkflowRepoConfig,
	saveWorkflowRepoConfig,
	deleteWorkflowRepoConfig,
} = importDist('workspace/workflowRepoConfig');
const {
	reconcileWorkflowRepoGitignore,
	reconcileAllWorkflowRepoGitignores,
} = importDist('workspace/workflowRepoGitignore');
const { EnvironmentManager } = importDist('workspace/environmentManager');

const FileType = vscode.FileType;

// ─── In-memory filesystem, mirrored from test-git-ready-tenant-folder-structure.cjs ──
// Kept local rather than shared: a generic vscode.workspace.fs stand-in, not specific
// to either OpenSpec change, but not (yet) promoted to scripts/lib/ either.

/** Directory set + file map keyed by the stub Uri's `fsPath`, normalized to forward slashes. */
function createMemoryFs() {
	const dirs = new Set();
	const files = new Map();
	const norm = u => (typeof u === 'string' ? u : u.fsPath).replace(/\\/g, '/').replace(/\/+$/, '');

	const api = {
		_dirs: dirs,
		_files: files,
		async createDirectory(uri) {
			const p = norm(uri);
			const parts = p.split('/');
			for (let i = 1; i <= parts.length; i++) {
				const prefix = parts.slice(0, i).join('/');
				if (prefix) dirs.add(prefix);
			}
		},
		async writeFile(uri, bytes) {
			const p = norm(uri);
			await api.createDirectory(p.slice(0, p.lastIndexOf('/')));
			files.set(p, Buffer.from(bytes));
		},
		async readFile(uri) {
			const p = norm(uri);
			if (!files.has(p)) {
				const e = new Error(`ENOENT ${p}`);
				e.code = 'FileNotFound';
				throw e;
			}
			return new Uint8Array(files.get(p));
		},
		async stat(uri) {
			const p = norm(uri);
			if (files.has(p)) return { type: FileType.File };
			if (dirs.has(p)) return { type: FileType.Directory };
			const e = new Error(`ENOENT ${p}`);
			e.code = 'FileNotFound';
			throw e;
		},
		async readDirectory(uri) {
			const p = norm(uri);
			if (!dirs.has(p)) {
				const e = new Error(`ENOENT ${p}`);
				e.code = 'FileNotFound';
				throw e;
			}
			const out = new Map();
			for (const f of files.keys()) {
				if (!f.startsWith(p + '/')) continue;
				const rest = f.slice(p.length + 1);
				const head = rest.split('/')[0];
				out.set(head, rest.includes('/') ? FileType.Directory : FileType.File);
			}
			for (const d of dirs) {
				if (!d.startsWith(p + '/')) continue;
				out.set(d.slice(p.length + 1).split('/')[0], FileType.Directory);
			}
			return [...out.entries()];
		},
		async delete(uri) {
			const p = norm(uri);
			files.delete(p);
			dirs.delete(p);
			for (const f of [...files.keys()]) if (f.startsWith(p + '/')) files.delete(f);
			for (const d of [...dirs]) if (d.startsWith(p + '/')) dirs.delete(d);
		},
	};
	return api;
}

function installMemoryFs() {
	const mem = createMemoryFs();
	vscode.workspace.fs = mem;
	return mem;
}

const enc = s => new TextEncoder().encode(s);
const text = buf => new TextDecoder().decode(buf);

/** A valid, minimal BPMN with the given process id — enough for `extractProcessModel()`. */
function bpmnXml(processId) {
	return `<?xml version="1.0"?><definitions><process id="${processId}" name="${processId}" isExecutable="true"><startEvent id="s"/></process></definitions>`;
}

(async () => {
	// ── 1. discoverBpmnFiles: content gate, dotfolder skip, depth limit ───────
	{
		const mem = installMemoryFs();
		await mem.writeFile(vscode.Uri.file('/repo/approval.bpmn20.xml'), enc(bpmnXml('vipApproval')));
		await mem.writeFile(vscode.Uri.file('/repo/README.md'), enc('# just a readme, no process here'));
		await mem.writeFile(vscode.Uri.file('/repo/.git/approval.bpmn20.xml'), enc(bpmnXml('shouldNeverBeSeen')));
		await mem.writeFile(
			vscode.Uri.file('/repo/sub/notAProcess.xml'),
			enc('<definitions><process name="noId"/></definitions>'),
		);
		await mem.writeFile(vscode.Uri.file('/repo/sub/review.xml'), enc(bpmnXml('managerReview')));

		const found = await discoverBpmnFiles(vscode.Uri.file('/repo'));
		assert.deepStrictEqual(
			found.map(f => f.processId),
			['managerReview', 'vipApproval'],
			'must find only files that parse to a non-empty process id, skip dotfolders, and sort by process id',
		);
		assert.ok(
			!found.some(f => f.fileUri.path.includes('notAProcess')),
			'a same-extension file with no <process id> must not be reported (D4)',
		);

		// Depth limit: MAX_DEPTH = 10, shared with l3Discovery.ts. A file directly
		// inside the 10th nested directory is read; one nested one level deeper
		// never even triggers a readDirectory call on its parent.
		let deep = '/deep';
		for (let i = 1; i <= 10; i++) deep += `/d${i}`;
		await mem.writeFile(vscode.Uri.file(`${deep}/atLimit.xml`), enc(bpmnXml('atLimit')));
		await mem.writeFile(vscode.Uri.file(`${deep}/d11/beyondLimit.xml`), enc(bpmnXml('beyondLimit')));

		const deepFound = await discoverBpmnFiles(vscode.Uri.file('/deep'));
		assert.deepStrictEqual(
			deepFound.map(f => f.processId), ['atLimit'],
			'depth 10 must be read; depth 11 must not be',
		);
	}

	// ── 2. resolveRepoBpmnContext: round trip, legacy fallback, negatives ─────
	{
		installMemoryFs();
		const mgr = new EnvironmentManager(vscode.Uri.file('/ws'));
		await mgr.createEnvironment('demo-01.reltio.com');
		await mgr.createTenant('demo-01.reltio.com', 'AcmeTenant');
		const repoDir = mgr.getWorkflowRepoDirectoryUri('demo-01.reltio.com', 'AcmeTenant');

		// Nested arbitrarily deep inside the customer's own repo layout.
		const nestedUri = vscode.Uri.joinPath(repoDir, 'src', 'main', 'resources', 'vipApproval.bpmn');
		await vscode.workspace.fs.writeFile(nestedUri, enc(bpmnXml('vipApproval')));
		const ctx = await resolveRepoBpmnContext(nestedUri.fsPath, mgr);
		assert.deepStrictEqual(
			ctx,
			{ environmentName: 'demo-01.reltio.com', tenantId: 'AcmeTenant', processId: 'vipApproval' },
			`round trip through a nested customer path must resolve, got ${JSON.stringify(ctx)}`,
		);

		// Filename is never trusted (D4): a misleading filename must not matter.
		const misleadingUri = vscode.Uri.joinPath(repoDir, 'totallyDifferentName.xml');
		await vscode.workspace.fs.writeFile(misleadingUri, enc(bpmnXml('vipApproval')));
		const ctx2 = await resolveRepoBpmnContext(misleadingUri.fsPath, mgr);
		assert.strictEqual(ctx2.processId, 'vipApproval', 'the filename must be irrelevant to the resolved process id');

		// Legacy suffix fallback: no environmentManager, pre-rename tenant folder.
		const legacyUri = vscode.Uri.file(
			'/ws/demo-01.reltio.com.reltio.environment/AcmeTenant.reltio.tenant/Workflows/Custom Workflows/deeply/nested/vipApproval.bpmn',
		);
		await vscode.workspace.fs.writeFile(legacyUri, enc(bpmnXml('vipApproval')));
		const legacyCtx = await resolveRepoBpmnContext(legacyUri.fsPath);
		assert.deepStrictEqual(
			legacyCtx,
			{ environmentName: 'demo-01.reltio.com', tenantId: 'AcmeTenant', processId: 'vipApproval' },
			`legacy-suffixed path must still resolve via the fallback, got ${JSON.stringify(legacyCtx)}`,
		);

		// Negatives.
		const outsideUri = mgr.getWorkflowDraftUri('demo-01.reltio.com', 'AcmeTenant', 'vipApproval.bpmn20.xml');
		assert.strictEqual(
			await resolveRepoBpmnContext(outsideUri.fsPath, mgr), undefined,
			'a file outside Workflows/Custom Workflows must not resolve, even at a real tenant path',
		);

		const noIdUri = vscode.Uri.joinPath(repoDir, 'schema.xml');
		await vscode.workspace.fs.writeFile(noIdUri, enc('<definitions/>'));
		assert.strictEqual(
			await resolveRepoBpmnContext(noIdUri.fsPath, mgr), undefined,
			'content with no <process id> must not resolve',
		);

		const freshMgr = new EnvironmentManager(vscode.Uri.file('/ws2'));
		assert.strictEqual(
			await resolveRepoBpmnContext(nestedUri.fsPath, freshMgr), undefined,
			'an unrecognized tenant path must not resolve',
		);
	}

	// ── 3. compareBpmnContent: both states, byte-exact ─────────────────────────
	{
		const a = bpmnXml('p');
		assert.strictEqual(compareBpmnContent(a, a), 'clean', 'identical content must be clean');
		assert.strictEqual(compareBpmnContent(a, a.replace('p', 'q')), 'changed', 'any byte difference must be changed');
		assert.strictEqual(
			compareBpmnContent(a, `${a}\n`), 'changed',
			'byte-exact per D5 — even trailing whitespace counts as changed, deliberately not normalized',
		);
	}

	// ── 4. Sidecar: round trip, tolerant failures, D9 overwrite ───────────────
	{
		const mem = installMemoryFs();
		const configUri = vscode.Uri.file('/ws/env/Tenant/WorkflowRepo.reltio.json');

		assert.strictEqual(await loadWorkflowRepoConfig(configUri), undefined, 'missing file must load as undefined');

		await saveWorkflowRepoConfig(configUri, {
			repoUrl: 'https://bitbucket.org/acme/acme-workflows.git',
			relativePath: 'Workflows/Custom Workflows',
		});
		assert.deepStrictEqual(
			await loadWorkflowRepoConfig(configUri),
			{ repoUrl: 'https://bitbucket.org/acme/acme-workflows.git', relativePath: 'Workflows/Custom Workflows' },
			'save then load must round trip exactly',
		);

		// D9: one repository per tenant — a second save overwrites, it does not append.
		await saveWorkflowRepoConfig(configUri, {
			repoUrl: 'https://bitbucket.org/acme/replacement-repo.git',
			relativePath: 'Workflows/Custom Workflows',
		});
		const afterSecondSave = await loadWorkflowRepoConfig(configUri);
		assert.strictEqual(afterSecondSave.repoUrl, 'https://bitbucket.org/acme/replacement-repo.git');
		const onDisk = JSON.parse(text(mem._files.get('/ws/env/Tenant/WorkflowRepo.reltio.json')));
		assert.strictEqual(onDisk.version, 1, 'the on-disk shape must still carry a version field');
		assert.ok(
			!Array.isArray(onDisk.sources),
			'must never grow a multi-source array shape (D9, unlike git-repository-source)',
		);

		// Tolerant-failure cases.
		await vscode.workspace.fs.writeFile(configUri, enc('not json at all'));
		assert.strictEqual(await loadWorkflowRepoConfig(configUri), undefined, 'corrupt JSON must load as undefined');

		await vscode.workspace.fs.writeFile(configUri, enc(JSON.stringify({ version: 2, repoUrl: 'x', relativePath: 'y' })));
		assert.strictEqual(await loadWorkflowRepoConfig(configUri), undefined, 'wrong version must load as undefined');

		await vscode.workspace.fs.writeFile(configUri, enc(JSON.stringify({ version: 1, relativePath: 'y' })));
		assert.strictEqual(await loadWorkflowRepoConfig(configUri), undefined, 'missing repoUrl must load as undefined');

		await vscode.workspace.fs.writeFile(configUri, enc(JSON.stringify({ version: 1, repoUrl: '', relativePath: 'y' })));
		assert.strictEqual(await loadWorkflowRepoConfig(configUri), undefined, 'empty repoUrl must load as undefined');

		// Delete: idempotent, tolerant of an already-missing file.
		await vscode.workspace.fs.writeFile(configUri, enc(JSON.stringify({ version: 1, repoUrl: 'x', relativePath: 'y' })));
		await deleteWorkflowRepoConfig(configUri);
		assert.strictEqual(mem._files.has('/ws/env/Tenant/WorkflowRepo.reltio.json'), false, 'delete must actually remove the sidecar');
		await assert.doesNotReject(
			() => deleteWorkflowRepoConfig(configUri),
			'deleting an already-absent sidecar must not throw (D2.2)',
		);
	}

	// ── 5. D10 reconciliation: both orders, idempotency, alternate spelling ───
	{
		const tenantRoot = vscode.Uri.file('/ws/env/Tenant');
		const repoConfigUri = vscode.Uri.joinPath(tenantRoot, 'WorkflowRepo.reltio.json');
		const gitignoreUri = vscode.Uri.joinPath(tenantRoot, '.gitignore');
		const config = { repoUrl: 'https://bitbucket.org/acme/acme-workflows.git', relativePath: 'Workflows/Custom Workflows' };

		// No-op: no outer .git.
		{
			const mem = installMemoryFs();
			await saveWorkflowRepoConfig(repoConfigUri, config);
			await reconcileWorkflowRepoGitignore(tenantRoot, repoConfigUri);
			assert.strictEqual(mem._files.has(gitignoreUri.path), false, 'no outer repo means nothing to protect');
		}
		// No-op: outer .git present, but no repository connected.
		{
			const mem = installMemoryFs();
			await mem.createDirectory(vscode.Uri.joinPath(tenantRoot, '.git'));
			await reconcileWorkflowRepoGitignore(tenantRoot, repoConfigUri);
			assert.strictEqual(mem._files.has(gitignoreUri.path), false, 'no connected repository means nothing to protect');
		}

		// Order 1: repository connected first, tenant bound to Git second.
		{
			const mem = installMemoryFs();
			await saveWorkflowRepoConfig(repoConfigUri, config);
			await mem.createDirectory(vscode.Uri.joinPath(tenantRoot, '.git'));
			await reconcileWorkflowRepoGitignore(tenantRoot, repoConfigUri);
			const gi = text(mem._files.get(gitignoreUri.path) ?? Buffer.from(''));
			assert.ok(gi.includes('Workflows/Custom Workflows/'), `Order 1 must add the entry, got: ${gi}`);

			// Idempotent: running again must not duplicate the line.
			await reconcileWorkflowRepoGitignore(tenantRoot, repoConfigUri);
			const gi2 = text(mem._files.get(gitignoreUri.path));
			assert.strictEqual(
				gi2.split('\n').filter(l => l.trim() === 'Workflows/Custom Workflows/').length, 1,
				'a second reconciliation must not duplicate the entry',
			);
		}

		// Order 2: tenant already bound to Git, repository connected second — same
		// final state, reached the other way around, since the function derives
		// the answer from scratch rather than reacting to which command just ran.
		{
			const mem = installMemoryFs();
			await mem.createDirectory(vscode.Uri.joinPath(tenantRoot, '.git'));
			// Tenant bound first: nothing to reconcile yet (no sidecar).
			await reconcileWorkflowRepoGitignore(tenantRoot, repoConfigUri);
			assert.strictEqual(mem._files.has(gitignoreUri.path), false);
			// Repository connected now — the sidecar appears.
			await saveWorkflowRepoConfig(repoConfigUri, config);
			await reconcileWorkflowRepoGitignore(tenantRoot, repoConfigUri);
			const gi = text(mem._files.get(gitignoreUri.path) ?? Buffer.from(''));
			assert.ok(gi.includes('Workflows/Custom Workflows/'), `Order 2 must add the entry, got: ${gi}`);
		}

		// Mutation-check: an existing .gitignore line without the trailing slash
		// must still be recognized as "already present" — a reconciliation that
		// checked only the exact `${relativePath}/` string would instead add a
		// near-duplicate line every time it ran.
		{
			const mem = installMemoryFs();
			await mem.createDirectory(vscode.Uri.joinPath(tenantRoot, '.git'));
			await saveWorkflowRepoConfig(repoConfigUri, config);
			await vscode.workspace.fs.writeFile(gitignoreUri, enc('node_modules/\nWorkflows/Custom Workflows\n'));
			await reconcileWorkflowRepoGitignore(tenantRoot, repoConfigUri);
			const gi = text(mem._files.get(gitignoreUri.path));
			assert.strictEqual(
				gi, 'node_modules/\nWorkflows/Custom Workflows\n',
				'the no-trailing-slash spelling must count as already present — unrelated lines must survive untouched',
			);
		}
	}

	// ── 6. D10: multi-tenant sweep, one tenant's failure must not block others ─
	{
		const mem = installMemoryFs();
		const mgr = new EnvironmentManager(vscode.Uri.file('/ws3'));
		await mgr.createEnvironment('env-a.reltio.com');
		await mgr.createTenant('env-a.reltio.com', 'TenantOne');
		await mgr.createTenant('env-a.reltio.com', 'TenantTwo');

		const rootOne = mgr.getTenantRootUri('env-a.reltio.com', 'TenantOne');
		const rootTwo = mgr.getTenantRootUri('env-a.reltio.com', 'TenantTwo');
		const configOne = mgr.getWorkflowRepoConfigUri('env-a.reltio.com', 'TenantOne');
		const configTwo = mgr.getWorkflowRepoConfigUri('env-a.reltio.com', 'TenantTwo');
		const gitignoreOne = vscode.Uri.joinPath(rootOne, '.gitignore');
		const gitignoreTwo = vscode.Uri.joinPath(rootTwo, '.gitignore');
		const cfg = { repoUrl: 'https://bitbucket.org/acme/wf.git', relativePath: 'Workflows/Custom Workflows' };

		await mem.createDirectory(vscode.Uri.joinPath(rootOne, '.git'));
		await mem.createDirectory(vscode.Uri.joinPath(rootTwo, '.git'));
		await saveWorkflowRepoConfig(configOne, cfg);
		await saveWorkflowRepoConfig(configTwo, cfg);

		// Both tenants already have a `.gitignore` at this point — `createTenant()`'s
		// own marker setup (`ensureMarkerGitignored()`) writes one for unrelated
		// entries — so "unreconciled" has to mean "unchanged from before the sweep",
		// not "absent".
		const giOneBefore = text(mem._files.get(gitignoreOne.path) ?? Buffer.from(''));

		// TenantOne's read throws mid-sweep (simulating a genuine I/O failure);
		// TenantTwo must still be reconciled — the sweep is documented best-effort.
		const originalReadFile = mem.readFile;
		mem.readFile = async uri => {
			const p = uri.fsPath.replace(/\\/g, '/');
			if (p === configOne.path) throw new Error('simulated I/O failure');
			return originalReadFile(uri);
		};
		await assert.doesNotReject(
			() => reconcileAllWorkflowRepoGitignores(mgr),
			'one tenant failing must not throw out of the whole sweep',
		);
		mem.readFile = originalReadFile;

		const giOneAfter = text(mem._files.get(gitignoreOne.path) ?? Buffer.from(''));
		assert.strictEqual(
			giOneAfter, giOneBefore,
			'the failing tenant\'s .gitignore is left unreconciled, not crashed into a bad state',
		);
		assert.ok(
			!giOneAfter.includes('Workflows/Custom Workflows/'),
			'the failing tenant must not gain the entry despite its sidecar being unreadable',
		);
		const giTwo = text(mem._files.get(gitignoreTwo.path) ?? Buffer.from(''));
		assert.ok(
			giTwo.includes('Workflows/Custom Workflows/'),
			'the healthy tenant must still be reconciled despite the other one failing',
		);
	}

	// ── 7. Tier B: commands declared, registered, and right-clickable ─────────
	{
		const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
		const declared = new Set((pkg.contributes.commands ?? []).map(c => c.command));
		const repoCommands = [
			'reltio.connectWorkflowRepository',
			'reltio.disconnectWorkflowRepository',
			'reltio.refreshWorkflowRepoSync',
			'reltio.openWorkflowRepoFolder',
			'reltio.openWorkflowRepoInBrowser',
		];
		for (const id of repoCommands) {
			assert.ok(declared.has(id), `package.json must declare command "${id}"`);
		}

		const sourceDir = path.join(__dirname, '..', 'src');
		const rawSource = (function readAll(dir) {
			return fs.readdirSync(dir, { withFileTypes: true }).reduce((acc, entry) => {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) return acc + readAll(full);
				return entry.name.endsWith('.ts') ? acc + fs.readFileSync(full, 'utf-8') : acc;
			}, '');
		})(sourceDir);
		const sourceText = rawSource.replace(/registerCommand\(\s*/g, 'registerCommand(');
		for (const id of repoCommands) {
			assert.ok(
				sourceText.includes(`registerCommand('${id}'`),
				`command "${id}" is declared in package.json but never registered in src/`,
			);
		}

		const menu = pkg.contributes.menus?.['view/item/context'] ?? [];
		const contextValues = [
			'reltio.workflows.customRepo.notConnected',
			'reltio.workflows.customRepo.connected',
			'reltio.workflows.customRepo.file',
		];
		for (const cv of contextValues) {
			const entries = menu.filter(m => String(m.when ?? '').includes(cv));
			assert.ok(entries.length > 0, `no menu entries reference contextValue "${cv}"`);
			for (const entry of entries) {
				assert.ok(
					String(entry.when ?? '').startsWith('view == reltioConfigTree &&'),
					`entry for "${cv}" must be scoped to the tree view, got: ${entry.when}`,
				);
			}
			// Right-clickable, not only inline — same rule workflow-authoring's own test enforces.
			const contextEntries = entries.filter(e => !String(e.group ?? '').startsWith('inline'));
			assert.ok(contextEntries.length > 0, `"${cv}" only has inline entries, so it never appears on right-click`);
		}

		assert.ok(
			menu.some(m => m.command === 'reltio.disconnectWorkflowRepository' && String(m.when).includes('customRepo.connected')),
			'Disconnect must be reachable only on the connected row',
		);
		assert.ok(
			menu.some(m => m.command === 'reltio.connectWorkflowRepository' && String(m.when).includes('customRepo.notConnected')),
			'Connect must be reachable on the not-connected row',
		);
		assert.ok(
			menu.some(m => m.command === 'reltio.deployWorkflow' && String(m.when).includes('customRepo.file')),
			'Deploy must be reachable on a discovered repository file row',
		);
		assert.ok(
			menu.some(m => m.command === 'reltio.previewWorkflowDiagram' && String(m.when).includes('customRepo.file')),
			'Preview Diagram must be reachable on a discovered repository file row',
		);
	}

	// ── Inline file browsing: WorkflowRepoBpmnFileNode wiring ─────────────────
	{
		const treeSource = fs.readFileSync(
			path.join(__dirname, '..', 'src', 'tree', 'workflowNodes.ts'),
			'utf-8',
		);
		assert.ok(
			treeSource.includes('export class WorkflowRepoBpmnFileNode'),
			'WorkflowRepoBpmnFileNode must be exported from workflowNodes.ts',
		);

		const providerSource = fs.readFileSync(
			path.join(__dirname, '..', 'src', 'tree', 'multiTenantTreeProvider.ts'),
			'utf-8',
		);
		assert.ok(
			providerSource.includes('getCachedWorkflowRepoFiles'),
			'the tree provider must cache the discovered file list, not just the count, or WorkflowRepoNode cannot render children',
		);
		assert.ok(
			/element instanceof WorkflowRepoNode\)\s*\{/.test(providerSource),
			'getChildren() must handle WorkflowRepoNode to render one row per discovered file',
		);
		assert.ok(
			providerSource.includes('element instanceof WorkflowRepoBpmnFileNode'),
			'getParent() must route a discovered-file row back to its WorkflowRepoNode',
		);

		const extSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf-8');
		assert.ok(
			/markWorkflowRepoSync\([^)]*discovered\)/.test(extSource),
			'refreshWorkflowRepoSyncState() must pass the discovered file list into markWorkflowRepoSync(), not just the count',
		);
		for (const command of ['reltio.deployWorkflow', 'reltio.previewWorkflowDiagram']) {
			const marker = `'${command}'`;
			const idx = extSource.indexOf(marker);
			assert.ok(idx >= 0, `"${command}" registration not found in extension.ts`);
			// The handler's argument-type union is declared within a couple hundred
			// characters of the command name itself; a fixed window is more robust
			// to reformatting than guessing an exact closing token.
			const handlerSlice = extSource.slice(idx, idx + 400);
			assert.ok(
				handlerSlice.includes('WorkflowRepoBpmnFileNode'),
				`"${command}"'s handler must accept a WorkflowRepoBpmnFileNode, or Deploy/Preview from the inline row does nothing`,
			);
		}
	}

	// ── 8. Tier B: this script is actually registered in the runner ───────────
	{
		const runner = fs.readFileSync(path.join(__dirname, 'run-unit-tests.cjs'), 'utf-8');
		assert.ok(
			runner.includes("'test-custom-workflow-repository.cjs'"),
			'test-custom-workflow-repository.cjs must be registered in the SCRIPTS array, or it never runs',
		);
	}

	console.log('test-custom-workflow-repository: OK');
})().catch(e => {
	console.error(e);
	process.exit(1);
});
