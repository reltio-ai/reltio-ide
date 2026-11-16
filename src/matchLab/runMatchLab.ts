import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
	countEntities,
	getEntitiesByUris,
	getEntityMatches,
	getDataQualityStatistic,
	getTenantMatchingStatus,
	searchEntities,
} from './reltioApi';
import type { ReltioBusinessModel } from '../model/types';
import { parseDocument } from '../parser/configParser';
import { MATCH_LAB_ENGINE_VERSION, MATCH_LAB_GATE } from './defaults';
import { entityTypeByUri, inventoryMatchLabType, inventoryMatchLabTypes } from './l3Inventory';
import { waitForMatchingIdle } from './matchingGate';
import { loadMappingInput } from './mappingInput';
import { allAttributeUris, attributeFillRates } from './fillRates';
import { eligibleForRules } from './occupancy';
import { pairOccupancy, recommendRule } from './recommendations';
import { countingApi, newRunStats } from './runStats';
import { buildReductionSuggestions } from './reductionSuggestions';
import { censusEntityType, samplePairsForType } from './samplePairs';
import { measureRuleOverlap } from './ruleOverlap';
import { fillRateCacheUsable, readFillRateCache, writeEntityWorkbook, writeFillRateCache } from './sidecar';
import { buildEntityWorkbook, censusSummaryFromWorkbook } from './workbook';
import type {
	AttributeFillRate,
	FillRateScope,
	MatchLabApi,
	MatchLabEngineResult,
	MatchLabEntityFile,
	MatchLabMappingInput,
	MatchLabReport,
	MatchLabTypeInventory,
	MatchingGateResult,
	RuleRecommendation,
} from './types';
import { MatchingNotIdleError } from './types';

export interface RunMatchLabOptions {
	skip?: boolean;
	api?: MatchLabApi;
	tenantRoot?: string;
	sleep?: (ms: number) => Promise<void>;
	onProgress?: (message: string) => void;
	/** Scopes the run to these entity types. Empty or omitted means every type with match groups. */
	entityTypeUris?: string[];
	focusRuleUris?: string[];
	pollIntervalMs?: number;
	maxAttempts?: number;
	/** Optional, user-supplied: which attributes the customer intended to map. */
	mappingFile?: string;
	mapping?: MatchLabMappingInput;
	/** `all` measures every attribute and renders the Fill rates tab. Default `candidates`. */
	fillRateScope?: FillRateScope;
	fillRateMaxAgeHours?: number;
}

const FILL_RATE_MAX_AGE_HOURS = 168;

function defaultApi(): MatchLabApi {
	return {
		getTenantMatchingStatus,
		countEntities,
		searchEntities,
		getEntityMatches,
		getEntitiesByUris,
		getDataQualityStatistic,
	};
}

/**
 * Scoped runs keep the inventory order so the workbook is identical to a full run's slice.
 * A type asked for by name is analysed even with no match groups — it still gets a profile
 * count and fill rates, which is what you need before writing a first rule.
 */
function scopeTypes(
	model: ReltioBusinessModel,
	types: MatchLabTypeInventory[],
	entityTypeUris: string[] | undefined,
): MatchLabTypeInventory[] {
	if (!entityTypeUris || entityTypeUris.length === 0) return types;
	const wanted = new Set(entityTypeUris);
	const scoped = types.filter(t => wanted.has(t.entityTypeUri));
	const found = new Set(scoped.map(t => t.entityTypeUri));
	for (const uri of entityTypeUris) {
		if (found.has(uri)) continue;
		const et = entityTypeByUri(model, uri);
		if (et) scoped.push(inventoryMatchLabType(et));
	}
	return scoped;
}

/**
 * Full-scope fill rates for one entity type, served from the sidecar when it is still
 * current. The returned `cache` is handed to the suggestion pass so a candidate the
 * full sweep already measured costs nothing a second time.
 *
 * On `candidates` scope this measures nothing: the suggestion pass counts only the
 * attributes it actually gates on, exactly as before.
 */
async function measureFullScopeFillRates(
	api: MatchLabApi,
	baseUrl: string,
	tenantId: string,
	token: string,
	input: {
		typeInv: MatchLabTypeInventory;
		tenantRoot: string;
		scope: FillRateScope;
		maxAgeHours: number;
		onProgress?: (message: string) => void;
	},
): Promise<{ cache: Map<string, AttributeFillRate>; rows?: AttributeFillRate[]; measuredAt?: string }> {
	const cache = new Map<string, AttributeFillRate>();
	if (input.scope !== 'all') return { cache };

	const { typeInv } = input;
	const cached = await readFillRateCache(input.tenantRoot, typeInv.shortName);
	const reusable = fillRateCacheUsable(cached, {
		engineVersion: MATCH_LAB_ENGINE_VERSION,
		entityTypeUri: typeInv.entityTypeUri,
		scope: 'all',
		maxAgeHours: input.maxAgeHours,
	});
	if (reusable && cached) {
		for (const row of cached.rows) cache.set(row.uri, row);
	}
	let measuredCount = 0;

	const uris = allAttributeUris(typeInv);
	input.onProgress?.(`${typeInv.shortName}: fill rates 0/${uris.length}`);
	// A 401 here propagates, which aborts the run before any cache is written.
	const measured = await attributeFillRates(api, baseUrl, tenantId, token, typeInv, uris, {
		cache,
		onProgress: (done, total) => {
			measuredCount = done;
			if (done === total || done % 25 === 0) {
				input.onProgress?.(`${typeInv.shortName}: fill rates ${done}/${total}`);
			}
		},
	});

	const rows = [...measured.values()];
	const measuredSomething = measuredCount > 0 || !reusable;
	const measuredAt = measuredSomething || !cached ? new Date().toISOString() : cached.measuredAt;
	if (measuredSomething) {
		await writeFillRateCache(input.tenantRoot, typeInv.shortName, {
			engineVersion: MATCH_LAB_ENGINE_VERSION,
			entityTypeUri: typeInv.entityTypeUri,
			measuredAt,
			scope: 'all',
			typeTotal: rows.find(r => r.total != null)?.total ?? null,
			rows,
		});
	}
	return { cache, rows, measuredAt };
}

function toReport(
	baseUrl: string,
	tenantId: string,
	gate: MatchingGateResult,
	typesWithMatchGroups: string[],
	pairs: MatchLabReport['pairs'],
	census: MatchLabReport['census'],
	showFernColumns: boolean,
): MatchLabReport {
	return {
		environmentHost: baseUrl,
		tenantId,
		generatedAt: new Date().toISOString(),
		gate,
		census,
		pairs: showFernColumns ? pairs : pairs.map(({ fernScore: _s, fernConfidence: _c, ...rest }) => rest),
		ruleNotes: census.filter(c => c.notes).map(c => ({
			entityTypeUri: c.entityTypeUri,
			ruleUri: c.ruleUri,
			notes: c.notes,
		})),
		showFernColumns,
		typesWithMatchGroups,
	};
}

/**
 * Census + sampled unique pairs for every L3 entity type that has matchGroups.
 * Writes sheet-shaped `{EntityType}.json` under match-lab/. Does not PUT configuration.
 */
export async function runMatchLab(
	baseUrl: string,
	tenantId: string,
	token: string,
	l3Path: string,
	options?: RunMatchLabOptions,
): Promise<MatchLabEngineResult> {
	const stats = newRunStats();
	const api = countingApi(options?.api ?? defaultApi(), stats);
	const skip = options?.skip === true;
	const tenantRoot = options?.tenantRoot ?? path.dirname(l3Path);
	const focusRuleUris = new Set(options?.focusRuleUris ?? []);
	const l3Text = await fs.readFile(l3Path, 'utf8');
	const { model } = parseDocument(l3Text);
	const types = scopeTypes(model, inventoryMatchLabTypes(model), options?.entityTypeUris);
	options?.onProgress?.(`Analyzing ${types.length} entity type(s).`);

	options?.onProgress?.('Checking matching pipeline…');
	const gate = await waitForMatchingIdle(baseUrl, tenantId, token, {
		skip,
		sleep: options?.sleep,
		pollIntervalMs: options?.pollIntervalMs ?? MATCH_LAB_GATE.pollIntervalMs,
		maxAttempts: options?.maxAttempts ?? MATCH_LAB_GATE.maxAttempts,
		tenantRoot,
		getTenantMatchingStatus: api.getTenantMatchingStatus,
	});
	if (!gate.idle && !gate.skipped) {
		throw new MatchingNotIdleError(gate);
	}

	const mapping =
		options?.mapping ?? (options?.mappingFile ? await loadMappingInput(options.mappingFile) : undefined);

	const entityFiles: MatchLabEntityFile[] = [];
	const allCensus: MatchLabReport['census'] = [];
	const allPairs: MatchLabReport['pairs'] = [];
	const allRecommendations: RuleRecommendation[] = [];
	let anyFern = false;

	for (const typeInv of types) {
		// No rules means nothing to census or sample; every tab carries the reason instead.
		if (typeInv.matchGroups.length === 0) {
			const workbook = buildEntityWorkbook({
				baseUrl,
				tenantId,
				typeInv,
				census: [],
				pairs: [],
				pairsByRule: new Map(),
				showFernColumns: false,
				recommendations: [],
				reductions: [],
			});
			const noRulesPath = await writeEntityWorkbook(tenantRoot, workbook);
			entityFiles.push({
				entityType: typeInv.shortName,
				entityTypeUri: typeInv.entityTypeUri,
				path: noRulesPath,
				census: [],
			});
			continue;
		}

		const fullScope = await measureFullScopeFillRates(api, baseUrl, tenantId, token, {
			typeInv,
			tenantRoot,
			scope: options?.fillRateScope ?? 'candidates',
			maxAgeHours: options?.fillRateMaxAgeHours ?? FILL_RATE_MAX_AGE_HOURS,
			onProgress: options?.onProgress,
		});

		options?.onProgress?.(`Census: ${typeInv.shortName}`);
		const typeCensus = await censusEntityType(api, baseUrl, tenantId, token, typeInv);
		allCensus.push(...typeCensus);
		const sampled = await samplePairsForType(
			api,
			baseUrl,
			tenantId,
			token,
			typeInv,
			typeCensus,
			focusRuleUris,
		);
		allPairs.push(...sampled.pairs);
		if (sampled.showFernColumns) anyFern = true;

		options?.onProgress?.(`Occupancy: ${typeInv.shortName}`);
		const eligibility = await eligibleForRules(api, baseUrl, tenantId, token, typeInv);
		const eligByUri = new Map(eligibility.map(e => [e.ruleUri, e] as const));
		const censusByUri = new Map(typeCensus.map(c => [c.ruleUri, c] as const));
		const recommendations = typeInv.matchGroups
			.filter(g => !g.isFern)
			.map(rule =>
				recommendRule({
					rule,
					census: censusByUri.get(rule.uri),
					eligibility: eligByUri.get(rule.uri),
					occupancy: pairOccupancy(sampled.pairsByRule.get(rule.shortName) ?? [], sampled.pairs),
					mapping,
				}),
			);
		allRecommendations.push(...recommendations);

		options?.onProgress?.(`Rule overlap: ${typeInv.shortName}`);
		const ruleOverlap = await measureRuleOverlap(
			api,
			baseUrl,
			tenantId,
			token,
			typeInv,
			typeCensus,
		);

		options?.onProgress?.(`Suggested changes: ${typeInv.shortName}`);
		const reductions = await buildReductionSuggestions(api, baseUrl, tenantId, token, {
			typeInv,
			census: typeCensus,
			pairsByRule: sampled.pairsByRule,
			// Seeded from the full-scope pass so a candidate is never counted twice.
			fillRateCache: fullScope.cache,
		});

		const workbook = buildEntityWorkbook({
			baseUrl,
			tenantId,
			typeInv,
			census: typeCensus,
			pairs: sampled.pairs,
			pairsByRule: sampled.pairsByRule,
			showFernColumns: sampled.showFernColumns,
			recommendations,
			reductions,
			ruleOverlap,
		});
		const filePath = await writeEntityWorkbook(tenantRoot, workbook);
		entityFiles.push({
			entityType: typeInv.shortName,
			entityTypeUri: typeInv.entityTypeUri,
			path: filePath,
			workbook,
			census: censusSummaryFromWorkbook(workbook),
		});
	}

	const report = toReport(
		baseUrl,
		tenantId,
		gate,
		types.map(t => t.entityTypeUri),
		allPairs,
		allCensus,
		anyFern,
	);

	return {
		environmentHost: baseUrl,
		tenantId,
		gate,
		entityFiles,
		recommendations: allRecommendations,
		report,
	};
}

/** Rule name plus recommendation label only. No pair PII and no rule JSON. */
export function chatSummary(result: MatchLabEngineResult): string {
	const lines: string[] = [
		`Match Lab for ${result.tenantId} @ ${result.environmentHost}`,
		`Entity types with match groups: ${result.entityFiles.length} (${result.entityFiles.map(f => f.entityType).join(', ')})`,
	];
	for (const file of result.entityFiles) {
		const bits = file.census.map(c => `${c.rule}: ${c.recommendation || 'no recommendation'}`);
		lines.push(`${file.entityType}: ${bits.join('; ')}`);
	}
	lines.push('Recommendations are observational. Match Lab does not edit L3 or rebuild match tables.');
	return lines.join('\n');
}
