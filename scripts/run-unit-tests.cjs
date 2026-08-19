#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const path = require('path');

const repoRoot = path.join(__dirname, '..');

const CODE_MODEL_FIRST = 'test-code-model-and-schema.cjs';

/** Explicit registry — one script per OpenSpec feature change (alphabetical after code-model). */
const SCRIPTS = [
	'test-apply-tenant-configuration-action.cjs',
	'test-attribute-skeleton-mandatory-fields.cjs',
	'test-autocomplete-improvements.cjs',
	'test-browser-oauth-login.cjs',
	'test-config-tree-view.cjs',
	'test-configuration-history-review.cjs',
	'test-context-menu-reorganization.cjs',
	'test-copy-tenant-id-to-clipboard.cjs',
	'test-csp-nonce-hardening.cjs',
	'test-editor-navigation.cjs',
	'test-extension-packaging.cjs',
	'test-hide-reference-attribute-for-relation-types.cjs',
	'test-insert-interaction-type.cjs',
	'test-multi-tenant-tree-view.cjs',
	'test-no-create-wizards.cjs',
	'test-ontology-view.cjs',
	'test-replace-tenants-with-enhanced-tenants.cjs',
	'test-schema-alignment-with-live-l3.cjs',
	'test-setup-ux-redesign.cjs',
	'test-skills-and-enablement-packs-library.cjs',
	'test-terms-of-use-gate.cjs',
];

function main() {
	const ordered = [CODE_MODEL_FIRST, ...SCRIPTS.filter(s => s !== CODE_MODEL_FIRST)];
	let failed = 0;
	for (const script of ordered) {
		const scriptPath = path.join(__dirname, script);
		process.stdout.write(`\n▶ ${script}\n`);
		try {
			execSync(`node "${scriptPath}"`, { stdio: 'inherit', cwd: repoRoot });
		} catch {
			failed++;
		}
	}
	if (failed > 0) {
		console.error(`\n${failed} test script(s) failed.`);
		process.exit(1);
	}
	console.log(`\nAll ${ordered.length} OpenSpec test scripts passed.`);
}

main();
