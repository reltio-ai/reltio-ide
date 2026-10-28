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
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Pinned together: change the skills, bump skillsBundleVersion, update both values.
const PINNED_SKILLS_BUNDLE_VERSION = '26';
const PINNED_SKILLS_HASH = '5bd886e9fb68d2b2c45966d21e832cee79ab1c9fe5c3e399b9c828c512ff3e52';


const repoRoot = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(repoRoot, p), 'utf-8');

const PLAYBOOKS = [
	'workflow-bpmn-authoring',
	'workflow-jar-customization',
	'workflow-repo-contribution',
	'workflow-local-adapter-setup',
	'workflow-assistant',
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

	// Paths that exist in this repository but not in a customer's workspace. A skill that cites
	// `openspec/…`, `src/…` or `docs/…` sends the agent looking for files that were never shipped.
	// Java's own `src/main/java` and `src/test/java` are the Maven layout the skills teach, not ours.
	const allSkillFiles = [];
	const walkAll = d => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const full = path.join(d, e.name);
			if (e.isDirectory()) walkAll(full);
			else allSkillFiles.push(full);
		}
	};
	walkAll(path.join(repoRoot, 'skills/reltio-default'));
	assert.ok(allSkillFiles.length > PLAYBOOKS.length, 'expected the whole shipped skills tree');
	for (const file of allSkillFiles) {
		const rel = path.relative(repoRoot, file);
		const text = fs.readFileSync(file, 'utf-8');
		const internal = /(?<![\w./-])(openspec|docs|src)\//g;
		for (const match of text.matchAll(internal)) {
			const rest = text.slice(match.index, match.index + 20);
			if (match[1] === 'src' && /^src\/(main|test)\/java\b/.test(rest)) continue;
			assert.fail(`${rel} references a path that is not shipped: "${rest.split(/\s/)[0]}"`);
		}
		assert.ok(!/Normative product context/.test(text), `${rel} cites internal product context`);
		if (file.endsWith('.md')) {
			// A drive-letter path is one developer's machine; scripts (.bat) legitimately name install dirs.
			assert.ok(!/(?<![A-Za-z])[A-Za-z]:[\\/]/.test(text), `${rel} contains an absolute drive path`);
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
			`${rel} points drafts at the lowercase workflows/ folder; they live in Workflows/bpmn/ now`,
		);
		assert.ok(
			!/Workflows\/BPMN|Workflows\/Custom Workflows/.test(text),
			`${rel} names a retired Workflows path; drafts live in Workflows/bpmn/ and the repository is cloned into Workflows/`,
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

	for (const folder of ['workflow-assistant', 'workflow-jar-customization']) {
		const text = read(`skills/reltio-default/${folder}/SKILL.md`);
		assert.ok(
			text.includes('Java needs a connected repository') &&
				text.includes('Connect Custom Workflow Repository') &&
				/Do not offer to "write it anyway"/.test(text) &&
				/chat only and write no file/.test(text),
			`${folder} must tell the agent to ask the user to connect a repository, never offer to write Java anyway, and show Java in chat only if the user overrides unprompted`,
		);
	}

	// Skill edits do not reach an existing workspace unless this string changes:
	// reltioAgentSync.ts gates the sync on equality, not on file contents.
		const assets = JSON.parse(read('resources/reltio-agent-assets.json'));
	assert.strictEqual(
		assets.skillsBundleVersion, PINNED_SKILLS_BUNDLE_VERSION,
		'skillsBundleVersion changed: update PINNED_SKILLS_BUNDLE_VERSION and PINNED_SKILLS_HASH in this test together',
	);

	// The sync gate is a version string, never file contents, so an edited skill with an unchanged
	// version reaches nobody. Hash the whole shipped tree (path + LF-normalised text, sorted) and fail
	// when the content moved without the version.
	const hash = crypto.createHash('sha256');
	const hashDir = (dir, rel) => {
		for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
			const full = path.join(dir, e.name);
			const relPath = rel ? `${rel}/${e.name}` : e.name;
			if (e.isDirectory()) hashDir(full, relPath);
			else hash.update(relPath + '\0' + fs.readFileSync(full, 'utf-8').replace(/\r\n/g, '\n') + '\0');
		}
	};
	hashDir(path.join(repoRoot, 'skills/reltio-default'), '');
	const actualHash = hash.digest('hex');
	assert.strictEqual(
		actualHash, PINNED_SKILLS_HASH,
		'The content of skills/reltio-default/** changed. Bump skillsBundleVersion in resources/reltio-agent-assets.json ' +
		`(or workspaces keep the old copy), then update PINNED_SKILLS_BUNDLE_VERSION and PINNED_SKILLS_HASH here. ` +
		`Current hash: ${actualHash}`,
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

// ── 13. Skills agree with the product and with each other ─────────────────────
// Menu labels and command ids come from package.json; a skill that names a label the UI does not
// show sends the user hunting. Promises of embedded source must resolve.
{
	const pkg = JSON.parse(read('package.json'));
	const titles = pkg.contributes.commands.map(c => c.title);
	const ids = new Set(pkg.contributes.commands.map(c => c.command));
	const all = [];
	const walk13 = d => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const full = path.join(d, e.name);
			if (e.isDirectory()) walk13(full);
			else if (full.endsWith('.md')) all.push([path.relative(repoRoot, full), fs.readFileSync(full, 'utf-8')]);
		}
	};
	walk13(path.join(repoRoot, 'skills/reltio-default'));

	const cmdIds = new Set();
	for (const [rel, text] of all) {
		// `com.reltio.<pkg>.<Class>` Java package/class names (e.g. match comparator and token
		// classes) are not VS Code command ids; a lookbehind for the preceding "com." tells them
		// apart from a real `reltio.<commandId>` reference without needing to list every package.
		for (const m of text.matchAll(/(?<!com\.)reltio\.[A-Za-z0-9]+/g)) {
			if (/^reltio\.(com|json|tenant|environment|workflow|bpmnDiagnosticsSeverity|addEntityType|addRelationType|insert[A-Za-z]+)$/.test(m[0])) continue;
			cmdIds.add(m[0]);
		}
		assert.ok(!text.includes('Reveal in File Explorer'), `${rel} names a menu label that does not exist`);
		assert.ok(!/verify on a test tenant/i.test(text), `${rel} tells the user to verify on a test tenant, but local testing is not part of the path`);
	}
	for (const id of cmdIds) assert.ok(ids.has(id), `a skill names command ${id}, which package.json does not contribute`);
	for (const label of ['Open Repository Folder', 'Refresh JARs', 'Register JAR...', 'Deploy to Tenant', 'Show BPMN Diagram']) {
		assert.ok(titles.some(t => t === label), `package.json has no command titled "${label}"`);
	}
	assert.ok(titles.some(t => t.startsWith('Reltio: Resync agent assets')), 'the resync command title the assistant names must exist');

	// bpmn-rules points at java-patterns for two helper classes; they must actually be there.
	const javaPatterns = read('skills/reltio-default/workflow-jar-customization/references/java-patterns.md');
	for (const cls of ['UpdateDcrReviewerListener', 'CaptureRequestor']) {
		assert.ok(new RegExp('public class ' + cls + ' implements').test(javaPatterns), `java-patterns.md must embed the full source of ${cls}`);
	}

	// One owner for the reply: no playbook tells the agent to recite checks to the user.
	for (const folder of ['workflow-jar-customization', 'workflow-repo-contribution']) {
		const t = read(`skills/reltio-default/${folder}/SKILL.md`);
		assert.ok(!/item by item|each gate item evidenced|which gate items you can already show passing/.test(t),
			`${folder} must not tell the agent to recite gate results`);
		assert.ok(/only (when|if) (an item|something|a gate item)[^.]*fail/i.test(t), `${folder} must say gate results are reported only on failure`);
	}
	const rules = read('skills/reltio-default/workflow-bpmn-authoring/references/bpmn-rules.md');
	assert.ok(!/say so\*\* \(/.test(rules) && !/self-checked all 12/.test(rules), 'the validation walk is silent everywhere');
}

console.log('test-workflow-skills-library: OK');
