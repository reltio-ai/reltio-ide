const DEFAULT_TIMEOUT_MS = 10_000;
/** Required by Reltio API for client-identified requests (e.g. tenant list). */
const RELTIO_CLIENT_HEADER = 'xxx-client';

function reltioHeaders(token?: string, extra?: Record<string, string>): Record<string, string> {
	const headers: Record<string, string> = { [RELTIO_CLIENT_HEADER]: 'true', ...extra };
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}
	return headers;
}

export class ReltioApiError extends Error {
	constructor(
		message: string,
		readonly statusCode: number,
	) {
		super(message);
		this.name = 'ReltioApiError';
	}
}

function toHttpsBase(baseUrl: string): string {
	const trimmed = baseUrl.trim().replace(/^\/+/, '');
	if (/^https?:\/\//i.test(trimmed)) {
		return trimmed.replace(/\/+$/, '');
	}
	return `https://${trimmed.replace(/\/+$/, '')}`;
}

async function fetchWithTimeout(
	url: string,
	init: RequestInit,
	timeoutMs: number,
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} catch (e) {
		if ((e as Error).name === 'AbortError') {
			throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
		}
		throw new Error(`Network error: ${(e as Error).message}`);
	} finally {
		clearTimeout(timer);
	}
}

export async function validateEnvironment(baseUrl: string): Promise<boolean> {
	const root = toHttpsBase(baseUrl);
	const url = `${root}/reltio/status`;
	try {
		const res = await fetchWithTimeout(
			url,
			{ method: 'GET', headers: reltioHeaders() },
			DEFAULT_TIMEOUT_MS,
		);
		return res.status === 200;
	} catch {
		return false;
	}
}

export async function listTenants(baseUrl: string, token: string): Promise<string[]> {
	const root = toHttpsBase(baseUrl);
	const url = `${root}/reltio/tenants`;
	const res = await fetchWithTimeout(
		url,
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
		throw new ReltioApiError(`List tenants failed: HTTP ${res.status}`, res.status);
	}
	const data = (await res.json()) as unknown;
	if (!Array.isArray(data) || !data.every(x => typeof x === 'string')) {
		throw new ReltioApiError('List tenants: unexpected response shape', res.status);
	}
	return data as string[];
}

/** One row from `GET …/configuration/_history`. */
export interface ConfigurationHistoryEntry {
	updatedBy: string;
	timestamp: string;
	configuration: unknown;
}

export async function fetchConfigurationHistory(
	baseUrl: string,
	tenantId: string,
	token: string,
	offset: number,
	max: number,
): Promise<ConfigurationHistoryEntry[]> {
	const root = toHttpsBase(baseUrl);
	const q = new URLSearchParams({ offset: String(offset), max: String(max) });
	const url = `${root}/reltio/api/${encodeURIComponent(tenantId)}/configuration/_history?${q.toString()}`;
	const res = await fetchWithTimeout(
		url,
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
		throw new ReltioApiError(`Fetch configuration history failed: HTTP ${res.status}`, res.status);
	}
	const data = (await res.json()) as unknown;
	if (!Array.isArray(data)) {
		throw new ReltioApiError('Configuration history: expected JSON array', res.status);
	}
	const out: ConfigurationHistoryEntry[] = [];
	for (const row of data) {
		if (!row || typeof row !== 'object') {
			throw new ReltioApiError('Configuration history: invalid row shape', res.status);
		}
		const o = row as Record<string, unknown>;
		if (typeof o.updatedBy !== 'string') {
			throw new ReltioApiError('Configuration history: row missing updatedBy', res.status);
		}
		const ts = o.timestamp;
		if (typeof ts !== 'string' && typeof ts !== 'number') {
			throw new ReltioApiError('Configuration history: row missing timestamp', res.status);
		}
		if (!('configuration' in o)) {
			throw new ReltioApiError('Configuration history: row missing configuration', res.status);
		}
		out.push({
			updatedBy: o.updatedBy,
			timestamp: String(ts),
			configuration: o.configuration,
		});
	}
	return out;
}

export async function fetchL3Configuration(
	baseUrl: string,
	tenantId: string,
	token: string,
): Promise<string> {
	const root = toHttpsBase(baseUrl);
	const url = `${root}/reltio/api/${encodeURIComponent(tenantId)}/configuration`;
	const res = await fetchWithTimeout(
		url,
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
		throw new ReltioApiError(`Fetch L3 failed: HTTP ${res.status}`, res.status);
	}
	return res.text();
}

export interface EntitySearchOptions {
	filter: string;
	max: number;
	offset: number;
	activeness?: 'active' | 'inactive' | 'all';
	options?: string;
	sort?: string;
	order?: 'asc' | 'desc';
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

	const res = await fetchWithTimeout(
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
	if (!res.ok) {
		throw new ReltioApiError(`Search entities failed: HTTP ${res.status}`, res.status);
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
	const body = JSON.stringify({ filter, activeness: 'all' });
	const postUrl = `${root}/reltio/api/${encodeURIComponent(tenantId)}/entities/_total`;
	const getUrl = `${postUrl}?${new URLSearchParams({ filter, activeness: 'all' }).toString()}`;
	let res = await fetchWithTimeout(
		postUrl,
		{
			method: 'POST',
			headers: reltioHeaders(token, { 'Content-Type': 'application/json' }),
			body,
		},
		DEFAULT_TIMEOUT_MS,
	);
	if (res.status === 404 || res.status === 405) {
		res = await fetchWithTimeout(
			getUrl,
			{
				method: 'GET',
				headers: reltioHeaders(token),
			},
			DEFAULT_TIMEOUT_MS,
		);
	}
	if (res.status === 401) {
		throw new ReltioApiError('Unauthorized (401)', 401);
	}
	if (!res.ok) {
		throw new ReltioApiError(`Count entities failed: HTTP ${res.status}`, res.status);
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

/** Response body shape from Reltio when PUT /configuration fails validation (e.g. HTTP 400 + XSD check). */
export interface ReltioConfigurationApiErrorJson {
	severity?: string;
	errorMessage?: string;
	errorCode?: number;
	errorDetailMessage?: string;
}

function tryParseReltioConfigurationError(
	bodyText: string,
): ReltioConfigurationApiErrorJson | undefined {
	const t = bodyText.trim();
	if (!t.startsWith('{')) {
		return undefined;
	}
	try {
		const o = JSON.parse(t) as unknown;
		if (!o || typeof o !== 'object') {
			return undefined;
		}
		const r = o as Record<string, unknown>;
		if (!('errorMessage' in r) && !('errorCode' in r) && !('errorDetailMessage' in r)) {
			return undefined;
		}
		return {
			severity: typeof r.severity === 'string' ? r.severity : undefined,
			errorMessage: typeof r.errorMessage === 'string' ? r.errorMessage : undefined,
			errorCode: typeof r.errorCode === 'number' ? r.errorCode : undefined,
			errorDetailMessage: typeof r.errorDetailMessage === 'string' ? r.errorDetailMessage : undefined,
		};
	} catch {
		return undefined;
	}
}

function formatPutConfigurationFailureMessage(httpStatus: number, bodyText: string): string {
	const reltio = tryParseReltioConfigurationError(bodyText);
	if (reltio) {
		const intro = `Reltio did not apply this configuration (HTTP ${httpStatus}${
			reltio.errorCode != null ? `, error code ${reltio.errorCode}` : ''
		}). Fix the issues below in your L3 JSON, then try again.`;

		const chunks: string[] = [intro];
		if (reltio.severity) {
			chunks.push(`Severity: ${reltio.severity}`);
		}
		if (reltio.errorMessage) {
			chunks.push(reltio.errorMessage);
		}
		if (reltio.errorDetailMessage && reltio.errorDetailMessage !== reltio.errorMessage) {
			chunks.push(reltio.errorDetailMessage);
		}
		if (!reltio.errorMessage && !reltio.errorDetailMessage && reltio.errorCode != null) {
			chunks.push(`See Reltio documentation for error code ${reltio.errorCode}.`);
		}
		return chunks.join('\n\n');
	}

	const trimmed = bodyText.trim();
	if (!trimmed) {
		return `Put configuration failed (HTTP ${httpStatus}).`;
	}
	return trimmed.length > 12000 ? `${trimmed.slice(0, 12000)}…` : trimmed;
}

export async function putL3Configuration(
	baseUrl: string,
	tenantId: string,
	token: string,
	body: string,
): Promise<void> {
	const root = toHttpsBase(baseUrl);
	const url = `${root}/reltio/api/${encodeURIComponent(tenantId)}/configuration`;
	const res = await fetchWithTimeout(
		url,
		{
			method: 'PUT',
			headers: reltioHeaders(token, { 'Content-Type': 'application/json' }),
			body,
		},
		DEFAULT_TIMEOUT_MS,
	);
	if (res.status === 401) {
		throw new ReltioApiError('Unauthorized (401)', 401);
	}
	if (!res.ok) {
		let fullText = '';
		try {
			fullText = await res.text();
		} catch {
			/* ignore */
		}
		const message = formatPutConfigurationFailureMessage(res.status, fullText);
		throw new ReltioApiError(message, res.status);
	}
}
