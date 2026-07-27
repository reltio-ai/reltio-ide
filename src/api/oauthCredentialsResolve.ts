import type { OAuthClientCredentials, OAuthCredentialsStore } from './oauthCredentialsStore';

function credentialsFingerprint(credentials: OAuthClientCredentials): string {
	return `${credentials.clientId}\0${credentials.clientSecret}`;
}

export async function listEnvironmentsWithStoredCredentials(
	store: OAuthCredentialsStore,
	environmentNames: string[],
): Promise<Array<{ environmentName: string; credentials: OAuthClientCredentials }>> {
	const entries: Array<{ environmentName: string; credentials: OAuthClientCredentials }> = [];
	for (const environmentName of environmentNames) {
		const credentials = await store.loadClientCredentials(environmentName);
		if (credentials) {
			entries.push({ environmentName, credentials });
		}
	}
	return entries;
}

export function uniqueCredentialPairs(
	entries: Array<{ credentials: OAuthClientCredentials }>,
): OAuthClientCredentials[] {
	const seen = new Set<string>();
	const unique: OAuthClientCredentials[] = [];
	for (const { credentials } of entries) {
		const key = credentialsFingerprint(credentials);
		if (!seen.has(key)) {
			seen.add(key);
			unique.push(credentials);
		}
	}
	return unique;
}

/**
 * Resolves OAuth client credentials for browser login / refresh.
 * - Environment's own stored pair wins.
 * - If exactly one distinct pair exists across all environments, reuse it.
 * - Otherwise (none, or multiple distinct pairs) and no own pair → undefined.
 */
export async function resolveOAuthCredentials(
	store: OAuthCredentialsStore,
	environmentName: string,
	environmentNames: string[],
): Promise<OAuthClientCredentials | undefined> {
	const own = await store.loadClientCredentials(environmentName);
	if (own) {
		return own;
	}

	const entries = await listEnvironmentsWithStoredCredentials(store, environmentNames);
	const unique = uniqueCredentialPairs(entries);
	if (unique.length === 1) {
		return unique[0];
	}
	return undefined;
}

export async function canLoginWithBrowser(
	store: OAuthCredentialsStore,
	environmentName: string,
	environmentNames: string[],
): Promise<boolean> {
	return (await resolveOAuthCredentials(store, environmentName, environmentNames)) !== undefined;
}

/** One SecretStorage pass for all environments — used for tree menu eligibility. */
export async function computeBrowserLoginEligibility(
	store: OAuthCredentialsStore,
	environmentNames: string[],
): Promise<Map<string, boolean>> {
	const result = new Map<string, boolean>();
	if (environmentNames.length === 0) {
		return result;
	}
	const entries = await listEnvironmentsWithStoredCredentials(store, environmentNames);
	const unique = uniqueCredentialPairs(entries);
	const ownByEnv = new Map(entries.map(e => [e.environmentName, e.credentials]));
	for (const name of environmentNames) {
		if (ownByEnv.has(name)) {
			result.set(name, true);
		} else if (unique.length === 1) {
			result.set(name, true);
		} else {
			result.set(name, false);
		}
	}
	return result;
}
