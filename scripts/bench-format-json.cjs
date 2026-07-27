#!/usr/bin/env node
/**
 * Benchmark jsonc-parser format+applyEdits vs JSON.parse+stringify on sample configs.
 * Run from repo root: node scripts/bench-format-json.cjs
 */
const fs = require('fs');
const path = require('path');
const { format, applyEdits } = require('jsonc-parser');

const jsoncOpts = {
	tabSize: 2,
	insertSpaces: true,
	eol: '\n',
	insertFinalNewline: true,
};

function prettyJsonc(text) {
	const t = text.replace(/^\uFEFF/, '').trimEnd();
	if (!t.trim()) return text;
	return applyEdits(t, format(t, undefined, jsoncOpts));
}

function prettyStringify(text) {
	const t = text.trim();
	return `${JSON.stringify(JSON.parse(t), null, 2)}\n`;
}

function bench(name, fn, text, iterations) {
	const t0 = process.hrtime.bigint();
	for (let i = 0; i < iterations; i++) fn(text);
	const ms = Number(process.hrtime.bigint() - t0) / 1e6;
	return { totalMs: ms, perMs: ms / iterations };
}

const root = path.join(__dirname, '..');
const files = [
	'samples/example.reltio.json',
	'samples/ppl-example.reltio.json',
	'samples/geu-tst-01.reltio.com.reltio.environment/householddemo.reltio.tenant/L3.reltio.json',
	'samples/r360.reltio.json',
];

console.log('Format benchmark (warm filesystem cache; Node', process.version + ')\n');

for (const rel of files) {
	const p = path.join(root, rel);
	if (!fs.existsSync(p)) {
		console.log(rel, '— skip (missing)\n');
		continue;
	}
	const text = fs.readFileSync(p, 'utf8');
	const bytes = Buffer.byteLength(text, 'utf8');
	// jsonc `format` is very slow on large, already-indented JSON — keep iterations low.
	const jsoncIters = bytes > 500_000 ? 1 : bytes > 100_000 ? 3 : 50;
	const strIters = bytes > 1_500_000 ? 5 : bytes > 500_000 ? 15 : 50;

	let stringifyOk = true;
	let stringifyErr = '';
	try {
		JSON.parse(text.trim());
	} catch (e) {
		stringifyOk = false;
		stringifyErr = e.message;
	}

	const jsonc = bench('jsonc', prettyJsonc, text, jsoncIters);
	let str = { totalMs: 0, perMs: 0 };
	if (stringifyOk) {
		try {
			str = bench('str', prettyStringify, text, strIters);
		} catch (e) {
			stringifyOk = false;
			stringifyErr = e.message;
		}
	}

	console.log(`${rel}`);
	console.log(
		`  size: ${bytes.toLocaleString()} bytes, iterations: jsonc=${jsoncIters}, stringify=${strIters}`,
	);
	console.log(`  jsonc-parser format+applyEdits: ${jsonc.perMs.toFixed(2)} ms/iter (total ${jsonc.totalMs.toFixed(1)} ms)`);
	if (stringifyOk) {
		console.log(`  JSON.parse + stringify:       ${str.perMs.toFixed(2)} ms/iter (total ${str.totalMs.toFixed(1)} ms)`);
		console.log(`  ratio (jsonc / stringify):    ${(jsonc.perMs / str.perMs).toFixed(2)}x`);
	} else {
		console.log(`  JSON.parse + stringify:       N/A (${stringifyErr})`);
	}
	console.log('');
}
