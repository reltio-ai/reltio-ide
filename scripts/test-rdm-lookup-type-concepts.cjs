#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: rdm-lookup-type-concepts
 *
 * Tier B — structural. The skill is content, not code, so these guard what an
 * agent would get wrong or what would silently drift:
 *
 *   1. Frontmatter agents accept, a description carrying the request it answers,
 *      and the house sections.
 *   2. The entry the skill writes is exactly what Add a new Lookup Type inserts
 *      (`buildRdmLookupTypeObject`), and it validates against the RDM schema.
 *   3. Existing lookup types are checked under any spelling before writing.
 *   4. Pushing stays with the user: Apply RDM Configuration, never the agent.
 *   5. Every IDE command it names exists, and the skills it hands off to exist.
 *   6. The contributor pointer names the canonical file; the bundle version is raised.
 *
 * Tier C (manual): see tasks.md.
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const { importDist } = require('./lib/import-dist.cjs');

const repoRoot = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(repoRoot, p), 'utf8').replace(/\r\n/g, '\n');
const { buildRdmLookupTypeObject } = importDist('rdm/rdmSkeletons');

const rel = 'skills/reltio-default/rdm-lookup-type-concepts/SKILL.md';
const skill = read(rel);
const frontmatterOf = text => {
	const front = text.split('---')[1];
	return { name: /^name: (.+)$/m.exec(front)?.[1], description: /^description: (.+)$/m.exec(front)?.[1] };
};

// 1. Frontmatter and sections.
{
	const { name, description } = frontmatterOf(skill);
	assert.strictEqual(name, 'reltio-rdm-lookup-type-concepts');
	assert.ok(description && description.length <= 1024, 'agents reject a description over 1024 characters');
	assert.ok(description.includes('Add lookup type OrganizationStatuses'), 'the description carries the request it answers, so agents pick the skill');
	assert.deepStrictEqual(
		skill.split(/\r?\n/).filter(l => l.startsWith('## ')).map(l => l.slice(3)),
		['When to use', 'Inputs', 'Procedure', 'Outputs'],
		'house sections',
	);
}

// 2. The entry it writes is the IDE's own, and the RDM schema accepts it.
{
	const blocks = [...skill.matchAll(/```json\n([\s\S]*?)```/g)].map(m => JSON.parse(m[1]));
	assert.strictEqual(blocks.length, 1, 'one entry shape, so there is nothing to choose between');
	assert.deepStrictEqual(blocks[0], buildRdmLookupTypeObject('OrganizationStatuses'), 'the skill writes exactly what Add a new Lookup Type writes');

	const validate = new Ajv({ allErrors: true, strict: false }).compile(JSON.parse(read('schemas/reltio-rdm.schema.json')));
	assert.ok(validate({ tenantId: 'RdmT', lookupTypes: [blocks[0]] }), JSON.stringify(validate.errors));

	assert.ok(/letters and digits only, starting with a letter/.test(skill), 'the naming rule a URI segment needs is stated');
	assert.ok(/change nothing else/.test(skill), 'the rest of the file is left alone');
}

// 3. No second spelling of a lookup type that exists.
assert.ok(/ignoring case/.test(skill) && /\*\*Same URI\*\*/.test(skill), 'existing lookup types are compared by URI and label, ignoring case');
assert.ok(/ask before adding anything/.test(skill), 'a near match waits for the user');

// 4. Pushing is the user's, through the IDE.
assert.ok(
	/Never apply the configuration yourself, never call the RDM API, and never ask for, read or pass on a token/.test(skill),
	'the agent never pushes and never touches the session',
);

// 5. What it names exists.
{
	const pkg = JSON.parse(read('package.json'));
	const titles = new Map(pkg.contributes.commands.map(c => [c.title, c.command]));
	for (const title of ['Add a new Lookup Type', 'Add a new Source', 'Apply RDM Configuration', 'Get Configuration', 'Get Lookup Values']) {
		assert.ok(skill.includes(`**${title}**`), `the skill names ${title}`);
		assert.ok(titles.has(title), `package.json has no command titled "${title}"`);
	}
	// "Right-click the RDM tenant row" must be where Apply RDM Configuration is offered.
	const applyMenus = Object.values(pkg.contributes.menus).flat().filter(m => m.command === 'reltio.applyRdmConfiguration');
	assert.ok(applyMenus.some(m => /viewItem == reltio\.rdm\.root/.test(m.when)), 'Apply RDM Configuration is on the RDM tenant row');

	for (const [handoff, folder] of [
		['reltio-rdm-lookup-values-from-csv', 'rdm-lookup-values-from-csv'],
		['reltio-attributes-from-concept', 'attributes-from-concept'],
	]) {
		assert.ok(skill.includes(`\`${handoff}\``), `the skill hands off to ${handoff}`);
		assert.strictEqual(frontmatterOf(read(`skills/reltio-default/${folder}/SKILL.md`)).name, handoff, `${handoff} exists`);
	}
	assert.ok(read('schemas/reltio-metadata.schema.json').includes('"lookupCode"'), 'lookupCode is an L3 attribute property');
}

// 6. Pointer and bundle.
{
	const pointer = read('.cursor/skills/reltio-rdm-lookup-type-concepts/SKILL.md');
	assert.ok(pointer.includes(rel));
	assert.ok(pointer.includes('.reltio/reltio-agent/skills/default/rdm-lookup-type-concepts/SKILL.md'));
	const assets = JSON.parse(read('resources/reltio-agent-assets.json'));
	assert.ok(Number(assets.skillsBundleVersion) >= 30, 'the bundle version is raised so workspaces receive the skill');
}

console.log('test-rdm-lookup-type-concepts: OK');
