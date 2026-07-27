import type * as vscode from 'vscode';

const KEY_PREFIX = 'reltio.refreshToken.';
const ENV_LIST_KEY = 'reltio.oauthEnvironments';

/**
 * Persists OAuth refresh tokens in VS Code SecretStorage (OS keychain).
 * Access tokens are never written to disk — only refresh tokens are persisted.
 */
export class SessionStore {
	constructor(
		private readonly secrets: vscode.SecretStorage,
		private readonly state: vscode.Memento,
	) {}

	async saveRefreshToken(environmentName: string, token: string): Promise<void> {
		await this.secrets.store(KEY_PREFIX + environmentName, token);
		const envs = this.state.get<string[]>(ENV_LIST_KEY, []);
		if (!envs.includes(environmentName)) {
			await this.state.update(ENV_LIST_KEY, [...envs, environmentName]);
		}
	}

	async loadRefreshToken(environmentName: string): Promise<string | undefined> {
		return this.secrets.get(KEY_PREFIX + environmentName);
	}

	async deleteRefreshToken(environmentName: string): Promise<void> {
		await this.secrets.delete(KEY_PREFIX + environmentName);
		const envs = this.state.get<string[]>(ENV_LIST_KEY, []);
		await this.state.update(
			ENV_LIST_KEY,
			envs.filter(e => e !== environmentName),
		);
	}

	async listEnvironments(): Promise<string[]> {
		return this.state.get<string[]>(ENV_LIST_KEY, []);
	}
}
