#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: git-repository-source
 * Tier A: deriveTenantNaming, discoverL3Files (depth/dotfolder rules), isFolderEmpty (.reltio/OS-artifact
 *         ignore list, error propagation vs. missing-folder), isPathContainedIn (workspace-root escape guard),
 *         isParsableL3File (JSON/JSONC sanity check), gitSourceMarker read/write round-trip + gitignore side
 *         effect + fail-safe validation, EnvironmentManager git-source override
 *         (scanEnvironments/getL3Uri/getLayoutUri/clearGitSource)
 * Tier C (manual): actual `git clone`/`git remote` invocation (including the 5-minute clone timeout), real
 *   Extension Development Host clone flow, Remove Repository deletion (including the useTrash fallback),
 *   .reltio move-aside/restore around a real clone — see openspec/changes/git-repository-source/design.md
 *   Test plan and ARCHITECTURE.md manual verification notes.
 */
const assert = require('assert');
const { importDist } = require('./lib/import-dist.cjs');
const vscode = require('./lib/vscode-stub.cjs');

const {
	deriveTenantNaming,
	deriveTenantNamings,
	discoverL3Files,
	isParsableL3File,
	isBusinessConfigFile,
} = importDist('workspace/l3Discovery');
const { isFolderEmpty, isPathContainedIn } = importDist('workspace/gitConfigSource');
const { TenantNode } = importDist('tree/multiTenantNodes');
const { readGitSourceMarker, writeGitSourceMarker } = importDist('workspace/gitSourceMarker');
const { EnvironmentManager } = importDist('workspace/environmentManager');
const { TokenStore, GIT_SOURCE_TOKEN } = importDist('api/tokenStore');
const { MultiTenantTreeProvider } = importDist('tree/multiTenantTreeProvider');
const { GitFolderNode, EnvironmentNode } = importDist('tree/multiTenantNodes');

(async () => {
	// --- deriveTenantNaming -------------------------------------------------

	{
		const root = vscode.Uri.file('/repo/my-config-repo');

		// A config at the repository root is named after its file. Borrowing the repository
		// name would duplicate the environment row directly above it.
		const rootL3 = vscode.Uri.joinPath(root, 'BusinessConfig.json');
		const atRoot = deriveTenantNaming(root, rootL3, [rootL3]);
		assert.strictEqual(atRoot.environmentName, 'my-config-repo');
		assert.strictEqual(atRoot.tenantId, 'BusinessConfig.json');
		assert.notStrictEqual(atRoot.tenantId, atRoot.environmentName, 'must not duplicate the environment row label');
		assert.deepStrictEqual(atRoot.folders, []);

		// Adopting a second root config must not rename the first one. Previously the lone
		// root config took the repository name and switched to its filename once a sibling
		// appeared, so the row silently renamed itself under the user.
		const rootSibling = vscode.Uri.joinPath(root, 'L3.json');
		const rootPair = deriveTenantNamings(root, [rootL3, rootSibling]);
		assert.deepStrictEqual(rootPair.map(x => x.tenantId), ['BusinessConfig.json', 'L3.json']);
		assert.deepStrictEqual(rootPair[0].folders, [], 'root configs hang directly off the environment row');
		assert.deepStrictEqual(rootPair[1].folders, []);
		assert.strictEqual(
			rootPair[0].tenantId,
			atRoot.tenantId,
			'a root config keeps its identity when a sibling is adopted',
		);

		// Nested: the deepest folder names the config row, the ones above become folder rows.
		const nested = vscode.Uri.joinPath(root, 'DP', 'dp_lif', 'BusinessConfig.json');
		const n = deriveTenantNaming(root, nested, [nested]);
		assert.strictEqual(n.tenantId, 'dp_lif');
		assert.deepStrictEqual(n.folders, ['DP'], 'repo -> DP -> dp_lif');

		// Deeper nesting keeps every intermediate folder.
		const deep = vscode.Uri.joinPath(root, 'a', 'b', 'c', 'BusinessConfig.json');
		const d = deriveTenantNaming(root, deep, [deep]);
		assert.strictEqual(d.tenantId, 'c');
		assert.deepStrictEqual(d.folders, ['a', 'b']);

		// Two configs in one folder: the folder keeps its own row and files become the leaves.
		const sibA = vscode.Uri.joinPath(root, 'DP', 'dp_lif', 'BusinessConfig.json');
		const sibB = vscode.Uri.joinPath(root, 'DP', 'dp_lif', 'L3.json');
		const both = deriveTenantNamings(root, [sibA, sibB]);
		assert.deepStrictEqual(both.map(x => x.tenantId), ['BusinessConfig.json', 'L3.json']);
		assert.deepStrictEqual(both[0].folders, ['DP', 'dp_lif']);
		assert.deepStrictEqual(both[1].folders, ['DP', 'dp_lif']);

		// tenantId is the marker key, so identical leaf names in different folders must stay
		// distinguishable — qualify the clash, leave everything else short.
		const clashA = vscode.Uri.joinPath(root, 'DP', 'shared', 'BusinessConfig.json');
		const clashB = vscode.Uri.joinPath(root, 'MDM', 'shared', 'BusinessConfig.json');
		const lonely = vscode.Uri.joinPath(root, 'other', 'unique', 'BusinessConfig.json');
		const clashes = deriveTenantNamings(root, [clashA, clashB, lonely]);
		const ids = clashes.map(x => x.tenantId);
		assert.deepStrictEqual(ids, ['shared (DP/shared)', 'shared (MDM/shared)', 'unique']);
		assert.strictEqual(new Set(ids).size, ids.length, 'tenantIds must be unique');

		// The qualifier is identity only. The tree already nests the row under its folder rows,
		// so echoing the path in the label just adds noise: `shared`, not `shared (DP/shared)`.
		assert.deepStrictEqual(clashes.map(x => x.label), ['shared', 'shared', 'unique']);

		// Same rule for filename leaves that collide across folders: the root pair and the
		// Account360 pair share both filenames, so ids are qualified but labels stay plain.
		const nestedPair = deriveTenantNamings(root, [
			rootL3,
			rootSibling,
			vscode.Uri.joinPath(root, 'Account360', 'BusinessConfig.json'),
			vscode.Uri.joinPath(root, 'Account360', 'L3.json'),
		]);
		assert.deepStrictEqual(
			nestedPair.map(x => x.label),
			['BusinessConfig.json', 'L3.json', 'BusinessConfig.json', 'L3.json'],
			'labels never carry the collision qualifier',
		);
		assert.deepStrictEqual(nestedPair.map(x => x.tenantId), [
			'BusinessConfig.json',
			'L3.json',
			'BusinessConfig.json (Account360)',
			'L3.json (Account360)',
		]);
		assert.strictEqual(
			new Set(nestedPair.map(x => x.tenantId)).size,
			4,
			'tenantIds stay unique even though labels repeat',
		);
		assert.deepStrictEqual(nestedPair[2].folders, ['Account360'], 'the folder row disambiguates visually');

		// The row actually renders the label, while identity keys stay on the qualified id.
		const qualified = nestedPair[2];
		const node = new TenantNode('my-config-repo', qualified.tenantId, true, false, true, 'T_READY', true, qualified.label);
		assert.strictEqual(node.label, 'BusinessConfig.json', 'the tree shows the plain label');
		assert.strictEqual(
			node.id,
			'tenant:my-config-repo/BusinessConfig.json (Account360)',
			'the node id keeps the unique tenantId so reveal and lookups stay unambiguous',
		);
		assert.ok(String(node.tooltip).includes('(Account360)'), 'the qualifier stays reachable on hover');

		// Tenant mode passes no label, so the id doubles as the label exactly as before.
		const tenantModeNode = new TenantNode('dev-env', 'my-tenant', true, false, true, 'T_READY');
		assert.strictEqual(tenantModeNode.label, 'my-tenant');
	}

	// --- discoverL3Files: depth limit + dotfolder skip ----------------------

	{
		const originalReadDirectory = vscode.workspace.fs.readDirectory;
		// Auto-discovery matches `BusinessConfig.json` only (case-insensitively). Other L3
		// filenames are adopted through `reltio.addFileAsTenant`, not by scanning.
		const fsTree = new Map([
			['/repo', [['sub', 2], ['.git', 2], ['other.json', 1], ['L3.json', 1]]],
			['/repo/sub', [['BusinessConfig.json', 1], ['deep', 2]]],
			['/repo/sub/deep', [['businessconfig.json', 1]]],
			['/repo/.git', [['BusinessConfig.json', 1]]],
		]);
		vscode.workspace.fs.readDirectory = async uri => fsTree.get(uri.path) ?? [];

		const found = await discoverL3Files(vscode.Uri.file('/repo'));
		assert.deepStrictEqual(
			found.map(u => u.path).sort(),
			['/repo/sub/BusinessConfig.json', '/repo/sub/deep/businessconfig.json'],
			'discovery is case-insensitive, skips dotfolders, and ignores non-BusinessConfig JSON',
		);

		vscode.workspace.fs.readDirectory = originalReadDirectory;
	}

	// --- isFolderEmpty: ignores .reltio + OS artifacts, propagates real errors

	{
		const originalReadDirectory = vscode.workspace.fs.readDirectory;

		vscode.workspace.fs.readDirectory = async () => [['.reltio', 2]];
		assert.strictEqual(await isFolderEmpty(vscode.Uri.file('/only-reltio')), true);

		vscode.workspace.fs.readDirectory = async () => [
			['.reltio', 2], ['.DS_Store', 1], ['Thumbs.db', 1], ['desktop.ini', 1],
		];
		assert.strictEqual(
			await isFolderEmpty(vscode.Uri.file('/only-os-artifacts')),
			true,
			'a folder containing only OS-generated artifacts should still count as empty',
		);

		vscode.workspace.fs.readDirectory = async () => [['.reltio', 2], ['README.md', 1]];
		assert.strictEqual(await isFolderEmpty(vscode.Uri.file('/reltio-plus-file')), false);

		vscode.workspace.fs.readDirectory = async () => [];
		assert.strictEqual(await isFolderEmpty(vscode.Uri.file('/truly-empty')), true);

		vscode.workspace.fs.readDirectory = async () => {
			const err = new Error('ENOENT: no such file or directory');
			err.code = 'FileNotFound';
			throw err;
		};
		assert.strictEqual(
			await isFolderEmpty(vscode.Uri.file('/does-not-exist-yet')),
			true,
			'a folder that does not exist yet is safe to clone into',
		);

		vscode.workspace.fs.readDirectory = async () => {
			const err = new Error('EACCES: permission denied');
			err.code = 'NoPermissions';
			throw err;
		};
		await assert.rejects(
			() => isFolderEmpty(vscode.Uri.file('/permission-denied')),
			/permission denied/,
			'a real read failure must propagate, not be treated as "empty"',
		);

		vscode.workspace.fs.readDirectory = originalReadDirectory;
	}

	// --- isPathContainedIn: workspace-root escape guard ---------------------

	{
		const root = vscode.Uri.file('/repo3');
		assert.strictEqual(isPathContainedIn(root, vscode.Uri.file('/repo3')), true, 'root itself is contained');
		assert.strictEqual(
			isPathContainedIn(root, vscode.Uri.joinPath(root, 'sub', 'L3.json')),
			true,
			'a nested descendant is contained',
		);
		assert.strictEqual(
			isPathContainedIn(root, vscode.Uri.file('/repo3-evil/L3.json')),
			false,
			'a sibling folder with a matching prefix must not be treated as contained (boundary check)',
		);
		assert.strictEqual(
			isPathContainedIn(root, vscode.Uri.file('/elsewhere/L3.json')),
			false,
			'an unrelated path is not contained',
		);
	}

	// --- isParsableL3File: JSON/JSONC sanity check ---------------------------

	{
		const originalReadFile = vscode.workspace.fs.readFile;

		vscode.workspace.fs.readFile = async () => Buffer.from('{"entityTypes": []}');
		assert.strictEqual(await isParsableL3File(vscode.Uri.file('/valid.json')), true);

		// This stays a plain parse check. The business-configuration gate applies to Add Config
		// only, so auto-discovery and restore must not start rejecting what they accepted before.
		vscode.workspace.fs.readFile = async () => Buffer.from('{}');
		assert.strictEqual(await isParsableL3File(vscode.Uri.file('/empty-object.json')), true);

		vscode.workspace.fs.readFile = async () => Buffer.from('{\n  // a comment\n  "entityTypes": [],\n}');
		assert.strictEqual(
			await isParsableL3File(vscode.Uri.file('/jsonc-with-comment.json')),
			false,
			'strict JSON only at adoption time — comments/trailing commas are for already-open documents being edited, not a new file being adopted as the source',
		);

		vscode.workspace.fs.readFile = async () => Buffer.from('not json at all {{{');
		assert.strictEqual(await isParsableL3File(vscode.Uri.file('/garbage.json')), false);

		vscode.workspace.fs.readFile = async () => { throw new Error('ENOENT'); };
		assert.strictEqual(await isParsableL3File(vscode.Uri.file('/missing.json')), false);

		vscode.workspace.fs.readFile = originalReadFile;
	}

	// --- isBusinessConfigFile: the Add Config gate ---------------------------

	{
		const originalReadFile = vscode.workspace.fs.readFile;
		const asFile = value => {
			vscode.workspace.fs.readFile = async () => Buffer.from(
				typeof value === 'string' ? value : JSON.stringify(value),
			);
			return isBusinessConfigFile(vscode.Uri.file('/repo/candidate.json'));
		};

		const valid = {
			uri: 'configuration',
			sources: [{ uri: 'configuration/sources/Reltio' }],
			entityTypes: [{ uri: 'configuration/entityTypes/Individual' }],
		};
		const accepted = [
			valid,
			// Empty sections still count as present: an L3 may legitimately declare a section it
			// has not populated yet, and this gate is a shape check, not schema validation.
			{ uri: 'configuration', sources: [], entityTypes: [] },
			// Extra sections and metadata are fine.
			{ ...valid, label: 'Tenant', attributeTypes: [], relationTypes: [] },
		];
		for (const body of accepted) {
			assert.strictEqual(await asFile(body), true, `expected acceptance for ${JSON.stringify(body)}`);
		}

		const rejected = [
			'not json at all {{{',
			// Permissions.json in a real repo: a top-level array whose rows carry configuration URIs.
			[{ uri: 'configuration/relationTypes', permissions: [] }],
			// Lookups.json in a real repo.
			{},
			null,
			'"configuration"',
			// The right sections but the wrong root uri.
			{ uri: 'configuration/entityTypes/Individual', sources: [], entityTypes: [] },
			{ sources: [], entityTypes: [] },
			// Root uri present, sections missing or the wrong type.
			{ uri: 'configuration' },
			{ uri: 'configuration', entityTypes: [] },
			{ uri: 'configuration', sources: [] },
			{ uri: 'configuration', sources: {}, entityTypes: [] },
			{ uri: 'configuration', sources: [], entityTypes: 'Individual' },
		];
		for (const body of rejected) {
			assert.strictEqual(await asFile(body), false, `expected rejection for ${JSON.stringify(body)}`);
		}

		// An unreadable file is refused rather than thrown out of the command.
		vscode.workspace.fs.readFile = async () => { throw new Error('EACCES'); };
		assert.strictEqual(await isBusinessConfigFile(vscode.Uri.file('/repo/gone.json')), false);

		vscode.workspace.fs.readFile = originalReadFile;
	}

	// --- gitSourceMarker: round-trip, gitignore side effect, fail-safe reads

	{
		const originalReadFile = vscode.workspace.fs.readFile;
		const originalWriteFile = vscode.workspace.fs.writeFile;
		const store = new Map();

		vscode.workspace.fs.readFile = async uri => {
			const bytes = store.get(uri.path);
			if (bytes === undefined) throw new Error('ENOENT');
			return bytes;
		};
		vscode.workspace.fs.writeFile = async (uri, bytes) => {
			store.set(uri.path, bytes);
		};

		const root = vscode.Uri.file('/repo2');
		const marker = { l3RelativePath: 'L3.reltio.json', environmentName: 'repo2', tenantId: 'default' };
		await writeGitSourceMarker(root, marker);

		const readBack = await readGitSourceMarker(root);
		assert.deepStrictEqual(readBack, marker);

		const gitignoreBytes = store.get('/repo2/.gitignore');
		assert.ok(gitignoreBytes, '.gitignore should have been created alongside the marker');
		assert.ok(
			Buffer.from(gitignoreBytes).toString('utf8').includes('.reltio-config-source.json'),
			'.gitignore should list the marker filename',
		);

		// Writing again must not duplicate the .gitignore entry.
		await writeGitSourceMarker(root, marker);
		const gitignoreLines = Buffer.from(store.get('/repo2/.gitignore')).toString('utf8').split(/\r?\n/);
		assert.strictEqual(gitignoreLines.filter(l => l.trim() === '.reltio-config-source.json').length, 1);

		store.set('/repo2/.reltio-config-source.json', Buffer.from('not json'));
		assert.strictEqual(await readGitSourceMarker(root), undefined, 'malformed marker JSON should fail closed');

		store.delete('/repo2/.reltio-config-source.json');
		assert.strictEqual(await readGitSourceMarker(root), undefined, 'missing marker file should fail closed');

		vscode.workspace.fs.readFile = originalReadFile;
		vscode.workspace.fs.writeFile = originalWriteFile;
	}

	// --- EnvironmentManager git-source override -----------------------------

	{
		const originalReadDirectory = vscode.workspace.fs.readDirectory;
		vscode.workspace.fs.readDirectory = async () => [];

		const workspaceRoot = vscode.Uri.file('/ws');
		const mgr = new EnvironmentManager(workspaceRoot);

		assert.deepStrictEqual(await mgr.scanEnvironments(), []);

		const l3Uri = vscode.Uri.file('/ws/L3.json');
		mgr.setGitSource({ environmentName: 'ws', tenantId: 'default', l3Uri });

		assert.deepStrictEqual(await mgr.scanEnvironments(), [
			{ name: 'ws', tenants: [{ tenantId: 'default', hasL3: true }] },
		]);
		assert.strictEqual(mgr.getL3Uri('ws', 'default').path, l3Uri.path);
		assert.strictEqual(mgr.getLayoutUri('ws', 'default').path, '/ws/L3.reltio.layout.json');

		// A non-matching environment/tenant pair falls through to the ordinary folder-convention path.
		const fallback = mgr.getL3Uri('other-env', 'other-tenant');
		assert.ok(fallback.path.includes('other-env.reltio.environment'));
		assert.ok(fallback.path.includes('other-tenant.reltio.tenant'));

		mgr.clearGitSource();
		assert.deepStrictEqual(await mgr.scanEnvironments(), []);

		vscode.workspace.fs.readDirectory = originalReadDirectory;
	}

	// --- Removing one config must not revoke git mode for the rest -----------

	{
		const originalReadDirectory = vscode.workspace.fs.readDirectory;
		vscode.workspace.fs.readDirectory = async () => [];

		const root = vscode.Uri.file('/repo/my-config-repo');
		const rootConfig = vscode.Uri.joinPath(root, 'L3.json');
		const nestedConfig = vscode.Uri.joinPath(root, 'DP', 'dp_lif', 'BusinessConfig.json');

		const mgr = new EnvironmentManager(root);
		const tokenStore = new TokenStore();
		const memento = { get: () => undefined, update: async () => undefined };
		const provider = new MultiTenantTreeProvider(mgr, tokenStore, memento, null);

		const sourcesFor = uris =>
			deriveTenantNamings(root, uris).map((n, i) => ({ ...n, l3Uri: uris[i] }));

		mgr.setGitSources(sourcesFor([rootConfig, nestedConfig]));
		tokenStore.setToken('my-config-repo', GIT_SOURCE_TOKEN);

		// The root call is what populates the provider's environment cache, so it has to run first.
		const envRows = await provider.getChildren();
		assert.strictEqual(envRows.length, 1);
		assert.ok(envRows[0] instanceof EnvironmentNode);
		assert.strictEqual(envRows[0].environmentName, 'my-config-repo');

		const rows = await provider.getChildren(envRows[0]);
		assert.deepStrictEqual(
			rows.map(r => [r.constructor.name, String(r.label)]),
			[['GitFolderNode', 'DP'], ['TenantNode', 'L3.json']],
			'git mode puts folder rows above the configs that sit at this level',
		);

		// Removing the root config leaves one source behind. Every source in a repository shares
		// one environment name, so the removal must not clear that environment's token: doing so
		// dropped the whole repository into flat tenant mode, losing the folder rows and asking
		// the user to sign in to a repository that needs no authentication.
		mgr.setGitSources(sourcesFor([nestedConfig]));
		tokenStore.setToken('my-config-repo', GIT_SOURCE_TOKEN);

		const afterRemoval = await provider.getChildren(envRows[0]);
		assert.strictEqual(afterRemoval.length, 1);
		assert.ok(afterRemoval[0] instanceof GitFolderNode, 'the surviving config keeps its folder row');
		assert.strictEqual(String(afterRemoval[0].label), 'DP');

		const leaf = await provider.getChildren(afterRemoval[0]);
		assert.deepStrictEqual(
			leaf.map(r => [r.constructor.name, String(r.label)]),
			[['TenantNode', 'dp_lif']],
			'a folder holding one config collapses onto that config row',
		);
		assert.strictEqual(
			leaf[0].isEnvironmentAuthorized,
			true,
			'the sentinel token keeps the row authorized',
		);
		assert.strictEqual(leaf[0].isStaleLocal, false);
		assert.ok(
			!String(leaf[0].description ?? '').includes('local'),
			'and it keeps the "(local)" suffix off a row whose file is the source of truth',
		);

		// The bug itself: without the token the same state renders flat and unauthorized.
		tokenStore.clearToken('my-config-repo');
		const collapsed = await provider.getChildren(envRows[0]);
		assert.ok(
			!collapsed.some(r => r instanceof GitFolderNode),
			'clearing the token is what collapsed the tree, so this guards the path that used to do it',
		);
		assert.ok(
			collapsed.every(r => r.isEnvironmentAuthorized === false),
			'and it is why the environment started asking the user to sign in',
		);
		assert.ok(
			collapsed.some(r => String(r.description ?? '').includes('local')),
			'and why the rows picked up a "(local)" suffix',
		);

		vscode.workspace.fs.readDirectory = originalReadDirectory;
	}

	console.log('test-git-repository-source: OK');
})().catch(err => {
	console.error(err);
	process.exit(1);
});
