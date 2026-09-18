import * as vscode from 'vscode';
import { parseDocument, type ParsedDocument } from '../parser/configParser';
import { EnvironmentManager, type TenantInfo } from '../workspace/environmentManager';
import { getCurrentBranch } from '../workspace/tenantGitBinding';
import { isGitRepo } from '../workspace/gitConfigSource';
import { readTenantIdentityMarker } from '../workspace/gitSourceMarker';
import { TokenStore, GIT_SOURCE_TOKEN } from '../api/tokenStore';
import { countEntities } from '../api/reltioClient';
import type { OAuthCredentialsStore } from '../api/oauthCredentialsStore';
import { computeBrowserLoginEligibility } from '../api/oauthCredentialsResolve';
import {
	EnvironmentNode,
	TenantNode,
	GitFolderNode,
	HistoryFolderNode,
	HistorySnapshotNode,
	BusinessConfigFolderNode,
} from './multiTenantNodes';
import {
	WorkflowsFolderNode,
	WorkflowFetchActionNode,
	ProcessDefinitionsFolderNode,
	JarDeploymentsFolderNode,
	ProcessDefinitionNode,
	JarDeploymentNode,
	WorkflowDraftsFolderNode,
	WorkflowDraftNode,
} from './workflowNodes';
import { loadWorkflowAdapterUrl } from '../workspace/workflowAdapterConfig';
import { listWorkflowDrafts } from '../workspace/workflowDrafts';
import { listLocalBpmnFiles } from '../workspace/workflowBpmnFiles';
import type { ProcessDefinition, JarDeployment } from '../api/workflowAdapterClient';
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
	| GitFolderNode
	| BusinessConfigFolderNode
	| HistoryFolderNode
	| HistorySnapshotNode
	| ConfigTreeItem
	| WorkflowsFolderNode
	| WorkflowFetchActionNode
	| ProcessDefinitionsFolderNode
	| JarDeploymentsFolderNode
	| ProcessDefinitionNode
	| JarDeploymentNode
	| WorkflowDraftsFolderNode
	| WorkflowDraftNode;

export function historyExposedStorageKey(environmentName: string, tenantId: string): string {
	return `reltio.history.exposed::${environmentName}::${tenantId}`;
}

export function tenantLocFromL3File(
	l3Uri: vscode.Uri,
	environmentManager?: EnvironmentManager | null,
): { environmentName: string; tenantId: string } | undefined {
	// Plain folder names carry no identity, so the scan-built index is the authority; legacy
	// suffixed paths still parse, which keeps a pre-rename workspace working.
	return environmentManager?.locFromPath(l3Uri.fsPath) ?? pathTenantLocFromL3Path(l3Uri.fsPath);
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

	/**
	 * Branch per `env/tenant`, resolved lazily and reused for the rest of a refresh cycle.
	 *
	 * Reading `HEAD` is a git shell-out, so doing it inside the row constructor would mean one
	 * process per tenant per render. Cleared by `refresh()`, which is also what picks up a
	 * checkout the user made from a terminal.
	 */
	private readonly branchCache = new Map<string, { bound: boolean; branch?: string }>();

	/** Marker-sourced identity per `env/tenant`, cached for the same window as `branchCache`. */
	private readonly identityCache = new Map<
		string,
		{ environmentName: string; tenantId: string } | undefined
	>();

	private envInfosStale = true;
	private envInfos: Awaited<ReturnType<EnvironmentManager['scanEnvironments']>> = [];
	private browserLoginByEnv = new Map<string, boolean>();
	private eligibilityRefreshPromise: Promise<void> | undefined;
	private treeChangeDebounceTimer: ReturnType<typeof setTimeout> | undefined;
	private uxState: UxState | undefined;

	/**
	 * In-memory workflow data keyed by `"${environmentName}/${tenantId}"`.
	 * Populated by `markWorkflowsLoaded()` after a successful fetch; `undefined`
	 * means "not yet fetched this session".
	 *
	 * It is **not** cleared by `invalidate()`, and `clearWorkflowCache()` has no
	 * caller yet, so an entry survives sign-out and tenant removal for the life
	 * of the window. Deciding when to evict is an open item — see the review
	 * notes on Part 1 — and needs settling before anything mutating (deploy,
	 * JAR registration) reads from this map.
	 */
	private readonly workflowCache = new Map<
		string,
		{ definitions: ProcessDefinition[]; jars: JarDeployment[] }
	>();

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

	/**
	 * Store workflow results and refresh the tree so the Workflows sub-tree
	 * expands immediately. Called from `extension.ts` after a successful
	 * `reltio.fetchWorkflows` or `reltio.refreshWorkflows` command.
	 */
	markWorkflowsLoaded(
		environmentName: string,
		tenantId: string,
		definitions: ProcessDefinition[],
		jars: JarDeployment[],
	): void {
		this.workflowCache.set(`${environmentName}/${tenantId}`, { definitions, jars });
		this.scheduleTreeRefresh();
	}

	/**
	 * Replace only the process-definition half of a tenant's cache.
	 *
	 * The two lists come from two independent endpoints, so refreshing one should
	 * not require a round trip for the other. A partial update on a tenant that
	 * has never been fetched still seeds the other half as empty, so the tree has
	 * something coherent to render.
	 */
	markProcessDefinitionsLoaded(
		environmentName: string,
		tenantId: string,
		definitions: ProcessDefinition[],
	): void {
		const key = `${environmentName}/${tenantId}`;
		const existing = this.workflowCache.get(key);
		this.workflowCache.set(key, { definitions, jars: existing?.jars ?? [] });
		this.scheduleTreeRefresh();
	}

	/** Replace only the JAR half of a tenant's cache. */
	markJarDeploymentsLoaded(
		environmentName: string,
		tenantId: string,
		jars: JarDeployment[],
	): void {
		const key = `${environmentName}/${tenantId}`;
		const existing = this.workflowCache.get(key);
		this.workflowCache.set(key, { definitions: existing?.definitions ?? [], jars });
		this.scheduleTreeRefresh();
	}

	/** Cached JAR deployments for one tenant, or an empty list when unfetched. */
	getCachedJarDeployments(environmentName: string, tenantId: string): JarDeployment[] {
		return this.workflowCache.get(`${environmentName}/${tenantId}`)?.jars ?? [];
	}

	/**
	 * Process definitions cached for one tenant, or an empty list when Workflows
	 * has not been fetched this session.
	 *
	 * Exposed so a command can collision-check a proposed process id against what
	 * is actually deployed regardless of which tree row it was launched from —
	 * reading `definitions` off the node only works from the Process Definitions
	 * folder, and that guard is what stops a draft silently versioning a live
	 * workflow.
	 */
	getCachedProcessDefinitions(environmentName: string, tenantId: string): ProcessDefinition[] {
		return this.workflowCache.get(`${environmentName}/${tenantId}`)?.definitions ?? [];
	}

	/**
	 * A draft was created or deleted — re-render the Workflows branch so the
	 * Drafts folder appears, updates its count, or disappears.
	 *
	 * Deliberately `scheduleTreeRefresh()` and not `invalidate()`: a local file
	 * write says nothing about the environment, and `invalidate()` would trigger a
	 * full environment rescan for it.
	 */
	notifyWorkflowDraftsChanged(): void {
		this.scheduleTreeRefresh();
	}

	/** Clear cached workflow data for one tenant (e.g. after removing the tenant). */
	clearWorkflowCache(environmentName: string, tenantId: string): void {
		this.workflowCache.delete(`${environmentName}/${tenantId}`);
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
		// Drop cached branches so a checkout made outside the extension shows up.
		this.branchCache.clear();
		this.identityCache.clear();
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
		const lowerP = p.toLowerCase();
		if (
			lowerP.endsWith('l3.reltio.json') ||
			lowerP.endsWith('l3.json') ||
			lowerP.endsWith('businessconfig.json') ||
			(p.includes('/history/') && p.endsWith('.reltio.json'))
		) {
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
		if (element instanceof GitFolderNode) {
			const parentPath = element.folderPath.slice(0, -1);
			if (parentPath.length === 0) {
				return this.environmentNode(
					element.environmentName,
					this.tokenStore.hasToken(element.environmentName),
				);
			}
			return new GitFolderNode(element.environmentName, parentPath, true);
		}
		if (element instanceof TenantNode) {
			// A git-sourced config nested in folders hangs off its folder row, not the environment.
			const source = this.environmentManager
				?.getGitSources()
				.find(g => g.environmentName === element.environmentName && g.tenantId === element.tenantId);
			if (source && source.folders.length > 0) {
				return new GitFolderNode(element.environmentName, source.folders, true);
			}
			return this.environmentNode(
				element.environmentName,
				this.tokenStore.hasToken(element.environmentName),
			);
		}
		if (element instanceof HistoryFolderNode) {
			// History now lives under Business Config, not directly under the tenant.
			return new BusinessConfigFolderNode(element.environmentName, element.tenantId);
		}
		if (element instanceof WorkflowsFolderNode) {
			const ti = this.findTenantInfo(element.environmentName, element.tenantId);
			return new TenantNode(
				element.environmentName,
				element.tenantId,
				ti?.hasL3 ?? false,
				(ti?.hasL3 ?? false) && !this.tokenStore.hasToken(element.environmentName),
				this.tokenStore.hasToken(element.environmentName),
				this.uxState?.perTenant.get(`${element.environmentName}/${element.tenantId}`) ?? 'T_NO_L3',
				false,
				this.gitLabelFor(element.environmentName, element.tenantId),
			);
		}
		// Everything below the Workflows folder. Before this, all of these fell
		// through to `undefined`, so `reveal()` silently did nothing on any workflow
		// node. Reconstruction rather than a held reference is safe because every
		// node sets a stable `id` and VS Code matches on it — the same technique the
		// TenantNode branches above already use.
		if (
			element instanceof ProcessDefinitionsFolderNode ||
			element instanceof JarDeploymentsFolderNode ||
			element instanceof WorkflowDraftsFolderNode ||
			element instanceof WorkflowFetchActionNode
		) {
			return this.workflowsFolderFor(element.environmentName, element.tenantId);
		}
		if (element instanceof ProcessDefinitionNode) {
			const cached = this.workflowCache.get(`${element.environmentName}/${element.tenantId}`);
			return new ProcessDefinitionsFolderNode(
				element.environmentName,
				element.tenantId,
				cached?.definitions ?? [],
			);
		}
		if (element instanceof JarDeploymentNode) {
			const cached = this.workflowCache.get(`${element.environmentName}/${element.tenantId}`);
			return new JarDeploymentsFolderNode(
				element.environmentName,
				element.tenantId,
				cached?.jars ?? [],
			);
		}
		if (element instanceof WorkflowDraftNode) {
			return this.workflowDraftsFor(element.environmentName, element.tenantId).then(
				drafts => new WorkflowDraftsFolderNode(element.environmentName, element.tenantId, drafts),
			);
		}
		if (element instanceof BusinessConfigFolderNode) {
			const ti = this.findTenantInfo(element.environmentName, element.tenantId);
			return new TenantNode(
				element.environmentName,
				element.tenantId,
				ti?.hasL3 ?? false,
				(ti?.hasL3 ?? false) && !this.tokenStore.hasToken(element.environmentName),
				this.tokenStore.hasToken(element.environmentName),
				this.uxState?.perTenant.get(`${element.environmentName}/${element.tenantId}`) ?? 'T_NO_L3',
				false,
				this.gitLabelFor(element.environmentName, element.tenantId),
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
		const loc = tenantLocFromL3File(element.tenantL3Uri!, this.environmentManager);
		if (!loc || element.jsonPath.length > 1) return undefined;
		// Top-level config items now live under Business Config, not directly under the tenant.
		return new BusinessConfigFolderNode(loc.environmentName, loc.tenantId);
	}

	/**
	 * Rebuild a tenant's Workflows folder node, reading the saved Adapter URL so
	 * the reconstructed node carries the same collapsible state as the rendered
	 * one. Async is legal here — `getParent` returns a `ProviderResult`.
	 */
	private async workflowsFolderFor(
		environmentName: string,
		tenantId: string,
	): Promise<WorkflowsFolderNode> {
		const savedAdapterUrl = this.environmentManager
			? await loadWorkflowAdapterUrl(
				this.environmentManager.getWorkflowAdapterConfigUri(environmentName, tenantId),
			)
			: undefined;
		return new WorkflowsFolderNode(environmentName, tenantId, savedAdapterUrl);
	}

	/**
	 * Local BPMNs for one tenant, split by whether they have a baseline.
	 *
	 * A baseline means the file came from the tenant, so it belongs to a deployed
	 * definition and is surfaced there with a local-changes marker. No baseline
	 * means it was never deployed — that is a draft. One directory scan answers
	 * both questions, so the two branches cannot disagree.
	 */
	private async localBpmnStateFor(environmentName: string, tenantId: string) {
		if (!this.environmentManager) {
			return { drafts: [] as { processId: string; fileUri: vscode.Uri; fileName: string }[], changed: new Set<string>(), downloaded: new Set<string>() };
		}
		const dir = this.environmentManager.getWorkflowDraftsDirectoryUri(environmentName, tenantId);
		const files = await listLocalBpmnFiles(dir);
		const drafts = files
			.filter(f => f.baselineText === undefined)
			.map(f => ({ processId: f.processId, fileUri: f.fileUri, fileName: `${f.processId}.bpmn20.xml` }));
		const changed = new Set(files.filter(f => f.hasLocalChanges).map(f => f.processId));
		const downloaded = new Set(files.filter(f => f.baselineText !== undefined).map(f => f.processId));
		return { drafts, changed, downloaded };
	}

	/** Drafts on disk for one tenant; empty when the folder does not exist yet. */
	private async workflowDraftsFor(environmentName: string, tenantId: string) {
		return (await this.localBpmnStateFor(environmentName, tenantId)).drafts;
	}

	/**
	 * Environment and tenant as recorded in the tenant folder's gitignored marker.
	 *
	 * The marker is the authority once a tenant is bound to Git, because the repository root is
	 * the tenant folder and the identity is no longer recoverable from anything Git tracks. Folder
	 * names stay the fallback, so unbound tenants and pre-existing workspaces are unaffected.
	 */
	private async identityFor(
		env: string,
		tenantId: string,
	): Promise<{ environmentName: string; tenantId: string } | undefined> {
		if (!this.environmentManager) return undefined;
		const key = `${env}/${tenantId}`;
		if (this.identityCache.has(key)) return this.identityCache.get(key);
		let identity: { environmentName: string; tenantId: string } | undefined;
		try {
			identity = await readTenantIdentityMarker(
				this.environmentManager.getTenantRootUri(env, tenantId),
			);
		} catch {
			identity = undefined;
		}
		this.identityCache.set(key, identity);
		return identity;
	}

	/**
	 * Current branch for a tenant folder, memoized until the next `invalidate()`.
	 *
	 * Returns undefined for an unbound tenant, a detached HEAD, or when git cannot be reached:
	 * the row then simply shows no branch rather than an error.
	 */
	private async gitStateFor(
		env: string,
		tenantId: string,
	): Promise<{ bound: boolean; branch?: string }> {
		if (!this.environmentManager) return { bound: false };
		const key = `${env}/${tenantId}`;
		const cached = this.branchCache.get(key);
		if (cached) return cached;
		const root = this.environmentManager.getTenantRootUri(env, tenantId);
		let state: { bound: boolean; branch?: string };
		try {
			const bound = await isGitRepo(root);
			state = { bound, branch: bound ? await getCurrentBranch(root) : undefined };
		} catch {
			state = { bound: false };
		}
		this.branchCache.set(key, state);
		return state;
	}

	private findTenantInfo(env: string, tid: string): TenantInfo | undefined {
		const e = this.envInfos.find(x => x.name === env);
		return e?.tenants.find(t => t.tenantId === tid);
	}

	/** Git mode only: the plain leaf label for a row, so `getParent` matches what `getChildren` rendered. */
	private gitLabelFor(env: string, tenantId: string): string | undefined {
		return this.environmentManager
			?.getGitSources()
			.find(g => g.environmentName === env && g.tenantId === tenantId)?.label;
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
			// Check if this is a git source (auto-expand tenants)
			const isGitSource = this.tokenStore.getToken(element.environmentName) === GIT_SOURCE_TOKEN;
			if (isGitSource) {
				return this.gitChildren(element.environmentName, []);
			}
			return Promise.all(
				e.tenants.map(async t => new TenantNode(
					element.environmentName,
					t.tenantId,
					t.hasL3,
					t.hasL3 && !this.tokenStore.hasToken(element.environmentName),
					this.tokenStore.hasToken(element.environmentName),
					this.uxState?.perTenant.get(`${element.environmentName}/${t.tenantId}`) ?? 'T_NO_L3',
					isGitSource,
					(await this.identityFor(element.environmentName, t.tenantId))?.tenantId,
					(await this.gitStateFor(element.environmentName, t.tenantId)).branch,
					(await this.gitStateFor(element.environmentName, t.tenantId)).bound,
				)),
			);
		}
		if (element instanceof GitFolderNode) {
			return this.gitChildren(element.environmentName, element.folderPath);
		}
		if (element instanceof TenantNode) {
			const children: MultiTenantTreeElement[] = [];

			// Business Config folder — only shown when an L3 file is present.
			if (element.hasL3) {
				children.push(new BusinessConfigFolderNode(element.environmentName, element.tenantId));
			}

			// Workflows folder — shown regardless of L3 presence, but never in git mode.
			// `gitChildren()` also builds TenantNodes, and there its `tenantId` is a marker
			// key derived from a repository folder path, not a Reltio tenant: there is no
			// Adapter to query, and the environment's "token" is the GIT_SOURCE_TOKEN
			// sentinel, which is a non-empty string and so passes an `if (!token)` guard.
			const isGitSource = this.tokenStore.getToken(element.environmentName) === GIT_SOURCE_TOKEN;
			if (!isGitSource) {
				const configUri = this.environmentManager.getWorkflowAdapterConfigUri(
					element.environmentName,
					element.tenantId,
				);
				const savedAdapterUrl = await loadWorkflowAdapterUrl(configUri);
				children.push(
					new WorkflowsFolderNode(element.environmentName, element.tenantId, savedAdapterUrl),
				);
			}

			return children;
		}
		if (element instanceof BusinessConfigFolderNode) {
			// Today's tenant children, verbatim — moved one level deeper.
			const items: MultiTenantTreeElement[] = [];
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
			return items;
		}
		if (element instanceof WorkflowsFolderNode) {
			const cached = this.workflowCache.get(`${element.environmentName}/${element.tenantId}`);
			if (cached === undefined) {
				// URL saved but not yet loaded this session — show a fetch action row.
				return element.savedAdapterUrl !== undefined
					? [new WorkflowFetchActionNode(element.environmentName, element.tenantId)]
					: [];
			}
			const children: MultiTenantTreeElement[] = [
				new ProcessDefinitionsFolderNode(
					element.environmentName,
					element.tenantId,
					cached.definitions,
				),
				new JarDeploymentsFolderNode(
					element.environmentName,
					element.tenantId,
					cached.jars,
				),
			];
			// Drafts appear only when at least one exists — same rule as History.
			const drafts = await this.workflowDraftsFor(element.environmentName, element.tenantId);
			if (drafts.length > 0) {
				children.push(
					new WorkflowDraftsFolderNode(element.environmentName, element.tenantId, drafts),
				);
			}
			return children;
		}
		if (element instanceof WorkflowDraftsFolderNode) {
			return element.drafts.map(
				d => new WorkflowDraftNode(element.environmentName, element.tenantId, d),
			);
		}
		if (element instanceof ProcessDefinitionsFolderNode) {
			const { changed, downloaded } = await this.localBpmnStateFor(
				element.environmentName,
				element.tenantId,
			);
			return element.definitions.map(d => new ProcessDefinitionNode(
				element.environmentName,
				element.tenantId,
				d,
				changed.has(d.type) ? 'changed' : downloaded.has(d.type) ? 'clean' : 'none',
			));
		}
		if (element instanceof JarDeploymentsFolderNode) {
			return element.deployments.map(
				d => new JarDeploymentNode(element.environmentName, element.tenantId, d),
			);
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

	/**
	 * Rows directly beneath `folderPath` in a git-sourced repository: nested folders first,
	 * then the configs that live at this level. Mirrors the repository's own directory layout.
	 */
	private gitChildren(environmentName: string, folderPath: string[]): MultiTenantTreeElement[] {
		const sources = this.environmentManager?.getGitSources() ?? [];
		const atThisLevel = sources.filter(
			s =>
				s.environmentName === environmentName &&
				s.folders.length >= folderPath.length &&
				folderPath.every((seg, i) => s.folders[i] === seg),
		);

		const folderNames: string[] = [];
		for (const s of atThisLevel) {
			const next = s.folders[folderPath.length];
			if (next !== undefined && !folderNames.includes(next)) {
				folderNames.push(next);
			}
		}
		folderNames.sort((a, b) => a.localeCompare(b));

		const folders = folderNames.map(
			name => new GitFolderNode(environmentName, [...folderPath, name], true),
		);

		const configs = atThisLevel
			.filter(s => s.folders.length === folderPath.length)
			.sort((a, b) => (a.label ?? a.tenantId).localeCompare(b.label ?? b.tenantId))
			.map(
				s => new TenantNode(
					environmentName,
					s.tenantId,
					true,
					false,
					this.tokenStore.hasToken(environmentName),
					this.uxState?.perTenant.get(`${environmentName}/${s.tenantId}`) ?? 'T_READY',
					true,
					s.label,
				),
			);

		return [...folders, ...configs];
	}

	private async decorateEntityBrowserCount(item: ConfigTreeItem): Promise<void> {
		if (item.nodeType !== 'entityBrowser' || !item.tenantL3Uri) return;
		if (item.browseEntityTypeUris?.length === 0) {
			item.label = 'Browse Entities (0)';
			return;
		}
		const loc = tenantLocFromL3File(item.tenantL3Uri, this.environmentManager);
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
