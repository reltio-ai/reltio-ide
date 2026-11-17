'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = path.join(__dirname, 'module-coverage.config.json');

// Path relative to src/, or null when the file is not under src/.
function relToSrc(file) {
	const norm = String(file).replace(/\\/g, '/');
	const m = /^(?:.*\/)?src\/(.+)$/.exec(norm); // greedy: last src/
	return m ? m[1] : null;
}

function patternMatches(pattern, rel) {
	if (pattern.endsWith('/**')) {
		return rel.startsWith(pattern.slice(0, -2));
	}
	if (pattern.includes('*')) {
		const re = pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
		return new RegExp(`^${re}$`).test(rel);
	}
	return pattern === rel;
}

// Returns the first matching area's name, or null (outside src/ or unmapped).
function areaOf(file, areas) {
	const rel = relToSrc(file);
	if (rel === null) { return null; }
	for (const area of areas) {
		if (area.patterns.some((p) => patternMatches(p, rel))) { return area.name; }
	}
	return null;
}

function aggregate(summary, areas) {
	const sums = {};
	const unmapped = [];
	for (const [file, entry] of Object.entries(summary)) {
		if (file === 'total') { continue; }
		if (relToSrc(file) === null) { continue; }
		const name = areaOf(file, areas);
		if (name === null) { unmapped.push(file); continue; }
		const s = sums[name] || (sums[name] = { total: 0, covered: 0 });
		s.total += entry.lines.total;
		s.covered += entry.lines.covered;
	}
	const pct = {};
	for (const [name, s] of Object.entries(sums)) {
		pct[name] = s.total === 0 ? 0 : (s.covered / s.total) * 100;
	}
	return { pct, unmapped };
}

function evaluate(result, config) {
	const failures = [];
	const warnings = [];
	const { pct, unmapped } = result;
	for (const file of unmapped) {
		failures.push(`${file}: file under src/ is not mapped to any area in module-coverage.config.json`);
	}
	for (const area of config.areas || []) {
		if (!(area.name in pct)) {
			failures.push(`${area.name}: configured but no files measured (missing from coverage summary)`);
			continue;
		}
		const value = pct[area.name];
		if (value < area.floor) {
			failures.push(`${area.name}: ${value.toFixed(1)}% is below floor ${area.floor}%`);
		}
		if (value < config.target) {
			const msg = `${area.name}: ${value.toFixed(1)}% is below target ${config.target}%`;
			if (config.enforceTarget) { failures.push(msg); } else { warnings.push(msg); }
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
	const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
	const result = aggregate(JSON.parse(fs.readFileSync(summaryPath, 'utf8')), config.areas || []);

	if (process.argv.includes('--write-baseline')) {
		for (const area of config.areas) {
			if (area.name in result.pct) {
				area.floor = Math.max(0, Math.floor(result.pct[area.name]) - 2);
			}
		}
		fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, '\t') + '\n');
		console.log(`Wrote baseline floors to ${CONFIG_PATH}`);
	}

	const { failures, warnings } = evaluate(result, config);
	console.log('area'.padEnd(26) + 'line %'.padStart(8) + 'floor'.padStart(8) + 'target'.padStart(8));
	for (const area of config.areas) {
		const p = area.name in result.pct ? result.pct[area.name].toFixed(1) : 'n/a';
		console.log(area.name.padEnd(26) + p.padStart(8) + String(area.floor).padStart(8) + String(config.target).padStart(8));
	}
	for (const w of warnings) { console.warn(`WARN ${w}`); }
	for (const f of failures) { console.error(`FAIL ${f}`); }
	process.exit(failures.length > 0 ? 1 : 0);
}

module.exports = { areaOf, aggregate, evaluate };

if (require.main === module) {
	main();
}
