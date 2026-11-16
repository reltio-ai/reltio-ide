import { existsAllAttributesFilter } from './censusFilters';
import { shortNameFromUri } from './entityUris';
import type { MatchLabApi, MatchLabRuleInventory, MatchLabTypeInventory, RuleEligibility } from './types';

export const NO_EXACT_KEYS_REASON = 'no exact keys';

function errorStatus(e: unknown): number | undefined {
	if (e && typeof e === 'object' && 'statusCode' in e) {
		return Number((e as { statusCode: unknown }).statusCode);
	}
	return undefined;
}

/**
 * Exact keys only. Exact-or-null and negative-only clauses produce no tokens, and
 * L3 `hidden:true` keys cannot contribute at all, so all three are skipped.
 */
export function occupancyKeysForRule(rule: MatchLabRuleInventory): {
	used: { uri: string; key: string }[];
	skipped: { uri: string; key: string; reason: string }[];
} {
	const hidden = new Set(rule.hiddenAttributeUris);
	const used: { uri: string; key: string }[] = [];
	const skipped: { uri: string; key: string; reason: string }[] = [];
	for (const uri of rule.exactAttributeUris) {
		const key = shortNameFromUri(uri);
		if (hidden.has(uri)) skipped.push({ uri, key, reason: 'not mapped (hidden)' });
		else used.push({ uri, key });
	}
	for (const uri of rule.exactOrNullAttributeUris) {
		skipped.push({ uri, key: shortNameFromUri(uri), reason: 'exact-or-null' });
	}
	for (const uri of rule.negativeOnlyAttributeUris) {
		skipped.push({ uri, key: shortNameFromUri(uri), reason: 'negative-only' });
	}
	return { used, skipped };
}

/** One countEntities call per rule. `eligible` is null when it cannot be measured. */
export async function eligibleForRules(
	api: MatchLabApi,
	baseUrl: string,
	tenantId: string,
	token: string,
	typeInv: MatchLabTypeInventory,
): Promise<RuleEligibility[]> {
	const out: RuleEligibility[] = [];
	for (const rule of typeInv.matchGroups) {
		if (rule.isFern) continue;
		const { used, skipped } = occupancyKeysForRule(rule);
		const base = {
			ruleUri: rule.uri,
			ruleShortName: rule.shortName,
			keysUsed: used.map(u => u.key),
			keysSkipped: skipped.map(s => ({ key: s.key, reason: s.reason })),
		};
		if (used.length === 0) {
			out.push({ ...base, eligible: null, reason: NO_EXACT_KEYS_REASON });
			continue;
		}
		const filter = existsAllAttributesFilter(
			typeInv.entityTypeUri,
			used.map(u => u.uri),
		);
		try {
			const eligible = await api.countEntities(baseUrl, tenantId, token, filter);
			out.push({ ...base, eligible, filter });
		} catch (e) {
			if (errorStatus(e) === 401) throw e;
			out.push({ ...base, eligible: null, reason: `count failed: ${(e as Error).message}`, filter });
		}
	}
	return out;
}
