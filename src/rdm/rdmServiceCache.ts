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
 * is no expiry either — a tenant's RDM host is stable, and a wrong entry
 * surfaces as a failed request the user can retry rather than as silently
 * wrong data.
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

/** Exposed for tests; the extension never needs to clear a live cache. */
export function clearRdmServiceUriCache(): void {
	serviceUriByTenant.clear();
}
