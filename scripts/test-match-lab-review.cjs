#!/usr/bin/env node
'use strict';
/**
 * Match Lab Review — census + sampled unique pairs (no Apply L3, no rebuild).
 * Tier A: inventory, pair collapse, status parse, matching gate, masking, hub URLs
 * Tier B: playbook shipped, command contributed, no POST _matches
 * Tier C (manual): right-click AakashSandbox → Match Lab Review
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');
const { repoRoot } = require('./lib/load-sample.cjs');
const { loadCanonicalFixture } = require('./lib/load-canonical-fixture.cjs');

const os = require('os');
const zlib = require('zlib');

/** Reads a zip back by walking its local file headers — enough to prove the .xlsx is well formed. */
function unzip(buf) {
	const out = new Map();
	let i = 0;
	while (i + 4 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
		const method = buf.readUInt16LE(i + 8);
		const compSize = buf.readUInt32LE(i + 18);
		const nameLen = buf.readUInt16LE(i + 26);
		const extraLen = buf.readUInt16LE(i + 28);
		const name = buf.toString('utf8', i + 30, i + 30 + nameLen);
		const start = i + 30 + nameLen + extraLen;
		const data = buf.subarray(start, start + compSize);
		out.set(name, (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8'));
		i = start + compSize;
	}
	return out;
}

const { canonicalPair, hubProfileUrl, normalizeEntityUri } = importDist('matchLab/entityUris');
const { parseTenantMatchingStatus, isRecognizedStatus, isDegradedStatus } = importDist('matchLab/statusParse');
const { waitForMatchingIdle, matchingPipelineGatePath, MATCHING_PIPELINE_GATE_FILENAME } = importDist('matchLab/matchingGate');
const { inventoryMatchLabTypes } = importDist('matchLab/l3Inventory');
const { maskSsn } = importDist('matchLab/masking');
const { whyItMatched } = importDist('matchLab/whyMatched');
const { parseMatchHits } = importDist('matchLab/matchHits');
const { displayValues, flattenEntityOvValues, cmpValues, orderedValueColumns } = importDist('matchLab/entityValues');
const { runMatchLab, chatSummary } = importDist('matchLab/runMatchLab');
const { matchLabShellHtml, matchLabCsp, tabsForWorkbook, loadEntityWorkbooks } = importDist('matchLab/panelHtml');
const {
	existsAllAttributesFilter,
	existsAttributeFilter,
	attributeSearchPath,
} = importDist('matchLab/censusFilters');
const { occupancyKeysForRule, eligibleForRules, NO_EXACT_KEYS_REASON } = importDist('matchLab/occupancy');
const {
	pairOccupancy,
	recommendRule,
	noisyNameColumns,
	MIN_RULE_PAIRS_FOR_OWN_BASIS,
} = importDist('matchLab/recommendations');
const { parseMappingInput } = importDist('matchLab/mappingInput');
const {
	discriminatorStats,
	rankDiscriminators,
	gatedDiscriminators,
	buildReductionSuggestions,
	survivalForKeySet,
	REDUCTION_THRESHOLDS,
} = importDist('matchLab/reductionSuggestions');
const { attributeFillRates } = importDist('matchLab/fillRates');
const { MatchingNotIdleError } = importDist('matchLab/types');
const { MATCH_LAB_ENGINE_VERSION } = importDist('matchLab/defaults');
const { entityTypeIndexFromJsonPath, entityTypeUriFromJsonPath } = importDist('matchLab/entityScope');
const { ruleSignal } = importDist('matchLab/recommendations');
const {
	getTenantMatchingStatus,
	getEntityMatches,
	getEntitiesByUris,
	countEntities,
	MATCHES_TIMEOUT_MS,
	ReltioApiError,
} = importDist('matchLab/reltioApi');

async function main() {
// --- pair collapse ---
const ab = canonicalPair('entities/bbb', 'entities/aaa');
assert.ok(ab);
assert.strictEqual(ab.profileA, 'entities/aaa');
assert.strictEqual(ab.profileB, 'entities/bbb');
const ba = canonicalPair('https://host/reltio/api/t/entities/aaa', 'entities/bbb');
assert.strictEqual(ba.key, ab.key);
assert.strictEqual(canonicalPair('entities/aaa', 'entities/aaa'), undefined);

assert.strictEqual(normalizeEntityUri('entities/X'), 'entities/X');
assert.strictEqual(
	hubProfileUrl('tst-01.reltio.com', 'AakashSandbox', 'entities/abc'),
	'https://tst-01.reltio.com/nui/AakashSandbox/profile?entityUri=entities%2Fabc',
);

// --- status parse / gate ---
const parsed = parseTenantMatchingStatus({
	Status: 'Green',
	'Matching queue size': 0,
	'Events queue size': 0,
});
assert.strictEqual(parsed.matchingQueueSize, 0);
assert.strictEqual(parsed.eventsQueueSize, 0);
assert.ok(isRecognizedStatus('Yellow'));
assert.ok(isDegradedStatus('Red'));
assert.ok(!isRecognizedStatus('unknown'));
assert.strictEqual(parseTenantMatchingStatus({}, 'Matching queue size: 3\nEvents queue size: 1\nStatus: Green').matchingQueueSize, 3);
assert.strictEqual(parseTenantMatchingStatus({ Status: 'Green', 'Matching queue size': 'n/a' }).matchingQueueSize, undefined);
assert.strictEqual(parseTenantMatchingStatus({ Status: 'Green', 'Matching queue size': -1, 'Events queue size': 0 }).matchingQueueSize, undefined);
assert.strictEqual(parseTenantMatchingStatus({ Status: 'Green', 'Matching queue size': 0, 'Events queue size': '-3' }).eventsQueueSize, undefined);

// --- inventory from canonical fixture ---
const fixture = loadCanonicalFixture();
const types = inventoryMatchLabTypes(fixture.model);
assert.ok(types.length > 0, 'fixture has match groups');
assert.ok(
	types.every(t => t.matchGroups.length > 0 || (t.automaticRuleNames ?? []).length > 0),
	'a listed type has rules to review, or names the automatic rules it leaves out',
);
assert.ok(
	types.every(t => t.matchGroups.every(g => g.isFern || !/^automatic/i.test(g.type))),
	'no hand-built automatic rule is reviewed',
);
const org = types.find(t => t.entityTypeUri.endsWith('/Organization'));
assert.ok(org);

const hiddenL3 = {
	entityTypes: [
		{
			uri: 'configuration/entityTypes/Person',
			label: 'Person',
			attributes: [
				{ uri: 'configuration/entityTypes/Person/attributes/FirstName', name: 'FirstName', label: 'First Name' },
				{ uri: 'configuration/entityTypes/Person/attributes/SSN', name: 'SSN', label: 'SSN' },
				{
					uri: 'configuration/entityTypes/Person/attributes/Secret',
					name: 'Secret',
					hidden: true,
				},
			],
			matchGroups: [
				{
					uri: 'configuration/entityTypes/Person/matchGroups/ExactName',
					label: 'Exact name',
					type: 'suspect',
					scope: 'INTERNAL',
					rule: {
						exact: ['configuration/entityTypes/Person/attributes/FirstName'],
						fuzzy: ['configuration/entityTypes/Person/attributes/Secret'],
					},
				},
				{
					uri: 'configuration/entityTypes/Person/matchGroups/House',
					label: 'Household',
					type: 'automatic_grouping',
					scope: 'NONE',
					rule: { exact: ['configuration/entityTypes/Person/attributes/FirstName'] },
				},
				{
					uri: 'configuration/entityTypes/Person/matchGroups/FernAuto',
					label: 'FERN auto',
					type: 'automatic',
					scope: 'ALL',
					matchMethodMetadata: { origin: 'fern', packageProfile: 'fern_person' },
					rule: { exact: ['configuration/entityTypes/Person/attributes/FirstName'] },
				},
			],
		},
		{ uri: 'configuration/entityTypes/NoRules', label: 'No rules', attributes: [], matchGroups: [] },
	],
};
const inv = inventoryMatchLabTypes(hiddenL3);
assert.strictEqual(inv.length, 1, 'types without matchGroups are omitted');
assert.deepStrictEqual(
	inv[0].matchGroups.map(g => g.shortName),
	['ExactName', 'FernAuto'],
	'automatic rules merge without review, so Match Lab leaves them out; FERN groups stay for the FERN score',
);
assert.deepStrictEqual(inv[0].automaticRuleNames, ['House']);
assert.ok(inv[0].matchGroups.some(g => g.scope === 'INTERNAL'));
assert.ok(inv[0].matchGroups.find(g => g.shortName === 'FernAuto').isFern);
assert.ok(inv[0].attributes.find(a => a.name === 'Secret').hidden);
assert.deepStrictEqual(inv[0].matchGroups[0].hiddenAttributeUris, [
	'configuration/entityTypes/Person/attributes/Secret',
]);

assert.strictEqual(maskSsn('123-45-6789'), '••••6789');

const entityA = {
	uri: 'entities/aaa',
	label: 'Ann',
	crosswalks: [
		{ type: 'configuration/sources/HMS', value: 'aaa-1' },
		{ type: 'configuration/sources/HMS', value: 'aaa-1' },
	],
	attributes: {
		FirstName: [{ value: 'Ann', ov: true }],
		SSN: [{ value: '123-45-6789', ov: true, uri: 'configuration/entityTypes/Person/attributes/SSN' }],
		Secret: [{ value: 'hidden-value', ov: true, uri: 'configuration/entityTypes/Person/attributes/Secret' }],
	},
};
const metaByUri = new Map(inv[0].attributes.map(a => [a.uri, a]));
const metaByName = new Map(inv[0].attributes.map(a => [a.name, a]));
const shown = displayValues(flattenEntityOvValues(entityA), metaByUri, metaByName);
assert.strictEqual(shown.Secret, undefined, 'hidden attributes omitted from pair columns');
assert.strictEqual(shown.SSN, '••••6789');
assert.strictEqual(cmpValues('Ann', 'Ann'), 'equal');

// A referenced entity's attribute never stands in for the profile's own attribute of the same name
{
	const contactMeta = [
		{ uri: 'configuration/entityTypes/Contact/attributes/Name', name: 'Name', label: 'Name', family: 'name', hidden: false, maskSsn: false },
		{ uri: 'configuration/entityTypes/Contact/attributes/FirstName', name: 'FirstName', label: 'First Name', family: 'name', hidden: false, maskSsn: false },
		{ uri: 'configuration/entityTypes/Contact/attributes/Email', name: 'Email', label: 'Email', family: 'email', hidden: false, maskSsn: false },
		{ uri: 'configuration/entityTypes/Contact/attributes/Email/attributes/Email', name: 'Email', label: 'Email', family: 'email', hidden: false, maskSsn: false, parentUri: 'configuration/entityTypes/Contact/attributes/Email' },
		{ uri: 'configuration/entityTypes/Contact/attributes/affiliatedwith', name: 'affiliatedwith', label: 'Affiliated with', family: 'other', hidden: false, maskSsn: false },
	];
	const byUri = new Map(contactMeta.map(a => [a.uri, a]));
	const byName = new Map(contactMeta.map(a => [a.name, a]));
	const orgRef = name => ({
		type: 'configuration/entityTypes/Contact/attributes/affiliatedwith',
		ov: true,
		uri: `entities/c1/attributes/affiliatedwith/${name.length}`,
		refEntity: { type: 'configuration/entityTypes/Organization', objectURI: 'entities/org' },
		refRelation: { type: 'configuration/relationTypes/affiliatedwith', objectURI: 'relations/r1' },
		value: {
			Name: [{ type: 'configuration/entityTypes/Organization/attributes/Name', ov: true, value: name, uri: 'entities/c1/attributes/affiliatedwith/x/Name/1' }],
			OrganizationType: [{ ov: true, value: 'Partner', uri: 'entities/c1/attributes/affiliatedwith/x/OrganizationType/1' }],
		},
	});
	const contact = {
		uri: 'entities/c1',
		attributes: {
			Name: [{ ov: true, value: 'Nick Jones', uri: 'entities/c1/attributes/Name/1' }],
			FirstName: [{ ov: true, value: 'Nick', uri: 'entities/c1/attributes/FirstName/1' }],
			Email: [{ ov: true, uri: 'entities/c1/attributes/Email/1', value: { Email: [{ ov: true, value: 'nick@x.com', uri: 'entities/c1/attributes/Email/1/Email/1' }] } }],
			affiliatedwith: [orgRef('Highpoint Solutions, an IQVIA Company'), orgRef('IQVIA Inc.')],
		},
	};
	const values = displayValues(flattenEntityOvValues(contact), byUri, byName);
	assert.strictEqual(values.Name, 'Nick Jones', "Name is the Contact's own name, not the linked organizations'");
	assert.strictEqual(values.FirstName, 'Nick');
	assert.strictEqual(values.Email, 'nick@x.com', 'nested attributes of the type itself are still read');
	assert.strictEqual(values.OrganizationType, 'Partner | Partner', 'a reference-only attribute keeps its column as before');

	// No own Name value: the column stays empty rather than borrowing the organization's name
	const { Name: _ownName, ...withoutOwnName } = contact.attributes;
	const noName = displayValues(flattenEntityOvValues({ ...contact, attributes: withoutOwnName }), byUri, byName);
	assert.strictEqual(noName.Name, undefined);
	assert.strictEqual(cmpValues(noName.Name, values.Name), 'B only');
}

const whyBlank = whyItMatched(
	{
		...inv[0].matchGroups[1],
		cleanseAdapters: [],
		comparatorClasses: [{ attributeUri: 'configuration/entityTypes/Person/attributes/FirstName', className: 'com.reltio.match.comparator.BasicStringComparator' }],
	},
	{ FirstName: 'Ann' },
	{ FirstName: 'Ann' },
);
assert.strictEqual(whyBlank, '');

const whyDict = whyItMatched(
	{
		...inv[0].matchGroups[0],
		cleanseAdapters: ['com.reltio.cleanse.impl.NameDictionaryCleanser'],
		comparatorClasses: [],
	},
	{ FirstName: 'Bob' },
	{ FirstName: 'Robert' },
);
assert.match(whyDict, /dictionary/i);

const groupedHits = parseMatchHits({
	'configuration/entityTypes/Person/matchGroups/ExactName': [
		{ object: { uri: 'entities/bbb' } },
	],
});
assert.strictEqual(groupedHits.length, 1);
assert.strictEqual(groupedHits[0].partnerUri, 'entities/bbb');
assert.ok(groupedHits[0].matchRuleUris.includes('configuration/entityTypes/Person/matchGroups/ExactName'));

const noFern = parseMatchHits([{ uri: 'entities/x', matchRules: ['r'] }]);
assert.strictEqual(noFern[0].fernScore, undefined);
const withFern = parseMatchHits([{ uri: 'entities/x', matchRules: ['r'], relevance: 0.8, fernConfidence: 0.4 }]);
assert.strictEqual(withFern[0].fernScore, 0.8);

const cols = orderedValueColumns(inv[0].attributes, new Set(['FirstName', 'SSN']));
assert.deepStrictEqual(cols.map(c => c.key), ['FirstName', 'SSN']);
assert.ok(cols.find(c => c.key === 'FirstName').family === 'name');
assert.ok(cols.find(c => c.key === 'SSN').family === 'identifiers');

// --- sampled run with mock API: A↔B collapses, INTERNAL, FERN, census 0, gate ---
function writeTempL3(model) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-lab-engine-'));
	const l3Path = path.join(dir, 'L3.reltio.json');
	fs.writeFileSync(l3Path, JSON.stringify(model));
	return { dir, l3Path };
}

const mockEntities = {
	'entities/aaa': entityA,
	'entities/bbb': {
		uri: 'entities/bbb',
		label: 'Bob',
		crosswalks: [{ type: 'configuration/sources/Salesforce', value: 'bbb-9' }],
		attributes: { FirstName: [{ value: 'Bob', ov: true }] },
	},
};

function makeApi(hooks) {
	const h = hooks || {};
	return {
		getTenantMatchingStatus: async () => {
			h.status?.();
			return {
		body: { Status: 'Green', 'Matching queue size': 0, 'Events queue size': 0 },
		text: '',
			};
		},
	countEntities: async (_b, _t, _tok, filter) => {
			h.count?.(filter);
		const f = String(filter);
		// A bare type count is the fill-rate denominator; zero would make every rate null.
		if (/^equals\(type,'[^']+'\)$/.test(f)) return 100;
		if (f.includes('exists(attributes.')) return 40;
		if (f.includes('ExactName')) return 2;
		return 0;
	},
		searchEntities: async (_b, _t, _tok, opts) => {
			h.search?.(opts && opts.filter);
			return [entityA, mockEntities['entities/bbb']];
		},
	getEntityMatches: async (_b, _t, _tok, id) => {
			h.matches?.(id);
		if (String(id).includes('aaa')) {
			return [{ uri: 'entities/bbb', matchRules: ['configuration/entityTypes/Person/matchGroups/ExactName'] }];
		}
		return [{ uri: 'entities/aaa', matchRules: ['configuration/entityTypes/Person/matchGroups/ExactName'] }];
	},
	getEntitiesByUris: async (_b, _t, _tok, uris) => uris.map(u => mockEntities[u]).filter(Boolean),
};
}

{
	const { dir, l3Path } = writeTempL3(hiddenL3);
	const searches = [];
	const matchCalls = [];
	const result = await runMatchLab('tst-01.reltio.com', 'AakashSandbox', 't', l3Path, {
		api: makeApi({ search: f => searches.push(f), matches: id => matchCalls.push(id) }),
		tenantRoot: dir,
	sleep: async () => {},
		pollIntervalMs: 0,
	});
	assert.strictEqual(result.report.pairs.length, 1, 'A↔B collapses to one row');
	assert.strictEqual(result.report.pairs[0].profileAUri, 'entities/aaa');
	assert.strictEqual(result.report.pairs[0].profileBUri, 'entities/bbb');
	assert.ok(result.report.census.some(c => c.scope === 'INTERNAL'));
	assert.ok(!result.report.census.some(c => c.ruleShortName === 'House'), 'an automatic rule is not counted or sampled');
	assert.ok(!result.report.census.some(c => c.ruleShortName === 'FernAuto'), 'FERN is not a census/rule tab');
	const exactCensus = result.report.census.find(c => c.ruleShortName === 'ExactName');
assert.ok(exactCensus);
assert.strictEqual(exactCensus.entitiesWithMatches, 2);
	assert.match(exactCensus.censusFilter, /gt\(matches,0\)/);
	assert.match(exactCensus.censusFilter, /equals\(matchRules,'configuration\/entityTypes\/Person\/matchGroups\/ExactName'\)/);
	assert.ok(!Object.keys(result.report.pairs[0].values).some(k => k.includes('Secret')), 'hidden attrs omitted');
	assert.ok(searches.every(f => !String(f).includes('House')), 'census 0 rule has no pair fetch');
	assert.ok(matchCalls.length > 0);

	const workbook = JSON.parse(fs.readFileSync(path.join(dir, 'match-lab', 'Person.json'), 'utf8'));
	assert.ok(!workbook.tabOrder.includes('Summary'), 'Summary was removed');
	assert.ok(workbook.tabOrder.includes('Rule Activity'));
	assert.ok(!workbook.tabOrder.includes('Rule Analysis'), 'Rule Analysis folded into Rule Activity');
	assert.ok(!workbook.tabOrder.includes('Data Readiness'));
	assert.ok(workbook.tabOrder.includes('Rule Overlap'));
	assert.ok(workbook.tabOrder.includes('By Profile'));
	assert.ok(workbook.tabOrder.includes('Rules'));
	assert.ok(!workbook.tabOrder.includes('ExactName'), 'one Rules tab, not a tab per rule');
	assert.ok(workbook.tabOrder.includes('How to use'));
	assert.ok(
		!workbook.tabOrder.some(t => ['SA Briefing', 'Census', 'Rule notes', 'Coverage', 'By entity'].includes(t)),
		'the pre-7.0 jargon tab names are gone',
	);
	assert.ok(!workbook.tabOrder.includes('FernAuto'), 'FERN group is not a pair tab');
	const rulesTab = workbook.tabs.Rules;
	assert.strictEqual(rulesTab.rows.length, 1);
	assert.match(rulesTab.rows[0]['Profile A'], /\/nui\/AakashSandbox\/profile\?entityUri=entities%2Faaa/);
	assert.doesNotMatch(rulesTab.rows[0]['Profile A'], /#profile/);
	assert.ok(!rulesTab.columns.includes('FERN score'));
	assert.ok(!Object.keys(rulesTab.rows[0]).some(k => k.includes('Secret')));
	// The Rule column is what the panel's rule picker and the spreadsheet filter select on.
	assert.strictEqual(rulesTab.rows[0].Rule, 'ExactName');
	// Pair rows carry the owning rule's scope bare, not a "scope INTERNAL" notes blob.
	assert.ok(rulesTab.columns.includes('Scope') && !rulesTab.columns.includes('Lab notes'));
	assert.doesNotMatch(String(rulesTab.rows[0].Scope), /scope/i);
	// The explanatory blocks above each table are gone; only the no-match-groups case
	// keeps one, because that workbook has no rows to explain itself with.
	assert.ok(!rulesTab.docs);
	assert.match(
		workbook.tabs['Rule Activity'].docs,
		/^Not shown: House — automatic rule merges matches directly without review/,
		'Rule Activity says which automatic rules it left out',
	);
	assert.ok(!workbook.tabs['Rule Activity'].rows.some(r => r.Rule === 'House'));
	assert.ok(
		workbook.tabOrder.every(
			name => !workbook.tabs[name].docs
				|| name === 'Rule Activity'
				|| (workbook.tabs[name].rows.length === 0 && /^Reason: /.test(workbook.tabs[name].docs)),
		),
		'only the automatic-rules line carries docs, apart from a "Reason:" line on an empty tab',
	);
	assert.ok(!workbook.tabOrder.includes('Fill rates'), 'the Fill rates tab was removed');
	assert.ok(!workbook.tabOrder.includes('Token Phrases'), 'the Token Phrases tab was removed');
	assert.strictEqual(workbook.tabOrder[0], 'How to use', 'How to use is the first tab the panel opens on');

	// How to use is the numbered reading order and nothing else
	const howTo = workbook.tabs['How to use'];
	assert.deepStrictEqual(howTo.columns, ['Step', 'What to do']);
	assert.deepStrictEqual(
		howTo.rows.map(r => r.Step),
		[1, 2, 3, 4, 5, 6],
		'every row is a numbered step through Suggested Changes',
	);
	assert.ok(
		!JSON.stringify(howTo.rows).match(/Token Phrases|Reltio Notes|Customer notes/),
		'How to use does not point at removed tabs or columns',
	);
	assert.ok(
		!JSON.stringify(howTo.rows).match(/Data Readiness|Read Summary/),
		'no step points the reader at a tab that no longer exists',
	);
	assert.ok(
		howTo.rows.every(r => r['What to do']),
		'no step is left without an explanation',
	);
	assert.ok(
		!JSON.stringify(howTo.rows).includes('SA Briefing'),
		'How to use names the current tabs, not the pre-7.0 ones',
	);

	// Rule Activity: reference column order and formatted counts, one row per rule
	assert.deepStrictEqual(workbook.tabs['Rule Activity'].columns, [
		'Rule',
		'Type',
		'Scope',
		'Status',
		'Profiles with potential matches',
		'Sampled pairs',
		'Keys in rule',
		'Profiles with all rule keys populated',
		'Lab notes',
		'Label',
	]);
	const activityRows = workbook.tabs['Rule Activity'].rows;
	assert.ok(
		activityRows.every(r => typeof r['Profiles with potential matches'] === 'string'),
		'counts are formatted text so thousands separators survive the round trip',
	);
	assert.ok(
		activityRows.every(r => r.Rule && r.Status),
		'every row is a measured rule carrying its own status',
	);
	assert.ok(
		activityRows.every(r => !('Reltio Notes' in r) && !('Customer notes' in r)),
		'there are no reviewer notes columns',
	);
	assert.ok(
		workbook.tabOrder.every(name => !workbook.tabs[name].columns.some(c => c === 'Reltio Notes' || c === 'Customer notes')),
		'no tab carries Reltio Notes or Customer notes',
	);
	// Sampled pairs is the count of that rule's rows on the Rules tab.
	assert.strictEqual(
		activityRows.find(r => r.Rule === 'ExactName')['Sampled pairs'],
		String(rulesTab.rows.filter(r => r.Rule === 'ExactName').length),
	);

	// The Rules tab puts A and B side by side per attribute, then comparisons, then provenance
	const pairCols = rulesTab.columns;
	assert.strictEqual(pairCols[pairCols.length - 1], 'Both URIs');
	assert.deepStrictEqual(
		pairCols.slice(-3, -1),
		['a_crosswalks', 'b_crosswalks'],
		'crosswalks close out the value columns',
	);
	const firstA = pairCols.findIndex(c => c.startsWith('a_') && c !== 'a_crosswalks');
	assert.strictEqual(
		pairCols[firstA + 1],
		`b_${pairCols[firstA].slice(2)}`,
		'each attribute\'s A and B values are adjacent',
	);
	assert.ok(
		!pairCols.includes('cmp_crosswalks'),
		'crosswalks are provenance, so there is nothing to compare',
	);
	assert.strictEqual(
		rulesTab.rows[0].a_crosswalks,
		'HMS:aaa-1',
		'each profile lists its source records as source:value',
	);

	assert.ok(result.entityFiles.some(f => f.entityType === 'Person' && f.path.endsWith('Person.json')));
	fs.rmSync(dir, { recursive: true, force: true });
}

{
	const { dir, l3Path } = writeTempL3(hiddenL3);
	const matchCalls = [];
	const result = await runMatchLab('tst-01.reltio.com', 'AakashSandbox', 't', l3Path, {
		api: makeApi({
			count: () => {},
			matches: id => matchCalls.push(id),
		}),
		tenantRoot: dir,
		sleep: async () => {},
		pollIntervalMs: 0,
		skip: true,
	});
	const zeroApi = {
		...makeApi({ matches: id => matchCalls.push(id) }),
		countEntities: async () => 0,
		getEntityMatches: async () => {
			matchCalls.push('unexpected');
			return [];
		},
	};
	fs.rmSync(dir, { recursive: true, force: true });
	const z = writeTempL3(hiddenL3);
	const matchZero = [];
	await runMatchLab('tst-01.reltio.com', 'AakashSandbox', 't', z.l3Path, {
		api: {
			...makeApi(),
			countEntities: async () => 0,
			getEntityMatches: async () => {
				matchZero.push('hit');
				return [];
			},
			searchEntities: async () => {
				throw new Error('search should not run when all census 0');
			},
		},
		tenantRoot: z.dir,
		sleep: async () => {},
		pollIntervalMs: 0,
		skip: true,
	});
	assert.deepStrictEqual(matchZero, [], 'census 0 rule has no pair fetch');
	const wb = JSON.parse(fs.readFileSync(path.join(z.dir, 'match-lab', 'Person.json'), 'utf8'));
	assert.ok(wb.tabs['Rule Activity'].rows.some(
		r => r.Rule === 'ExactName' && r['Profiles with potential matches'] === '0',
	));
	assert.ok(!wb.tabs['Rule Activity'].rows.some(r => r.Rule === 'House'), 'the automatic rule is not listed');
	fs.rmSync(z.dir, { recursive: true, force: true });
	void result;
}

{
	const { dir, l3Path } = writeTempL3(hiddenL3);
	const matchCalls = [];
	const boom = () => {
		const err = new Error('Count entities failed: HTTP 400: invalid filter');
		err.statusCode = 400;
		throw err;
	};
	const result = await runMatchLab('tst-01.reltio.com', 'AakashSandbox', 't', l3Path, {
		api: {
			...makeApi({ matches: id => matchCalls.push(id) }),
			countEntities: async () => boom(),
			searchEntities: async () => {
				throw new Error('search should not run when census errors');
			},
			getEntityMatches: async () => {
				matchCalls.push('unexpected');
				return [];
			},
		},
		tenantRoot: dir,
		sleep: async () => {},
		pollIntervalMs: 0,
		skip: true,
	});
	assert.deepStrictEqual(matchCalls, [], 'census error has no pair fetch');
	for (const row of result.report.census) {
		assert.strictEqual(row.censusStatus, 'error');
		assert.strictEqual(row.entitiesWithMatches, null);
		assert.notStrictEqual(row.entitiesWithMatches, 0);
		assert.strictEqual(row.censusHttpStatus, 400);
		assert.match(row.notes, /Census failed: Count entities failed: HTTP 400/);
	}
	const wb = JSON.parse(fs.readFileSync(path.join(dir, 'match-lab', 'Person.json'), 'utf8'));
	const measuredRows = wb.tabs['Rule Activity'].rows.filter(r => r.Rule);
	assert.strictEqual(measuredRows.length, 1, 'one row per reviewed rule; the automatic House rule is left out');
	// With the status column gone, the count cell is the only place a failed count is reported.
	assert.ok(measuredRows.every(r => r['Profiles with potential matches'] === 'error'));
	assert.doesNotMatch(
		JSON.stringify(measuredRows.map(r => r['Profiles with potential matches'])),
		/0/,
	);
	const summary = chatSummary(result);
	assert.doesNotMatch(summary, /House/);
	assert.match(summary, /ExactName: The count failed — unknown, not zero/);
	assert.doesNotMatch(summary, /House 0/);
	assert.doesNotMatch(summary, /ExactName 0/);
	assert.doesNotMatch(
		summary,
		/No potential matches/,
		'a failed count must never read as having no matches',
	);
	for (const rec of result.recommendations) {
		assert.strictEqual(rec.recommendation, 'The count failed — unknown, not zero');
		assert.strictEqual(rec.signal, 'The count failed — cannot be judged');
	}
	const html = matchLabShellHtml({
		nonce: 'errnonce',
		csp: matchLabCsp('errnonce'),
		workbooks: [wb],
	});
	assert.match(html, /"Profiles with potential matches":"error"/);
	assert.doesNotMatch(html, /Measurement status/);
	fs.rmSync(dir, { recursive: true, force: true });
}

{
	const { dir, l3Path } = writeTempL3(hiddenL3);
	let counts = 0;
	let matches = 0;
	try {
		await runMatchLab('tst-01.reltio.com', 'AakashSandbox', 't', l3Path, {
		api: {
				getTenantMatchingStatus: async () => ({
					body: { Status: 'Green', 'Matching queue size': 9, 'Events queue size': 1 },
					text: '',
				}),
			countEntities: async () => {
					counts += 1;
					return 0;
			},
				searchEntities: async () => [],
				getEntityMatches: async () => {
					matches += 1;
					return [];
		},
				getEntitiesByUris: async () => [],
			},
			tenantRoot: dir,
		sleep: async () => {},
			pollIntervalMs: 0,
			maxAttempts: 3,
		});
		assert.fail('expected MatchingNotIdleError');
	} catch (e) {
		assert.ok(e instanceof MatchingNotIdleError);
		assert.match(e.message, /9/);
		assert.strictEqual(e.gate.idle, false);
		assert.strictEqual(counts, 0, 'gate not idle → no countEntities');
		assert.strictEqual(matches, 0, 'gate not idle → no _matches');
	}
	fs.rmSync(dir, { recursive: true, force: true });
}

{
	const { dir, l3Path } = writeTempL3(hiddenL3);
	let counts = 0;
	try {
		await runMatchLab('tst-01.reltio.com', 'AakashSandbox', 't', l3Path, {
		api: {
			getTenantMatchingStatus: async () => ({
					body: { Status: 'Green', 'Events queue size': 0 },
				text: '',
			}),
				countEntities: async () => {
					counts += 1;
					return 1;
		},
				searchEntities: async () => [],
				getEntityMatches: async () => [],
				getEntitiesByUris: async () => [],
			},
			tenantRoot: dir,
		sleep: async () => {},
			pollIntervalMs: 0,
			maxAttempts: 1,
	});
		assert.fail('expected unreadable queue to block');
} catch (e) {
	assert.ok(e instanceof MatchingNotIdleError);
		assert.strictEqual(e.gate.idle, false);
		assert.strictEqual(e.gate.reason, 'unreadable-queue');
		assert.strictEqual(counts, 0, 'unreadable queue never treated as idle');
	}
	fs.rmSync(dir, { recursive: true, force: true });
}

// --- Step 6: occupancy (eligible) + deterministic recommendations ---
const C = 'configuration/entityTypes/Contact';
const step6L3 = {
	entityTypes: [
		{
			uri: C,
			label: 'Contact',
			attributes: [
				{ uri: `${C}/attributes/FirstName`, name: 'FirstName', label: 'First Name' },
				{ uri: `${C}/attributes/LastName`, name: 'LastName', label: 'Last Name' },
				{ uri: `${C}/attributes/Email`, name: 'Email', label: 'Email' },
				{ uri: `${C}/attributes/Phone`, name: 'Phone', label: 'Phone' },
				{ uri: `${C}/attributes/Secret`, name: 'Secret', hidden: true },
			],
			matchGroups: [
				{
					uri: `${C}/matchGroups/Firing`,
					label: 'Exact email',
					type: 'suspect',
					scope: 'ALL',
					rule: {
						exact: [`${C}/attributes/Email`],
						exactOrNull: [`${C}/attributes/Phone`],
						notExact: [{ uri: `${C}/attributes/FirstName` }],
						cleanse: [{ cleanseAdapter: 'com.reltio.cleanse.impl.NameDictionaryCleanser' }],
					},
				},
				{
					uri: `${C}/matchGroups/InternalIdle`,
					label: 'Internal only',
					type: 'suspect',
					scope: 'INTERNAL',
					rule: { exact: [`${C}/attributes/LastName`] },
				},
				{
					uri: `${C}/matchGroups/HiddenExact`,
					label: 'Cites a hidden key',
					type: 'suspect',
					scope: 'ALL',
					rule: { exact: [`${C}/attributes/LastName`, `${C}/attributes/Secret`] },
				},
				{
					uri: `${C}/matchGroups/PlainIdle`,
					label: 'Plain idle',
					type: 'suspect',
					scope: 'ALL',
					rule: { exact: [`${C}/attributes/LastName`] },
				},
				{
					uri: `${C}/matchGroups/NoExact`,
					label: 'Fuzzy only',
					type: 'suspect',
					scope: 'ALL',
					rule: { fuzzy: [`${C}/attributes/LastName`] },
				},
			],
		},
	],
};
const step6Inv = inventoryMatchLabTypes(step6L3)[0];
const ruleBy = name => step6Inv.matchGroups.find(g => g.shortName === name);

// G7 — EON, negative-only, and hidden keys are excluded from exists() clauses
{
	const firing = occupancyKeysForRule(ruleBy('Firing'));
	assert.deepStrictEqual(firing.used.map(u => u.key), ['Email']);
	assert.deepStrictEqual(
		firing.skipped.find(s => s.key === 'Phone').reason,
		'exact-or-null',
	);
	assert.deepStrictEqual(
		firing.skipped.find(s => s.key === 'FirstName').reason,
		'negative-only',
	);

	const hiddenExact = occupancyKeysForRule(ruleBy('HiddenExact'));
	assert.deepStrictEqual(hiddenExact.used.map(u => u.key), ['LastName']);
	assert.strictEqual(
		hiddenExact.skipped.find(s => s.key === 'Secret').reason,
		'not mapped (hidden)',
	);

	const filter = existsAllAttributesFilter(C, ruleBy('Firing').exactAttributeUris);
	assert.strictEqual(filter, `equals(type,'${C}') and exists(attributes.Email)`);

	// nested attributes need their full dotted path, not just the last segment
	assert.strictEqual(attributeSearchPath(`${C}/attributes/SFDCCompanyID`), 'SFDCCompanyID');
	assert.strictEqual(
		attributeSearchPath(`${C}/attributes/Phone/attributes/FormattedNumber`),
		'Phone.FormattedNumber',
	);
	assert.strictEqual(
		existsAllAttributesFilter(C, [
			`${C}/attributes/Phone/attributes/FormattedNumber`,
			`${C}/attributes/Phone/attributes/CountryCode`,
		]),
		`equals(type,'${C}') and exists(attributes.Phone.FormattedNumber) and exists(attributes.Phone.CountryCode)`,
	);
	assert.strictEqual(
		existsAttributeFilter(C, `${C}/attributes/Email/attributes/Email`),
		`equals(type,'${C}') and exists(attributes.Email.Email)`,
	);
	assert.doesNotMatch(filter, /Phone/, 'exact-or-null key must not reach exists()');
	assert.doesNotMatch(filter, /FirstName/, 'negative-only key must not reach exists()');
	assert.doesNotMatch(
		existsAllAttributesFilter(C, occupancyKeysForRule(ruleBy('HiddenExact')).used.map(u => u.uri)),
		/Secret/,
		'hidden key must not reach exists()',
	);
}

// eligible = null with an explicit reason when a rule has no exact keys
{
	const filters = [];
	const elig = await eligibleForRules(
		{ countEntities: async (_b, _t, _tok, f) => { filters.push(f); return 12; } },
		'tst-01.reltio.com',
		'AakashSandbox',
		't',
		step6Inv,
	);
	const noExact = elig.find(e => e.ruleShortName === 'NoExact');
	assert.strictEqual(noExact.eligible, null);
	assert.strictEqual(noExact.reason, NO_EXACT_KEYS_REASON);
	assert.strictEqual(elig.find(e => e.ruleShortName === 'Firing').eligible, 12);
	assert.strictEqual(filters.length, 4, 'one count per rule that has exact keys');
	assert.ok(filters.every(f => f.includes('exists(attributes.')));
}

function fakePairs(n, rule, values) {
	return Array.from({ length: n }, (_, i) => ({
		entityTypeUri: C,
		ruleShortName: rule,
		ruleLabel: rule,
		profileAUri: `entities/a${i}`,
		profileBUri: `entities/b${i}`,
		profileALabel: '',
		profileBLabel: '',
		profileAHubUrl: '',
		profileBHubUrl: '',
		scope: '',
		whyItMatched: '',
		alsoMatchedBy: '',
		values: values ?? {},
	}));
}

// G6 — occupancy basis switches from rule pairs to pooled below 8 pairs
{
	const own = pairOccupancy(fakePairs(MIN_RULE_PAIRS_FOR_OWN_BASIS, 'Firing'), fakePairs(50, 'Firing'));
	assert.strictEqual(own.basis, "from this rule's pairs");
	assert.strictEqual(own.pairCount, MIN_RULE_PAIRS_FOR_OWN_BASIS);

	const pooled = pairOccupancy(fakePairs(MIN_RULE_PAIRS_FOR_OWN_BASIS - 1, 'Firing'), fakePairs(20, 'Firing'));
	assert.strictEqual(pooled.basis, 'from pooled pairs');
	assert.strictEqual(pooled.pairCount, 20);

	assert.strictEqual(pairOccupancy([], []).basis, 'no sampled pairs');
}

const emptyOcc = pairOccupancy([], []);

// G1 — a failed count reads as the count failing, never as no matches
{
	const rec = recommendRule({
		rule: ruleBy('PlainIdle'),
		census: {
			ruleUri: ruleBy('PlainIdle').uri,
			censusStatus: 'error',
			entitiesWithMatches: null,
			censusHttpStatus: 400,
		},
		eligibility: { ruleUri: '', ruleShortName: '', eligible: 9, keysUsed: ['LastName'], keysSkipped: [] },
		occupancy: emptyOcc,
	});
	assert.strictEqual(rec.recommendation, 'The count failed — unknown, not zero');
	assert.strictEqual(rec.signal, 'The count failed — cannot be judged');
	assert.match(rec.labNotes, /HTTP 400/);
	assert.doesNotMatch(rec.recommendation, /No potential matches/);
}

// G2 — no matches with scope INTERNAL is quiet, not under-matching
{
	const rule = ruleBy('InternalIdle');
	const rec = recommendRule({
		rule,
		census: { ruleUri: rule.uri, censusStatus: 'ok', entitiesWithMatches: 0 },
		eligibility: { ruleUri: rule.uri, ruleShortName: 'InternalIdle', eligible: 4, keysUsed: ['LastName'], keysSkipped: [] },
		occupancy: emptyOcc,
	});
	assert.strictEqual(rec.recommendation, 'No potential matches; scope is INTERNAL');
	assert.strictEqual(rec.signal, 'No matches, and nothing populates its keys', 'INTERNAL scope is expected to be quiet, not under-matching');
	assert.match(rec.labNotes, /only compares profiles from the same source/);
}

// G3 — a rule citing a hidden key with no matches needs review
{
	const rule = ruleBy('HiddenExact');
	const rec = recommendRule({
		rule,
		census: { ruleUri: rule.uri, censusStatus: 'ok', entitiesWithMatches: 0 },
		eligibility: {
			ruleUri: rule.uri,
			ruleShortName: 'HiddenExact',
			eligible: 6,
			keysUsed: ['LastName'],
			keysSkipped: [{ key: 'Secret', reason: 'not mapped (hidden)' }],
		},
		occupancy: emptyOcc,
	});
	assert.strictEqual(rec.recommendation, 'Cites keys hidden in L3 or absent from the mapping list');
	assert.match(rec.labNotes, /Secret/);
	assert.match(rec.keysInRule, /Secret \(not mapped\)/);

	// same rule, no hidden key cited -> plain no-potential-matches
	const plain = ruleBy('PlainIdle');
	const plainRec = recommendRule({
		rule: plain,
		census: { ruleUri: plain.uri, censusStatus: 'ok', entitiesWithMatches: 0 },
		eligibility: { ruleUri: plain.uri, ruleShortName: 'PlainIdle', eligible: 6, keysUsed: ['LastName'], keysSkipped: [] },
		occupancy: emptyOcc,
	});
	assert.strictEqual(plainRec.recommendation, 'No potential matches');
	// nothing matched although 6 profiles populate every exact key
	assert.strictEqual(plainRec.signal, 'No matches, though profiles do populate every key it needs');
	assert.match(
		plainRec.labNotes,
		/• 6 profiles have LastName filled in, so the data is there\. Either those values never repeat between profiles, or the match tables have not been rebuilt since the rule changed\./,
	);

	// no data to satisfy the rule is plainly not firing, not under-matching
	assert.strictEqual(
		recommendRule({
			rule: plain,
			census: { ruleUri: plain.uri, censusStatus: 'ok', entitiesWithMatches: 0 },
			eligibility: { ruleUri: plain.uri, ruleShortName: 'PlainIdle', eligible: 0, keysUsed: ['LastName'], keysSkipped: [] },
			occupancy: emptyOcc,
		}).signal,
		'No matches, and nothing populates its keys',
	);
}

// G4 — eligible > 0 suppresses any "never populated" wording
{
	const rule = ruleBy('Firing');
	const occ = pairOccupancy(
		fakePairs(10, 'Firing', { a_Phone: '', b_Phone: '', cmp_Phone: '' }),
		fakePairs(10, 'Firing', { a_Phone: '', b_Phone: '', cmp_Phone: '' }),
	);
	assert.ok(occ.columns.some(c => c.key === 'Phone' && c.aPopulated === 0));

	const withEligible = recommendRule({
		rule,
		census: { ruleUri: rule.uri, censusStatus: 'ok', entitiesWithMatches: 25 },
		eligibility: { ruleUri: rule.uri, ruleShortName: 'Firing', eligible: 31, keysUsed: ['Email'], keysSkipped: [] },
		occupancy: occ,
	});
	assert.strictEqual(withEligible.recommendation, 'Produces potential matches');
	assert.strictEqual(withEligible.signal, 'Matching, and nothing in the sample looks wrong');
	assert.doesNotMatch(withEligible.labNotes, /Empty in every sample pair/);
	assert.match(withEligible.labNotes, /31 profiles have Email filled in/);

	const withoutEligible = recommendRule({
		rule,
		census: { ruleUri: rule.uri, censusStatus: 'ok', entitiesWithMatches: 25 },
		eligibility: { ruleUri: rule.uri, ruleShortName: 'Firing', eligible: 0, keysUsed: ['Email'], keysSkipped: [] },
		occupancy: occ,
	});
	assert.match(withoutEligible.labNotes, /• Empty in every sample pair we checked: Phone\./);
}

// noisy name columns block any automatic wording; a name dictionary excuses first-name drift
{
	const noisyValues = { a_LastName: 'Ann', b_LastName: 'Zed', cmp_LastName: 'differ' };
	const occ = pairOccupancy(fakePairs(10, 'Firing', noisyValues), fakePairs(10, 'Firing', noisyValues));
	const rule = ruleBy('Firing');
	assert.deepStrictEqual(noisyNameColumns(rule, occ), ['LastName']);
	const rec = recommendRule({
		rule,
		census: { ruleUri: rule.uri, censusStatus: 'ok', entitiesWithMatches: 25 },
		eligibility: { ruleUri: rule.uri, ruleShortName: 'Firing', eligible: 31, keysUsed: ['Email'], keysSkipped: [] },
		occupancy: occ,
	});
	assert.strictEqual(rec.recommendation, 'Produces potential matches');
	assert.strictEqual(rec.signal, 'Matching, but the pairs disagree on a name', 'names that disagree while the rule joins the pair');
	assert.match(
		rec.labNotes,
		/• LastName is different in more than 20% of the sample pairs where both profiles have a value, so the rule may be matching different people\./,
	);

	const firstNameValues = { a_FirstName: 'Bob', b_FirstName: 'Robert', cmp_FirstName: 'differ' };
	const dictOcc = pairOccupancy(fakePairs(10, 'Firing', firstNameValues), fakePairs(10, 'Firing', firstNameValues));
	assert.deepStrictEqual(
		noisyNameColumns(rule, dictOcc),
		[],
		'NameDictionaryCleanser explains FirstName drift — not noise',
	);
	assert.deepStrictEqual(
		noisyNameColumns(ruleBy('PlainIdle'), dictOcc),
		['FirstName'],
		'without a dictionary cleanser the same drift is noise',
	);

	// CompanyName is not a person name; an attribute the rule ignores that differs is named instead
	const companyValues = { a_CompanyName: 'Acme', b_CompanyName: 'Globex', cmp_CompanyName: 'differ' };
	const companyOcc = pairOccupancy(fakePairs(10, 'Firing', companyValues), fakePairs(10, 'Firing', companyValues));
	assert.deepStrictEqual(noisyNameColumns(rule, companyOcc), [], 'CompanyName is not a person name');
	const companyRec = recommendRule({
		rule,
		census: { ruleUri: rule.uri, censusStatus: 'ok', entitiesWithMatches: 25 },
		eligibility: { ruleUri: rule.uri, ruleShortName: 'Firing', eligible: 31, keysUsed: ['Email'], keysSkipped: [] },
		occupancy: companyOcc,
	});
	assert.match(companyRec.labNotes, /• CompanyName is different in 100% of the sample pairs, but the rule does not check it/);
	assert.match(companyRec.labNotes, /Suggested Changes shows how to tighten the rule\./);
	assert.ok(companyRec.labNotes.split('\n').length <= 4, 'at most 4 bullet points');
	assert.doesNotMatch(companyRec.labNotes, /BasicStringComparator/);
}

// unmapped keys per the optional mapping list
{
	const mapping = parseMappingInput({ intendedAttributes: ['Email'] }, 'C:/tmp/mapping.json');
	assert.deepStrictEqual(mapping.intendedAttributes, ['Email']);
	assert.strictEqual(parseMappingInput({}, 'x'), undefined);
	const rule = ruleBy('Firing');
	const rec = recommendRule({
		rule,
		census: { ruleUri: rule.uri, censusStatus: 'ok', entitiesWithMatches: 25 },
		eligibility: { ruleUri: rule.uri, ruleShortName: 'Firing', eligible: 0, keysUsed: ['Email'], keysSkipped: [] },
		occupancy: emptyOcc,
		mapping,
	});
	assert.strictEqual(rec.recommendation, 'Cites keys hidden in L3 or absent from the mapping list');
	assert.match(rec.labNotes, /which your mapping file does not list/);
	// Lab notes are a short bullet list of plain sentences: no jargon, no semicolon-joined fragments.
	const bullets = rec.labNotes.split('\n');
	assert.ok(bullets.length >= 1 && bullets.length <= 4, 'at most 4 bullet points');
	for (const b of bullets) {
		assert.match(b, /^• [A-Z0-9]/, 'each note is a bullet that opens like a sentence');
		assert.ok(b.endsWith('.'), 'every note is a finished sentence');
	}
	assert.doesNotMatch(rec.labNotes, /;/);
	assert.doesNotMatch(rec.labNotes, /\beligible\b|\bL3\b|match token|exact keys|—/, 'no internal jargon');
}

// engine run: Rule notes recommendation, chatSummary labels
{
	const { dir, l3Path } = writeTempL3(step6L3);
	const mappingPath = path.join(dir, 'mapping.json');
	fs.writeFileSync(
		mappingPath,
		JSON.stringify({ intendedAttributes: ['Email', 'Phone', 'FirstName', 'LastName'] }),
	);

	const contactA = {
		uri: 'entities/c1',
		label: 'Ann',
		attributes: { Email: [{ value: 'a@x.com', ov: true }], FirstName: [{ value: 'Ann', ov: true }] },
	};
	const contactB = {
		uri: 'entities/c2',
		label: 'Anne',
		attributes: { Email: [{ value: 'a@x.com', ov: true }], FirstName: [{ value: 'Anne', ov: true }] },
	};
	const byUri = { 'entities/c1': contactA, 'entities/c2': contactB };
	const countFilters = [];

	const result = await runMatchLab('tst-01.reltio.com', 'AakashSandbox', 't', l3Path, {
		api: {
			getTenantMatchingStatus: async () => ({
				body: { Status: 'Green', 'Matching queue size': 0, 'Events queue size': 0 },
				text: '',
			}),
			countEntities: async (_b, _t, _tok, filter) => {
				const f = String(filter);
				countFilters.push(f);
				if (f.includes('exists(attributes.')) return 40;
				if (f.includes('gt(matches,0)')) return f.includes('Firing') ? 5 : 0;
				return 2;
			},
			searchEntities: async () => [contactA, contactB],
			getEntityMatches: async (_b, _t, _tok, id) => [
				{
					uri: String(id).includes('c1') ? 'entities/c2' : 'entities/c1',
					matchRules: [`${C}/matchGroups/Firing`],
				},
			],
			getEntitiesByUris: async (_b, _t, _tok, uris) => uris.map(u => byUri[u]).filter(Boolean),
		},
		tenantRoot: dir,
		sleep: async () => {},
		pollIntervalMs: 0,
		mappingFile: mappingPath,
	});

	const wb = JSON.parse(fs.readFileSync(path.join(dir, 'match-lab', 'Contact.json'), 'utf8'));
	assert.strictEqual(wb.tabOrder[2], 'Rule Overlap');
	assert.ok(!wb.tabs['Data Readiness']);
	assert.ok(wb.tabs['Rule Overlap']);
	assert.ok(
		countFilters.some(f => f.includes('matchRules') && f.split('matchRules').length > 2),
		'overlap filters name both rules',
	);

	// Rule Activity carries the status that Rule Analysis used to hold; Signal was removed
	const notes = wb.tabs['Rule Activity'];
	assert.ok(notes.columns.includes('Status'));
	assert.ok(!notes.columns.includes('Signal'));
	assert.ok(notes.columns.includes('Profiles with all rule keys populated'));
	assert.ok(notes.columns.includes('Keys in rule'));
	const notesByRule = new Map(notes.rows.map(r => [r.Rule, r]));
	assert.strictEqual(notesByRule.get('Firing').Status, 'Produces potential matches');
	assert.strictEqual(notesByRule.get('InternalIdle').Status, 'No potential matches; scope is INTERNAL');
	assert.strictEqual(notesByRule.get('HiddenExact').Status, 'Cites keys hidden in L3 or absent from the mapping list');
	assert.strictEqual(notesByRule.get('PlainIdle').Status, 'No potential matches');
	assert.ok(!('Signal' in notesByRule.get('Firing')));
	assert.strictEqual(notesByRule.get('Firing')['Profiles with all rule keys populated'], 40);
	assert.ok(notes.rows.every(r => !('Reltio Notes' in r) && !('Customer notes' in r)));

	// Every rule's pairs live on one tab, tagged by rule, in rule order
	const rules = wb.tabs.Rules;
	assert.ok(rules, 'the Rules tab replaces the per-rule tabs');
	assert.ok(!wb.tabs.Firing && !wb.tabs.PlainIdle, 'no tab is named after a rule');
	const ruleOrder = [...new Set(rules.rows.map(r => r.Rule))];
	assert.deepStrictEqual(
		ruleOrder,
		[...ruleOrder].sort((a, b) => String(a).localeCompare(String(b))),
		'pairs are grouped by rule in the same order Rule Activity lists them',
	);
	// The picker reads its options off Rule Activity, so an idle rule that contributed no
	// pair rows is still selectable and reads as empty rather than going missing.
	const idle = notes.rows.find(r => r.Rule === 'PlainIdle');
	assert.ok(idle, 'an idle rule still gets a Rule Activity row');
	assert.strictEqual(rules.rows.filter(r => r.Rule === 'PlainIdle').length, 0);

	// chatSummary is rule name + label only
	const summary = chatSummary(result);
	assert.match(summary, /Firing: Produces potential matches/);
	assert.match(summary, /InternalIdle: No potential matches; scope is INTERNAL/);
	assert.match(summary, /HiddenExact: Cites keys hidden in L3 or absent from the mapping list/);
	assert.doesNotMatch(summary, /a@x\.com/, 'no pair PII in chat');
	assert.doesNotMatch(summary, /entities\//, 'no entity URIs in chat');
	assert.doesNotMatch(summary, /exists\(|equals\(|gt\(matches/, 'no filters or rule JSON in chat');
	assert.doesNotMatch(summary, /configuration\//, 'no L3 URIs in chat');

	const covHtml = matchLabShellHtml({
		nonce: 'covnonce',
		csp: matchLabCsp('covnonce'),
		workbooks: [wb],
	});
	assert.match(covHtml, /data-tab="Rules"/);
	assert.doesNotMatch(covHtml, /data-tab="(Data Readiness|Rule Analysis)"/);
	assert.match(covHtml, /data-tab="Rule Overlap"/);
	assert.match(covHtml, /"Status":"Produces potential matches"/);
	// The picker the Rules tab narrows on is in the shell, hidden until that tab is open.
	assert.match(covHtml, /<select id="rule-picker">/);
	assert.match(covHtml, /id="rule-picker-wrap" hidden/);
	// A single entity type is named in the heading only, not again beside the rule picker.
	assert.doesNotMatch(covHtml, /picker-static/);
	assert.match(covHtml, /<h1 id="panel-title">Match Lab — Contact<\/h1>/);

	fs.rmSync(dir, { recursive: true, force: true });
}

// --- Recommendations tab: generated tightening suggestions ---
{
	const rule = ruleBy('Firing');
	// Email agrees on every comparable pair -> no discriminating power; Phone disagrees on most
	const pairs = Array.from({ length: 20 }, (_, i) => ({
		...fakePairs(1, 'Firing')[0],
		values: {
			cmp_Email: 'equal',
			cmp_Phone: i < 16 ? 'differ' : 'equal',
			cmp_LastName: i < 3 ? 'differ' : 'equal',
			cmp_Secret: 'differ',
		},
	}));
	const stats = discriminatorStats(pairs, rule, step6Inv);
	assert.ok(!stats.some(s => s.key === 'Email'), 'keys the rule already compares are not discriminators');
	assert.ok(!stats.some(s => s.key === 'Phone'), 'exact-or-null keys are still compared by the rule');
	const lastName = stats.find(s => s.key === 'LastName');
	assert.strictEqual(lastName.differ, 3);
	assert.strictEqual(lastName.bothPopulated, 20);
	assert.ok(Math.abs(lastName.differShare - 0.15) < 1e-9);

	// coverage gate: a column populated on both sides too rarely is not suggested
	const sparse = discriminatorStats(
		Array.from({ length: 20 }, (_, i) => ({
			...fakePairs(1, 'Firing')[0],
			values: { cmp_LastName: i < 4 ? 'differ' : '' },
		})),
		rule,
		step6Inv,
	);
	assert.strictEqual(rankDiscriminators(sparse).length, 0, 'low-coverage column is gated out');

	// disagreement gate: a column that always agrees would not reduce anything
	const constant = discriminatorStats(
		Array.from({ length: 20 }, () => ({
			...fakePairs(1, 'Firing')[0],
			values: { cmp_LastName: 'equal' },
		})),
		rule,
		step6Inv,
	);
	assert.strictEqual(rankDiscriminators(constant).length, 0, 'a column that never disagrees is gated out');

	// ranking is driven by measured fill rate × disagreement, not a hardcoded family list
	const stat = (key, family, differShare) => ({
		key,
		family,
		fillRate: null,
		score: null,
		pairs: 20,
		bothPopulated: 20,
		equal: Math.round(20 * (1 - differShare)),
		differ: Math.round(20 * differShare),
		oneSided: 0,
		bothBlank: 0,
		differShare,
		coverage: 1,
	});
	const rate = entries =>
		new Map(entries.map(([key, r]) => [key, { key, path: key, uri: key, populated: null, total: null, rate: r }]));

	// Sparse beats dense on disagreement alone, but loses once fill rate is known
	const sparseVsDense = [stat('Sparse', 'identifiers', 0.9), stat('Dense', 'other', 0.6)];
	assert.deepStrictEqual(
		rankDiscriminators(sparseVsDense, rate([['Sparse', 0.35], ['Dense', 1.0]])).map(s => s.key),
		['Dense', 'Sparse'],
		'0.35 x 0.9 = 0.315 loses to 1.0 x 0.6 = 0.6',
	);

	// below the fill-rate floor a key is dropped entirely
	assert.deepStrictEqual(
		rankDiscriminators([stat('Empty', 'identifiers', 0.9)], rate([['Empty', 0.05]])).map(s => s.key),
		[],
		'a key populated on 5% of profiles is not a discriminator',
	);

	// a key that never agrees is demoted: it cannot discriminate, only disable
	const alwaysDiffers = [stat('RecordId', 'identifiers', 1.0), stat('Company', 'name', 0.6)];
	const rankedDemote = rankDiscriminators(
		alwaysDiffers,
		rate([['RecordId', 1.0], ['Company', 1.0]]),
	);
	assert.deepStrictEqual(rankedDemote.map(s => s.key), ['Company', 'RecordId']);
	assert.strictEqual(rankedDemote[0].fillRate, 1.0);
	assert.ok(Math.abs(rankedDemote[0].score - 0.6) < 1e-9, 'score is fillRate x differShare');

	// an unmeasured fill rate is neutral rather than a free win
	const unmeasured = rankDiscriminators(
		[stat('Unknown', 'identifiers', 0.8), stat('Known', 'other', 0.8)],
		rate([['Known', 1.0]]),
	);
	assert.deepStrictEqual(unmeasured.map(s => s.key), ['Known', 'Unknown']);

	// gatedDiscriminators is what decides which attributes are worth a fill-rate count
	assert.deepStrictEqual(
		gatedDiscriminators(sparseVsDense).map(s => s.key),
		['Sparse', 'Dense'],
		'gating happens before any fill rate is measured',
	);

	// a measured fill rate decides availability, because one rule's sample can
	// under-cover an attribute the tenant populates well
	const thinInSample = {
		...stat('Mobile', 'phone', 0.7),
		bothPopulated: 6,
		equal: 2,
		differ: 4,
		oneSided: 14,
		differShare: 4 / 6,
		coverage: 0.3,
	};
	assert.deepStrictEqual(
		gatedDiscriminators([thinInSample]).map(s => s.key),
		[],
		'with nothing measured, sampled coverage is all there is to go on',
	);
	assert.deepStrictEqual(
		gatedDiscriminators([thinInSample], rate([['Mobile', 0.92]])).map(s => s.key),
		['Mobile'],
		'a 92% tenant fill rate admits it despite thin sampled coverage',
	);
	assert.deepStrictEqual(
		gatedDiscriminators([thinInSample], rate([['Mobile', 0.12]])).map(s => s.key),
		[],
		'a measured fill rate below the floor still rejects it',
	);
	assert.deepStrictEqual(
		rankDiscriminators([thinInSample], rate([['Mobile', 0.92]])).map(s => s.key),
		['Mobile'],
		'the ranker uses the same fill-rate-driven gate',
	);

	// disagreement has to be measurable on more than a couple of pairs
	assert.deepStrictEqual(
		gatedDiscriminators(
			[{ ...thinInSample, bothPopulated: 2, equal: 0, differ: 2, differShare: 1, coverage: 0.1 }],
			rate([['Mobile', 0.99]]),
		).map(s => s.key),
		[],
		'a perfect fill rate does not license ranking on two comparable pairs',
	);

	// and a well-populated attribute the pairs agree on still changes nothing
	assert.deepStrictEqual(
		gatedDiscriminators([stat('Country', 'address', 0)], rate([['Country', 1.0]])).map(s => s.key),
		[],
		'fill rate never overrides the disagreement requirement',
	);
}

// attributeFillRates: one total plus one count per attribute, cached, nested paths intact
{
	const attr = (uri, family) => ({ uri, name: uri.split('/').pop(), label: uri.split('/').pop(), family, hidden: false, maskSsn: false });
	const fillTypeInv = {
		entityTypeUri: C,
		shortName: 'Contact',
		label: 'Contact',
		attributes: [
			attr(`${C}/attributes/Email`, 'email'),
			attr(`${C}/attributes/Phone/attributes/FormattedNumber`, 'phone'),
		],
		matchGroups: [
			{
				uri: `${C}/matchGroups/R1`,
				shortName: 'R1',
				exactAttributeUris: [`${C}/attributes/Email`],
				exactOrNullAttributeUris: [],
			},
		],
	};

	const filters = [];
	const cache = new Map();
	const api = {
		countEntities: async (_b, _t, _tok, f) => {
			filters.push(f);
			if (!f.includes('exists(')) return 1000;
			return f.includes('Phone.FormattedNumber') ? 400 : 950;
		},
	};
	const rates = await attributeFillRates(api, 'h', 't', 'tok', fillTypeInv, [
		`${C}/attributes/Email`,
		`${C}/attributes/Phone/attributes/FormattedNumber`,
	], { cache });
	assert.strictEqual(rates.get('Email').rate, 0.95);
	assert.strictEqual(rates.get('FormattedNumber').rate, 0.4);
	assert.strictEqual(rates.get('FormattedNumber').path, 'Phone.FormattedNumber');
	assert.ok(
		filters.some(f => f.includes('exists(attributes.Phone.FormattedNumber)')),
		'nested attributes use their dotted path',
	);
	assert.strictEqual(filters.length, 3, 'one type total plus one count per attribute');

	// the recommendation skill reads these, so they have to describe the attribute
	assert.strictEqual(rates.get('FormattedNumber').depth, 2, 'nesting depth comes from the URI');
	assert.strictEqual(rates.get('Email').depth, 1);
	assert.strictEqual(rates.get('FormattedNumber').family, 'phone');
	assert.deepStrictEqual(rates.get('Email').inRules, ['R1'], 'a key already in a rule is not a new key');
	assert.deepStrictEqual(rates.get('FormattedNumber').inRules, []);

	// second call is served from cache
	const before = filters.length;
	await attributeFillRates(api, 'h', 't', 'tok', fillTypeInv, [`${C}/attributes/Email`], { cache });
	assert.strictEqual(filters.length, before, 'cached attributes are not re-counted');

	// a failed count yields null, never a fabricated rate
	const failing = await attributeFillRates(
		{ countEntities: async () => { throw new Error('boom'); } },
		'h', 't', 'tok', fillTypeInv, [`${C}/attributes/Email`],
	);
	assert.strictEqual(failing.get('Email').rate, null);
	assert.strictEqual(failing.get('Email').populated, null);

	// a cached null is not an answer: it is measured again rather than reported forever
	const retryCache = new Map(failing.get('Email') ? [[`${C}/attributes/Email`, failing.get('Email')]] : []);
	const retried = await attributeFillRates(api, 'h', 't', 'tok', fillTypeInv, [`${C}/attributes/Email`], {
		cache: retryCache,
	});
	assert.strictEqual(retried.get('Email').rate, 0.95, 'a failed count is retried, not cached as not measured');

	// one expired token must not burn a failed count per attribute
	let calls = 0;
	const expired = Object.assign(new Error('unauthorized'), { statusCode: 401 });
	const manyAttrs = Array.from({ length: 30 }, (_, i) => ({
		uri: `${C}/attributes/A${i}`,
		name: `A${i}`,
		label: `A${i}`,
		family: 'other',
		hidden: false,
		maskSsn: false,
	}));
	await assert.rejects(
		attributeFillRates(
			{
				countEntities: async (_b, _t, _tok, f) => {
					calls++;
					if (!f.includes('exists(')) return 100;
					throw expired;
				},
			},
			'h', 't', 'tok',
			{ ...fillTypeInv, attributes: manyAttrs },
			manyAttrs.map(a => a.uri),
			{ concurrency: 3 },
		),
		/unauthorized/,
		'a 401 aborts the pass',
	);
	assert.ok(calls <= 1 + 3 * 2, `401 stops the remaining lanes (issued ${calls} counts)`);

	// concurrency must not drop or duplicate an attribute
	const seen = [];
	const wide = Array.from({ length: 25 }, (_, i) => ({
		uri: `${C}/attributes/W${i}`,
		name: `W${i}`,
		label: `W${i}`,
		family: 'other',
		hidden: false,
		maskSsn: false,
	}));
	const wideRates = await attributeFillRates(
		{
			countEntities: async (_b, _t, _tok, f) => {
				if (!f.includes('exists(')) return 200;
				seen.push(f);
				return 100;
			},
		},
		'h', 't', 'tok',
		{ ...fillTypeInv, attributes: wide },
		wide.map(a => a.uri),
		{ concurrency: 6 },
	);
	assert.strictEqual(wideRates.size, 25, 'every attribute is measured');
	assert.strictEqual(new Set(seen).size, 25, 'no attribute is counted twice');

	// Data Quality: fill and uniqueness from one call, uniqueness counts are distinct values
	const dqCalls = [];
	const dqApi = {
		countEntities: async () => { throw new Error('counts must not be used when Data Quality answers'); },
		getDataQualityStatistic: async (_b, _t, _tok, type, attr) => {
			dqCalls.push(`${type}|${attr}`);
			if (attr === 'Phone.FormattedNumber') {
				return { fillRate: { exists: 400, missing: 600 }, uniqueness: { unique: 380, notUnique: 5 }, frequency: { '555': 9 } };
			}
			return {
				fillRate: { exists: 950, missing: 50 },
				uniqueness: { unique: 100, notUnique: 40 },
				frequency: { 'a@x.com': 3, '[unknown]': 200, 'b@x.com': 7 },
			};
		},
	};
	const dqRates = await attributeFillRates(dqApi, 'h', 't', 'tok', fillTypeInv, [
		`${C}/attributes/Email`,
		`${C}/attributes/Phone/attributes/FormattedNumber`,
	]);
	const dqEmail = dqRates.get('Email');
	assert.strictEqual(dqEmail.source, 'dataQuality');
	assert.strictEqual(dqEmail.rate, 0.95, 'fill = exists / (exists + missing)');
	assert.strictEqual(dqEmail.total, 1000);
	assert.strictEqual(dqEmail.uniqueValues, 100);
	assert.strictEqual(dqEmail.sharedValues, 40);
	assert.strictEqual(dqEmail.sharedProfileRate, (950 - 100) / 950, 'profiles whose value is not one of the unique values');
	assert.deepStrictEqual(dqEmail.topValues[0], { value: '[unknown]', count: 200 }, 'top values come from frequency, highest first');
	assert.ok(dqCalls.includes(`${C}|Phone.FormattedNumber`), 'nested attributes use their dotted path');

	// a cached row from before Data Quality is measured again so uniqueness appears
	const oldCache = new Map([[`${C}/attributes/Email`, { ...rates.get('Email'), source: undefined }]]);
	const upgraded = await attributeFillRates(dqApi, 'h', 't', 'tok', fillTypeInv, [`${C}/attributes/Email`], { cache: oldCache });
	assert.strictEqual(upgraded.get('Email').source, 'dataQuality');

	// a tenant without Data Quality falls back to counts and is not asked again
	let dqTried = 0;
	const noDq = await attributeFillRates(
		{
			countEntities: api.countEntities,
			getDataQualityStatistic: async () => {
				dqTried++;
				throw Object.assign(new Error('not found'), { statusCode: 404 });
			},
		},
		'h', 't', 'tok', { ...fillTypeInv, attributes: wide }, wide.map(a => a.uri), { concurrency: 1 },
	);
	assert.strictEqual(noDq.get('W0').source, 'count');
	assert.strictEqual(noDq.get('W0').rate, 0.95);
	assert.strictEqual(dqTried, 1, 'a 404 from Data Quality stops further Data Quality calls');
}

// uniqueness turns into a hard ceiling and a filter on fill-only keys
{
	const { maxCensusAfterExact, fillRateCandidates } = importDist('matchLab/reductionSuggestions');
	const dq = (key, o) => ({
		key, name: key, path: key, uri: `${C}/attributes/${key}`, family: 'other', depth: 1, inRules: [],
		total: 1000, source: 'dataQuality', topValues: [], ...o,
	});
	const recordId = dq('RecordId', { family: 'identifiers', populated: 900, rate: 0.9, uniqueValues: 890, sharedValues: 5, sharedProfileRate: 10 / 900 });
	const kind = dq('Kind', { family: 'identifiers', populated: 990, rate: 0.99, uniqueValues: 0, sharedValues: 4, sharedProfileRate: 1 });
	const company = dq('Company', {
		populated: 800, rate: 0.8, uniqueValues: 300, sharedValues: 120, sharedProfileRate: 500 / 800,
		topValues: [{ value: '[unknown]', count: 236 }],
	});

	assert.strictEqual(maxCensusAfterExact(5000, [company]), 500, 'only profiles sharing a value can still match');
	assert.strictEqual(maxCensusAfterExact(5000, [company, recordId]), 10, 'every exact key caps the count');
	assert.strictEqual(maxCensusAfterExact(200, [company]), 200, 'never above the current count');
	assert.strictEqual(maxCensusAfterExact(5000, [company, { ...kind, source: 'count' }]), null);

	const rule = {
		uri: `${C}/matchGroups/R`, shortName: 'R', exactAttributeUris: [], exactOrNullAttributeUris: [],
		comparedAttributeUris: [], negativeOnlyAttributeUris: [], hiddenAttributeUris: [],
	};
	const meta = f => ({ uri: f.uri, name: f.key, label: f.key, family: f.family, hidden: false, maskSsn: false, dataType: 'String' });
	const inv = { entityTypeUri: C, attributes: [recordId, kind, company].map(meta), matchGroups: [rule] };
	const picked = fillRateCandidates(rule, inv, new Map([recordId, kind, company].map(f => [f.key, f]))).map(f => f.key);
	assert.deepStrictEqual(picked, ['Company'], 'near-unique and few-value keys are not proposed on fill rate alone');

	const email = dq('Email', { family: 'email', populated: 700, rate: 0.7, uniqueValues: 680, sharedValues: 10, sharedProfileRate: 20 / 700 });
	const emailInv = { ...inv, attributes: [...inv.attributes, meta(email)] };
	assert.ok(
		fillRateCandidates(rule, emailInv, new Map([[email.key, email]])).some(f => f.key === 'Email'),
		'email is expected to be near-unique, so uniqueness alone does not rule it out',
	);
}

// only identity-like attributes are proposed as keys
{
	const { isKeyCandidate, gatedDiscriminators } = importDist('matchLab/reductionSuggestions');
	const { classifyAttrFamily } = importDist('matchLab/attributeFamilies');
	const attr = (path, family, dataType, parentPath) => ({
		uri: `${C}/attributes/${path.split('.').join('/attributes/')}`,
		name: path.split('.').pop(),
		label: path.split('.').pop(),
		family,
		hidden: false,
		maskSsn: false,
		dataType,
		...(parentPath ? { parentUri: `${C}/attributes/${parentPath}` } : {}),
	});
	const attrs = [
		attr('CreatedDate', 'other', 'Date'),
		attr('contactProfileScore6sense', 'other', 'Int'),
		attr('Title', 'other', 'String'),
		attr('Username', classifyAttrFamily(`${C}/attributes/Username`, 'Username'), 'String'),
		attr('Email', 'email', 'Nested'),
		attr('Email.Email', 'email', 'String', 'Email'),
		attr('Email.Username', 'other', 'String', 'Email'),
		attr('Email.Domain', 'other', 'String', 'Email'),
		attr('Phone', 'phone', 'Nested'),
		attr('Phone.Number', 'other', 'String', 'Phone'),
		attr('Phone.CountryCode', 'address', 'String', 'Phone'),
		attr('Address.AddressType', 'address', 'String'),
		attr('LastName', 'name', 'String'),
		attr('DateOfBirth', 'demographics', 'Date'),
		attr('SFDCCompanyID', 'identifiers', 'String'),
		attr('Website', 'other', 'URL'),
	];
	const byUri = new Map(attrs.map(a => [a.uri, a]));
	const keyable = attrs.filter(a => isKeyCandidate(a, byUri)).map(a => a.uri.replace(`${C}/attributes/`, ''));
	assert.deepStrictEqual(keyable, [
		'Email/attributes/Email',
		'Phone/attributes/Number',
		'LastName',
		'DateOfBirth',
		'SFDCCompanyID',
		'Website',
	], 'dates, scores, titles, logins, type codes and cleanser-derived email parts are not keys');
	assert.strictEqual(classifyAttrFamily(`${C}/attributes/Username`, 'Username'), 'other', 'a login handle is not a name');
	assert.strictEqual(classifyAttrFamily(`${C}/attributes/LastName`, 'LastName'), 'name');

	const stat = key => ({ key, family: 'other', fillRate: null, score: null, pairs: 20, bothPopulated: 18, equal: 4, differ: 14, oneSided: 0, bothBlank: 2, differShare: 14 / 18, coverage: 0.9 });
	const fewValues = { key: 'Region', source: 'dataQuality', rate: 0.9, family: 'address', uniqueValues: 0, sharedValues: 6, sharedProfileRate: 1 };
	assert.deepStrictEqual(
		gatedDiscriminators([stat('Region')], new Map([['Region', fewValues]])),
		[],
		'the Data Quality uniqueness gate applies to sampled keys too, not only fill-only ones',
	);
}

// allAttributeUris: the full-scope input the Fill rates tab and the skill depend on
{
	const { allAttributeUris, attributeDepth, rulesUsingAttribute } = importDist('matchLab/fillRates');
	const typeInv = {
		entityTypeUri: C,
		attributes: [
			{ uri: `${C}/attributes/Email`, name: 'Email', label: 'Email', family: 'email', hidden: false, maskSsn: false },
			{ uri: `${C}/attributes/Email`, name: 'Email', label: 'Email', family: 'email', hidden: false, maskSsn: false },
			{ uri: `${C}/attributes/Address/attributes/City`, name: 'City', label: 'City', family: 'address', hidden: false, maskSsn: false },
			{ uri: `${C}/attributes/SSN`, name: 'SSN', label: 'SSN', family: 'identifiers', hidden: true, maskSsn: true },
		],
		matchGroups: [
			{ shortName: 'R1', exactAttributeUris: [], exactOrNullAttributeUris: [`${C}/attributes/Address/attributes/City`] },
			{ shortName: 'R2', exactAttributeUris: [`${C}/attributes/Email`], exactOrNullAttributeUris: [] },
		],
	};
	assert.deepStrictEqual(allAttributeUris(typeInv), [
		`${C}/attributes/Email`,
		`${C}/attributes/Address/attributes/City`,
		`${C}/attributes/SSN`,
	], 'nested attributes are included and duplicates collapse');
	assert.strictEqual(attributeDepth(`${C}/attributes/Address/attributes/City`), 2);
	assert.deepStrictEqual(
		rulesUsingAttribute(typeInv, `${C}/attributes/Address/attributes/City`),
		['R1'],
		'exactOrNull keys count as already in use',
	);
	assert.deepStrictEqual(rulesUsingAttribute(typeInv, `${C}/attributes/SSN`), []);
}

// fill-rate cache sidecar: reuse is bounded by engine, type, scope and age
{
	const { fillRateCacheUsable, readFillRateCache, writeFillRateCache, fillRateCachePath } =
		importDist('matchLab/sidecar');
	const now = new Date('2026-01-10T00:00:00.000Z');
	const base = {
		engineVersion: MATCH_LAB_ENGINE_VERSION,
		entityTypeUri: C,
		measuredAt: '2026-01-09T00:00:00.000Z',
		scope: 'all',
		typeTotal: 1000,
		rows: [],
	};
	const want = { engineVersion: MATCH_LAB_ENGINE_VERSION, entityTypeUri: C, scope: 'all', maxAgeHours: 168, now };
	assert.strictEqual(fillRateCacheUsable(base, want), true);
	assert.strictEqual(fillRateCacheUsable(undefined, want), false);
	assert.strictEqual(fillRateCacheUsable({ ...base, engineVersion: '0.0-old' }, want), false, 'a different engine re-measures');
	assert.strictEqual(fillRateCacheUsable({ ...base, entityTypeUri: `${C}X` }, want), false);
	assert.strictEqual(
		fillRateCacheUsable({ ...base, scope: 'candidates' }, want),
		false,
		'a candidate-scope cache cannot answer a full-scope request',
	);
	assert.strictEqual(
		fillRateCacheUsable({ ...base, scope: 'candidates' }, { ...want, scope: 'candidates' }),
		true,
		'but it can answer a candidate-scope one',
	);
	assert.strictEqual(
		fillRateCacheUsable({ ...base, measuredAt: '2025-12-01T00:00:00.000Z' }, want),
		false,
		'an expired cache re-measures',
	);
	assert.strictEqual(fillRateCacheUsable({ ...base, measuredAt: 'not a date' }, want), false);

	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-lab-cache-'));
	assert.strictEqual(await readFillRateCache(dir, 'Contact'), undefined, 'a missing cache is not an error');
	await writeFillRateCache(dir, 'Contact', base);
	assert.ok(fs.existsSync(fillRateCachePath(dir, 'Contact')));
	assert.strictEqual((await readFillRateCache(dir, 'Contact')).typeTotal, 1000);
	fs.rmSync(dir, { recursive: true, force: true });
}

// agent write-back: the skill's proposals replace the generated Suggested Changes rows
{
	const { applyAgentSuggestions } = importDist('matchLab/workbook');
	const workbook = {
		host: 'h',
		tenantId: 't',
		entityType: 'Contact',
		entityTypeUri: C,
		generatedAt: '2026-01-10T00:00:00.000Z',
		engineVersion: MATCH_LAB_ENGINE_VERSION,
		tabOrder: ['Summary', 'Suggested Changes'],
		tabs: {
			Summary: { columns: ['Section', 'Detail'], rows: [] },
			'Suggested Changes': { columns: ['Rule'], rows: [{ Rule: 'generated' }], docs: 'original docs' },
		},
	};
	const file = {
		engineVersion: MATCH_LAB_ENGINE_VERSION,
		entityTypeUri: C,
		generatedAt: '2026-01-11T00:00:00.000Z',
		generatedBy: 'match-rule-recommendations',
		columns: ['Rule', 'Basis'],
		rows: [{ Rule: 'R1', Basis: 'Email is populated on 95% of profiles' }],
	};
	const applied = applyAgentSuggestions(workbook, file);
	const tab = applied.tabs['Suggested Changes'];
	assert.deepStrictEqual(tab.columns, ['Rule', 'Basis']);
	assert.strictEqual(tab.rows.length, 1, 'only the agent rows — no banner row');
	assert.strictEqual(tab.rows[0].Rule, 'R1');
	assert.strictEqual(tab.docs, 'original docs', 'the tab keeps its own documentation');
	assert.deepStrictEqual(applied.tabOrder, workbook.tabOrder, 'the tab order is untouched');
	assert.strictEqual(workbook.tabs['Suggested Changes'].rows[0].Rule, 'generated', 'the input workbook is not mutated');

	// Removed columns are dropped even when an older agent file still writes them
	const withOldColumns = applyAgentSuggestions(workbook, {
		...file,
		columns: ['Priority', 'Rule', 'Confidence', 'Evidence', 'Notes', 'After (range)'],
		rows: [{ Priority: '1', Rule: 'R1', Confidence: 'projected', Evidence: 'x', Notes: 'n', 'After (range)': 'a' }],
	}).tabs['Suggested Changes'];
	assert.deepStrictEqual(withOldColumns.columns, ['Rule', 'After (range)']);
	assert.deepStrictEqual(withOldColumns.rows[0], { Rule: 'R1', 'After (range)': 'a' });

	// a file from another engine or type cannot pass itself off as current analysis
	assert.strictEqual(
		applyAgentSuggestions(workbook, { ...file, engineVersion: '0.0-old' }).tabs['Suggested Changes'].rows[0].Rule,
		'generated',
		'a stale agent file is ignored',
	);
	assert.strictEqual(
		applyAgentSuggestions(workbook, { ...file, rows: [] }).tabs['Suggested Changes'].rows[0].Rule,
		'generated',
	);
	assert.strictEqual(
		applyAgentSuggestions(workbook, undefined).tabs['Suggested Changes'].rows[0].Rule,
		'generated',
	);
}

// full-scope runs: the tab appears, the pass is cached, and a rerun does not re-count
{
	const { dir, l3Path } = writeTempL3(hiddenL3);
	const firstCounts = [];
	await runMatchLab('tst-01.reltio.com', 'AakashSandbox', 't', l3Path, {
		api: makeApi({ count: f => firstCounts.push(String(f)) }),
		tenantRoot: dir,
		sleep: async () => {},
		pollIntervalMs: 0,
		fillRateScope: 'all',
	});

	const wb = JSON.parse(fs.readFileSync(path.join(dir, 'match-lab', 'Person.json'), 'utf8'));
	assert.ok(!wb.tabOrder.includes('Fill rates'), 'fill rates are measured but not shown as a tab');
	assert.strictEqual(wb.tabOrder[wb.tabOrder.indexOf('Rule Activity') + 1], 'Rule Overlap');

	const cacheFile = path.join(dir, 'match-lab', 'Person.fill-rates.json');
	assert.ok(fs.existsSync(cacheFile), 'a full pass is cached so it is paid for once');
	const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
	assert.strictEqual(cache.scope, 'all');
	assert.strictEqual(cache.engineVersion, MATCH_LAB_ENGINE_VERSION);
	assert.ok(cache.rows.length > 0);
	assert.ok(
		cache.rows.some(r => r.key === 'Secret'),
		'a hidden attribute is still measured — a reviewer needs to know it holds data',
	);
	assert.ok(cache.rows.some(r => r.inRules.length > 0), 'attributes already used as keys are marked as such');

	// the second run reuses it rather than issuing the same exists() counts again
	const secondCounts = [];
	await runMatchLab('tst-01.reltio.com', 'AakashSandbox', 't', l3Path, {
		api: makeApi({ count: f => secondCounts.push(String(f)) }),
		tenantRoot: dir,
		sleep: async () => {},
		pollIntervalMs: 0,
		fillRateScope: 'all',
	});
	// SSN and Secret are not exact keys of any rule, so only the fill-rate pass counts them.
	const existsCounts = list =>
		list.filter(f => /exists\(attributes\.(SSN|Secret)\)/.test(f)).length;
	assert.ok(existsCounts(firstCounts) > 0, 'the first run measured fill rates');
	assert.strictEqual(existsCounts(secondCounts), 0, 'a fresh cache costs no counts');

	// an expired cache is measured again rather than shown as current
	const stale = { ...cache, measuredAt: '2020-01-01T00:00:00.000Z' };
	fs.writeFileSync(cacheFile, JSON.stringify(stale), 'utf8');
	const thirdCounts = [];
	await runMatchLab('tst-01.reltio.com', 'AakashSandbox', 't', l3Path, {
		api: makeApi({ count: f => thirdCounts.push(String(f)) }),
		tenantRoot: dir,
		sleep: async () => {},
		pollIntervalMs: 0,
		fillRateScope: 'all',
	});
	assert.ok(existsCounts(thirdCounts) > 0, 'an expired cache re-measures');

	// an aborted pass must not leave a cache claiming the tenant was measured
	fs.rmSync(cacheFile);
	const unauthorized = Object.assign(new Error('unauthorized'), { statusCode: 401 });
	await assert.rejects(
		runMatchLab('tst-01.reltio.com', 'AakashSandbox', 't', l3Path, {
			api: {
				...makeApi(),
				countEntities: async (_b, _t, _tok, f) => {
					if (String(f).includes('exists(attributes.')) throw unauthorized;
					return 100;
				},
			},
			tenantRoot: dir,
			sleep: async () => {},
			pollIntervalMs: 0,
			fillRateScope: 'all',
		}),
		/unauthorized/,
	);
	assert.ok(!fs.existsSync(cacheFile), 'no cache is written when the run aborts on 401');

	fs.rmSync(dir, { recursive: true, force: true });

	// the default scope leaves the tab out entirely rather than showing a partial one
	const plain = writeTempL3(hiddenL3);
	await runMatchLab('tst-01.reltio.com', 'AakashSandbox', 't', plain.l3Path, {
		api: makeApi(),
		tenantRoot: plain.dir,
		sleep: async () => {},
		pollIntervalMs: 0,
	});
	const plainWb = JSON.parse(fs.readFileSync(path.join(plain.dir, 'match-lab', 'Person.json'), 'utf8'));
	assert.ok(!plainWb.tabs['Fill rates'], 'no Fill rates tab');
	assert.ok(
		!fs.existsSync(path.join(plain.dir, 'match-lab', 'Person.fill-rates.json')),
		'candidate scope writes no cache',
	);
	fs.rmSync(plain.dir, { recursive: true, force: true });
}

// the panel picks up the skill's file without the engine running again
{
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-lab-panel-'));
	const labDir = path.join(dir, 'match-lab');
	fs.mkdirSync(labDir, { recursive: true });
	const wb = {
		host: 'h',
		tenantId: 't',
		entityType: 'Contact',
		entityTypeUri: C,
		generatedAt: '2026-01-10T00:00:00.000Z',
		engineVersion: MATCH_LAB_ENGINE_VERSION,
		tabOrder: ['Summary', 'Suggested Changes'],
		tabs: {
			Summary: { columns: ['Section', 'Detail'], rows: [] },
			'Suggested Changes': { columns: ['Rule'], rows: [{ Rule: 'generated' }] },
		},
	};
	fs.writeFileSync(path.join(labDir, 'Contact.json'), JSON.stringify(wb), 'utf8');
	fs.writeFileSync(
		path.join(labDir, 'Contact.fill-rates.json'),
		JSON.stringify({ engineVersion: MATCH_LAB_ENGINE_VERSION, entityTypeUri: C, measuredAt: '', scope: 'all', typeTotal: 1, rows: [] }),
		'utf8',
	);
	fs.writeFileSync(
		path.join(labDir, 'Contact.suggestions.json'),
		JSON.stringify({
			engineVersion: MATCH_LAB_ENGINE_VERSION,
			entityTypeUri: C,
			generatedAt: '2026-01-11T00:00:00.000Z',
			generatedBy: 'match-rule-recommendations',
			columns: ['Rule', 'Basis'],
			rows: [{ Rule: 'ExactName', Basis: 'Email is populated on 95% of profiles' }],
		}),
		'utf8',
	);

	const loaded = await loadEntityWorkbooks(dir);
	assert.strictEqual(loaded.length, 1, 'the companion sidecars are not mistaken for workbooks');
	assert.strictEqual(loaded[0].entityType, 'Contact');
	const tab = loaded[0].tabs['Suggested Changes'];
	assert.strictEqual(tab.rows[0].Rule, 'ExactName');
	// An imported analyzer result renders on reopening the panel — no re-run needed.
	fs.rmSync(dir, { recursive: true, force: true });
}

// --- Rule Overlap tab ---
{
	const { overlapFilterForRules, measureRuleOverlap } = importDist('matchLab/ruleOverlap');
	const { ruleOverlapTab, RULE_OVERLAP_COLUMNS } = importDist('matchLab/workbook');
	const uriA = `${C}/matchGroups/RuleA`;
	const uriB = `${C}/matchGroups/RuleB`;
	const filter = overlapFilterForRules(C, uriA, uriB);
	assert.ok(filter.includes(uriA) && filter.includes(uriB) && filter.includes('matchRules'));
	const rows = await measureRuleOverlap(
		{ countEntities: async (_b, _t, _k, f) => (f === filter ? 3 : f.includes(uriA) ? 10 : 8) },
		'h',
		't',
		'tok',
		{
			entityTypeUri: C,
			shortName: 'Contact',
			label: 'Contact',
			attributes: [],
			matchGroups: [
				{ uri: uriA, shortName: 'RuleA', label: 'A', type: 'suspect', scope: 'ALL', isFern: false, hiddenAttributeUris: [], exactAttributeUris: [], comparedAttributeUris: [] },
				{ uri: uriB, shortName: 'RuleB', label: 'B', type: 'suspect', scope: 'ALL', isFern: false, hiddenAttributeUris: [], exactAttributeUris: [], comparedAttributeUris: [] },
			],
		},
		[
			{ ruleUri: uriA, ruleShortName: 'RuleA', censusStatus: 'ok', entitiesWithMatches: 10 },
			{ ruleUri: uriB, ruleShortName: 'RuleB', censusStatus: 'ok', entitiesWithMatches: 8 },
		],
	);
	assert.strictEqual(rows.length, 1);
	assert.strictEqual(rows[0].both, 3);
	assert.strictEqual(rows[0].shareOfA, 0.3);
	const tab = ruleOverlapTab(rows);
	assert.deepStrictEqual(tab.columns, RULE_OVERLAP_COLUMNS);
	assert.match(tab.rows[0].Finding, /both rules/);

	// one hand-built rule: the tab stays and says why there is nothing to compare
	const oneRule = {
		entityTypeUri: C, shortName: 'Course', label: 'Course', attributes: [],
		matchGroups: [
			{ uri: uriA, shortName: 'ExactTitle', isFern: false },
			{ uri: uriB, shortName: 'Ml', isFern: true },
		],
	};
	const single = ruleOverlapTab([], oneRule);
	assert.strictEqual(single.rows.length, 0);
	assert.match(single.docs, /^Reason: ExactTitle is the only hand-built rule on Course, so there is no other rule to compare it with\. Its 1 ML \(FERN\) rule/);
}

// read-only scope: no job start, no rebuild, no token deletion anywhere in the extension
{
	const srcDir = path.join(repoRoot, 'src');
	const files = [];
	(function walk(d) {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) walk(p);
			else if (e.name.endsWith('.ts')) files.push(p);
		}
	})(srcDir);
	// Comments are stripped first: the modules name these endpoints precisely to record
	// that they are off limits, and a guard that punished saying so would delete the note.
	const all = files
		.map(f => fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''))
		.join('\n');
	assert.ok(
		!/analyzeMatchRules/.test(all),
		'Match Lab is read-only: it imports an analyzer result rather than starting the profiling job',
	);
	assert.ok(!/rebuildMatchTable|rebuildmatchtable|_rebuildMatchTables/i.test(all), 'no rebuild job');
	assert.ok(
		!/removeOvercollisionedTokens/i.test(all),
		'finding an over-collisioned token is a reason to look at a rule, not licence to delete tokens',
	);
	assert.doesNotMatch(all, /matchTokens/, 'the Token Phrases tab is gone, so stored match tokens are never read');
}

// the playbook the skill ships as
{
	const skill = path.join(repoRoot, 'skills', 'reltio-default', 'match-rule-recommendations', 'SKILL.md');
	assert.ok(fs.existsSync(skill), 'match-rule-recommendations playbook');
	const text = fs.readFileSync(skill, 'utf8');
	for (const section of ['## When to use', '## Inputs', '## Procedure', '## Boundaries', '## Outputs']) {
		assert.ok(text.includes(section), `playbook has ${section}`);
	}
	assert.ok(/fillRateScope/.test(text), 'it states the setting the Fill rates tab depends on');
	assert.ok(/suggestions\.json/.test(text), 'it documents where to write its proposals');
	assert.ok(/not measured/.test(text), 'it repeats that a failed count is not zero');
	assert.ok(/never edit L3/i.test(text));
	assert.ok(
		!/Data Readiness|candidatesFile/.test(text),
		'it does not point at tabs or settings that no longer exist',
	);

	const pointer = path.join(repoRoot, '.cursor', 'skills', 'reltio-match-rule-recommendations', 'SKILL.md');
	assert.ok(fs.existsSync(pointer), 'pointer skill');

	const review = fs.readFileSync(
		path.join(repoRoot, 'skills', 'reltio-default', 'match-lab-review', 'SKILL.md'),
		'utf8',
	);
	assert.ok(
		/reltio-match-rule-recommendations/.test(review),
		'the review playbook hands off to the recommendations one',
	);
	assert.ok(/Fill rates/.test(review), 'the review playbook documents the new tab');
}

// --- xlsx writer: the output has to be a file Excel will actually open ---
{
	const { buildXlsx, columnRef, sheetName, workbookSheets } = {
		...importDist('matchLab/xlsx'),
		...importDist('matchLab/sidecar'),
	};

	assert.strictEqual(columnRef(0), 'A');
	assert.strictEqual(columnRef(25), 'Z');
	assert.strictEqual(columnRef(26), 'AA');
	assert.strictEqual(columnRef(51), 'AZ');

	// Excel rejects these outright, so a rule named with a slash must not produce a broken file
	const taken = new Set();
	assert.strictEqual(sheetName('Rule/One', taken), 'Rule-One');
	assert.strictEqual(sheetName('Rule\\One', taken), 'Rule-One (2)', 'a collision is renamed, not dropped');
	assert.strictEqual(sheetName('Rule[One]', taken), 'Rule-One-');
	assert.ok(sheetName('x'.repeat(60), taken).length <= 31);

	const buf = buildXlsx([
		{
			name: 'Summary',
			columns: ['Section', 'Detail'],
			rows: [
				{ Section: 'Entity type', Detail: 'Contact' },
				{ Section: 'Profiles', Detail: '390,910' },
				{ Section: 'Note', Detail: 'Bob & Robert <match> "exactly"' },
			],
		},
		{ name: 'Rule Activity', columns: ['Rule'], rows: [{ Rule: 'ExactName' }] },
	]);

	const entries = unzip(buf);
	for (const part of [
		'[Content_Types].xml',
		'_rels/.rels',
		'xl/workbook.xml',
		'xl/_rels/workbook.xml.rels',
		'xl/styles.xml',
		'xl/worksheets/sheet1.xml',
		'xl/worksheets/sheet2.xml',
	]) {
		assert.ok(entries.has(part), `the package contains ${part}`);
	}
	const wbXml = entries.get('xl/workbook.xml');
	assert.match(wbXml, /<sheet name="Summary" sheetId="1" r:id="rId1"\/>/);
	assert.match(wbXml, /<sheet name="Rule Activity" sheetId="2" r:id="rId2"\/>/);

	const sheet1 = entries.get('xl/worksheets/sheet1.xml');
	assert.match(sheet1, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
	assert.match(sheet1, /<autoFilter ref="A1:B1"\/>/);
	assert.match(sheet1, /<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Section<\/t><\/is><\/c>/);
	assert.match(
		sheet1,
		/<c r="B3" s="2"><v>390910<\/v><\/c>/,
		'a formatted count becomes a real number so Excel can sort and total it',
	);
	assert.match(
		sheet1,
		/Bob &amp; Robert &lt;match&gt; &quot;exactly&quot;/,
		'text is escaped rather than breaking the XML',
	);
	assert.ok(!/<sheetData>.*undefined/.test(sheet1));

	// docs become a leading row, since a spreadsheet has nowhere else to put them
	const docSheets = workbookSheets({
		tabOrder: ['Rule Activity'],
		tabs: { 'Rule Activity': { columns: ['Rule', 'Type'], rows: [{ Rule: 'A', Type: 'suspect' }], docs: 'read me' } },
	});
	assert.strictEqual(docSheets[0].rows.length, 3, 'docs row, blank row, then the data');
	assert.strictEqual(docSheets[0].rows[0].Rule, 'read me');
	assert.strictEqual(docSheets[0].rows[2].Type, 'suspect');
}

// engine run: Recommendations tab sits after How to use and carries measured suggestions
{
	const broadL3 = JSON.parse(JSON.stringify(step6L3));
	broadL3.entityTypes[0].attributes.push({
		uri: `${C}/attributes/CountryCode`,
		name: 'CountryCode',
		label: 'Country Code',
	});
	broadL3.entityTypes[0].matchGroups = [
		{
			uri: `${C}/matchGroups/Broad`,
			label: 'Exact last name only',
			type: 'suspect',
			scope: 'ALL',
			rule: { exact: [`${C}/attributes/LastName`] },
		},
	];
	const { dir, l3Path } = writeTempL3(broadL3);

	// 20 seeds pairing into 10 pairs, all sharing LastName. Email agrees on 2 pairs and
	// CountryCode on 5, overlapping on only 1 — so the combination is stricter than either.
	const emailAgrees = new Set([8, 9]);
	const countryAgrees = new Set([0, 1, 2, 3, 8]);
	const seeds = [];
	for (let p = 0; p < 10; p++) {
		for (const side of [0, 1]) {
			const i = p * 2 + side;
			seeds.push({
				uri: `entities/p${i}`,
				label: `P${i}`,
				attributes: {
					LastName: [{ value: 'Smith', ov: true }],
					Email: [{ value: emailAgrees.has(p) ? `pair${p}@x.com` : `p${i}@x.com`, ov: true }],
					CountryCode: [
						{ value: countryAgrees.has(p) || side === 0 ? 'US' : 'CA', ov: true },
					],
				},
			});
		}
	}
	const byUri = Object.fromEntries(seeds.map(s => [s.uri, s]));
	const partnerOf = uri => {
		const n = Number(String(uri).replace('entities/p', ''));
		return `entities/p${n % 2 === 0 ? n + 1 : n - 1}`;
	};
	const countCalls = [];

	await runMatchLab('tst-01.reltio.com', 'AakashSandbox', 't', l3Path, {
		api: {
			getTenantMatchingStatus: async () => ({
				body: { Status: 'Green', 'Matching queue size': 0, 'Events queue size': 0 },
				text: '',
			}),
			countEntities: async (_b, _t, _tok, filter) => {
				const f = String(filter);
				countCalls.push(f);
				if (f.includes('gt(matches,0)')) return 1200;
				return 900;
			},
			searchEntities: async () => seeds,
			getEntityMatches: async (_b, _t, _tok, id) => [
				{ uri: partnerOf(id), matchRules: [`${C}/matchGroups/Broad`] },
			],
			getEntitiesByUris: async (_b, _t, _tok, uris) => uris.map(u => byUri[u]).filter(Boolean),
		},
		tenantRoot: dir,
		sleep: async () => {},
		pollIntervalMs: 0,
	});

	const wb = JSON.parse(fs.readFileSync(path.join(dir, 'match-lab', 'Contact.json'), 'utf8'));
	assert.strictEqual(wb.tabOrder[wb.tabOrder.length - 1], 'Suggested Changes');
	assert.strictEqual(wb.tabOrder[wb.tabOrder.length - 2], 'Rules');
	assert.strictEqual(wb.tabOrder[0], 'How to use');

	// engine stamp makes a stale extension host obvious
	assert.strictEqual(wb.engineVersion, MATCH_LAB_ENGINE_VERSION);
	assert.strictEqual(MATCH_LAB_ENGINE_VERSION, '8.4.0-review-rules-tenant-fill');

	const tab = wb.tabs['Suggested Changes'];
	assert.ok(tab.rows.every(r => r.Rule !== 'EXPERIMENTAL / pending review'), 'no header row before the suggestions');
	assert.ok(!tab.columns.includes('Confidence') && !tab.columns.includes('Evidence'), 'Confidence and Evidence were removed');
	assert.ok(!tab.docs);

	const suggestions = tab.rows;
	assert.ok(suggestions.length > 0, 'the broad rule produced at least one suggestion');
	const emailRow = suggestions.find(r => r['Suggested change'] === 'Add exact Email');
	assert.ok(emailRow, 'Email is offered as a single-key change');
	assert.strictEqual(emailRow['Census now'], 1200);
	assert.strictEqual(
		emailRow['After (range)'],
		'If you add Email to Broad, potential matches would drop by about 80%.',
	);
	assert.strictEqual(emailRow['Fill rate'], 'Email: 100% (900 of 900 profiles)', 'Fill rate shows the actual figures');
	assert.strictEqual(emailRow.Uniqueness, 'Email: not measured (Data Quality API not available)');
	assert.deepStrictEqual(
		tab.columns.slice(0, 7),
		['Rule', 'Keys in rule', 'Suggested change', 'Fill rate', 'Uniqueness', 'Why (fill / uniqueness)', 'Census now'],
	);
	const activityKeys = wb.tabs['Rule Activity'].rows.find(r => r.Rule === emailRow.Rule)['Keys in rule'];
	assert.ok(activityKeys, 'Rule Activity lists the rule keys');
	assert.strictEqual(emailRow['Keys in rule'], activityKeys, 'Suggested Changes shows the same keys as Rule Activity');
	assert.ok(suggestions.every(r => r['Keys in rule']), 'every row, No change rows included, names the rule keys');
	assert.strictEqual(
		emailRow['Why (fill / uniqueness)'],
		'• Email is filled in on 100% of profiles, so most profiles can be compared on it.\n• Uniqueness was not measured because the Data Quality API was not available.',
		'Why is two bullets: tenant fill rate, then uniqueness',
	);
	assert.doesNotMatch(emailRow['Why (fill / uniqueness)'], /sampled/, 'Why never quotes the sampled pairs');
	for (const gone of ['Sampled pairs kept', 'Sampled pairs dropped', 'If exactOrNull instead']) {
		assert.ok(!tab.columns.includes(gone), `${gone} was removed from the tab`);
	}

	// a two-key combination is offered and is at least as strict as either single
	const combo = suggestions.find(r => String(r['Suggested change']).includes(' + '));
	assert.ok(combo, 'a two-key combination is offered');
	assert.match(combo['Suggested change'], /^Add exact \w+ \+ \w+$/);
	const dropPct = text => Number(String(text).match(/drop by about (\d+)%\.$/)[1]);
	assert.match(combo['After (range)'], /^If you add \w+ and \w+ to Broad, potential matches would drop by about \d+%\.$/);
	assert.doesNotMatch(combo['After (range)'], /profiles/, 'the sentence gives the percentage only');
	assert.match(combo['Fill rate'], /^\w+: \d+% .*\n\w+: \d+% /, 'one line per added attribute');
	assert.ok(
		dropPct(combo['After (range)']) >= dropPct(emailRow['After (range)']),
		'adding a second key never leaves more matches behind',
	);

	assert.ok(!tab.columns.includes('Reltio Notes') && !tab.columns.includes('Customer notes'));
	assert.ok(
		countCalls.some(f => f.includes('exists(attributes.LastName)') && f.includes('exists(attributes.Email)')),
		'eligible-with-keys is counted against rule keys plus the added keys',
	);
	assert.ok(!tab.columns.includes('Notes'), 'Suggested Changes has no Notes column');
	for (const row of suggestions) {
		assert.ok(!('Notes' in row));
		assert.doesNotMatch(String(row['Suggested change']), /[{}]/, 'no rule JSON in suggestions');
	}
	fs.rmSync(dir, { recursive: true, force: true });
}

// survivalForKeySet: exact vs exactOrNull on a combination
{
	const mk = cmps => ({ values: Object.fromEntries(Object.entries(cmps).map(([k, v]) => [`cmp_${k}`, v])) });
	const pairs = [
		mk({ Email: 'equal', Phone: 'equal' }),
		mk({ Email: 'equal', Phone: 'differ' }),
		mk({ Email: 'equal', Phone: '' }),
		mk({ Email: 'differ', Phone: 'equal' }),
		mk({ Email: 'A only', Phone: 'equal' }),
	];
	assert.deepStrictEqual(survivalForKeySet(pairs, ['Email']), { keptStrict: 3, keptTolerantNulls: 4 });
	assert.deepStrictEqual(survivalForKeySet(pairs, ['Phone']), { keptStrict: 3, keptTolerantNulls: 4 });
	assert.deepStrictEqual(
		survivalForKeySet(pairs, ['Email', 'Phone']),
		{ keptStrict: 1, keptTolerantNulls: 3 },
		'a combination is at least as strict as either key alone',
	);
}

// idle and errored rules get a stated reason instead of a suggestion
{
	const noPairs = await buildReductionSuggestions(
		{ countEntities: async () => 5 },
		'tst-01.reltio.com',
		'AakashSandbox',
		't',
		{
			typeInv: step6Inv,
			census: step6Inv.matchGroups.map(g => ({
				ruleUri: g.uri,
				censusStatus: g.shortName === 'Firing' ? 'ok' : g.shortName === 'HiddenExact' ? 'error' : 'ok',
				entitiesWithMatches: g.shortName === 'Firing' ? 40 : 0,
			})),
			recommendations: [],
			pairsByRule: new Map(),
		},
	);
	const by = name => noPairs.find(s => s.ruleShortName === name);
	assert.strictEqual(by('Firing').kind, 'No change');
	assert.match(by('Firing').suggestion, /too few sampled pairs/);
	assert.strictEqual(by('InternalIdle').kind, 'No change');
	assert.match(by('InternalIdle').suggestion, /the rule produces no potential matches/);
	assert.match(by('HiddenExact').suggestion, /the count could not be measured/);
	assert.ok(noPairs.every(s => s.kind !== 'Tighten rule'), 'no tightening without measured pairs');
}

// a full-scope fill-rate pass puts well-populated attributes on the tab even where
// this rule's own sample under-covers them
{
	// LastName disagrees on 5 pairs, agrees on 4, and is blank on the rest: 45% sampled
	// coverage, below the fallback gate but well inside a measured 90% fill rate.
	const thinPairs = Array.from({ length: 20 }, (_, i) => ({
		...fakePairs(1, 'Firing')[0],
		values: { cmp_LastName: i < 5 ? 'differ' : i < 9 ? 'equal' : '' },
	}));
	const census = step6Inv.matchGroups.map(g => ({
		ruleUri: g.uri,
		censusStatus: 'ok',
		entitiesWithMatches: g.shortName === 'Firing' ? 40 : 0,
	}));
	const run = async fillRateCache => {
		const counted = [];
		const rows = await buildReductionSuggestions(
			{
				countEntities: async (_b, _t, _tok, f) => {
					counted.push(String(f));
					return 100;
				},
			},
			'tst-01.reltio.com',
			'AakashSandbox',
			't',
			{
				typeInv: step6Inv,
				census,
				recommendations: [],
				pairsByRule: new Map([['Firing', thinPairs]]),
				fillRateCache,
			},
		);
		return { rows: rows.filter(s => s.ruleShortName === 'Firing'), counted };
	};

	const withoutRates = await run(new Map());
	assert.ok(
		withoutRates.rows.every(s => s.kind !== 'Tighten rule'),
		'with nothing measured, thin sampled coverage is still the only signal available',
	);

	const cache = new Map([
		[`${C}/attributes/LastName`, {
			key: 'LastName',
			name: 'LastName',
			path: 'LastName',
			uri: `${C}/attributes/LastName`,
			family: 'name',
			depth: 1,
			inRules: [],
			populated: 900,
			total: 1000,
			rate: 0.9,
		}],
	]);
	const withRates = await run(cache);
	const tighten = withRates.rows.find(s => s.kind === 'Tighten rule');
	assert.ok(tighten, 'a 90% fill rate puts the attribute on the tab');
	assert.deepStrictEqual(tighten.addedKeys, ['LastName']);
	assert.match(tighten.why, /^• LastName is filled in on 90% of profiles, so most profiles can be compared on it\.\n• /, 'Why gives the tenant-wide fill rate');
	assert.strictEqual(tighten.why.split('\n').length, 2, 'Why is exactly two bullets');
	assert.doesNotMatch(tighten.why, /sampled/, 'Why is about the whole tenant, never the sampled pairs');
	assert.ok(
		!withRates.counted.includes(existsAttributeFilter(C, `${C}/attributes/LastName`)),
		'an attribute the full-scope pass already measured is not counted again',
	);
}

// a well-populated attribute the rule does not use is proposed on its fill rate alone,
// even when the rule's own sample never compared it
{
	const { fillRateCandidates } = importDist('matchLab/reductionSuggestions');
	const firing = ruleBy('Firing');
	const fill = (key, rate) => [key, {
		key,
		name: key,
		path: key,
		uri: `${C}/attributes/${key}`,
		family: 'other',
		depth: 1,
		inRules: [],
		populated: rate == null ? null : Math.round(rate * 1000),
		total: 1000,
		rate,
	}];
	const rates = new Map([
		fill('Phone', 0.88),
		fill('LastName', 0.95),
		fill('Secret', 0.99),
		fill('Sparse', 0.2),
		fill('Broken', null),
	]);

	const candidates = fillRateCandidates(firing, step6Inv, rates).map(f => f.key);
	assert.deepStrictEqual(
		candidates,
		['LastName'],
		'best populated first; Phone is already an exactOrNull key of this rule, Secret is hidden in L3, Sparse is below the bar and Broken was not measured',
	);

	// end to end: the rule fires, its pairs never compare LastName, and the row still appears
	const blindPairs = Array.from({ length: 12 }, () => ({
		...fakePairs(1, 'Firing')[0],
		values: { cmp_FirstName: 'equal' },
	}));
	const rows = await buildReductionSuggestions(
		// Broken's cached count is null, so it is measured again rather than trusted —
		// and this tenant says it is empty, which keeps it off the tab.
		{ countEntities: async (_b, _t, _tok, f) => (String(f).includes('exists(attributes.Broken)') ? 0 : 1000) },
		'tst-01.reltio.com',
		'AakashSandbox',
		't',
		{
			typeInv: step6Inv,
			census: step6Inv.matchGroups.map(g => ({
				ruleUri: g.uri,
				censusStatus: 'ok',
				entitiesWithMatches: g.shortName === 'Firing' ? 40 : 0,
			})),
			recommendations: [],
			pairsByRule: new Map([['Firing', blindPairs]]),
			fillRateCache: new Map([...rates.values()].map(f => [f.uri, f])),
		},
	);
	const firingRows = rows.filter(s => s.ruleShortName === 'Firing' && s.kind === 'Tighten rule');
	const proposed = firingRows[0];
	assert.ok(proposed, 'a high fill rate is enough to propose an unused attribute as a key');
	assert.deepStrictEqual(proposed.addedKeys, ['LastName']);
	assert.ok(
		!firingRows.some(s => s.addedKeys.includes('Broken')),
		'an attribute measured as empty is not proposed, however it was cached',
	);
	assert.strictEqual(proposed.evidence, 'fill-rate');
	assert.match(proposed.why, /^• LastName is filled in on 95% of profiles/, 'Why gives the tenant-wide fill rate');

	// Why reads the uniqueness from Data Quality in plain words, two bullets even for two keys
	const { tenantWhyBullets } = importDist('matchLab/fillRates');
	const dq = (rate, shared) => ({ rate, sharedProfileRate: shared, source: 'dataQuality' });
	assert.strictEqual(
		tenantWhyBullets(['Email'], [dq(0.72, 0.04)]),
		'• Email is filled in on 72% of profiles, so most profiles can be compared on it.\n• Email is unique on 96% of profiles, so it is good at telling different profiles apart.',
	);
	const two = tenantWhyBullets(['Email', 'Phone'], [dq(0.72, 0.04), dq(0.35, 0.6)]);
	assert.strictEqual(
		two,
		'• Email is filled in on 72% of profiles and Phone on 35%, so many profiles lack at least one of them and would stop matching on this rule.\n• Email is unique on 96% of profiles and Phone on 40%. Many profiles share the same value, so they cannot tell every profile apart.',
		'two keys still make two bullets',
	);
	// the columns that rest on sampled survival must not read as measured zeros
	const { recommendationsTab } = importDist('matchLab/workbook');
	const tab = recommendationsTab([proposed]);
	const row = tab.rows[0];
	assert.strictEqual(row['Suggested change'], 'Add exact LastName');
	assert.strictEqual(row['Why (fill / uniqueness)'], proposed.why);
	assert.match(row['After (range)'], /^If you add LastName to Firing, we cannot yet say how much potential matches would drop/);
	assert.doesNotMatch(row['After (range)'], /\d+%/, 'an unmeasured row never shows a reduction as if it were measured');
	assert.strictEqual(row['Fill rate'], 'LastName: 95% (950 of 1,000 profiles)');
	assert.ok(!('Confidence' in row) && !('Evidence' in row));

	// with Data Quality uniqueness, the cap is stated as a sentence and Uniqueness shows the real share
	const capped = recommendationsTab([{
		...proposed,
		censusNow: 1000,
		maxCensusAfter: 300,
		fillRates: [{ key: 'LastName', rate: 0.95, populated: 950, total: 1000, sharedProfileRate: 0.3, uniqueValues: 665, sharedValues: 50, source: 'dataQuality' }],
	}]).rows[0];
	assert.strictEqual(
		capped['After (range)'],
		'If you add LastName to Firing, potential matches would drop by at least 70%, because only some profiles share their LastName value with another profile.',
	);
	assert.strictEqual(capped.Uniqueness, 'LastName: 70% of profiles unique (715 distinct values)');
}

// webview badges Status, retitles on entity switch, and never calls an LLM
{
	const viewSrc = fs.readFileSync(path.join(repoRoot, 'src', 'webview', 'matchLabView.ts'), 'utf8');
	assert.match(viewSrc, /col === 'Status'\)/);
	assert.doesNotMatch(viewSrc, /SIGNAL_CLASS/, 'there is no Signal column to badge');
	assert.match(viewSrc, /rec-badge/);
	assert.match(viewSrc, /function renderTitle/, 'the h1 follows the entity picker');
	// The rule picker stands in for the per-rule tabs, so it only appears on Rules and
	// it narrows the rows rather than merely scrolling to them.
	assert.match(viewSrc, /selectedTab === RULES_TAB/);
	assert.match(
		viewSrc,
		/if \(ruleFilter && String\(row\.Rule \?\? ''\) !== ruleFilter\) continue;/,
		'the selected rule filters the rows out, not just the view',
	);
	assert.match(
		viewSrc,
		/wb\.tabs\?\.\['Rule Activity'\]\?\.rows/,
		'rule names come from Rule Activity so a rule with no pairs is still offered',
	);
	assert.match(
		viewSrc,
		/if \(!names\.includes\(selectedRule\)\) selectedRule = names\[0\] \?\? '';/,
		'the tab opens on one rule, as the per-rule tabs did',
	);
	for (const rel of [
		path.join('src', 'matchLab', 'recommendations.ts'),
		path.join('src', 'matchLab', 'occupancy.ts'),
		path.join('src', 'matchLab', 'mappingInput.ts'),
		path.join('src', 'webview', 'matchLabView.ts'),
	]) {
		const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
		assert.doesNotMatch(src, /openai|anthropic|completions|chat\/completions/i, `${rel} must not call an LLM`);
		assert.doesNotMatch(
			src,
			/entities\/_matches|method:\s*['"]PUT|configuration['"]\s*,\s*['"]PUT/,
			`${rel} must not PUT configuration or POST entities/_matches`,
		);
	}
	const optionalFileSettings = JSON.parse(
		fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
	).contributes.configuration.properties;
	assert.ok(optionalFileSettings['reltio.matchLab.mappingFile']);
	assert.strictEqual(optionalFileSettings['reltio.matchLab.mappingFile'].default, '');
	assert.ok(
		!optionalFileSettings['reltio.matchLab.candidatesFile'],
		'the candidates setting is gone with the tab it fed',
	);
}

// --- packaging / playbook ---
const skill = path.join(repoRoot, 'skills', 'reltio-default', 'match-lab-review', 'SKILL.md');
assert.ok(fs.existsSync(skill), 'match-lab-review playbook');
const skillText = fs.readFileSync(skill, 'utf8');
assert.match(skillText, /When to use/);
assert.match(skillText, /Inputs/);
assert.match(skillText, /Procedure/);
assert.match(skillText, /Outputs/);
assert.match(skillText, /reltio\.matchLabReview/);
assert.match(skillText, /chatSummary/);
assert.match(skillText, /Match Groups/, 'the playbook documents the per-entity-type entry point');
assert.match(skillText, /Suggested Changes/);
assert.match(skillText, /match-lab-rule-suggestions/);
assert.match(skillText, /dq-attribute-metrics\.json/);
assert.doesNotMatch(
	skillText,
	/Data Readiness|candidatesFile|Try \/ skip/,
	'the playbook does not describe tabs the workbook no longer has',
);
assert.match(skillText, /There is no Signal column/, 'the playbook does not send the agent to a removed column');
assert.match(skillText, /not by itself a defect/, 'a high count is not automatically a problem');
assert.match(skillText, /## Rule Overlap tab/);
assert.match(skillText, /tenant-wide/, 'overlap counts are not sampled');
assert.match(skillText, /Also matched by/, 'the playbook distinguishes overlap from sampled pair overlap');
assert.doesNotMatch(skillText, /## Token Phrases tab|tokenPhraseProfiles/, 'the playbook does not describe the removed tab');
assert.match(skillText, /Automatic rules are left out/, 'the playbook says automatic rules are not analysed');
assert.match(skillText, /whole tenant/, 'the playbook says Why is tenant-wide');
assert.match(skillText, /removeOvercollisionedTokens/, 'the playbook states token deletion is out of scope');
assert.doesNotMatch(
	skillText,
	/SA Briefing|Rule notes|By entity|KEEP SUSPECT|REVIEW RULE|IDLE \(internal\)/,
	'the pre-7.0 jargon is gone from the playbook',
);
assert.doesNotMatch(skillText, /Forge|run_match_lab\.py|Companion|golden record/i);
assert.doesNotMatch(skillText, /\bgws\b|client secrets|16AC8UH60RmNf9Ow2kf4H3wBjrGFKAFD5y2QBZ3tdfIM/i);

const assets = JSON.parse(fs.readFileSync(path.join(repoRoot, 'resources', 'reltio-agent-assets.json'), 'utf8'));
assert.ok(assets.skillsBundleVersion);
assert.notStrictEqual(String(assets.skillsBundleVersion), '1', 'skillsBundleVersion bumped');
assert.notStrictEqual(String(assets.skillsBundleVersion), '2', 'skillsBundleVersion bumped for match-lab-review playbook');
assert.ok(
	Number(assets.skillsBundleVersion) >= 8,
	'skillsBundleVersion bumped so the current playbook re-materializes',
);
assert.strictEqual(String(assets.velocityPacksBundleVersion), '1');

{
	const rs = fs.readFileSync(
		path.join(repoRoot, 'skills', 'reltio-default', 'match-lab-rule-suggestions', 'SKILL.md'),
		'utf8',
	);
	assert.match(rs, /needs metrics/);
	assert.match(rs, /\| Target rule \| Keys in rule \| Suggested change \|/);
	assert.doesNotMatch(rs, /"Priority"/, 'the overlay column list has no Priority');
	assert.match(rs, /\.suggestions\.json/);
}

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
assert.ok(pkg.contributes.commands.some(c => c.command === 'reltio.matchLabReview' && c.title === 'Match Lab Review'));
assert.ok(pkg.scripts['build:webview:matchlab']);
const matchLabMenus = pkg.contributes.menus['view/item/context'].filter(
	m => m.command === 'reltio.matchLabReview',
);
assert.strictEqual(matchLabMenus.length, 1, 'the per-entity-type entry is the only tree entry');
const scopedMenu = matchLabMenus[0];
assert.match(scopedMenu.when, /viewItem == reltio\.item\.entityType/);
assert.match(scopedMenu.when, /viewItem == reltio\.folder\.matchGroupsFolder/);
assert.doesNotMatch(
	scopedMenu.when,
	/reltio\.tenant/,
	'the whole-tenant entry is gone — Match Lab runs one entity type at a time',
);

const { provideTokenMessage, sessionExpiredMessage, matchingNotIdleMessage } = importDist(
	'commands/matchLabReview',
);
assert.strictEqual(
	provideTokenMessage('tst-01.reltio.com'),
	'Provide Token for tst-01.reltio.com, then run Match Lab Review again.',
);
// The two token failures must not read identically: "I pasted a fresh token and nothing
// changed" is a different problem from the token never being stored for this environment.
assert.notStrictEqual(sessionExpiredMessage('tst-01.reltio.com'), provideTokenMessage('tst-01.reltio.com'));
assert.match(sessionExpiredMessage('tst-01.reltio.com'), /401/);
assert.match(sessionExpiredMessage('tst-01.reltio.com'), /accepted when the run started/);

{
	const fixture = {
		host: 'tst-01.reltio.com',
		tenantId: 'AakashSandbox',
		entityType: 'Person',
		entityTypeUri: 'configuration/entityTypes/Person',
		generatedAt: '2026-01-01T00:00:00.000Z',
		tabOrder: [
			'Rule Activity',
			'By Profile',
			'Rules',
			'How to use',
		],
		tabs: {
			'Rule Activity': { columns: ['Rule'], rows: [] },
			'By Profile': { columns: ['Entity', 'Partner'], rows: [] },
			Rules: { columns: ['Rule', 'Profile A', 'Profile B'], rows: [] },
			// Present in tabs but absent from tabOrder, so it must not be rendered.
			FernAuto: { columns: ['Rule'], rows: [] },
			'How to use': { columns: ['Note'], rows: [] },
		},
	};
	assert.deepStrictEqual(tabsForWorkbook(fixture), [
		'Rule Activity',
		'By Profile',
		'Rules',
		'How to use',
	]);
	const html = matchLabShellHtml({
		nonce: 'testnonce',
		csp: matchLabCsp('testnonce'),
		workbooks: [fixture],
	});
	assert.match(html, /default-src 'none'/);
	assert.match(html, /nonce="testnonce"/);
	assert.match(html, /Rule Activity/);
	assert.match(html, /data-tab="Rules"/);
	assert.match(html, /By Profile/);
	assert.match(html, /id="panel-title"/);
	assert.doesNotMatch(html, /data-tab="FernAuto"/);
	assert.doesNotMatch(html, />FernAuto</);
}

{
	const { MatchingNotIdleError } = importDist('matchLab/types');
	const err = new MatchingNotIdleError({
		idle: false,
		skipped: false,
		reason: 'matching-not-zero',
		last: { status: 'Green', matchingQueueSize: 9, eventsQueueSize: 1 },
		polls: [],
	});
	const msg = matchingNotIdleMessage(err);
	assert.match(msg, /Matching queue size: 9/);
	assert.match(msg, /Events queue size: 1/);
	assert.match(msg, /Status: Green/);
}

const clientSrc = fs.readFileSync(path.join(repoRoot, 'src', 'matchLab', 'reltioApi.ts'), 'utf8');
assert.match(clientSrc, /getTenantMatchingStatus/);
assert.match(clientSrc, /getEntityMatches/);
assert.match(clientSrc, /getEntitiesByUris/);
assert.doesNotMatch(clientSrc, /entities\/_matches['"`]/);
assert.match(clientSrc, /entities\/_total/);
assert.match(clientSrc, /snippet\(getText \|\| postText\)/);
assert.doesNotMatch(clientSrc, /password|token\.json|grant_type/i);
assert.ok(MATCHES_TIMEOUT_MS > 10_000, '_matches timeout must be well above 10s');

function jsonResponse(body, status = 200) {
	const payload = typeof body === 'string' ? body : JSON.stringify(body);
	return new Response(payload, { status, headers: { 'Content-Type': 'application/json' } });
}

async function withMockFetch(handler, fn) {
	const orig = global.fetch;
	const calls = [];
	global.fetch = async (url, init) => {
		calls.push({ url: String(url), method: init && init.method, body: init && init.body, headers: init && init.headers });
		return handler(calls[calls.length - 1], calls);
	};
	try {
		return await fn(calls);
	} finally {
		global.fetch = orig;
	}
}

function tempTenantRoot() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'match-lab-gate-'));
}

function readGateSidecar(tenantRoot) {
	return JSON.parse(fs.readFileSync(matchingPipelineGatePath(tenantRoot), 'utf8'));
}

function statusJson(matching, events, status = 'Green') {
	const body = { Status: status };
	if (matching !== undefined) body['Matching queue size'] = matching;
	if (events !== undefined) body['Events queue size'] = events;
	return body;
}

const gateBase = 'https://tst-01.reltio.com';
const gateTenant = 'AakashSandbox';
const gateToken = 'tok';
const gateCommon = { pollIntervalMs: 0, sleep: async () => {} };

{
	const tenantRoot = tempTenantRoot();
	await withMockFetch(
		() => jsonResponse(statusJson(0, 0)),
		async calls => {
			const idle = await waitForMatchingIdle(gateBase, gateTenant, gateToken, {
				...gateCommon,
				maxAttempts: 4,
				tenantRoot,
			});
			assert.strictEqual(idle.idle, true);
			assert.strictEqual(idle.skipped, false);
			assert.strictEqual(idle.reason, 'idle');
			assert.ok(calls.length >= 2, 'two consecutive matching-queue zeros');
			assert.ok(calls.every(c => c.method === 'GET'));
			assert.ok(calls.every(c => /\/reltio\/status\/tenant\/AakashSandbox$/.test(c.url)));
			assert.ok(!calls.some(c => /_matches|_byUris|_total/.test(c.url)));
			const sidecar = readGateSidecar(tenantRoot);
			assert.strictEqual(sidecar.host, 'tst-01.reltio.com');
			assert.strictEqual(sidecar.tenantId, gateTenant);
			assert.strictEqual(sidecar.idle, true);
			assert.strictEqual(sidecar.skipped, false);
			assert.strictEqual(sidecar.reason, 'idle');
			assert.ok(Array.isArray(sidecar.polls) && sidecar.polls.length >= 2);
			assert.strictEqual(sidecar.polls[0].matchingQueueSize, 0);
			assert.strictEqual(sidecar.polls[0].eventsQueueSize, 0);
			assert.ok(sidecar.polls[0].at);
			assert.ok(!('token' in sidecar));
		},
	);
	fs.rmSync(tenantRoot, { recursive: true, force: true });
}

{
	const tenantRoot = tempTenantRoot();
	await withMockFetch(
		(_call, calls) => jsonResponse(statusJson(calls.length === 1 ? 5 : 0, 0)),
		async calls => {
			const blocked = await waitForMatchingIdle(gateBase, gateTenant, gateToken, {
				...gateCommon,
				maxAttempts: 2,
				tenantRoot,
			});
			assert.strictEqual(calls.length, 2);
			assert.strictEqual(blocked.idle, false);
			assert.strictEqual(blocked.skipped, false);
			assert.strictEqual(blocked.reason, 'matching-not-zero');
			assert.strictEqual(readGateSidecar(tenantRoot).idle, false);
		},
	);
	fs.rmSync(tenantRoot, { recursive: true, force: true });
}

{
	const tenantRoot = tempTenantRoot();
	await withMockFetch(
		() => jsonResponse({ Status: 'Green', 'Events queue size': 0 }),
		async () => {
			const missing = await waitForMatchingIdle(gateBase, gateTenant, gateToken, {
				...gateCommon,
				maxAttempts: 1,
				tenantRoot,
			});
			assert.strictEqual(missing.idle, false);
			assert.strictEqual(missing.reason, 'unreadable-queue');
			assert.strictEqual(missing.last.matchingQueueSize, undefined);
		},
	);
	fs.rmSync(tenantRoot, { recursive: true, force: true });
}

{
	const tenantRoot = tempTenantRoot();
	await withMockFetch(
		() => jsonResponse(statusJson(-2, 0)),
		async () => {
			const negative = await waitForMatchingIdle(gateBase, gateTenant, gateToken, {
				...gateCommon,
				maxAttempts: 1,
				tenantRoot,
			});
			assert.strictEqual(negative.idle, false);
			assert.strictEqual(negative.reason, 'unreadable-queue');
		},
	);
	fs.rmSync(tenantRoot, { recursive: true, force: true });
}

{
	const tenantRoot = tempTenantRoot();
	await withMockFetch(
		() => jsonResponse(statusJson(12, 4)),
		async calls => {
			const skipped = await waitForMatchingIdle(gateBase, gateTenant, gateToken, {
				...gateCommon,
				skip: true,
				tenantRoot,
			});
			assert.strictEqual(calls.length, 1, 'skip waits one observation poll only');
			assert.strictEqual(skipped.skipped, true);
			assert.strictEqual(skipped.idle, false);
			const sidecar = readGateSidecar(tenantRoot);
			assert.strictEqual(sidecar.skipped, true);
			assert.strictEqual(sidecar.idle, false);
			assert.strictEqual(sidecar.polls[0].matchingQueueSize, 12);
			assert.strictEqual(sidecar.polls[0].eventsQueueSize, 4);
			assert.notStrictEqual(sidecar.reason, 'idle');
		},
	);
	fs.rmSync(tenantRoot, { recursive: true, force: true });
}

{
	const tenantRoot = tempTenantRoot();
	await withMockFetch(
		() => jsonResponse('unauthorized', 401),
		async () => {
			try {
				const unexpected = await waitForMatchingIdle(gateBase, gateTenant, gateToken, {
					...gateCommon,
					maxAttempts: 2,
					tenantRoot,
				});
				assert.notStrictEqual(unexpected.idle, true, '401 must not report idle');
				assert.strictEqual(unexpected.reason, 'unauthorized');
			} catch (e) {
				assert.ok(e instanceof ReltioApiError);
				assert.strictEqual(e.statusCode, 401);
			}
			const sidecar = readGateSidecar(tenantRoot);
			assert.strictEqual(sidecar.idle, false);
			assert.strictEqual(sidecar.reason, 'unauthorized');
		},
	);
	fs.rmSync(tenantRoot, { recursive: true, force: true });
}

assert.strictEqual(MATCHING_PIPELINE_GATE_FILENAME, 'matching-pipeline-gate.json');

{
	await withMockFetch(
		() => jsonResponse({ Status: 'Green', 'Matching queue size': 0, 'Events queue size': 1 }),
		async calls => {
			const result = await getTenantMatchingStatus('https://tst-01.reltio.com', 'AakashSandbox', 'tok');
			assert.strictEqual(calls.length, 1);
			assert.strictEqual(calls[0].method, 'GET');
			assert.strictEqual(calls[0].url, 'https://tst-01.reltio.com/reltio/status/tenant/AakashSandbox');
			assert.strictEqual(result.status, 'Green');
			assert.strictEqual(result.matchingQueueSize, 0);
			assert.strictEqual(result.eventsQueueSize, 1);
		},
	);
}

{
	await withMockFetch(
		() => jsonResponse({ Status: 'Green', 'Matching queue size': -4, 'Events queue size': 'n/a' }),
		async () => {
			const result = await getTenantMatchingStatus('tst-01.reltio.com', 'AakashSandbox', 'tok');
			assert.strictEqual(result.matchingQueueSize, undefined);
			assert.strictEqual(result.eventsQueueSize, undefined);
		},
	);
}

{
	await withMockFetch(
		() => jsonResponse('unauthorized', 401),
		async () => {
			try {
				await getTenantMatchingStatus('https://tst-01.reltio.com', 'AakashSandbox', 'tok');
				assert.fail('expected 401');
			} catch (e) {
				assert.ok(e instanceof ReltioApiError);
				assert.strictEqual(e.statusCode, 401);
			}
		},
	);
}

{
	await withMockFetch(
		(_call, calls) => {
			if (calls.length === 1) {
				return jsonResponse(Array.from({ length: 50 }, (_, i) => ({ uri: `entities/${i}` })));
			}
			return jsonResponse([{ uri: 'entities/50' }, { uri: 'entities/51' }]);
		},
		async calls => {
			const result = await getEntityMatches('https://tst-01.reltio.com', 'AakashSandbox', 'tok', 'entities/seed1');
			assert.ok(Array.isArray(result));
			assert.strictEqual(result.length, 52);
			assert.strictEqual(calls.length, 2);
			assert.ok(calls.every(c => c.method === 'GET'));
			assert.match(calls[0].url, /\/reltio\/api\/AakashSandbox\/entities\/seed1\/_matches\?/);
			assert.match(calls[0].url, /deep=1/);
			assert.match(calls[0].url, /offset=0/);
			assert.match(calls[1].url, /offset=50/);
			assert.ok(!calls.some(c => /\/entities\/_matches/.test(c.url)));
		},
	);
}

{
	await withMockFetch(
		(_call, calls) => {
			if (calls.length === 1) {
				return jsonResponse({ matches: [{ uri: 'entities/a' }], total: 2 });
			}
			return jsonResponse({ matches: [{ uri: 'entities/b' }], total: 2 });
		},
		async calls => {
			const result = await getEntityMatches(
				'https://tst-01.reltio.com',
				'AakashSandbox',
				'tok',
				'seed1',
				{ max: 1 },
			);
			assert.ok(Array.isArray(result));
			assert.strictEqual(result.length, 2);
			assert.strictEqual(calls.length, 2);
			assert.ok(calls.every(c => c.method === 'GET'));
		},
	);
}

{
	await withMockFetch(
		() => jsonResponse('unauthorized', 401),
		async () => {
			try {
				await getEntityMatches('https://tst-01.reltio.com', 'AakashSandbox', 'tok', 'e1');
				assert.fail('expected 401');
			} catch (e) {
				assert.ok(e instanceof ReltioApiError);
				assert.strictEqual(e.statusCode, 401);
			}
		},
	);
}

{
	const empty = await getEntitiesByUris('https://tst-01.reltio.com', 'AakashSandbox', 'tok', []);
	assert.deepStrictEqual(empty, []);
}

{
	await withMockFetch(
		() => jsonResponse([{ uri: 'entities/a' }, { uri: 'entities/b' }]),
		async calls => {
			const result = await getEntitiesByUris('https://tst-01.reltio.com', 'AakashSandbox', 'tok', [
				'entities/a',
				'entities/b',
			]);
			assert.strictEqual(calls.length, 1);
			assert.strictEqual(calls[0].method, 'POST');
			assert.strictEqual(calls[0].url, 'https://tst-01.reltio.com/reltio/api/AakashSandbox/entities/_byUris');
			assert.deepStrictEqual(JSON.parse(calls[0].body), { uris: ['entities/a', 'entities/b'] });
			assert.strictEqual(result.length, 2);
		},
	);
}

{
	await withMockFetch(
		() => jsonResponse('unauthorized', 401),
		async () => {
			try {
				await getEntitiesByUris('https://tst-01.reltio.com', 'AakashSandbox', 'tok', ['entities/a']);
				assert.fail('expected 401');
			} catch (e) {
				assert.ok(e instanceof ReltioApiError);
				assert.strictEqual(e.statusCode, 401);
			}
		},
	);
}

assert.strictEqual(typeof countEntities, 'function');

// --- scoped entry point: a node under entityTypes[i] names one entity type ---
{
	assert.strictEqual(entityTypeIndexFromJsonPath(['entityTypes', 2]), 2);
	assert.strictEqual(
		entityTypeIndexFromJsonPath(['entityTypes', 2, 'matchGroups']),
		2,
		'the Match Groups folder scopes to its owning entity type',
	);
	assert.strictEqual(entityTypeIndexFromJsonPath(['entityTypes']), undefined);
	assert.strictEqual(entityTypeIndexFromJsonPath(['relationTypes', 0]), undefined);
	assert.strictEqual(entityTypeIndexFromJsonPath(['entityTypes', 'Contact']), undefined);
	assert.strictEqual(entityTypeIndexFromJsonPath([]), undefined);

	const model = {
		entityTypes: [
			{ uri: 'configuration/entityTypes/Organization' },
			{ uri: 'configuration/entityTypes/Contact' },
			{ label: 'no uri' },
		],
	};
	assert.strictEqual(
		entityTypeUriFromJsonPath(model, ['entityTypes', 1, 'matchGroups']),
		'configuration/entityTypes/Contact',
	);
	assert.strictEqual(entityTypeUriFromJsonPath(model, ['entityTypes', 2]), undefined);
	assert.strictEqual(entityTypeUriFromJsonPath(model, ['entityTypes', 9]), undefined);
	assert.strictEqual(entityTypeUriFromJsonPath({}, ['entityTypes', 0]), undefined);
}

// --- entityTypeUris scopes the run to the chosen entity type only ---
{
	const twoTypeL3 = {
		entityTypes: [
			hiddenL3.entityTypes[0],
			{
				uri: 'configuration/entityTypes/Organization',
				label: 'Organization',
				attributes: [
					{ uri: 'configuration/entityTypes/Organization/attributes/Name', name: 'Name', label: 'Name' },
				],
				matchGroups: [
					{
						uri: 'configuration/entityTypes/Organization/matchGroups/ExactOrgName',
						label: 'Exact org name',
						type: 'suspect',
						scope: 'ALL',
						rule: { exact: ['configuration/entityTypes/Organization/attributes/Name'] },
					},
				],
			},
		],
	};
	assert.strictEqual(inventoryMatchLabTypes(twoTypeL3).length, 2, 'both types carry match groups');

	const { dir, l3Path } = writeTempL3(twoTypeL3);
	const countFilters = [];
	const result = await runMatchLab('tst-01.reltio.com', 'AakashSandbox', 't', l3Path, {
		api: makeApi({ count: f => countFilters.push(String(f)) }),
		tenantRoot: dir,
		sleep: async () => {},
		pollIntervalMs: 0,
		entityTypeUris: ['configuration/entityTypes/Person'],
	});

	assert.deepStrictEqual(
		result.entityFiles.map(f => f.entityType),
		['Person'],
		'only the selected entity type is analyzed',
	);
	assert.ok(
		result.report.census.every(c => c.entityTypeUri === 'configuration/entityTypes/Person'),
		'no census row for the entity type that was not selected',
	);
	assert.ok(
		countFilters.every(f => !f.includes('Organization')),
		'the unselected entity type costs no API calls',
	);
	assert.ok(!fs.existsSync(path.join(dir, 'match-lab', 'Organization.json')));
	assert.ok(fs.existsSync(path.join(dir, 'match-lab', 'Person.json')));
	fs.rmSync(dir, { recursive: true, force: true });
}

// --- an entity type with no match groups still produces a workbook ---
{
	const noRulesL3 = {
		entityTypes: [
			hiddenL3.entityTypes[0],
			{
				uri: 'configuration/entityTypes/Household',
				label: 'Household',
				abstract: true,
				attributes: [
					{ uri: 'configuration/entityTypes/Household/attributes/Name', name: 'Name', label: 'Name' },
					{ uri: 'configuration/entityTypes/Household/attributes/Zip', name: 'Zip', label: 'Zip' },
					{ uri: 'configuration/entityTypes/Household/attributes/Secret', name: 'Secret', hidden: true },
				],
			},
		],
	};
	assert.strictEqual(
		inventoryMatchLabTypes(noRulesL3).length,
		1,
		'a type with no match groups is still absent from a tenant-wide run',
	);

	const { dir, l3Path } = writeTempL3(noRulesL3);
	const counted = [];
	const result = await runMatchLab('tst-01.reltio.com', 'AakashSandbox', 't', l3Path, {
		api: {
			getTenantMatchingStatus: async () => ({
				body: { Status: 'Green', 'Matching queue size': 0, 'Events queue size': 0 },
				text: '',
			}),
			countEntities: async (_b, _t, _tok, filter) => {
				const f = String(filter);
				counted.push(f);
				if (f.includes('Name')) return 60;
				if (f.includes('Zip')) return 15;
				return 100;
			},
			searchEntities: async () => assert.fail('no rules means no pair sampling'),
			getEntityMatches: async () => assert.fail('no rules means no match fetch'),
			getEntitiesByUris: async () => assert.fail('no rules means no profile fetch'),
		},
		tenantRoot: dir,
		sleep: async () => {},
		pollIntervalMs: 0,
		entityTypeUris: ['configuration/entityTypes/Household'],
	});

	assert.deepStrictEqual(
		result.entityFiles.map(f => f.entityType),
		['Household'],
		'a rule-less type asked for by name is analyzed',
	);
	assert.ok(
		counted.every(f => !f.includes('Secret')),
		'hidden attributes are not measured',
	);

	const wb = JSON.parse(fs.readFileSync(path.join(dir, 'match-lab', 'Household.json'), 'utf8'));
	assert.deepStrictEqual(
		wb.tabOrder,
		['How to use', 'Rule Activity', 'Rule Overlap', 'By Profile', 'Rules', 'Suggested Changes'],
		'every tab appears even when there are no rules',
	);
	// Every rule-driven tab is empty and says why in one "Reason:" line.
	for (const name of wb.tabOrder.filter(n => n !== 'How to use')) {
		assert.deepStrictEqual(wb.tabs[name].rows, [], `${name} has no rows`);
		assert.match(wb.tabs[name].docs, /^Reason: Household has no match rules, so nothing can match/, `${name} says why`);
	}
	fs.rmSync(dir, { recursive: true, force: true });
}

// --- the panel ignores sidecars written by an older engine ---
{
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-lab-stale-'));
	const mlDir = path.join(dir, 'match-lab');
	fs.mkdirSync(mlDir);
	const sidecar = (entityType, engineVersion) => ({
		host: 'tst-01.reltio.com',
		tenantId: 'AakashSandbox',
		entityType,
		entityTypeUri: `configuration/entityTypes/${entityType}`,
		generatedAt: '2026-01-01T00:00:00.000Z',
		engineVersion,
		tabOrder: ['Summary'],
		tabs: { Summary: { columns: ['Section'], rows: [] } },
	});
	fs.writeFileSync(path.join(mlDir, 'Contact.json'), JSON.stringify(sidecar('Contact', MATCH_LAB_ENGINE_VERSION)));
	fs.writeFileSync(path.join(mlDir, 'Organization.json'), JSON.stringify(sidecar('Organization', '6.2-fillrate-ranking')));

	const loaded = await loadEntityWorkbooks(dir);
	assert.deepStrictEqual(
		loaded.map(w => w.entityType),
		['Contact'],
		'a workbook from an older engine uses different tab names and is not shown beside a current one',
	);

	fs.rmSync(dir, { recursive: true, force: true });
}


// --- Signal separates over-matching from under-matching ---
{
	const rule = ruleBy('Firing');
	const base = { rule, censusError: false, censusN: 5, eligible: 40, scope: 'ALL', noisy: [] };
	assert.strictEqual(ruleSignal(base), 'Matching, and nothing in the sample looks wrong');
	assert.strictEqual(ruleSignal({ ...base, noisy: ['FirstName'] }), 'Matching, but the pairs disagree on a name');
	assert.strictEqual(ruleSignal({ ...base, censusN: 0 }), 'No matches, though profiles do populate every key it needs');
	assert.strictEqual(
		ruleSignal({ ...base, censusN: 0, eligible: 0 }),
		'No matches, and nothing populates its keys',
		'no profile populates the keys, so nothing was expected',
	);
	assert.strictEqual(
		ruleSignal({ ...base, censusN: 0, scope: 'INTERNAL' }),
		'No matches, and nothing populates its keys',
		'INTERNAL rules are expected to be quiet',
	);
	assert.strictEqual(ruleSignal({ ...base, censusError: true, censusN: null }), 'The count failed — cannot be judged');
	assert.strictEqual(ruleSignal({ ...base, censusN: null }), 'The count failed — cannot be judged');
}

function walkTs(dir, acc) {
	for (const name of fs.readdirSync(dir)) {
		const p = path.join(dir, name);
		if (fs.statSync(p).isDirectory()) walkTs(p, acc);
		else if (p.endsWith('.ts')) acc.push(p);
	}
	return acc;
}
for (const file of walkTs(path.join(repoRoot, 'src'), [])) {
	const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
	assert.doesNotMatch(text, /method:\s*['"]POST['"][\s\S]{0,400}entities\/_matches/, `${file} must not POST _matches`);
	assert.doesNotMatch(text, /run_match_lab\.py/);
}
for (const file of [...walkTs(path.join(repoRoot, 'src', 'matchLab'), []), path.join(repoRoot, 'src', 'commands', 'matchLabReview.ts')]) {
	const text = fs.readFileSync(file, 'utf8');
	assert.doesNotMatch(text, /listTenants|\/reltio\/tenants/, `${file} must not depend on GET /reltio/tenants`);
}
// the command builds its own API object; a method missing there silently disables a feature
{
	const apiMembers = src => {
		const body = /function (?:defaultApi|matchLabApi)\(\): MatchLabApi \{\s*return \{([\s\S]*?)\};/.exec(src);
		assert.ok(body, 'API factory found');
		return body[1].split(',').map(s => s.trim()).filter(Boolean).sort();
	};
	const runSrc = fs.readFileSync(path.join(repoRoot, 'src', 'matchLab', 'runMatchLab.ts'), 'utf8');
	const cmdSrc = fs.readFileSync(path.join(repoRoot, 'src', 'commands', 'matchLabReview.ts'), 'utf8');
	assert.deepStrictEqual(apiMembers(cmdSrc), apiMembers(runSrc), 'Match Lab command exposes the same API as the run default');
	assert.ok(apiMembers(cmdSrc).includes('getDataQualityStatistic'));
}

const gateSrc = fs.readFileSync(path.join(repoRoot, 'src', 'matchLab', 'matchingGate.ts'), 'utf8');
assert.doesNotMatch(gateSrc, /getEntityMatches|getEntitiesByUris|countEntities/);
assert.match(gateSrc, /getTenantMatchingStatus/);

console.log('test-match-lab-review: OK');
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
