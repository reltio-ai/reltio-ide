#!/usr/bin/env node
/**
 * Read-only pair sample per firing match group: how often each well-filled attribute agrees
 * between a profile and the partner the rule matched it to. Saves counts only, never values.
 *
 *   node scripts/match-pair-sample.cjs --host https://tst-01.reltio.com --tenant <id> \
 *     --token-file <path> --rules <dir>/match-rules.json --dq <dir>/dq-attribute-metrics.json \
 *     --out <dir>/pair-sample.json [--anchors 30] [--partners 3] [--min-fill 0.3]
 *
 * --rules comes from scripts/match-rule-census.cjs, --dq from scripts/dq-attribute-metrics.cjs.
 * Only rules with a census above zero are sampled. Attributes compared: every attribute of the
 * type at or above --min-fill, plus every attribute the rule already uses.
 */
'use strict';

const fs = require('fs');

function parseArgs(argv) {
	const out = {};
	for (let i = 2; i < argv.length; i++) {
		if (!argv[i].startsWith('--')) continue;
		const next = argv[i + 1];
		if (next === undefined || next.startsWith('--')) out[argv[i].slice(2)] = true;
		else { out[argv[i].slice(2)] = next; i++; }
	}
	return out;
}

const args = parseArgs(process.argv);
const raw = args['token-file'] ? fs.readFileSync(args['token-file'], 'utf8') : process.env.RELTIO_TOKEN || '';
const token = raw.trim().replace(/^Bearer\s+/i, '').replace(/^["'<]+|["'>]+$/g, '').trim();
const host = String(args.host || '').replace(/\/+$/, '');
if (!token || !host || !args.tenant || !args.rules || !args.dq || !args.out) {
	console.error('Usage: --host --tenant (--token-file | RELTIO_TOKEN) --rules <file> --dq <file> --out <file>');
	process.exit(2);
}
const anchorsPerRule = Number(args.anchors || 30);
const partnersPerAnchor = Number(args.partners || 3);
const minFill = Number(args['min-fill'] || 0.3);
const api = `${host}/reltio/api/${encodeURIComponent(args.tenant)}`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function call(url, init = {}) {
	const res = await fetch(url, { headers, ...init });
	const text = await res.text();
	if (res.status === 401) throw new Error('401 Unauthorized — token expired or not an API token');
	if (!res.ok) throw new Error(`HTTP ${res.status} ${url.split('?')[0]}: ${text.slice(0, 200)}`);
	return text ? JSON.parse(text) : null;
}

const ruleAttrPaths = rule => {
	const out = new Set();
	const walk = n => {
		if (typeof n === 'string') {
			if (n.includes('/attributes/')) out.add(n.split('/attributes/').slice(1).join('.'));
		} else if (Array.isArray(n)) n.forEach(walk);
		else if (n && typeof n === 'object') {
			for (const [k, v] of Object.entries(n)) if (k !== 'matchTokenClasses' && k !== 'comparatorClasses' && k !== 'cleanse') walk(v);
		}
	};
	walk(rule);
	return [...out];
};

/** OV leaf values for a dotted path, lower-cased and trimmed. */
function ovValues(attributes, dotted) {
	let level = [{ value: attributes, ov: true }];
	for (const part of dotted.split('.')) {
		const next = [];
		for (const node of level) {
			if (node.ov === false || !node.value || typeof node.value !== 'object') continue;
			const vals = node.value[part];
			if (Array.isArray(vals)) next.push(...vals);
		}
		level = next;
	}
	return new Set(level
		.filter(v => v && v.ov !== false && v.value != null && typeof v.value !== 'object')
		.map(v => String(v.value).trim().toLowerCase())
		.filter(Boolean));
}

function sources(entity) {
	return new Set((entity.crosswalks || []).map(c => String(c.type || '').split('/').pop()).filter(Boolean));
}

/** Partner URIs a given rule matched to, across the payload shapes _matches returns. */
function partnersForRule(payload, ruleUri) {
	const out = new Set();
	const visit = (item, rules) => {
		if (!item || typeof item !== 'object') return;
		const ruleList = [
			...(Array.isArray(item.matchRules) ? item.matchRules : []),
			...(Array.isArray(item.matchRuleURIs) ? item.matchRuleURIs : []),
			...rules,
		];
		const uri = item.object?.uri || item.entity?.uri || item.uri;
		if (uri && ruleList.includes(ruleUri)) out.add(uri);
	};
	if (Array.isArray(payload)) payload.forEach(i => visit(i, []));
	else if (payload && typeof payload === 'object') {
		for (const [key, value] of Object.entries(payload)) {
			if (key.includes('/matchGroups/')) (Array.isArray(value) ? value : [value]).forEach(i => visit(i, [key]));
			else if (Array.isArray(value)) value.forEach(i => visit(i, []));
		}
	}
	return [...out];
}

async function byUris(uris) {
	const out = new Map();
	for (let i = 0; i < uris.length; i += 40) {
		const data = await call(`${api}/entities/_byUris`, { method: 'POST', body: JSON.stringify({ uris: uris.slice(i, i + 40) }) });
		const list = Array.isArray(data) ? data : data?.entities || [];
		for (const e of list) if (e?.uri) out.set(e.uri, e);
	}
	return out;
}

(async () => {
	const rules = JSON.parse(fs.readFileSync(args.rules, 'utf8'));
	const dq = JSON.parse(fs.readFileSync(args.dq, 'utf8'));
	const results = [];

	for (const t of rules) {
		const firing = t.rules.filter(r => typeof r.census === 'number' && r.census > 0);
		if (firing.length === 0) continue;
		const dqType = (dq.entityTypes || []).find(x => x.entityTypeUri === t.entityType);
		const wellFilled = (dqType?.attributes || []).filter(a => a && a.fillRate >= minFill).map(a => a.name);

		for (const r of firing) {
			const attrs = [...new Set([...ruleAttrPaths(r.rule), ...wellFilled])];
			const filter = `equals(type,'${t.entityType}') and gt(matches,0) and equals(matchRules,'${r.uri}')`;
			const q = new URLSearchParams({ filter, max: String(anchorsPerRule), select: 'uri' });
			const search = await call(`${api}/entities?${q}`);
			const anchors = (Array.isArray(search) ? search : search?.objects || []).map(e => e.uri).filter(Boolean);

			const pairs = [];
			for (const a of anchors) {
				const id = a.replace(/^entities\//, '');
				let payload;
				try {
					payload = await call(`${api}/entities/${encodeURIComponent(id)}/_matches?deep=1&max=50`);
				} catch (e) {
					if (/^401/.test(e.message)) throw e;
					continue;
				}
				for (const p of partnersForRule(payload, r.uri).slice(0, partnersPerAnchor)) {
					const key = [a, p].sort().join('|');
					if (!pairs.some(x => x.key === key)) pairs.push({ key, a, b: p });
				}
			}

			const entities = await byUris([...new Set(pairs.flatMap(p => [p.a, p.b]))]);
			const stats = Object.fromEntries(attrs.map(x => [x, { both: 0, equal: 0, differ: 0, oneMissing: 0, bothMissing: 0 }]));
			const pairRows = [];
			let crossSource = 0;
			for (const p of pairs) {
				const ea = entities.get(p.a);
				const eb = entities.get(p.b);
				if (!ea || !eb) continue;
				const sa = sources(ea);
				const sb = sources(eb);
				const cross = ![...sa].some(s => sb.has(s));
				if (cross) crossSource += 1;
				const row = { cross, cmp: {} };
				for (const x of attrs) {
					const va = ovValues(ea.attributes || {}, x);
					const vb = ovValues(eb.attributes || {}, x);
					const s = stats[x];
					let c;
					if (va.size === 0 && vb.size === 0) { s.bothMissing += 1; c = 'bothMissing'; }
					else if (va.size === 0 || vb.size === 0) { s.oneMissing += 1; c = 'oneMissing'; }
					else {
						s.both += 1;
						if ([...va].some(v => vb.has(v))) { s.equal += 1; c = 'equal'; }
						else { s.differ += 1; c = 'differ'; }
					}
					row.cmp[x] = c;
				}
				pairRows.push(row);
			}

			console.error(`${t.entityType.split('/').pop()} | ${r.label} | census ${r.census} | anchors ${anchors.length} | pairs ${pairRows.length}`);
			results.push({
				entityType: t.entityType,
				ruleUri: r.uri,
				ruleLabel: r.label,
				ruleType: r.type,
				census: r.census,
				ruleAttributes: ruleAttrPaths(r.rule),
				anchors: anchors.length,
				pairs: pairRows.length,
				crossSourcePairs: crossSource,
				attributes: stats,
				pairComparisons: pairRows,
			});
		}
	}

	fs.writeFileSync(args.out, JSON.stringify({ generatedAt: new Date().toISOString(), tenant: args.tenant, minFill, rules: results }, null, 2));
	console.error(`Wrote ${args.out}`);
})().catch(e => {
	console.error(`Failed: ${e.message}`);
	process.exit(1);
});
