#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: workflow-tree-redesign
 *
 * The Workflows tree has two default folders; Process Definitions is one merged list; the
 * Custom Workflow Repository is cloned straight into `{tenant}/Workflows/`.
 *
 * Tier A — pure logic:
 *   1. `planWorkflowRepoAdoption`: clean adoption, atomic collision refusal, `bpmn/` merge,
 *      generated-README replacement, case-insensitive clashes.
 *   2. `withBaselineExclude`, `describeAdoptedDrafts`.
 *   3. `mergeProcessDefinitionRows`: the six states and their precedence, dedupe, content-id
 *      precedence, "not scanned" never reads as "untracked".
 *
 * Tier B — over an in-memory filesystem:
 *   4. `adoptStagedRepository`: README replaced, drafts reported, atomic refusal, exclude file.
 *   5. `pruneRetiredComponentFolders` never removes the live `Workflows` leaf or drafts folder.
 *   6. Where drafts and the repository live on disk.
 *
 * Tier C — structural:
 *   7. Node shapes: contextValues, descriptions, icons.
 *   8. package.json menus reach the right rows.
 *   9. The bundled skills tell the user to connect before any Java is written.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');
const vscode = require('./lib/vscode-stub.cjs');
const { installMemoryFs } = require('./lib/memory-fs.cjs');
const { menuEntriesFor, onContextMenu } = require('./lib/menu-when.cjs');

const {
	planWorkflowRepoAdoption, withBaselineExclude, describeAdoptedDrafts, draftFileNames, BASELINE_EXCLUDE_PATTERN,
} = importDist('workspace/workflowRepoAdoption');
const {
	adoptStagedRepository, WorkflowRepoAdoptionConflictError, WORKFLOW_REPO_STAGING_DIR,
} = importDist('workspace/workflowRepoConnect');
const { mergeProcessDefinitionRows } = importDist('tree/processDefinitionRows');
const { pruneRetiredComponentFolders, materializeTenantTree } = importDist('workspace/tenantFolderStructure');
const { EnvironmentManager } = importDist('workspace/environmentManager');
const {
	ProcessDefinitionNode, WorkflowDraftNode, WorkflowsFolderNode, describeWorkflowsFolder,
} = importDist('tree/workflowNodes');

const root = path.join(__dirname, '..');
const enc = s => new TextEncoder().encode(s);
const dec = b => new TextDecoder().decode(b);
const file = name => ({ name, isDirectory: false });
const dir = name => ({ name, isDirectory: true });
const GENERATED_README = '# Workflows\nThis folder is not yet managed by Reltio IDE.\n';

(async () => {
	// ── 1. planWorkflowRepoAdoption ──────────────────────────────────────────
	{
		const base = {
			existing: [file('README.md'), dir('bpmn')],
			existingBpmn: ['a.bpmn20.xml', 'a.bpmn20.baseline.xml'],
			existingReadmeIsGenerated: true,
			staged: [dir('.git'), file('pom.xml'), dir('bpmn'), dir('mod'), file('README.md')],
			stagedBpmn: ['b.bpmn20.xml'],
		};
		const ok = planWorkflowRepoAdoption(base);
		assert.ok(ok.ok);
		assert.strictEqual(ok.discardExistingReadme, true, 'the generated README is replaced by the repository\'s own');
		assert.deepStrictEqual(ok.moveTop, ['.git', 'pom.xml', 'mod', 'README.md']);
		assert.deepStrictEqual(ok.mergeBpmn, ['b.bpmn20.xml']);
		assert.deepStrictEqual(ok.drafts, ['a.bpmn20.xml'], 'a baseline snapshot is not a draft');

		// A README the user wrote is theirs: a clash, not a replacement.
		const userReadme = planWorkflowRepoAdoption({ ...base, existingReadmeIsGenerated: false });
		assert.deepStrictEqual(userReadme, { ok: false, collisions: ['README.md'] });

		// Atomic: every clash is listed and nothing is planned.
		const clash = planWorkflowRepoAdoption({
			...base,
			existing: [dir('bpmn'), file('pom.xml'), dir('MOD')],
			existingReadmeIsGenerated: false,
		});
		assert.strictEqual(clash.ok, false);
		assert.deepStrictEqual(clash.collisions, ['mod', 'pom.xml'],
			'case-insensitive, sorted, and complete');

		// The same BPMN in both places is not a refusal: the local copy is kept, the staged one dropped.
		const sameBpmn = planWorkflowRepoAdoption({ ...base, existingBpmn: ['B.bpmn20.xml', 'a.bpmn20.xml'] });
		assert.ok(sameBpmn.ok, 'a BPMN that is both downloaded here and tracked in the repository must not block connecting');
		assert.deepStrictEqual(sameBpmn.keptLocal, ['b.bpmn20.xml']);
		assert.deepStrictEqual(sameBpmn.mergeBpmn, [], 'the staged copy is not moved over the local one');

		// No existing README: nothing to discard.
		const fresh = planWorkflowRepoAdoption({ ...base, existing: [], existingBpmn: [], stagedBpmn: [] });
		assert.ok(fresh.ok && !fresh.discardExistingReadme && fresh.moveTop.includes('bpmn'));
		assert.deepStrictEqual(draftFileNames(['z.bpmn20.xml', 'a.bpmn20.xml', 'x.txt']), ['a.bpmn20.xml', 'z.bpmn20.xml']);
	}

	// ── 2. exclude text and the connect dialog ───────────────────────────────
	{
		assert.strictEqual(withBaselineExclude(''), `${BASELINE_EXCLUDE_PATTERN}\n`);
		assert.strictEqual(withBaselineExclude('# c\n'), `# c\n${BASELINE_EXCLUDE_PATTERN}\n`);
		assert.strictEqual(withBaselineExclude('# c'), `# c\n${BASELINE_EXCLUDE_PATTERN}\n`);
		const once = withBaselineExclude('x\n');
		assert.strictEqual(withBaselineExclude(once), once, 'idempotent');

		const one = describeAdoptedDrafts(['a.bpmn20.xml']);
		assert.strictEqual(one.message,
			'Your local draft BPMN has been moved to the bpmn folder in the repository and will be included the next time you commit.');
		assert.strictEqual(one.detail, '', 'no extra text unless a draft was kept over a repository file');
		const many = describeAdoptedDrafts(['1', '2', '3']);
		assert.ok(many.message.startsWith('Your local draft BPMNs have been moved'));
	}

	// ── 3. mergeProcessDefinitionRows ────────────────────────────────────────
	{
		const def = (type, generic = false) => ({ id: `${type}:1`, type, displayName: type, generic });
		const loc = (id, over = {}) => ({
			processId: id, fileUri: `/l/${id}`, fileKey: `/l/${id}`, processName: undefined,
			hasBaseline: false, hasLocalChanges: false, ...over,
		});
		const rep = (id, key = `/r/${id}`, fromRepo = true) => ({ processId: id, fileUri: key, fileKey: key, processName: undefined, fromRepo });
		const merge = over => mergeProcessDefinitionRows({
			definitions: [], local: [], repoFiles: undefined, repoSync: new Map(), ...over,
		});
		const kinds = rows => rows.map(r => `${r.kind}:${r.definition?.type ?? r.processId}`);

		// Tenant rows carry only the state of the downloaded copy.
		const tenant = merge({
			definitions: [def('ootb', true), def('clean'), def('edited'), def('plain')],
			local: [loc('clean', { hasBaseline: true }), loc('edited', { hasBaseline: true, hasLocalChanges: true })],
		});
		assert.deepStrictEqual(tenant.map(r => r.localState), ['none', 'clean', 'changed', 'none']);

		// A repository file is never merged into a tenant row, even with the same process id.
		const withRepo = merge({
			definitions: [def('p')],
			repoFiles: [rep('p'), rep('p', '/r/other/p.xml')],
			repoSync: new Map([['p', 'changed']]),
		});
		assert.deepStrictEqual(kinds(withRepo), ['deployed:p', 'repo:p', 'repo:p'], 'two repo files, two rows, plus the tenant row');
		assert.ok(withRepo.filter(r => r.kind === 'repo').every(r => r.state === 'differs'));
		assert.strictEqual(withRepo[0].repoState, undefined, 'the tenant row knows nothing of the repository');

		// How a repository row compares to the tenant.
		const states = merge({
			definitions: [def('same'), def('differs'), def('nocompare')],
			repoFiles: [rep('same'), rep('differs'), rep('nocompare'), rep('fresh')],
			repoSync: new Map([['same', 'clean'], ['differs', 'changed']]),
		}).filter(r => r.kind === 'repo');
		assert.deepStrictEqual(states.map(r => [r.processId, r.state]), [
			['differs', 'differs'], ['fresh', 'notDeployed'], ['nocompare', 'deployed'], ['same', 'same'],
		]);
		// Definitions not fetched: not deployed cannot be claimed.
		assert.strictEqual(merge({ definitions: undefined, repoFiles: [rep('x')] })[0].state, 'unknown');

		// A repository scan also sees untracked files in bpmn/: those are drafts, not repository rows.
		const mine = merge({
			local: [loc('mine')],
			repoFiles: [rep('mine', '/l/mine', false), rep('theirs')],
		});
		assert.deepStrictEqual(kinds(mine), ['draft:mine', 'repo:theirs']);
		const draftOnlyInScan = merge({ repoFiles: [rep('solo', '/x/solo.xml', false)] });
		assert.deepStrictEqual(kinds(draftOnlyInScan), ['draft:solo']);

		// A local file the repository tracks is the repository's, listed once, as a repository row.
		const tracked = merge({ local: [loc('t', { fileKey: '/shared/t.xml', fileUri: '/shared/t.xml' })], repoFiles: [rep('t', '/shared/t.xml')] });
		assert.deepStrictEqual(kinds(tracked), ['repo:t']);

		// A downloaded copy the repository also tracks stays the tenant's: one tenant row, no repo row.
		const downloadedAndTracked = merge({
			definitions: [def('d')],
			local: [loc('d', { hasBaseline: true, fileKey: '/shared/d.xml', fileUri: '/shared/d.xml' })],
			repoFiles: [rep('d', '/shared/d.xml')],
		});
		assert.deepStrictEqual(kinds(downloadedAndTracked), ['deployed:d']);

		// One file seen by both scans: the content id beats the name-derived id.
		const sameFile = merge({
			local: [loc('nameId', { fileKey: '/shared/f.xml', fileUri: '/shared/f.xml' })],
			repoFiles: [rep('contentId', '/shared/f.xml')],
		});
		assert.deepStrictEqual(kinds(sameFile), ['repo:contentId']);

		// Draft ordering and the downloaded-but-not-listed case.
		assert.strictEqual(merge({ local: [loc('p', { hasBaseline: true })] }).length, 0);
		assert.deepStrictEqual(merge({ local: [loc('b'), loc('a')] }).map(r => r.processId), ['a', 'b']);
		assert.deepStrictEqual(kinds(merge({
			definitions: [def('z')], local: [loc('d')], repoFiles: [rep('r')],
		})), ['deployed:z', 'draft:d', 'repo:r'], 'tenant rows, then drafts, then repository rows');
	}

	// ── 4. adoptStagedRepository over an in-memory filesystem ────────────────
	{
		const WF = vscode.Uri.file('/t/Workflows');
		const ST = vscode.Uri.file(`/t/${WORKFLOW_REPO_STAGING_DIR}`);
		const stage = async mem => {
			await mem.writeFile(vscode.Uri.joinPath(ST, 'pom.xml'), enc('<project/>'));
			await mem.writeFile(vscode.Uri.joinPath(ST, 'README.md'), enc('# repo'));
			await mem.writeFile(vscode.Uri.joinPath(ST, 'bpmn/in-repo.bpmn20.xml'), enc('<r/>'));
			await mem.writeFile(vscode.Uri.joinPath(ST, 'mod/pom.xml'), enc('<project/>'));
			await mem.writeFile(vscode.Uri.joinPath(ST, '.git/info/.keep'), enc(''));
		};

		const mem = installMemoryFs();
		await mem.writeFile(vscode.Uri.joinPath(WF, 'README.md'), enc(GENERATED_README));
		await mem.writeFile(vscode.Uri.joinPath(WF, 'bpmn/mine.bpmn20.xml'), enc('<m/>'));
		await mem.writeFile(vscode.Uri.joinPath(WF, 'bpmn/mine.bpmn20.baseline.xml'), enc('<m/>'));
		await stage(mem);
		const result = await adoptStagedRepository(WF, ST);
		assert.deepStrictEqual(result.drafts, ['mine.bpmn20.xml']);
		const f = mem._files;
		assert.strictEqual(dec(f.get('/t/Workflows/README.md')), '# repo', 'the generated README gave way to the repository\'s');
		assert.ok(f.has('/t/Workflows/pom.xml') && f.has('/t/Workflows/mod/pom.xml'));
		assert.ok(f.has('/t/Workflows/bpmn/mine.bpmn20.xml'), 'drafts stay where they were');
		assert.ok(f.has('/t/Workflows/bpmn/in-repo.bpmn20.xml'), 'repository BPMN merged into the same folder');
		assert.ok(f.has('/t/Workflows/.git/info/.keep'));
		assert.ok(dec(f.get('/t/Workflows/.git/info/exclude')).includes(BASELINE_EXCLUDE_PATTERN),
			'baseline snapshots are excluded without touching the customer\'s .gitignore');
		assert.ok(![...f.keys()].some(k => k.endsWith('/.gitignore')));

		// Atomic refusal: a user-written README and a clashing module change nothing.
		const mem2 = installMemoryFs();
		await mem2.writeFile(vscode.Uri.joinPath(WF, 'README.md'), enc('my notes'));
		await mem2.writeFile(vscode.Uri.joinPath(WF, 'mod/x.txt'), enc('x'));
		await mem2.writeFile(vscode.Uri.joinPath(WF, 'bpmn/mine.bpmn20.xml'), enc('<m/>'));
		await stage(mem2);
		const before = [...mem2._files.entries()].map(([k, v]) => `${k}=${v.toString()}`).sort();
		await assert.rejects(
			() => adoptStagedRepository(WF, ST),
			e => e instanceof WorkflowRepoAdoptionConflictError
				&& [...e.collisions].sort().join() === 'README.md,mod'
				&& e.message.includes('Nothing was changed'),
		);
		const after = [...mem2._files.entries()].map(([k, v]) => `${k}=${v.toString()}`).sort();
		assert.deepStrictEqual(after, before, 'a refused adoption moves and deletes nothing');
	}

	// ── 5. Retired-folder pruning never touches live paths ───────────────────
	{
		const TENANT = vscode.Uri.file('/tp');
		const mem = installMemoryFs();
		await materializeTenantTree(TENANT);
		await mem.createDirectory(vscode.Uri.file('/tp/Workflows/bpmn'));
		await mem.writeFile(vscode.Uri.file('/tp/Workflows/Custom Workflows/README.md'), enc(GENERATED_README));
		const removed = await pruneRetiredComponentFolders(TENANT);
		assert.ok(removed.includes('Workflows/Custom Workflows'), 'the retired folder with only a generated README goes');
		assert.ok(mem._dirs.has('/tp/Workflows'), 'the Workflows leaf is live and stays');
		assert.ok(mem._dirs.has('/tp/Workflows/bpmn'), 'an empty drafts folder is never pruned');
		assert.ok(mem._files.has('/tp/Workflows/README.md'));

		// A retired folder with a user's own file stays.
		const mem2 = installMemoryFs();
		await mem2.writeFile(vscode.Uri.file('/tp/Workflows/Custom Workflows/mine.java'), enc('class A {}'));
		assert.deepStrictEqual(await pruneRetiredComponentFolders(TENANT), []);
		assert.ok(mem2._files.has('/tp/Workflows/Custom Workflows/mine.java'));
	}

	// ── 6. On-disk layout ────────────────────────────────────────────────────
	{
		const mgr = new EnvironmentManager(vscode.Uri.file('/ws'));
		const norm = u => u.fsPath.replace(/\\/g, '/');
		const drafts = norm(mgr.getWorkflowDraftsDirectoryUri('e.reltio.com', 'T1'));
		const repo = norm(mgr.getWorkflowRepoDirectoryUri('e.reltio.com', 'T1'));
		assert.ok(drafts.endsWith('/Workflows/bpmn'), `drafts: ${drafts}`);
		assert.ok(repo.endsWith('/Workflows') && !repo.includes('Custom Workflows'), `repo: ${repo}`);
		assert.strictEqual(drafts, `${repo}/bpmn`, 'the repository\'s own bpmn/ is the drafts folder');
	}

	// ── 7. Node shapes ───────────────────────────────────────────────────────
	{
		const E = 'e.reltio.com';
		const def = (type, generic = false) => ({
			id: `${type}:1`, type, displayName: type, manualStart: false, deploymentId: '1', deployTime: 0, generic, fileName: type,
		});
		const uri = vscode.Uri.file('/r/p.bpmn20.xml');
		const desc = n => String(n.description ?? '');

		const ootb = new ProcessDefinitionNode(E, 'T', def('ootbFlow', true), 'none');
		assert.strictEqual(ootb.iconPath.id, 'symbol-method');
		assert.strictEqual(desc(ootb), 'ootbFlow');

		const clean = new ProcessDefinitionNode(E, 'T', def('c'), 'clean');
		assert.strictEqual(clean.iconPath.id, 'symbol-class', 'a custom workflow deployed on the tenant is a class');
		assert.strictEqual(clean.contextValue, 'reltio.workflows.processDefinition');

		const local = new ProcessDefinitionNode(E, 'T', def('c'), 'changed');
		assert.ok(desc(local).includes('local changes'));
		assert.strictEqual(local.contextValue, 'reltio.workflows.processDefinition.changed');

		const repoNode = (state, source = 'repo') => new WorkflowDraftNode(E, 'T',
			{ processId: 'r', fileUri: uri, fileName: 'r.bpmn20.xml', processName: undefined }, source, state);
		assert.strictEqual(repoNode('differs').iconPath.id, 'repo', 'a repository file is a repo icon');
		assert.ok(desc(repoNode('differs')).includes('repository') && desc(repoNode('differs')).includes('differs from tenant'));
		assert.ok(desc(repoNode('notDeployed')).includes('not deployed'));
		assert.ok(desc(repoNode('same')).includes('same as tenant'));
		assert.strictEqual(repoNode('same').contextValue, 'reltio.workflows.draft.repo');
		assert.notStrictEqual(repoNode('same').id, repoNode('same', 'local').id, 'a repository row and a draft with one id never share a tree id');

		const draft = new WorkflowDraftNode(E, 'T', { processId: 'd', fileUri: uri, fileName: 'd.bpmn20.xml', processName: undefined });
		assert.strictEqual(draft.iconPath.id, 'edit');
		assert.strictEqual(desc(draft), '• draft');

		// The Workflows row carries the repository's status.
		const cfg = { version: 1, repoUrl: 'https://github.com/acme/wf', relativePath: 'Workflows' };
		assert.strictEqual(describeWorkflowsFolder(false, false), 'Click to configure');
		assert.strictEqual(describeWorkflowsFolder(true, false), undefined);
		assert.strictEqual(describeWorkflowsFolder(true, true), 'repository connected');
		assert.strictEqual(describeWorkflowsFolder(false, true), 'Adapter URL not set • repository connected');
		assert.strictEqual(new WorkflowsFolderNode(E, 'T', 'https://a', cfg).contextValue, 'reltio.workflows.folder.repo');
		assert.strictEqual(new WorkflowsFolderNode(E, 'T', 'https://a').contextValue, 'reltio.workflows.folder');
		assert.strictEqual(new WorkflowsFolderNode(E, 'T', undefined).contextValue, 'reltio.workflows.folder.noUrl');
	}

	// ── 8. Menus ─────────────────────────────────────────────────────────────
	{
		const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
		const menu = pkg.contributes.menus['view/item/context'];
		const dead = ['reltio.workflows.drafts.folder', 'reltio.workflows.customRepo', 'reltio.workflows.customRepo.file'];
		for (const cv of dead) {
			assert.strictEqual(menuEntriesFor(menu, cv).length, 0, `${cv} no longer exists, so no menu may target it`);
		}
		assert.ok(menuEntriesFor(menu, 'reltio.workflows.folder.repo', 'reltio.refreshWorkflows').length > 0,
			'Refresh must stay on a connected Workflows row');
		assert.ok(onContextMenu(menu, 'reltio.workflows.draft', 'reltio.deployWorkflow'));
		assert.ok(onContextMenu(menu, 'reltio.workflows.draft.repo', 'reltio.deployWorkflow'));
		assert.strictEqual(JSON.stringify(menu).includes('repoChanged'), false, 'a tenant row never deploys the repository file');
		assert.strictEqual(menuEntriesFor(menu, 'reltio.workflows.processDefinition', 'reltio.deployWorkflow').length, 0,
			'a clean deployed row has no local file to deploy');
	}

	// ── 9. Skills: connect first, never write Java without a repository ──────
	{
		const skills = path.join(root, 'skills', 'reltio-default');
		for (const name of ['workflow-assistant', 'workflow-jar-customization', 'workflow-repo-contribution']) {
			const text = fs.readFileSync(path.join(skills, name, 'SKILL.md'), 'utf8');
			assert.ok(/Connect Custom Workflow Repository/.test(text), `${name} must say how to connect`);
			assert.ok(/(do not|never) (offer|suggest)/i.test(text), ` must forbid offering to write Java anyway`);
			assert.ok(!text.includes('Workflows/BPMN') && !text.includes('Workflows/Custom Workflows'), `${name} has stale paths`);
		}
	}

	// ── 10. Follow-ups from first manual use ─────────────────────────────────
	{
		// The same BPMN downloaded here and tracked in the repository must not block connecting.
		const WF = vscode.Uri.file('/t2/Workflows');
		const ST = vscode.Uri.file(`/t2/${WORKFLOW_REPO_STAGING_DIR}`);
		const mem = installMemoryFs();
		await mem.writeFile(vscode.Uri.joinPath(WF, 'bpmn/dataChangeRequestReview.bpmn20.xml'), enc('<local/>'));
		await mem.writeFile(vscode.Uri.joinPath(WF, 'bpmn/dataChangeRequestReview.bpmn20.baseline.xml'), enc('<base/>'));
		await mem.writeFile(vscode.Uri.joinPath(ST, 'bpmn/dataChangeRequestReview.bpmn20.xml'), enc('<repo/>'));
		await mem.writeFile(vscode.Uri.joinPath(ST, 'bpmn/other.bpmn20.xml'), enc('<other/>'));
		await mem.writeFile(vscode.Uri.joinPath(ST, 'pom.xml'), enc('<project/>'));
		const result = await adoptStagedRepository(WF, ST);
		assert.deepStrictEqual(result.keptLocal, ['dataChangeRequestReview.bpmn20.xml']);
		assert.strictEqual(dec(mem._files.get('/t2/Workflows/bpmn/dataChangeRequestReview.bpmn20.xml')), '<local/>',
			'the local copy is kept, never overwritten');
		assert.ok(mem._files.has('/t2/Workflows/bpmn/other.bpmn20.xml'), 'the rest of the repository still comes in');
		assert.ok(mem._files.has('/t2/Workflows/pom.xml'));
		const text = describeAdoptedDrafts(result.drafts, result.keptLocal);
		assert.ok(text.detail.includes('Your local copy was kept') && text.detail.includes('git diff'));
		assert.ok(!describeAdoptedDrafts(['a.bpmn20.xml']).detail.includes('Your local copy was kept'));

		// Baseline snapshots are ignored by the tenant's own git too, not only by the connected clone.
		const { ensureMarkerGitignored, ensureWorkspaceGitignored } = importDist('workspace/gitSourceMarker');
		const mem2 = installMemoryFs();
		await ensureMarkerGitignored(vscode.Uri.file('/tenant'));
		await ensureWorkspaceGitignored(vscode.Uri.file('/wsroot'));
		for (const p of ['/tenant/.gitignore', '/wsroot/.gitignore']) {
			assert.ok(dec(mem2._files.get(p)).split(/\r?\n/).includes(BASELINE_EXCLUDE_PATTERN), `${p} must ignore baseline snapshots`);
		}

		// The Workflows row offers Connect as a child while no repository is connected.
		const { MultiTenantTreeProvider } = importDist('tree/multiTenantTreeProvider');
		const { TokenStore } = importDist('api/tokenStore');
		const mem3 = installMemoryFs();
		const mgr = new EnvironmentManager(vscode.Uri.file('/cw'));
		const provider = new MultiTenantTreeProvider(mgr, new TokenStore(), { get: () => undefined, update: async () => undefined }, null);
		const unconnected = await provider.getChildren(new WorkflowsFolderNode('e.reltio.com', 'T', 'https://a-workflow.reltio.com'));
		const row = unconnected.find(n => n.constructor.name === 'WorkflowConnectRepoActionNode');
		assert.ok(row, 'a not-connected Workflows row lists "Connect Custom Workflow Repository…"');
		assert.strictEqual(row.command.command, 'reltio.connectWorkflowRepository');
		assert.deepStrictEqual([row.environmentName, row.tenantId], ['e.reltio.com', 'T'], 'the row carries the tenant the handler needs');
		const config = { version: 1, repoUrl: 'https://github.com/acme/wf', relativePath: 'Workflows' };
		await mem3.writeFile(mgr.getWorkflowRepoConfigUri('e.reltio.com', 'T'), enc(JSON.stringify(config)));
		const connected = await provider.getChildren(new WorkflowsFolderNode('e.reltio.com', 'T', 'https://a-workflow.reltio.com', config));
		assert.ok(!connected.some(n => n.constructor.name === 'WorkflowConnectRepoActionNode'), 'gone once connected');
	}

	// ── 11. Diagram preview says why it cannot draw ──────────────────────────
	{
		const { findXmlProblem } = importDist('workflow/bpmnWellFormed');
		const ok = '<?xml version="1.0"?>\n<definitions xmlns="x">\n  <!-- c -->\n  <process id="p" name="a > b">\n    <task id="t"/>\n  </process>\n</definitions>';
		assert.strictEqual(findXmlProblem(ok), undefined, 'well-formed XML, including ">" inside a quoted value, is accepted');

		const mismatch = findXmlProblem('<definitions>\n<process id="p">\n<task id="t">\n</process>\n</definitions>');
		assert.ok(mismatch && mismatch.line === 4 && mismatch.message.includes('</process>') && mismatch.message.includes('<task>'),
			`got ${JSON.stringify(mismatch)}`);
		assert.ok(findXmlProblem('<definitions><process id="p">').message.includes('never closed'));
		assert.ok(findXmlProblem('<a><b></a>').message.includes('does not match'));
		assert.ok(findXmlProblem('<a x="1></a>').message.includes('closing quote'));
		assert.ok(findXmlProblem('<a><!-- oops </a>').message.includes('comment'));
		assert.ok(findXmlProblem('<a>1 < 2</a>').message.includes('not the start of a tag'));
		assert.ok(findXmlProblem('</a>').message.includes('never opened'));
		assert.ok(findXmlProblem('just text').message.includes('no XML element'));
		assert.ok(findXmlProblem('<a><![CDATA[ x </a>').message.includes('CDATA'));

		// The webview reports readiness and shows the host's message; the panel re-sends on ready.
		const view = fs.readFileSync(path.join(root, 'src', 'webview', 'bpmnView.ts'), 'utf8');
		assert.ok(view.includes("type: 'ready'") && view.includes('message ??'));
		const panel = fs.readFileSync(path.join(root, 'src', 'workflow', 'bpmnPanel.ts'), 'utf8');
		assert.ok(panel.includes("msg.type === 'ready'") && panel.includes('findXmlProblem'));
	}

	// ── 12. Disconnect removes the repository's files, and only those ────────
	{
		const {
			planRepoCleanup, isRepoOriginFile, relativeToWorkflows, describeDisconnect,
		} = importDist('workspace/workflowRepoOrigin');
		const { removeRepoFiles, inspectRepoForDisconnect, listTrackedFiles } = importDist('workspace/workflowRepoCleanup');

		// Origin: tracked, or outside the drafts folder.
		const tracked = new Set(['bpmn/from-repo.bpmn20.xml']);
		assert.strictEqual(isRepoOriginFile('bpmn/from-repo.bpmn20.xml', tracked), true);
		assert.strictEqual(isRepoOriginFile('bpmn/mine.bpmn20.xml', tracked), false, 'an untracked file in bpmn/ is the user\'s draft');
		assert.strictEqual(isRepoOriginFile('BPMN/mine.bpmn20.xml', tracked), false, 'case-insensitive');
		assert.strictEqual(isRepoOriginFile('mod/src/main/resources/p.bpmn20.xml', tracked), true, 'outside bpmn/ can only be the repository\'s');
		assert.strictEqual(isRepoOriginFile('bpmn/x.bpmn20.xml', undefined), false, 'git unavailable: a file in bpmn/ is never guessed to be the repository\'s');
		assert.strictEqual(relativeToWorkflows('C:\\t\\Workflows\\bpmn\\a.xml', 'c:/t/Workflows'), 'bpmn/a.xml');
		assert.strictEqual(relativeToWorkflows('/elsewhere/a.xml', '/t/Workflows'), undefined);

		// The cleanup plan.
		const plan = planRepoCleanup({
			tracked: ['pom.xml', 'bpmn/repo.bpmn20.xml', 'bpmn/edited.bpmn20.xml', 'mod/A.java', '../evil', '.git/config'],
			modified: ['bpmn/edited.bpmn20.xml'],
			ignored: [
				'mod/target/A.class',
				'bpmn/repo.bpmn20.baseline.xml',
				'bpmn/edited.bpmn20.baseline.xml',
				'bpmn/mine.bpmn20.baseline.xml',
			],
		});
		assert.deepStrictEqual(plan.remove, ['bpmn/repo.bpmn20.baseline.xml', 'bpmn/repo.bpmn20.xml', 'mod/A.java', 'mod/target/A.class', 'pom.xml']);
		assert.deepStrictEqual(plan.keptModified, ['bpmn/edited.bpmn20.xml'], 'an edited repository file is kept, with its baseline');
		assert.ok(!plan.remove.some(p => p.includes('evil') || p.includes('.git/')), 'paths outside the folder or inside .git are never planned');

		const text = describeDisconnect('T1', plan, 2);
		assert.ok(text.includes('5 files') && text.includes('1 repository file has uncommitted changes') && text.includes('2 commits have not been pushed'));
		assert.ok(text.includes('Drafts and files you added yourself are kept'));
		assert.ok(describeDisconnect('T1', undefined, 0).includes('stays as it is'));

		// Removal over the in-memory fs: the repository's files go, drafts stay, empty folders go,
		// bpmn/ itself stays even when it ends up empty.
		const mem = installMemoryFs();
		const WF = vscode.Uri.file('/dc/Workflows');
		for (const p of ['pom.xml', 'bpmn/repo.bpmn20.xml', 'bpmn/mine.bpmn20.xml', 'mod/src/A.java', 'mod/target/A.class', 'other/keep.txt']) {
			await mem.writeFile(vscode.Uri.joinPath(WF, p), enc('x'));
		}
		await removeRepoFiles(WF, { remove: ['pom.xml', 'bpmn/repo.bpmn20.xml', 'mod/src/A.java', 'mod/target/A.class'], keptModified: [] });
		const left = [...mem._files.keys()].sort();
		assert.deepStrictEqual(left, ['/dc/Workflows/bpmn/mine.bpmn20.xml', '/dc/Workflows/other/keep.txt']);
		assert.ok(![...mem._dirs].some(d => d.includes('/mod')), 'folders left empty are removed');
		assert.ok(mem._dirs.has('/dc/Workflows'), 'Workflows itself stays');

		const mem2 = installMemoryFs();
		await mem2.writeFile(vscode.Uri.joinPath(WF, 'bpmn/repo.bpmn20.xml'), enc('x'));
		await removeRepoFiles(WF, { remove: ['bpmn/repo.bpmn20.xml'], keptModified: [] });
		assert.ok(mem2._dirs.has('/dc/Workflows/bpmn'), 'an emptied bpmn/ stays: it is the drafts folder');

		// Against a real git repository.
		const { execFileSync } = require('child_process');
		const os = require('os');
		let gitAvailable = true;
		try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { gitAvailable = false; }
		if (gitAvailable) {
			const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'reltio-disconnect-'));
			try {
				const run = (...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dirPath, stdio: 'ignore' });
				run('init', '-q');
				fs.mkdirSync(path.join(dirPath, 'bpmn'));
				fs.mkdirSync(path.join(dirPath, 'mod', 'sub dir'), { recursive: true });
				fs.writeFileSync(path.join(dirPath, 'pom.xml'), '<p/>');
				fs.writeFileSync(path.join(dirPath, 'bpmn', 'repo.bpmn20.xml'), '<r/>');
				fs.writeFileSync(path.join(dirPath, 'mod', 'sub dir', 'Ünï.java'), 'class A {}');
				run('add', '.');
				run('commit', '-q', '-m', 'init');
				fs.writeFileSync(path.join(dirPath, 'pom.xml'), '<p changed/>');
				fs.writeFileSync(path.join(dirPath, 'bpmn', 'mine.bpmn20.xml'), '<m/>');
				fs.writeFileSync(path.join(dirPath, 'bpmn', 'repo.bpmn20.baseline.xml'), '<b/>');
				fs.writeFileSync(path.join(dirPath, '.git', 'info', 'exclude'), '*.bpmn20.baseline.xml\n');

				const dirUri = vscode.Uri.file(dirPath);
				const trackedSet = await listTrackedFiles(dirUri);
				assert.ok(trackedSet.has('bpmn/repo.bpmn20.xml') && trackedSet.has('mod/sub dir/Ünï.java'), 'paths with spaces and non-ASCII arrive raw');
				assert.ok(!trackedSet.has('bpmn/mine.bpmn20.xml'));

				const inspection = await inspectRepoForDisconnect(dirUri);
				assert.deepStrictEqual(inspection.plan.keptModified, ['pom.xml'], 'the edited tracked file is kept');
				assert.deepStrictEqual(inspection.plan.remove, ['bpmn/repo.bpmn20.baseline.xml', 'bpmn/repo.bpmn20.xml', 'mod/sub dir/Ünï.java']);
				assert.ok(!inspection.plan.remove.includes('bpmn/mine.bpmn20.xml'), 'an untracked draft is never planned for removal');
			} finally {
				fs.rmSync(dirPath, { recursive: true, force: true });
			}
		}
	}

	// ── 13. Activation safety: no command id is registered twice ──────────────
	// A duplicate makes activate() throw, which leaves the whole Reltio view empty.
	{
		const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf8');
		const ids = [...src.matchAll(/registerCommand\(\s*'([^']+)'/g)].map(m => m[1]);
		const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
		assert.deepStrictEqual(dupes, [], 'commands registered more than once: ' + dupes.join(', '));
	}

	console.log('test-workflow-tree-redesign: OK');
})().catch(err => {
	console.error(err);
	process.exit(1);
});
