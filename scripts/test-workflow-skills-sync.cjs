#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: workflow-review-fixes (skills delivery)
 *
 * Behaviour of `syncReltioAgentAssets` and `stripManagedBlock` over an in-memory file system:
 *
 *   1.  A fresh sync copies the skills under `.reltio/reltio-agent/` and writes nothing outside `.reltio/`.
 *   2.  A workspace already stamped current still gets the legacy cleanup.
 *   3.  Only files carrying the 1.0.24 marker text are removed; a customer-owned `reltio-*` skill, or a
 *       `reltio-*` folder holding other files, is left alone, and folders we did not empty stay.
 *   4.  `stripManagedBlock` removes every block, never collapses the user's blank lines, and leaves a file
 *       with an unterminated block untouched.
 *   5.  AGENTS.md with user content keeps it; a file that held only the block is deleted.
 *   6.  Concurrent syncs never interleave; identical startup requests share one run.
 *   7.  A failed startup sync is logged and warned once; a forced resync rejects to its caller.
 */
const assert = require('assert');
const Module = require('module');
const path = require('path');
const vscode = require('./lib/vscode-stub.cjs');
const { installMemoryFs } = require('./lib/memory-fs.cjs');

const origLoad = Module._load;
Module._load = function (request, ...rest) {
	return request === 'vscode' ? vscode : origLoad.call(this, request, ...rest);
};
const { syncReltioAgentAssets, stripManagedBlock } =
	require(path.join(__dirname, '..', 'dist/workspace/reltioAgentSync.js'));
Module._load = origLoad;

const enc = text => Buffer.from(text, 'utf8');
const dec = bytes => Buffer.from(bytes).toString('utf8');
const BEGIN = '<!-- reltio-ide:begin — managed by the Reltio extension -->';
const END = '<!-- reltio-ide:end -->';
const block = `${BEGIN}\nuse the skills\n${END}`;
const POINTER = '---\nname: reltio-workflow-bpmn-authoring-pointer\ndescription: Pointer to the bundled BPMN authoring playbook for Reltio Workflow.\n---\n\n# pointer\n';
const RULE = '---\ndescription: Reltio skills are installed in this workspace\nalwaysApply: true\n---\nread them\n';

const ws = { uri: vscode.Uri.file('/ws'), name: 'ws', index: 0 };
const context = {
	extensionUri: vscode.Uri.file('/ext'),
	extension: { packageJSON: { version: '9.9.9' } },
};

function world(options = {}) {
	const mem = installMemoryFs();
	vscode.workspace.workspaceFolders = [ws];
	const put = (p, text) => mem.writeFile(p, enc(text));
	return (async () => {
		await put('/ext/resources/reltio-agent-assets.json', JSON.stringify({ skillsBundleVersion: options.version ?? '20', velocityPacksBundleVersion: '1' }));
		await put('/ext/skills/reltio-default/workflow-assistant/SKILL.md', 'assistant');
		await put('/ext/skills/reltio-default/workflow-bpmn-authoring/references/bpmn-rules.md', 'rules');
		await put('/ext/resources/velocity-packs/pack.json', '{}');
		return { mem, put, has: p => mem._files.has(p) || mem._dirs.has(p), text: p => dec(mem._files.get(p)) };
	})();
}

(async () => {
	// ── 1. Fresh sync ─────────────────────────────────────────────────────────
	{
		const w = await world();
		await syncReltioAgentAssets(context);
		assert.strictEqual(w.text('/ws/.reltio/reltio-agent/skills/default/workflow-assistant/SKILL.md'), 'assistant');
		assert.ok(w.has('/ws/.reltio/reltio-agent/skills/default/workflow-bpmn-authoring/references/bpmn-rules.md'));
		assert.ok(w.has('/ws/.reltio/reltio-agent/velocity-packs/pack.json'));
		assert.strictEqual(JSON.parse(w.text('/ws/.reltio/reltio-agent/.sync-state.json')).skillsBundleVersion, '20');
		// Agent skill discovery (openspec: match-rule-generation-skill) also always writes the
		// always-on guide file for the detected host and keeps `.gitignore` current for it — both
		// outside `.reltio/` by design, since they are what makes a skill discoverable without an
		// @-mention. Neither fixture skill above has valid frontmatter, so no skill folder itself
		// is written in this world; anything beyond these two paths would be a real leak.
		const outside = [...w.mem._files.keys()].filter(f => f.startsWith('/ws/') && !f.startsWith('/ws/.reltio/'));
		assert.deepStrictEqual(
			outside.sort(),
			['/ws/.claude/rules/reltio-skills.md', '/ws/.gitignore'],
			'only the always-on guide file and .gitignore may be written outside .reltio/',
		);
	}

	// ── 2 + 3 + 5. Legacy cleanup on a workspace that is already current ───────
	{
		const w = await world();
		await syncReltioAgentAssets(context);                       // stamp is now current
		await w.put('/ws/.cursor/rules/reltio-workflows.mdc', RULE);
		await w.put('/ws/.cursor/skills/reltio-workflow-bpmn-authoring/SKILL.md', POINTER);
		// customer-owned: copied by the customer, so it has no pointer marker
		await w.put('/ws/.cursor/skills/reltio-entity-type-concepts/SKILL.md', '---\nname: reltio-entity-type-concepts\ndescription: mine\n---\nbody\n');
		// our file name, but the folder also holds the customer's own files
		await w.put('/ws/.cursor/skills/reltio-match-groups-from-concept/SKILL.md', POINTER.replace('bpmn-authoring', 'match-groups'));
		await w.put('/ws/.cursor/skills/reltio-match-groups-from-concept/notes.md', 'customer notes');
		await w.put('/ws/AGENTS.md', `# Mine\n\nkeep me\n\n${block}\n`);
		await w.put('/ws/CLAUDE.md', `${block}\n`);

		await syncReltioAgentAssets(context);                       // stamp equals bundled: nothing to copy

		assert.ok(!w.has('/ws/.cursor/rules/reltio-workflows.mdc'), 'the rule we wrote is removed');
		assert.ok(!w.has('/ws/.cursor/rules'), 'rules/ was emptied by us, so it goes');
		assert.ok(!w.has('/ws/.cursor/skills/reltio-workflow-bpmn-authoring'), 'our pointer folder is removed');
		assert.ok(w.has('/ws/.cursor/skills/reltio-entity-type-concepts/SKILL.md'), 'a customer-owned reltio-* skill is untouched');
		assert.strictEqual(w.text('/ws/.cursor/skills/reltio-match-groups-from-concept/notes.md'), 'customer notes');
		assert.ok(w.has('/ws/.cursor/skills'), 'skills/ still holds customer folders');
		assert.ok(/keep me/.test(w.text('/ws/AGENTS.md')) && !/reltio-ide/.test(w.text('/ws/AGENTS.md')), 'user content survives, block is gone');
		assert.ok(!w.has('/ws/CLAUDE.md'), 'a file that held only the block is deleted');
	}

	// ── 3b. A customer rule with the same file name but other content stays ───
	{
		const w = await world();
		await w.put('/ws/.cursor/rules/reltio-workflows.mdc', '---\ndescription: my own rule\n---\n');
		await syncReltioAgentAssets(context);
		assert.ok(w.has('/ws/.cursor/rules/reltio-workflows.mdc'));
	}

	// ── 4. stripManagedBlock ──────────────────────────────────────────────────
	{
		const fence = '```\na\n\n\n\nb\n```';
		const text = `# T\n\n${block}\n\n${fence}\n\n${block}\ntail\n`;
		const out = stripManagedBlock(text);
		assert.ok(!out.includes('reltio-ide'), 'both blocks are removed');
		assert.ok(out.includes(fence), 'the code fence with three blank lines is unchanged');
		assert.ok(out.includes('tail') && out.startsWith('# T\n\n'));
		assert.strictEqual(stripManagedBlock(`${block}\n`), undefined);
		const unterminated = `# Mine\n${BEGIN}\nnever closed\nuser text\n`;
		assert.strictEqual(stripManagedBlock(unterminated), unterminated, 'a missing end marker leaves the file untouched');
		const half = `${block}\n${BEGIN}\nnever closed\n`;
		assert.strictEqual(stripManagedBlock(half), half, 'any unterminated block leaves the whole file untouched');
		assert.strictEqual(stripManagedBlock('# Mine\n\n\n\nx\n'), '# Mine\n\n\n\nx\n');
	}

	// ── 6. Serialization ──────────────────────────────────────────────────────
	{
		const w = await world();
		const events = [];
		const realRead = w.mem.readFile;
		w.mem.readFile = async uri => {
			if (String(uri.fsPath).replace(/\\/g, '/').endsWith('reltio-agent-assets.json')) {
				events.push('start');
				await new Promise(r => setTimeout(r, 15));
			}
			return realRead(uri);
		};
		const realWrite = w.mem.writeFile;
		w.mem.writeFile = async (uri, bytes) => {
			await realWrite(uri, bytes);
			if (String(uri.fsPath).replace(/\\/g, '/').endsWith('.sync-state.json')) events.push('end');
		};

		const startup = syncReltioAgentAssets(context);
		const again = syncReltioAgentAssets(context);
		assert.strictEqual(again, startup, 'an identical request while one is running shares it');
		const forced = syncReltioAgentAssets(context, { force: true });
		await Promise.all([startup, forced]);
		assert.deepStrictEqual(events, ['start', 'end', 'start', 'end'], 'the forced resync waits for the running one, then runs');
	}

	// ── 7. Failures are visible ───────────────────────────────────────────────
	{
		const w = await world();
		w.mem.createDirectory = async () => { throw new Error('disk full'); };
		const warnings = [];
		const errors = [];
		const realWarn = vscode.window.showWarningMessage;
		const realError = console.error;
		vscode.window.showWarningMessage = async message => { warnings.push(message); };
		console.error = (...args) => errors.push(args);
		try {
			await assert.rejects(syncReltioAgentAssets(context), /disk full/);
			await assert.rejects(syncReltioAgentAssets(context), /disk full/);
			assert.strictEqual(errors.length, 2, 'every startup failure is logged');
			assert.strictEqual(warnings.length, 1, 'the user is warned once');
			await assert.rejects(syncReltioAgentAssets(context, { force: true }), /disk full/);
			assert.strictEqual(errors.length, 2, 'a forced resync is reported by its caller, not here');
			assert.strictEqual(warnings.length, 1);
		} finally {
			vscode.window.showWarningMessage = realWarn;
			console.error = realError;
		}
	}

	console.log('test-workflow-skills-sync: OK');
})().catch(err => {
	console.error(err);
	process.exit(1);
});
