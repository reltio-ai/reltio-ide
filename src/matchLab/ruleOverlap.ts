import { formatCount, pctOrUnmeasured } from './runStats';
import type { MatchLabApi, MatchLabCensusRow, MatchLabRuleInventory, MatchLabTypeInventory, RuleOverlapRow } from './types';

/** Profiles with potential matches on both rules — tenant-wide, not from the sample. */
export function overlapFilterForRules(entityTypeUri: string, ruleUriA: string, ruleUriB: string): string {
	return [
		`equals(type,'${entityTypeUri}')`,
		'gt(matches,0)',
		`equals(matchRules,'${ruleUriA}')`,
		`equals(matchRules,'${ruleUriB}')`,
	].join(' and ');
}

function share(numerator: number | null, denominator: number | null): number | null {
	if (numerator == null || denominator == null || denominator <= 0) return null;
	return numerator / denominator;
}

function overlapFinding(
	ruleA: string,
	ruleB: string,
	countA: number | null,
	countB: number | null,
	both: number | null,
): string {
	if (both == null) {
		return `Could not count profiles flagged by both ${ruleA} and ${ruleB}. The filter may not be supported on this tenant.`;
	}
	if (both === 0) {
		return `No profile in the tenant is flagged by both ${ruleA} and ${ruleB}, though each rule may still produce matches on its own.`;
	}
	const parts: string[] = [
		`${formatCount(both)} profile(s) carry potential matches from both rules.`,
	];
	const sa = share(both, countA);
	const sb = share(both, countB);
	if (sa != null) parts.push(`${pctOrUnmeasured(sa)} of ${ruleA}'s potential matches (${formatCount(both)} of ${formatCount(countA)}) also match on ${ruleB}.`);
	if (sb != null) parts.push(`${pctOrUnmeasured(sb)} of ${ruleB}'s potential matches (${formatCount(both)} of ${formatCount(countB)}) also match on ${ruleA}.`);
	return parts.join(' ');
}

/**
 * For every hand-built rule pair, counts profiles the tenant flags on both rules. Cost is
 * one read-only count per pair — skipped when fewer than two rules exist.
 */
export async function measureRuleOverlap(
	api: MatchLabApi,
	baseUrl: string,
	tenantId: string,
	token: string,
	typeInv: MatchLabTypeInventory,
	census: MatchLabCensusRow[],
): Promise<RuleOverlapRow[]> {
	const rules = typeInv.matchGroups.filter(g => !g.isFern);
	if (rules.length < 2) return [];

	const countByUri = new Map<string, number | null>();
	for (const row of census) {
		countByUri.set(
			row.ruleUri,
			row.censusStatus === 'error' ? null : row.entitiesWithMatches,
		);
	}

	const out: RuleOverlapRow[] = [];
	for (let i = 0; i < rules.length; i += 1) {
		for (let j = i + 1; j < rules.length; j += 1) {
			const a = rules[i] as MatchLabRuleInventory;
			const b = rules[j] as MatchLabRuleInventory;
			const countA = countByUri.get(a.uri) ?? null;
			const countB = countByUri.get(b.uri) ?? null;
			const filter = overlapFilterForRules(typeInv.entityTypeUri, a.uri, b.uri);
			let both: number | null = null;
			try {
				both = await api.countEntities(baseUrl, tenantId, token, filter);
			} catch {
				both = null;
			}
			out.push({
				ruleA: a.shortName,
				ruleB: b.shortName,
				countA,
				countB,
				both,
				shareOfA: share(both, countA),
				shareOfB: share(both, countB),
				finding: overlapFinding(a.shortName, b.shortName, countA, countB, both),
				filter,
			});
		}
	}
	return out.sort(
		(x, y) =>
			(typeof y.both === 'number' ? y.both : -1) - (typeof x.both === 'number' ? x.both : -1)
			|| x.ruleA.localeCompare(y.ruleA)
			|| x.ruleB.localeCompare(y.ruleB),
	);
}
