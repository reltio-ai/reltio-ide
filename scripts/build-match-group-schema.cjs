#!/usr/bin/env node
'use strict';
/**
 * Writes the match-group slice of `schemas/reltio-metadata.schema.json` next to the match-group
 * skill, so an agent in a user's workspace can check a rule against the schema. The full schema
 * ships inside the extension, which agents cannot read; the skill folder is copied into the
 * workspace.
 *
 * Run after changing any match-group definition in the schema:
 *   node scripts/build-match-group-schema.cjs
 * `test-match-rule-generation-skill.cjs` fails while the copy is stale.
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const SOURCE = path.join(repoRoot, 'schemas', 'reltio-metadata.schema.json');
const TARGET = path.join(repoRoot, 'skills', 'reltio-default', 'match-groups-from-concept', 'match-group.schema.json');

/** `MatchGroup` and every definition it reaches through `$ref`, in a stable order. */
function buildMatchGroupSchema(full) {
	const defs = full.$defs;
	const needed = new Set();
	const visit = name => {
		if (needed.has(name)) return;
		if (!defs[name]) throw new Error(`$defs/${name} is referenced but not defined`);
		needed.add(name);
		JSON.stringify(defs[name], (key, value) => {
			if (key === '$ref' && typeof value === 'string' && value.startsWith('#/$defs/')) visit(value.slice('#/$defs/'.length));
			return value;
		});
	};
	visit('MatchGroup');
	return {
		$schema: full.$schema,
		title: 'Reltio match group',
		description:
			'One entry of an entity type\'s matchGroups array. Generated from the Reltio IDE schema by scripts/build-match-group-schema.cjs; do not edit.',
		$ref: '#/$defs/MatchGroup',
		$defs: Object.fromEntries([...needed].sort().map(name => [name, defs[name]])),
	};
}

function render(full) {
	return `${JSON.stringify(buildMatchGroupSchema(full), null, 2)}\n`;
}

if (require.main === module) {
	fs.writeFileSync(TARGET, render(JSON.parse(fs.readFileSync(SOURCE, 'utf8'))));
	console.log(`wrote ${path.relative(repoRoot, TARGET)}`);
}

module.exports = { buildMatchGroupSchema, render, SOURCE, TARGET };
