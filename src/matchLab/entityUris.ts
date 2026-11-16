/** Normalize to `entities/{id}` (case-sensitive id). */
export function normalizeEntityUri(raw: string): string {
	const trimmed = raw.trim();
	const m = /(?:^|\/)entities\/([^/?#]+)/i.exec(trimmed);
	if (m) return `entities/${m[1]}`;
	if (trimmed.length > 0 && !trimmed.includes('/')) return `entities/${trimmed}`;
	return trimmed;
}

export function entityIdFromUri(raw: string): string {
	const norm = normalizeEntityUri(raw);
	return norm.replace(/^entities\//i, '');
}

export function canonicalPair(uriA: string, uriB: string): {
	profileA: string;
	profileB: string;
	key: string;
} | undefined {
	const a = normalizeEntityUri(uriA);
	const b = normalizeEntityUri(uriB);
	if (!a || !b || a === b) return undefined;
	if (a < b) return { profileA: a, profileB: b, key: `${a}\t${b}` };
	return { profileA: b, profileB: a, key: `${b}\t${a}` };
}

export function hubProfileUrl(environmentHost: string, tenantId: string, entityUri: string): string {
	const origin = toHttpsOrigin(environmentHost);
	const id = entityIdFromUri(entityUri);
	return `${origin}/nui/${encodeURIComponent(tenantId)}/profile?entityUri=${encodeURIComponent(`entities/${id}`)}`;
}

function toHttpsOrigin(baseUrl: string): string {
	const trimmed = baseUrl.trim().replace(/^\/+/, '');
	if (/^https?:\/\//i.test(trimmed)) {
		return trimmed.replace(/\/+$/, '');
	}
	return `https://${trimmed.replace(/\/+$/, '')}`;
}

export function shortNameFromUri(uri: string): string {
	const parts = uri.split('/').filter(Boolean);
	return parts[parts.length - 1] ?? uri;
}
