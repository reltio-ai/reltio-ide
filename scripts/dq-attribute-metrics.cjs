#!/usr/bin/env node
/**
 * Read-only fill rate + uniqueness for chosen attributes of one entity type.
 *
 *   $env:RELTIO_TOKEN = '<bearer token>'   (or --token-file <path>)
 *   node scripts/dq-attribute-metrics.cjs --host https://test.reltio.com --tenant <id> \
 *     [--type Contact,Individual | --entity <entityId>] [--attrs Email,Phone.Number | --rule-attrs] \
 *     [--out <dir>/dq-attribute-metrics.json] [--concurrency 6] [--max-profiles 200000] [--page 100]
 *
 * Without --type or --entity, every entity type in the tenant is measured. Without --attrs,
 * every leaf attribute of each type is measured; --rule-attrs limits it to match-group keys.
 * With --out, a CSV with the same rows is written beside the JSON.
 *
 * --source dq (default): dataQuality/statistic, the figures the Console DQ screen shows.
 * --source scan: entities/_total with options=searchByOv for fill, entities/_scan over
 * OV values (trim + lowercase) for uniqueness and top values.
 * Never writes to the tenant.
 */
'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
	const out = {};
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith('--')) continue;
		const key = a.slice(2);
		const next = argv[i + 1];
		if (next === undefined || next.startsWith('--')) out[key] = true;
		else { out[key] = next; i++; }
	}
	return out;
}

const args = parseArgs(process.argv);
const rawToken = args['token-file']
	? fs.readFileSync(args['token-file'], 'utf8')
	: process.env.RELTIO_TOKEN || '';
const token = rawToken.trim().replace(/^Bearer\s+/i, '').replace(/^["'<]+|["'>]+$/g, '').trim();
const host = String(args.host || '').replace(/\/+$/, '').replace(/^http:\/\/(?!127\.0\.0\.1|localhost)/, 'https://');
const tenant = args.tenant;
let attrs = String(args.attrs || '').split(',').map(s => s.trim()).filter(Boolean);
const maxProfiles = Number(args['max-profiles'] || 200000);
const pageSize = Number(args.page || 100);
const topN = 10;
const source = args.source === 'scan' ? 'scan' : 'dq';

const concurrency = Number(args.concurrency || 6);

if (!token || !host || !tenant) {
	console.error('Usage: set RELTIO_TOKEN or --token-file, then --host <url> --tenant <id> [--type A,B | --entity <id>] [--attrs A,B.C | --rule-attrs] [--out file.json]');
	process.exit(2);
}

const api = `${host}/reltio/api/${encodeURIComponent(tenant)}`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
let typeUri;
let typeFilter;

async function call(url, init) {
	const res = await fetch(url, { headers, ...init });
	const text = await res.text();
	if (res.status === 401) {
		let reason = '';
		try { reason = JSON.parse(text).error || ''; } catch { /* non-JSON body */ }
		throw new Error(`401 Unauthorized (${reason || 'no reason'}) — token expired, not an API token, or wrong environment`);
	}
	if (!res.ok) throw new Error(`HTTP ${res.status} ${url.split('?')[0]}: ${text.slice(0, 300)}`);
	return text ? JSON.parse(text) : null;
}

async function total(filter) {
	const q = new URLSearchParams({ filter, options: 'searchByOv' });
	const data = await call(`${api}/entities/_total?${q}`, { method: 'GET' });
	if (typeof data === 'number') return data;
	return Number(data.total);
}

/** OV leaf values for a dotted path like Phone.Number, walking nested attribute values. */
function ovValues(attributes, dottedPath) {
	const parts = dottedPath.split('.');
	let level = [{ value: attributes, ov: true }];
	for (const part of parts) {
		const next = [];
		for (const node of level) {
			if (node.ov === false || !node.value || typeof node.value !== 'object') continue;
			const vals = node.value[part];
			if (Array.isArray(vals)) next.push(...vals);
		}
		level = next;
	}
	return level
		.filter(v => v && v.ov !== false && v.value != null && typeof v.value !== 'object')
		.map(v => String(v.value).trim().toLowerCase())
		.filter(Boolean);
}

async function scan(onEntity) {
	const top = [...new Set(attrs.map(a => a.split('.')[0]))];
	const select = ['uri', ...top.map(a => `attributes.${a}`)].join(',');
	const q = new URLSearchParams({ filter: typeFilter, select, max: String(pageSize), options: 'searchByOv' });
	let cursor;
	let seen = 0;
	for (;;) {
		const body = cursor ? JSON.stringify({ cursor }) : '{}';
		const data = await call(`${api}/entities/_scan?${q}`, { method: 'POST', body });
		const objects = Array.isArray(data?.objects) ? data.objects : [];
		if (objects.length === 0) return { seen, capped: false };
		for (const e of objects) {
			onEntity(e);
			if (++seen >= maxProfiles) return { seen, capped: true };
		}
		process.stderr.write(`\r  scanned ${seen} profiles`);
		cursor = data.cursor;
		if (!cursor) return { seen, capped: false };
	}
}

/** configuration/entityTypes/T/attributes/Phone/attributes/Number -> Phone.Number */
function dottedPath(attrUri) {
	return attrUri.split('/attributes/').slice(1).join('.');
}

function matchGroupAttributes(et) {
	const prefix = `${et.uri}/attributes/`;
	const uris = new Set();
	const walk = node => {
		if (typeof node === 'string') {
			if (node.startsWith(prefix)) uris.add(node);
		} else if (Array.isArray(node)) node.forEach(walk);
		else if (node && typeof node === 'object') Object.values(node).forEach(walk);
	};
	walk(et.matchGroups || []);
	return [...uris].map(dottedPath).filter(Boolean).sort();
}

/** Every leaf attribute as { path, label }; nested attributes contribute their sub-attributes. */
function leafAttributes(list, prefix = '', labelPrefix = '') {
	const out = [];
	for (const a of list) {
		if (!a || !a.name) continue;
		const p = prefix ? `${prefix}.${a.name}` : a.name;
		const label = labelPrefix ? `${labelPrefix} > ${a.label || a.name}` : a.label || a.name;
		const children = Array.isArray(a.attributes) ? a.attributes : [];
		if (children.length > 0) out.push(...leafAttributes(children, p, label));
		else out.push({ path: p, label });
	}
	return out;
}

function toTypeUri(name) {
	return name.startsWith('configuration/') ? name : `configuration/entityTypes/${name}`;
}

/** Which entity types to measure: --type A,B | --entity <id> | (default) every type in the tenant. */
async function selectedTypes(config) {
	const all = (config.entityTypes || []).filter(t => t.uri && !t.abstract);
	if (args.type) {
		const wanted = String(args.type).split(',').map(s => toTypeUri(s.trim()));
		const found = all.filter(t => wanted.includes(t.uri));
		const missing = wanted.filter(w => !found.some(t => t.uri === w));
		if (missing.length) throw new Error(`Not in tenant configuration: ${missing.join(', ')}`);
		return found;
	}
	if (args.entity) {
		const id = String(args.entity).replace(/^entities\//, '');
		const e = await call(`${api}/entities/${encodeURIComponent(id)}?select=type`, { method: 'GET' });
		const et = all.find(t => t.uri === e.type);
		if (!et) throw new Error(`${e.type} not found in tenant configuration`);
		return [et];
	}
	return all;
}

(async () => {
	const config = await call(`${api}/configuration`, { method: 'GET' });
	const types = await selectedTypes(config);
	console.error(`Entity types: ${types.map(t => t.uri.split('/').pop()).join(', ')}`);

	const results = [];
	for (const et of types) {
		const leaves = leafAttributes(et.attributes || []);
		const labelByPath = new Map(leaves.map(l => [l.path, l.label]));
		let paths = attrs.length > 0 ? attrs : leaves.map(l => l.path);
		if (args['rule-attrs']) paths = matchGroupAttributes(et);
		console.error(`\n${et.uri} — ${paths.length} attribute(s)`);
		if (paths.length === 0) continue;

		let result;
		if (source === 'dq') {
			result = await dqMetrics(et.uri, paths, labelByPath);
		} else {
			if (types.length > 1) throw new Error('--source scan measures one entity type at a time; pass --type');
			typeUri = et.uri;
			typeFilter = `equals(type,'${typeUri}')`;
			attrs = paths;
			result = await scanMetrics();
		}
		results.push({ entityTypeUri: et.uri, label: et.label || et.uri.split('/').pop(), ...result });
	}

	const json = JSON.stringify({
		generatedAt: new Date().toISOString(),
		generatedBy: 'scripts/dq-attribute-metrics.cjs',
		source,
		tenant,
		entityTypes: results,
	}, null, 2);
	if (args.out) {
		fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
		fs.writeFileSync(args.out, json);
		const csvPath = args.out.replace(/\.json$/i, '') + '.csv';
		fs.writeFileSync(csvPath, toCsv(results));
		console.error(`\nWrote ${args.out}\nWrote ${csvPath}`);
	} else {
		console.log(json);
	}
})().catch(err => {
	console.error(`\nFailed: ${err.message}`);
	process.exit(1);
});

function toCsv(results) {
	const cell = v => {
		const s = v == null ? '' : String(v);
		return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	const pctCell = r => (r == null ? '' : (r * 100).toFixed(2));
	const lines = [[
		'Entity type', 'Attribute', 'Path', 'Exists', 'Missing', 'Fill rate %',
		'Unique', 'Not unique', 'Uniqueness %', 'Top values', 'Error',
	].join(',')];
	for (const t of results) {
		for (const a of t.attributes) {
			lines.push([
				t.label, a.label ?? a.name, a.path, a.filled, a.missing, pctCell(a.fillRate),
				a.uniqueFilled, a.notUnique, pctCell(a.uniquenessRate),
				(a.topValues || []).slice(0, 5).map(v => `${v.value} (${v.count})`).join('; '),
				a.error,
			].map(cell).join(','));
		}
	}
	return lines.join('\n') + '\n';
}

async function runPool(items, concurrency, worker) {
	let next = 0;
	const lanes = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
		for (;;) {
			const i = next++;
			if (i >= items.length) return;
			await worker(items[i], i);
		}
	});
	await Promise.all(lanes);
}

function ratio(part, whole) {
	return typeof part === 'number' && typeof whole === 'number' && whole > 0 ? part / whole : null;
}

/** The Console Data Quality numbers: dataQuality/statistic, one call per attribute. */
async function dqMetrics(entityTypeUri, paths, labelByPath) {
	const entityType = entityTypeUri.split('/').pop();
	const attributes = new Array(paths.length);
	let aborted;
	await runPool(paths, concurrency, async (a, i) => {
		if (aborted) return;
		const label = labelByPath.get(a) ?? a;
		const q = new URLSearchParams({ entityType, attribute: `attributes.${a}` });
		let stat;
		try {
			stat = await call(`${api}/dataQuality/statistic?${q}`, { method: 'GET' });
		} catch (e) {
			if (/^401/.test(e.message)) { aborted = e; return; }
			console.error(`  ${a}: ${e.message}`);
			attributes[i] = { name: a, label, path: `attributes.${a}`, error: e.message };
			return;
		}
		const filled = stat?.fillRate?.exists ?? null;
		const missing = stat?.fillRate?.missing ?? null;
		const unique = stat?.uniqueness?.unique ?? null;
		const notUnique = stat?.uniqueness?.notUnique ?? null;
		const row = {
			name: a,
			label,
			path: `attributes.${a}`,
			filled,
			missing,
			fillRate: stat?.fillRate?.fillRate ?? ratio(filled, (filled ?? 0) + (missing ?? 0)),
			uniqueFilled: unique,
			notUnique,
			uniquenessRate: stat?.uniqueness?.uniqueness ?? ratio(unique, (unique ?? 0) + (notUnique ?? 0)),
			distinctValues: unique != null && notUnique != null ? unique + notUnique : null,
			topValues: Object.entries(stat?.frequency || {})
				.sort((x, y) => y[1] - x[1])
				.slice(0, topN)
				.map(([value, count]) => ({ value, count })),
			raw: stat,
		};
		console.error(`  ${a}: fill ${pct(row.fillRate)} (${filled}/${(filled ?? 0) + (missing ?? 0)}), uniqueness ${pct(row.uniquenessRate)} (${unique}/${row.distinctValues ?? 'n/a'})`);
		attributes[i] = row;
	});
	if (aborted) throw aborted;
	return {
		definitions: {
			fillRate: 'dataQuality/statistic fillRate.fillRate, else exists / (exists + missing)',
			uniquenessRate: 'dataQuality/statistic uniqueness.uniqueness, else unique / (unique + notUnique); counts are distinct values, not profiles',
			topValues: 'dataQuality/statistic frequency',
		},
		attributes,
	};
}

function pct(r) {
	return r == null ? 'n/a' : `${(r * 100).toFixed(2)}%`;
}

async function scanMetrics() {
	console.error(`Counting ${typeUri} on ${tenant} (active, OV only)…`);
	const totalProfiles = await total(typeFilter);
	const filledByCount = {};
	for (const a of attrs) {
		filledByCount[a] = await total(`${typeFilter} and exists(attributes.${a})`);
		console.error(`  ${a}: ${filledByCount[a]} / ${totalProfiles}`);
	}

	const stats = Object.fromEntries(attrs.map(a => [a, { filledProfiles: 0, values: 0, freq: new Map() }]));
	console.error(`Scanning values (cap ${maxProfiles})…`);
	const { seen, capped } = await scan(e => {
		for (const a of attrs) {
			const vals = ovValues(e.attributes || {}, a);
			if (vals.length === 0) continue;
			const s = stats[a];
			s.filledProfiles += 1;
			for (const v of new Set(vals)) {
				s.values += 1;
				s.freq.set(v, (s.freq.get(v) || 0) + 1);
			}
		}
	});
	process.stderr.write('\n');

	const metrics = attrs.map(a => {
		const s = stats[a];
		const filled = filledByCount[a];
		const singletons = [...s.freq.values()].filter(c => c === 1).length;
		return {
			name: a,
			path: `attributes.${a}`,
			filled,
			missing: totalProfiles - filled,
			fillRate: totalProfiles > 0 ? filled / totalProfiles : null,
			scannedFilledProfiles: s.filledProfiles,
			distinctValues: s.freq.size,
			uniqueFilled: singletons,
			uniquenessRate: s.values > 0 ? s.freq.size / s.values : null,
			topValues: [...s.freq.entries()]
				.sort((x, y) => y[1] - x[1])
				.slice(0, topN)
				.map(([value, count]) => ({ value, count })),
		};
	});

	return {
		totalProfiles,
		scannedProfiles: seen,
		scanCapped: capped,
		definitions: {
			fillRate: 'count(exists(attr), searchByOv, active) / count(type, active)',
			uniquenessRate: 'distinct OV values / OV values, per profile, after trim+lowercase',
			uniqueFilled: 'values held by exactly one profile',
		},
		attributes: metrics,
	};
}
