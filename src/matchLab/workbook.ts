import { MATCH_LAB_ENGINE_VERSION, MATCH_LAB_SAMPLE } from './defaults';
import { shortNameFromUri } from './entityUris';
import { andList, formatCount, pct, pctOrUnmeasured } from './runStats';
import { buildL3RuleNotes } from './ruleNotes';
import type {
	AgentSuggestionsFile,
	MatchLabCensusRow,
	MatchLabPairRow,
	MatchLabRuleInventory,
	MatchLabTypeInventory,
	ReductionSuggestion,
	RuleOverlapRow,
	RuleRecommendation,
} from './types';

export interface SheetTab {
	columns: string[];
	rows: Record<string, unknown>[];
	docs?: string;
}

export interface EntityWorkbook {
	host: string;
	tenantId: string;
	entityType: string;
	entityTypeUri: string;
	generatedAt: string;
	/** Engine that produced this workbook — a mismatch means a stale extension host. */
	engineVersion: string;
	tabOrder: string[];
	tabs: Record<string, SheetTab>;
}

export const SUGGESTED_CHANGES_TAB = 'Suggested Changes';
export const RULES_TAB = 'Rules';
export const RULE_OVERLAP_TAB = 'Rule Overlap';

export const RULE_OVERLAP_COLUMNS = [
	'Rule A',
	'Rule B',
	'Profiles on rule A',
	'Profiles on rule B',
	'Profiles on both',
	'Share of rule A',
	'Share of rule B',
	'Finding',
];

/** The reading order for the workbook — one numbered step per row. */
export const HOW_TO_USE_ROWS: { Step: number; 'What to do': string }[] = [
	{
		Step: 1,
		'What to do': 'Open Rule Activity — one row per match rule that leaves potential matches for review. Automatic rules merge without review, so Match Lab leaves them out of every tab. "Profiles with potential matches" counts tenant profiles that have at least one potential match from the rule (a profile count, not a pair count). "Sampled pairs" is how many pairs this run pulled to inspect. Status says whether the rule looks healthy and Lab notes explain why. "error" means the count failed — never read it as 0.',
	},
	{
		Step: 2,
		'What to do': 'Start with the rule that carries the most profiles; a quiet rule is rarely the problem. If "Profiles with all rule keys populated" is close to zero, the rule cannot fire because the data is missing — fix the data, not the rule.',
	},
	{
		Step: 3,
		'What to do': 'Rule Overlap: how many profiles both rules of each pair flag. With a single rule there is nothing to pair, and the tab says so. A high share on both sides means the rules are finding the same profiles, so tightening or retiring one changes little on its own.',
	},
	{
		Step: 4,
		'What to do': 'By Profile lists every sampled pair twice, once from each side. Filter Entity to see every partner and rule for one profile. Entity and Partner open the profile in Hub.',
	},
	{
		Step: 5,
		'What to do': 'Rules holds every sampled pair; pick a rule above the table. a_ and b_ columns show both profiles\' values side by side, cmp_ says whether they are equal, differ, or present on one side only, and the crosswalk columns show which source each profile came from.',
	},
	{
		Step: 6,
		'What to do': 'Suggested Changes: one row per proposed tightening. "Fill rate" and "Uniqueness" give each added attribute\'s actual figures across the whole tenant, from the Data Quality API; "Why (fill / uniqueness)" says the same in words. "After (range)" says in one sentence how much adding the attribute would cut the rule\'s potential matches. It is projected from the sampled pairs, not a rematch. Nothing is applied from Match Lab — change rules through the match-groups editing flow and review before Apply.',
	},
];

function hostOf(baseUrl: string): string {
	return baseUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

function keysInRule(rule: MatchLabRuleInventory): string {
	const hidden = new Set(rule.hiddenAttributeUris);
	return rule.comparedAttributeUris
		.map(uri => {
			const name = shortNameFromUri(uri);
			return hidden.has(uri) ? `${name} (not mapped)` : name;
		})
		.join(', ');
}

/** Crosswalks are provenance, not a compared value — they sit at the end with no cmp_ column. */
const CROSSWALKS_KEY = 'crosswalks';

/**
 * A and B sit side by side per attribute so a reviewer compares one value without scrolling,
 * then every cmp_ column in the same order, then the crosswalks.
 */
function pairValueColumns(pairs: MatchLabPairRow[]): string[] {
	const names: string[] = [];
	const seen = new Set<string>();
	for (const p of pairs) {
		for (const key of Object.keys(p.values)) {
			if (!key.startsWith('a_')) continue;
				const name = key.slice(2);
			if (name === CROSSWALKS_KEY || seen.has(name)) continue;
					seen.add(name);
					names.push(name);
				}
			}
	const sideBySide = names.flatMap(n => [`a_${n}`, `b_${n}`]);
	const cmp = names.map(n => `cmp_${n}`);
	return [...sideBySide, ...cmp, `a_${CROSSWALKS_KEY}`, `b_${CROSSWALKS_KEY}`];
}

/**
 * A pair is listed on every rule tab that matched it, so `Rule` names the tab's own rule.
 * Showing the pair's primary rule here made a Fuzzy tab display rows labelled `Rule4`.
 */
function pairRowRecord(
	p: MatchLabPairRow,
	owningRule: string,
	showFern: boolean,
	valueCols: string[],
): Record<string, unknown> {
	const others = [p.ruleShortName, ...p.alsoMatchedBy.split(',').map(s => s.trim())]
		.filter(name => name && name !== owningRule);
	const row: Record<string, unknown> = {
		Rule: owningRule,
		'Profile A': p.profileAHubUrl,
		'Profile B': p.profileBHubUrl,
		Scope: p.scope,
		'Why it matched': p.whyItMatched,
		'Also matched by': [...new Set(others)].join(', '),
	};
	if (showFern) {
		row['FERN score'] = p.fernScore ?? '';
		row['FERN confidence'] = p.fernConfidence ?? '';
	}
	for (const col of valueCols) {
		row[col] = p.values[col] ?? '';
	}
	row['Both URIs'] = `${p.profileAUri} | ${p.profileBUri}`;
	return row;
}

/** Agent skill `match-lab-rule-suggestions` uses the same column order for `.suggestions.json`. */
export const RULE_SUGGESTIONS_AGENT_COLUMNS = [
	'Rule',
	'Keys in rule',
	'Suggested change',
	'Fill rate',
	'Uniqueness',
	'Why (fill / uniqueness)',
	'Census now',
	'After (range)',
] as const;

export const RECOMMENDATIONS_COLUMNS = [...RULE_SUGGESTIONS_AGENT_COLUMNS];

/** Not shown on Suggested Changes, even when an agent suggestions file still carries them. */
const DROPPED_SUGGESTION_COLUMNS = new Set(['Priority', 'Notes', 'Confidence', 'Evidence', 'Reltio Notes', 'Customer notes']);

type FillFigures = ReductionSuggestion['fillRates'][number];

/** "Email: 72% (236,441 of 328,391 profiles)", one line per added attribute. */
function fillRateCell(fills: FillFigures[]): string {
	return fills
		.map(f => {
			if (f.rate == null) return `${f.key}: not measured`;
			const counts = f.populated != null && f.total != null
				? ` (${formatCount(f.populated)} of ${formatCount(f.total)} profiles)`
				: '';
			return `${f.key}: ${pct(f.rate)}${counts}`;
		})
		.join('\n');
}

/** "Email: 96% of profiles unique (230,102 distinct values)", one line per added attribute. */
function uniquenessCell(fills: FillFigures[]): string {
	return fills
		.map(f => {
			if (f.source !== 'dataQuality') return `${f.key}: not measured (Data Quality API not available)`;
			if (f.sharedProfileRate == null) return `${f.key}: not returned by Data Quality`;
			const distinct = f.uniqueValues != null && f.sharedValues != null
				? ` (${formatCount(f.uniqueValues + f.sharedValues)} distinct values)`
				: '';
			return `${f.key}: ${pct(1 - f.sharedProfileRate)} of profiles unique${distinct}`;
		})
		.join('\n');
}

/** The projected effect as a sentence: what adding the attribute would do to this rule's potential matches. */
function afterRangeCell(s: ReductionSuggestion, unmeasured: boolean): string {
	if (s.addedKeys.length === 0 || s.censusNow == null || s.censusNow <= 0) return '';
	const now = s.censusNow;
	const keys = andList(s.addedKeys);
	const change = `If you add ${keys} to ${s.ruleShortName}`;
	const cap = s.maxCensusAfter != null && s.maxCensusAfter < now ? s.maxCensusAfter : null;
	if (unmeasured) {
		return cap != null
			? `${change}, potential matches would drop by at least ${pct((now - cap) / now)}, because only some profiles share their ${keys} value with another profile.`
			: `${change}, we cannot yet say how much potential matches would drop, because too few of this rule's sample pairs had ${keys} on both profiles to measure it.`;
	}
	if (s.estimatedCensusAfter == null) return '';
	const after = s.estimatedCensusAfter;
	if (after >= now) {
		return `${change}, potential matches would stay about the same.`;
	}
	return `${change}, potential matches would drop by about ${pct((now - after) / now)}.`;
}

/** Sheet-shaped view of the generated tightening suggestions. */
export function recommendationsTab(suggestions: ReductionSuggestion[]): SheetTab {
	const rows: Record<string, unknown>[] = [];
	for (const s of suggestions) {
		// A fill-rate row has no sampled survival behind it, so its estimate reads
		// 'not measured'. Reporting 0 would say "this drops everything", the opposite.
		const unmeasured = s.kind === 'Tighten rule' && s.evidence === 'fill-rate';
		rows.push({
			Rule: s.ruleShortName,
			'Keys in rule': s.keysInRule,
			'Suggested change': s.suggestion,
			'Fill rate': fillRateCell(s.fillRates),
			Uniqueness: uniquenessCell(s.fillRates),
			'Why (fill / uniqueness)': s.why,
			'Census now': s.censusStatus === 'error' ? 'error' : (s.censusNow ?? ''),
			'After (range)': afterRangeCell(s, unmeasured),
		});
	}
	return { columns: RECOMMENDATIONS_COLUMNS, rows };
}

/**
 * Replace the generated Suggested Changes rows with ones the match-rule-recommendations
 * skill wrote. Rejected outright when the file was written against a different engine or
 * entity type, so an old agent run cannot pass itself off as current analysis.
 */
export function applyAgentSuggestions(
	workbook: EntityWorkbook,
	file: AgentSuggestionsFile | undefined,
): EntityWorkbook {
	if (!file || file.rows.length === 0) return workbook;
	if (file.engineVersion !== workbook.engineVersion) return workbook;
	if (!workbook.tabOrder.includes(SUGGESTED_CHANGES_TAB)) return workbook;
	const columns = (file.columns?.length
		? file.columns
		: [...new Set(file.rows.flatMap(r => Object.keys(r)))]
	).filter(c => !DROPPED_SUGGESTION_COLUMNS.has(c));
	if (columns.length === 0) return workbook;
	return {
		...workbook,
		tabs: {
			...workbook.tabs,
			[SUGGESTED_CHANGES_TAB]: {
				columns,
				rows: file.rows.map(r =>
					Object.fromEntries(Object.entries(r).filter(([k]) => !DROPPED_SUGGESTION_COLUMNS.has(k)))),
				docs: workbook.tabs[SUGGESTED_CHANGES_TAB]?.docs,
			},
		},
	};
}

/** A tab with nothing to show still appears, with one line saying why. */
export function reasonTab(columns: string[], reason: string): SheetTab {
	return { columns, rows: [], docs: `Reason: ${reason}` };
}

/** Why Rule Overlap has no pair to count. */
export function noOverlapReason(typeInv: MatchLabTypeInventory): string {
	const handBuilt = typeInv.matchGroups.filter(g => !g.isFern);
	const fern = typeInv.matchGroups.length - handBuilt.length;
	const fernNote = fern > 0 ? ` Its ${fern} ML (FERN) rule(s) are not compared here.` : '';
	if (typeInv.matchGroups.length === 0) {
		return `${typeInv.shortName} has no match rules, so there are no rules to compare.`;
	}
	return handBuilt.length === 1
		? `${handBuilt[0].shortName} is the only hand-built rule on ${typeInv.shortName}, so there is no other rule to compare it with.${fernNote}`
		: `${typeInv.shortName} has no hand-built rules to compare.${fernNote}`;
}

export function ruleOverlapTab(rows: RuleOverlapRow[], typeInv?: MatchLabTypeInventory): SheetTab {
	if (rows.length === 0 && typeInv) {
		return reasonTab(RULE_OVERLAP_COLUMNS, noOverlapReason(typeInv));
	}
	return {
		columns: RULE_OVERLAP_COLUMNS,
		rows: rows.map(r => ({
			'Rule A': r.ruleA,
			'Rule B': r.ruleB,
			'Profiles on rule A': r.countA == null ? 'error' : formatCount(r.countA),
			'Profiles on rule B': r.countB == null ? 'error' : formatCount(r.countB),
			'Profiles on both': r.both == null ? 'error' : formatCount(r.both),
			'Share of rule A': pctOrUnmeasured(r.shareOfA),
			'Share of rule B': pctOrUnmeasured(r.shareOfB),
			Finding: r.finding,
		})),
	};
}

export function buildEntityWorkbook(input: {
	baseUrl: string;
	tenantId: string;
	typeInv: MatchLabTypeInventory;
	census: MatchLabCensusRow[];
	pairs: MatchLabPairRow[];
	pairsByRule: Map<string, MatchLabPairRow[]>;
	showFernColumns: boolean;
	recommendations: RuleRecommendation[];
	reductions: ReductionSuggestion[];
	ruleOverlap?: RuleOverlapRow[];
}): EntityWorkbook {
	const { typeInv, census, pairs, pairsByRule, showFernColumns } = input;
	const recByUri = new Map(input.recommendations.map(r => [r.ruleUri, r] as const));
	const host = hostOf(input.baseUrl);
	const generatedAt = new Date().toISOString();
	const handBuilt = typeInv.matchGroups.filter(g => !g.isFern).sort((a, b) => a.shortName.localeCompare(b.shortName));
	const censusSorted = [...census].sort((a, b) => a.ruleShortName.localeCompare(b.ruleShortName));

	const censusRows = censusSorted.map(c => {
		const rule = handBuilt.find(g => g.uri === c.ruleUri);
		const rec = recByUri.get(c.ruleUri);
		const tabPairs = pairsByRule.get(c.ruleShortName) ?? [];
		const l3Notes = rule ? buildL3RuleNotes(rule) : c.notes;
		return {
			Rule: c.ruleShortName,
			Type: c.ruleType,
			Scope: c.scope,
			Status: rec?.recommendation ?? '',
			// A failed count reads 'error' in this cell — it is the only place the reader
			// is told, now that the separate status column is gone, and it is never 0.
			'Profiles with potential matches':
				c.censusStatus === 'error' ? 'error' : formatCount(c.entitiesWithMatches),
			// The pairs on the Rules tab for this rule — the count Rule Analysis used to
			// carry twice, once here as "Pairs in this workbook" and once as "Sampled pairs".
			'Sampled pairs': formatCount(tabPairs.length),
			'Keys in rule': rec?.keysInRule ?? (rule ? keysInRule(rule) : ''),
			'Profiles with all rule keys populated': rec?.eligible ?? '',
			'Lab notes': rec?.labNotes || l3Notes,
			Label: c.ruleLabel,
		};
	});

	const censusColumns = [
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
	];
	const automatic = typeInv.automaticRuleNames ?? [];
	const automaticNote = automatic.length > 0
		? `Not shown: ${automatic.join(', ')} — automatic rule${automatic.length > 1 ? 's merge' : ' merges'} matches directly without review, so Match Lab leaves ${automatic.length > 1 ? 'them' : 'it'} out of every tab.`
		: '';
	const censusTab: SheetTab = {
		columns: censusColumns,
		rows: censusRows,
		...(automaticNote ? { docs: automaticNote } : {}),
	};

	const byEntityRows: Record<string, unknown>[] = [];
	const pairTabRowCount = [...pairsByRule.values()].reduce((n, list) => n + list.length, 0);
	if (2 * pairTabRowCount <= MATCH_LAB_SAMPLE.maxByEntityRows) {
		for (const p of pairs) {
			const both = `${p.profileAUri} | ${p.profileBUri}`;
			byEntityRows.push({
				Entity: p.profileAHubUrl,
				Partner: p.profileBHubUrl,
				Rule: p.ruleShortName,
				'Both URIs': both,
			});
			byEntityRows.push({
				Entity: p.profileBHubUrl,
				Partner: p.profileAHubUrl,
				Rule: p.ruleShortName,
				'Both URIs': both,
			});
		}
	}

	const byEntityTab: SheetTab = {
		columns: ['Entity', 'Partner', 'Rule', 'Both URIs'],
		rows: byEntityRows,
	};

	const valueCols = pairValueColumns(pairs);
	const pairColumns = [
		'Rule',
		'Profile A',
		'Profile B',
		'Scope',
		'Why it matched',
		'Also matched by',
		...(showFernColumns ? ['FERN score', 'FERN confidence'] : []),
		...valueCols,
		'Both URIs',
	];

	// Every tab appears for every entity type. One with nothing to show carries a single
	// "Reason:" line, so an empty table is never left to be read as zero.
	const noRules = typeInv.matchGroups.length === 0;
	const noRulesReason = automatic.length > 0
		? `${typeInv.shortName} has only automatic rules (${automatic.join(', ')}). They merge matches directly without review, so Match Lab does not analyse them.`
		: `${typeInv.shortName} has no match rules, so nothing can match. Define a match group with the match-groups-from-concept playbook, then run Match Lab again.`;
	const noPairsReason = handBuilt.length === 0
		? `${typeInv.shortName} has only ML (FERN) rules, which Match Lab does not sample.`
		: `No sampled pairs: none of ${typeInv.shortName}'s rules has potential matches right now, so there were no pairs to pull.`;
	const pairRows = handBuilt.flatMap(rule =>
		(pairsByRule.get(rule.shortName) ?? []).map(p =>
			pairRowRecord(p, rule.shortName, showFernColumns, valueCols),
		),
	);

	const tabOrder = [
		'How to use',
		'Rule Activity',
		RULE_OVERLAP_TAB,
		'By Profile',
		RULES_TAB,
		SUGGESTED_CHANGES_TAB,
	];
	const tabs: Record<string, SheetTab> = {
		'How to use': { columns: ['Step', 'What to do'], rows: HOW_TO_USE_ROWS.map(r => ({ ...r })) },
	};

	tabs['Rule Activity'] = noRules
		? { columns: censusColumns, rows: [], docs: `Reason: ${noRulesReason}` }
		: censusTab;

	tabs[RULE_OVERLAP_TAB] = noRules
		? reasonTab(RULE_OVERLAP_COLUMNS, noRulesReason)
		: ruleOverlapTab(input.ruleOverlap ?? [], typeInv);

	const byProfileColumns = ['Entity', 'Partner', 'Rule', 'Both URIs'];
	tabs['By Profile'] = noRules
		? reasonTab(byProfileColumns, noRulesReason)
		: byEntityRows.length > 0
			? byEntityTab
			: reasonTab(
				byProfileColumns,
				pairs.length > 0
					? `Too many sampled pairs to list per profile (more than ${formatCount(MATCH_LAB_SAMPLE.maxByEntityRows)} rows). Use the Rules tab instead.`
					: noPairsReason,
			);

	// Every rule's pairs on one tab, in rule order, rather than a tab per rule. The Rule
	// column already names the rule on each row, which is what the panel's rule picker
	// and the spreadsheet's column filter select on.
	tabs[RULES_TAB] = noRules
		? reasonTab(pairColumns, noRulesReason)
		: pairRows.length > 0
			? { columns: pairColumns, rows: pairRows }
			: reasonTab(pairColumns, noPairsReason);

	const suggested = recommendationsTab(input.reductions);
	tabs[SUGGESTED_CHANGES_TAB] = noRules
		? reasonTab(RECOMMENDATIONS_COLUMNS, noRulesReason)
		: suggested.rows.length > 0
			? suggested
			: reasonTab(RECOMMENDATIONS_COLUMNS, `${typeInv.shortName} has only ML (FERN) rules, and Match Lab does not suggest changes to those.`);
	return {
		host,
		tenantId: input.tenantId,
		entityType: typeInv.shortName,
		entityTypeUri: typeInv.entityTypeUri,
		generatedAt,
		engineVersion: MATCH_LAB_ENGINE_VERSION,
		tabOrder,
		tabs,
	};
}

export function censusSummaryFromWorkbook(workbook: EntityWorkbook): {
	rule: string;
	entitiesWithMatches: number | null;
	censusStatus: 'ok' | 'error';
	recommendation: string;
}[] {
	const census = workbook.tabs['Rule Activity'];
	if (!census) return [];
	return census.rows
		.filter(r => String(r.Rule ?? '') !== '')
		.map(r => {
			const count = r['Profiles with potential matches'];
			const error = count === 'error' || count === 'n/a';
		return {
				rule: String(r.Rule ?? ''),
				entitiesWithMatches: error ? null : parseCount(count),
			censusStatus: error ? 'error' : 'ok',
				// Status moved onto this row when Rule Analysis was folded in.
				recommendation: String(r.Status ?? ''),
		};
	});
}

/** Counts are written for a reader ("1,660"); read them back as numbers. */
function parseCount(value: unknown): number | null {
	if (typeof value === 'number') return value;
	if (typeof value !== 'string') return null;
	const n = Number(value.replace(/,/g, ''));
	return Number.isFinite(n) ? n : null;
}
