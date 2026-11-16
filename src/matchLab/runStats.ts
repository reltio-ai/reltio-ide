import type { MatchLabApi } from './types';

export interface MatchLabRunStats {
	/** Every HTTP call this run made through the Match Lab API surface. */
	apiCalls: number;
	/** Profiles fetched as sampling seeds, summed across rules. */
	seedProfiles: number;
	/** `_matches` lookups issued, one per seed profile. */
	matchLookups: number;
}

export function newRunStats(): MatchLabRunStats {
	return { apiCalls: 0, seedProfiles: 0, matchLookups: 0 };
}

/**
 * Counts what the run actually cost so Summary can report it. Wrapping the API rather than
 * threading a counter through every helper keeps the count honest even when a call fails.
 */
export function countingApi(api: MatchLabApi, stats: MatchLabRunStats): MatchLabApi {
	const wrapped: MatchLabApi = {
		getTenantMatchingStatus: (...args) => {
			stats.apiCalls++;
			return api.getTenantMatchingStatus(...args);
		},
		countEntities: (...args) => {
			stats.apiCalls++;
			return api.countEntities(...args);
		},
		searchEntities: async (...args) => {
			stats.apiCalls++;
			const seeds = await api.searchEntities(...args);
			stats.seedProfiles += seeds.length;
			return seeds;
		},
		getEntityMatches: (...args) => {
			stats.apiCalls++;
			stats.matchLookups++;
			return api.getEntityMatches(...args);
		},
		getEntitiesByUris: (...args) => {
			stats.apiCalls++;
			return api.getEntitiesByUris(...args);
		},
	};
	// Optional members have to be re-attached by hand: the wrapper is a fresh object, so
	// anything not listed here would silently disappear from the API the run sees.
	if (api.getDataQualityStatistic) {
		wrapped.getDataQualityStatistic = (...args) => {
			stats.apiCalls++;
			return api.getDataQualityStatistic!(...args);
		};
	}
	return wrapped;
}

/** Counts read better with separators once a tenant is real: 390910 -> 390,910. */
export function formatCount(value: number | null | undefined): string {
	if (value == null || !Number.isFinite(value)) return '';
	return value.toLocaleString('en-US');
}

/** 0.72 -> "72%". */
export function pct(rate: number): string {
	return `${Math.round(rate * 100)}%`;
}

export function pctOrUnmeasured(rate: number | null): string {
	if (rate == null || !Number.isFinite(rate)) return 'not measured';
	return pct(rate);
}

/** "Email", "Email and Phone", "Email, Phone and Name". */
export function andList(items: string[]): string {
	if (items.length <= 1) return items[0] ?? '';
	return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
