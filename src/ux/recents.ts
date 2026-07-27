import * as vscode from 'vscode';

const RECENT_HOSTS_KEY = 'reltio.recentHosts';
const RECENT_TENANTS_KEY = 'reltio.recentTenants';
const LAST_AUTH_METHOD_KEY = 'reltio.lastAuthMethod';
const OPENED_L3_KEY = 'reltio.openedL3Files';
const RECENT_HOSTS_CAP = 10;
const RECENT_TENANTS_PER_HOST_CAP = 10;

export function loadRecentHosts(global: vscode.Memento): string[] {
	return global.get<string[]>(RECENT_HOSTS_KEY, []);
}

export async function pushRecentHost(global: vscode.Memento, host: string): Promise<void> {
	const list = loadRecentHosts(global).filter(h => h !== host);
	list.unshift(host);
	while (list.length > RECENT_HOSTS_CAP) list.pop();
	await global.update(RECENT_HOSTS_KEY, list);
}

export function loadRecentTenants(global: vscode.Memento, host: string): string[] {
	const map = global.get<Record<string, string[]>>(RECENT_TENANTS_KEY, {});
	return map[host] ?? [];
}

export async function pushRecentTenant(global: vscode.Memento, host: string, tenantId: string): Promise<void> {
	const map = { ...global.get<Record<string, string[]>>(RECENT_TENANTS_KEY, {}) };
	const list = (map[host] ?? []).filter(t => t !== tenantId);
	list.unshift(tenantId);
	while (list.length > RECENT_TENANTS_PER_HOST_CAP) list.pop();
	map[host] = list;
	await global.update(RECENT_TENANTS_KEY, map);
}

export type AuthMethod = 'browser' | 'token';

export function loadLastAuthMethod(workspace: vscode.Memento): AuthMethod | undefined {
	const v = workspace.get<string>(LAST_AUTH_METHOD_KEY);
	return v === 'browser' || v === 'token' ? v : undefined;
}

export async function saveLastAuthMethod(workspace: vscode.Memento, method: AuthMethod): Promise<void> {
	await workspace.update(LAST_AUTH_METHOD_KEY, method);
}

export function loadOpenedL3Files(workspace: vscode.Memento): Set<string> {
	return new Set(workspace.get<string[]>(OPENED_L3_KEY, []));
}

export async function saveOpenedL3Files(workspace: vscode.Memento, set: Set<string>): Promise<void> {
	await workspace.update(OPENED_L3_KEY, Array.from(set));
}

/**
 * Known Reltio production hosts loaded from `resources/production_env_urls.csv`.
 * Cached after first load; safe to call repeatedly.
 */
let cachedProductionHosts: string[] | undefined;

export async function loadProductionHosts(context: vscode.ExtensionContext): Promise<string[]> {
	if (cachedProductionHosts) return cachedProductionHosts;
	const uri = vscode.Uri.joinPath(context.extensionUri, 'resources', 'production_env_urls.csv');
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		const text = new TextDecoder('utf-8').decode(bytes);
		cachedProductionHosts = text
			.split(/\r?\n/)
			.map(l => l.trim())
			.filter(Boolean);
	} catch {
		cachedProductionHosts = [];
	}
	return cachedProductionHosts;
}
