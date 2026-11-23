/**
 * Session-scoped memory of each tenant's RDM service URI.
 *
 * The service URI is discovered inside the tenant physical configuration, a
 * response that also carries messaging credentials, storage service accounts
 * and internal hostnames — so that response is read once and discarded. This
 * cache exists so a later lookup-value request need not rediscover the one
 * field it needs.
 *
 * In memory only, deliberately: nothing here is written to disk, and after an
 * extension host restart the URI is rediscovered rather than recovered. There
 * is no expiry. Instead an entry is forgotten when a request to it fails (so
 * the retry rediscovers it) and when the environment's session ends (sign-out,
 * an expired session, or removing the environment).
 */
const serviceUriByTenant = new Map<string, string>();

function key(environmentName: string, tenantId: string): string {
	return `${environmentName}::${tenantId}`;
}

export function rememberRdmServiceUri(
	environmentName: string,
	tenantId: string,
	serviceUri: string,
): void {
	if (!serviceUri) return;
	serviceUriByTenant.set(key(environmentName, tenantId), serviceUri);
}

export function recallRdmServiceUri(
	environmentName: string,
	tenantId: string,
): string | undefined {
	return serviceUriByTenant.get(key(environmentName, tenantId));
}

/** After a failed request: the next one looks the address up again. */
export function forgetRdmServiceUri(environmentName: string, tenantId: string): void {
	serviceUriByTenant.delete(key(environmentName, tenantId));
}

/** When an environment's session ends: every tenant of it looks its address up again. */
export function forgetRdmServiceUris(environmentName: string): void {
	const prefix = key(environmentName, '');
	for (const k of [...serviceUriByTenant.keys()]) {
		if (k.startsWith(prefix)) serviceUriByTenant.delete(k);
	}
}

/** Exposed for tests. */
export function clearRdmServiceUriCache(): void {
	serviceUriByTenant.clear();
}
