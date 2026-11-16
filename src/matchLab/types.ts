export type AttrFamily =
	| 'name'
	| 'demographics'
	| 'phone'
	| 'email'
	| 'address'
	| 'other'
	| 'identifiers';

export const ATTR_FAMILY_ORDER: AttrFamily[] = [
	'name',
	'demographics',
	'phone',
	'email',
	'address',
	'other',
	'identifiers',
];

export interface MatchLabAttrMeta {
	uri: string;
	name: string;
	label: string;
	family: AttrFamily;
	hidden: boolean;
	maskSsn: boolean;
	/** L3 data type, e.g. `String`, `Date`, `Int`, `Nested`. */
	dataType?: string;
	/** URI of the nested attribute this one sits under; absent at the top level. */
	parentUri?: string;
}

export interface MatchLabComparatorNote {
	attributeUri: string;
	className: string;
}

export interface MatchLabRuleInventory {
	uri: string;
	shortName: string;
	label: string;
	type: string;
	scope: string;
	hiddenAttributeUris: string[];
	cleanseAdapters: string[];
	comparatorClasses: MatchLabComparatorNote[];
	comparedAttributeUris: string[];
	/** Exact keys on the positive path — the only keys that produce match tokens. */
	exactAttributeUris: string[];
	/** exactOrNull / exactOrAllNull keys — excluded from occupancy exists() clauses. */
	exactOrNullAttributeUris: string[];
	/** Keys referenced only by negative clauses (not / notExact / notEquals). */
	negativeOnlyAttributeUris: string[];
	formattedRule: string;
	isFern: boolean;
}

export interface MatchLabTypeInventory {
	entityTypeUri: string;
	shortName: string;
	label: string;
	/** Rules Match Lab reviews. Automatic rules merge without review and are left out. */
	matchGroups: MatchLabRuleInventory[];
	/** Short names of the automatic rules left out of `matchGroups`. */
	automaticRuleNames?: string[];
	attributes: MatchLabAttrMeta[];
}

export type MatchLabCensusStatus = 'ok' | 'error';

export interface MatchLabCensusRow {
	entityTypeUri: string;
	entityTypeLabel: string;
	ruleUri: string;
	ruleShortName: string;
	ruleLabel: string;
	ruleType: string;
	scope: string;
	/** Profile count. Null when censusStatus is 'error' — never coerce a failed count to 0. */
	entitiesWithMatches: number | null;
	censusStatus: MatchLabCensusStatus;
	censusHttpStatus?: number;
	notes: string;
	skippedSample: boolean;
	censusFilter?: string;
}

export interface RuleEligibility {
	ruleUri: string;
	ruleShortName: string;
	/** Profile count on exact-key exists() clauses. Null when not measurable. */
	eligible: number | null;
	/** Present only when eligible is null — 'no exact keys' or a count failure. */
	reason?: string;
	keysUsed: string[];
	keysSkipped: { key: string; reason: string }[];
	filter?: string;
}

export interface ColumnOccupancy {
	key: string;
	aPopulated: number;
	bPopulated: number;
	same: number;
	differ: number;
	/** differ / (same + differ), or null when nothing comparable. */
	diffRate: number | null;
}

export type OccupancyBasis = "from this rule's pairs" | 'from pooled pairs' | 'no sampled pairs';

export interface PairOccupancy {
	basis: OccupancyBasis;
	pairCount: number;
	columns: ColumnOccupancy[];
}

/**
 * Status reads as the meaning itself rather than a coined label, so the cell needs no
 * glossary. The wording is the value — changing it changes the workbook.
 */
export type RecommendationLabel =
	| 'The count failed — unknown, not zero'
	| 'No potential matches; scope is INTERNAL'
	| 'Cites keys hidden in L3 or absent from the mapping list'
	| 'No potential matches'
	| 'Produces potential matches';

/**
 * Where the measured evidence points for a rule. An observation, never an instruction.
 * Like Status, the wording is the value — changing it changes the workbook.
 */
export type RuleSignal =
	| 'Matching, but the pairs disagree on a name'
	| 'No matches, though profiles do populate every key it needs'
	| 'Matching, and nothing in the sample looks wrong'
	| 'No matches, and nothing populates its keys'
	| 'The count failed — cannot be judged';

export interface RuleRecommendation {
	ruleUri: string;
	ruleShortName: string;
	recommendation: RecommendationLabel;
	signal: RuleSignal;
	/** Machine-generated from measured facts only. */
	labNotes: string;
	occupancyText: string;
	occupancyBasis: OccupancyBasis;
	eligible: number | null;
	keysInRule: string;
	noisyNameColumns: string[];
}

/** Profiles flagged by both rules, measured tenant-wide rather than from the sample. */
export interface RuleOverlapRow {
	ruleA: string;
	ruleB: string;
	countA: number | null;
	countB: number | null;
	/** Null when the count failed. */
	both: number | null;
	/** both / countA, or null when not measurable. */
	shareOfA: number | null;
	shareOfB: number | null;
	finding: string;
	filter: string;
}

/** Tenant-wide coverage of one attribute: populated / total profiles of the type. */
/**
 * `candidates` measures only attributes already gated as discriminators, which is what
 * ranking needs. `all` measures every attribute of the type — roughly one count per
 * attribute — so the Fill rates tab can stand on its own as evidence.
 */
export type FillRateScope = 'candidates' | 'all';

export interface AttributeFillRate {
	key: string;
	/** L3 attribute name, which may repeat across branches where `key` does not. */
	name: string;
	/** Dotted search path, e.g. `Phone.FormattedNumber`. */
	path: string;
	uri: string;
	family: AttrFamily;
	/** Nesting depth; 1 is a top-level attribute. */
	depth: number;
	/** Short names of match groups already using this attribute as a key. */
	inRules: string[];
	populated: number | null;
	total: number | null;
	/** populated / total, or null when either count failed. */
	rate: number | null;
	/** Where populated/total came from; absent on rows cached before Data Quality was read. */
	source?: 'dataQuality' | 'count';
	/** Distinct values held by exactly one profile (Data Quality `uniqueness.unique`). */
	uniqueValues?: number | null;
	/** Distinct values held by more than one profile (Data Quality `uniqueness.notUnique`). */
	sharedValues?: number | null;
	/**
	 * Share of populated profiles whose value another profile also has:
	 * (populated − uniqueValues) / populated. Exact for single-valued attributes,
	 * approximate when one profile holds several values.
	 */
	sharedProfileRate?: number | null;
	/** Most frequent values with their profile counts, highest first. */
	topValues?: { value: string; count: number }[];
}

/** Sidecar so a full-scope pass is paid for once per tenant per week, not per run. */
export interface FillRateCacheFile {
	engineVersion: string;
	entityTypeUri: string;
	/** ISO timestamp of the pass that produced these rows. */
	measuredAt: string;
	scope: FillRateScope;
	typeTotal: number | null;
	rows: AttributeFillRate[];
}

/**
 * Written by the match-rule-recommendations skill, never by the extension, and rendered
 * as the Suggested Changes tab. The extension does not call an LLM: it publishes the
 * measured evidence, the agent publishes the judgement, the panel shows whichever exists.
 */
export interface AgentSuggestionsFile {
	engineVersion: string;
	entityTypeUri: string;
	generatedAt: string;
	/** Free text naming the agent or skill run that produced this, shown in the banner. */
	generatedBy: string;
	columns?: string[];
	rows: Record<string, string | number | null>[];
}

export interface DiscriminatorStat {
	key: string;
	family: AttrFamily;
	/** Tenant-wide fill rate, null when not measured. */
	fillRate: number | null;
	/** Rank score: fillRate × disagreement. Keys that never agree are demoted. */
	score: number | null;
	/** Sampled pairs this was measured over. */
	pairs: number;
	bothPopulated: number;
	equal: number;
	differ: number;
	oneSided: number;
	bothBlank: number;
	/** differ / bothPopulated, or null when nothing was comparable. */
	differShare: number | null;
	/** bothPopulated / pairs. */
	coverage: number;
}

export type ReductionKind = 'Tighten rule' | 'Map keys' | 'No change';

/**
 * EXPERIMENTAL: generated by the extension from measured sampled pairs, unlike the
 * user-supplied Coverage Try / skip rows. Never applied to L3.
 */
export interface ReductionSuggestion {
	ruleShortName: string;
	/** Every attribute the rule compares today, as on Rule Activity. Hidden ones read "(not mapped)". */
	keysInRule: string;
	censusNow: number | null;
	censusStatus: MatchLabCensusStatus;
	kind: ReductionKind;
	/** Short names of the keys being added. Empty for 'No change'. */
	addedKeys: string[];
	suggestion: string;
	/**
	 * What the row rests on. `sampled` means this rule's pairs measured how the key
	 * behaves, so the survival and estimate columns mean something. `fill-rate` means
	 * the key is well populated tenant-wide but the sample could not measure whether it
	 * separates these pairs, so those columns read `not measured` rather than 0.
	 */
	evidence: 'sampled' | 'fill-rate';
	/** Two bullets, whole tenant: how often the added keys are filled in, and how unique they are. */
	why: string;
	/** Tenant-wide fill rate and uniqueness of each added key, as measured this run. */
	fillRates: {
		key: string;
		rate: number | null;
		sharedProfileRate?: number | null;
		populated?: number | null;
		total?: number | null;
		uniqueValues?: number | null;
		sharedValues?: number | null;
		source?: AttributeFillRate['source'];
	}[];
	/** Extrapolation of censusNow by the sampled survival rate — an estimate, not a measured count. */
	estimatedCensusAfter: number | null;
	/**
	 * Ceiling from Data Quality uniqueness: as exact, only profiles whose value another
	 * profile also holds can still match. Approximate for multi-valued attributes.
	 */
	maxCensusAfter?: number | null;
	/** Profiles populating the rule's exact keys plus every added key. */
	eligibleWithKeys: number | null;
	filter?: string;
}

/** Optional, user-supplied. Distinguishes "unused key" from "tenant has no data". */
export interface MatchLabMappingInput {
	source: string;
	/** Attribute short names or URIs the customer intended to map. */
	intendedAttributes: string[];
}

export interface MatchLabPairRow {
	entityTypeUri: string;
	ruleShortName: string;
	ruleLabel: string;
	profileAUri: string;
	profileBUri: string;
	profileALabel: string;
	profileBLabel: string;
	profileAHubUrl: string;
	profileBHubUrl: string;
	/** The owning rule's match scope, bare — 'ALL', 'INTERNAL', 'NONE'. */
	scope: string;
	whyItMatched: string;
	alsoMatchedBy: string;
	fernScore?: number;
	fernConfidence?: number;
	values: Record<string, string>;
}

export interface TenantMatchingStatusSnapshot {
	status: string | undefined;
	matchingQueueSize: number | undefined;
	eventsQueueSize: number | undefined;
}

export type MatchingGateReason =
	| 'idle'
	| 'unreadable-queue'
	| 'matching-not-zero'
	| 'events-not-draining'
	| 'unknown-status'
	| 'timeout'
	| 'unauthorized';

export interface MatchingGatePoll {
	at: string;
	status: string | null;
	matchingQueueSize: number | null;
	eventsQueueSize: number | null;
}

export interface MatchingGateResult {
	idle: boolean;
	skipped: boolean;
	reason: MatchingGateReason;
	blockedReason?: string;
	last: TenantMatchingStatusSnapshot;
	polls: MatchingGatePoll[];
	sidecarPath?: string;
}

export interface MatchLabEntityFile {
	entityType: string;
	entityTypeUri: string;
	path: string;
	/** In-memory workbook from this run — shown in the panel without rereading disk. */
	workbook?: import('./workbook').EntityWorkbook;
	census: {
		rule: string;
		entitiesWithMatches: number | null;
		censusStatus: MatchLabCensusStatus;
		recommendation: string;
	}[];
}

export interface MatchLabEngineResult {
	environmentHost: string;
	tenantId: string;
	gate: MatchingGateResult;
	entityFiles: MatchLabEntityFile[];
	recommendations: RuleRecommendation[];
	/** Compatibility view-model for the existing panel (no extra PII beyond sidecar). */
	report: MatchLabReport;
}

export interface MatchLabReport {
	environmentHost: string;
	tenantId: string;
	generatedAt: string;
	gate: MatchingGateResult;
	census: MatchLabCensusRow[];
	pairs: MatchLabPairRow[];
	ruleNotes: { entityTypeUri: string; ruleUri: string; notes: string }[];
	showFernColumns: boolean;
	typesWithMatchGroups: string[];
}

export class MatchingNotIdleError extends Error {
	constructor(
		readonly gate: MatchingGateResult,
		message?: string,
	) {
		super(message ?? gate.blockedReason ?? 'Matching pipeline is not idle.');
		this.name = 'MatchingNotIdleError';
	}
}

export interface MatchLabApi {
	getTenantMatchingStatus(
		baseUrl: string,
		tenantId: string,
		token: string,
	): Promise<{
		status?: string;
		matchingQueueSize?: number;
		eventsQueueSize?: number;
		body: unknown;
		text: string;
	}>;
	countEntities(baseUrl: string, tenantId: string, token: string, filter: string): Promise<number>;
	searchEntities(
		baseUrl: string,
		tenantId: string,
		token: string,
		options: { filter: string; max: number; offset: number },
	): Promise<unknown[]>;
	getEntityMatches(
		baseUrl: string,
		tenantId: string,
		token: string,
		entityId: string,
		options?: { offset?: number; max?: number },
	): Promise<unknown>;
	getEntitiesByUris(
		baseUrl: string,
		tenantId: string,
		token: string,
		uris: string[],
	): Promise<unknown[]>;
	getDataQualityStatistic?(
		baseUrl: string,
		tenantId: string,
		token: string,
		entityType: string,
		attributePath: string,
	): Promise<unknown>;
}
