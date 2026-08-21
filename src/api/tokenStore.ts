/** Max hops when resolving `useTokenFrom` chains (cycle-safe). */
const MAX_ALIAS_DEPTH = 10;

/**
 * Sentinel token held for a git-sourced repository's environment. It stands in for a real Bearer
 * token so the tree and UX state machine treat the environment as authorized without any Reltio
 * call, and is the flag that switches both into git mode. Every writer and reader must use this
 * constant: a repository's configurations all share one environment name, so a single stray
 * clear/compare drops the whole repository back to flat tenant mode.
 */
export const GIT_SOURCE_TOKEN = '__reltio-git-source__';

export interface OAuthSession {
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
}

/**
 * In-memory Bearer tokens per Reltio environment host (never persisted).
 * Supports aliases: environment A can use the token stored for environment B.
 * Sessions (browser OAuth) additionally hold a refresh token and expiry.
 */
export class TokenStore {
	private readonly tokens = new Map<string, string>();
	private readonly aliases = new Map<string, string>();
	private readonly sessionData = new Map<string, { refreshToken: string; expiresAt: number }>();
	private readonly refreshInFlight = new Map<string, Promise<boolean>>();

	setToken(environmentName: string, token: string): void {
		this.aliases.delete(environmentName);
		this.tokens.set(environmentName, token);
	}

	/** Store a full OAuth session: access token (in-memory) + refresh token + expiry. */
	setSession(environmentName: string, session: OAuthSession): void {
		this.aliases.delete(environmentName);
		this.tokens.set(environmentName, session.accessToken);
		this.sessionData.set(environmentName, {
			refreshToken: session.refreshToken,
			expiresAt: session.expiresAt,
		});
	}

	getRefreshToken(environmentName: string): string | undefined {
		return this.sessionData.get(environmentName)?.refreshToken;
	}

	/** Clear access token, refresh token, and any alias for this environment. */
	clearSession(environmentName: string): void {
		this.tokens.delete(environmentName);
		this.aliases.delete(environmentName);
		this.sessionData.delete(environmentName);
	}

	/** Store a shared promise for an in-flight refresh so concurrent 401s share one request. */
	setRefreshInFlight(environmentName: string, promise: Promise<boolean>): void {
		this.refreshInFlight.set(environmentName, promise);
	}

	getRefreshInFlight(environmentName: string): Promise<boolean> | undefined {
		return this.refreshInFlight.get(environmentName);
	}

	clearRefreshInFlight(environmentName: string): void {
		this.refreshInFlight.delete(environmentName);
	}

	/**
	 * Environment `environmentName` will resolve tokens via `sourceEnvironmentName`
	 * (no duplicate secret stored for the borrower).
	 */
	useTokenFrom(environmentName: string, sourceEnvironmentName: string): void {
		this.tokens.delete(environmentName);
		this.aliases.set(environmentName, sourceEnvironmentName);
	}

	clearToken(environmentName: string): void {
		this.tokens.delete(environmentName);
		this.aliases.delete(environmentName);
		this.sessionData.delete(environmentName);
	}

	hasToken(environmentName: string): boolean {
		return this.getToken(environmentName) !== undefined;
	}

	getToken(environmentName: string): string | undefined {
		const visited = new Set<string>();
		let current: string | undefined = environmentName;
		for (let depth = 0; depth < MAX_ALIAS_DEPTH && current; depth++) {
			if (visited.has(current)) return undefined;
			visited.add(current);
			const direct = this.tokens.get(current);
			if (direct !== undefined) return direct;
			current = this.aliases.get(current);
		}
		return undefined;
	}

	clearAll(): void {
		this.tokens.clear();
		this.aliases.clear();
		this.sessionData.clear();
		this.refreshInFlight.clear();
	}
}
