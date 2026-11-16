import { existsAllAttributesFilter } from './censusFilters';
import { shortNameFromUri } from './entityUris';
import { attributeFillRates, tenantWhyBullets } from './fillRates';
import { occupancyKeysForRule } from './occupancy';
import { keysInRuleText } from './recommendations';
import type {
	AttrFamily,
	AttributeFillRate,
	DiscriminatorStat,
	MatchLabApi,
	MatchLabAttrMeta,
	MatchLabCensusRow,
	MatchLabPairRow,
	MatchLabRuleInventory,
	MatchLabTypeInventory,
	ReductionSuggestion,
} from './types';

function fillFigures(key: string, f: AttributeFillRate | undefined, rate?: number | null): ReductionSuggestion['fillRates'][number] {
	return {
		key,
		rate: f?.rate ?? rate ?? null,
		sharedProfileRate: f?.sharedProfileRate ?? null,
		populated: f?.populated ?? null,
		total: f?.total ?? null,
		uniqueValues: f?.uniqueValues ?? null,
		sharedValues: f?.sharedValues ?? null,
		...(f?.source ? { source: f.source } : {}),
	};
}

/**
 * EXPERIMENTAL. Unlike the Coverage Try / skip rows, these suggestions are generated
 * by the extension from measured sampled pairs. They are never applied: changing a
 * rule still goes through the match-groups-from-concept playbook and HITL Apply.
 */
export const REDUCTION_THRESHOLDS = {
	/** Below this many sampled pairs the measurement is not worth a suggestion. */
	minPairs: 8,
	/**
	 * Fallback availability gate, used only when no tenant fill rate was measured.
	 * One rule's sample can under-cover an attribute the tenant populates well, which
	 * is why a measured fill rate takes precedence over this.
	 */
	minCoverage: 0.6,
	/** Disagreement has to be measurable on at least this many pairs to rank on it. */
	minComparablePairs: 4,
	/** Below this share of disagreement, requiring the key would barely move the count. */
	minDifferShare: 0.1,
	/** At or above this share, requiring the key drops nearly every current candidate. */
	nearTotalShare: 0.95,
	/** Tenant-wide fill rate floor — below this, tightening suppresses through nulls. */
	minFillRate: 0.3,
	/**
	 * Bar for proposing a key on its fill rate alone, with no sampled disagreement to
	 * lean on. Higher than `minFillRate` because there is less evidence behind the row.
	 */
	minFillRateForNewKey: 0.6,
	/** Fill-rate-only proposals per rule, on top of the evidence-backed ones. */
	maxFillRateOnly: 2,
	/** Single-key suggestions per rule. */
	maxSingles: 3,
	/** Two-key combinations per rule, drawn from the top comboPool discriminators. */
	maxCombos: 3,
	comboPool: 4,
	/** Below this measured reduction a suggestion is not worth listing. */
	minReductionShare: 0.05,
	/** Below this share of profiles sharing their value, the key is close to a per-record ID. */
	nearUniqueSharedRate: 0.1,
	/** At or below this many distinct values, a key only splits profiles into broad groups. */
	fewDistinctValues: 20,
} as const;

/**
 * Upper bound on profiles that can still match once every key in `fills` is exact:
 * a profile can only match on a key whose value another profile also holds. Null when
 * any key lacks a Data Quality measurement.
 */
export function maxCensusAfterExact(
	censusNow: number,
	fills: (AttributeFillRate | undefined)[],
): number | null {
	let bound = censusNow;
	for (const f of fills) {
		if (!f || f.source !== 'dataQuality' || f.populated == null || f.uniqueValues == null) return null;
		bound = Math.min(bound, Math.max(0, f.populated - f.uniqueValues));
	}
	return bound;
}

/**
 * A proposed key has to separate records without stopping real duplicates matching.
 * Email and phone are expected to be near-unique, so only other families are turned
 * away for it.
 */
function usableAsNewKey(fill: AttributeFillRate): boolean {
	if (fill.source !== 'dataQuality') return true;
	const contactValue = fill.family === 'email' || fill.family === 'phone';
	if (
		!contactValue
		&& fill.sharedProfileRate != null
		&& fill.sharedProfileRate < REDUCTION_THRESHOLDS.nearUniqueSharedRate
	) return false;
	const distinct = fill.uniqueValues != null && fill.sharedValues != null ? fill.uniqueValues + fill.sharedValues : null;
	return distinct == null || distinct > REDUCTION_THRESHOLDS.fewDistinctValues;
}

/** L3 types that hold a measurement, a flag or a timestamp rather than an identity. */
const NON_KEY_TYPES = new Set([
	'date',
	'timestamp',
	'int',
	'integer',
	'long',
	'float',
	'double',
	'number',
	'boolean',
	'blob',
	'image',
	'nested',
	'reference',
]);
const KEY_FAMILIES = new Set<AttrFamily>(['identifiers', 'email', 'phone', 'address', 'name', 'demographics']);
/** Classified `other`, but a real key at the top level: web identity and employer. */
const OTHER_KEY_RE = /^(website|websiteurl|web|url|domain|company|employer|organization)$/i;
/** Under Email or Phone, only the contact value itself; the rest is split out by cleansers. */
const CONTACT_VALUE_RE = /^(email|emailaddress|value|number|phonenumber|formattednumber|nationalnumber|e164\w*|digits)$/i;
/** Bookkeeping, scoring and classification fields that never say who a record is. */
const NON_KEY_NAME_RE = /^(created|updated|modified|deleted|last(modified|updated|seen|activity|login)|first(seen|load))|(status|type|flag|score|date|time|count)$/i;

/**
 * Whether an L3 attribute can be proposed as a match key. Load dates, scores, flags and
 * job titles disagree on most pairs, so they rank well on the sample while saying
 * nothing about whether two records are the same.
 */
export function isKeyCandidate(
	meta: MatchLabAttrMeta,
	metaByUri: Map<string, MatchLabAttrMeta>,
): boolean {
	if (meta.hidden) return false;
	const parent = meta.parentUri ? metaByUri.get(meta.parentUri) : undefined;
	if (parent && (parent.family === 'email' || parent.family === 'phone')) {
		return CONTACT_VALUE_RE.test(meta.name);
	}
	const type = (meta.dataType ?? '').toLowerCase();
	if (NON_KEY_TYPES.has(type) && !(meta.family === 'demographics' && type === 'date')) return false;
	if (meta.family !== 'demographics' && NON_KEY_NAME_RE.test(meta.name)) return false;
	if (KEY_FAMILIES.has(meta.family)) return true;
	return !parent && OTHER_KEY_RE.test(meta.name);
}

/** Pair columns are keyed by short name, which can repeat across nested branches. */
function keyCandidateNames(typeInv: MatchLabTypeInventory): Set<string> {
	const metaByUri = new Map(typeInv.attributes.map(a => [a.uri, a] as const));
	return new Set(typeInv.attributes.filter(a => isKeyCandidate(a, metaByUri)).map(a => a.name));
}

/** Tie-break only. Ranking is driven by measured fill rate × disagreement. */
const FAMILY_RANK: AttrFamily[] = [
	'demographics',
	'identifiers',
	'email',
	'phone',
	'address',
	'name',
	'other',
];

function familyRank(family: AttrFamily): number {
	const i = FAMILY_RANK.indexOf(family);
	return i === -1 ? FAMILY_RANK.length : i;
}

function errorStatus(e: unknown): number | undefined {
	if (e && typeof e === 'object' && 'statusCode' in e) {
		return Number((e as { statusCode: unknown }).statusCode);
	}
	return undefined;
}

/**
 * Per-column agreement across one rule's sampled pairs, for columns the rule
 * does not already compare. Hidden attributes never reach pair values.
 */
export function discriminatorStats(
	pairs: MatchLabPairRow[],
	rule: MatchLabRuleInventory,
	typeInv: MatchLabTypeInventory,
): DiscriminatorStat[] {
	const alreadyCompared = new Set(rule.comparedAttributeUris.map(uri => shortNameFromUri(uri)));
	const familyByName = new Map(typeInv.attributes.map(a => [a.name, a.family] as const));
	const keys: string[] = [];
	const seen = new Set<string>();
	for (const p of pairs) {
		for (const col of Object.keys(p.values)) {
			if (!col.startsWith('cmp_')) continue;
			const key = col.slice(4);
			if (seen.has(key) || alreadyCompared.has(key)) continue;
			seen.add(key);
			keys.push(key);
		}
	}
	return keys.map(key => {
		let equal = 0;
		let differ = 0;
		let oneSided = 0;
		let bothBlank = 0;
		for (const p of pairs) {
			const cmp = p.values[`cmp_${key}`];
			if (cmp === 'equal') equal += 1;
			else if (cmp === 'differ') differ += 1;
			else if (cmp === 'A only' || cmp === 'B only') oneSided += 1;
			else bothBlank += 1;
		}
		const bothPopulated = equal + differ;
		return {
			key,
			family: familyByName.get(key) ?? 'other',
			fillRate: null,
			score: null,
			pairs: pairs.length,
			bothPopulated,
			equal,
			differ,
			oneSided,
			bothBlank,
			differShare: bothPopulated > 0 ? differ / bothPopulated : null,
			coverage: pairs.length > 0 ? bothPopulated / pairs.length : 0,
		};
	});
}

/**
 * Which attributes are worth proposing as a key.
 *
 * Availability is judged on the **measured tenant fill rate** whenever one exists, and
 * falls back to sampled coverage only when nothing was measured. The two answer different
 * questions: sampled coverage says how often the attribute was comparable on this one
 * rule's pairs, which under-reports an attribute the tenant populates well but this
 * rule's candidates happen to be missing. Admitting on fill rate is what lets the tab
 * reflect the Fill rates tab; the null-bearing caution on the row is what keeps the
 * sampled shortfall visible rather than silently dropping the attribute.
 *
 * Disagreement is still required either way — a key the pairs already agree on cannot
 * reduce anything, however well populated it is.
 */
export function gatedDiscriminators(
	stats: DiscriminatorStat[],
	fillRates?: Map<string, AttributeFillRate>,
): DiscriminatorStat[] {
	return stats.filter(s => {
		if (s.differShare == null || s.differShare < REDUCTION_THRESHOLDS.minDifferShare) return false;
		if (s.bothPopulated < REDUCTION_THRESHOLDS.minComparablePairs) return false;
		const fill = fillRates?.get(s.key);
		if (fill && !usableAsNewKey(fill)) return false;
		const measured = fill?.rate;
		if (measured != null) return measured >= REDUCTION_THRESHOLDS.minFillRate;
		return s.coverage >= REDUCTION_THRESHOLDS.minCoverage;
	});
}

/**
 * Ranked by measured fill rate × disagreement, so a sparsely populated key cannot
 * outrank a well-populated one. A key that disagrees on nearly every pair is demoted:
 * it cannot discriminate, it can only stop the rule matching. Family is a tie-break only.
 */
export function rankDiscriminators(
	stats: DiscriminatorStat[],
	fillRates?: Map<string, AttributeFillRate>,
): DiscriminatorStat[] {
	const scored = gatedDiscriminators(stats, fillRates)
		.map(s => {
			const fill = fillRates?.get(s.key);
			const fillRate = fill?.rate ?? null;
			const differShare = s.differShare ?? 0;
			// Unmeasured fill rate must not win by default, so treat it as neutral.
			const basis = fillRate ?? 0.5;
			return { ...s, fillRate, score: basis * differShare };
		})
		.filter(s => s.fillRate == null || s.fillRate >= REDUCTION_THRESHOLDS.minFillRate);

	const demoted = (s: DiscriminatorStat): number =>
		(s.differShare ?? 0) >= REDUCTION_THRESHOLDS.nearTotalShare ? 1 : 0;

	return scored.sort(
		(a, b) =>
			demoted(a) - demoted(b)
			|| (b.score ?? 0) - (a.score ?? 0)
			|| familyRank(a.family) - familyRank(b.family)
			|| a.key.localeCompare(b.key),
	);
}

/**
 * Well-populated attributes this rule does not already use, best populated first.
 *
 * This is the "ExactFirstNameLastName is wide open, and Phone is populated on 88% of
 * profiles, so propose adding Phone" case. It does not need the rule's sample to have
 * measured the attribute — that is the point: an attribute can be absent from the pair
 * columns, or comparable on too few pairs to rank, and still be the obvious key to add.
 *
 * Hidden attributes are excluded because they produce no match tokens: proposing one
 * would be proposing a rule that cannot fire until the attribute is unhidden in L3.
 */
export function fillRateCandidates(
	rule: MatchLabRuleInventory,
	typeInv: MatchLabTypeInventory,
	fillRates: Map<string, AttributeFillRate>,
): AttributeFillRate[] {
	const alreadyUsed = new Set([
		...rule.exactAttributeUris,
		...rule.exactOrNullAttributeUris,
		...rule.comparedAttributeUris,
		...rule.negativeOnlyAttributeUris,
		...rule.hiddenAttributeUris,
	]);
	const metaByUri = new Map(typeInv.attributes.map(a => [a.uri, a] as const));
	const keyable = (uri: string) => {
		const meta = metaByUri.get(uri);
		return !!meta && isKeyCandidate(meta, metaByUri);
	};
	return [...fillRates.values()]
		.filter(f => f.rate != null && f.rate >= REDUCTION_THRESHOLDS.minFillRateForNewKey)
		.filter(f => !alreadyUsed.has(f.uri) && keyable(f.uri))
		.filter(usableAsNewKey)
		.sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0) || a.key.localeCompare(b.key));
}

function noChangeRow(
	rule: MatchLabRuleInventory,
	census: MatchLabCensusRow | undefined,
	suggestion: string,
): ReductionSuggestion {
	return {
		ruleShortName: rule.shortName,
		keysInRule: keysInRuleText(rule),
		censusNow: census?.censusStatus === 'ok' ? census.entitiesWithMatches : null,
		censusStatus: census?.censusStatus ?? 'error',
		kind: 'No change',
		addedKeys: [],
		suggestion,
		evidence: 'sampled',
		why: '',
		fillRates: [],
		estimatedCensusAfter: null,
		eligibleWithKeys: null,
	};
}

/**
 * Survival of one rule's sampled pairs if every key in `keys` also had to agree.
 * `exact` drops disagreements and missing values; `exactOrNull` drops disagreements only.
 */
export function survivalForKeySet(
	pairs: MatchLabPairRow[],
	keys: string[],
): { keptStrict: number; keptTolerantNulls: number } {
	let keptStrict = 0;
	let keptTolerantNulls = 0;
	for (const p of pairs) {
		const cmps = keys.map(k => p.values[`cmp_${k}`]);
		if (cmps.every(c => c === 'equal')) keptStrict += 1;
		if (cmps.every(c => c !== 'differ')) keptTolerantNulls += 1;
	}
	return { keptStrict, keptTolerantNulls };
}

function twoKeyCombos<T>(items: T[]): [T, T][] {
	const out: [T, T][] = [];
	for (let i = 0; i < items.length; i++) {
		for (let j = i + 1; j < items.length; j++) out.push([items[i], items[j]]);
	}
	return out;
}

/**
 * One block of rows per hand-built rule. Firing rules get up to maxPerRule tightening
 * suggestions ranked from their own sampled pairs; idle and errored rules get a stated reason.
 */
export async function buildReductionSuggestions(
	api: MatchLabApi,
	baseUrl: string,
	tenantId: string,
	token: string,
	input: {
		typeInv: MatchLabTypeInventory;
		census: MatchLabCensusRow[];
		pairsByRule: Map<string, MatchLabPairRow[]>;
		fillRateCache?: Map<string, AttributeFillRate>;
	},
): Promise<ReductionSuggestion[]> {
	const { typeInv, census, pairsByRule } = input;
	const censusByUri = new Map(census.map(c => [c.ruleUri, c] as const));
	const uriByName = new Map(typeInv.attributes.map(a => [a.name, a.uri] as const));
	const keyNames = keyCandidateNames(typeInv);
	const keyStats = (rulePairs: MatchLabPairRow[], rule: MatchLabRuleInventory) =>
		discriminatorStats(rulePairs, rule, typeInv).filter(s => keyNames.has(s.key));
	const out: ReductionSuggestion[] = [];

	// One pass to find which columns are worth measuring, so fill rates cost one
	// count per candidate attribute for the whole entity type rather than per rule.
	const candidateUris = new Set<string>();
	for (const rule of typeInv.matchGroups) {
		if (rule.isFern) continue;
		const censusRow = censusByUri.get(rule.uri);
		if (censusRow?.censusStatus !== 'ok' || (censusRow.entitiesWithMatches ?? 0) === 0) continue;
		const rulePairs = pairsByRule.get(rule.shortName) ?? [];
		if (rulePairs.length < REDUCTION_THRESHOLDS.minPairs) continue;
		for (const stat of gatedDiscriminators(keyStats(rulePairs, rule))) {
			const uri = uriByName.get(stat.key);
			if (uri) candidateUris.add(uri);
		}
	}
	// A full-scope run has already measured every attribute, so reusing those rows costs
	// nothing and is what lets a well-populated attribute be proposed even where this
	// rule's sample under-covers it. On candidate scope the cache is empty and only the
	// gated candidates are counted, exactly as before.
	const wanted = new Set(candidateUris);
	for (const uri of input.fillRateCache?.keys() ?? []) wanted.add(uri);

	const fillRates = await attributeFillRates(
		api,
		baseUrl,
		tenantId,
		token,
		typeInv,
		[...wanted],
		{ cache: input.fillRateCache },
	);

	for (const rule of typeInv.matchGroups) {
		if (rule.isFern) continue;
		const censusRow = censusByUri.get(rule.uri);
		const hiddenKeys = rule.hiddenAttributeUris.map(uri => shortNameFromUri(uri));

		if (censusRow?.censusStatus !== 'ok') {
			out.push(
				noChangeRow(rule, censusRow, 'No suggestion — the count could not be measured'),
			);
			continue;
		}
		const censusN = censusRow.entitiesWithMatches ?? 0;
		if (censusN === 0) {
			out.push(
				noChangeRow(
					rule,
					censusRow,
					hiddenKeys.length > 0
						? `No change suggested — map ${hiddenKeys.join(', ')} or drop them from the rule`
						: 'No change suggested — the rule produces no potential matches',
				),
			);
			continue;
		}

		const rulePairs = pairsByRule.get(rule.shortName) ?? [];
		const exactKeyUris = occupancyKeysForRule(rule).used.map(u => u.uri);
		const allStats = keyStats(rulePairs, rule);
		const statsByKey = new Map(allStats.map(s => [s.key, s] as const));
		/** Enough comparable pairs that the sample, not the fill rate, should decide. */
		const sampleDecided = (key: string) =>
			(statsByKey.get(key)?.bothPopulated ?? 0) >= REDUCTION_THRESHOLDS.minComparablePairs;

		/** Rows for well-populated attributes the rule's own sample could not judge. */
		const fillRateRows = (): ReductionSuggestion[] =>
			fillRateCandidates(rule, typeInv, fillRates)
				.filter(f => !sampleDecided(f.key))
				.slice(0, REDUCTION_THRESHOLDS.maxFillRateOnly)
				.map(f => ({
					ruleShortName: rule.shortName,
					keysInRule: keysInRuleText(rule),
					censusNow: censusN,
					censusStatus: 'ok' as const,
					kind: 'Tighten rule' as const,
					addedKeys: [f.key],
					suggestion: `Add exact ${f.key}`,
					evidence: 'fill-rate' as const,
					why: tenantWhyBullets([f.key], [f]),
					fillRates: [fillFigures(f.key, f)],
					estimatedCensusAfter: null,
					maxCensusAfter: maxCensusAfterExact(censusN, [f]),
					eligibleWithKeys: null,
				}));

		if (rulePairs.length < REDUCTION_THRESHOLDS.minPairs) {
			// Too thin to rank discriminators, but the fill rates are tenant-wide and
			// still say which attribute is the obvious one to add.
			const byFillRate = fillRateRows();
			if (byFillRate.length > 0) {
				out.push(...byFillRate);
			} else {
				out.push(
					noChangeRow(
						rule,
						censusRow,
						'No suggestion — too few sampled pairs',
					),
				);
			}
			continue;
		}

		const ranked = rankDiscriminators(allStats, fillRates);
		if (ranked.length === 0) {
			const byFillRate = fillRateRows();
			if (byFillRate.length > 0) {
				out.push(...byFillRate);
				continue;
			}
		}
		if (ranked.length === 0) {
			out.push(
				noChangeRow(
					rule,
					censusRow,
					'No change suggested — the rule looks healthy on this sample',
				),
			);
			continue;
		}

		const pool = ranked.slice(0, REDUCTION_THRESHOLDS.comboPool);
		const statByKey = new Map(ranked.map(s => [s.key, s] as const));

		const singles = pool
			.slice(0, REDUCTION_THRESHOLDS.maxSingles)
			.map(s => [s.key]);
		const combos = twoKeyCombos(pool.map(s => s.key))
			.map(keys => ({ keys, ...survivalForKeySet(rulePairs, keys) }))
			// A second key that changes nothing over the stricter of its members is noise.
			.filter(c => {
				const best = Math.min(
					...c.keys.map(k => survivalForKeySet(rulePairs, [k]).keptStrict),
				);
				return c.keptStrict < best;
			})
			.sort((a, b) => b.keptStrict - a.keptStrict || a.keys.join().localeCompare(b.keys.join()))
			.slice(0, REDUCTION_THRESHOLDS.maxCombos)
			.map(c => c.keys);

		for (const keys of [...singles, ...combos]) {
			const { keptStrict } = survivalForKeySet(rulePairs, keys);
			const reductionShare = 1 - keptStrict / rulePairs.length;
			if (reductionShare < REDUCTION_THRESHOLDS.minReductionShare) continue;

			const keyUris = keys.map(k => uriByName.get(k)).filter((u): u is string => !!u);
			let eligibleWithKeys: number | null = null;
			let filter: string | undefined;
			if (keyUris.length === keys.length) {
				filter = existsAllAttributesFilter(typeInv.entityTypeUri, [...exactKeyUris, ...keyUris]);
				try {
					eligibleWithKeys = await api.countEntities(baseUrl, tenantId, token, filter);
				} catch (e) {
					if (errorStatus(e) === 401) throw e;
					eligibleWithKeys = null;
				}
			}

			const stats = keys.map(k => statByKey.get(k)).filter((s): s is DiscriminatorStat => !!s);
			const estimate = Math.round((censusN * keptStrict) / rulePairs.length);
			const maxAfter = maxCensusAfterExact(censusN, keys.map(k => fillRates.get(k)));

			out.push({
				ruleShortName: rule.shortName,
				keysInRule: keysInRuleText(rule),
				censusNow: censusN,
				censusStatus: 'ok',
				kind: 'Tighten rule',
				addedKeys: keys,
				suggestion: `Add exact ${keys.join(' + ')}`,
				evidence: 'sampled',
				why: tenantWhyBullets(keys, keys.map(k => fillRates.get(k))),
				fillRates: stats.map(s => fillFigures(s.key, fillRates.get(s.key), s.fillRate)),
				estimatedCensusAfter: maxAfter != null ? Math.min(estimate, maxAfter) : estimate,
				maxCensusAfter: maxAfter,
				eligibleWithKeys,
				filter,
			});
		}

		// A well-populated attribute the sample never got to compare is still the obvious
		// key to add, so it is listed after the rows the sample could measure.
		out.push(...fillRateRows());
	}
	return out;
}
