export interface MatchHit {
	partnerUri: string;
	matchRuleUris: string[];
	fernScore?: number;
	fernConfidence?: number;
	object?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return undefined;
}

function stringList(value: unknown): string[] {
	if (typeof value === 'string' && value.length > 0) return [value];
	if (!Array.isArray(value)) return [];
	return value.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

function asNumber(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value.trim());
	return undefined;
}

function partnerUriFrom(rec: Record<string, unknown>): string | undefined {
	if (typeof rec.uri === 'string') return rec.uri;
	const object = asRecord(rec.object);
	if (object && typeof object.uri === 'string') return object.uri;
	const entity = asRecord(rec.entity);
	if (entity && typeof entity.uri === 'string') return entity.uri;
	return undefined;
}

function matchRuleUrisFrom(rec: Record<string, unknown>): string[] {
	const fromRules = [
		...stringList(rec.matchRules),
		...stringList(rec.matchRuleURIs),
		...stringList(rec.matchGroups),
	];
	if (fromRules.length > 0) return fromRules;
	const object = asRecord(rec.object);
	if (object) {
		return [
			...stringList(object.matchRules),
			...stringList(object.matchGroups),
		];
	}
	return [];
}

function fernFrom(rec: Record<string, unknown>): { score?: number; confidence?: number } {
	const score =
		asNumber(rec.relevance) ??
		asNumber(rec.Relevance) ??
		asNumber(rec.fernScore) ??
		asNumber(rec.relevancy);
	const confidence =
		asNumber(rec.fernConfidence) ??
		asNumber(rec.confidence) ??
		asNumber(rec.mlConfidence);
	return { score, confidence };
}

function flattenGroupedByMatchGroup(rec: Record<string, unknown>): unknown[] {
	const items: unknown[] = [];
	for (const [key, value] of Object.entries(rec)) {
		if (!key.includes('/matchGroups/')) continue;
		const list = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
		for (const item of list) {
			if (!item || typeof item !== 'object') continue;
			const row = item as Record<string, unknown>;
			items.push(matchRuleUrisFrom(row).length > 0 ? item : { ...row, matchRules: [key] });
		}
	}
	return items;
}

export function extractMatchItems(raw: unknown): unknown[] {
	if (Array.isArray(raw)) return raw;
	const rec = asRecord(raw);
	if (!rec) return [];
	if (Array.isArray(rec.matches)) return rec.matches;
	const nestedMatches = asRecord(rec.matches);
	if (nestedMatches) {
		const nested = flattenGroupedByMatchGroup(nestedMatches);
		if (nested.length > 0) return nested;
	}
	if (Array.isArray(rec.objects)) return rec.objects;
	const grouped = flattenGroupedByMatchGroup(rec);
	if (grouped.length > 0) return grouped;
	return [];
}

export function parseMatchHit(raw: unknown): MatchHit | undefined {
	const rec = asRecord(raw);
	if (!rec) return undefined;
	const partnerUri = partnerUriFrom(rec);
	if (!partnerUri) return undefined;
	const fern = fernFrom(rec);
	return {
		partnerUri,
		matchRuleUris: matchRuleUrisFrom(rec),
		fernScore: fern.score,
		fernConfidence: fern.confidence,
		object: rec.object ?? rec.entity ?? (typeof rec.uri === 'string' ? rec : undefined),
	};
}

export function parseMatchHits(raw: unknown): MatchHit[] {
	const out: MatchHit[] = [];
	for (const item of extractMatchItems(raw)) {
		const hit = parseMatchHit(item);
		if (hit) out.push(hit);
	}
	return out;
}
