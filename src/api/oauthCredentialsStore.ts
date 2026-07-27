import type * as vscode from 'vscode';

export interface OAuthClientCredentials {
	clientId: string;
	clientSecret: string;
}

function clientIdKey(environmentName: string): string {
	return `reltio.oauth.${environmentName}.clientId`;
}

function clientSecretKey(environmentName: string): string {
	return `reltio.oauth.${environmentName}.clientSecret`;
}

function ssoTenantIdKey(environmentName: string): string {
	return `reltio.oauth.${environmentName}.ssoTenantId`;
}

/**
 * Per-environment OAuth client ID and secret in VS Code SecretStorage (never in settings.json).
 * The SSO routing tenant ID is stored separately because it is per-environment and not shared
 * across environments the way a single client pair can be.
 */
export class OAuthCredentialsStore {
	constructor(private readonly secrets: vscode.SecretStorage) {}

	async saveClientCredentials(
		environmentName: string,
		credentials: OAuthClientCredentials,
	): Promise<void> {
		await this.secrets.store(clientIdKey(environmentName), credentials.clientId);
		await this.secrets.store(clientSecretKey(environmentName), credentials.clientSecret);
	}

	async loadClientCredentials(environmentName: string): Promise<OAuthClientCredentials | undefined> {
		const clientId = await this.secrets.get(clientIdKey(environmentName));
		const clientSecret = await this.secrets.get(clientSecretKey(environmentName));
		if (!clientId || !clientSecret) {
			return undefined;
		}
		return { clientId, clientSecret };
	}

	async hasClientCredentials(environmentName: string): Promise<boolean> {
		return (await this.loadClientCredentials(environmentName)) !== undefined;
	}

	async saveSsoTenantId(environmentName: string, ssoTenantId: string): Promise<void> {
		await this.secrets.store(ssoTenantIdKey(environmentName), ssoTenantId);
	}

	async loadSsoTenantId(environmentName: string): Promise<string | undefined> {
		return this.secrets.get(ssoTenantIdKey(environmentName));
	}

	async deleteClientCredentials(environmentName: string): Promise<void> {
		await this.secrets.delete(clientIdKey(environmentName));
		await this.secrets.delete(clientSecretKey(environmentName));
		await this.secrets.delete(ssoTenantIdKey(environmentName));
	}
}
