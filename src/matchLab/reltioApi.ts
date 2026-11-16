/**
 * Read-only Reltio calls used by Match Lab. Host checks, timeouts and the error type
 * come from the shared client; the search and count variants here also fall back to
 * GET on HTTP 400 and keep the server's explanation in the error message.
 */
import { fetchWithTimeout, ReltioApiError, toHttpsBase } from '../api/reltioClient';
import type { EntitySearchOptions } from '../api/reltioClient';
import { parseTenantMatchingStatus } from './statusParse';

export { ReltioApiError, toHttpsBase };

const DEFAULT_TIMEOUT_MS = 10_000;
const RELTIO_CLIENT_HEADER = 'xxx-client';

function reltioHeaders(token?: string, extra?: Record<string, string>): Record<string, string> {
	const headers: Record<string, string> = { [RELTIO_CLIENT_HEADER]: 'true', ...extra };
	if (token) {
		const raw = token.trim().replace(/^Bearer\s+/i, '').trim();
		headers.Authorization = `Bearer ${raw}`;
	}
	return headers;
}

export async function searchEntities(
	baseUrl: string,
	tenantId: string,
	token: string,
	options: EntitySearchOptions,
): Promise<unknown[]> {
	const root = toHttpsBase(baseUrl);
	const url = `${root}/reltio/api/${encodeURIComponent(tenantId)}/entities/_search`;
	const body: Record<string, unknown> = {
		filter: options.filter,
		max: options.max,
		offset: options.offset,
		scoreEnabled: false,
		activeness: options.activeness ?? 'all',
	};
	if (options.options) body.options = options.options;
	if (options.sort) body.sort = options.sort;
	if (options.order) body.order = options.order;

	let res = await fetchWithTimeout(
		url,
		{
			method: 'POST',
			headers: reltioHeaders(token, { 'Content-Type': 'application/json' }),
			body: JSON.stringify(body),
		},
		DEFAULT_TIMEOUT_MS,
	);
	if (res.status === 401) {
		throw new ReltioApiError('Unauthorized (401)', 401);
	}
	if (res.status === 400 || res.status === 404 || res.status === 405) {
		const postText = await safeResponseText(res);
		const params = new URLSearchParams({
			filter: options.filter,
			max: String(options.max),
			offset: String(options.offset),
			activeness: options.activeness ?? 'all',
			scoreEnabled: 'false',
		});
		res = await fetchWithTimeout(
			`${root}/reltio/api/${encodeURIComponent(tenantId)}/entities?${params.toString()}`,
			{ method: 'GET', headers: reltioHeaders(token) },
			DEFAULT_TIMEOUT_MS,
		);
		if (res.status === 401) {
			throw new ReltioApiError('Unauthorized (401)', 401);
		}
		if (!res.ok) {
			throw new ReltioApiError(
				`Search entities failed: HTTP ${res.status}${snippet(await safeResponseText(res) || postText)}`,
				res.status,
			);
		}
	} else if (!res.ok) {
		throw new ReltioApiError(
			`Search entities failed: HTTP ${res.status}${snippet(await safeResponseText(res))}`,
			res.status,
		);
	}
	const data = (await res.json()) as unknown;
	if (!Array.isArray(data)) {
		throw new ReltioApiError('Search entities: expected JSON array', res.status);
	}
	return data;
}

export async function countEntities(
	baseUrl: string,
	tenantId: string,
	token: string,
	filter: string,
): Promise<number> {
	const root = toHttpsBase(baseUrl);
	const wrapped = filter.trim().startsWith('(') ? filter.trim() : `(${filter.trim()})`;
	const body = JSON.stringify({ filter: wrapped, activeness: 'all' });
	const postUrl = `${root}/reltio/api/${encodeURIComponent(tenantId)}/entities/_total`;
	const getUrl = `${postUrl}?${new URLSearchParams({ filter: wrapped, activeness: 'all' }).toString()}`;
	let res = await fetchWithTimeout(
		postUrl,
		{
			method: 'POST',
			headers: reltioHeaders(token, { 'Content-Type': 'application/json' }),
			body,
		},
		DEFAULT_TIMEOUT_MS,
	);
	if (res.status === 401) {
		throw new ReltioApiError('Unauthorized (401)', 401);
	}
	if (res.status === 404 || res.status === 405 || res.status === 400) {
		const postText = await safeResponseText(res);
		res = await fetchWithTimeout(
			getUrl,
			{
				method: 'GET',
				headers: reltioHeaders(token),
			},
			DEFAULT_TIMEOUT_MS,
		);
		if (res.status === 401) {
			throw new ReltioApiError('Unauthorized (401)', 401);
		}
		if (!res.ok) {
			const getText = await safeResponseText(res);
			throw new ReltioApiError(
				`Count entities failed: HTTP ${res.status}${snippet(getText || postText)}`,
				res.status,
			);
		}
	} else if (!res.ok) {
		throw new ReltioApiError(
			`Count entities failed: HTTP ${res.status}${snippet(await safeResponseText(res))}`,
			res.status,
		);
	}
	const text = await res.text();
	const trimmed = text.trim();
	if (/^\d+$/.test(trimmed)) return Number(trimmed);
	const data = JSON.parse(trimmed) as unknown;
	if (typeof data === 'number') return data;
	if (data && typeof data === 'object') {
		const total = (data as Record<string, unknown>).total;
		if (typeof total === 'number') return total;
		if (typeof total === 'string' && /^\d+$/.test(total)) return Number(total);
	}
	throw new ReltioApiError('Count entities: unexpected response shape', res.status);
}

async function safeResponseText(res: Response): Promise<string> {
	try {
		return await res.text();
	} catch {
		return '';
	}
}

function snippet(text: string): string {
	const t = text.trim().replace(/\s+/g, ' ');
	if (!t) return '';
	return `: ${t.length > 400 ? `${t.slice(0, 400)}…` : t}`;
}

/** `_matches?deep=1` is slow — well above the default 10s. */
export const MATCHES_TIMEOUT_MS = 90_000;
const BY_URIS_TIMEOUT_MS = 45_000;
const STATUS_TIMEOUT_MS = 15_000;
const MATCHES_PAGE_SIZE = 50;
const MATCHES_MAX_PAGES = 20;

function stripEntitiesPrefix(entityId: string): string {
	const trimmed = entityId.trim();
	const m = /(?:^|\/)entities\/([^/?#]+)/i.exec(trimmed);
	if (m) return m[1];
	return trimmed.replace(/^entities\//i, '');
}

export interface TenantMatchingStatusResult {
	status: string | undefined;
	matchingQueueSize: number | undefined;
	eventsQueueSize: number | undefined;
	body: unknown;
	text: string;
}

/**
 * GET {host}/reltio/status/tenant/{tenantId}
 * Matching pipeline queue — not Console "Pending Jobs".
 * Queue sizes that are missing, non-numeric, or negative are unreadable (`undefined`).
 */
export async function getTenantMatchingStatus(
	baseUrl: string,
	tenantId: string,
	token: string,
): Promise<TenantMatchingStatusResult> {
	const root = toHttpsBase(baseUrl);
	const url = `${root}/reltio/status/tenant/${encodeURIComponent(tenantId)}`;
	const res = await fetchWithTimeout(
		url,
		{
			method: 'GET',
			headers: reltioHeaders(token, { Accept: 'application/json' }),
		},
		STATUS_TIMEOUT_MS,
	);
	if (res.status === 401) {
		throw new ReltioApiError('Unauthorized (401)', 401);
	}
	if (!res.ok) {
		throw new ReltioApiError(
			`Tenant matching status failed: HTTP ${res.status}`,
			res.status,
		);
	}
	const text = await res.text();
	const trimmed = text.trim();
	let body: unknown;
	if (trimmed) {
		try {
			body = JSON.parse(trimmed) as unknown;
		} catch {
			body = undefined;
		}
	}
	const parsed = parseTenantMatchingStatus(body, text);
	return {
		status: parsed.status,
		matchingQueueSize: parsed.matchingQueueSize,
		eventsQueueSize: parsed.eventsQueueSize,
		body,
		text,
	};
}

function itemsFromMatchesPayload(raw: unknown): unknown[] {
	if (Array.isArray(raw)) return raw;
	if (raw && typeof raw === 'object') {
		const rec = raw as Record<string, unknown>;
		if (Array.isArray(rec.matches)) return rec.matches;
		if (Array.isArray(rec.objects)) return rec.objects;
	}
	return [];
}

function nextMatchesOffset(
	raw: unknown,
	offset: number,
	pageSize: number,
	itemCount: number,
): number | undefined {
	if (itemCount <= 0) return undefined;
	if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
		const totalRaw = (raw as Record<string, unknown>).total;
		const total =
			typeof totalRaw === 'number'
				? totalRaw
				: typeof totalRaw === 'string' && /^\d+$/.test(totalRaw)
					? Number(totalRaw)
					: undefined;
		if (total != null && Number.isFinite(total)) {
			if (offset + itemCount < total) return offset + itemCount;
			return undefined;
		}
	}
	if (itemCount >= pageSize) return offset + itemCount;
	return undefined;
}

/**
 * GET {host}/reltio/api/{tenantId}/entities/{entityId}/_matches?deep=1
 * Use GET (not POST …/entities/_matches) so INTERNAL-scope rules are included.
 * Timeout is well above the default 10s — `_matches?deep=1` is slow.
 * Follows further pages when the payload is paged (`max`/`offset` or `total`).
 */
export async function getEntityMatches(
	baseUrl: string,
	tenantId: string,
	token: string,
	entityId: string,
	options?: { offset?: number; max?: number; timeoutMs?: number },
): Promise<unknown> {
	const root = toHttpsBase(baseUrl);
	const id = stripEntitiesPrefix(entityId);
	const pageSize = options?.max ?? MATCHES_PAGE_SIZE;
	const timeoutMs = options?.timeoutMs ?? MATCHES_TIMEOUT_MS;
	let offset = options?.offset ?? 0;
	const collected: unknown[] = [];
	let firstRaw: unknown;
	let paged = false;

	for (let page = 0; page < MATCHES_MAX_PAGES; page++) {
		const q = new URLSearchParams({
			deep: '1',
			max: String(pageSize),
			offset: String(offset),
		});
		const url = `${root}/reltio/api/${encodeURIComponent(tenantId)}/entities/${encodeURIComponent(id)}/_matches?${q.toString()}`;
		const res = await fetchWithTimeout(
			url,
			{
				method: 'GET',
				headers: reltioHeaders(token),
			},
			timeoutMs,
		);
		if (res.status === 401) {
			throw new ReltioApiError('Unauthorized (401)', 401);
		}
		if (!res.ok) {
			throw new ReltioApiError(`Get entity matches failed: HTTP ${res.status}`, res.status);
		}
		const raw = (await res.json()) as unknown;
		if (page === 0) firstRaw = raw;
		const items = itemsFromMatchesPayload(raw);
		if (page === 0 && items.length === 0) {
			return raw;
		}
		collected.push(...items);
		const next = nextMatchesOffset(raw, offset, pageSize, items.length);
		if (next === undefined) break;
		paged = true;
		offset = next;
	}

	if (!paged && firstRaw !== undefined && !Array.isArray(firstRaw)) {
		return firstRaw;
	}
	return collected;
}

/**
 * POST {host}/reltio/api/{tenantId}/entities/_byUris
 */
export async function getEntitiesByUris(
	baseUrl: string,
	tenantId: string,
	token: string,
	uris: string[],
	options?: { timeoutMs?: number },
): Promise<unknown[]> {
	if (uris.length === 0) return [];
	const root = toHttpsBase(baseUrl);
	const url = `${root}/reltio/api/${encodeURIComponent(tenantId)}/entities/_byUris`;
	const chunkSize = 40;
	const out: unknown[] = [];
	for (let i = 0; i < uris.length; i += chunkSize) {
		const chunk = uris.slice(i, i + chunkSize);
		const res = await fetchWithTimeout(
			url,
			{
				method: 'POST',
				headers: reltioHeaders(token, { 'Content-Type': 'application/json' }),
				body: JSON.stringify({ uris: chunk }),
			},
			options?.timeoutMs ?? BY_URIS_TIMEOUT_MS,
		);
		if (res.status === 401) {
			throw new ReltioApiError('Unauthorized (401)', 401);
		}
		if (!res.ok) {
			throw new ReltioApiError(`Get entities by URIs failed: HTTP ${res.status}`, res.status);
		}
		const data = (await res.json()) as unknown;
		if (Array.isArray(data)) {
			out.push(...data);
			continue;
		}
		if (data && typeof data === 'object' && Array.isArray((data as { entities?: unknown }).entities)) {
			out.push(...((data as { entities: unknown[] }).entities));
			continue;
		}
		throw new ReltioApiError('Get entities by URIs: expected JSON array', res.status);
	}
	return out;
}

const DATA_QUALITY_TIMEOUT_MS = 60_000;

/**
 * GET …/dataQuality/statistic — the Console Data Quality figures for one attribute:
 * `fillRate{exists,missing}`, `uniqueness{unique,notUnique}` (distinct-value counts,
 * not profiles) and `frequency` (top values). Read-only.
 */
export async function getDataQualityStatistic(
	baseUrl: string,
	tenantId: string,
	token: string,
	entityType: string,
	attributePath: string,
): Promise<unknown> {
	const root = toHttpsBase(baseUrl);
	const q = new URLSearchParams({
		entityType: entityType.split('/').pop() ?? entityType,
		attribute: attributePath.startsWith('attributes.') ? attributePath : `attributes.${attributePath}`,
	});
	const url = `${root}/reltio/api/${encodeURIComponent(tenantId)}/dataQuality/statistic?${q.toString()}`;
	const res = await fetchWithTimeout(
		url,
		{ method: 'GET', headers: reltioHeaders(token, { Accept: 'application/json' }) },
		DATA_QUALITY_TIMEOUT_MS,
	);
	if (res.status === 401) {
		throw new ReltioApiError('Unauthorized (401)', 401);
	}
	if (!res.ok) {
		throw new ReltioApiError(`Data quality statistic failed: HTTP ${res.status}`, res.status);
	}
	return (await res.json()) as unknown;
}
