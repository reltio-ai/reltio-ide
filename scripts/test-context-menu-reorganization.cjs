#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: context-menu-reorganization
 * Tier B: package.json contributes.commands titles + contributes.menus group ordering
 * Tier C (manual): right-click a tenant with a fetched L3, confirm the 4-section layout
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { repoRoot } = require('./lib/load-sample.cjs');

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

const titleByCommand = new Map(pkg.contributes.commands.map(c => [c.command, c.title]));

// Renamed titles
assert.strictEqual(titleByCommand.get('reltio.fetchL3'), 'Get Configuration');
assert.strictEqual(titleByCommand.get('reltio.fetchConfigurationHistory'), 'View Configuration History');
assert.strictEqual(titleByCommand.get('reltio.applyL3Configuration'), 'Apply Configuration to Tenant');

// "Insert X" -> "Add a new X" convention, everywhere it applies
const addANewCommands = [
	'reltio.addEntityType',
	'reltio.addRelationType',
	'reltio.insertSimpleAttribute',
	'reltio.insertNestedAttribute',
	'reltio.insertReferenceAttribute',
	'reltio.insertMatchGroup',
	'reltio.insertSurvivorshipGroup',
	'reltio.insertCleanseConfig',
	'reltio.insertGroupingType',
	'reltio.insertGraphType',
	'reltio.insertHierarchyType',
	'reltio.insertInteractionType',
	'reltio.insertSource',
];
for (const command of addANewCommands) {
	const title = titleByCommand.get(command);
	assert.ok(title, `missing title for ${command}`);
	assert.ok(title.startsWith('Add a new '), `${command} title "${title}" should start with "Add a new "`);
}
assert.strictEqual(titleByCommand.get('reltio.addRelationType'), 'Add a new Relationship Type');

// Tenant-node menu entries sort into the expected 5-bucket order.
// `when` clauses reference the tenant node either literally ("reltio.tenant.l3")
// or via a regex whose escaped dot is a literal backslash in the JSON string
// (`/^reltio\.tenant/`) — match both forms.
const tenantNodePattern = /reltio\\?\.tenant/;
const tenantMenuEntries = pkg.contributes.menus['view/item/context'].filter(
	e => typeof e.when === 'string' && tenantNodePattern.test(e.when),
);
const groupPrefix = g => g.split('@')[0];
const bucketOrder = [...new Set(tenantMenuEntries.map(e => groupPrefix(e.group)))];
assert.ok(bucketOrder.includes('3_getconfig'));
assert.ok(bucketOrder.includes('4_apply'));
assert.ok(bucketOrder.includes('5_insert'));
assert.ok(bucketOrder.includes('8_tenantid'));
assert.ok(bucketOrder.includes('9_delete'));
assert.ok(
	'3_getconfig' < '4_apply' && '4_apply' < '5_insert' && '5_insert' < '8_tenantid' && '8_tenantid' < '9_delete',
	'expected section order: getconfig < apply < insert < tenantid < delete',
);

// Add-a-new-Type order within the tenant node's insert section
const insertCommandsInOrder = tenantMenuEntries
	.filter(e => groupPrefix(e.group) === '5_insert')
	.sort((a, b) => Number(a.group.split('@')[1]) - Number(b.group.split('@')[1]))
	.map(e => e.command);
assert.deepStrictEqual(insertCommandsInOrder, [
	'reltio.addEntityType',
	'reltio.addRelationType',
	'reltio.insertInteractionType',
	'reltio.insertHierarchyType',
	'reltio.insertGraphType',
	'reltio.insertGroupingType',
	'reltio.insertSource',
]);

console.log('test-context-menu-reorganization: OK');
