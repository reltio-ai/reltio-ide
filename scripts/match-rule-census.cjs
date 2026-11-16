#!/usr/bin/env node
/**
 * Read-only: every match group in the tenant with its tenant-wide potential-match profile count.
 *
 *   node scripts/match-rule-census.cjs --host https://tst-01.reltio.com --tenant <id> \
 *     --token-file <path> --out <dir>/match-rules.json
 *
 * Census filter is the one Match Lab uses (censusFilterForRule in src/matchLab/censusFilters.ts).
 * Also saves the tenant configuration beside --out as configuration.json.
 */
'use strict';

const fs = require('fs');
const path = require('path');

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
if (!token || !host || !args.tenant || !args.out) {
	console.error('Usage: --host <url> --tenant <id> (--token-file <path> | RELTIO_TOKEN) --out <file.json>');
	process.exit(2);
}
const api = `${host}/reltio/api/${encodeURIComponent(args.tenant)}`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function get(url) {
	const res = await fetch(url, { headers });
	const text = await res.text();
	if (res.status === 401) throw new Error('401 Unauthorized — token expired or not an API token');
	if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
	return JSON.parse(text);
}

async function total(filter) {
	try {
		const d = await get(`${api}/entities/_total?${new URLSearchParams({ filter })}`);
		return typeof d === 'number' ? d : Number(d.total);
	} catch (e) {
		if (/^401/.test(e.message)) throw e;
		return `error: ${e.message.slice(0, 160)}`;
	}
}

(async () => {
	const config = await get(`${api}/configuration`);
	const dir = path.dirname(path.resolve(args.out));
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'configuration.json'), JSON.stringify(config, null, 2));

	const out = [];
	for (const et of config.entityTypes || []) {
		const groups = et.matchGroups || [];
		if (groups.length === 0) continue;
		const typeFilter = `equals(type,'${et.uri}')`;
		const profiles = await total(typeFilter);
		const withMatches = await total(`${typeFilter} and gt(matches,0)`);
		const rules = [];
		for (const g of groups) {
			const census = await total(`${typeFilter} and gt(matches,0) and equals(matchRules,'${g.uri}')`);
			rules.push({
				uri: g.uri, label: g.label, type: g.type, scope: g.scope, useOvOnly: g.useOvOnly,
				census, rule: g.rule, negativeRule: g.negativeRule,
			});
		}
		out.push({ entityType: et.uri, profiles, withMatches, rules });
	}
	fs.writeFileSync(args.out, JSON.stringify(out, null, 2));

	for (const t of out) {
		console.log(`\n=== ${t.entityType} profiles=${t.profiles} withMatches=${t.withMatches}`);
		for (const r of t.rules) {
			console.log(`- ${r.label} [${r.type}] census=${r.census} ovOnly=${r.useOvOnly}`);
			console.log(`  rule=${JSON.stringify(r.rule)}`);
			if (r.negativeRule) console.log(`  negativeRule=${JSON.stringify(r.negativeRule)}`);
		}
	}
})().catch(e => {
	console.error(`Failed: ${e.message}`);
	process.exit(1);
});
