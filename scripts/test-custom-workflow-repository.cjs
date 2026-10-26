#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: custom-workflow-repository (Part 3)
 *
 * Tier A — pure logic, with a real in-memory filesystem (`scripts/lib/memory-fs.cjs`)
 *   standing in for `vscode.workspace.fs` so directory discovery is genuine, not
 *   hand-listed:
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
const { installMemoryFs } = require('./lib/memory-fs.cjs');

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
const { discoverJavaSources } = importDist('workspace/workflowRepoJavaDiscovery');
const { menuEntryAppliesTo, menuEntriesFor, onContextMenu } = require('./lib/menu-when.cjs');
const { MultiTenantTreeProvider } = importDist('tree/multiTenantTreeProvider');
const { TokenStore } = importDist('api/tokenStore');
const {
	WorkflowRepoGroupNode,
	WorkflowRepoModuleNode,
	WorkflowRepoJavaFileNode,
} = importDist('tree/workflowNodes');

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
			'/ws/demo-01.reltio.com.reltio.environment/AcmeTenant.reltio.tenant/Workflows/deeply/nested/vipApproval.bpmn',
		);
		await vscode.workspace.fs.writeFile(legacyUri, enc(bpmnXml('vipApproval')));
		const legacyCtx = await resolveRepoBpmnContext(legacyUri.fsPath);
		assert.deepStrictEqual(
			legacyCtx,
			{ environmentName: 'demo-01.reltio.com', tenantId: 'AcmeTenant', processId: 'vipApproval' },
			`legacy-suffixed path must still resolve via the fallback, got ${JSON.stringify(legacyCtx)}`,
		);

		// Negatives.
		const outsideUri = vscode.Uri.joinPath(
			mgr.getTenantRootUri('demo-01.reltio.com', 'AcmeTenant'), 'Business Config', 'vipApproval.bpmn20.xml',
		);
		assert.strictEqual(
			await resolveRepoBpmnContext(outsideUri.fsPath, mgr), undefined,
			'a file outside Workflows must not resolve, even at a real tenant path',
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

		// A path-traversal-shaped <process id> must not resolve. This id goes on to
		// build a local baseline path (getWorkflowBpmnBaselineUri) in the deploy
		// flow, so a customer's own (or a maliciously committed) BPMN content is as
		// untrusted here as a server-returned processDefinitions row is.
		const traversalUri = vscode.Uri.joinPath(repoDir, 'evil.xml');
		await vscode.workspace.fs.writeFile(traversalUri, enc(bpmnXml('../../../../etc/evil')));
		assert.strictEqual(
			await resolveRepoBpmnContext(traversalUri.fsPath, mgr), undefined,
			'a path-traversal-shaped process id must not resolve',
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
		// The repository's actions live on the Workflows row itself: `.repo` is the connected variant.
		for (const cv of [
			'reltio.workflows.folder',
			'reltio.workflows.folder.noUrl',
			'reltio.workflows.folder.repo',
			'reltio.workflows.folder.noUrl.repo',
			'reltio.workflows.draft.repo',
			'reltio.workflows.processDefinition.repoChanged',
		]) {
			const entries = menu.filter(m => menuEntryAppliesTo(m, cv));
			assert.ok(entries.length > 0, `no menu entries apply to contextValue "${cv}"`);
			for (const entry of entries) {
				assert.ok(
					String(entry.when ?? '').startsWith('view == reltioConfigTree &&'),
					`entry for "${cv}" must be scoped to the tree view, got: ${entry.when}`,
				);
			}
		}

		for (const cv of ['reltio.workflows.folder', 'reltio.workflows.folder.noUrl']) {
			assert.ok(onContextMenu(menu, cv, 'reltio.connectWorkflowRepository'), `Connect must be on right-click for "${cv}"`);
			for (const command of [
				'reltio.disconnectWorkflowRepository',
				'reltio.refreshWorkflowRepoSync',
				'reltio.openWorkflowRepoFolder',
				'reltio.openWorkflowRepoInBrowser',
			]) {
				assert.strictEqual(
					menuEntriesFor(menu, cv, command).length, 0,
					`"${command}" must not be offered before a repository is connected ("${cv}")`,
				);
			}
		}
		for (const cv of ['reltio.workflows.folder.repo', 'reltio.workflows.folder.noUrl.repo']) {
			for (const command of [
				'reltio.disconnectWorkflowRepository',
				'reltio.refreshWorkflowRepoSync',
				'reltio.openWorkflowRepoFolder',
				'reltio.openWorkflowRepoInBrowser',
			]) {
				assert.ok(onContextMenu(menu, cv, command), `"${command}" must be on right-click for the connected row "${cv}"`);
			}
			assert.strictEqual(
				menuEntriesFor(menu, cv, 'reltio.connectWorkflowRepository').length, 0,
				`Connect must disappear once connected ("${cv}")`,
			);
		}

		// A repository file with a free-form name can be deployed and previewed, but is the
		// customer's own file: the extension offers no Delete on it.
		assert.ok(onContextMenu(menu, 'reltio.workflows.draft.repo', 'reltio.deployWorkflow'), 'Deploy on a repository-only draft');
		assert.ok(onContextMenu(menu, 'reltio.workflows.draft.repo', 'reltio.previewWorkflowDiagram'), 'Preview on a repository-only draft');
		assert.strictEqual(menuEntriesFor(menu, 'reltio.workflows.draft.repo', 'reltio.deleteWorkflowDraft').length, 0);
		assert.ok(onContextMenu(menu, 'reltio.workflows.draft', 'reltio.deleteWorkflowDraft'), 'a local draft keeps Delete');

		// A deployed row whose repository file differs deploys that file from its own row.
		for (const command of ['reltio.deployWorkflow', 'reltio.previewWorkflowDiagram', 'reltio.duplicateWorkflowDraft']) {
			assert.ok(
				onContextMenu(menu, 'reltio.workflows.processDefinition.repoChanged', command),
				`"${command}" must be reachable on a row that differs from the repository`,
			);
		}
	}

	// ── Tree wiring: Java groups under the Workflows row, one merged Process Definitions list ─
	{
		const treeSource = fs.readFileSync(
			path.join(__dirname, '..', 'src', 'tree', 'workflowNodes.ts'),
			'utf-8',
		);
		for (const retired of ['WorkflowRepoBpmnFileNode', 'WorkflowRepoNode', 'WorkflowDraftsFolderNode']) {
			assert.ok(
				!treeSource.includes(`export class ${retired}`),
				`${retired} is gone: BPMN lives in Process Definitions and the repository lives on the Workflows row`,
			);
		}
		for (const cls of ['WorkflowRepoGroupNode', 'WorkflowRepoModuleNode', 'WorkflowRepoJavaFileNode']) {
			assert.ok(treeSource.includes(`export class ${cls}`), `${cls} must be exported from workflowNodes.ts`);
		}
		assert.ok(
			!/command:\s*'reltio\.(deleteWorkflowDraft|deployWorkflow)'/.test(
				treeSource.slice(treeSource.indexOf('export class WorkflowRepoJavaFileNode')),
			),
			'a Java row must carry no mutating command (D6) — it opens the file and nothing else',
		);

		const providerSource = fs.readFileSync(
			path.join(__dirname, '..', 'src', 'tree', 'multiTenantTreeProvider.ts'),
			'utf-8',
		);
		for (const needle of [
			'getCachedWorkflowRepoFiles',
			'getCachedWorkflowRepoJava',
			'invalidateWorkflowRepoSync',
			'element instanceof WorkflowRepoGroupNode',
			'element instanceof WorkflowRepoJavaFileNode',
			'mergeProcessDefinitionRows',
		]) {
			assert.ok(providerSource.includes(needle), `the tree provider must contain "${needle}"`);
		}

		const extSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf-8');
		// Matched across newlines: the call grew a sixth argument (Java sources) and
		// wrapped, so a single-line pattern no longer describes correct code.
		assert.ok(
			/markWorkflowRepoSync\([\s\S]{0,200}?\bdiscovered\b/.test(extSource),
			'refreshWorkflowRepoSyncState() must pass the discovered file list into markWorkflowRepoSync(), not just the count',
		);
		for (const command of ['reltio.deployWorkflow', 'reltio.previewWorkflowDiagram']) {
			const idx = extSource.indexOf(`'${command}'`);
			assert.ok(idx >= 0, `"${command}" registration not found in extension.ts`);
			// The handler's argument-type union is declared within a couple hundred characters of the command name.
			const handlerSlice = extSource.slice(idx, idx + 400);
			assert.ok(
				handlerSlice.includes('WorkflowDraftNode') && handlerSlice.includes('ProcessDefinitionNode'),
				`"${command}"'s handler must accept both row types of the merged list`,
			);
		}

		// ── workflow-repo-contents-and-agent-access: agent-callable commands ─────
		// Each of these was `(node?: WorkflowRepoNode) => { if (!node) return; }`, which
		// is a silent no-op for any caller without a tree node — i.e. every agent.
		for (const command of [
			'reltio.connectWorkflowRepository',
			'reltio.disconnectWorkflowRepository',
			'reltio.openWorkflowRepoFolder',
			'reltio.openWorkflowRepoInBrowser',
			'reltio.refreshWorkflowRepoSync',
		]) {
			const idx = extSource.indexOf(`'${command}'`);
			assert.ok(idx >= 0, `"${command}" registration not found in extension.ts`);
			const handlerSlice = extSource.slice(idx, idx + 400);
			assert.ok(
				handlerSlice.includes('WorkflowsFolderNode') && handlerSlice.includes('workflowCommandArgs'),
				`"${command}" must take the Workflows row (or an args object) and narrow it through workflowCommandArgs()`,
			);
			assert.ok(
				handlerSlice.includes('resolveWorkflowTenant'),
				`"${command}" must resolve its tenant through resolveWorkflowTenant(), so a call with no arguments prompts rather than returning`,
			);
		}

		// The repository is cloned directly into `Workflows/`, so one glob under it covers
		// the repository's BPMN, its drafts and its Java.
		assert.ok(
			extSource.includes("'**/Workflows/**/*.xml'"),
			'a watcher must cover BPMN inside the connected repository, or its sync badge goes stale silently',
		);
		assert.ok(
			extSource.includes('invalidateIfDiscovered'),
			'the repository watcher must invalidate cached sync state rather than recompute it (D5/D7)',
		);
	}

	// ── 8. Module-grouping layer: always present, even for a single module ────
	//
	// `WorkflowRepoGroupNode` (Java Classes / Java Tests) always renders one
	// `WorkflowRepoModuleNode` per distinct Maven module, the `(no module)` bucket for
	// `undefined` counting as a module like any other. BPMN is not grouped here: it is part of
	// the merged Process Definitions list. Built against real `discoverJavaSources()` output
	// over an in-memory tree, not hand-built node lists, so the moduleName plumbing is
	// exercised end to end rather than assumed.
	{
		const ENV = 'module-grouping-test.reltio.com';
		const TENANT = 'ModuleGroupingTenant';

		function makeProvider() {
			const mgr = new EnvironmentManager(vscode.Uri.file('/mgws'));
			const tokenStore = new TokenStore();
			const memento = { get: () => undefined, update: async () => undefined };
			return new MultiTenantTreeProvider(mgr, tokenStore, memento, null);
		}

		// ── 8a. Single-module repo: still grouped by its module ──
		{
			const mem = installMemoryFs();
			await mem.writeFile(vscode.Uri.file('/repo/pom.xml'), enc('<project/>'));
			await mem.writeFile(
				vscode.Uri.file('/repo/src/main/java/com/acme/OnlyClass.java'),
				enc('public class OnlyClass {}\n'),
			);
			await mem.writeFile(
				vscode.Uri.file('/repo/src/test/java/com/acme/OnlyClassTest.java'),
				enc('public class OnlyClassTest {}\n'),
			);
			await mem.writeFile(vscode.Uri.file('/repo/approval.bpmn20.xml'), enc(bpmnXml('soleApproval')));

			const files = await discoverBpmnFiles(vscode.Uri.file('/repo'));
			const javaSources = await discoverJavaSources(vscode.Uri.file('/repo'));
			// A root-level `pom.xml` is a no-op for naming purposes in both walks. Java's seed is the
			// repository folder's own name, so its one file still reports a module; BPMN's seed is
			// `undefined` (D4: never borrow a folder name as a false module).
			assert.strictEqual(files[0].moduleName, undefined, 'a BPMN file at the repository root has no module');
			assert.strictEqual(javaSources[0].moduleName, 'repo', 'java’s root-seeded fallback is unchanged');

			const provider = makeProvider();
			provider.markWorkflowRepoSync(ENV, TENANT, files.length, new Map(), files, javaSources);

			const javaGroup = new WorkflowRepoGroupNode(
				ENV, TENANT, 'javaMain', javaSources.filter(s => s.kind === 'main').length,
			);
			const testGroup = new WorkflowRepoGroupNode(
				ENV, TENANT, 'javaTest', javaSources.filter(s => s.kind === 'test').length,
			);
			const javaModules = await provider.getChildren(javaGroup);
			assert.deepStrictEqual(
				javaModules.map(c => c.constructor.name), ['WorkflowRepoModuleNode'],
				'a single-module repo still renders a module node, so the layout never shifts when a second module appears',
			);
			assert.strictEqual(javaModules[0].label, 'repo (1)');
			const testModules = await provider.getChildren(testGroup);
			assert.deepStrictEqual(testModules.map(c => c.constructor.name), ['WorkflowRepoModuleNode']);

			const javaChildren = await provider.getChildren(javaModules[0]);
			assert.deepStrictEqual(javaChildren.map(c => c.constructor.name), ['WorkflowRepoJavaFileNode']);
			const javaTooltip = javaChildren[0].tooltip.value;
			assert.ok(!javaTooltip.includes('Path in repository'), 'repo Java tooltip must not repeat the file path');

			// getParent: file → module → group, always.
			const parent = await provider.getParent(javaChildren[0]);
			assert.ok(parent instanceof WorkflowRepoModuleNode, 'a Java file’s parent is always its module node');
			const grandparent = await provider.getParent(parent);
			assert.ok(grandparent instanceof WorkflowRepoGroupNode, 'a module node’s parent is its group');
		}

		// ── 8b/8c. The real two-module fixture; BPMN both inside and outside a module ──
		{
			const mem = installMemoryFs();
			await mem.writeFile(vscode.Uri.file('/repo/pom.xml'), enc('<project/>'));
			await mem.writeFile(vscode.Uri.file('/repo/delete-review/pom.xml'), enc('<project/>'));
			await mem.writeFile(vscode.Uri.file('/repo/workflow-external-dcr/pom.xml'), enc('<project/>'));

			await mem.writeFile(
				vscode.Uri.file('/repo/delete-review/src/main/java/com/company/workflow/delete/DeleteReviewValidator.java'),
				enc('public class DeleteReviewValidator {}\n'),
			);
			await mem.writeFile(
				vscode.Uri.file('/repo/delete-review/src/test/java/com/company/workflow/delete/DeleteReviewValidatorTest.java'),
				enc('public class DeleteReviewValidatorTest {}\n'),
			);
			await mem.writeFile(
				vscode.Uri.file(
					'/repo/workflow-external-dcr/src/main/java/com/reltio/workflow/external/services/beans/ChangeRequest.java',
				),
				enc('public class ChangeRequest {}\n'),
			);
			await mem.writeFile(
				vscode.Uri.file(
					'/repo/workflow-external-dcr/src/test/java/com/reltio/workflow/external/services/beans/ChangeRequestTest.java',
				),
				enc('public class ChangeRequestTest {}\n'),
			);

			// One BPMN file physically inside a module's directory tree, one at the repository root,
			// outside every module — BPMN is never provisioned by Reltio, so a customer is free to
			// place it either way, even in the same repo.
			await mem.writeFile(
				vscode.Uri.file('/repo/delete-review/src/main/resources/deleteReview.bpmn20.xml'),
				enc(bpmnXml('deleteReview')),
			);
			await mem.writeFile(vscode.Uri.file('/repo/rootLevel.bpmn20.xml'), enc(bpmnXml('rootLevel')));

			const files = await discoverBpmnFiles(vscode.Uri.file('/repo'));
			const javaSources = await discoverJavaSources(vscode.Uri.file('/repo'));

			assert.deepStrictEqual(
				files
					.map(f => ({ processId: f.processId, moduleName: f.moduleName }))
					.sort((a, b) => a.processId.localeCompare(b.processId)),
				[
					{ processId: 'deleteReview', moduleName: 'delete-review' },
					{ processId: 'rootLevel', moduleName: undefined },
				],
				'BPMN moduleName attribution must work end to end: inside a module vs. outside every module',
			);

			const provider = makeProvider();
			provider.markWorkflowRepoSync(ENV, TENANT, files.length, new Map(), files, javaSources);

			// Java Classes / Java Tests: 2 modules apiece, sorted alphabetically, correctly counted.
			for (const kind of ['javaMain', 'javaTest']) {
				const javaKind = kind === 'javaMain' ? 'main' : 'test';
				const count = javaSources.filter(s => s.kind === javaKind).length;
				const group = new WorkflowRepoGroupNode(ENV, TENANT, kind, count);
				const children = await provider.getChildren(group);
				assert.strictEqual(children.length, 2, `${kind} group must render 2 module nodes`);
				assert.ok(children.every(c => c instanceof WorkflowRepoModuleNode));
				assert.deepStrictEqual(
					children.map(c => c.moduleName), ['delete-review', 'workflow-external-dcr'],
					`${kind} module nodes must be sorted alphabetically`,
				);
				assert.deepStrictEqual(children.map(c => c.count), [1, 1], `${kind} module counts must be correct`);

				const deleteReviewFiles = await provider.getChildren(children[0]);
				assert.strictEqual(deleteReviewFiles.length, 1);
				assert.ok(deleteReviewFiles[0] instanceof WorkflowRepoJavaFileNode);
				assert.strictEqual(deleteReviewFiles[0].source.moduleName, 'delete-review');

				const externalDcrFiles = await provider.getChildren(children[1]);
				assert.strictEqual(externalDcrFiles.length, 1);
				assert.strictEqual(externalDcrFiles[0].source.moduleName, 'workflow-external-dcr');

				const parent = await provider.getParent(deleteReviewFiles[0]);
				assert.ok(parent instanceof WorkflowRepoModuleNode);
				assert.strictEqual(parent.moduleName, 'delete-review');
				assert.strictEqual(parent.kind, kind);
			}
		}

		// ── 8d. Java with no detected module still gets its "(no module)" bucket ──
		{
			const sources = [
				{ kind: 'main', moduleName: undefined, simpleName: 'Stray', packageName: 'com.acme', fullyQualifiedName: 'com.acme.Stray', relativePath: 'Stray.java', fileUri: vscode.Uri.file('/repo/Stray.java') },
			];
			const provider = makeProvider();
			provider.markWorkflowRepoSync(ENV, 'NoModuleTenant', 0, new Map(), [], sources);
			const group = new WorkflowRepoGroupNode(ENV, 'NoModuleTenant', 'javaMain', 1);
			const children = await provider.getChildren(group);
			assert.deepStrictEqual(children.map(c => c.label), ['(no module) (1)']);
		}
	}

	// ── 9. Tier B: this script is actually registered in the runner ───────────
	{
		const runner = fs.readFileSync(path.join(__dirname, 'run-unit-tests.cjs'), 'utf-8');
		assert.ok(
			runner.includes("'test-custom-workflow-repository.cjs'"),
			'test-custom-workflow-repository.cjs must be registered in the SCRIPTS array, or it never runs',
		);
	}

	// Connect-time adoption of a staged clone is covered by test-workflow-tree-redesign.cjs.

	console.log('test-custom-workflow-repository: OK');
})().catch(e => {
	console.error(e);
	process.exit(1);
});
