#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: workflow-review-fixes (RP-202975) — the tree, deploy and extension-side half.
 * (The network/git half lives in test-workflow-input-trust.cjs; the skills/diagnostics/sync half in
 * test-workflow-skills-sync.cjs and the diagnostics/diagram tests.)
 *
 *   1. workflow-deploy-integrity: `planDeploy()` / `describeDeploy()` — the XML's id, not the
 *      filename, decides what is confirmed, collision-checked and replaced.
 *   2. workflow-tree-state: "not fetched" vs "fetched, empty"; cross-kind fetch ordering; the
 *      repository row without an Adapter URL; lazy local discovery; an invalid committed sidecar
 *      reported once; repo state vs local state on a definition row.
 *   3. BPMN discovery ignores build output and is bounded; sync comparison ignores line endings;
 *      a failed clone puts the generated README back; per-key debounce.
 *   4. package.json: node-only commands are hidden from the Command Palette.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');
const vscode = require('./lib/vscode-stub.cjs');
const { installMemoryFs } = require('./lib/memory-fs.cjs');

const { planDeploy, describeDeploy, REPLACEABLE_BUILT_IN_IDS } = importDist('workspace/workflowDeployPlan');
const { planBpmnDiff, planDiscardBpmnChanges, bpmnFileName } = importDist('workspace/workflowBpmnFiles');
const { KeyedDebouncer } = importDist('util/keyedDebouncer');
const { compareBpmnContent } = importDist('workspace/workflowRepoSync');
const { discoverBpmnFilesDetailed } = importDist('workspace/workflowRepoDiscovery');
const { clearGeneratedReadmeBeforeClone, restoreGeneratedReadme } = importDist('workspace/workflowRepoConnect');
const { EnvironmentManager } = importDist('workspace/environmentManager');
const { draftFileName } = importDist('workspace/workflowDrafts');
const { MultiTenantTreeProvider } = importDist('tree/multiTenantTreeProvider');
const { TokenStore } = importDist('api/tokenStore');
const {
	WorkflowsFolderNode,
	WorkflowFetchActionNode,
	ProcessDefinitionsFolderNode,
	JarDeploymentsFolderNode,
	ProcessDefinitionNode,
	WorkflowRepoNode,
	WorkflowDraftsFolderNode,
	WorkflowRepoBpmnFileNode,
	WorkflowDraftNode,
} = importDist('tree/workflowNodes');

const repoRoot = path.join(__dirname, '..');
const enc = s => new TextEncoder().encode(s);
const dec = b => new TextDecoder().decode(b);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const bpmn = (id, extra = '') =>
	`<?xml version="1.0"?><definitions><process id="${id}" name="${id}" isExecutable="true"><startEvent id="s"/>${extra}</process></definitions>`;

const ENV = 'tst-01.reltio.com';
const TENANT = 'ReviewFixes';

function makeProvider() {
	const mgr = new EnvironmentManager(vscode.Uri.file('/rfws'));
	const memento = { get: () => undefined, update: async () => undefined };
	return { mgr, provider: new MultiTenantTreeProvider(mgr, new TokenStore(), memento, null) };
}
const def = (type, generic = false) => ({
	id: `${type}:1:1`, type, displayName: type, manualStart: false, deploymentId: '1', deployTime: 0, generic, fileName: type,
});
const names = nodes => nodes.map(n => n.constructor.name);
const ADAPTER = 'https://tst-01-workflow.reltio.com';

(async () => {
	// ── 1. Deploy integrity ──────────────────────────────────────────────────
	{
		const deployed = [def('dataChangeRequestReview', true), def('myCustomFlow')];

		const same = planDeploy(bpmn('foo'), 'foo', deployed);
		assert.ok(same.ok && !same.idMismatch && !same.replacesLive && !same.replacesBuiltIn, 'new id, name agrees');

		const edited = planDeploy(bpmn('dataChangeRequestReview'), 'foo', deployed);
		assert.ok(edited.ok);
		assert.strictEqual(edited.processId, 'dataChangeRequestReview', 'the XML id is what is deployed');
		assert.ok(edited.idMismatch && edited.replacesLive && edited.replacesBuiltIn,
			'a draft edited to a built-in id must be recognised as replacing it');
		const text = describeDeploy(edited, 'T1');
		assert.ok(text.detail.includes('"foo"') && text.detail.includes('"dataChangeRequestReview"'),
			'the modal must show both the file name and the id inside the file');
		assert.ok(/every entity type/i.test(text.detail), 'replacing a built-in must say it affects every entity type');
		assert.strictEqual(text.action, 'Deploy new version');

		const custom = planDeploy(bpmn('myCustomFlow'), 'myCustomFlow', deployed);
		assert.ok(custom.ok && custom.replacesLive && !custom.replacesBuiltIn);

		// a built-in the tenant has not flagged `generic` is still recognised by id
		const unflagged = planDeploy(bpmn('potentialMatchReview'), 'potentialMatchReview', [def('potentialMatchReview', false)]);
		assert.ok(unflagged.ok && unflagged.replacesBuiltIn);
		assert.ok(REPLACEABLE_BUILT_IN_IDS.includes('deleteReview'));

		assert.strictEqual(planDeploy('<definitions/>', 'x', deployed).ok, false, 'no <process id> cannot be deployed');
		assert.strictEqual(planDeploy(bpmn('../evil'), 'x', deployed).ok, false, 'an unsafe id is refused');
		const unknown = planDeploy(bpmn('foo'), 'foo', undefined);
		assert.strictEqual(unknown.ok, false, 'an unfetched list must not be read as "nothing is deployed"');
	}

	// ── 2. KeyedDebouncer ────────────────────────────────────────────────────
	{
		const d = new KeyedDebouncer(20);
		const fired = [];
		d.schedule('a', () => fired.push('a'));
		d.schedule('b', () => fired.push('b'));
		d.schedule('a', () => fired.push('a2')); // coalesces with the first 'a'
		d.schedule('c', () => fired.push('c'));
		d.cancel('c');
		await sleep(80);
		assert.deepStrictEqual(fired.sort(), ['a2', 'b'], 'two keys must both fire; the same key coalesces; a cancelled one never fires');
		d.schedule('z', () => fired.push('z'));
		d.dispose();
		await sleep(60);
		assert.ok(!fired.includes('z'), 'dispose drops pending work');
	}

	// ── 3. Sync comparison ignores checkout line endings only ────────────────
	{
		const lf = '<a>\n  <b/>\n</a>\n';
		assert.strictEqual(compareBpmnContent(lf.replace(/\n/g, '\r\n'), lf), 'clean', 'CRLF checkout of the same content is in sync');
		assert.strictEqual(compareBpmnContent('﻿' + lf, lf), 'clean', 'a BOM is not a difference');
		assert.strictEqual(compareBpmnContent('<a>\n  <b />\n</a>\n', lf), 'changed', 'a real difference still shows');
		assert.strictEqual(compareBpmnContent(lf, lf + ' '), 'changed', 'trailing whitespace is a real difference');
	}

	// ── 4. Discovery: build output, size, count ──────────────────────────────
	{
		const mem = installMemoryFs();
		await mem.writeFile(vscode.Uri.file('/r/src/main/resources/approval.bpmn20.xml'), enc(bpmn('approval')));
		await mem.writeFile(vscode.Uri.file('/r/target/classes/approval.bpmn20.xml'), enc(bpmn('approval')));
		await mem.writeFile(vscode.Uri.file('/r/node_modules/pkg/flow.xml'), enc(bpmn('vendored')));
		await mem.writeFile(vscode.Uri.file('/r/big/huge.xml'), Buffer.concat([enc(bpmn('huge')), Buffer.alloc(1024 * 1024 + 10, 32)]));
		const found = await discoverBpmnFilesDetailed(vscode.Uri.file('/r'));
		assert.deepStrictEqual(found.files.map(f => f.processId), ['approval'],
			'only the source BPMN: no target/ copy (it would collide on the id), no vendored copy, no oversized file');
		assert.ok(found.files[0].fileUri.fsPath.replace(/\\/g, '/').includes('/src/main/resources/'));
		assert.strictEqual(found.truncated, false);

		const mem2 = installMemoryFs();
		for (let i = 0; i < 2001; i++) {
			await mem2.writeFile(vscode.Uri.file(`/many/f${i}.xml`), enc('<x/>'));
		}
		const capped = await discoverBpmnFilesDetailed(vscode.Uri.file('/many'));
		assert.strictEqual(capped.truncated, true, 'a repository of generated XML must stop at the cap and say so');
	}

	// ── 5. A failed clone puts the generated README back ─────────────────────
	{
		const mem = installMemoryFs();
		const dir = vscode.Uri.file('/tenant/Workflows/Custom Workflows');
		const readme = '# Custom Workflows\nThis folder is not yet managed by Reltio IDE.\n';
		await mem.writeFile(vscode.Uri.joinPath(dir, 'README.md'), enc(readme));
		const removed = await clearGeneratedReadmeBeforeClone(dir);
		assert.strictEqual(removed, readme, 'the removed text is returned so it can be restored');
		assert.strictEqual(mem._files.has('/tenant/Workflows/Custom Workflows/README.md'), false);
		await restoreGeneratedReadme(dir, removed);
		assert.strictEqual(dec(mem._files.get('/tenant/Workflows/Custom Workflows/README.md')), readme, 'restored byte for byte');

		// a user's own README is never touched, and nothing is "restored" over it
		const mem2 = installMemoryFs();
		await mem2.writeFile(vscode.Uri.joinPath(dir, 'README.md'), enc('my notes'));
		assert.strictEqual(await clearGeneratedReadmeBeforeClone(dir), undefined);
		await restoreGeneratedReadme(dir, undefined);
		assert.strictEqual(dec(mem2._files.get('/tenant/Workflows/Custom Workflows/README.md')), 'my notes');
	}

	// ── 6. Tree state ────────────────────────────────────────────────────────
	{
		// 6a. a repository sync on a never-fetched tenant does not invent empty folders
		{
			installMemoryFs();
			const { provider } = makeProvider();
			provider.markWorkflowRepoSync(ENV, TENANT, 0, new Map(), [], []);
			const kids = await provider.getChildren(new WorkflowsFolderNode(ENV, TENANT, ADAPTER));
			assert.deepStrictEqual(names(kids).filter(n => n === 'ProcessDefinitionsFolderNode' || n === 'JarDeploymentsFolderNode'), [],
				'no "(0)" folders for a tenant nobody has fetched');
			assert.ok(names(kids).includes('WorkflowFetchActionNode'), 'the Fetch row must remain');
			assert.strictEqual(provider.hasFetchedProcessDefinitions(ENV, TENANT), false);
		}

		// 6b. only one half fetched: that folder, the Fetch row, no fake other half
		{
			installMemoryFs();
			const { provider } = makeProvider();
			provider.markProcessDefinitionsLoaded(ENV, TENANT, [def('p1')]);
			const kids = await provider.getChildren(new WorkflowsFolderNode(ENV, TENANT, ADAPTER));
			const n = names(kids);
			assert.ok(n.includes('ProcessDefinitionsFolderNode'));
			assert.ok(!n.includes('JarDeploymentsFolderNode'), 'JARs were never fetched, so there is no JAR folder');
			assert.ok(n.includes('WorkflowFetchActionNode'));
			assert.strictEqual(provider.hasFetchedProcessDefinitions(ENV, TENANT), true);
			// a fetched-but-empty list is a real state and does render
			provider.markProcessDefinitionsLoaded(ENV, TENANT, []);
			assert.ok(names(await provider.getChildren(new WorkflowsFolderNode(ENV, TENANT, ADAPTER))).includes('ProcessDefinitionsFolderNode'));
		}

		// 6c. an older combined load cannot bury a newer deploy re-fetch (and vice versa for the jars it owns)
		{
			installMemoryFs();
			const { provider } = makeProvider();
			const slowCombined = provider.beginWorkflowFetch('workflows', ENV, TENANT);
			const deployRefetch = provider.beginWorkflowFetch('processDefinitions', ENV, TENANT);
			provider.markProcessDefinitionsLoaded(ENV, TENANT, [def('old'), def('newlyDeployed')], deployRefetch);
			provider.markWorkflowsLoaded(ENV, TENANT, [def('old')], [{ module: 'm/a.jar', name: 'a', description: '', createdBy: 'u', createTime: 0 }], undefined, slowCombined);
			assert.deepStrictEqual(provider.getCachedProcessDefinitions(ENV, TENANT).map(d => d.type), ['old', 'newlyDeployed'],
				'the newer re-fetch must survive the slower, older combined load');
			assert.strictEqual(provider.getCachedJarDeployments(ENV, TENANT).length, 1,
				'the jar half had no newer fetch, so the combined load still supplies it');
		}

		// 6d. a connected repository with no saved Adapter URL is reachable and populated lazily
		{
			const mem = installMemoryFs();
			const { mgr, provider } = makeProvider();
			await mem.writeFile(mgr.getWorkflowRepoConfigUri(ENV, TENANT), enc(JSON.stringify({
				version: 1, repoUrl: 'https://github.com/acme/wf', relativePath: 'Workflows/Custom Workflows',
			})));
			const folder = new WorkflowsFolderNode(ENV, TENANT, undefined, true);
			assert.strictEqual(folder.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed,
				'the folder must be expandable or the repository row can never be reached');
			assert.strictEqual(folder.command, undefined, 'a click must expand, not interrupt with the URL prompt');
			assert.strictEqual(
				new WorkflowsFolderNode(ENV, TENANT, undefined, false).collapsibleState,
				vscode.TreeItemCollapsibleState.None, 'unchanged when nothing is connected',
			);

			const asked = [];
			provider.setWorkflowRepoDiscoveryHandler((e, t) => asked.push(`${e}/${t}`));
			const kids = await provider.getChildren(folder);
			assert.ok(kids.some(k => k instanceof WorkflowRepoNode), 'the repository row renders without an Adapter URL');
			assert.ok(!kids.some(k => k instanceof WorkflowFetchActionNode), 'no Fetch row without a URL');
			await provider.getChildren(folder);
			assert.deepStrictEqual(asked, [`${ENV}/${TENANT}`], 'local discovery is requested exactly once');

			provider.markWorkflowRepoFilesDiscovered(ENV, TENANT, [], []);
			provider.clearWorkflowCache(ENV, TENANT);
			await provider.getChildren(folder);
			assert.strictEqual(asked.length, 2, 'removing the tenant resets the one-shot request');
		}

		// 6e. an invalid committed sidecar is ignored and reported once
		{
			const mem = installMemoryFs();
			const { mgr, provider } = makeProvider();
			await mem.writeFile(mgr.getWorkflowRepoConfigUri(ENV, TENANT), enc(JSON.stringify({
				version: 1, repoUrl: 'https://github.com/acme/wf', relativePath: 'Workflows\n!*',
			})));
			const reports = [];
			provider.setInvalidRepoConfigHandler((e, t, reason) => reports.push([e, t, reason]));
			const folder = new WorkflowsFolderNode(ENV, TENANT, ADAPTER);
			const kids = await provider.getChildren(folder);
			const repoRow = kids.find(k => k instanceof WorkflowRepoNode);
			assert.ok(repoRow && !repoRow.config, 'an invalid sidecar means "not connected"');
			await provider.getChildren(folder);
			assert.strictEqual(reports.length, 1, 'reported once per session, not on every render');
			assert.ok(reports[0][2].length > 0);
		}

		// 6f. repo state decorates a definition row; only the downloaded copy decides the actions
		{
			installMemoryFs();
			const { provider } = makeProvider();
			provider.markProcessDefinitionsLoaded(ENV, TENANT, [def('p1')]);
			provider.markWorkflowRepoSync(ENV, TENANT, 1, new Map([['p1', 'changed']]), [], []);
			const rows = await provider.getChildren(new ProcessDefinitionsFolderNode(ENV, TENANT, [def('p1')]));
			assert.strictEqual(rows.length, 1);
			assert.strictEqual(rows[0].contextValue, 'reltio.workflows.processDefinition',
				'a repo difference must not offer Deploy/Compare/Discard on a copy that was never downloaded');
			assert.ok(String(rows[0].description).includes('differs from repository'));

			const downloadedAndEdited = new ProcessDefinitionNode(ENV, TENANT, def('p1'), 'changed', 'clean');
			assert.strictEqual(downloadedAndEdited.contextValue, 'reltio.workflows.processDefinition.changed',
				'a clean repo state must not hide real local edits');
		}

		// 6g. removing a tenant forgets what was fetched
		{
			installMemoryFs();
			const { provider } = makeProvider();
			provider.markProcessDefinitionsLoaded(ENV, TENANT, [def('p1')]);
			provider.clearWorkflowCache(ENV, TENANT);
			assert.strictEqual(provider.hasFetchedProcessDefinitions(ENV, TENANT), false);
		}

		// 6h. Drafts renders above the Custom Workflow Repository row, not below it — in
		// both the "not fetched yet" branch and the normal, fully-loaded branch.
		{
			const mem = installMemoryFs();
			const { mgr, provider } = makeProvider();
			await mem.writeFile(mgr.getWorkflowRepoConfigUri(ENV, TENANT), enc(JSON.stringify({
				version: 1, repoUrl: 'https://github.com/acme/wf', relativePath: 'Workflows/Custom Workflows',
			})));
			await mem.writeFile(
				vscode.Uri.joinPath(mgr.getWorkflowDraftsDirectoryUri(ENV, TENANT), draftFileName('d1')),
				enc(bpmn('d1')),
			);

			// Not fetched yet: only the (optional) Fetch row and the repository row are
			// unconditional; Drafts must still come first among what *does* render.
			const unfetched = new WorkflowsFolderNode(ENV, TENANT, undefined, true);
			const unfetchedKids = await provider.getChildren(unfetched);
			const unfetchedDraftsIdx = unfetchedKids.findIndex(k => k instanceof WorkflowDraftsFolderNode);
			const unfetchedRepoIdx = unfetchedKids.findIndex(k => k instanceof WorkflowRepoNode);
			assert.ok(unfetchedDraftsIdx >= 0 && unfetchedRepoIdx >= 0, 'both rows must render');
			assert.ok(unfetchedDraftsIdx < unfetchedRepoIdx,
				'Drafts must render above Custom Workflow Repository before Workflows has been fetched too');

			// Fully loaded.
			provider.markWorkflowsLoaded(ENV, TENANT, [def('p1')], []);
			const loaded = new WorkflowsFolderNode(ENV, TENANT, ADAPTER);
			const loadedKids = await provider.getChildren(loaded);
			const loadedDraftsIdx = loadedKids.findIndex(k => k instanceof WorkflowDraftsFolderNode);
			const loadedRepoIdx = loadedKids.findIndex(k => k instanceof WorkflowRepoNode);
			assert.ok(loadedDraftsIdx >= 0 && loadedRepoIdx >= 0, 'both rows must render');
			assert.ok(loadedDraftsIdx < loadedRepoIdx,
				'Drafts must render above Custom Workflow Repository once Workflows has been fetched');
		}

		// 6i. a repository file row sets no `resourceUri` — that opts the row into VS Code's
		// native Problems-count badge, which reads as a deploy blocker on a BPMN mid-edit
		// and is not one (the "Deploy to tenant" icon already covers that).
		{
			const fileNode = new WorkflowRepoBpmnFileNode(
				ENV, TENANT, vscode.Uri.file('/rfws/repo/p1.bpmn20.xml'), 'p1', undefined, undefined,
			);
			assert.strictEqual(fileNode.resourceUri, undefined,
				'a repository BPMN row must not carry resourceUri, or VS Code renders a Problems badge next to it');
			assert.ok(fileNode.iconPath, 'the icon must still be set explicitly without resourceUri to drive it');
			assert.deepStrictEqual(fileNode.command.arguments, [fileNode.fileUri],
				'Open BPMN must still work without resourceUri to fall back on');
		}

		// 6j. a Draft or Custom Workflow Repository row shows the process's <process name="…">
		// when the BPMN has one, with the id as a fallback — matching `ProcessDefinitionNode`'s
		// own label rule, so the same workflow does not read as "p1" on one row and
		// "Location DCR Approval" on another depending only on which tree branch is showing it.
		// The id must stay visible (in `description`/`tooltip`) because Deploy keys on it, not the name.
		{
			const named = new WorkflowRepoBpmnFileNode(
				ENV, TENANT, vscode.Uri.file('/rfws/repo/p1.bpmn20.xml'), 'p1', 'Location DCR Approval', undefined,
			);
			assert.strictEqual(named.label, 'Location DCR Approval',
				'a repository row must show the process name as its label when the BPMN has one');
			assert.ok(String(named.description).includes('p1'),
				'the id must still be visible once the label is showing the friendlier name');

			const unnamed = new WorkflowRepoBpmnFileNode(
				ENV, TENANT, vscode.Uri.file('/rfws/repo/p2.bpmn20.xml'), 'p2', undefined, undefined,
			);
			assert.strictEqual(unnamed.label, 'p2',
				'a repository row with no process name must fall back to the id, not show "undefined"');

			const namedDraft = new WorkflowDraftNode(ENV, TENANT, {
				processId: 'd1', fileUri: vscode.Uri.file('/rfws/drafts/d1.bpmn20.xml'),
				fileName: 'd1.bpmn20.xml', processName: 'Address Validation',
			});
			assert.strictEqual(namedDraft.label, 'Address Validation',
				'a draft row must show the process name as its label when the BPMN has one');
			assert.ok(String(namedDraft.description).includes('d1'),
				'the id must still be visible once the draft label is showing the friendlier name');

			const unnamedDraft = new WorkflowDraftNode(ENV, TENANT, {
				processId: 'd2', fileUri: vscode.Uri.file('/rfws/drafts/d2.bpmn20.xml'),
				fileName: 'd2.bpmn20.xml', processName: undefined,
			});
			assert.strictEqual(unnamedDraft.label, 'd2',
				'a draft row with no process name must fall back to the id, not show "undefined"');
		}
	}

	// ── 7. Command Palette: node-only commands are hidden ────────────────────
	{
		const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
		const hidden = new Set(
			(pkg.contributes.menus.commandPalette || []).filter(m => m.when === 'false').map(m => m.command),
		);
		for (const c of [
			'fetchWorkflows', 'refreshWorkflows', 'refreshProcessDefinitions', 'refreshJarDeployments',
			'copyJarModulePath', 'openWorkflowBpmn', 'discardWorkflowBpmnChanges', 'compareWorkflowBpmn', 'deleteWorkflowDraft',
		]) {
			assert.ok(hidden.has(`reltio.${c}`), `reltio.${c} needs a tree node and does nothing from the palette — hide it`);
		}
		// commands that accept an args object or the active editor must stay reachable
		for (const c of ['newWorkflowDraft', 'deployWorkflow', 'previewWorkflowDiagram', 'connectWorkflowRepository', 'registerJarDeployment']) {
			assert.ok(!hidden.has(`reltio.${c}`), `reltio.${c} works without a node and must stay in the palette`);
		}
	}

	// ── 8. Compare / discard plans: the decide/say split behind the two
	// commands that used to read a baseline and branch inline. A draft's
	// `undefined` baseline must refuse both, with the message each command
	// actually shows; a real baseline must hand back exactly what the
	// handler needs to write, so the handler itself has nothing left to get
	// wrong beyond the read and the write.
	{
		const draftDiff = planBpmnDiff('draftOnly', undefined);
		assert.strictEqual(draftDiff.ok, false);
		assert.ok(draftDiff.message.includes('"draftOnly"') && draftDiff.message.includes('has not been downloaded'));

		const fetchedDiff = planBpmnDiff('fetched', '<definitions/>');
		assert.strictEqual(fetchedDiff.ok, true);

		const draftDiscard = planDiscardBpmnChanges('draftOnly', undefined);
		assert.strictEqual(draftDiscard.ok, false);
		assert.ok(draftDiscard.message.includes('"draftOnly"') && draftDiscard.message.includes('nothing to restore'));

		const baselineXml = bpmn('fetched');
		const discard = planDiscardBpmnChanges('fetched', baselineXml);
		assert.strictEqual(discard.ok, true);
		assert.strictEqual(discard.fileName, bpmnFileName('fetched'), 'must restore to the draft/local file name, not the baseline file');
		assert.strictEqual(discard.text, baselineXml, 'must write back exactly the baseline, untouched');
		assert.ok(discard.successMessage.includes('"fetched"') && discard.successMessage.includes('discarded'));
	}

	console.log('test-workflow-review-fixes: OK');
})().catch(err => {
	console.error(err);
	process.exit(1);
});
