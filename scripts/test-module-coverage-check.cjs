'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const checker = path.join(__dirname, 'check-module-coverage.cjs');
const { moduleOf, aggregate, evaluate } = require(checker);

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

const cfg = (floor, extra) => Object.assign({ target: 70, enforceTarget: false, modules: { api: { floor } } }, extra);

check('moduleOf handles Windows paths', () => {
	assert.strictEqual(moduleOf('C:\\p\\src\\api\\x.ts'), 'api');
});
check('moduleOf maps files directly in src to (root)', () => {
	assert.strictEqual(moduleOf('/p/src/extension.ts'), '(root)');
});
check('moduleOf returns null outside src', () => {
	assert.strictEqual(moduleOf('/p/scripts/a.cjs'), null);
});
check('aggregate sums covered/total per module', () => {
	const summary = {
		total: { lines: { total: 99, covered: 99 } },
		'/p/src/api/a.ts': { lines: { total: 10, covered: 5 } },
		'/p/src/api/b.ts': { lines: { total: 10, covered: 10 } },
	};
	assert.deepStrictEqual(aggregate(summary), { api: 75 });
});
check('below target with floor met warns only', () => {
	const r = evaluate({ api: 60 }, cfg(55));
	assert.strictEqual(r.failures.length, 0);
	assert.strictEqual(r.warnings.length, 1);
	assert.ok(r.warnings[0].includes('api'));
});
check('below floor fails', () => {
	const r = evaluate({ api: 60 }, cfg(65));
	assert.strictEqual(r.failures.length, 1);
});
check('measured module without config entry fails', () => {
	const r = evaluate({ api: 60, util: 90 }, cfg(55));
	assert.ok(r.failures.some((f) => f.includes('util')));
});
check('configured module not measured fails closed', () => {
	const r = evaluate({}, cfg(55));
	assert.ok(r.failures.some((f) => f.includes('api')));
});
check('enforceTarget fails below target', () => {
	const r = evaluate({ api: 60 }, cfg(55, { enforceTarget: true }));
	assert.ok(r.failures.length >= 1);
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
