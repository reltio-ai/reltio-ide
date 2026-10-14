#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: workflow-skills-library
 *
 * Tier B — structural. These playbooks are content, not code, so the failure
 * modes are different: the bundle silently not reaching anyone, house style
 * drifting until the set stops reading as one library, and internal-only
 * material leaking into a customer's workspace.
 *
 *   1.  skillsBundleVersion raised above "1"; velocityPacksBundleVersion untouched.
 *   2.  All four playbooks exist with non-empty SKILL.md.
 *   3.  Exactly two frontmatter fields; name matches reltio-<folder>.
 *   4.  Sections When to use / Inputs / Procedure / Outputs, in that order.
 *   5.  The last Input is the skills/workspace/<folder>/SKILL.md override.
 *   6.  Every Procedure step opens with a bolded verb.
 *   7.  One .cursor pointer per playbook, naming canonical and materialized paths.
 *   8.  bpmn-rules.md ships and carries the full OOTB class allow-list.
 *   9.  Curation guard — no internal-only references anywhere in the bundle.
 *  10.  .vscodeignore still whitelists skills/**, so the bundle actually ships.
 *
 * Tier C (manual) — documented in design.md's test plan.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(repoRoot, p), 'utf-8');

const PLAYBOOKS = [
	'workflow-bpmn-authoring',
	'workflow-jar-customization',
	'workflow-repo-contribution',
	'workflow-local-adapter-setup',
];

// ── 1. The bundle actually reaches existing users ───────────────────────────
// The sync gate is a string inequality against the user's .sync-state.json.
// Without a bump, every one of these files exists in the VSIX and reaches nobody.
{
	const assets = JSON.parse(read('resources/reltio-agent-assets.json'));
	assert.ok(assets.skillsBundleVersion, 'skillsBundleVersion must be present');
	assert.notStrictEqual(
		assets.skillsBundleVersion, '1',
		'skillsBundleVersion must be raised, or existing workspaces never receive the workflow playbooks',
	);
	assert.strictEqual(
		assets.velocityPacksBundleVersion, '1',
		'velocityPacksBundleVersion must be left alone — this change ships no packs',
	);
}

// ── 2-6. Each playbook, in house style ──────────────────────────────────────
for (const folder of PLAYBOOKS) {
	const rel = `skills/reltio-default/${folder}/SKILL.md`;
	assert.ok(fs.existsSync(path.join(repoRoot, rel)), `${rel} must exist`);
	const text = read(rel);
	const lines = text.split(/\r?\n/);

	assert.ok(text.trim().length > 0, `${rel} must not be empty`);

	// 3. frontmatter: exactly two fields, name derived from the folder
	assert.strictEqual(lines[0], '---', `${rel} must open with frontmatter`);
	const close = lines.indexOf('---', 1);
	assert.ok(close > 1, `${rel} frontmatter must close`);
	const fields = lines.slice(1, close).filter(l => /^[a-z]+:/.test(l));
	assert.strictEqual(fields.length, 2, `${rel} must declare exactly two frontmatter fields`);
	assert.ok(
		fields[0] === `name: reltio-${folder}`,
		`${rel} name must be "reltio-${folder}", got: ${fields[0]}`,
	);
	assert.ok(fields[1].startsWith('description: '), `${rel} needs a description`);

	// 4. the four sections, in order
	const sections = lines.filter(l => l.startsWith('## ')).map(l => l.slice(3).trim());
	assert.deepStrictEqual(
		sections, ['When to use', 'Inputs', 'Procedure', 'Outputs'],
		`${rel} must carry the house sections in order, got: ${sections.join(' / ')}`,
	);

	// 5. the workspace-override escape hatch is the last Input
	const inputsBlock = text.split('## Inputs')[1].split('## Procedure')[0];
	const inputItems = inputsBlock.split(/\n(?=\d+\.)/).filter(l => /^\d+\./.test(l.trim()));
	assert.ok(
		inputItems[inputItems.length - 1].includes(`skills/workspace/${folder}/SKILL.md`),
		`${rel}'s last Input must be the skills/workspace/${folder}/SKILL.md override`,
	);

	// 6. every Procedure step opens with a bolded verb
	const procBlock = text.split('## Procedure')[1].split('## Outputs')[0];
	const steps = procBlock.split('\n').filter(l => /^\d+\.\s/.test(l));
	assert.ok(steps.length >= 3, `${rel} needs a real procedure, found ${steps.length} steps`);
	for (const step of steps) {
		assert.ok(
			/^\d+\.\s\*\*[A-Z]/.test(step),
			`${rel}: every Procedure step must open with a bolded verb — "${step.slice(0, 48)}…"`,
		);
	}

	// 7. a Cursor pointer exists and names both paths
	const pointerRel = `.cursor/skills/reltio-${folder}/SKILL.md`;
	assert.ok(fs.existsSync(path.join(repoRoot, pointerRel)), `${pointerRel} must exist`);
	const pointer = read(pointerRel);
	assert.ok(pointer.includes(rel), `${pointerRel} must name the canonical path`);
	assert.ok(
		pointer.includes(`.reltio/reltio-agent/skills/default/${folder}/SKILL.md`),
		`${pointerRel} must name the materialized path`,
	);
}

// ── 8. The determinism reference ships, and is complete ─────────────────────
// An assistant that invents a fully-qualified class name produces a BPMN that
// deploys and then fails at runtime, which is the worst failure shape available.
{
	const rulesRel = 'skills/reltio-default/workflow-bpmn-authoring/references/bpmn-rules.md';
	assert.ok(fs.existsSync(path.join(repoRoot, rulesRel)), `${rulesRel} must ship beside the playbook`);
	const rules = read(rulesRel);

	for (const cls of [
		'com.reltio.workflow.activiti.service.ChangeRequestApply',
		'com.reltio.workflow.activiti.service.ChangeRequestReject',
		'com.reltio.workflow.activiti.service.Merge',
		'com.reltio.workflow.activiti.service.NotAMatch',
		'com.reltio.workflow.activiti.service.Delete',
		'com.reltio.workflow.activiti.service.TaskStartEventListener',
		'com.reltio.workflow.activiti.service.DCRTypeTaskListener',
		'com.reltio.workflow.activiti.service.EntityTypeTaskListener',
		'com.reltio.workflow.activiti.service.TaskAssignmentEventListener',
		'com.reltio.workflow.core.task.validator.DataChangeRequestValidator',
		'com.reltio.workflow.core.task.validator.PotentialMatchTaskValidator',
		'com.reltio.workflow.activiti.service.DCRHasChangesListener',
	]) {
		assert.ok(rules.includes(cls), `${rulesRel} must list the OOTB class ${cls}`);
	}

	// The rules that decide whether a deploy succeeds at all.
	for (const [needle, why] of [
		['http://activiti.org/bpmn', 'the activiti namespace'],
		['errorCode 10044', 'the missing-create-listener failure'],
		['errorCode 13032', 'the multi-instance ordering failure'],
		['errorCode 10002', 'the file-extension contract'],
		['dataChangeRequestReview', 'the DCR process-id rule'],
		['default=', 'the gateway default-flow rule'],
		['isExecutable="true"', 'the executable-process rule'],
	]) {
		assert.ok(rules.includes(needle), `${rulesRel} must cover ${why} (missing: ${needle})`);
	}

	assert.ok(/##\s*10\./.test(rules) || rules.includes('Validation checklist'),
		`${rulesRel} must carry the validation checklist`);
	assert.ok(rules.includes('Deny-list'), `${rulesRel} must carry the deny-list`);
}

// ── 9. Curation guard ───────────────────────────────────────────────────────
// The internal skills are written for people with direct tenant and bucket
// access. A customer on the Reltio-managed path cannot act on any of it.
{
	const banned = [
		['SETUP-internal', 'internal setup doc reference'],
		['config-cache', 'internal tooling'],
		['workflow-orchestrator', 'internal skill cross-reference'],
		['@workflow-', 'internal skill handle'],
		['reltio-ai-ready-docs', 'internal companion docs'],
		['skill-improver', 'internal-only skill'],
		['aws s3', 'direct AWS action'],
		['AWS_ACCESS_KEY', 'credential material'],
		['aws configure', 'credential setup'],
	];
	const files = [];
	for (const folder of PLAYBOOKS) {
		const dir = path.join(repoRoot, 'skills/reltio-default', folder);
		const walk = d => {
			for (const e of fs.readdirSync(d, { withFileTypes: true })) {
				const full = path.join(d, e.name);
				if (e.isDirectory()) walk(full);
				else files.push(full);
			}
		};
		walk(dir);
	}
	assert.ok(files.length >= PLAYBOOKS.length, 'expected at least one file per playbook');
	for (const file of files) {
		const lower = fs.readFileSync(file, 'utf-8').toLowerCase();
		for (const [needle, why] of banned) {
			assert.ok(
				!lower.includes(needle.toLowerCase()),
				`${path.relative(repoRoot, file)} leaks internal-only content (${why}): "${needle}"`,
			);
		}
	}
}

// ── 10. The bundle is actually packaged ─────────────────────────────────────
{
	const ignore = read('.vscodeignore');
	assert.ok(
		ignore.split(/\r?\n/).some(l => l.trim() === '!skills/**'),
		'.vscodeignore must whitelist skills/** or none of this reaches the VSIX',
	);
}

// ── 11. workflow-repo-contents-and-agent-access: paths, coverage, next steps ─
{
	// The tenant folder rename (git-ready-tenant-folder-structure) and the Drafts move
	// (custom-workflow-repository) both invalidated paths written into these skills. An
	// agent following a stale path writes a file where nothing will ever find it.
	for (const folder of PLAYBOOKS) {
		const rel = `skills/reltio-default/${folder}/SKILL.md`;
		const text = read(rel);
		for (const [stale, why] of [
			['.reltio.environment', 'the retired environment-folder suffix'],
			['.reltio.tenant', 'the retired tenant-folder suffix'],
		]) {
			assert.ok(
				!text.includes(stale),
				`${rel} states a path using ${why} — the folder names are bare now`,
			);
		}
		assert.ok(
			!/\/workflows\/<processId>/.test(text),
			`${rel} points drafts at the lowercase workflows/ folder; they live in Workflows/BPMN/ now`,
		);
		// Stopping without naming the next action is the most common way these
		// playbooks fail a user: the step succeeded and the turn just ended.
		assert.ok(
			/next step/i.test(text.split('## Outputs')[1] ?? ''),
			`${rel} must state its next step in Outputs, including when that step is not an IDE action`,
		);
	}

	// Part 3 shipped five commands and no skill mentioned any of them.
	const contribution = read('skills/reltio-default/workflow-repo-contribution/SKILL.md');
	for (const command of [
		'reltio.connectWorkflowRepository',
		'reltio.openWorkflowRepoFolder',
		'reltio.refreshWorkflowRepoSync',
	]) {
		assert.ok(
			contribution.includes(command),
			`workflow-repo-contribution must name ${command}, or an agent has no way to know it exists`,
		);
	}
	assert.ok(
		/Java Classes/.test(contribution) && /Java Tests/.test(contribution),
		'workflow-repo-contribution must describe where the Java sources appear in the tree',
	);
	assert.ok(
		/review|registration/i.test(contribution.split('## When to use')[1].slice(0, 1200)),
		'workflow-repo-contribution must say up front that the IDE does not bypass Reltio\u2019s review',
	);

	// Skill edits do not reach an existing workspace unless this string changes:
	// reltioAgentSync.ts gates the sync on equality, not on file contents.
	const assets = JSON.parse(read('resources/reltio-agent-assets.json'));
	assert.strictEqual(
		assets.skillsBundleVersion, '19',
		'skillsBundleVersion must be bumped when skill content changes, or synced workspaces keep the old copy',
	);
}

// ── 12. Discovery lives inside the core skills, never outside .reltio/ ────────
// A real Cursor test synced .reltio/reltio-agent/ correctly and the agent still ignored every playbook.
// Pointer files in AGENTS.md / CLAUDE.md / .cursor/ are not allowed in a customer workspace, so the entry
// point is a core skill (`workflow-assistant`) the user invokes ("follow the Reltio workflow assistant").
{
	const sync = read('src/workspace/reltioAgentSync.ts');
	assert.ok(!sync.includes('writeAgentInstructions') && !sync.includes('writeDiscoveryPointers'),
		'sync must not write agent-instruction or pointer files outside .reltio/');
	assert.ok(!/writeFile\([^)]*(AGENTS|CLAUDE)/.test(sync) && !/createDirectory\([^)]*'\.cursor'/.test(sync),
		'sync must never create AGENTS.md, CLAUDE.md or anything under .cursor/');
	assert.ok(sync.includes('removeLegacyInstructionBlocks') && sync.includes('removeLegacyCursorPointers'),
		'sync must clean up what 1.0.24-1.0.26 wrote outside .reltio/');

	// the entry-point core skill
	const entry = read('skills/reltio-default/workflow-assistant/SKILL.md');
	assert.ok(/^name: reltio-workflow-assistant$/m.test(entry), 'workflow-assistant must be named reltio-workflow-assistant');
	for (const needle of ['Skills read:', 'workflow-bpmn-authoring', 'workflow-jar-customization',
		'workflow-repo-contribution', 'Deploy to Tenant', 'Shall I raise a PR for this?']) {
		assert.ok(entry.includes(needle), `workflow-assistant must carry: ${needle}`);
	}
	assert.ok(/next step/i.test(entry.split('## Outputs')[1] ?? ''), 'workflow-assistant Outputs must name the next step');

	// behaviour of the pure cleanup, via the compiled output
	const Module = require('module');
	const origLoad = Module._load;
	Module._load = function (req, ...rest) { return req === 'vscode' ? {} : origLoad.call(this, req, ...rest); };
	const { stripManagedBlock } = require(path.join(repoRoot, 'dist/workspace/reltioAgentSync.js'));
	Module._load = origLoad;
	const block = '<!-- reltio-ide:begin — managed -->\nbody\n<!-- reltio-ide:end -->';
	assert.strictEqual(stripManagedBlock(block + '\n'), undefined, 'a file holding only the block is deleted');
	const mixed = stripManagedBlock('# Mine\n\nkeep me\n\n' + block + '\n');
	assert.ok(mixed.includes('keep me') && !mixed.includes('reltio-ide'), 'user content survives, block is gone');
	assert.strictEqual(stripManagedBlock('# Mine\n'), '# Mine\n', 'a file without the block is left alone');
}

console.log('test-workflow-skills-library: OK');
