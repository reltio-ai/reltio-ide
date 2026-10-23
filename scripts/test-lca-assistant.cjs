#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: lca-assistant (RP-191824)
 * Tier A scenarios:
 *  - Bundled KB = 7 indexed docs (KB-LCA-00..06) + manifest/README/PROVENANCE
 *  - Manifest routing metadata + section line ranges
 *  - No archive / legacy non-indexed material
 *  - Skill + contributor stub + partner invoke guidance
 *  - Sync: version advance / missing dest / force; skip when unchanged
 *  - skills/workspace/** never touched; packaging whitelist
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { repoRoot } = require('./lib/load-sample.cjs');

const INDEXED_DOCS = [
	'00_INDEX_RAG_RETRIEVAL_MAP.md',
	'01_LCA_CORE_CONCEPTS_AND_HOOKS.md',
	'02_LCA_IMPLEMENTATION_HANDBOOK.md',
	'03_DVF_AND_LCA_VS_DVF_DECISION_GUIDE.md',
	'04_OPS_SECURITY_CONNECTIVITY_DEPLOYMENT.md',
	'05_EXTERNAL_DOCS_AND_INGESTION_APIS.md',
	'06_MAVEN_PROJECT_TEMPLATES.md',
];

const EXPECTED_ROUTING_INTENTS = [
	/What is an LCA|hooks|architecture/i,
	/Write\/test LCA|SDK|cookbook/i,
	/Scaffold Maven|POM|assembly/i,
	/LCA vs DVF|DVF expression/i,
	/Pre-ingestion|exception queue|ingestion API/i,
	/LCA not working|NPE|recursion|timeout/i,
	/Security|secrets|PII|Managed Identity/i,
	/Cloud connectivity|IAM|Entra|OAuth/i,
	/Deployment|runtime|cold start|CI-CD/i,
	/Official Reltio doc|LCA Service API|disable-deregister/i,
	/Which source is right|guidance conflicts/i,
];

function copyDir(src, dest) {
	fs.mkdirSync(dest, { recursive: true });
	for (const name of fs.readdirSync(src)) {
		const from = path.join(src, name);
		const to = path.join(dest, name);
		if (fs.statSync(from).isDirectory()) {
			copyDir(from, to);
		} else {
			fs.copyFileSync(from, to);
		}
	}
}

function readText(p) {
	return fs.readFileSync(p, 'utf8');
}

function mtimeMs(p) {
	return fs.statSync(p).mtimeMs;
}

/** Mirror syncReltioAgentAssets needLcaKb decision (force / missing / version differ). */
function needLcaKbSync(bundledVer, stampVer, destExists, force) {
	if (force) return true;
	if (!destExists) return true;
	return (stampVer ?? '') !== bundledVer;
}

// ---------------------------------------------------------------------------
// Scenario: assets declare independent LCA KB version
// ---------------------------------------------------------------------------
const assetsPath = path.join(repoRoot, 'resources', 'reltio-agent-assets.json');
const assets = JSON.parse(readText(assetsPath));
assert.ok(assets.skillsBundleVersion, 'skillsBundleVersion');
assert.ok(assets.velocityPacksBundleVersion, 'velocityPacksBundleVersion');
assert.ok(assets.lcaKnowledgeBaseBundleVersion, 'lcaKnowledgeBaseBundleVersion');
assert.ok(
	Object.prototype.hasOwnProperty.call(assets, 'skillsBundleVersion') &&
		Object.prototype.hasOwnProperty.call(assets, 'velocityPacksBundleVersion') &&
		Object.prototype.hasOwnProperty.call(assets, 'lcaKnowledgeBaseBundleVersion'),
	'skills, packs, and LCA KB versions are independently declared fields',
);

const kbRoot = path.join(repoRoot, 'resources', 'lca-knowledge-base');
const requiredKb = [
	'manifest.json',
	'README.md',
	'PROVENANCE.md',
	...INDEXED_DOCS,
];

// ---------------------------------------------------------------------------
// Scenario: Packaged tree contains exactly the seven indexed docs (+ meta)
// ---------------------------------------------------------------------------
for (const f of requiredKb) {
	assert.ok(fs.existsSync(path.join(kbRoot, f)), `missing KB file ${f}`);
}

const kbEntries = fs.readdirSync(kbRoot);
assert.ok(!kbEntries.includes('archive'), 'SHALL NOT include archive/');
assert.ok(!kbEntries.includes('.refactor-backup'), 'SHALL NOT include .refactor-backup/');
for (const legacy of [
	'02_LCA_CODE_PATTERNS_AND_COOKBOOK.md',
	'03_LCA_BUSINESS_USE_CASES.md',
	'05_BEST_PRACTICES_TROUBLESHOOTING_SECURITY_DEPLOYMENT.md',
	'06_RELTIO_DOC_PORTAL_REFERENCE.md',
	'07_RELTIO_DATA_INGESTION_API_REFERENCE.md',
]) {
	assert.ok(!kbEntries.includes(legacy), `legacy non-indexed file must not ship: ${legacy}`);
}

const mdFiles = kbEntries.filter((n) => n.endsWith('.md'));
const allowedMd = new Set([...INDEXED_DOCS, 'README.md', 'PROVENANCE.md']);
for (const md of mdFiles) {
	assert.ok(allowedMd.has(md), `unexpected markdown in KB bundle: ${md}`);
}

// ---------------------------------------------------------------------------
// Scenario: Provenance is recorded
// ---------------------------------------------------------------------------
const provenance = readText(path.join(kbRoot, 'PROVENANCE.md'));
assert.match(provenance, /life-cycle-framework-lambda/, 'provenance upstream path');
assert.match(provenance, /5\.0/, 'provenance manifest version');
assert.match(provenance, /2026-07-27/, 'provenance generated/copy date');
assert.match(provenance, /RP-191824/, 'provenance Jira / sign-off pointer');
assert.match(provenance, /lcaKnowledgeBaseBundleVersion/, 'provenance refresh bump reminder');

const readme = readText(path.join(kbRoot, 'README.md'));
assert.match(readme, /7 retrieval-optimized docs|KB-LCA-00.*KB-LCA-06/s, 'README describes 7-doc shape');
assert.match(readme, /PROVENANCE\.md/, 'README points at provenance');

// ---------------------------------------------------------------------------
// Scenario: Manifest routing metadata (documents, topics, section ranges)
// ---------------------------------------------------------------------------
const manifest = JSON.parse(readText(path.join(kbRoot, 'manifest.json')));
assert.strictEqual(manifest.version, '5.0', 'KB manifest version');
assert.ok(manifest.generated, 'manifest.generated');
assert.ok(Array.isArray(manifest.retrieval_routing), 'retrieval_routing array');
assert.ok(manifest.retrieval_routing.length >= EXPECTED_ROUTING_INTENTS.length, 'routing intents present');

for (const pattern of EXPECTED_ROUTING_INTENTS) {
	const hit = manifest.retrieval_routing.some((r) => pattern.test(String(r.intent ?? '')));
	assert.ok(hit, `retrieval_routing missing intent matching ${pattern}`);
}

const indexed = manifest.documents.filter((d) => d.index);
assert.strictEqual(indexed.length, 7, 'seven indexed docs');
assert.strictEqual(manifest.documents.length, 7, 'exactly seven documents in manifest');

const expectedDocIds = INDEXED_DOCS.map((_, i) => `KB-LCA-0${i}`);
for (let i = 0; i < indexed.length; i++) {
	const doc = indexed[i];
	assert.strictEqual(doc.doc_id, expectedDocIds[i], `doc_id order ${expectedDocIds[i]}`);
	assert.strictEqual(doc.path, INDEXED_DOCS[i], `path for ${expectedDocIds[i]}`);
	assert.ok(fs.existsSync(path.join(kbRoot, doc.path)), `document path exists: ${doc.path}`);
	assert.ok(Array.isArray(doc.topics) && doc.topics.length > 0, `topics for ${doc.doc_id}`);
	assert.ok(Array.isArray(doc.sections) && doc.sections.length > 0, `sections for ${doc.doc_id}`);

	const fileLines = readText(path.join(kbRoot, doc.path)).split(/\n/);
	const lineCount = fileLines.length;
	let prevEnd = 0;
	for (const section of doc.sections) {
		assert.ok(section.title, `section title in ${doc.doc_id}`);
		assert.ok(
			Number.isInteger(section.line_start) && Number.isInteger(section.line_end),
			`integer line ranges in ${doc.doc_id} / ${section.title}`,
		);
		assert.ok(section.line_start >= 1, `line_start >= 1 (${doc.doc_id} ${section.title})`);
		assert.ok(
			section.line_end <= lineCount,
			`line_end within file (${doc.doc_id} ${section.title}: ${section.line_end} > ${lineCount})`,
		);
		assert.ok(
			section.line_start <= section.line_end,
			`line_start <= line_end (${doc.doc_id} ${section.title})`,
		);
		assert.ok(
			section.line_start >= prevEnd,
			`sections non-overlapping / ordered (${doc.doc_id} ${section.title})`,
		);
		prevEnd = section.line_end;
		// Heading may sit a few lines before line_start (manifest ranges are 1-indexed inclusive)
		const from = Math.max(0, section.line_start - 4);
		const to = Math.min(fileLines.length, section.line_start + 3);
		const window = fileLines.slice(from, to).join('\n');
		assert.match(
			window,
			/^#{1,3}\s+\S/m,
			`section ${doc.doc_id} "${section.title}" line_start≈heading (got near L${section.line_start})`,
		);
	}
}

// Index file inventory must name all seven docs
const indexMd = readText(path.join(kbRoot, '00_INDEX_RAG_RETRIEVAL_MAP.md'));
for (const id of expectedDocIds) {
	assert.ok(indexMd.includes(id), `00_INDEX inventories ${id}`);
}
assert.match(indexMd, /exactly \*\*7 retrievable docs\*\*/, '00_INDEX states 7-doc inventory');

// Routing docs referenced by intents must be known document ids
const knownIds = new Set(expectedDocIds);
for (const route of manifest.retrieval_routing) {
	assert.ok(Array.isArray(route.docs) && route.docs.length > 0, `route docs for ${route.intent}`);
	for (const id of route.docs) {
		assert.ok(knownIds.has(id), `routing references unknown doc ${id}`);
	}
}

// ---------------------------------------------------------------------------
// Scenario: Contributor locates playbook + thin Cursor stub
// ---------------------------------------------------------------------------
const skillMd = path.join(repoRoot, 'skills', 'reltio-default', 'lca-assistant', 'SKILL.md');
assert.ok(fs.existsSync(skillMd), 'lca-assistant SKILL.md');
const skillBody = readText(skillMd);

const stubMd = path.join(repoRoot, '.cursor', 'skills', 'reltio-lca-assistant', 'SKILL.md');
assert.ok(fs.existsSync(stubMd), 'contributor Cursor stub');
const stubBody = readText(stubMd);
assert.match(stubBody, /skills\/reltio-default\/lca-assistant\/SKILL\.md/, 'stub points at canonical');
assert.match(stubBody, /\.reltio\/reltio-agent\/lca-knowledge-base\//, 'stub points at materialized KB');
assert.ok(stubBody.length < skillBody.length, 'stub is thinner than canonical playbook');

// ---------------------------------------------------------------------------
// Scenario: Partner invoke (no .cursor stub assumption) + ≥2 sample prompts
// ---------------------------------------------------------------------------
assert.match(
	skillBody,
	/\.reltio\/reltio-agent\/skills\/default\/lca-assistant\/SKILL\.md/,
	'skill documents materialized skill path',
);
assert.match(
	skillBody,
	/\.reltio\/reltio-agent\/lca-knowledge-base\//,
	'skill documents materialized KB path',
);
assert.match(skillBody, /Partner invoke/i, 'skill has partner invoke section');
assert.ok(!/assume.*\.cursor\/skills/i.test(skillBody), 'skill must not assume partner .cursor stub');

const samplePromptMatches = skillBody.match(/^\d+\.\s+.+$/gm) || [];
assert.ok(samplePromptMatches.length >= 2, 'at least two sample prompts');

// ---------------------------------------------------------------------------
// Scenario: Skill retrieval discipline + dual-workspace + opt-in Maven
// ---------------------------------------------------------------------------
assert.match(skillBody, /manifest\.json|00_INDEX/, 'skill routes via KB index');
assert.match(skillBody, /minimum|Retrieve the \*\*minimum\*\*/i, 'skill requires minimum doc set');
assert.match(skillBody, /Dual-workspace|L3-first|Java\/Maven only/i, 'dual-workspace branching');
assert.match(skillBody, /never invent|real attribute URIs|attribute URIs/i, 'no invented L3 names');
assert.match(skillBody, /lifecycleActions/, 'L3 lifecycleActions wiring documented for the user');
assert.match(
	skillBody,
	/Do not write `lifecycleActions`|Do not patch L3|Never add, merge, or edit a `lifecycleActions`/i,
	'skill forbids patching L3 lifecycleActions',
);
assert.match(skillBody, /further steps|Further-steps/i, 'documents further steps instead of applying L3');
assert.match(skillBody, /Tenant L3 gate/i, 'tenant L3 gate section');
assert.match(
	skillBody,
	/not connected|No tenant added|ask the user to connect/i,
	'skill asks to connect when plugin has no tenant',
);
assert.match(skillBody, /reltio\.launchSetupWizard|Setup Wizard/i, 'setup wizard when disconnected');
assert.match(skillBody, /reltio\.addTenant|Add Tenant/i, 'add tenant command');
assert.match(skillBody, /reltio\.fetchL3|Get Configuration/i, 'fetch L3 when tenant has no config');
assert.match(skillBody, /Resolve named L3 objects/i, 'resolve names against L3');
assert.match(skillBody, /HCP|HCO/, 'documents HCP/HCO as entity-type examples');
assert.match(skillBody, /HasAddress/, 'documents HasAddress as relation-type example');
assert.match(
	skillBody,
	/confirm the actual name|ask the user to confirm/i,
	'asks user to confirm missing L3 names',
);
assert.match(
	skillBody,
	/list available|available \*\*uri \+ label\*\*|show available/i,
	'shows available L3 options when a name is missing',
);
assert.match(skillBody, /cap \*\*25\*\*|Cap at \*\*25\*\*|cap at 25/i, 'caps long L3 option lists');
assert.match(skillBody, /Exact match only|exact match/i, 'requires exact L3 name match');
assert.match(
	skillBody,
	/Hard stop|wait for confirmation|confirm the actual name/i,
	'waits for user confirmation before generating LCA',
);
assert.match(skillBody, /CourseTopics/, 'documents CourseTopics vs Course near-miss');
assert.match(
	skillBody,
	/Do \*\*not\*\* generate LCA|entire reply\*\* is the clarification/i,
	'no LCA code in the clarification turn',
);
assert.ok(
	/Forbidden[\s\S]*I’ll use|Forbidden[\s\S]*I'll use|Auto-selecting a similar type/i.test(skillBody),
	'forbids auto-selecting a similar type',
);
assert.match(skillBody, /Code-generation confirmation/i, 'code-generation confirmation section');
assert.match(
	skillBody,
	/Attributes to read|attributes to \*\*read\*\*/i,
	'confirms attributes the LCA will read',
);
assert.match(
	skillBody,
	/Attributes to add\/update|add\/update/i,
	'confirms attributes the LCA will add or update',
);
assert.match(
	skillBody,
	/only after an explicit yes|only after.*confirmation/i,
	'writes code only after explicit confirmation',
);
assert.match(
	skillBody,
	/Conceptual answers|skip this step/i,
	'code-generation confirmation is not required for advice-only questions',
);
assert.match(skillBody, /opt-in|explicitly asks/i, 'Maven scaffold is opt-in');
assert.match(skillBody, /confirm.*folder|Confirm target folder/i, 'confirm scaffold folder');
assert.match(skillBody, /repo-dev\.reltio\.com|Maven repos/i, 'compile credentials caveat');
assert.match(skillBody, /secrets|tokens|PII/i, 'no secrets guidance');
assert.match(skillBody, /KB-LCA-##|internal KB/i, 'avoid exposing internal KB ids');

const indexAnswering = indexMd.slice(indexMd.indexOf('## Answering Pattern'));
assert.match(
	indexAnswering,
	/not connected to any tenant|ask the user to connect/i,
	'KB answering pattern asks to connect when no tenant',
);
assert.match(
	indexAnswering,
	/Resolve names against L3|confirm the actual name/i,
	'KB answering pattern resolves missing names against L3',
);
assert.match(
	indexAnswering,
	/HCP|HCO|HasAddress/i,
	'KB answering pattern names entity/relation examples to cross-check',
);
assert.match(
	indexAnswering,
	/CourseTopics|near-miss|silently use/i,
	'KB answering pattern forbids silent near-miss substitution',
);
assert.match(
	indexAnswering,
	/Code-generation confirmation|attributes to \*\*read\*\*/i,
	'KB answering pattern requires type/attribute confirmation before code',
);
assert.match(
	indexAnswering,
	/Do \*\*not\*\* patch tenant L3|do \*\*not\*\* write a `lifecycleActions`/i,
	'KB answering pattern forbids writing lifecycleActions into L3',
);
assert.match(indexAnswering, /further steps/i, 'KB answering pattern documents further steps');

// Demo script exists for Tier C (not a runtime gate)
const designDoc = path.join(repoRoot, 'openspec', 'changes', 'lca-assistant', 'design.md');
assert.ok(fs.existsSync(designDoc), 'normative design.md cited by the skill');
assert.match(readText(designDoc), /### D2 —/, 'design D2');
assert.match(readText(designDoc), /### D5 —/, 'design D5');
assert.match(readText(designDoc), /### D6 —/, 'design D6');
const demoScript = path.join(repoRoot, 'openspec', 'changes', 'lca-assistant', 'demo-script.md');
assert.ok(fs.existsSync(demoScript), 'Tier C demo-script.md');
const demoBody = readText(demoScript);
assert.match(demoBody, /beforeSave/, 'demo prompt 1');
assert.match(demoBody, /lifecycleActions/, 'demo prompt 2');
assert.match(demoBody, /Scaffold a Maven|Maven LCA/i, 'demo prompt 3');
assert.match(demoBody, /mvn package.*not a gate/i, 'mvn package is not a gate');
assert.match(demoBody, /Tenant gate|no tenant connected/i, 'demo prompt 1b tenant gate');
assert.match(demoBody, /Unknown type|near-miss type|CourseTopics|DoesNotExist/i, 'demo prompt 1c unknown type');
assert.match(demoBody, /confirm the actual name/i, 'demo 1c waits for confirmation');
assert.match(demoBody, /lists available entity types|list available entity types/i, 'demo 1c lists L3 types');
assert.match(demoBody, /connected tenant/i, 'demo prompt 2 uses connected tenant L3');
assert.match(
	demoBody,
	/code-generation confirmation|attributes the LCA will \*\*read\*\*/i,
	'demo prompt 2 confirms type and attributes before code',
);
assert.match(demoBody, /Do not edit L3 until deploy succeeds|apply `lifecycleActions` after a successful deploy/i, 'demo prompt 2 applies L3 only after deploy');

// ---------------------------------------------------------------------------
// Scenario: Resync command mentions LCA KB; VSIX whitelist includes resources/skills
// ---------------------------------------------------------------------------
const pkg = JSON.parse(readText(path.join(repoRoot, 'package.json')));
const resync = (pkg.contributes?.commands || []).find((c) => c.command === 'reltio.resyncAgentAssets');
assert.ok(resync, 'reltio.resyncAgentAssets command');
assert.match(
	String(resync.title),
	/LCA|knowledge base/i,
	'Resync command title mentions LCA knowledge base',
);

const vscodeignore = readText(path.join(repoRoot, '.vscodeignore'));
assert.ok(vscodeignore.includes('!resources/**'), 'VSIX whitelists resources (KB)');
assert.ok(vscodeignore.includes('!skills/**'), 'VSIX whitelists skills (lca-assistant)');

// ---------------------------------------------------------------------------
// Sync simulations (Tier A)
// ---------------------------------------------------------------------------
const bundledVer = assets.lcaKnowledgeBaseBundleVersion;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lca-assistant-sync-'));
const workspaceSkills = path.join(tmp, 'skills', 'workspace', 'lca-assistant');
fs.mkdirSync(workspaceSkills, { recursive: true });
const overrideMarker = path.join(workspaceSkills, 'SKILL.md');
fs.writeFileSync(overrideMarker, '# workspace override — must survive\n');

const destKb = path.join(tmp, '.reltio', 'reltio-agent', 'lca-knowledge-base');
const stampPath = path.join(tmp, '.reltio', 'reltio-agent', '.sync-state.json');
fs.mkdirSync(path.dirname(stampPath), { recursive: true });

function writeStamp(partial) {
	fs.writeFileSync(stampPath, JSON.stringify(partial, null, 2));
}

function readStamp() {
	return JSON.parse(readText(stampPath));
}

function syncLcaKbIfNeeded(force) {
	const stamp = fs.existsSync(stampPath) ? readStamp() : {};
	const destExists = fs.existsSync(destKb);
	if (!needLcaKbSync(bundledVer, stamp.lcaKnowledgeBaseBundleVersion, destExists, force)) {
		return false;
	}
	fs.rmSync(destKb, { recursive: true, force: true });
	copyDir(kbRoot, destKb);
	writeStamp({ ...stamp, lcaKnowledgeBaseBundleVersion: bundledVer });
	return true;
}

function assertOverrideUntouched() {
	assert.strictEqual(
		readText(overrideMarker),
		'# workspace override — must survive\n',
		'skills/workspace must be untouched',
	);
}

// Scenario: Fresh workspace / version advance materializes KB
writeStamp({ lcaKnowledgeBaseBundleVersion: '0' });
assert.ok(
	needLcaKbSync(bundledVer, '0', false, false),
	'version advance or missing dest should need sync',
);
assert.strictEqual(syncLcaKbIfNeeded(false), true, 'sync on version advance');
assert.ok(fs.existsSync(path.join(destKb, 'manifest.json')), 'synced KB manifest');
assert.ok(fs.existsSync(path.join(destKb, '00_INDEX_RAG_RETRIEVAL_MAP.md')), 'synced KB index');
assert.ok(fs.existsSync(path.join(destKb, '06_MAVEN_PROJECT_TEMPLATES.md')), 'synced KB-06');
assert.strictEqual(readStamp().lcaKnowledgeBaseBundleVersion, bundledVer, 'stamp updated');
assertOverrideUntouched();

const afterAdvanceMtime = mtimeMs(path.join(destKb, 'manifest.json'));

// Scenario: Unchanged version skips unnecessary copy
assert.strictEqual(
	needLcaKbSync(bundledVer, bundledVer, true, false),
	false,
	'matching version + existing dest → no copy',
);
assert.strictEqual(syncLcaKbIfNeeded(false), false, 'skip sync when unchanged');
assert.strictEqual(
	mtimeMs(path.join(destKb, 'manifest.json')),
	afterAdvanceMtime,
	'manifest mtime unchanged when sync skipped',
);
assertOverrideUntouched();

// Scenario: Missing destination triggers copy even if stamp matches
fs.rmSync(destKb, { recursive: true, force: true });
assert.ok(
	needLcaKbSync(bundledVer, bundledVer, false, false),
	'missing dest needs sync even when stamp matches',
);
assert.strictEqual(syncLcaKbIfNeeded(false), true, 'sync when destination absent');
assert.ok(fs.existsSync(path.join(destKb, 'manifest.json')), 'KB restored after missing dest');
assertOverrideUntouched();

const beforeForceMtime = mtimeMs(path.join(destKb, 'manifest.json'));
// Ensure mtime can change on force (brief delay on some FS)
const marker = path.join(destKb, '.force-marker');
fs.writeFileSync(marker, 'stale');

// Scenario: Force Resync refreshes KB without touching workspace overrides
assert.ok(needLcaKbSync(bundledVer, bundledVer, true, true), 'force always needs sync');
assert.strictEqual(syncLcaKbIfNeeded(true), true, 'force resync copies');
assert.ok(!fs.existsSync(marker), 'force replace drops prior dest contents');
assert.ok(fs.existsSync(path.join(destKb, '02_LCA_IMPLEMENTATION_HANDBOOK.md')), 'force restored handbook');
assert.ok(mtimeMs(path.join(destKb, 'manifest.json')) >= beforeForceMtime, 'force refreshed files');
assertOverrideUntouched();

// Scenario: Independent versioning — skills stamp alone does not imply KB sync
writeStamp({
	skillsBundleVersion: assets.skillsBundleVersion,
	velocityPacksBundleVersion: assets.velocityPacksBundleVersion,
	lcaKnowledgeBaseBundleVersion: bundledVer,
});
assert.strictEqual(
	needLcaKbSync(bundledVer, bundledVer, true, false),
	false,
	'skills/packs stamp fields do not force LCA KB copy',
);

fs.rmSync(tmp, { recursive: true, force: true });

console.log('test-lca-assistant: OK');
