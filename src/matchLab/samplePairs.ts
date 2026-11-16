import { MATCH_LAB_SAMPLE } from './defaults';
import { censusFilterForRule } from './censusFilters';
import { canonicalPair, hubProfileUrl, normalizeEntityUri, shortNameFromUri } from './entityUris';
import { cmpValues, displayValues, entityLabel, flattenEntityOvValues, orderedValueColumns } from './entityValues';
import { parseMatchHits } from './matchHits';
import type { MatchHit } from './matchHits';
import type {
	MatchLabApi,
	MatchLabCensusRow,
	MatchLabPairRow,
	MatchLabRuleInventory,
	MatchLabTypeInventory,
} from './types';
import { whyItMatched } from './whyMatched';

/**
 * Which source records back a profile, as `source:value`. Two profiles from the same source
 * merging is a different conversation from two sources describing the same person.
 */
export function crosswalkText(entity: unknown): string {
	if (!entity || typeof entity !== 'object') return '';
	const list = (entity as { crosswalks?: unknown }).crosswalks;
	if (!Array.isArray(list)) return '';
	const seen = new Set<string>();
	for (const item of list) {
		if (!item || typeof item !== 'object') continue;
		const cw = item as { type?: unknown; value?: unknown };
		const source = typeof cw.type === 'string' ? shortNameFromUri(cw.type) : '';
		const value = typeof cw.value === 'string' ? cw.value : '';
		if (!source && !value) continue;
		seen.add(source && value ? `${source}:${value}` : source || value);
	}
	return [...seen].join(' | ');
}

function entityUriOf(entity: unknown): string | undefined {
	if (!entity || typeof entity !== 'object') return undefined;
	const uri = (entity as { uri?: unknown }).uri;
	return typeof uri === 'string' ? normalizeEntityUri(uri) : undefined;
}

function errorStatus(e: unknown): number | undefined {
	if (e && typeof e === 'object' && 'statusCode' in e) {
		return Number((e as { statusCode: unknown }).statusCode);
	}
	return undefined;
}

export function sampleCapForRule(census: number, focus: boolean): number {
	const cap = focus ? MATCH_LAB_SAMPLE.p0ProfilesPerFocusRule : MATCH_LAB_SAMPLE.p1ProfilesPerRule;
	return Math.min(census, cap);
}

export async function censusEntityType(
	api: MatchLabApi,
	baseUrl: string,
	tenantId: string,
	token: string,
	typeInv: MatchLabTypeInventory,
): Promise<MatchLabCensusRow[]> {
	const rows: MatchLabCensusRow[] = [];
	for (const rule of typeInv.matchGroups) {
		if (rule.isFern) continue;
		const notes: string[] = [];
		if (rule.hiddenAttributeUris.length > 0) {
			notes.push(
				rule.hiddenAttributeUris.map(uri => `${shortNameFromUri(uri)} (not mapped)`).join(', '),
			);
		}
		const censusFilter = censusFilterForRule(typeInv.entityTypeUri, rule.uri);
		try {
			const count = await api.countEntities(baseUrl, tenantId, token, censusFilter);
			rows.push({
				entityTypeUri: typeInv.entityTypeUri,
				entityTypeLabel: typeInv.label,
				ruleUri: rule.uri,
				ruleShortName: rule.shortName,
				ruleLabel: rule.label,
				ruleType: rule.type,
				scope: rule.scope,
				entitiesWithMatches: count,
				censusStatus: 'ok',
				notes: notes.join('; '),
				skippedSample: count === 0,
				censusFilter,
			});
		} catch (e) {
			if (errorStatus(e) === 401) throw e;
			const http = errorStatus(e);
			notes.push(`Census failed: ${(e as Error).message}`);
			rows.push({
				entityTypeUri: typeInv.entityTypeUri,
				entityTypeLabel: typeInv.label,
				ruleUri: rule.uri,
				ruleShortName: rule.shortName,
				ruleLabel: rule.label,
				ruleType: rule.type,
				scope: rule.scope,
				entitiesWithMatches: null,
				censusStatus: 'error',
				censusHttpStatus: Number.isFinite(http) ? http : undefined,
				notes: notes.join('; '),
				skippedSample: true,
				censusFilter,
			});
		}
	}
	return rows;
}

async function fetchMatches(
	api: MatchLabApi,
	baseUrl: string,
	tenantId: string,
	token: string,
	entityId: string,
): Promise<MatchHit[]> {
	const raw = await api.getEntityMatches(baseUrl, tenantId, token, entityId);
	return parseMatchHits(raw);
}

interface AccPair {
	profileA: string;
	profileB: string;
	ruleUris: Set<string>;
	fernScore?: number;
	fernConfidence?: number;
}

export interface SamplePairsResult {
	pairs: MatchLabPairRow[];
	pairsByRule: Map<string, MatchLabPairRow[]>;
	showFernColumns: boolean;
}

function roundFern(n: number): number {
	return Math.round(n * 1000) / 1000;
}

function resolveHandBuilt(
	uri: string,
	rulesByUri: Map<string, MatchLabRuleInventory>,
	rulesByShort: Map<string, MatchLabRuleInventory>,
): MatchLabRuleInventory | undefined {
	const hit = rulesByUri.get(uri) ?? rulesByShort.get(shortNameFromUri(uri));
	if (!hit || hit.isFern) return undefined;
	return hit;
}

export async function samplePairsForType(
	api: MatchLabApi,
	baseUrl: string,
	tenantId: string,
	token: string,
	typeInv: MatchLabTypeInventory,
	census: MatchLabCensusRow[],
	focusRuleUris: Set<string> = new Set(),
): Promise<SamplePairsResult> {
	const pairs = new Map<string, AccPair>();
	const censusByUri = new Map(census.map(row => [row.ruleUri, row] as const));
	const handBuilt = typeInv.matchGroups.filter(g => !g.isFern);

	for (const rule of handBuilt) {
		const row = censusByUri.get(rule.uri);
		if (row?.censusStatus === 'error') continue;
		const n = row?.entitiesWithMatches;
		if (n == null || n <= 0) continue;
		const cap = sampleCapForRule(n, focusRuleUris.has(rule.uri) || focusRuleUris.has(rule.shortName));
		const filter = row?.censusFilter ?? censusFilterForRule(typeInv.entityTypeUri, rule.uri);
		let seeds: unknown[] = [];
		try {
			seeds = await api.searchEntities(baseUrl, tenantId, token, { filter, max: cap, offset: 0 });
		} catch (e) {
			if (errorStatus(e) === 401) throw e;
			continue;
		}
		for (const entity of seeds) {
			if (pairs.size >= MATCH_LAB_SAMPLE.maxUniquePairsPerEntity) break;
			const seed = entityUriOf(entity);
			if (!seed) continue;
			let hits: MatchHit[];
			try {
				hits = await fetchMatches(api, baseUrl, tenantId, token, seed);
			} catch (e) {
				if (errorStatus(e) === 401) throw e;
				continue;
			}
			for (const hit of hits) {
				const canon = canonicalPair(seed, hit.partnerUri);
				if (!canon) continue;
				const existing = pairs.get(canon.key);
				if (existing) {
					for (const r of hit.matchRuleUris) existing.ruleUris.add(r);
					if (existing.fernScore == null && hit.fernScore != null) existing.fernScore = hit.fernScore;
					if (existing.fernConfidence == null && hit.fernConfidence != null) {
						existing.fernConfidence = hit.fernConfidence;
					}
				} else if (pairs.size < MATCH_LAB_SAMPLE.maxUniquePairsPerEntity) {
					pairs.set(canon.key, {
						profileA: canon.profileA,
						profileB: canon.profileB,
						ruleUris: new Set(hit.matchRuleUris),
						fernScore: hit.fernScore,
						fernConfidence: hit.fernConfidence,
					});
				}
			}
		}
	}

	const needed = new Set<string>();
	for (const p of pairs.values()) {
		needed.add(p.profileA);
		needed.add(p.profileB);
	}
	const fetched = new Map<string, unknown>();
	if (needed.size > 0) {
		try {
			const entities = await api.getEntitiesByUris(baseUrl, tenantId, token, [...needed]);
			for (const entity of entities) {
				const uri = entityUriOf(entity);
				if (uri) fetched.set(uri, entity);
			}
		} catch (e) {
			if (errorStatus(e) === 401) throw e;
		}
	}

	const metaByUri = new Map(typeInv.attributes.map(a => [a.uri, a] as const));
	const metaByName = new Map(typeInv.attributes.map(a => [a.name, a] as const));
	const rulesByUri = new Map(typeInv.matchGroups.map(g => [g.uri, g] as const));
	const rulesByShort = new Map(typeInv.matchGroups.map(g => [g.shortName, g] as const));

	const rows: MatchLabPairRow[] = [];
	for (const p of pairs.values()) {
		const aEntity = fetched.get(p.profileA);
		const bEntity = fetched.get(p.profileB);
		const aVals = displayValues(flattenEntityOvValues(aEntity), metaByUri, metaByName);
		const bVals = displayValues(flattenEntityOvValues(bEntity), metaByUri, metaByName);
		const resolved = [...p.ruleUris]
			.map(uri => resolveHandBuilt(uri, rulesByUri, rulesByShort))
			.filter((x): x is MatchLabRuleInventory => !!x);
		const primary = resolved[0] ?? handBuilt[0];
		const also = [...new Set(resolved.slice(1).map(r => r.shortName).filter(n => n !== primary?.shortName))];
		const values: Record<string, string> = {};
		const names = new Set([...Object.keys(aVals), ...Object.keys(bVals)]);
		const ordered = orderedValueColumns(typeInv.attributes, names);
		for (const col of ordered) {
			values[`a_${col.key}`] = aVals[col.key] ?? '';
			values[`b_${col.key}`] = bVals[col.key] ?? '';
			values[`cmp_${col.key}`] = cmpValues(aVals[col.key], bVals[col.key]);
		}
		values.a_crosswalks = crosswalkText(aEntity);
		values.b_crosswalks = crosswalkText(bEntity);
		rows.push({
			entityTypeUri: typeInv.entityTypeUri,
			ruleShortName: primary?.shortName ?? '',
			ruleLabel: primary?.label ?? '',
			profileAUri: p.profileA,
			profileBUri: p.profileB,
			profileALabel: entityLabel(aEntity, p.profileA),
			profileBLabel: entityLabel(bEntity, p.profileB),
			profileAHubUrl: hubProfileUrl(baseUrl, tenantId, p.profileA),
			profileBHubUrl: hubProfileUrl(baseUrl, tenantId, p.profileB),
			scope: primary?.scope ?? '',
			whyItMatched: primary ? whyItMatched(primary, aVals, bVals) : '',
			alsoMatchedBy: also.join(', '),
			fernScore: p.fernScore != null ? roundFern(p.fernScore) : undefined,
			fernConfidence: p.fernConfidence != null ? roundFern(p.fernConfidence) : undefined,
			values,
		});
	}

	const showFernColumns = rows.some(r => r.fernScore != null || r.fernConfidence != null);
	const pairsByRule = new Map<string, MatchLabPairRow[]>();
	for (const row of rows) {
		const shorts = new Set<string>([row.ruleShortName]);
		for (const part of row.alsoMatchedBy.split(',')) {
			const s = part.trim();
			if (s) shorts.add(s);
		}
		for (const s of shorts) {
			const list = pairsByRule.get(s) ?? [];
			list.push(row);
			pairsByRule.set(s, list);
		}
	}
	return { pairs: rows, pairsByRule, showFernColumns };
}
