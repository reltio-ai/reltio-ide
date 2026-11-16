import { shortNameFromUri } from './entityUris';
import { NO_EXACT_KEYS_REASON } from './occupancy';
import { andList, pct } from './runStats';
import type {
	ColumnOccupancy,
	MatchLabCensusRow,
	MatchLabMappingInput,
	MatchLabPairRow,
	MatchLabRuleInventory,
	PairOccupancy,
	RecommendationLabel,
	RuleEligibility,
	RuleRecommendation,
	RuleSignal,
} from './types';

/** Below this, a rule borrows the entity's pooled pairs and says so. */
export const MIN_RULE_PAIRS_FOR_OWN_BASIS = 8;

/** Fraction of comparable sampled pairs that may disagree on a name key before it is called noisy. */
export const NOISY_NAME_DIFF_RATE = 0.2;

/** Person-name keys only — CompanyName, Username and the like are not names a rule should agree on. */
const NAME_RE = /(^|first|last|middle|given|family|full|sur)name$/i;
const FIRST_NAME_RE = /first|given|fore/i;
const DICTIONARY_RE = /dictionary|namedictionary/i;

/** Lab notes are read as prose, so verbs have to agree with what was counted. */
function plural(n: number, one: string, many: string): string {
	return n === 1 ? one : many;
}

function columnKeys(pairs: MatchLabPairRow[]): string[] {
	const keys: string[] = [];
	const seen = new Set<string>();
	for (const p of pairs) {
		for (const col of Object.keys(p.values)) {
			if (!col.startsWith('a_')) continue;
			const key = col.slice(2);
			if (seen.has(key)) continue;
			seen.add(key);
			keys.push(key);
		}
	}
	return keys;
}

function occupancyColumns(pairs: MatchLabPairRow[]): ColumnOccupancy[] {
	return columnKeys(pairs).map(key => {
		let aPopulated = 0;
		let bPopulated = 0;
		let same = 0;
		let differ = 0;
		for (const p of pairs) {
			if ((p.values[`a_${key}`] ?? '').trim()) aPopulated += 1;
			if ((p.values[`b_${key}`] ?? '').trim()) bPopulated += 1;
			const cmp = p.values[`cmp_${key}`];
			if (cmp === 'equal') same += 1;
			else if (cmp === 'differ') differ += 1;
		}
		const comparable = same + differ;
		return {
			key,
			aPopulated,
			bPopulated,
			same,
			differ,
			diffRate: comparable > 0 ? differ / comparable : null,
		};
	});
}

/**
 * Uses the rule's own sampled pairs when it has at least
 * MIN_RULE_PAIRS_FOR_OWN_BASIS; otherwise pools the entity's pairs.
 */
export function pairOccupancy(
	rulePairs: MatchLabPairRow[],
	pooledPairs: MatchLabPairRow[],
): PairOccupancy {
	if (rulePairs.length >= MIN_RULE_PAIRS_FOR_OWN_BASIS) {
		return {
			basis: "from this rule's pairs",
			pairCount: rulePairs.length,
			columns: occupancyColumns(rulePairs),
		};
	}
	if (pooledPairs.length > 0) {
		return {
			basis: 'from pooled pairs',
			pairCount: pooledPairs.length,
			columns: occupancyColumns(pooledPairs),
		};
	}
	return { basis: 'no sampled pairs', pairCount: 0, columns: [] };
}

export function occupancyText(occ: PairOccupancy): string {
	if (occ.columns.length === 0) return `no sampled pairs (${occ.basis})`;
	const bits = occ.columns.map(
		c => `${c.key} ${c.aPopulated}/${occ.pairCount} populated, ${c.same} same / ${c.differ} differ`,
	);
	return `${bits.join('; ')} (${occ.basis}, ${occ.pairCount} pair(s))`;
}

/** Name keys that disagree above the threshold. A name dictionary on this tenant excuses first-name drift. */
export function noisyNameColumns(
	rule: MatchLabRuleInventory,
	occ: PairOccupancy,
): string[] {
	const hasDictionary = rule.cleanseAdapters.some(c => DICTIONARY_RE.test(c))
		|| rule.comparatorClasses.some(c => DICTIONARY_RE.test(c.className));
	return occ.columns
		.filter(c => NAME_RE.test(c.key))
		.filter(c => c.diffRate != null && c.diffRate > NOISY_NAME_DIFF_RATE)
		.filter(c => !(hasDictionary && FIRST_NAME_RE.test(c.key)))
		.map(c => c.key);
}

function normalizeMappingToken(value: string): string {
	return shortNameFromUri(value).trim().toLowerCase();
}

/** Keys the rule cites that the customer's mapping list does not claim. */
export function unmappedKeysForRule(
	rule: MatchLabRuleInventory,
	mapping: MatchLabMappingInput | undefined,
): string[] {
	if (!mapping) return [];
	const intended = new Set(mapping.intendedAttributes.map(normalizeMappingToken));
	if (intended.size === 0) return [];
	return rule.comparedAttributeUris
		.filter(uri => !intended.has(normalizeMappingToken(uri)))
		.map(uri => shortNameFromUri(uri));
}

export function keysInRuleText(rule: MatchLabRuleInventory): string {
	const hidden = new Set(rule.hiddenAttributeUris);
	return rule.comparedAttributeUris
		.map(uri => {
			const name = shortNameFromUri(uri);
			return hidden.has(uri) ? `${name} (not mapped)` : name;
		})
		.join(', ');
}

/** Fewer comparable pairs than this and a per-attribute percentage says nothing. */
const MIN_COMPARABLE_PAIRS = 4;
/** An attribute the rule ignores that differs at least this often separates what the rule joins. */
const SEPARATING_DIFF_RATE = 0.5;

/** Lab notes are a short list for a customer to read at a glance, most useful first. */
export const MAX_LAB_NOTES = 4;

export function labNotesText(notes: string[]): string {
	return notes.filter(Boolean).slice(0, MAX_LAB_NOTES).map(n => `• ${n}`).join('\n');
}

function isAre(items: string[]): string {
	return plural(items.length, 'is', 'are');
}

function itThem(items: string[]): string {
	return plural(items.length, 'it', 'them');
}

const POOLED_NOTE = "These figures come from all of this entity type's sample pairs, because this rule had fewer than 8 of its own.";

/**
 * What the rule's sampled pairs say: which attributes it does not compare differ often enough
 * to suggest the pairs are different records, and how often its own attributes agreed.
 */
function sampleEvidenceNotes(
	rule: MatchLabRuleInventory,
	occ: PairOccupancy,
	noisy: string[],
): { verdict?: string; ownKeys?: string } {
	if (occ.basis !== "from this rule's pairs" || occ.pairCount === 0) return {};
	const hidden = new Set(rule.hiddenAttributeUris);
	const ruleKeys = new Set(
		rule.comparedAttributeUris.filter(uri => !hidden.has(uri)).map(uri => shortNameFromUri(uri)),
	);
	const comparable = (c: ColumnOccupancy) => c.same + c.differ >= MIN_COMPARABLE_PAIRS && c.diffRate != null;

	const own = occ.columns
		.filter(c => ruleKeys.has(c.key) && comparable(c))
		.map(c => `${c.key} in ${pct(1 - (c.diffRate ?? 0))}`);
	const ownKeys = own.length > 0
		? `In the ${occ.pairCount} sample pairs we checked, ${andList(own)} of pairs had the same value.`
		: undefined;

	const separating = occ.columns
		.filter(c => !ruleKeys.has(c.key) && !noisy.includes(c.key) && comparable(c))
		.filter(c => (c.diffRate ?? 0) >= SEPARATING_DIFF_RATE)
		.sort((a, b) => (b.diffRate ?? 0) - (a.diffRate ?? 0))
		.slice(0, 3);
	if (separating.length > 0) {
		const keys = separating.map(c => c.key);
		const detail = separating.length === 1
			? `${keys[0]} is different in ${pct(separating[0].diffRate ?? 0)} of the sample pairs`
			: `${andList(separating.map(c => `${c.key} (${pct(c.diffRate ?? 0)})`))} are usually different in the sample pairs`;
		return {
			verdict: `${detail}, but the rule does not check ${itThem(keys)}, so many of these matches may not be real duplicates. Suggested Changes shows how to tighten the rule.`,
			ownKeys,
		};
	}
	if (noisy.length === 0) {
		return { verdict: 'The sample pairs look like real duplicates. Nothing the rule leaves out is often different.', ownKeys };
	}
	return { ownKeys };
}

/** Plain-language reading of non-trivial comparators; exact string comparison needs no note. */
function comparatorPhrase(className: string): string | undefined {
	if (/metaphone|soundex|phonetic/i.test(className)) return 'by how it sounds';
	if (/levenshtein|damerau|fuzzy|distance/i.test(className)) return 'allowing small spelling differences';
	if (/organizationname/i.test(className)) return 'as an organization name';
	if (/addressline/i.test(className)) return 'as an address line';
	return undefined;
}

/** How the rule compares values, in words — only the parts that change what matches. */
export function comparisonNotes(rule: MatchLabRuleInventory): string[] {
	const notes: string[] = [];
	if (rule.cleanseAdapters.some(c => DICTIONARY_RE.test(c))) {
		notes.push('Nicknames such as Bob and Robert count as the same name.');
	}
	const phrases = new Map<string, string[]>();
	for (const cmp of rule.comparatorClasses) {
		const phrase = comparatorPhrase(cmp.className);
		if (!phrase || !cmp.attributeUri) continue;
		const list = phrases.get(phrase) ?? [];
		const key = shortNameFromUri(cmp.attributeUri);
		if (!list.includes(key)) list.push(key);
		phrases.set(phrase, list);
	}
	for (const [phrase, keys] of phrases) {
		const how = phrase === 'by how it sounds' && keys.length > 1 ? 'by how they sound' : phrase;
		notes.push(`${andList(keys)} ${isAre(keys)} compared ${how}.`);
	}
	return notes;
}

/** Attributes L3 hides, which the rule therefore cannot use. */
export function hiddenKeysNote(keys: string[]): string {
	return `${andList(keys)} ${isAre(keys)} hidden in the configuration, so the rule cannot use ${itThem(keys)}.`;
}

function keysPhrase(keys: string[]): string {
	if (keys.length === 0) return 'every attribute the rule needs';
	return keys.length === 1 ? keys[0] : `all of ${andList(keys)}`;
}

const SKIPPED_REASON_TEXT: Record<string, string> = {
	'exact-or-null': 'allowed to be empty',
	'negative-only': 'only used to stop a match',
};

/**
 * Deterministic reading of where the evidence points. Over-matching rests on name keys that
 * disagree despite the rule joining the pair; under-matching on a rule that can be satisfied
 * by real data yet produces nothing.
 */
export function ruleSignal(input: {
	rule: MatchLabRuleInventory;
	censusError: boolean;
	censusN: number | null;
	eligible: number | null;
	scope: string;
	noisy: string[];
}): RuleSignal {
	const { censusError, censusN, eligible, scope, noisy } = input;
	if (censusError) return 'The count failed — cannot be judged';
	if (censusN == null) return 'The count failed — cannot be judged';
	if (censusN > 0) {
		return noisy.length > 0
			? 'Matching, but the pairs disagree on a name'
			: 'Matching, and nothing in the sample looks wrong';
	}
	if (scope === 'INTERNAL') return 'No matches, and nothing populates its keys';
	if (eligible != null && eligible > 0) return 'No matches, though profiles do populate every key it needs';
	return 'No matches, and nothing populates its keys';
}

export interface RecommendInput {
	rule: MatchLabRuleInventory;
	census: MatchLabCensusRow | undefined;
	eligibility: RuleEligibility | undefined;
	occupancy: PairOccupancy;
	mapping?: MatchLabMappingInput;
}

/**
 * Deterministic — no model. Order is fixed by the Step 6 contract:
 * census error, INTERNAL idle, hidden-key review, unmapped-key review, idle, keep suspect.
 */
export function recommendRule(input: RecommendInput): RuleRecommendation {
	const { rule, census, eligibility, occupancy, mapping } = input;
	const eligible = eligibility?.eligible ?? null;
	const censusError = census?.censusStatus === 'error' || census == null;
	const censusN = census?.censusStatus === 'ok' ? census.entitiesWithMatches : null;
	const hiddenKeys = rule.hiddenAttributeUris.map(uri => shortNameFromUri(uri));
	const unmapped = unmappedKeysForRule(rule, mapping);
	const noisy = noisyNameColumns(rule, occupancy);
	const scope = (rule.scope || '').toUpperCase();

	let recommendation: RecommendationLabel;
	/** The finding the row is about. Always shown first. */
	let headline: string;
	let hiddenNoted = false;

	if (censusError) {
		recommendation = 'The count failed — unknown, not zero';
		headline = `We could not count this rule's matches${census?.censusHttpStatus ? ` (the request failed with HTTP ${census.censusHttpStatus})` : ''}. Treat the number as unknown, not as zero.`;
	} else if (censusN === 0 && scope === 'INTERNAL') {
		recommendation = 'No potential matches; scope is INTERNAL';
		headline = 'No potential matches. This rule only compares profiles from the same source, so it stays quiet until a source sends duplicates of its own records.';
	} else if (censusN === 0 && hiddenKeys.length > 0) {
		recommendation = 'Cites keys hidden in L3 or absent from the mapping list';
		headline = `No potential matches. ${hiddenKeysNote(hiddenKeys)}`;
		hiddenNoted = true;
	} else if (unmapped.length > 0 && (eligible === 0 || eligible == null)) {
		recommendation = 'Cites keys hidden in L3 or absent from the mapping list';
		headline = `The rule needs ${andList(unmapped)}, which your mapping file does not list, so ${plural(unmapped.length, 'that attribute is', 'those attributes are')} probably empty.`;
	} else if (censusN === 0) {
		recommendation = 'No potential matches';
		headline = 'No potential matches.';
	} else {
		recommendation = 'Produces potential matches';
		headline = censusN == null
			? 'This rule produces potential matches, but the count itself could not be read.'
			: `${censusN.toLocaleString('en-US')} ${plural(censusN, 'profile has', 'profiles have')} at least one potential match from this rule.`;
	}

	const signal = ruleSignal({ rule, censusError, censusN, eligible, scope, noisy });
	const firing = censusN != null && censusN > 0;
	const pooled = occupancy.basis === 'from pooled pairs';

	const noisyNote = firing && noisy.length > 0
		? `${andList(noisy)} ${isAre(noisy)} different in more than ${Math.round(NOISY_NAME_DIFF_RATE * 100)}% of the sample pairs where both profiles have a value, so the rule may be matching different people.${pooled ? ` ${POOLED_NOTE}` : ''}`
		: '';
	const evidence = firing ? sampleEvidenceNotes(rule, occupancy, noisy) : {};

	let eligibilityNote = '';
	if (eligible != null) {
		const keys = keysPhrase(eligibility?.keysUsed ?? []);
		const count = eligible.toLocaleString('en-US');
		const have = plural(eligible, 'profile has', 'profiles have');
		if (eligible === 0) {
			eligibilityNote = `No profile has ${keys} filled in, so the rule cannot find matches until that data is loaded.`;
		} else if (firing) {
			eligibilityNote = `${count} ${have} ${keys} filled in, so they can be matched by this rule.`;
		} else if (signal === 'No matches, though profiles do populate every key it needs') {
			eligibilityNote = `${count} ${have} ${keys} filled in, so the data is there. Either those values never repeat between profiles, or the match tables have not been rebuilt since the rule changed.`;
		} else {
			eligibilityNote = `${count} ${have} ${keys} filled in.`;
		}
	} else if (eligibility?.reason === NO_EXACT_KEYS_REASON) {
		if (!firing) eligibilityNote = 'The rule has no exact-match attributes, so we did not count how many profiles could match it.';
	} else if (eligibility?.reason) {
		eligibilityNote = `We could not count how many profiles have the rule's attributes filled in (${eligibility.reason}).`;
	}

	const skipped = (eligibility?.keysSkipped ?? []).filter(s => SKIPPED_REASON_TEXT[s.reason]);
	const skippedNote = eligible != null && skipped.length > 0
		? `Not part of that count: ${andList(skipped.map(s => `${s.key} (${SKIPPED_REASON_TEXT[s.reason]})`))}.`
		: '';

	// "never populated" is only defensible when occupancy says so AND eligible does not contradict it.
	let emptyNote = '';
	if (eligible === 0 || eligible == null) {
		const emptyInSample = occupancy.columns
			.filter(c => c.aPopulated === 0 && c.bPopulated === 0)
			.map(c => c.key);
		if (emptyInSample.length > 0) {
			emptyNote = `Empty in every sample pair we checked: ${andList(emptyInSample)}.${pooled ? ` ${POOLED_NOTE}` : ''}`;
		}
	}

	const hiddenNote = !hiddenNoted && hiddenKeys.length > 0 ? hiddenKeysNote(hiddenKeys) : '';
	const howCompared = comparisonNotes(rule).join(' ');

	const notes = firing
		? [headline, noisyNote, evidence.verdict, emptyNote, hiddenNote, howCompared, eligibilityNote, evidence.ownKeys, skippedNote]
		: [headline, eligibilityNote, hiddenNote, emptyNote, howCompared, skippedNote];

	return {
		ruleUri: rule.uri,
		ruleShortName: rule.shortName,
		recommendation,
		signal,
		labNotes: labNotesText(notes.filter((n): n is string => Boolean(n))),
		occupancyText: occupancyText(occupancy),
		occupancyBasis: occupancy.basis,
		eligible,
		keysInRule: keysInRuleText(rule),
		noisyNameColumns: noisy,
	};
}
