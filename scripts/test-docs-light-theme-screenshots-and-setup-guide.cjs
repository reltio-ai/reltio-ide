#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: docs-light-theme-screenshots-and-setup-guide
 * Tier B: README image paths exist; Setup Guide / Walkthrough include Git;
 *         customer docs quote live package.json command titles.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { repoRoot } = require('./lib/load-sample.cjs');

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const titleByCommand = new Map(pkg.contributes.commands.map(c => [c.command, c.title]));

const requiredTitles = {
	'reltio.fetchConfigFromGit': 'Reltio: Connect your Repository',
	'reltio.addFileAsTenant': 'Add Config',
	'reltio.removeGitTenant': 'Remove Config',
	'reltio.removeGitSource': 'Remove Repository',
	'reltio.fetchL3': 'Get Configuration',
	'reltio.applyL3Configuration': 'Apply Configuration to Tenant',
	'reltio.fetchConfigurationHistory': 'View Configuration History',
	'reltio.fetchMoreConfigurationHistory': 'Fetch More Configuration History',
	'reltio.historyCompareWithCurrent': 'Compare with Current L3',
	'reltio.openSetupGuide': 'Reltio: Open Setup Guide',
};

for (const [command, title] of Object.entries(requiredTitles)) {
	assert.strictEqual(
		titleByCommand.get(command),
		title,
		`${command} title drifted — update docs and this test together`,
	);
}

const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
const quickstart = fs.readFileSync(path.join(repoRoot, 'QUICKSTART.md'), 'utf8');
const setupMd = fs.readFileSync(path.join(repoRoot, 'docs/setup-guide-content.md'), 'utf8');
const setupJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'resources/setupGuide.json'), 'utf8'));

assert.strictEqual(setupJson.steps.length, 6, 'Setup Guide should have 6 steps');
assert.strictEqual(setupJson.steps[5].id, 'connectGit');
assert.match(setupJson.steps[5].body, /Connect your Repository/);
assert.match(setupJson.steps[5].body, /BusinessConfig\.json/);
assert.match(setupMd, /## Step 6 — Connect a Git repository instead/);

const walkthrough = pkg.contributes.walkthroughs.find(w => w.id === 'reltio.gettingStarted');
assert.ok(walkthrough, 'reltio.gettingStarted walkthrough missing');
assert.ok(walkthrough.steps.some(s => s.id === 'connectGit'), 'walkthrough missing connectGit');
assert.ok(walkthrough.featuredFor.includes('**/BusinessConfig.json'));

const customerDocs = [readme, quickstart, setupMd, setupJson.steps.map(s => s.body).join('\n')].join('\n');
for (const phrase of [
	'Connect your Repository',
	'Add Config',
	'Remove Config',
	'Remove Repository',
	'Get Configuration',
	'Apply Configuration to Tenant',
	'View Configuration History',
	'Fetch More Configuration History',
	'BusinessConfig.json',
]) {
	assert.ok(customerDocs.includes(phrase), `customer docs missing "${phrase}"`);
}

assert.match(readme, /\*\*View changes\*\*/);
assert.doesNotMatch(readme, /Keep File/);
assert.doesNotMatch(readme, /Undo File/);
assert.doesNotMatch(quickstart, /Fetch Configuration History/);
assert.doesNotMatch(quickstart, /→ \*\*Fetch More\*\*/);

const imgSrcs = [...readme.matchAll(/src="(docs\/images\/[^"]+)"/g)].map(m => m[1]);
assert.ok(imgSrcs.length > 0, 'README should embed docs/images');
for (const rel of imgSrcs) {
	const abs = path.join(repoRoot, rel);
	assert.ok(fs.existsSync(abs), `README image missing on disk: ${rel}`);
}

console.log('test-docs-light-theme-screenshots-and-setup-guide: OK');
