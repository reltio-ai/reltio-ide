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
		assert.ok(one.message.includes('Workflows/bpmn/ already had 1 local draft: a.bpmn20.xml.'));
		assert.ok(one.detail.includes('commit and push from Workflows/'));
		const many = describeAdoptedDrafts(['1', '2', '3', '4', '5', '6', '7']);
		assert.ok(many.message.includes('7 local drafts') && many.message.includes('and 2 more'));
		assert.ok(!many.message.includes('6,'), 'at most five are listed');
	}

	// ── 3. mergeProcessDefinitionRows ────────────────────────────────────────
	{
		const def = (type, generic = false) => ({ id: `${type}:1`, type, displayName: type, generic });
		const loc = (id, over = {}) => ({
			processId: id, fileUri: `/l/${id}`, fileKey: `/l/${id}`, processName: undefined,
			hasBaseline: false, hasLocalChanges: false, ...over,
		});
		const rep = (id, key = `/r/${id}`) => ({ processId: id, fileUri: key, fileKey: key, processName: undefined });
		const merge = over => mergeProcessDefinitionRows({
			definitions: [], local: [], repoFiles: undefined, repoSync: new Map(), ...over,
		});
		const row = (rows, id) => rows.find(r => (r.definition?.type ?? r.processId) === id);

		// State by state.
		const rows = merge({
			definitions: [def('ootb', true), def('clean'), def('edited'), def('differs'), def('untracked')],
			local: [
				loc('clean', { hasBaseline: true }),
				loc('edited', { hasBaseline: true, hasLocalChanges: true }),
				loc('draft'),
			],
			repoFiles: [rep('clean'), rep('edited'), rep('differs'), rep('repoOnly', '/r/free-name.xml')],
			repoSync: new Map([['edited', 'changed'], ['differs', 'changed']]),
		});
		assert.strictEqual(row(rows, 'ootb').repoState, undefined, 'OOTB is never "not tracked"');
		assert.deepStrictEqual([row(rows, 'clean').localState, row(rows, 'clean').repoState], ['clean', undefined]);
		assert.strictEqual(row(rows, 'edited').localState, 'changed');
		assert.strictEqual(row(rows, 'edited').repoState, 'changed', 'both facts are carried; the node applies precedence');
		assert.strictEqual(row(rows, 'differs').repoState, 'changed');
		assert.strictEqual(row(rows, 'differs').repoFileUri, '/r/differs');
		assert.strictEqual(row(rows, 'untracked').repoState, 'untracked');
		assert.strictEqual(row(rows, 'draft').kind, 'draft');
		assert.strictEqual(row(rows, 'draft').source, 'local');
		assert.strictEqual(row(rows, 'repoOnly').source, 'repo');
		assert.deepStrictEqual(rows.map(r => r.kind), ['deployed', 'deployed', 'deployed', 'deployed', 'deployed', 'draft', 'draft'],
			'deployed rows first, drafts after');

		// No repository, or not scanned yet: nothing is judged untracked.
		const none = merge({ definitions: [def('x')], repoFiles: undefined });
		assert.strictEqual(none.find(r => r.definition.type === 'x').repoState, undefined);
		// Scanned and empty: a custom workflow is untracked, an OOTB one still is not.
		const empty = merge({ definitions: [def('x'), def('o', true)], repoFiles: [] });
		assert.strictEqual(row(empty, 'x').repoState, 'untracked');
		assert.strictEqual(row(empty, 'o').repoState, undefined);

		// The same id in several places is one row.
		const dup = merge({
			definitions: [def('p')],
			local: [loc('p', { hasBaseline: true })],
			repoFiles: [rep('p')],
		});
		assert.strictEqual(dup.length, 1);
		const draftTwice = merge({ local: [loc('d')], repoFiles: [rep('d', '/other/d.xml')] });
		assert.strictEqual(draftTwice.length, 1, 'a draft seen locally and in the repository is listed once');
		assert.strictEqual(draftTwice[0].source, 'local');

		// One file seen by both scans: the repository's content id beats the name-derived id.
		const sameFile = merge({
			local: [loc('nameId', { fileKey: '/shared/f.xml', fileUri: '/shared/f.xml' })],
			repoFiles: [rep('contentId', '/shared/f.xml')],
		});
		assert.deepStrictEqual(sameFile.map(r => r.processId), ['contentId']);

		// A downloaded copy of a not-yet-listed definition is not a draft.
		assert.strictEqual(merge({ local: [loc('p', { hasBaseline: true })] }).length, 0);
		// Drafts sort by id.
		assert.deepStrictEqual(merge({ local: [loc('b'), loc('a')] }).map(r => r.processId), ['a', 'b']);
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
		assert.strictEqual(clean.iconPath.id, 'symbol-class');
		assert.strictEqual(clean.contextValue, 'reltio.workflows.processDefinition');

		const local = new ProcessDefinitionNode(E, 'T', def('c'), 'changed', 'changed', uri);
		assert.ok(desc(local).includes('local changes') && !desc(local).includes('differs'), 'local edits win over a repo difference');
		assert.strictEqual(local.contextValue, 'reltio.workflows.processDefinition.changed');

		const differs = new ProcessDefinitionNode(E, 'T', def('c'), 'none', 'changed', uri);
		assert.ok(desc(differs).includes('differs from repository'));
		assert.strictEqual(differs.contextValue, 'reltio.workflows.processDefinition.repoChanged');

		const untracked = new ProcessDefinitionNode(E, 'T', def('c'), 'none', 'untracked');
		assert.ok(desc(untracked).includes('not tracked in repository'));
		assert.strictEqual(untracked.contextValue, 'reltio.workflows.processDefinition', 'nothing to deploy from a missing file');
		assert.ok(untracked.iconPath.color, 'untracked carries the warning colour');

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
		assert.ok(onContextMenu(menu, 'reltio.workflows.processDefinition.repoChanged', 'reltio.deployWorkflow'));
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

	console.log('test-workflow-tree-redesign: OK');
})().catch(err => {
	console.error(err);
	process.exit(1);
});
