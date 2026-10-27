#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: rdm-component-folder
 * Tier A: RDM paths resolve into the component tree and IDE state; relocation of root-level RDM
 *         files is a pair-wise move that repeats harmlessly and never overwrites; enumeration
 *         counts only RDM/ subfolders holding config.json.
 * Tier B: the schema binding follows the files; the RDM path pieces are declared in the layout
 *         module; the layout's managed model is untouched; every Business Config write path
 *         continues into RDM.
 * Tier C (manual): sign-in / Add Tenant fetch RDM, baselines absent from git status, relocation
 *         on a real workspace — see design.md Test plan.
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');
const vscode = require('./lib/vscode-stub.cjs');

const repoRoot = path.join(__dirname, '..');
const readJson = p => JSON.parse(fs.readFileSync(path.join(repoRoot, p), 'utf8'));

const layout = importDist('workspace/tenantFolderStructure');
const { relocateRdmTargets } = importDist('workspace/rdmRelocation');
const { EnvironmentManager, rdmFileName } = importDist('workspace/environmentManager');

(async () => {
	// ---------------------------------------------------------------------------
	// Tier A — where RDM lives
	// ---------------------------------------------------------------------------

	assert.strictEqual(layout.RDM_DIR, 'RDM');
	assert.strictEqual(layout.rdmConfigPath('RdmX'), 'RDM/RdmX/config.json');
	assert.strictEqual(layout.rdmBaselinePath('RdmX'), '.reltio-ide/RDM/RdmX.baseline.json');

	// The baseline must sit under the IDE working-state folder, which the layout's generated
	// gitignore already excludes — that is what keeps it out of a pull request.
	assert.ok(
		layout.rdmBaselinePath('RdmX').startsWith(`${layout.IDE_STATE_DIR}/`),
		'RDM baselines live under .reltio-ide/',
	);
	assert.ok(
		!layout.rdmConfigPath('RdmX').startsWith(`${layout.IDE_STATE_DIR}/`),
		'RDM configurations are tracked, not IDE state',
	);

	// What the drift warning shows is the real location.
	assert.strictEqual(rdmFileName('RdmX'), 'RDM/RdmX/config.json');

	// ---------------------------------------------------------------------------
	// Tier A — relocation over an in-memory filesystem
	// ---------------------------------------------------------------------------

	const fakeFs = existing => {
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
				ops.push(`mv ${from.fsPath} -> ${to.fsPath}`);
			},
		};
	};

	const root = '/ws/dev/T1';
	const target = id => ({
		label: `dev/T1: ${id}`,
		legacyConfig: vscode.Uri.file(`${root}/RDM.${id}.reltio.json`),
		legacyBaseline: vscode.Uri.file(`${root}/RDM.${id}.remote-baseline.reltio.json`),
		config: vscode.Uri.file(`${root}/RDM/${id}/config.json`),
		configDir: vscode.Uri.file(`${root}/RDM/${id}`),
		baseline: vscode.Uri.file(`${root}/.reltio-ide/RDM/${id}.baseline.json`),
		baselineDir: vscode.Uri.file(`${root}/.reltio-ide/RDM`),
	});

	// Legacy configuration and baseline both move into the tree.
	{
		const f = fakeFs([`${root}/RDM.A.reltio.json`, `${root}/RDM.A.remote-baseline.reltio.json`]);
		const r = await relocateRdmTargets([target('A')], f);
		assert.deepStrictEqual(r, { moved: ['dev/T1: A'], conflicts: [], failed: [] });
		assert.ok(f.files.has(`${root}/RDM/A/config.json`), 'configuration relocated');
		assert.ok(f.files.has(`${root}/.reltio-ide/RDM/A.baseline.json`), 'baseline relocated');
		assert.ok(!f.files.has(`${root}/RDM.A.reltio.json`), 'nothing left at the root');
		assert.ok(!f.files.has(`${root}/RDM.A.remote-baseline.reltio.json`));

		// Repeating is a no-op: nothing is created, moved or reported.
		const before = f.ops.length;
		const again = await relocateRdmTargets([target('A')], f);
		assert.deepStrictEqual(again, { moved: [], conflicts: [], failed: [] });
		assert.strictEqual(f.ops.length, before, 'a second run touches nothing');
	}

	// A configuration without a baseline still moves.
	{
		const f = fakeFs([`${root}/RDM.B.reltio.json`]);
		const r = await relocateRdmTargets([target('B')], f);
		assert.deepStrictEqual(r.moved, ['dev/T1: B']);
		assert.ok(f.files.has(`${root}/RDM/B/config.json`));
	}

	// An occupied configuration destination leaves BOTH files where they are.
	{
		const existing = [
			`${root}/RDM.C.reltio.json`,
			`${root}/RDM.C.remote-baseline.reltio.json`,
			`${root}/RDM/C/config.json`,
		];
		const f = fakeFs(existing);
		const r = await relocateRdmTargets([target('C')], f);
		assert.deepStrictEqual(r, { moved: [], conflicts: ['dev/T1: C'], failed: [] });
		assert.deepStrictEqual([...f.files].sort(), [...existing].sort(), 'nothing moved, nothing overwritten');
		assert.ok(!f.ops.some(o => o.startsWith('mv')), 'no rename attempted');
	}

	// An occupied baseline destination also leaves both: a baseline beside content it never
	// snapshotted would make the drift guard report changes that do not exist.
	{
		const existing = [
			`${root}/RDM.D.reltio.json`,
			`${root}/RDM.D.remote-baseline.reltio.json`,
			`${root}/.reltio-ide/RDM/D.baseline.json`,
		];
		const f = fakeFs(existing);
		const r = await relocateRdmTargets([target('D')], f);
		assert.deepStrictEqual(r.conflicts, ['dev/T1: D']);
		assert.deepStrictEqual([...f.files].sort(), [...existing].sort());
	}

	// A failing move is recorded and does not stop the next tenant.
	{
		const f = fakeFs([`${root}/RDM.E.reltio.json`, `${root}/RDM.F.reltio.json`]);
		const realRename = f.rename;
		f.rename = async (from, to) => {
			if (from.fsPath.includes('RDM.E.')) throw new Error('permission denied');
			return realRename(from, to);
		};
		const r = await relocateRdmTargets([target('E'), target('F')], f);
		assert.deepStrictEqual(r.failed, ['dev/T1: E']);
		assert.deepStrictEqual(r.moved, ['dev/T1: F'], 'the next tenant still relocates');
	}

	// ---------------------------------------------------------------------------
	// Tier A — enumeration counts only RDM/ subfolders holding config.json
	// ---------------------------------------------------------------------------

	vscode.workspace.fs.readDirectory = async uri => {
		if (uri.path.endsWith('/RDM')) {
			return [
				['README.md', vscode.FileType.File], // the layout's generated placeholder
				['stray.json', vscode.FileType.File],
				['RdmA', vscode.FileType.Directory],
				['Empty', vscode.FileType.Directory], // no config.json inside
				['RdmB', vscode.FileType.Directory],
			];
		}
		return [];
	};
	vscode.workspace.fs.stat = async uri => {
		if (/\/RDM\/(RdmA|RdmB)\/config\.json$/.test(uri.path)) return { type: vscode.FileType.File };
		throw new Error('ENOENT');
	};
	const mgr = new EnvironmentManager(vscode.Uri.file('/ws'));
	assert.deepStrictEqual(
		await mgr.listRdmTenantIds('dev', 'T1'),
		['RdmA', 'RdmB'],
		'only subfolders with config.json are RDM tenants; files and empty folders are not',
	);

	// No RDM folder at all means no RDM tenants, not an error.
	vscode.workspace.fs.readDirectory = async () => {
		throw new Error('ENOENT');
	};
	assert.deepStrictEqual(await mgr.listRdmTenantIds('dev', 'T1'), []);

	// ---------------------------------------------------------------------------
	// Tier B — manifest, layout model, and wiring
	// ---------------------------------------------------------------------------

	const pkg = readJson('package.json');
	const bindings = pkg.contributes.jsonValidation;
	const asArray = v => (Array.isArray(v) ? v : [v]);

	const rdmBinding = bindings.find(b => b.url === './schemas/reltio-rdm.schema.json');
	assert.ok(rdmBinding, 'the RDM schema is bound');
	const rdmPatterns = asArray(rdmBinding.fileMatch);
	assert.ok(rdmPatterns.includes('**/RDM/*/config.json'), 'the binding follows the files into RDM/');
	assert.ok(rdmPatterns.includes('RDM.*.reltio.json'), 'unrelocated legacy files stay validated');
	assert.ok(!rdmPatterns.includes('config.json') && !rdmPatterns.includes('**/config.json'),
		'config.json is too common a name to bind on its own');

	const l3Binding = bindings.find(b => b.url === './schemas/reltio-metadata.schema.json');
	assert.ok(asArray(l3Binding.fileMatch).includes('!RDM.*.reltio.json'), 'legacy RDM files stay out of the L3 schema');

	// The layout's managed model is deliberately untouched (design D6): RDM keeps its README so
	// the folder survives in git for tenants with no RDM configured.
	const managed = layout.COMPONENT_FOLDERS.filter(f => f.managed).map(f => f.path);
	assert.deepStrictEqual(managed, [layout.BUSINESS_CONFIG_DIR], 'only Business Config is managed');
	assert.ok(
		layout.unmanagedFolders().some(f => f.path === layout.RDM_DIR),
		'RDM keeps its README placeholder',
	);

	// Every flow that connects a tenant continues into RDM.
	//
	// The Setup Wizard and Apply default environments receive the Business Config writer as a
	// callback rather than calling it here, which is how the wizard once connected tenants with no
	// RDM. So this guards the hand-off itself: no connect flow may receive the bare writer.
	const ext = fs.readFileSync(path.join(repoRoot, 'src', 'extension.ts'), 'utf8');
	// Drop whole comment lines rather than regex-stripping block comments: a glob string
	// such as '**/*.reltio.json' contains '/*' and would swallow real code up to the next '*/'.
	const code = ext.split('\n').filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');

	assert.ok(
		/writeL3FromApi:\s*connectTenantConfiguration\b/.test(code),
		'the Setup Wizard is handed the connect wrapper',
	);
	assert.ok(
		/writeL3FromApi:\s*fetchL3\s*\?\s*connectTenantConfiguration\s*:\s*undefined/.test(code),
		'Apply default environments is handed the connect wrapper',
	);
	assert.ok(
		!/\bwriteL3FromApi\s*[,}]/.test(code) && !/[:?]\s*writeL3FromApi\b/.test(code),
		'no dependency object hands over the bare Business Config writer',
	);

	// Sign-in auto-add and Add Tenant connect through the wrapper too.
	const wrapperCalls = code.match(/\bconnectTenantConfiguration\(/g) || [];
	assert.ok(wrapperCalls.length >= 2, 'sign-in and Add Tenant call the connect wrapper');

	// The bare writer is called in exactly two places: inside the wrapper, and by Get
	// Configuration, whose drift guard sits between the Business Config and RDM steps.
	const bareCalls = code.match(/\bwriteL3FromApi\(/g) || [];
	assert.strictEqual(bareCalls.length, 3, 'definition + wrapper + Get Configuration, nothing else');

	// The wrapper continues into RDM only after the Business Config was written, and returns
	// the Business Config result so callers keep reporting L3 outcomes as before.
	const wrapper = code.slice(code.indexOf('async function connectTenantConfiguration('));
	const body = wrapper.slice(0, wrapper.indexOf('\n\t}\n'));
	assert.ok(
		/if \(result === 'written'\)\s*\{\s*void fetchRdmForTenant\(/.test(body),
		'RDM starts only after a successful Business Config write',
	);
	assert.ok(/return result;/.test(body), 'the Business Config result is returned unchanged');

	console.log('test-rdm-component-folder: OK');
})().catch(e => {
	console.error(e);
	process.exit(1);
});
