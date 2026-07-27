import * as vscode from 'vscode';
import { parseDocument, type ParsedDocument } from '../parser/configParser';
import { EnvironmentManager, type TenantInfo } from '../workspace/environmentManager';
import { TokenStore } from '../api/tokenStore';
import { countEntities } from '../api/reltioClient';
import type { OAuthCredentialsStore } from '../api/oauthCredentialsStore';
import { computeBrowserLoginEligibility } from '../api/oauthCredentialsResolve';
import { EnvironmentNode, TenantNode, HistoryFolderNode, HistorySnapshotNode } from './multiTenantNodes';
import type { EState, TState, UxState } from '../ux/uxState';
import { ConfigTreeItem } from './treeNodes';
import {
	getConfigRootChildren,
	getConfigNodeChildren,
	findConfigEntityTypeItem,
	getConfigTreeItemParent,
} from './configSubtree';
import { pathTenantLocFromL3Path } from '../util/pathTenantLoc';
import { formatHistoryTreeLabel, listLocalHistorySnapshots } from '../workspace/configurationHistory';

export type MultiTenantTreeElement =
	| EnvironmentNode
	| TenantNode
	| HistoryFolderNode
	| HistorySnapshotNode
	| ConfigTreeItem;

export function historyExposedStorageKey(environmentName: string, tenantId: string): string {
	return `reltio.history.exposed::${environmentName}::${tenantId}`;
}

export function tenantLocFromL3File(l3Uri: vscode.Uri): { environmentName: string; tenantId: string } | undefined {
	return pathTenantLocFromL3Path(l3Uri.fsPath);
}

function escapeReltioFilterLiteral(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function typeFilterForUris(typeUris: string[]): string | undefined {
	const filters = typeUris.map(uri => `equals(type,'${escapeReltioFilterLiteral(uri)}')`);
	if (filters.length === 0) return undefined;
	if (filters.length === 1) return filters[0];
	return `or(${filters.join(',')})`;
}

export class MultiTenantTreeProvider implements vscode.TreeDataProvider<MultiTenantTreeElement> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<MultiTenantTreeElement | undefined | null>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private envInfosStale = true;
	private envInfos: Awaited<ReturnType<EnvironmentManager['scanEnvironments']>> = [];
	private browserLoginByEnv = new Map<string, boolean>();
	private eligibilityRefreshPromise: Promise<void> | undefined;
	private treeChangeDebounceTimer: ReturnType<typeof setTimeout> | undefined;
	private uxState: UxState | undefined;

	constructor(
		private readonly environmentManager: EnvironmentManager | null,
		private readonly tokenStore: TokenStore,
		private readonly workspaceState: vscode.Memento,
		private readonly oauthCredentialsStore: OAuthCredentialsStore | null,
	) {}

	/** Recompute which environments may use Login with Browser (shared single pair vs per-env). */
	async refreshBrowserLoginEligibility(): Promise<void> {
		if (!this.environmentManager || !this.oauthCredentialsStore) {
			this.browserLoginByEnv = new Map();
			return;
		}
		const envs = await this.environmentManager.scanEnvironments();
		const names = envs.map(e => e.name);
		this.browserLoginByEnv = await computeBrowserLoginEligibility(
			this.oauthCredentialsStore,
			names,
		);
	}

	/** One in-flight eligibility pass; avoids duplicate SecretStorage reads and tree progress flicker. */
	ensureBrowserLoginEligibilityFresh(): Promise<void> {
		if (!this.oauthCredentialsStore || !this.environmentManager) {
			this.browserLoginByEnv = new Map();
			return Promise.resolve();
		}
		if (!this.eligibilityRefreshPromise) {
			this.eligibilityRefreshPromise = this.refreshBrowserLoginEligibility().finally(() => {
				this.eligibilityRefreshPromise = undefined;
			});
		}
		return this.eligibilityRefreshPromise;
	}

	private environmentNode(name: string, isAuthorized: boolean): EnvironmentNode {
		return new EnvironmentNode(
			name,
			isAuthorized,
			this.browserLoginByEnv.get(name) ?? false,
			this.uxState?.perEnv.get(name) ?? 'E_NO_AUTH',
		);
	}

	/** Call after a successful history fetch so the History folder appears even when the API returned zero rows. */
	markHistoryExposed(environmentName: string, tenantId: string): void {
		void this.workspaceState.update(historyExposedStorageKey(environmentName, tenantId), true);
		this.scheduleTreeRefresh();
	}

	/** L3 / history edits: refresh tree labels only (no SecretStorage, no env rescan). */
	private scheduleTreeRefresh(): void {
		if (this.treeChangeDebounceTimer) {
			clearTimeout(this.treeChangeDebounceTimer);
		}
		this.treeChangeDebounceTimer = setTimeout(() => {
			this.treeChangeDebounceTimer = undefined;
			this._onDidChangeTreeData.fire(undefined);
		}, 150);
	}

	/** Environment list or OAuth client credentials changed — rescan + eligibility. */
	invalidate(): void {
		this.envInfosStale = true;
		void this.ensureBrowserLoginEligibilityFresh().then(() => {
			this.scheduleTreeRefresh();
		});
	}

	refresh(): void {
		this.invalidate();
	}

	/** Token / auth icon changed for one environment — no OAuth eligibility reread. */
	refreshEnvironment(_name: string): void {
		this.scheduleTreeRefresh();
	}

	setUxState(state: UxState): void {
		this.uxState = state;
		this.invalidate();
	}

	addEnvironment(_name: string): void {
		this.invalidate();
	}

	removeEnvironment(_name: string): void {
		this.invalidate();
	}

	addTenant(_env: string, _tenantId: string): void {
		this.invalidate();
	}

	removeTenant(_env: string, _tenantId: string): void {
		this.invalidate();
	}

	onL3DocumentChanged(doc: vscode.TextDocument): void {
		const p = doc.uri.path;
		if (p.endsWith('L3.reltio.json') || (p.includes('/history/') && p.endsWith('.reltio.json'))) {
			this.scheduleTreeRefresh();
		}
	}

	getTreeItem(element: MultiTenantTreeElement): vscode.TreeItem {
		return element;
	}

	resolveTreeItem(
		item: vscode.TreeItem,
		element: MultiTenantTreeElement,
		_token: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.TreeItem> {
		if (element instanceof ConfigTreeItem && element.nodeType === 'entityBrowser') {
			item.command = {
				command: 'reltio.browseEntities',
				title: 'Browse Entities',
				arguments: [element],
			};
			return item;
		}
		if (element instanceof ConfigTreeItem && item.command === undefined) {
			item.command = {
				command: 'reltio.revealInEditor',
				title: 'Show in Editor',
				arguments: [element],
			};
		}
		if (element instanceof HistorySnapshotNode && item.command === undefined) {
			item.command = {
				command: 'vscode.open',
				title: 'Open',
				arguments: [element.fileUri],
			};
		}
		return item;
	}

	getParent(element: MultiTenantTreeElement): vscode.ProviderResult<MultiTenantTreeElement> {
		if (element instanceof EnvironmentNode) return undefined;
		if (element instanceof TenantNode) {
			return this.environmentNode(
				element.environmentName,
				this.tokenStore.hasToken(element.environmentName),
			);
		}
		if (element instanceof HistoryFolderNode) {
			const ti = this.findTenantInfo(element.environmentName, element.tenantId);
			return new TenantNode(
				element.environmentName,
				element.tenantId,
				ti?.hasL3 ?? false,
				(ti?.hasL3 ?? false) && !this.tokenStore.hasToken(element.environmentName),
				this.tokenStore.hasToken(element.environmentName),
				this.uxState?.perTenant.get(`${element.environmentName}/${element.tenantId}`) ?? 'T_NO_L3',
			);
		}
		if (element instanceof HistorySnapshotNode) {
			return this.getParentForHistorySnapshot(element);
		}
		if (element instanceof ConfigTreeItem && element.tenantL3Uri) {
			return this.getParentForConfigItem(element);
		}
		return undefined;
	}

	private async getParentForHistorySnapshot(
		element: HistorySnapshotNode,
	): Promise<HistoryFolderNode | undefined> {
		if (!this.environmentManager) return undefined;
		const dir = this.environmentManager.getHistoryDirectoryUri(element.environmentName, element.tenantId);
		const snaps = await listLocalHistorySnapshots(dir);
		return new HistoryFolderNode(element.environmentName, element.tenantId, snaps.length);
	}

	private async getParentForConfigItem(element: ConfigTreeItem): Promise<MultiTenantTreeElement | undefined> {
		const parsed = await this.loadParsedFromUri(element.tenantL3Uri!);
		if (!parsed) return undefined;
		if (element.nodeType === 'entityBrowser' && element.jsonPath.length === 2 && element.jsonPath[0] === 'entityTypes') {
			const entityType = parsed.model.entityTypes?.[Number(element.jsonPath[1])];
			if (entityType) {
				const uriTail = typeof entityType.uri === 'string' ? entityType.uri.split('/').pop() : undefined;
				return new ConfigTreeItem(
					entityType.label || uriTail || 'Entity Type',
					'entityType',
					element.jsonPath,
					vscode.TreeItemCollapsibleState.Collapsed,
					entityType.abstract ? 'abstract' : undefined,
					element.tenantL3Uri,
				);
			}
		}
		const p = getConfigTreeItemParent(parsed.model, element);
		if (p) return p;
		const loc = tenantLocFromL3File(element.tenantL3Uri!);
		if (!loc || element.jsonPath.length > 1) return undefined;
		const ti = this.findTenantInfo(loc.environmentName, loc.tenantId);
		return new TenantNode(
			loc.environmentName,
			loc.tenantId,
			ti?.hasL3 ?? false,
			(ti?.hasL3 ?? false) && !this.tokenStore.hasToken(loc.environmentName),
			this.tokenStore.hasToken(loc.environmentName),
			this.uxState?.perTenant.get(`${loc.environmentName}/${loc.tenantId}`) ?? 'T_NO_L3',
		);
	}

	private findTenantInfo(env: string, tid: string): TenantInfo | undefined {
		const e = this.envInfos.find(x => x.name === env);
		return e?.tenants.find(t => t.tenantId === tid);
	}

	private async shouldShowHistoryFolder(environmentName: string, tenantId: string): Promise<boolean> {
		if (!this.environmentManager) return false;
		const dir = this.environmentManager.getHistoryDirectoryUri(environmentName, tenantId);
		const snaps = await listLocalHistorySnapshots(dir);
		if (snaps.length > 0) return true;
		return this.workspaceState.get<boolean>(historyExposedStorageKey(environmentName, tenantId)) === true;
	}

	async getChildren(element?: MultiTenantTreeElement): Promise<MultiTenantTreeElement[]> {
		if (!this.environmentManager) return [];
		if (!element) {
			if (this.envInfosStale) {
				this.envInfos = await this.environmentManager.scanEnvironments();
				this.envInfosStale = false;
			}
			if (this.browserLoginByEnv.size === 0 && this.oauthCredentialsStore) {
				await this.ensureBrowserLoginEligibilityFresh();
			}
			const names = this.envInfos.map(e => e.name);
			return names.map(n => this.environmentNode(n, this.tokenStore.hasToken(n)));
		}
		if (element instanceof EnvironmentNode) {
			const e = this.envInfos.find(x => x.name === element.environmentName);
			if (!e) return [];
			return e.tenants.map(
				t => new TenantNode(
					element.environmentName,
					t.tenantId,
					t.hasL3,
					t.hasL3 && !this.tokenStore.hasToken(element.environmentName),
					this.tokenStore.hasToken(element.environmentName),
					this.uxState?.perTenant.get(`${element.environmentName}/${t.tenantId}`) ?? 'T_NO_L3',
				),
			);
		}
		if (element instanceof TenantNode) {
			const items: MultiTenantTreeElement[] = [];
			if (element.hasL3) {
				const showHistory = await this.shouldShowHistoryFolder(element.environmentName, element.tenantId);
				if (showHistory) {
					const dir = this.environmentManager.getHistoryDirectoryUri(
						element.environmentName,
						element.tenantId,
					);
					const snaps = await listLocalHistorySnapshots(dir);
					items.push(new HistoryFolderNode(element.environmentName, element.tenantId, snaps.length));
				}
				const parsed = await this.loadParsed(element.environmentName, element.tenantId);
				if (parsed) {
					const uri = this.environmentManager.getL3Uri(element.environmentName, element.tenantId);
					items.push(...getConfigRootChildren(parsed.model, uri));
				}
			}
			return items;
		}
		if (element instanceof HistoryFolderNode) {
			const dir = this.environmentManager.getHistoryDirectoryUri(element.environmentName, element.tenantId);
			const snaps = await listLocalHistorySnapshots(dir);
			return snaps.map((s, idx) => {
				const hasOlder = idx < snaps.length - 1;
				return new HistorySnapshotNode(
					element.environmentName,
					element.tenantId,
					s.fileUri,
					formatHistoryTreeLabel(s.timestampMs, s.displayUser),
					hasOlder,
				);
			});
		}
		if (element instanceof ConfigTreeItem) {
			const parsed = await this.loadParsedFromItem(element);
			if (!parsed) return [];
			const children = getConfigNodeChildren(parsed.model, element);
			await Promise.all(children.map(child => this.decorateEntityBrowserCount(child)));
			return children;
		}
		return [];
	}

	private async decorateEntityBrowserCount(item: ConfigTreeItem): Promise<void> {
		if (item.nodeType !== 'entityBrowser' || !item.tenantL3Uri) return;
		if (item.browseEntityTypeUris?.length === 0) {
			item.label = 'Browse Entities (0)';
			return;
		}
		const loc = tenantLocFromL3File(item.tenantL3Uri);
		if (!loc) return;
		const token = this.tokenStore.getToken(loc.environmentName);
		if (!token) return;
		const filter = typeFilterForUris(item.browseEntityTypeUris ?? []);
		if (!filter) return;
		try {
			const total = await countEntities(loc.environmentName, loc.tenantId, token, filter);
			item.label = `Browse Entities (${total.toLocaleString()})`;
		} catch {
			// Counts are a convenience in the tree; browsing should remain available.
		}
	}

	private async loadParsedFromItem(item: ConfigTreeItem): Promise<ParsedDocument | undefined> {
		if (!item.tenantL3Uri) return undefined;
		return this.loadParsedFromUri(item.tenantL3Uri);
	}

	private async loadParsed(env: string, tenantId: string): Promise<ParsedDocument | undefined> {
		if (!this.environmentManager) return undefined;
		const uri = this.environmentManager.getL3Uri(env, tenantId);
		return this.loadParsedFromUri(uri);
	}

	private async loadParsedFromUri(uri: vscode.Uri): Promise<ParsedDocument | undefined> {
		const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
		if (open) return parseDocument(open.getText());
		try {
			const raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
			return parseDocument(raw);
		} catch {
			return undefined;
		}
	}

	async findEntityTypeItem(shortName: string): Promise<ConfigTreeItem | undefined> {
		if (!this.environmentManager) return undefined;
		const envs = await this.environmentManager.scanEnvironments();
		for (const env of envs) {
			for (const t of env.tenants) {
				if (!t.hasL3) continue;
				const parsed = await this.loadParsed(env.name, t.tenantId);
				if (!parsed) continue;
				const uri = this.environmentManager.getL3Uri(env.name, t.tenantId);
				const item = findConfigEntityTypeItem(parsed.model, shortName, uri);
				if (item) return item;
			}
		}
		return undefined;
	}
}
