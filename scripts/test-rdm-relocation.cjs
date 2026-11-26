#!/usr/bin/env node
'use strict';
/**
 * Area: RDM (src/workspace/rdmRelocation.ts, src/rdm/lookupLoadBridge.ts).
 *
 * Reliability checks for moving root-level RDM files into RDM/{id}/ and for the CSV bridge on
 * Windows paths. The base relocation cases (pair move, repeat, posix conflicts, a failing tenant
 * before a healthy one) are in test-rdm-component-folder.cjs; this script adds what that does
 * not assert.
 *
 * RDM-008  Relocation never overwrites; bridge accepts Windows path spellings.
 *          #4     Through the real vscode-backed filesystem (vscodeRelocationFs), every rename
 *                 passes overwrite: false.
 *          #6-#7  A baseline rename that throws after the config moved reports the tenant failed
 *                 once with the config at its new path; a rerun leaves the stray legacy baseline
 *                 where it is (pins current behavior; the owner may want different intent).
 *          #9-#10 With a Windows workspace root, csvFile and rdmConfigFile spelled with
 *                 backslashes, mixed separators and another drive-letter case resolve inside the
 *                 workspace, match rdmConfigUri, and the request reaches status planned.
 *          Removed as duplicates (test-rdm-component-folder.cjs runs the same code): #1-#3, an
 *          occupied config or baseline destination is a conflict with no rename and both legacy
 *          files kept (relocation never reads the path spelling, so Windows-style Uris reach the
 *          same code); #5, a second run does nothing; #8, a healthy tenant after a failing one
 *          still moves.
 *
 * The vscode stub keeps backslashes in Uri.path. For #9-#10 this script swaps in a Uri.file and
 * Uri.joinPath that behave as VS Code does on Windows (backslashes become "/", the drive letter
 * keeps its case in `path`), in this process only.
 *
 * Tier C (manual): relocation on a real workspace — design.md of rdm-component-folder.
 */
const assert = require('node:assert');
const { importDist } = require('./lib/import-dist.cjs');
const vscode = require('./lib/vscode-stub.cjs');

const { relocateRdmTargets, vscodeRelocationFs } = importDist('workspace/rdmRelocation');
const { handleLookupLoadRequest } = importDist('rdm/lookupLoadBridge');

const ROOT = 'C:\\ws\\dev\\T1';
const target = (id, root = ROOT) => ({
	label: `dev/T1: ${id}`,
	legacyConfig: vscode.Uri.file(`${root}\\RDM.${id}.reltio.json`),
	legacyBaseline: vscode.Uri.file(`${root}\\RDM.${id}.remote-baseline.reltio.json`),
	config: vscode.Uri.file(`${root}\\RDM\\${id}\\config.json`),
	configDir: vscode.Uri.file(`${root}\\RDM\\${id}`),
	baseline: vscode.Uri.file(`${root}\\.reltio-ide\\RDM\\${id}.baseline.json`),
	baselineDir: vscode.Uri.file(`${root}\\.reltio-ide\\RDM`),
});

/** In-memory filesystem keyed by fsPath; refuses to overwrite, as VS Code does with overwrite false. */
function memoryFs(existing) {
	const files = new Set(existing);
	const ops = [];
	return {
		files,
		ops,
		async exists(uri) {
			return files.has(uri.fsPath);
		},
		async createDirectory(uri) {
			ops.push(`mkdir ${uri.fsPath}`);
		},
		async rename(from, to) {
			if (files.has(to.fsPath)) throw new Error('would overwrite');
			files.delete(from.fsPath);
			files.add(to.fsPath);
			ops.push(`mv ${from.fsPath}`);
		},
	};
}

(async () => {
	const t = target('A');

	// ---------------------------------------------------------------------------
	// RDM-008 #4 — the real filesystem adapter never overwrites
	// ---------------------------------------------------------------------------
	{
		const files = new Set([t.legacyConfig.fsPath, t.legacyBaseline.fsPath]);
		const renames = [];
		const realFs = { ...vscode.workspace.fs };
		vscode.workspace.fs.stat = async uri => {
			if (!files.has(uri.fsPath)) throw new Error('ENOENT');
			return { type: vscode.FileType.File };
		};
		vscode.workspace.fs.createDirectory = async () => {};
		vscode.workspace.fs.rename = async (from, to, options) => {
			renames.push(options);
			files.delete(from.fsPath);
			files.add(to.fsPath);
		};
		try {
			const r = await relocateRdmTargets([t]);
			assert.deepStrictEqual(r.moved, ['dev/T1: A'], 'RDM-008 #4: the pair moves through the vscode filesystem');
			assert.strictEqual(renames.length, 2, 'RDM-008 #4: config and baseline are each renamed once');
			assert.ok(renames.every(o => o && o.overwrite === false), 'RDM-008 #4: every rename passes overwrite: false');
			assert.strictEqual(await vscodeRelocationFs.exists(t.config), true, 'RDM-008 #4: exists() reads stat');
		} finally {
			Object.assign(vscode.workspace.fs, realFs);
		}
	}

	// ---------------------------------------------------------------------------
	// RDM-008 #6-#7 — a failure between the two moves
	// ---------------------------------------------------------------------------
	{
		const bad = target('E');
		const good = target('F');
		const f = memoryFs([bad.legacyConfig.fsPath, bad.legacyBaseline.fsPath, good.legacyConfig.fsPath, good.legacyBaseline.fsPath]);
		const rename = f.rename;
		f.rename = async (from, to) => {
			if (from.fsPath === bad.legacyBaseline.fsPath) throw new Error('permission denied');
			return rename(from, to);
		};
		const r = await relocateRdmTargets([bad, good], f);
		assert.deepStrictEqual(r.failed, ['dev/T1: E'], 'RDM-008 #6: the mid-pair failure is reported once');
		assert.ok(f.files.has(bad.config.fsPath) && !f.files.has(bad.legacyConfig.fsPath), 'RDM-008 #6: the config is at its new path');

		f.rename = rename;
		const rerun = await relocateRdmTargets([bad, good], f);
		assert.deepStrictEqual(rerun, { moved: [], conflicts: [], failed: [] }, 'RDM-008 #7: a rerun reports nothing for the half-moved tenant');
		assert.ok(f.files.has(bad.legacyBaseline.fsPath) && !f.files.has(bad.baseline.fsPath),
			'RDM-008 #7: the stray legacy baseline is not moved on rerun (current behavior)');
	}

	// ---------------------------------------------------------------------------
	// RDM-008 #9-#10 — the bridge on Windows path spellings
	// ---------------------------------------------------------------------------
	const stubFile = vscode.Uri.file;
	const stubJoin = vscode.Uri.joinPath;
	const winFile = p => {
		const uri = stubFile(p.replace(/\\/g, '/'));
		uri.fsPath = p.replace(/\//g, '\\');
		return uri;
	};
	vscode.Uri.file = winFile;
	vscode.Uri.joinPath = (base, ...segments) => winFile([base.path.replace(/^\//, ''), ...segments.map(String)].join('/'));
	try {
		const ORG = 'rdm/lookupTypes/OrganizationStatuses';
		const csvText = `code,type,sourceMappings.source,sourceMappings.code,sourceMappings.value\nA,${ORG},SAP,A,Acquired`;
		const config = JSON.stringify({ lookupTypes: [{ uri: ORG }], sources: [{ uri: 'rdm/sources/SAP', abbreviation: 'SAP' }] });
		const workspaceRoot = vscode.Uri.file('C:\\Users\\dev\\ws');
		assert.strictEqual(workspaceRoot.path, '/C:/Users/dev/ws', 'RDM-008 #9: the Windows Uri stand-in behaves as VS Code does');
		const store = new Map([
			['/c:/users/dev/ws/dev/t1/rdm/rdmt/config.json', config],
			['/c:/users/dev/ws/data/sub/rdmt_lookups_1.csv', csvText],
		]);
		const key = uri => uri.path.toLowerCase();
		const deps = {
			workspaceRoot,
			isEnabled: () => true,
			isRepositoryMode: () => false,
			resolveTenant: async uri => (key(uri).startsWith('/c:/users/dev/ws/dev/t1/') ? { environmentName: 'dev', tenantId: 'T1' } : undefined),
			rdmConfigUri: (env, tenant, id) => vscode.Uri.file(`C:\\Users\\dev\\ws\\${env}\\${tenant}\\RDM\\${id}\\config.json`),
			getToken: () => 'TOKEN',
			tryRefresh: async () => false,
			resolveServiceUri: async () => 'https://rdm.reltio.com',
			approve: async () => true,
			readFile: async uri => {
				if (!store.has(key(uri))) throw new Error(`not found: ${uri.path}`);
				return new TextEncoder().encode(store.get(key(uri)));
			},
			statFile: async uri => {
				if (!store.has(key(uri))) throw new Error(`not found: ${uri.path}`);
				return { size: Buffer.byteLength(store.get(key(uri))) };
			},
			fetchValues: async () => [],
			postValues: async () => [],
		};
		for (const [csvFile, rdmConfigFile] of [
			['data\\sub\\RdmT_lookups_1.csv', 'dev\\T1\\RDM\\RdmT\\config.json'],
			['data/sub\\RdmT_lookups_1.csv', 'dev/T1\\RDM/RdmT\\config.json'],
			['c:\\users\\dev\\ws\\data\\sub\\RdmT_lookups_1.csv', 'c:\\Users\\dev\\ws\\dev\\T1\\RDM\\RdmT\\config.json'],
			['C:/Users/dev/ws/data/sub/RdmT_lookups_1.csv', 'c:/users/dev/ws/dev/T1/RDM/RdmT/config.json'],
		]) {
			const result = await handleLookupLoadRequest({ requestId: 'r1', mode: 'plan', csvFile, rdmConfigFile }, deps);
			const label = `${csvFile} + ${rdmConfigFile}`;
			assert.strictEqual(result.status, 'planned', `RDM-008 #9: ${label} reaches status planned (${result.message})`);
			assert.deepStrictEqual([result.tenant, result.rdmTenantId], [{ environment: 'dev', tenantId: 'T1' }, 'RdmT'],
				`RDM-008 #10: ${label} matches T1's configuration for RdmT`);
		}
	} finally {
		vscode.Uri.file = stubFile;
		vscode.Uri.joinPath = stubJoin;
	}

	console.log('test-rdm-relocation: OK');
})().catch(e => {
	console.error(e);
	process.exit(1);
});
