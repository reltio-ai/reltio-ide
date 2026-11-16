import { attributeSearchPath, existsAttributeFilter, typeEqualsFilter } from './censusFilters';
import { shortNameFromUri } from './entityUris';
import { andList, pct } from './runStats';
import type { AttributeFillRate, MatchLabApi, MatchLabTypeInventory } from './types';

/** Counts issued in parallel. High enough to make a full pass bearable, low enough not to throttle. */
export const FILL_RATE_CONCURRENCY = 6;

/** Nesting depth from the repeated `/attributes/` marker: a top-level attribute is 1. */
export function attributeDepth(uri: string): number {
	return uri.split('/attributes/').length - 1;
}

/**
 * Every attribute of the type, nested ones included. Hidden attributes are kept: a
 * reviewer needs to see that an attribute is well populated before deciding whether
 * unhiding it would make a usable key.
 */
export function allAttributeUris(typeInv: MatchLabTypeInventory): string[] {
	return [...new Set(typeInv.attributes.map(a => a.uri))];
}

/** Match groups already using this attribute as an exact or exact-or-null key. */
export function rulesUsingAttribute(typeInv: MatchLabTypeInventory, uri: string): string[] {
	return typeInv.matchGroups
		.filter(g => g.exactAttributeUris.includes(uri) || g.exactOrNullAttributeUris.includes(uri))
		.map(g => g.shortName);
}

async function runPool<T>(
	items: T[],
	concurrency: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	let next = 0;
	const lanes = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
		for (;;) {
			const i = next++;
			if (i >= items.length) return;
			await worker(items[i]);
		}
	});
	await Promise.all(lanes);
}

/** Top values kept per attribute from the Data Quality `frequency` block. */
export const DQ_TOP_VALUES = 5;

function finiteCount(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Reads one `dataQuality/statistic` body. `uniqueness` counts distinct values, not
 * profiles, so the profile-level figure is derived: a profile's value is shared unless
 * it is one of the `unique` values. Multi-valued attributes can hold more unique values
 * than profiles, hence the clamp.
 */
export function parseDataQualityStatistic(body: unknown): {
	populated: number | null;
	total: number | null;
	uniqueValues: number | null;
	sharedValues: number | null;
	sharedProfileRate: number | null;
	topValues: { value: string; count: number }[];
} {
	const stat = (body && typeof body === 'object' ? body : {}) as {
		fillRate?: { exists?: unknown; missing?: unknown };
		uniqueness?: { unique?: unknown; notUnique?: unknown };
		frequency?: Record<string, unknown>;
	};
	const populated = finiteCount(stat.fillRate?.exists);
	const missing = finiteCount(stat.fillRate?.missing);
	const uniqueValues = finiteCount(stat.uniqueness?.unique);
	const sharedValues = finiteCount(stat.uniqueness?.notUnique);
	const sharedProfileRate = populated != null && populated > 0 && uniqueValues != null
		? Math.min(1, Math.max(0, (populated - uniqueValues) / populated))
		: null;
	const topValues = Object.entries(stat.frequency ?? {})
		.filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]))
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, DQ_TOP_VALUES)
		.map(([value, count]) => ({ value, count }));
	return {
		populated,
		total: populated != null && missing != null ? populated + missing : null,
		uniqueValues,
		sharedValues,
		sharedProfileRate,
		topValues,
	};
}

/**
 * Per-attribute fill rate and uniqueness for one entity type, measured on this tenant.
 * Uses `dataQuality/statistic` (exists / (exists + missing), plus uniqueness and top
 * values) when the API offers it, and falls back to count(exists(attributes.path)) /
 * count(type) per attribute when that call fails. A tenant that answers 403/404 for
 * Data Quality is not asked again for the rest of the pass.
 *
 * A cached row whose count failed is not an answer, so it is measured again rather
 * than reported as `not measured` forever. A row measured against an empty entity
 * type is an answer, and is reused. A cached row from before Data Quality was read is
 * measured again when Data Quality is available, so uniqueness is not missing for a week.
 */
export async function attributeFillRates(
	api: MatchLabApi,
	baseUrl: string,
	tenantId: string,
	token: string,
	typeInv: MatchLabTypeInventory,
	attributeUris: string[],
	options?: {
		cache?: Map<string, AttributeFillRate>;
		onProgress?: (done: number, total: number) => void;
		concurrency?: number;
	},
): Promise<Map<string, AttributeFillRate>> {
	const out = new Map<string, AttributeFillRate>();
	const wanted = [...new Set(attributeUris)];
	if (wanted.length === 0) return out;

	const cache = options?.cache;
	// Reuse a row only when both counts actually succeeded. A null rate from a zero
	// denominator is an answer; a null from a failed count is not, and re-measuring it
	// is what stops `not measured` from sticking for a week.
	const useDq = !!api.getDataQualityStatistic;
	const pending = wanted.filter(uri => {
		const hit = cache?.get(uri);
		if (hit && hit.populated != null && hit.total != null && (hit.source || !useDq)) {
			out.set(hit.key, hit);
			return false;
		}
		return true;
	});
	if (pending.length === 0) return out;

	// Only the count fallback needs the type total, so it is fetched once, on first use.
	let totalPromise: Promise<number | null> | undefined;
	const typeTotal = (): Promise<number | null> => {
		totalPromise ??= api
			.countEntities(baseUrl, tenantId, token, typeEqualsFilter(typeInv.entityTypeUri))
			.catch(e => {
				if (errorStatus(e) === 401) throw e;
				return null;
			});
		return totalPromise;
	};

	const metaByUri = new Map(typeInv.attributes.map(a => [a.uri, a] as const));
	let done = 0;
	// An expired token will not fix itself, so the first 401 stops the remaining lanes
	// instead of burning one failed count per attribute.
	let aborted: unknown;
	let dqUnavailable = !useDq;

	await runPool(pending, options?.concurrency ?? FILL_RATE_CONCURRENCY, async uri => {
		if (aborted) return;
		const key = shortNameFromUri(uri);
		const meta = metaByUri.get(uri);
		const base = {
			key,
			name: meta?.name ?? key,
			path: attributeSearchPath(uri),
			uri,
			family: meta?.family ?? 'other',
			depth: attributeDepth(uri),
			inRules: rulesUsingAttribute(typeInv, uri),
		} as const;
		let entry: AttributeFillRate | undefined;

		if (!dqUnavailable) {
			try {
				const dq = parseDataQualityStatistic(
					await api.getDataQualityStatistic!(baseUrl, tenantId, token, typeInv.entityTypeUri, base.path),
				);
				if (dq.populated != null && dq.total != null) {
					entry = {
						...base,
						populated: dq.populated,
						total: dq.total,
						rate: dq.total > 0 ? dq.populated / dq.total : null,
						source: 'dataQuality',
						uniqueValues: dq.uniqueValues,
						sharedValues: dq.sharedValues,
						sharedProfileRate: dq.sharedProfileRate,
						topValues: dq.topValues,
					};
				}
			} catch (e) {
				const status = errorStatus(e);
				if (status === 401) {
					aborted = e;
					return;
				}
				if (status === 403 || status === 404) dqUnavailable = true;
			}
		}

		if (!entry) {
			let populated: number | null = null;
			let total: number | null = null;
			try {
				total = await typeTotal();
				populated = await api.countEntities(
					baseUrl,
					tenantId,
					token,
					existsAttributeFilter(typeInv.entityTypeUri, uri),
				);
			} catch (e) {
				if (errorStatus(e) === 401) {
					aborted = e;
					return;
				}
				populated = null;
			}
			entry = {
				...base,
				populated,
				total,
				rate: populated != null && total != null && total > 0 ? populated / total : null,
				source: 'count',
			};
		}
		out.set(key, entry);
		cache?.set(uri, entry);
		options?.onProgress?.(++done, pending.length);
	});

	if (aborted) throw aborted;
	return out;
}

function errorStatus(e: unknown): number | undefined {
	if (e && typeof e === 'object' && 'statusCode' in e) {
		return Number((e as { statusCode: unknown }).statusCode);
	}
	return undefined;
}

/** "Email is filled in on 72% of profiles and Phone on 60%". */
function perKey(entries: { key: string; rate: number }[], verb: string): string {
	const [first, ...rest] = entries;
	const lead = `${first.key} is ${verb} on ${pct(first.rate)} of profiles`;
	if (rest.length === 0) return lead;
	return `${lead}${rest.length > 1 ? ', ' : ' and '}${andList(rest.map(e => `${e.key} on ${pct(e.rate)}`))}`;
}

/**
 * The Why column on Suggested Changes: two bullets, whole tenant only. The first says how
 * often the added attributes are filled in, the second how well they tell profiles apart.
 */
export function tenantWhyBullets(keys: string[], fills: (AttributeFillRate | undefined)[]): string {
	const itThem = keys.length > 1 ? 'them' : 'it';
	const measured = keys
		.map((key, i) => ({ key, rate: fills[i]?.rate }))
		.filter((e): e is { key: string; rate: number } => e.rate != null);

	let fillBullet: string;
	if (measured.length < keys.length) {
		fillBullet = `We could not measure how often ${andList(keys)} ${keys.length > 1 ? 'are' : 'is'} filled in across the tenant.`;
	} else {
		const lowest = Math.min(...measured.map(e => e.rate));
		const effect = lowest >= 0.7
			? `so most profiles can be compared on ${itThem}.`
			: lowest >= 0.4
				? `so many profiles can be compared on ${itThem}, but profiles without ${itThem} would stop matching on this rule.`
				: keys.length > 1
					? 'so many profiles lack at least one of them and would stop matching on this rule.'
					: 'so most profiles do not have it and would stop matching on this rule.';
		fillBullet = `${perKey(measured, 'filled in')}, ${effect}`;
	}

	const dq = fills.every(f => f?.source === 'dataQuality');
	const unique = keys
		.map((key, i) => ({ key, rate: fills[i]?.sharedProfileRate }))
		.filter((e): e is { key: string; rate: number } => e.rate != null)
		.map(e => ({ key: e.key, rate: 1 - e.rate }));

	let uniqueBullet: string;
	if (!dq) {
		uniqueBullet = 'Uniqueness was not measured because the Data Quality API was not available.';
	} else if (unique.length < keys.length) {
		uniqueBullet = 'Data Quality did not return uniqueness for this attribute.';
	} else {
		const lowest = Math.min(...unique.map(e => e.rate));
		const effect = lowest >= 0.85
			? `so ${keys.length > 1 ? 'together they are' : 'it is'} good at telling different profiles apart.`
			: lowest >= 0.5
				? `so ${itThem === 'it' ? 'it tells' : 'they tell'} many profiles apart, but some profiles share the same value.`
				: `Many profiles share the same value, so ${itThem === 'it' ? 'it' : 'they'} cannot tell every profile apart.`;
		const lead = perKey(unique, 'unique');
		uniqueBullet = lowest >= 0.5 ? `${lead}, ${effect}` : `${lead}. ${effect}`;
	}

	return [fillBullet, uniqueBullet].map(b => `• ${b}`).join('\n');
}
