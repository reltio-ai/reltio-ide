#!/usr/bin/env node
'use strict';
/**
 * Regression tests: Workflows area (docs/test-proposals/workflows.json).
 *
 *   WF-001  Workspace file safety: the disconnect cleanup plan drops unsafe paths and pairs a
 *           baseline with its BPMN; local BPMN files pair with their baselines; a draft is never
 *           written over an existing file, and listing drafts survives an unreadable one.
 *   WF-012  Analysis and layout scale to large processes within a generous budget.
 *
 * Tier A/B: pure logic, and the real fs-backed code over the in-memory filesystem from
 * scripts/lib/memory-fs.cjs. The shared vscode stub has no `FileSystemError`, which
 * `writeWorkflowDraft` checks for with `instanceof`; this script adds one to the stub object at
 * runtime and makes the in-memory `stat` throw it, as the real API does (scripts/lib unchanged).
 */
const assert = require('assert');
const { importDist } = require('./lib/import-dist.cjs');
const vscode = require('./lib/vscode-stub.cjs');
const { installMemoryFs } = require('./lib/memory-fs.cjs');

if (!vscode.FileSystemError) {
	vscode.FileSystemError = class FileSystemError extends Error {
		constructor(message, code) {
			super(message);
			this.code = code;
		}
	};
}

const { planRepoCleanup } = importDist('workspace/workflowRepoOrigin');
const { listLocalBpmnFiles } = importDist('workspace/workflowBpmnFiles');
const { writeWorkflowDraft, listWorkflowDrafts } = importDist('workspace/workflowDrafts');
const { extractProcessModel } = importDist('workflow/bpmnModel');
const { analyseBpmn } = importDist('workflow/bpmnDiagnostics');
const { layoutProcess, generateDiagramSection } = importDist('workflow/bpmnLayout');
const {
	layoutChain, renderDiagramSection, withDiagramSection, readDiagramLayout, isCompleteFor,
} = importDist('workflow/bpmnDiagram');

const enc = s => new TextEncoder().encode(s);
const dec = b => new TextDecoder().decode(b);

/** In-memory fs whose `stat` miss is a `vscode.FileSystemError` with code `FileNotFound`, like the real API. */
function installFs() {
	const mem = installMemoryFs();
	const stat = mem.stat;
	mem.stat = async uri => {
		try {
			return await stat(uri);
		} catch (e) {
			throw new vscode.FileSystemError(e.message, 'FileNotFound');
		}
	};
	return mem;
}

const bpmn = (id, name) =>
	`<?xml version="1.0"?><definitions><process id="${id}" name="${name}" isExecutable="true"><startEvent id="s"/></process></definitions>`;

/**
 * A process of `n` serviceTasks chained by flows. Every `n / gateways` tasks an exclusive
 * gateway with a default and a conditional branch is put in front of the task, and every
 * `boundaryEvery` tasks a boundary event attached to the task flows to the end event.
 */
function chainedProcess(n, gateways, boundaryEvery) {
	const parts = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:activiti="http://activiti.org/bpmn"',
		'             xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:omgdc="http://www.omg.org/spec/DD/20100524/DC"',
		'             xmlns:omgdi="http://www.omg.org/spec/DD/20100524/DI">',
		'<process id="big" name="Big" isExecutable="true">',
		'<startEvent id="start" name="Start"/>',
	];
	let prev = 'start';
	let flow = 0;
	let gatewayCount = 0;
	let boundaryCount = 0;
	const every = gateways ? Math.floor(n / gateways) : 0;
	for (let i = 0; i < n; i++) {
		const id = `t${i}`;
		if (every && i % every === 0 && gatewayCount < gateways) {
			const g = `g${i}`;
			gatewayCount++;
			parts.push(`<sequenceFlow id="f${flow++}" sourceRef="${prev}" targetRef="${g}"/>`);
			parts.push(`<exclusiveGateway id="${g}" name="Gate ${i}" default="f${flow}"/>`);
			parts.push(`<sequenceFlow id="f${flow++}" sourceRef="${g}" targetRef="${id}"/>`);
			parts.push(`<sequenceFlow id="f${flow++}" name="Yes" sourceRef="${g}" targetRef="${id}"><conditionExpression><![CDATA[\${x == 'a'}]]></conditionExpression></sequenceFlow>`);
		} else {
			parts.push(`<sequenceFlow id="f${flow++}" sourceRef="${prev}" targetRef="${id}"/>`);
		}
		parts.push(`<serviceTask id="${id}" name="Task ${i}" activiti:class="com.reltio.workflow.activiti.service.ChangeRequestApply"/>`);
		if (boundaryEvery && i % boundaryEvery === 0) {
			boundaryCount++;
			parts.push(`<boundaryEvent id="b${i}" attachedToRef="${id}"/>`);
			parts.push(`<sequenceFlow id="f${flow++}" sourceRef="b${i}" targetRef="end"/>`);
		}
		prev = id;
	}
	parts.push(`<sequenceFlow id="f${flow++}" sourceRef="${prev}" targetRef="end"/>`, '<endEvent id="end" name="End"/>', '</process>', '</definitions>', '');
	return { xml: parts.join('\n'), nodes: n + gatewayCount + boundaryCount + 2, flows: flow, gateways: gatewayCount, boundaries: boundaryCount };
}

(async () => {
	// ── WF-001 #1: the disconnect cleanup plan ───────────────────────────────
	{
		const plan = planRepoCleanup({
			tracked: [
				'../x', '/abs', 'C:/x', '.git/config',
				'pom.xml', 'bpmn/repo.bpmn20.xml', 'bpmn/edited.bpmn20.xml', 'bpmn/unpushed.bpmn20.xml',
			],
			modified: ['bpmn/edited.bpmn20.xml'],
			unpushed: ['bpmn/unpushed.bpmn20.xml'],
			ignored: [
				'mod/target/A.class',
				'.env',
				'bpmn/repo.bpmn20.baseline.xml',
				'bpmn/edited.bpmn20.baseline.xml',
			],
		});
		const all = [...plan.remove, ...plan.keptModified];
		for (const unsafe of ['../x', '/abs', 'C:/x', '.git/config']) {
			assert.ok(!all.includes(unsafe), `WF-001 #1: unsafe path ${JSON.stringify(unsafe)} is dropped from the plan`);
		}
		assert.deepStrictEqual(plan.keptModified, ['bpmn/edited.bpmn20.xml', 'bpmn/unpushed.bpmn20.xml'],
			'WF-001 #1: modified and unpushed files go to keptModified');
		assert.ok(plan.remove.includes('mod/target/A.class'), 'WF-001 #1: ignored target/ output is removed');
		assert.ok(!plan.remove.includes('.env'), 'WF-001 #1: an ignored .env stays');
		assert.ok(plan.remove.includes('bpmn/repo.bpmn20.baseline.xml'), 'WF-001 #1: a baseline goes with its removed BPMN');
		assert.ok(!plan.remove.includes('bpmn/edited.bpmn20.baseline.xml'), 'WF-001 #1: the baseline of a kept BPMN stays');
		assert.deepStrictEqual(plan.remove, ['bpmn/repo.bpmn20.baseline.xml', 'bpmn/repo.bpmn20.xml', 'mod/target/A.class', 'pom.xml'],
			'WF-001 #1: exactly the clean tracked files, their baselines and build output are removed');
	}

	// ── WF-001 #2: local BPMN files pair with their baselines ────────────────
	{
		const mem = installFs();
		const dir = vscode.Uri.file('/t/Workflows/bpmn');
		const put = (name, text) => mem.writeFile(vscode.Uri.joinPath(dir, name), enc(text));
		await put('c.bpmn20.xml', bpmn('c', 'C'));
		await put('b.bpmn20.xml', bpmn('b', 'B edited'));
		await put('b.bpmn20.baseline.xml', bpmn('b', 'B'));
		await put('a.bpmn20.xml', bpmn('a', 'A'));
		await put('a.bpmn20.baseline.xml', bpmn('a', 'A'));
		await put('notes.txt', 'not a bpmn');

		const list = await listLocalBpmnFiles(dir);
		assert.deepStrictEqual(list.map(f => f.processId), ['a', 'b', 'c'], 'WF-001 #2: a, b, c sorted by id; notes.txt and baselines ignored');
		assert.deepStrictEqual(list.map(f => f.hasLocalChanges), [false, true, false], 'WF-001 #2: hasLocalChanges false/true/false');
		assert.strictEqual(list[2].baselineText, undefined, 'WF-001 #2: c has no baseline, so it is a draft');
		assert.strictEqual(list[0].baselineText, bpmn('a', 'A'), 'WF-001 #2: a carries its baseline text');
		assert.deepStrictEqual(await listLocalBpmnFiles(vscode.Uri.file('/t/missing')), [], 'WF-001 #2: a missing directory returns []');
	}

	// ── WF-001 #3: drafts are never overwritten; listing survives a bad read ──
	{
		const mem = installFs();
		const drafts = vscode.Uri.file('/t/Workflows/bpmn');
		const first = bpmn('flow', 'First');
		const uri = await writeWorkflowDraft(drafts, 'flow.bpmn20.xml', first);
		assert.strictEqual(dec(await mem.readFile(uri)), first, 'WF-001 #3: the first write lands');
		await assert.rejects(
			() => writeWorkflowDraft(drafts, 'flow.bpmn20.xml', bpmn('flow', 'Second')),
			e => /already exists/.test(e.message),
			'WF-001 #3: a second write of the same file name rejects with "already exists"',
		);
		assert.strictEqual(dec(await mem.readFile(uri)), first, 'WF-001 #3: the first content is intact');

		const mem2 = installFs();
		const folder = vscode.Uri.file('/t2/Workflows/bpmn');
		await mem2.writeFile(vscode.Uri.joinPath(folder, 'zeta.bpmn20.xml'), enc(bpmn('zeta', 'Zeta Name')));
		await mem2.writeFile(vscode.Uri.joinPath(folder, 'readme.md'), enc('# not a draft'));
		await mem2.writeFile(vscode.Uri.joinPath(folder, 'alpha.bpmn20.xml'), enc(bpmn('alpha', 'Alpha')));
		const readFile = mem2.readFile;
		mem2.readFile = async u => {
			if (u.fsPath.endsWith('alpha.bpmn20.xml')) throw new Error('EACCES');
			return readFile(u);
		};
		const listed = await listWorkflowDrafts(folder);
		assert.deepStrictEqual(listed.map(d => [d.processId, d.processName]), [['alpha', undefined], ['zeta', 'Zeta Name']],
			'WF-001 #3: only drafts, sorted by id, processName undefined when unreadable');
	}

	// ── WF-012 #1: analysis of a 2000-task process ────────────────────────────
	{
		const gen = chainedProcess(2000, 10, 0);
		const bare = extractProcessModel(gen.xml);
		const xml = withDiagramSection(gen.xml, renderDiagramSection('big', bare, layoutChain(bare.nodes, bare.flows)));

		let started = Date.now();
		const model = extractProcessModel(xml);
		const extractMs = Date.now() - started;
		started = Date.now();
		const findings = analyseBpmn(xml, { fileProcessId: 'big' });
		const analyseMs = Date.now() - started;

		assert.ok(extractMs < 3000, `WF-012 #1: extractProcessModel took ${extractMs} ms (budget 3000)`);
		assert.ok(analyseMs < 3000, `WF-012 #1: analyseBpmn took ${analyseMs} ms (budget 3000)`);
		assert.strictEqual(model.nodes.length, gen.nodes, 'WF-012 #1: node count equals the generated number');
		assert.strictEqual(model.flows.length, gen.flows, 'WF-012 #1: flow count equals the generated number');
		assert.deepStrictEqual(findings.map(f => f.code), [], 'WF-012 #1: no finding for a valid chain');
	}

	// ── WF-012 #2: layout of 300 tasks with gateways and boundary events ─────
	{
		const gen = chainedProcess(300, 20, 30);
		const model = extractProcessModel(gen.xml);
		assert.strictEqual(gen.gateways, 20, "WF-012 #2: fixture has 20 exclusive gateways");
		assert.ok(gen.boundaries > 0, "WF-012 #2: fixture has boundary events");

		const started = Date.now();
		const layout = await layoutProcess(model);
		const section = await generateDiagramSection(gen.xml);
		const elapsed = Date.now() - started;
		assert.ok(elapsed < 15000, `WF-012 #2: layoutProcess + generateDiagramSection took ${elapsed} ms (budget 15000)`);

		for (const node of model.nodes) {
			assert.ok(layout.bounds.get(node.id), `WF-012 #2: node ${node.id} has bounds`);
		}
		for (const flow of model.flows) {
			const points = layout.waypoints.get(flow.id);
			assert.ok(points && points.length >= 2, `WF-012 #2: flow ${flow.id} has waypoints`);
		}
		assert.ok(typeof section === 'string' && section.length > 0, 'WF-012 #2: a diagram section is produced');
		const drawn = withDiagramSection(gen.xml, section);
		assert.ok(isCompleteFor(readDiagramLayout(drawn), extractProcessModel(drawn)), 'WF-012 #2: the section parses and passes isCompleteFor');
	}

	console.log('test-workflows: OK');
})().catch(err => {
	console.error(err);
	process.exit(1);
});
