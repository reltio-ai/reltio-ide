#!/usr/bin/env node
'use strict';
/**
 * Every deployed BPMN is downloaded when the Process Definitions list loads.
 *
 * Tier A - pure:
 *   1. `planBulkDownload`: only missing, valid, unique ids; never an existing file.
 *   2. `runBounded`: concurrency limit, failures isolated, abort on repeated failures, cancel.
 * Tier B - in-memory filesystem:
 *   3. `ensureBaselineExcluded`: heals an existing clone, idempotent, never creates `.git`.
 * Tier C - structural:
 *   4. The extension wires the download into both list loaders, never awaited, never overwriting.
 *   5. Custom workflows are back on the class icon.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');
const vscode = require('./lib/vscode-stub.cjs');
const { installMemoryFs } = require('./lib/memory-fs.cjs');

const { planBulkDownload, runBounded } = importDist('workspace/workflowBulkDownload');
const { ensureBaselineExcluded } = importDist('workspace/workflowRepoConnect');
const { ProcessDefinitionNode } = importDist('tree/workflowNodes');

const enc = text => new TextEncoder().encode(text);
const dec = bytes => new TextDecoder().decode(bytes);

async function main() {
	// -- 1. planBulkDownload ---------------------------------------------------------------------
	{
		const plan = planBulkDownload(['a', 'b', 'c'], []);
		assert.deepStrictEqual(plan.toDownload, ['a', 'b', 'c'], 'everything is downloaded when nothing is on disk');
		assert.deepStrictEqual(plan.alreadyOnDisk, []);

		const some = planBulkDownload(['a', 'b', 'c'], ['b.bpmn20.xml', 'b.bpmn20.baseline.xml', 'notes.txt']);
		assert.deepStrictEqual(some.toDownload, ['a', 'c']);
		assert.deepStrictEqual(some.alreadyOnDisk, ['b'], 'an existing file is never replaced');

		// A baseline alone does not count as the file being there.
		assert.deepStrictEqual(planBulkDownload(['b'], ['b.bpmn20.baseline.xml']).toDownload, ['b']);

		// Windows and macOS file systems ignore case: Foo and foo are one file.
		assert.deepStrictEqual(planBulkDownload(['Foo'], ['foo.bpmn20.xml']).toDownload, [], 'existing file, other case');
		assert.deepStrictEqual(planBulkDownload(['Foo', 'foo'], []).toDownload, ['Foo'], 'two ids that share a file name are fetched once');

		// The id becomes a file name, so anything unsafe is refused, never written.
		const hostile = planBulkDownload(['../evil', 'a/b', 'con', '', ' x', 'x'.repeat(65), 'ok_1'], []);
		assert.deepStrictEqual(hostile.toDownload, ['ok_1']);
		assert.strictEqual(hostile.unusable.length, 6);

		// Order is the list's, duplicates in the list are fetched once, and the input is not mutated.
		const ids = ['z', 'a', 'z'];
		assert.deepStrictEqual(planBulkDownload(ids, []).toDownload, ['z', 'a']);
		assert.deepStrictEqual(ids, ['z', 'a', 'z']);

		assert.deepStrictEqual(planBulkDownload([], ['a.bpmn20.xml']).toDownload, [], 'an empty tenant is a no-op');
	}

	// -- 2. runBounded -----------------------------------------------------------------------------
	{
		// Never more than `limit` in flight, and everything runs.
		let inFlight = 0;
		let peak = 0;
		const seen = [];
		const ok = await runBounded(Array.from({ length: 20 }, (_, i) => i), 4, async n => {
			inFlight++;
			peak = Math.max(peak, inFlight);
			await new Promise(r => setTimeout(r, 2));
			seen.push(n);
			inFlight--;
		});
		assert.deepStrictEqual(ok, { succeeded: 20, failed: 0, aborted: false });
		assert.ok(peak <= 4 && peak > 1, `peak concurrency ${peak} must be bounded but real`);
		assert.deepStrictEqual([...seen].sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i));

		// A failure is counted and does not stop the others.
		const mixed = await runBounded([1, 2, 3, 4, 5, 6], 2, async n => { if (n % 2 === 0) throw new Error('boom'); });
		assert.deepStrictEqual(mixed, { succeeded: 3, failed: 3, aborted: false });

		// Repeated failures (an expired token) stop the run instead of hammering the server.
		let calls = 0;
		const dead = await runBounded(Array.from({ length: 100 }, (_, i) => i), 1, async () => { calls++; throw new Error('401'); },
			{ abortAfterConsecutiveFailures: 5 });
		assert.strictEqual(dead.aborted, true);
		assert.strictEqual(calls, 5, 'stops after the fifth consecutive failure');

		// A success resets the streak.
		let n = 0;
		const flaky = await runBounded(Array.from({ length: 30 }, (_, i) => i), 1, async () => {
			n++;
			if (n % 3 !== 0) throw new Error('x');
		}, { abortAfterConsecutiveFailures: 3 });
		assert.strictEqual(flaky.aborted, false, 'two failures then a success never reaches three in a row');

		// Cancellation is honoured before each item.
		let started = 0;
		const cancelled = await runBounded([1, 2, 3, 4], 1, async () => { started++; }, { isCancelled: () => started >= 2 });
		assert.strictEqual(started, 2);
		assert.strictEqual(cancelled.succeeded, 2);

		// Degenerate inputs.
		assert.deepStrictEqual(await runBounded([], 4, async () => { throw new Error('never'); }), { succeeded: 0, failed: 0, aborted: false });
		assert.strictEqual((await runBounded([1], 0, async () => {})).succeeded, 1, 'a limit below 1 still runs');
	}

	// -- 3. ensureBaselineExcluded -----------------------------------------------------------------
	{
		const WF = vscode.Uri.file('/ex/Workflows');
		const excludeUri = vscode.Uri.joinPath(WF, '.git', 'info', 'exclude');

		// Not a repository: nothing is created, least of all a `.git` folder.
		const plain = installMemoryFs();
		await plain.writeFile(vscode.Uri.joinPath(WF, 'bpmn', 'a.bpmn20.xml'), enc('<x/>'));
		await ensureBaselineExcluded(WF);
		assert.ok(![...plain._dirs].some(d => d.includes('.git')), 'a plain folder must not gain a .git folder');

		// A clone whose exclude file lacks the pattern gets it, once.
		const repo = installMemoryFs();
		await repo.writeFile(vscode.Uri.joinPath(WF, '.git', 'HEAD'), enc('ref: refs/heads/main\n'));
		await repo.writeFile(excludeUri, enc('# custom\n*.log\n'));
		await ensureBaselineExcluded(WF);
		const once = dec(await repo.readFile(excludeUri));
		assert.ok(once.includes('*.log') && once.includes('# custom'), 'existing lines are kept');
		assert.strictEqual(once.split('*.bpmn20.baseline.xml').length - 1, 1);
		await ensureBaselineExcluded(WF);
		assert.strictEqual(dec(await repo.readFile(excludeUri)), once, 'running again changes nothing');

		// A clone with no exclude file at all gets one.
		const bare = installMemoryFs();
		await bare.writeFile(vscode.Uri.joinPath(WF, '.git', 'HEAD'), enc('ref: refs/heads/main\n'));
		await ensureBaselineExcluded(WF);
		assert.ok(dec(await bare.readFile(excludeUri)).includes('*.bpmn20.baseline.xml'));
	}

	// -- 4. Wiring in the extension ----------------------------------------------------------------
	{
		const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf8');
		assert.ok(/void downloadAllBpmnCopies\(environmentName, tenantId, definitions\);\s*\n\s*await refreshWorkflowRepoSyncState/.test(src),
			'both list loaders start the download without awaiting it');
		assert.strictEqual(src.split('void downloadAllBpmnCopies(').length - 1, 2, 'exactly the two list loaders trigger it');

		const body = src.slice(src.indexOf('async function downloadAllBpmnCopies('), src.indexOf('/** Restore a local BPMN to its baseline'));
		assert.ok(body.includes('planBulkDownload('), 'the plan decides what is fetched');
		assert.ok(body.includes('bulkBpmnDownloadsInFlight'), 'overlapping refreshes do not stack downloads');
		assert.ok(body.includes('GIT_SOURCE_TOKEN'), 'a Git-sourced workspace has no tenant to download from');
		assert.ok(/=== undefined\) \{\s*\n\s*await writeBpmnFile/.test(body), 'the write re-checks that the file is still absent');
		assert.ok(!body.includes('showErrorMessage'), 'failures are summarised once as a warning, never one error per workflow');
		assert.ok(body.includes('abortAfterConsecutiveFailures'), 'a dead token stops the run');
		assert.ok(body.includes('ensureBaselineExcluded('), 'baselines are ignored by git before they are written');
		assert.ok(src.includes("await ensureBaselineExcluded(environmentManager!.getWorkflowRepoDirectoryUri(environmentName, tenantId));"),
			'a single download heals the ignore line too');
	}

	// -- 5. Icons -------------------------------------------------------------------------------------
	{
		const mk = generic => new ProcessDefinitionNode('env', 'tenant', { type: 't', displayName: 'T', generic }, 'none');
		assert.strictEqual(mk(false).iconPath.id, 'symbol-class', 'custom workflows are back on the class icon');
		assert.strictEqual(mk(true).iconPath.id, 'symbol-method', 'OOTB workflows keep the method icon');
		assert.ok(mk(false).tooltip.value.startsWith('**Custom workflow**'));
	}

	console.log('test-workflow-bulk-download: OK');
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
