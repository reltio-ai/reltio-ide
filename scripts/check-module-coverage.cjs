'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = path.join(__dirname, 'module-coverage.config.json');

function moduleOf(file) {
	const norm = String(file).replace(/\\/g, '/');
	const m = /(?:^|\/)src\/(.+)$/.exec(norm);
	if (!m) { return null; }
	const rest = m[1];
	const slash = rest.indexOf('/');
	return slash === -1 ? '(root)' : rest.slice(0, slash);
}

function aggregate(summary) {
	const sums = {};
	for (const [file, entry] of Object.entries(summary)) {
		if (file === 'total') { continue; }
		const mod = moduleOf(file);
		if (mod === null) { continue; }
		const s = sums[mod] || (sums[mod] = { total: 0, covered: 0 });
		s.total += entry.lines.total;
		s.covered += entry.lines.covered;
	}
	const pct = {};
	for (const [mod, s] of Object.entries(sums)) {
		pct[mod] = s.total === 0 ? 0 : (s.covered / s.total) * 100;
	}
	return pct;
}

function evaluate(pct, config) {
	const failures = [];
	const warnings = [];
	const modules = config.modules || {};
	for (const [mod, value] of Object.entries(pct)) {
		const entry = modules[mod];
		if (!entry) {
			failures.push(`${mod}: measured (${value.toFixed(1)}%) but has no entry in module-coverage.config.json`);
			continue;
		}
		if (value < entry.floor) {
			failures.push(`${mod}: ${value.toFixed(1)}% is below floor ${entry.floor}%`);
		}
		if (value < config.target) {
			const msg = `${mod}: ${value.toFixed(1)}% is below target ${config.target}%`;
			if (config.enforceTarget) { failures.push(msg); } else { warnings.push(msg); }
		}
	}
	for (const mod of Object.keys(modules)) {
		if (!(mod in pct)) {
			failures.push(`${mod}: configured but not measured (missing from coverage summary)`);
		}
	}
	return { failures, warnings };
}

function main() {
	const summaryPath = path.join(process.cwd(), 'coverage', 'coverage-summary.json');
	if (!fs.existsSync(summaryPath)) {
		console.error(`Coverage summary not found: ${summaryPath}. Run c8 over the unit tests first.`);
		process.exit(1);
	}
	const pct = aggregate(JSON.parse(fs.readFileSync(summaryPath, 'utf8')));
	const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

	if (process.argv.includes('--write-baseline')) {
		config.modules = {};
		for (const mod of Object.keys(pct).sort()) {
			config.modules[mod] = { floor: Math.max(0, Math.floor(pct[mod]) - 2) };
		}
		fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, '\t') + '\n');
		console.log(`Wrote baseline floors to ${CONFIG_PATH}`);
	}

	const { failures, warnings } = evaluate(pct, config);
	const names = Array.from(new Set([...Object.keys(pct), ...Object.keys(config.modules || {})])).sort();
	console.log('module'.padEnd(16) + 'line %'.padStart(8) + 'floor'.padStart(8) + 'target'.padStart(8));
	for (const mod of names) {
		const p = mod in pct ? pct[mod].toFixed(1) : 'n/a';
		const f = config.modules && config.modules[mod] ? String(config.modules[mod].floor) : '-';
		console.log(mod.padEnd(16) + p.padStart(8) + f.padStart(8) + String(config.target).padStart(8));
	}
	for (const w of warnings) { console.warn(`WARN ${w}`); }
	for (const f of failures) { console.error(`FAIL ${f}`); }
	process.exit(failures.length > 0 ? 1 : 0);
}

module.exports = { moduleOf, aggregate, evaluate };

if (require.main === module) {
	main();
}
