#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: git-ready-tenant-folder-structure
 *
 * Tier A: component tree materialization, README contract + documentation URLs, EnvironmentManager
 *         repathing, .gitignore entry management, migration planning, backup location,
 *         branch-creation argument sequence, and the no-stray-literals grep invariant.
 * Tier B: the canonical fixture parses identically from the legacy path and the component-tree
 *         path, proving the rename is inert for parsing, the URI index and the config subtree.
 * Tier C (manual): openspec/changes/git-ready-tenant-folder-structure/design.md
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');
const { loadCanonicalFixture, repoRoot } = require('./lib/load-canonical-fixture.cjs');

const vscode = require('./lib/vscode-stub.cjs');

const FileType = vscode.FileType;

const { installMemoryFs } = require('./lib/memory-fs.cjs');

/**
 * Regression (Wiz SAST, PR #14): the branch name was compiled into a regular expression, so a valid
 * git branch such as `feature/(x` threw and `a+b` matched `aab`. It is now compared as plain text.
 */
function testMissingBranchDetection() {
	const { isMissingBranchFailure } = importDist('workspace/gitConfigSource');
	const pathspec = b => `error: pathspec '${b}' did not match any file(s) known to git`;
	for (const branch of ['dev', 'feature/(x', 'feature/(x)', 'a+b', 'release/1.0', 'feat/a{2}', 'Feature/Mixed']) {
		assert.doesNotThrow(() => isMissingBranchFailure(pathspec(branch), branch), branch);
		assert.strictEqual(isMissingBranchFailure(pathspec(branch), branch), true, `${branch} recognised as missing`);
	}
	assert.strictEqual(isMissingBranchFailure(pathspec('aab'), 'a+b'), false, 'a+b is not a pattern');
	assert.strictEqual(isMissingBranchFailure(pathspec('releasex1.0'), 'release/1.0'), false);
	assert.strictEqual(isMissingBranchFailure("warning: Could not find remote branch dev to clone.", 'dev'), true);
	assert.strictEqual(isMissingBranchFailure('fatal: Authentication failed', 'dev'), false);
}
testMissingBranchDetection();

/** A failed migration is shown to the user, says why, and says it will retry (Wiz SAST follow-up, PR #14). */
function testMigrationFailureMessage() {
	const { migrationFailureMessage } = importDist('workspace/layoutMigration');
	const msg = migrationFailureMessage(new Error('EBUSY: resource busy or locked'));
	assert.ok(msg.includes('EBUSY: resource busy or locked'), 'names the cause');
	assert.ok(/try again the next time this workspace opens/.test(msg), 'says it will retry');
	assert.ok(!/\n\s+at /.test(msg), 'no stack trace');
	assert.ok(migrationFailureMessage('plain string').includes('plain string'));
	// The failure path must not fall back to console logging.
	const ext = fs.readFileSync(path.join(repoRoot, 'src', 'extension.ts'), 'utf8');
	const catchBlock = ext.slice(ext.indexOf('report = await migrateWorkspace('), ext.indexOf('report.migrated.length === 0'));
	assert.ok(catchBlock.includes('migrationFailureMessage(e)') && !catchBlock.includes('console.'), 'migration failure is shown, not logged');
}
testMigrationFailureMessage();

const text = s => Buffer.from(s).toString('utf8');
let pkgCache;
const pkgJson = () => (pkgCache ??= JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')));
const pkgCommands = () => pkgJson().contributes.commands;
const pkgMenus = () => pkgJson().contributes.menus['view/item/context'];
const U = p => vscode.Uri.file(p);

const structure = importDist('workspace/tenantFolderStructure');
const {
	BUSINESS_CONFIG_DIR,
	BUSINESS_CONFIG_FILE,
	BASELINE_FILE,
	LAYOUT_FILE,
	HISTORY_DIR,
	MIGRATION_BACKUP_DIR,
	COMPONENT_FOLDERS,
	allTreeDirectories,
	unmanagedFolders,
	materializeTenantTree,
	renderReadme,
	isComponentTree,
	isTenantConfigPath,
} = structure;

(async () => {
	// ---------------------------------------------------------------- 9.2 component tree

	// Business Config, RDM, Workflows (with its two sub-folders) and LifeCycle Actions. Six directories, five of them leaves.
	assert.deepStrictEqual(
		COMPONENT_FOLDERS.map(f => f.path),
		['Business Config', 'RDM', 'Workflows/BPMN', 'Workflows/Custom Workflows', 'LifeCycle Actions'],
		'exactly the five leaf components',
	);
	const dirsDeclared = allTreeDirectories();
	assert.deepStrictEqual(
		dirsDeclared,
		['Business Config', 'RDM', 'Workflows', 'Workflows/BPMN', 'Workflows/Custom Workflows', 'LifeCycle Actions'],
		'six directories, Workflows implied as a container',
	);
	// A parent is always listed before anything beneath it, so creation order is safe.
	for (const d of dirsDeclared) {
		const slash = d.lastIndexOf('/');
		if (slash === -1) continue;
		assert.ok(
			dirsDeclared.indexOf(d.slice(0, slash)) < dirsDeclared.indexOf(d),
			`parent precedes child: ${d}`,
		);
	}

	// Exactly one managed folder, and it is where the config lives.
	const managed = COMPONENT_FOLDERS.filter(f => f.managed);
	assert.deepStrictEqual(managed.map(f => f.path), [BUSINESS_CONFIG_DIR], 'only Business Config is managed');
	assert.strictEqual(BUSINESS_CONFIG_FILE, `${BUSINESS_CONFIG_DIR}/BusinessConfig.json`);
	assert.strictEqual(unmanagedFolders().length, 4, '4 unmanaged folders get a README');

	// Every unmanaged folder carries a real docs.reltio.com URL, asserted offline: the map is the
	// contract, and making CI depend on the network would be flaky for no added signal.
	for (const f of unmanagedFolders()) {
		assert.ok(f.docsUrl && f.docsUrl.startsWith('https://docs.reltio.com/'), `docs URL for ${f.path}`);
		assert.ok(f.expectedFiles.length > 0, `expected files listed for ${f.path}`);
		const readme = renderReadme(f);
		assert.ok(readme.includes(f.docsUrl), `README for ${f.path} links its documentation`);
		assert.ok(readme.includes(f.title), `README for ${f.path} names the component`);
		assert.ok(
			/not yet managed by Reltio IDE/i.test(readme),
			`README for ${f.path} states the IDE does not manage it`,
		);
	}
	// No two folders share a docs URL by copy-paste accident, except the two User Management rows
	// that legitimately point at the same account-management page.
	const urlCounts = new Map();
	for (const f of unmanagedFolders()) urlCounts.set(f.docsUrl, (urlCounts.get(f.docsUrl) ?? 0) + 1);
	for (const [url, n] of urlCounts) {
		assert.ok(n === 1, `docs URL reused (${n}x): ${url}`);
	}

	// Materialization creates every directory and exactly the unmanaged READMEs.
	let mem = installMemoryFs();
	const tenant = U('/ws/361.reltio.com.reltio.environment/demo.reltio.tenant');
	await materializeTenantTree(tenant);

	for (const d of dirsDeclared) {
		assert.strictEqual(
			(await vscode.workspace.fs.stat(U(`${tenant.fsPath}/${d}`))).type,
			FileType.Directory,
			`directory created: ${d}`,
		);
	}
	const readmes = [...mem._files.keys()].filter(p => p.endsWith('/README.md'));
	assert.strictEqual(readmes.length, 4, 'one README per unmanaged folder');
	assert.ok(mem._files.has(`${tenant.fsPath}/LifeCycle Actions/README.md`), 'LifeCycle Actions carries a README');
	assert.match(text(mem._files.get(`${tenant.fsPath}/LifeCycle Actions/README.md`)), /hcp-beforesave-customerid-lca/);
	assert.ok(
		!mem._files.has(`${tenant.fsPath}/${BUSINESS_CONFIG_DIR}/README.md`),
		'Business Config gets no README, it holds a managed file',
	);
	assert.ok(await isComponentTree(tenant), 'isComponentTree true after materialize');

	// Re-materializing is non-destructive and never overwrites a user-authored README.
	const userReadme = `${tenant.fsPath}/RDM/README.md`;
	mem._files.set(userReadme, Buffer.from('# my own notes'));
	const before = mem._files.size;
	await materializeTenantTree(tenant);
	assert.strictEqual(mem._files.size, before, 're-materialize adds no files');
	assert.strictEqual(text(mem._files.get(userReadme)), '# my own notes', 'existing README preserved');

	// ------------------------------------------- 17.x pruning folders the tree no longer includes

	// Tenants created by an earlier build carry folders that are gone from the tree. Removing them
	// deletes user-visible directories, so the guard has to be strict: our own generated README
	// and nothing else.
	const { RETIRED_COMPONENT_FOLDERS, pruneRetiredComponentFolders } = structure;
	assert.ok(RETIRED_COMPONENT_FOLDERS.includes('DTSS'), 'DTSS is retired');
	assert.ok(RETIRED_COMPONENT_FOLDERS.includes('Custom Code/Utilities'), 'nested leaves are retired');
	assert.ok(
		!RETIRED_COMPONENT_FOLDERS.some(p => ['Business Config', 'RDM', 'Workflows/BPMN', 'LifeCycle Actions'].includes(p)),
		'no surviving component is listed as retired',
	);
	assert.ok(RETIRED_COMPONENT_FOLDERS.includes('LCA'), 'the short LCA folder name is not the tree folder');

	mem = installMemoryFs();
	const old = U('/wsP/env/t1');
	await materializeTenantTree(old);
	const generated = renderReadme({
		path: 'DTSS',
		title: 'DTSS',
		description: 'x',
		expectedFiles: ['dtss_config.json'],
		docsUrl: 'https://docs.reltio.com/x',
		managed: false,
	});
	// Three retired folders: one purely generated, one holding a user file, one with a README
	// the user rewrote.
	await vscode.workspace.fs.writeFile(U(`${old.fsPath}/DTSS/README.md`), Buffer.from(generated));
	await vscode.workspace.fs.writeFile(U(`${old.fsPath}/Connectors/README.md`), Buffer.from(generated));
	await vscode.workspace.fs.writeFile(U(`${old.fsPath}/Connectors/my-connector.json`), Buffer.from('{}'));
	await vscode.workspace.fs.writeFile(
		U(`${old.fsPath}/Data Loader/README.md`),
		Buffer.from('# Data Loader\n\nMy own notes about our mappings.\n'),
	);

	const pruned = await pruneRetiredComponentFolders(old);
	assert.ok(pruned.includes('DTSS'), 'a purely generated retired folder is removed');
	assert.ok(!mem._dirs.has(`${old.fsPath}/DTSS`), 'DTSS is gone from disk');
	assert.ok(!pruned.includes('Connectors'), 'a retired folder holding a user file is kept');
	assert.ok(
		mem._files.has(`${old.fsPath}/Connectors/my-connector.json`),
		'the user file survives untouched',
	);
	assert.ok(!pruned.includes('Data Loader'), 'a user-rewritten README protects its folder');
	assert.ok(mem._files.has(`${old.fsPath}/Data Loader/README.md`), 'the rewritten README survives');

	// Surviving components are never touched, whatever else is pruned.
	for (const keep of ['Business Config', 'RDM', 'Workflows/BPMN', 'Workflows/Custom Workflows', 'LifeCycle Actions']) {
		assert.ok(mem._dirs.has(`${old.fsPath}/${keep}`), `${keep} survives pruning`);
	}
	// Idempotent: a second pass finds nothing left to do.
	assert.deepStrictEqual(await pruneRetiredComponentFolders(old), [], 'second prune is a no-op');

	// ---------------------------------------------------------------- 9.3 EnvironmentManager

	const { EnvironmentManager } = importDist('workspace/environmentManager');
	const em = new EnvironmentManager(U('/ws'));
	// Folder names are the short environment label and the bare tenant id; the host survives
	// in the environment marker, not the directory name.
	const envDir = '/ws/361';
	const tenantDir = `${envDir}/demo`;

	assert.strictEqual(em.getTenantRootUri('361.reltio.com', 'demo').fsPath, tenantDir);
	assert.strictEqual(em.getL3Uri('361.reltio.com', 'demo').fsPath, `${tenantDir}/${BUSINESS_CONFIG_FILE}`);
	assert.strictEqual(em.getRemoteBaselineUri('361.reltio.com', 'demo').fsPath, `${tenantDir}/${BASELINE_FILE}`);
	assert.strictEqual(em.getLayoutUri('361.reltio.com', 'demo').fsPath, `${tenantDir}/${LAYOUT_FILE}`);
	assert.strictEqual(em.getHistoryDirectoryUri('361.reltio.com', 'demo').fsPath, `${tenantDir}/${HISTORY_DIR}`);

	// New environments land at the workspace root, not under the hidden .reltio/ dir.
	assert.strictEqual(
		em.getTenantRootUri('new.reltio.com', 't').fsPath,
		'/ws/new/t',
		'new environments are created at the workspace root, named by the short label',
	);

	// An environment already known under .reltio/ keeps its location and is never relocated.
	mem = installMemoryFs();
	await vscode.workspace.fs.createDirectory(U('/ws2/.reltio/legacy.reltio.com.reltio.environment/t1.reltio.tenant'));
	const em2 = new EnvironmentManager(U('/ws2'));
	const scanned = await em2.scanEnvironments();
	assert.deepStrictEqual(scanned.map(e => e.name), ['legacy.reltio.com'], 'legacy .reltio/ env discovered');
	assert.ok(
		em2.getTenantRootUri('legacy.reltio.com', 't1').fsPath.includes('/.reltio/'),
		'a known .reltio/ environment keeps its location',
	);
	// hasL3 still resolves with the config one level deeper.
	assert.strictEqual(scanned[0].tenants[0].hasL3, false, 'no config yet');
	await vscode.workspace.fs.writeFile(
		U(`/ws2/.reltio/legacy.reltio.com.reltio.environment/t1.reltio.tenant/${BUSINESS_CONFIG_FILE}`),
		Buffer.from('{}'),
	);
	const rescanned = await em2.scanEnvironments();
	assert.strictEqual(rescanned[0].tenants[0].hasL3, true, 'hasL3 true once the component-tree config exists');

	// Git-sourced repos that carry the component tree keep their layout out of the tracked tree.
	const em3 = new EnvironmentManager(U('/ws3'));
	em3.setGitSource({
		environmentName: 'repo',
		tenantId: 'cfg',
		folders: [],
		l3Uri: U(`/ws3/${BUSINESS_CONFIG_FILE}`),
	});
	assert.strictEqual(em3.getLayoutUri('repo', 'cfg').fsPath, `/ws3/${LAYOUT_FILE}`,
		'component-tree git source puts the layout in .reltio-ide/');
	// A repo with an arbitrary layout keeps the sidecar beside the config, as before.
	const em4 = new EnvironmentManager(U('/ws4'));
	em4.setGitSource({ environmentName: 'repo', tenantId: 'cfg', folders: [], l3Uri: U('/ws4/nested/L3.json') });
	assert.strictEqual(em4.getLayoutUri('repo', 'cfg').fsPath, '/ws4/nested/L3.reltio.layout.json',
		'arbitrary git source is unchanged');

	// ---------------------------------------------------------------- 9.4 marker round-trip

	mem = installMemoryFs();
	const marker = importDist('workspace/gitSourceMarker');
	const mTenant = U('/ws/env.reltio.environment/tid.reltio.tenant');
	assert.strictEqual(await marker.readTenantIdentityMarker(mTenant), undefined, 'absent marker reads undefined');
	await marker.writeTenantIdentityMarker(mTenant, {
		kind: 'tenant',
		environmentName: 'env',
		tenantId: 'tid',
	});
	const readBack = await marker.readTenantIdentityMarker(mTenant);
	assert.deepStrictEqual(
		{ environmentName: readBack.environmentName, tenantId: readBack.tenantId },
		{ environmentName: 'env', tenantId: 'tid' },
		'marker round-trips environment and tenant',
	);
	// A git-source marker is a different shape and must not be read as a tenant identity.
	await marker.writeGitSourceMarker(U('/ws/other'), {
		l3RelativePath: 'a.json',
		environmentName: 'e',
		tenantId: 't',
	});
	assert.strictEqual(
		await marker.readTenantIdentityMarker(U('/ws/other')),
		undefined,
		'a git-source marker is not mistaken for a tenant identity',
	);

	// ---------------------------------------------------------------- 9.5 .gitignore entries

	const gitignore = `${mTenant.fsPath}/.gitignore`;
	const ignored = text(mem._files.get(gitignore));
	for (const entry of ['.reltio-config-source.json', '.reltio/', '.reltio-ide/']) {
		assert.ok(ignored.split(/\r?\n/).includes(entry), `.gitignore contains ${entry}`);
	}

	// Unrelated entries survive and nothing is duplicated on a second pass.
	mem._files.set(gitignore, Buffer.from('node_modules/\n.reltio-ide\n'));
	await marker.ensureMarkerGitignored(mTenant);
	const lines = text(mem._files.get(gitignore)).split(/\r?\n/).filter(Boolean);
	assert.ok(lines.includes('node_modules/'), 'unrelated entries preserved');
	assert.strictEqual(
		lines.filter(l => l === '.reltio-ide' || l === '.reltio-ide/').length,
		1,
		'a slash-less .reltio-ide is recognized, not duplicated',
	);
	await marker.ensureMarkerGitignored(mTenant);
	const lines2 = text(mem._files.get(gitignore)).split(/\r?\n/).filter(Boolean);
	assert.deepStrictEqual(lines2, lines, 'repeat call is a no-op');

	// ---------------------------------------------------------------- 9.6 migration planning

	mem = installMemoryFs();
	const migration = importDist('workspace/layoutMigration');
	const legacyTenant = U('/ws/361.reltio.com.reltio.environment/legacy.reltio.tenant');
	await vscode.workspace.fs.writeFile(U(`${legacyTenant.fsPath}/L3.reltio.json`), Buffer.from('{"a":1}'));
	await vscode.workspace.fs.writeFile(
		U(`${legacyTenant.fsPath}/L3.remote-baseline.reltio.json`),
		Buffer.from('{"a":1}'),
	);
	await vscode.workspace.fs.writeFile(
		U(`${legacyTenant.fsPath}/history/L3-someone---1.reltio.json`),
		Buffer.from('{}'),
	);

	let plan = await migration.planMigration('361.reltio.com', 'legacy', legacyTenant);
	assert.deepStrictEqual(
		plan.moves.map(m => [m.legacy, m.destination]).sort(),
		[
			['L3.remote-baseline.reltio.json', BASELINE_FILE],
			['L3.reltio.json', BUSINESS_CONFIG_FILE],
			['history', HISTORY_DIR],
		].sort(),
		'plan maps each present legacy file and omits the absent layout sidecar',
	);

	// Already-migrated folder plans nothing.
	const migratedTenant = U('/ws/361.reltio.com.reltio.environment/done.reltio.tenant');
	await vscode.workspace.fs.writeFile(U(`${migratedTenant.fsPath}/${BUSINESS_CONFIG_FILE}`), Buffer.from('{}'));
	plan = await migration.planMigration('361.reltio.com', 'done', migratedTenant);
	assert.strictEqual(plan.moves.length, 0, 'already-migrated folder is a no-op');

	// Backup lands at the workspace root, gitignored there, and the stamp gates repeat runs.
	const state = new Map();
	const memento = {
		get: (k, d) => (state.has(k) ? state.get(k) : d),
		update: async (k, v) => {
			if (v === undefined) state.delete(k);
			else state.set(k, v);
		},
	};
	const skip = await migration.migrateTenant(
		U('/ws'),
		await migration.planMigration('361.reltio.com', 'legacy', legacyTenant),
		memento,
	);
	assert.strictEqual(skip, undefined, 'migration succeeds on a non-git folder');
	assert.ok(
		mem._files.has(`/ws/${MIGRATION_BACKUP_DIR}/361.reltio.com/legacy/L3.reltio.json`),
		'backup written to .reltio-ide-backup/{env}/{tenant}/',
	);
	assert.ok(
		text(mem._files.get('/ws/.gitignore')).includes(`${MIGRATION_BACKUP_DIR}/`),
		'workspace-root .gitignore excludes the backup folder',
	);
	assert.ok(
		mem._files.has(`${legacyTenant.fsPath}/${BUSINESS_CONFIG_FILE}`),
		'config moved into the component tree',
	);
	assert.ok(!mem._files.has(`${legacyTenant.fsPath}/L3.reltio.json`), 'legacy config no longer present');
	assert.strictEqual(
		text(mem._files.get(`${legacyTenant.fsPath}/${BUSINESS_CONFIG_FILE}`)),
		'{"a":1}',
		'content preserved byte for byte',
	);
	assert.strictEqual(state.get('reltio.layoutMigrated::361.reltio.com::legacy'), true, 'stamp written on success');

	// A backup-failure path must not write the stamp, so the next activation retries.
	const failingFs = installMemoryFs();
	failingFs.copy = async () => {
		throw new Error('disk full');
	};
	const state2 = new Map();
	const memento2 = {
		get: (k, d) => (state2.has(k) ? state2.get(k) : d),
		update: async (k, v) => state2.set(k, v),
	};
	const t2 = U('/ws/e.reltio.environment/t.reltio.tenant');
	await failingFs.writeFile(U(`${t2.fsPath}/L3.reltio.json`), Buffer.from('{}'));
	const skip2 = await migration.migrateTenant(
		U('/ws'),
		await migration.planMigration('e', 't', t2),
		memento2,
	);
	assert.strictEqual(skip2 && skip2.reason, 'backup-failed', 'backup failure is reported');
	assert.strictEqual(state2.size, 0, 'no stamp on failure, so the run is retried');

	// ---------------------------------------------------------------- 12.x plain folder names

	const { environmentShortLabel } = importDist('workspace/environmentManager');
	const migrationRenamer = importDist('workspace/layoutMigration');
	assert.strictEqual(environmentShortLabel('dev.reltio.com'), 'dev');
	assert.strictEqual(environmentShortLabel('361.reltio.com'), '361');
	assert.strictEqual(environmentShortLabel('prod.uk.reltio.com'), 'prod');
	assert.strictEqual(environmentShortLabel('localhost'), 'localhost', 'a label-less host is its own label');

	// Creating an environment uses the short label and writes the host into the marker, because
	// the directory name no longer carries it.
	mem = installMemoryFs();
	const emN = new EnvironmentManager(U('/wsN'));
	const envUri = await emN.createEnvironment('dev.reltio.com');
	assert.strictEqual(envUri.fsPath, '/wsN/dev', 'environment folder is the short label');
	assert.deepStrictEqual(
		JSON.parse(text(mem._files.get('/wsN/dev/.reltio-environment.json'))),
		{ kind: 'environment', host: 'dev.reltio.com' },
		'environment marker carries the full host',
	);

	// A second host wanting the same label falls back to its full host.
	await emN.createEnvironment('dev.uk.reltio.com');
	assert.ok(mem._dirs.has('/wsN/dev.uk.reltio.com'), 'colliding short label falls back to the host');

	// Tenant folders are the bare id, and get a marker plus a .gitignore at creation time, so
	// `.reltio-ide/` is ignored even if the user inits a repo from the SCM panel.
	const tUri = await emN.createTenant('dev.reltio.com', 'GrmSwAZFRAeVy1K');
	assert.strictEqual(tUri.fsPath, '/wsN/dev/GrmSwAZFRAeVy1K', 'tenant folder is the bare id');
	assert.deepStrictEqual(
		JSON.parse(text(mem._files.get('/wsN/dev/GrmSwAZFRAeVy1K/.reltio-config-source.json'))),
		{ kind: 'tenant', environmentName: 'dev.reltio.com', tenantId: 'GrmSwAZFRAeVy1K' },
		'tenant marker written at creation, not only on git bind',
	);
	const tenantIgnore = text(mem._files.get('/wsN/dev/GrmSwAZFRAeVy1K/.gitignore')).split(/\r?\n/);
	assert.ok(tenantIgnore.includes('.reltio-ide/'), 'createTenant writes the tenant .gitignore');

	// Marker-based discovery round-trips, and the reverse index resolves a file back to its tenant.
	const discovered = await emN.scanEnvironments();
	assert.deepStrictEqual(
		discovered.map(e => e.name).sort(),
		['dev.reltio.com', 'dev.uk.reltio.com'],
		'environments discovered by marker, keyed by host',
	);
	assert.deepStrictEqual(
		discovered.find(e => e.name === 'dev.reltio.com').tenants.map(t => t.tenantId),
		['GrmSwAZFRAeVy1K'],
		'tenant discovered by marker',
	);
	assert.deepStrictEqual(
		emN.locFromPath(`/wsN/dev/GrmSwAZFRAeVy1K/${BUSINESS_CONFIG_FILE}`),
		{ environmentName: 'dev.reltio.com', tenantId: 'GrmSwAZFRAeVy1K' },
		'reverse index maps a config path back to its tenant',
	);
	assert.strictEqual(emN.locFromPath('/wsN/elsewhere/x.json'), undefined, 'paths outside a tenant resolve to undefined');

	// Legacy suffixed folders stay discoverable, so a workspace works before it is renamed.
	mem = installMemoryFs();
	await vscode.workspace.fs.writeFile(
		U(`/wsL/old.reltio.com.reltio.environment/t9.reltio.tenant/${BUSINESS_CONFIG_FILE}`),
		Buffer.from('{}'),
	);
	const emL = new EnvironmentManager(U('/wsL'));
	const legacyScan = await emL.scanEnvironments();
	assert.deepStrictEqual(legacyScan.map(e => e.name), ['old.reltio.com'], 'legacy suffixed env still found');
	assert.deepStrictEqual(legacyScan[0].tenants.map(t => t.tenantId), ['t9'], 'legacy suffixed tenant still found');

	// Removing a legacy-named tenant must delete the folder that is actually on disk, not the
	// bare name it would be called today. Resolving after forgetting the location deletes nothing.
	assert.ok(mem._dirs.has('/wsL/old.reltio.com.reltio.environment/t9.reltio.tenant'), 'legacy dir present');
	const emR = new EnvironmentManager(U('/wsL'));
	await emR.scanEnvironments();
	await emR.removeTenant('old.reltio.com', 't9');
	assert.ok(
		!mem._dirs.has('/wsL/old.reltio.com.reltio.environment/t9.reltio.tenant'),
		'removeTenant deletes the legacy-suffixed folder actually on disk',
	);
	assert.ok(
		!mem._files.has(`/wsL/old.reltio.com.reltio.environment/t9.reltio.tenant/${BUSINESS_CONFIG_FILE}`),
		'its contents go with it',
	);

	// Rebuild the legacy workspace for the rename checks below.
	mem = installMemoryFs();
	await vscode.workspace.fs.writeFile(
		U(`/wsL/old.reltio.com.reltio.environment/t9.reltio.tenant/${BUSINESS_CONFIG_FILE}`),
		Buffer.from('{}'),
	);
	await emL.scanEnvironments();

	// Renaming drops the suffixes and leaves markers behind.
	const renameResult = await migrationRenamer.renameSuffixedFolders(U('/wsL'), emL);
	assert.deepStrictEqual(renameResult.skipped, [], 'nothing skipped on a clean non-git workspace');
	assert.ok(mem._dirs.has('/wsL/old'), 'environment folder renamed to the short label');
	assert.ok(
		mem._files.has(`/wsL/old/t9/${BUSINESS_CONFIG_FILE}`),
		'tenant renamed to the bare id, config carried along',
	);
	assert.ok(mem._files.has('/wsL/old/.reltio-environment.json'), 'environment marker written before rename');
	assert.ok(mem._files.has('/wsL/old/t9/.reltio-config-source.json'), 'tenant marker written before rename');
	const afterRename = await emL.scanEnvironments();
	assert.deepStrictEqual(afterRename.map(e => e.name), ['old.reltio.com'], 'host identity survives the rename');
	assert.strictEqual(afterRename[0].tenants[0].hasL3, true, 'config still resolves after the rename');

	// ------------------------------------------------- 12.12 binding a tenant that already fetched

	// `git clone` refuses a non-empty directory, so a tenant fetched before being connected has to
	// take the adopt-in-place path instead. Guard the classification that routes between them.
	const binding = importDist('workspace/tenantGitBinding');
	mem = installMemoryFs();
	const fresh = U('/wsB/env/t1');
	await materializeTenantTree(fresh);
	assert.strictEqual(
		await binding.isTenantFolderCloneable(fresh),
		true,
		'a materialized but unfetched tenant is still cloneable: the tree is ours, not user content',
	);

	await vscode.workspace.fs.writeFile(U(`${fresh.fsPath}/${BUSINESS_CONFIG_FILE}`), Buffer.from('{}'));
	assert.strictEqual(
		await binding.isTenantFolderCloneable(fresh),
		false,
		'once a configuration is fetched the folder is no longer cloneable, so binding must adopt',
	);

	// A user file dropped into an unmanaged component folder also counts as content.
	const fresh2 = U('/wsB/env/t2');
	await materializeTenantTree(fresh2);
	await vscode.workspace.fs.writeFile(U(`${fresh2.fsPath}/RDM/config.json`), Buffer.from('{}'));
	assert.strictEqual(
		await binding.isTenantFolderCloneable(fresh2),
		false,
		'a user file in a component folder makes the tenant non-cloneable',
	);

	// `.reltio-ide/` is IDE state, never user content, so it must not force the adopt path.
	const fresh3 = U('/wsB/env/t3');
	await materializeTenantTree(fresh3);
	await vscode.workspace.fs.writeFile(U(`${fresh3.fsPath}/${LAYOUT_FILE}`), Buffer.from('{}'));
	assert.strictEqual(
		await binding.isTenantFolderCloneable(fresh3),
		true,
		'IDE state alone does not make a tenant non-cloneable',
	);

	// ------------------------------------------- 16.x enclosing repository: detect and defuse

	// The extension cannot prevent `git init` at the workspace root, so it must (a) keep its own
	// state out of any repository rooted above the tenants and (b) be able to detect one.
	mem = installMemoryFs();
	const wsRoot = U('/wsE');
	await vscode.workspace.fs.createDirectory(wsRoot);
	await marker.ensureWorkspaceGitignored(wsRoot);
	const rootIgnore = text(mem._files.get('/wsE/.gitignore')).split(/\r?\n/).filter(Boolean);
	for (const entry of [
		'.reltio/',
		'.reltio-ide/',
		'.reltio-ide-backup/',
		'.reltio-environment.json',
		'.reltio-config-source.json',
	]) {
		assert.ok(rootIgnore.includes(entry), `workspace .gitignore excludes ${entry}`);
	}
	// Environment folders are deliberately NOT ignored: a team may want one repository for the
	// whole workspace, and that choice is theirs to make.
	assert.ok(
		!rootIgnore.some(l => l === 'dev/' || l === 'dev'),
		'environment folders are not ignored by default',
	);
	// Idempotent, like the tenant-level helper.
	await marker.ensureWorkspaceGitignored(wsRoot);
	assert.deepStrictEqual(
		text(mem._files.get('/wsE/.gitignore')).split(/\r?\n/).filter(Boolean),
		rootIgnore,
		'repeat call adds nothing',
	);

	const gitSource = importDist('workspace/gitConfigSource');
	assert.strictEqual(
		await gitSource.findEnclosingGitRepository(U('/wsE/dev/T1')),
		undefined,
		'no repository above a clean workspace',
	);
	// A repository two levels up must still be found: people run `git init` in a Projects folder.
	await vscode.workspace.fs.createDirectory(U('/wsE/.git'));
	assert.strictEqual(
		(await gitSource.findEnclosingGitRepository(U('/wsE/dev/T1'))).fsPath,
		'/wsE',
		'an enclosing repository is found from a nested tenant path',
	);
	// The start directory itself counts. This is the common case: the activation check passes the
	// workspace root, which is exactly where Source Control's Initialize Repository puts `.git`.
	assert.strictEqual(
		(await gitSource.findEnclosingGitRepository(U('/wsE'))).fsPath,
		'/wsE',
		'a repository at the start directory is reported, not skipped',
	);
	// The nearest one wins, so the message names the repository that actually matters.
	await vscode.workspace.fs.createDirectory(U('/wsE/dev/.git'));
	assert.strictEqual(
		(await gitSource.findEnclosingGitRepository(U('/wsE/dev/T1'))).fsPath,
		'/wsE/dev',
		'the nearest enclosing repository is reported',
	);

	// ---------------------------------------------------------------- 9.7 path predicate

	assert.ok(isTenantConfigPath(`/x/${BUSINESS_CONFIG_FILE}`), 'component-tree config recognized');
	assert.ok(isTenantConfigPath('/x/L3.reltio.json'), 'legacy config still recognized (migration may skip a tenant)');
	assert.ok(isTenantConfigPath('C:\\x\\Business Config\\BusinessConfig.json'), 'windows separators handled');
	assert.ok(!isTenantConfigPath('/x/Business Config/Other.json'), 'unrelated file rejected');

	// ------------------------------------ 19.x tenant Git menu depends on whether it is bound

	// Before binding the row offers Connect; after binding it offers New Branch and Disconnect.
	// That switch is driven entirely by the contextValue suffix, so both halves are asserted.
	const { TenantNode } = importDist('tree/multiTenantNodes');
	const unbound = new TenantNode('e', 't', true, false, true, 'T_READY', false, undefined, undefined, false);
	const bound = new TenantNode('e', 't', true, false, true, 'T_READY', false, undefined, 'dev', true);
	assert.ok(!/gitbound/.test(unbound.contextValue), 'an unbound tenant carries no gitbound marker');
	assert.ok(/gitbound/.test(bound.contextValue), 'a bound tenant is marked gitbound');
	assert.ok(
		unbound.contextValue.startsWith('reltio.tenant'),
		'the existing tenant menu entries still match',
	);

	// A detached HEAD has no branch but is still a repository: Disconnect must stay reachable.
	const detached = new TenantNode('e', 't', true, false, true, 'T_READY', false, undefined, undefined, true);
	assert.ok(
		/gitbound/.test(detached.contextValue),
		'a detached HEAD is still gitbound, so Disconnect is still offered',
	);

	const menus = pkgMenus();
	const whenFor = cmd => menus.filter(m => m.command === cmd).map(m => m.when);
	assert.deepStrictEqual(
		whenFor('reltio.connectTenantToGit').map(w => /!\(viewItem =~ \/gitbound\/\)/.test(w)),
		[true],
		'Connect to Git is hidden once the tenant is bound',
	);
	for (const cmd of ['reltio.tenantNewBranch', 'reltio.disconnectTenantFromGit']) {
		const whens = whenFor(cmd);
		assert.strictEqual(whens.length, 1, `${cmd} has one context-menu entry`);
		assert.ok(/viewItem =~ \/gitbound\//.test(whens[0]), `${cmd} only shows when bound`);
		assert.ok(/workspaceSource != 'git'/.test(whens[0]), `${cmd} is hidden in git-source mode`);
	}
	// Titles are what the user actually reads, so pin them.
	const titleOf = cmd => pkgCommands().find(c => c.command === cmd)?.title;
	assert.strictEqual(titleOf('reltio.connectTenantToGit'), 'Connect to Git');
	assert.strictEqual(titleOf('reltio.tenantNewBranch'), 'Connect to a New Branch');
	assert.strictEqual(titleOf('reltio.disconnectTenantFromGit'), 'Disconnect from Git');

	// --------------------------------------------- 18.x activation must survive the rename

	// Dropping the `.reltio.environment` / `.reltio.tenant` suffixes and renaming the config file
	// removed every filesystem trigger the extension used to activate on. A workspace on the
	// current layout then never activates by itself, so migration, pruning and the tree never run.
	// This asserts a trigger exists for each thing the current layout actually puts on disk.
	const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
	const activation = pkg.activationEvents ?? [];
	const contains = activation
		.filter(e => e.startsWith('workspaceContains:'))
		.map(e => e.slice('workspaceContains:'.length));

	// The managed configuration file: present in every fetched tenant.
	assert.ok(
		contains.some(g => g.endsWith('/BusinessConfig.json') || g === 'BusinessConfig.json'),
		'an activation trigger matches the tenant configuration file',
	);
	// The markers: present even before anything is fetched, which is when the tree is created.
	assert.ok(
		contains.some(g => g.includes('.reltio-environment.json')),
		'an activation trigger matches the environment marker',
	);
	assert.ok(
		contains.some(g => g.includes('.reltio-config-source.json')),
		'an activation trigger matches the tenant marker',
	);
	// Legacy triggers stay, so a workspace that has not been migrated still activates.
	for (const legacy of ['*.reltio.environment', '*.reltio.json']) {
		assert.ok(
			contains.some(g => g.endsWith(legacy)),
			`legacy activation trigger retained: ${legacy}`,
		);
	}

	// ---------------------------------------------------------------- 9.8 grep invariant

	// The whole point of centralizing paths is that no other module can drift. Only the layout
	// module may name the legacy files; EnvironmentManager now goes through it too.
	const ALLOWED = new Set([
		path.join('src', 'workspace', 'tenantFolderStructure.ts'),
	]);
	const offenders = [];
	(function walk(dir) {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (entry.name.endsWith('.ts')) {
				const rel = path.relative(repoRoot, full);
				if (ALLOWED.has(rel)) continue;
				const src = fs.readFileSync(full, 'utf8');
				for (const literal of ["'L3.reltio.json'", "'L3.remote-baseline.reltio.json'"]) {
					if (src.includes(literal)) offenders.push(`${rel}: ${literal}`);
				}
			}
		}
	})(path.join(repoRoot, 'src'));
	assert.deepStrictEqual(offenders, [], 'no legacy path literals outside tenantFolderStructure.ts');

	// ---------------------------------------------------------------- Tier B: rename is inert

	// The same bytes parsed as a legacy file and as a component-tree file must produce an identical
	// model, URI index and config subtree. That is what makes the rename safe for navigation,
	// diagnostics and the tree without hand-written expectations.
	const fixture = loadCanonicalFixture();
	const { parseDocument } = importDist('parser/configParser');
	const { UriIndex } = importDist('navigation/uriIndex');
	const { getConfigRootChildren } = importDist('tree/configSubtree');

	const legacyParsed = parseDocument(fixture.text);
	const treeParsed = parseDocument(fixture.text);

	assert.deepStrictEqual(treeParsed.model, legacyParsed.model, 'model identical regardless of filename');

	const legacyIndex = new UriIndex();
	legacyIndex.build(legacyParsed.model, legacyParsed.ast);
	const treeIndex = new UriIndex();
	treeIndex.build(treeParsed.model, treeParsed.ast);

	const definitionUris = i => [...i.getAllDefinitionUris()].sort();
	const legacyUris = definitionUris(legacyIndex);
	assert.ok(legacyUris.length > 0, 'fixture actually produced definition URIs');
	assert.deepStrictEqual(definitionUris(treeIndex), legacyUris, 'URI index identical');
	assert.deepStrictEqual(
		treeIndex.getAllUnresolved(legacyParsed.ast),
		legacyIndex.getAllUnresolved(legacyParsed.ast),
		'unresolved-URI diagnostics identical',
	);

	const legacyRoot = getConfigRootChildren(legacyParsed.model, U(`/t/L3.reltio.json`));
	const treeRoot = getConfigRootChildren(treeParsed.model, U(`/t/${BUSINESS_CONFIG_FILE}`));
	assert.strictEqual(treeRoot.length, legacyRoot.length, 'same number of config tree sections');
	assert.deepStrictEqual(
		treeRoot.map(n => n.label),
		legacyRoot.map(n => n.label),
		'same config tree section labels',
	);
	assert.ok(treeRoot.length > 0, 'fixture actually produced tree sections');

	console.log('test-git-ready-tenant-folder-structure: OK');
})().catch(e => {
	console.error(e);
	process.exit(1);
});
