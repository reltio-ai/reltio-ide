'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const checker = path.join(__dirname, 'check-module-coverage.cjs');
const { areaOf, aggregate, evaluate } = require(checker);

let passed = 0;
function check(label, fn) {
	try {
		fn();
		passed++;
		console.log(`  ok - ${label}`);
	} catch (err) {
		console.error(`  FAIL - ${label}`);
		console.error(err);
		process.exit(1);
	}
}

const AREAS = [
	{ name: 'Workflows', patterns: ['workflow/**', 'tree/workflowNodes.ts', 'workspace/workflow*.ts'], floor: 0 },
	{ name: 'LCA', patterns: ['lca/**'], floor: 0 },
	{ name: 'Git Integration', patterns: ['workspace/gitSourceMarker.ts'], floor: 0 },
	{ name: 'Tenant Explorer & UX', patterns: ['tree/**'], floor: 0 },
	{ name: 'Extension Activation', patterns: ['extension.ts'], floor: 0 },
];
const oneArea = (floor, extra) => Object.assign({ target: 70, enforceTarget: false, areas: [{ name: 'A', patterns: ['a/**'], floor }] }, extra);
const res = (pct, unmapped) => ({ pct, unmapped: unmapped || [] });

check('areaOf: first match wins (workflow node in tree/ goes to Workflows)', () => {
	assert.strictEqual(areaOf('/p/src/tree/workflowNodes.ts', AREAS), 'Workflows');
	assert.strictEqual(areaOf('/p/src/tree/treeNodes.ts', AREAS), 'Tenant Explorer & UX');
});
check('areaOf: * pattern matches within one segment', () => {
	assert.strictEqual(areaOf('/p/src/workspace/workflowRepoSync.ts', AREAS), 'Workflows');
	assert.strictEqual(areaOf('/p/src/workspace/gitSourceMarker.ts', AREAS), 'Git Integration');
});
check('areaOf: * does not cross a slash', () => {
	assert.strictEqual(areaOf('/p/src/workspace/workflow/x.ts', AREAS), null);
});
check('areaOf handles Windows paths', () => {
	assert.strictEqual(areaOf('C:\\p\\src\\lca\\cloud.ts', AREAS), 'LCA');
});
check('areaOf: exact file in src root', () => {
	assert.strictEqual(areaOf('/p/src/extension.ts', AREAS), 'Extension Activation');
});
check('areaOf returns null outside src', () => {
	assert.strictEqual(areaOf('/p/scripts/a.cjs', AREAS), null);
});
check('areaOf strips up to the last src/', () => {
	assert.strictEqual(areaOf('/p/src/src/lca/x.ts', AREAS), 'LCA');
});
check('aggregate reports unmapped in-src file', () => {
	const r = aggregate({ '/p/src/brandNew/x.ts': { lines: { total: 4, covered: 2 } } }, AREAS);
	assert.deepStrictEqual(r.unmapped, ['/p/src/brandNew/x.ts']);
});
check('aggregate skips "total" and files outside src', () => {
	const r = aggregate({
		total: { lines: { total: 99, covered: 99 } },
		'/p/scripts/a.cjs': { lines: { total: 9, covered: 9 } },
	}, AREAS);
	assert.deepStrictEqual(r, { pct: {}, unmapped: [] });
});
check('aggregate sums covered/total across directories in one area', () => {
	const r = aggregate({
		'/p/src/workflow/a.ts': { lines: { total: 10, covered: 5 } },
		'/p/src/tree/workflowNodes.ts': { lines: { total: 10, covered: 10 } },
		'/p/src/workspace/workflowSync.ts': { lines: { total: 20, covered: 10 } },
		'/p/src/lca/x.ts': { lines: { total: 4, covered: 4 } },
	}, AREAS);
	assert.deepStrictEqual(r.pct, { Workflows: 62.5, LCA: 100 });
	assert.deepStrictEqual(r.unmapped, []);
});
check('below target with floor met warns only', () => {
	const r = evaluate(res({ A: 60 }), oneArea(55));
	assert.strictEqual(r.failures.length, 0);
	assert.strictEqual(r.warnings.length, 1);
	assert.ok(r.warnings[0].includes('A'));
});
check('below floor fails', () => {
	const r = evaluate(res({ A: 60 }), oneArea(65));
	assert.strictEqual(r.failures.length, 1);
});
check('enforceTarget fails below target', () => {
	const r = evaluate(res({ A: 60 }), oneArea(55, { enforceTarget: true }));
	assert.ok(r.failures.length >= 1);
});
check('unmapped file fails and is named', () => {
	const r = evaluate(res({ A: 90 }, ['/p/src/brandNew/x.ts']), oneArea(0));
	assert.ok(r.failures.some((f) => f.includes('/p/src/brandNew/x.ts')));
});
check('area with no measured files fails closed', () => {
	const r = evaluate(res({}), oneArea(0));
	assert.ok(r.failures.some((f) => f.includes('A')));
});
check('CLI exits 1 when coverage summary is missing', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'modcov-'));
	try {
		const r = spawnSync(process.execPath, [checker], { cwd: tmp, encoding: 'utf8' });
		assert.strictEqual(r.status, 1);
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

console.log(`module-coverage-check: ${passed} checks passed`);
