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
} = importDist('workspace/l3Discovery');
const { isFolderEmpty, isPathContainedIn } = importDist('workspace/gitConfigSource');
const { readGitSourceMarker, writeGitSourceMarker } = importDist('workspace/gitSourceMarker');
const { EnvironmentManager } = importDist('workspace/environmentManager');

(async () => {
	// --- deriveTenantNaming -------------------------------------------------

	{
		const root = vscode.Uri.file('/repo/my-config-repo');

		// A config at the repository root has no folder to borrow a name from.
		const rootL3 = vscode.Uri.joinPath(root, 'BusinessConfig.json');
		const atRoot = deriveTenantNaming(root, rootL3, [rootL3]);
		assert.strictEqual(atRoot.environmentName, 'my-config-repo');
		assert.strictEqual(atRoot.tenantId, 'my-config-repo');
		assert.deepStrictEqual(atRoot.folders, []);

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
		const ids = deriveTenantNamings(root, [clashA, clashB, lonely]).map(x => x.tenantId);
		assert.deepStrictEqual(ids, ['shared (DP/shared)', 'shared (MDM/shared)', 'unique']);
		assert.strictEqual(new Set(ids).size, ids.length, 'tenantIds must be unique');
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

	console.log('test-git-repository-source: OK');
})().catch(err => {
	console.error(err);
	process.exit(1);
});
