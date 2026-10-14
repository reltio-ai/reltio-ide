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
	UnregisteredJarsFolderNode,
	UnregisteredJarNode,
	WorkflowDraftsFolderNode,
	WorkflowDraftNode,
	WorkflowRepoNode,
	WorkflowRepoBpmnFileNode,
	WorkflowRepoGroupNode,
	WorkflowRepoModuleNode,
	WorkflowRepoJavaFileNode,
	type WorkflowRepoGroupKind,
} from './workflowNodes';
import { loadWorkflowAdapterUrl } from '../workspace/workflowAdapterConfig';
import { bpmnFileName, listLocalBpmnFiles } from '../workspace/workflowBpmnFiles';
import type { WorkflowDraft } from '../workspace/workflowDrafts';
import { extractProcessModel } from '../workflow/bpmnModel';
import type { RepoSyncState } from '../workspace/workflowRepoSync';
import { inspectWorkflowRepoConfig, loadWorkflowRepoConfig } from '../workspace/workflowRepoConfig';
import { reconcileWorkflowRepoGitignore } from '../workspace/workflowRepoGitignore';
import type { DiscoveredBpmnFile } from '../workspace/workflowRepoDiscovery';
import type { DiscoveredJavaSource, JavaSourceKind } from '../workspace/workflowRepoJavaDiscovery';
import type { ProcessDefinition, JarDeployment, AvailableJar } from '../api/workflowAdapterClient';
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
	| UnregisteredJarsFolderNode
	| UnregisteredJarNode
	| WorkflowDraftsFolderNode
	| WorkflowDraftNode
	| WorkflowRepoNode
	| WorkflowRepoBpmnFileNode
	| WorkflowRepoGroupNode
	| WorkflowRepoModuleNode
	| WorkflowRepoJavaFileNode;

/** Shared by the key builder and the by-environment sweep in `removeEnvironment`. */
const HISTORY_EXPOSED_PREFIX = 'reltio.history.exposed::';

/** One of the four independently-fetched halves of a tenant's workflow cache — see `fetchGenerations`. */
export type WorkflowFetchKind = 'workflows' | 'processDefinitions' | 'jarDeployments' | 'repoSync';

/**
 * Key for the "history has been fetched for this tenant" marker.
 *
 * Still a `::`-joined string because it keys `historyExposedThisSession` below,
 * which is a flat set rather than a two-level structure.
 */
export function historyExposedStorageKey(environmentName: string, tenantId: string): string {
	return `${HISTORY_EXPOSED_PREFIX}${environmentName}::${tenantId}`;
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
	 * `invalidate()` deliberately does not clear it — a workspace rescan says
	 * nothing about what is deployed, and re-fetching costs two network calls.
	 * Removal does: `removeTenant()` and `removeEnvironment()` evict, so a
	 * tenant that is removed and re-added cannot have a new process id
	 * collision-checked against the previous tenant's definitions through
	 * `getCachedProcessDefinitions()`.
	 */
	private readonly workflowCache = new Map<
		string,
		{
			/**
			 * `undefined` means "never fetched this session", which is not the same as "fetched and
			 * empty": a partial update (a repository sync, one half of a refresh) must not invent the
			 * other half as an empty list, or the tree shows `(0)` folders for a tenant nobody has
			 * loaded and drops the Fetch row.
			 */
			definitions: ProcessDefinition[] | undefined;
			jars: JarDeployment[] | undefined;
			/**
			 * JARs on S3 not yet registered, or `undefined` when that discovery
			 * hasn't been attempted this session or isn't available for this
			 * tenant (missing `jarsLocation` config) — see `listAvailableJars()`.
			 */
			unregisteredJars: AvailableJar[] | undefined;
			/**
			 * D5's sync badge, populated by `markWorkflowRepoSync()`. `repoTrackedCount`
			 * is `undefined` until the first computation (no badge text yet, distinct
			 * from "computed as zero"); `repoSync` maps a process id to its state only
			 * for definitions that matched a discovered repository file — everything
			 * else has no entry, which the tree renders as no badge at all.
			 */
			repoTrackedCount?: number;
			repoSync?: Map<string, RepoSyncState>;
			/**
			 * The files themselves, so `getChildren(WorkflowRepoNode)` can render one
			 * row per discovered file without a second filesystem walk. Kept separate
			 * from `repoTrackedCount` (which existed first, for the row's description
			 * text) rather than derived from `repoFiles.length`, so a cache written by
			 * an older code path that only ever set the count still renders a count
			 * even before this list is populated.
			 */
			repoFiles?: DiscoveredBpmnFile[];
			/**
			 * Java sources found in the connected repository, both kinds in one list —
			 * `getChildren()` splits them by `kind` rather than storing two arrays,
			 * since `discoverJavaSources()` returns them already sorted together and
			 * splitting at render time keeps one write path for one walk.
			 */
			repoJavaSources?: DiscoveredJavaSource[];
		}
	>();

	/**
	 * Per-tenant "fetch generation" counters, one sequence per `(kind, environmentName, tenantId)`.
	 *
	 * `markWorkflowsLoaded`/`markProcessDefinitionsLoaded`/`markJarDeploymentsLoaded`/
	 * `markWorkflowRepoSync` each do a synchronous read-merge-write of `workflowCache`, but nothing
	 * stops two overlapping *async* fetches for the same tenant from resolving out of order — e.g.
	 * a deploy's own post-deploy process-definitions re-fetch racing a separately user-triggered
	 * refresh, where the earlier fetch happens to finish last and would overwrite the newer result.
	 *
	 * `beginWorkflowFetch()` is called right before a fetch's network call starts and hands back the
	 * generation it claimed; the corresponding `mark*` call is later given that same number and
	 * silently no-ops if a newer fetch of the same kind for the same tenant has started since — that
	 * newer fetch is already in flight and will supersede this result on its own.
	 *
	 * Scoped narrowly to this one problem rather than a generic "stale request" abstraction: nothing
	 * else in this codebase has a request-id/generation guard to reuse, and a counter per call site
	 * is simpler than inventing one.
	 */
	private readonly fetchGenerations = new Map<string, number>();

	/**
	 * One claim order per tenant, shared by every kind. The per-kind map above only answers "has a
	 * newer fetch of the SAME kind started"; it cannot see that a combined load (`workflows`) that
	 * started before a deploy's `processDefinitions` re-fetch is the older data. Comparing claim
	 * numbers across kinds can.
	 */
	private readonly tenantClaims = new Map<string, number>();

	/**
	 * Highest claim already applied to each half of a tenant's cache. A result whose claim is not
	 * above it is older than what the cache already holds and is dropped.
	 */
	private readonly appliedClaims = new Map<string, number>();

	/** Claim the next fetch generation for `kind` on one tenant; pass the result to the matching `mark*` call. */
	beginWorkflowFetch(kind: WorkflowFetchKind, environmentName: string, tenantId: string): number {
		const tenantKey = `${environmentName}/${tenantId}`;
		const next = (this.tenantClaims.get(tenantKey) ?? 0) + 1;
		this.tenantClaims.set(tenantKey, next);
		this.fetchGenerations.set(`${kind}:${tenantKey}`, next);
		return next;
	}

	/** True if `generation` is newer than whatever already landed in `half`; records it when so. */
	private claimHalf(half: 'definitions' | 'jars', environmentName: string, tenantId: string, generation: number | undefined): boolean {
		if (generation === undefined) return true;
		const key = `${half}:${environmentName}/${tenantId}`;
		if (generation <= (this.appliedClaims.get(key) ?? 0)) return false;
		this.appliedClaims.set(key, generation);
		return true;
	}

	/** True when `generation` is still the latest one claimed for `kind` on this tenant. */
	private isLatestWorkflowFetch(
		kind: WorkflowFetchKind,
		environmentName: string,
		tenantId: string,
		generation: number,
	): boolean {
		const key = `${kind}:${environmentName}/${tenantId}`;
		return this.fetchGenerations.get(key) === generation;
	}

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

	/**
	 * Tenants whose history was fetched during this window session.
	 *
	 * Deliberately in memory rather than in `workspaceState`. The marker exists so
	 * that a fetch which legitimately returns zero rows still shows the folder —
	 * otherwise the command looks like it did nothing. Persisting it made that
	 * courtesy permanent: once history had been fetched for a tenant, an empty
	 * History folder reappeared on every later window, and on reconnecting the
	 * same tenant, with nothing in it and no way to dismiss it. Session scope
	 * keeps the feedback and drops the residue — a folder that outlives the
	 * action it was reporting on is just clutter.
	 */
	private readonly historyExposedThisSession = new Set<string>();

	/** Call after a successful history fetch so the History folder appears even when the API returned zero rows. */
	markHistoryExposed(environmentName: string, tenantId: string): void {
		this.historyExposedThisSession.add(historyExposedStorageKey(environmentName, tenantId));
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
		unregisteredJars: AvailableJar[] | undefined = undefined,
		generation?: number,
	): void {
		// A newer 'workflows' fetch for this tenant has started since `generation` was claimed —
		// that fetch's own result will land here shortly and must not be overwritten by this one.
		if (generation !== undefined && !this.isLatestWorkflowFetch('workflows', environmentName, tenantId, generation)) {
			return;
		}
		const key = `${environmentName}/${tenantId}`;
		const existing = this.workflowCache.get(key);
		// Each half is applied only if it is newer than what is already there, so a slow combined
		// load cannot bury a deploy's fresher re-fetch (or the other way round).
		const takeDefinitions = this.claimHalf('definitions', environmentName, tenantId, generation);
		const takeJars = this.claimHalf('jars', environmentName, tenantId, generation);
		this.workflowCache.set(key, {
			definitions: takeDefinitions ? definitions : existing?.definitions,
			jars: takeJars ? jars : existing?.jars,
			unregisteredJars: takeJars ? unregisteredJars : existing?.unregisteredJars,
			repoTrackedCount: existing?.repoTrackedCount,
			repoSync: existing?.repoSync,
			repoFiles: existing?.repoFiles,
			repoJavaSources: existing?.repoJavaSources,
		});
		this.scheduleTreeRefresh();
	}

	/**
	 * Replace only the process-definition half of a tenant's cache.
	 *
	 * The two lists come from two independent endpoints, so refreshing one should
	 * not require a round trip for the other. A partial update on a tenant that
	 * has never been fetched leaves the other half `undefined` ("not fetched"), never an
	 * empty list, so the tree does not render a `(0)` folder nobody has loaded.
	 */
	markProcessDefinitionsLoaded(
		environmentName: string,
		tenantId: string,
		definitions: ProcessDefinition[],
		generation?: number,
	): void {
		// Same race guard as `markWorkflowsLoaded()`, scoped to the 'processDefinitions' half —
		// e.g. a deploy's own post-deploy re-fetch resolving after a separately user-triggered one.
		if (generation !== undefined && !this.isLatestWorkflowFetch('processDefinitions', environmentName, tenantId, generation)) {
			return;
		}
		const key = `${environmentName}/${tenantId}`;
		const existing = this.workflowCache.get(key);
		if (!this.claimHalf('definitions', environmentName, tenantId, generation)) return;
		this.workflowCache.set(key, {
			definitions,
			jars: existing?.jars,
			unregisteredJars: existing?.unregisteredJars,
			repoTrackedCount: existing?.repoTrackedCount,
			repoSync: existing?.repoSync,
			repoFiles: existing?.repoFiles,
			repoJavaSources: existing?.repoJavaSources,
		});
		this.scheduleTreeRefresh();
	}

	/**
	 * Replace only the JAR half of a tenant's cache.
	 *
	 * `unregisteredJars` defaults to `undefined` (discovery not attempted /
	 * unavailable), matching `listAvailableJars()`'s best-effort contract — the
	 * caller fetches it separately from `jars` and must not fail this refresh if
	 * that half fails.
	 */
	markJarDeploymentsLoaded(
		environmentName: string,
		tenantId: string,
		jars: JarDeployment[],
		unregisteredJars: AvailableJar[] | undefined = undefined,
		generation?: number,
	): void {
		// Same race guard again, scoped to the 'jarDeployments' half.
		if (generation !== undefined && !this.isLatestWorkflowFetch('jarDeployments', environmentName, tenantId, generation)) {
			return;
		}
		const key = `${environmentName}/${tenantId}`;
		const existing = this.workflowCache.get(key);
		if (!this.claimHalf('jars', environmentName, tenantId, generation)) return;
		this.workflowCache.set(key, {
			definitions: existing?.definitions,
			jars,
			unregisteredJars,
			repoTrackedCount: existing?.repoTrackedCount,
			repoSync: existing?.repoSync,
			repoFiles: existing?.repoFiles,
			repoJavaSources: existing?.repoJavaSources,
		});
		this.scheduleTreeRefresh();
	}

	/**
	 * Store D5's sync-badge computation for one tenant, and the discovered file
	 * list itself so `getChildren(WorkflowRepoNode)` can render one row per file
	 * without a second filesystem walk. Called by `refreshWorkflowRepoSyncState()`
	 * in `extension.ts` after Fetch/Deploy and by the manual
	 * `reltio.refreshWorkflowRepoSync` command — never from inside this class,
	 * which has no network or filesystem access of its own.
	 */
	markWorkflowRepoSync(
		environmentName: string,
		tenantId: string,
		trackedCount: number | undefined,
		sync: Map<string, RepoSyncState>,
		files: DiscoveredBpmnFile[] = [],
		javaSources: DiscoveredJavaSource[] = [],
		generation?: number,
	): void {
		// Same race guard again, scoped to the 'repoSync' half — a disconnect or a manual
		// `reltio.refreshWorkflowRepoSync` racing an automatic post-Fetch/Deploy recomputation.
		if (generation !== undefined && !this.isLatestWorkflowFetch('repoSync', environmentName, tenantId, generation)) {
			return;
		}
		const key = `${environmentName}/${tenantId}`;
		const existing = this.workflowCache.get(key);
		this.workflowCache.set(key, {
			definitions: existing?.definitions,
			jars: existing?.jars,
			unregisteredJars: existing?.unregisteredJars,
			repoTrackedCount: trackedCount,
			repoSync: sync,
			repoFiles: files,
			repoJavaSources: javaSources,
		});
		this.scheduleTreeRefresh();
	}

	/**
	 * Record what a purely local walk of the connected repository found, keeping any sync badges
	 * already computed. Used for the first render after a reload and when a file is created or
	 * deleted: neither needs the tenant, and neither should throw away a badge that is still true.
	 */
	markWorkflowRepoFilesDiscovered(
		environmentName: string,
		tenantId: string,
		files: DiscoveredBpmnFile[],
		javaSources: DiscoveredJavaSource[],
	): void {
		const key = `${environmentName}/${tenantId}`;
		const existing = this.workflowCache.get(key);
		this.workflowCache.set(key, {
			definitions: existing?.definitions,
			jars: existing?.jars,
			unregisteredJars: existing?.unregisteredJars,
			repoTrackedCount: files.length,
			repoSync: existing?.repoSync,
			repoFiles: files,
			repoJavaSources: javaSources,
		});
		this.scheduleTreeRefresh();
	}

	/**
	 * Drop one tenant's cached sync badges, keeping the discovered file lists.
	 *
	 * The badge asserts a byte-exact comparison against deployed XML. Once a repository
	 * file changes on disk that assertion is no longer true of anything, so continuing to
	 * render `synced` is a confident wrong answer — worse than the blank state this
	 * leaves behind until `reltio.refreshWorkflowRepoSync` or the next Fetch/Deploy
	 * recomputes it. Deliberately does not recompute: that fetches deployed XML per file,
	 * which is not something to do on a file save (D5, D7).
	 */
	invalidateWorkflowRepoSync(environmentName: string, tenantId: string): void {
		const key = `${environmentName}/${tenantId}`;
		const existing = this.workflowCache.get(key);
		// Nothing computed yet means nothing stale to clear — and no refresh to schedule.
		if (!existing?.repoSync || existing.repoSync.size === 0) return;
		this.workflowCache.set(key, { ...existing, repoSync: new Map() });
		this.scheduleTreeRefresh();
	}

	/** Number of repository files `discoverBpmnFiles()` found on the last sync computation, or `undefined` before the first one. */
	getCachedWorkflowRepoTrackedCount(environmentName: string, tenantId: string): number | undefined {
		return this.workflowCache.get(`${environmentName}/${tenantId}`)?.repoTrackedCount;
	}

	/** D5's sync state for one process id, or `undefined` when it has no matching repository file. */
	getCachedRepoSyncState(
		environmentName: string,
		tenantId: string,
		processId: string,
	): RepoSyncState | undefined {
		return this.workflowCache.get(`${environmentName}/${tenantId}`)?.repoSync?.get(processId);
	}

	/** Files `discoverBpmnFiles()` found on the last sync computation, or `undefined` before the first one. */
	getCachedWorkflowRepoFiles(
		environmentName: string,
		tenantId: string,
	): DiscoveredBpmnFile[] | undefined {
		return this.workflowCache.get(`${environmentName}/${tenantId}`)?.repoFiles;
	}

	/**
	 * Java sources `discoverJavaSources()` found on the last sync computation, of one
	 * kind. Returns an empty list rather than `undefined` before the first computation:
	 * unlike the BPMN count, nothing renders a "not yet computed" state for these, so
	 * the two cases would be indistinguishable to every caller.
	 */
	getCachedWorkflowRepoJava(
		environmentName: string,
		tenantId: string,
		kind: JavaSourceKind,
	): DiscoveredJavaSource[] {
		const all = this.workflowCache.get(`${environmentName}/${tenantId}`)?.repoJavaSources ?? [];
		return all.filter(source => source.kind === kind);
	}

	/** True once process definitions have been fetched for this tenant this session (an empty result counts). */
	hasFetchedProcessDefinitions(environmentName: string, tenantId: string): boolean {
		return this.workflowCache.get(`${environmentName}/${tenantId}`)?.definitions !== undefined;
	}

	/** Cached JAR deployments for one tenant, or an empty list when unfetched. */
	getCachedJarDeployments(environmentName: string, tenantId: string): JarDeployment[] {
		return this.workflowCache.get(`${environmentName}/${tenantId}`)?.jars ?? [];
	}

	/**
	 * JARs on S3 not yet registered, cached for one tenant.
	 *
	 * `undefined` is distinct from an empty list here (unlike the getters above):
	 * it means discovery hasn't been attempted this session, or isn't available
	 * for this tenant at all (missing `jarsLocation` config — see
	 * `listAvailableJars()`'s `notConfigured` case). A caller offering to pick
	 * from this list needs to tell those two apart to give a useful error.
	 */
	getCachedUnregisteredJars(environmentName: string, tenantId: string): readonly AvailableJar[] | undefined {
		return this.workflowCache.get(`${environmentName}/${tenantId}`)?.unregisteredJars;
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
		this.repoDiscoveryRequested.delete(`${environmentName}/${tenantId}`);
	}

	/**
	 * The provider has no filesystem walk of its own (see `markWorkflowRepoSync()`), so it asks
	 * whoever owns discovery to run one. Called at most once per tenant per session, the first
	 * time a connected repository's row is rendered with nothing discovered — which is exactly
	 * the state after a window reload, when the row otherwise said "Connected" with no children
	 * until the user ran Fetch or Refresh Sync by hand.
	 */
	setWorkflowRepoDiscoveryHandler(handler: ((environmentName: string, tenantId: string) => void) | undefined): void {
		this.repoDiscoveryHandler = handler;
	}

	private repoDiscoveryHandler: ((environmentName: string, tenantId: string) => void) | undefined;
	private invalidRepoConfigHandler: ((environmentName: string, tenantId: string, reason: string) => void) | undefined;
	private readonly invalidRepoConfigReported = new Set<string>();

	/**
	 * `WorkflowRepo.reltio.json` is committed, so a cloned tenant repository decides what is in it.
	 * An invalid one is ignored; this tells whoever owns UI once per session why the row says "not connected".
	 */
	setInvalidRepoConfigHandler(handler: ((environmentName: string, tenantId: string, reason: string) => void) | undefined): void {
		this.invalidRepoConfigHandler = handler;
	}

	private reportInvalidRepoConfigOnce(environmentName: string, tenantId: string, reason: string): void {
		const key = `${environmentName}/${tenantId}`;
		if (this.invalidRepoConfigReported.has(key)) return;
		this.invalidRepoConfigReported.add(key);
		this.invalidRepoConfigHandler?.(environmentName, tenantId, reason);
	}
	private readonly repoDiscoveryRequested = new Set<string>();

	private requestRepoDiscoveryOnce(environmentName: string, tenantId: string): void {
		if (!this.repoDiscoveryHandler) return;
		if (this.getCachedWorkflowRepoFiles(environmentName, tenantId) !== undefined) return;
		const key = `${environmentName}/${tenantId}`;
		if (this.repoDiscoveryRequested.has(key)) return;
		this.repoDiscoveryRequested.add(key);
		this.repoDiscoveryHandler(environmentName, tenantId);
	}

	/** Whether a Custom Workflow Repository is connected for this tenant (sidecar present and valid). */
	private async hasWorkflowRepo(environmentName: string, tenantId: string): Promise<boolean> {
		if (!this.environmentManager) return false;
		const config = await loadWorkflowRepoConfig(
			this.environmentManager.getWorkflowRepoConfigUri(environmentName, tenantId),
		);
		return config !== undefined;
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

	removeEnvironment(name: string): void {
		for (const key of this.workflowCache.keys()) {
			if (key.startsWith(`${name}/`)) this.workflowCache.delete(key);
		}
		// Same reasoning as the workflow cache: a removed environment's markers
		// must not decide what a re-added one shows.
		for (const key of this.historyExposedThisSession) {
			if (key.startsWith(`${HISTORY_EXPOSED_PREFIX}${name}::`)) {
				this.historyExposedThisSession.delete(key);
			}
		}
		this.invalidate();
	}

	addTenant(_env: string, _tenantId: string): void {
		this.invalidate();
	}

	removeTenant(env: string, tenantId: string): void {
		this.clearWorkflowCache(env, tenantId);
		this.historyExposedThisSession.delete(historyExposedStorageKey(env, tenantId));
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
			element instanceof WorkflowFetchActionNode ||
			element instanceof WorkflowRepoNode
		) {
			return this.workflowsFolderFor(element.environmentName, element.tenantId);
		}
		if (element instanceof WorkflowRepoGroupNode) {
			return this.workflowRepoNodeFor(element.environmentName, element.tenantId);
		}
		// A module node's parent is always its group — the module layer only ever
		// wraps a group's files, it never nests inside another module.
		if (element instanceof WorkflowRepoModuleNode) {
			return this.workflowRepoGroupFor(element.environmentName, element.tenantId, element.kind);
		}
		// Files hang off their kind's group, unless that group actually has the module
		// layer (2+ distinct modules) — in which case they hang off their module node
		// instead. `workflowRepoFileParent()` re-derives which shape applies from the
		// same cached lists `getChildren()` used to render it.
		if (element instanceof WorkflowRepoBpmnFileNode) {
			const files = this.getCachedWorkflowRepoFiles(element.environmentName, element.tenantId) ?? [];
			const mine = files.find(f => f.fileUri.toString() === element.fileUri.toString());
			return this.workflowRepoFileParent(
				element.environmentName,
				element.tenantId,
				'bpmn',
				files.map(f => f.moduleName),
				mine?.moduleName,
			);
		}
		if (element instanceof WorkflowRepoJavaFileNode) {
			const kind: WorkflowRepoGroupKind = element.source.kind === 'main' ? 'javaMain' : 'javaTest';
			const sources = this.getCachedWorkflowRepoJava(element.environmentName, element.tenantId, element.source.kind);
			return this.workflowRepoFileParent(
				element.environmentName,
				element.tenantId,
				kind,
				sources.map(s => s.moduleName),
				element.source.moduleName,
			);
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
				cached?.unregisteredJars,
			);
		}
		if (element instanceof UnregisteredJarsFolderNode) {
			const cached = this.workflowCache.get(`${element.environmentName}/${element.tenantId}`);
			return new JarDeploymentsFolderNode(
				element.environmentName,
				element.tenantId,
				cached?.jars ?? [],
				cached?.unregisteredJars,
			);
		}
		if (element instanceof UnregisteredJarNode) {
			const cached = this.workflowCache.get(`${element.environmentName}/${element.tenantId}`);
			return new UnregisteredJarsFolderNode(
				element.environmentName,
				element.tenantId,
				cached?.unregisteredJars ?? [],
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
		return new WorkflowsFolderNode(
			environmentName, tenantId, savedAdapterUrl, await this.hasWorkflowRepo(environmentName, tenantId),
		);
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
			return { drafts: [] as WorkflowDraft[], changed: new Set<string>(), downloaded: new Set<string>() };
		}
		const dir = this.environmentManager.getWorkflowDraftsDirectoryUri(environmentName, tenantId);
		const files = await listLocalBpmnFiles(dir);
		const drafts = files
			.filter(f => f.baselineText === undefined)
			// `localText` is already in hand from `listLocalBpmnFiles()`'s own read, so the name
			// comes free — no second file read the way `listWorkflowDrafts()` needs one.
			.map(f => ({
				processId: f.processId,
				fileUri: f.fileUri,
				fileName: bpmnFileName(f.processId),
				processName: extractProcessModel(f.localText).processName,
			}));
		const changed = new Set(files.filter(f => f.hasLocalChanges).map(f => f.processId));
		const downloaded = new Set(files.filter(f => f.baselineText !== undefined).map(f => f.processId));
		return { drafts, changed, downloaded };
	}

	/** Drafts on disk for one tenant; empty when the folder does not exist yet. */
	private async workflowDraftsFor(environmentName: string, tenantId: string) {
		return (await this.localBpmnStateFor(environmentName, tenantId)).drafts;
	}

	/**
	 * Rebuild the Custom Workflow Repository row for one tenant.
	 *
	 * Reads the sidecar directly (a small, tracked JSON file — cheap) rather than
	 * caching it, matching `workflowsFolderFor()`'s treatment of the Workflow
	 * Adapter URL just above. `trackedBpmnCount` does come from the cache: it is
	 * D5's network-backed computation (`refreshWorkflowRepoSyncState()` in
	 * `extension.ts`), not something this method can compute itself.
	 *
	 * Also where D10's reconciliation check re-runs "on tree refresh" (its other
	 * trigger, besides activation — see `extension.ts`'s activation-time sweep):
	 * a tenant bound to Git *after* its repository was already connected needs
	 * this to catch the resulting `.gitignore` gap on the next render, not only
	 * on the next window reload.
	 */
	private async workflowRepoNodeFor(environmentName: string, tenantId: string): Promise<WorkflowRepoNode> {
		if (!this.environmentManager) {
			return new WorkflowRepoNode(environmentName, tenantId, undefined, 0);
		}
		const repoConfigUri = this.environmentManager.getWorkflowRepoConfigUri(environmentName, tenantId);
		const read = await inspectWorkflowRepoConfig(repoConfigUri);
		const config = read.config;
		if (read.invalidReason) this.reportInvalidRepoConfigOnce(environmentName, tenantId, read.invalidReason);
		if (config) {
			await reconcileWorkflowRepoGitignore(
				this.environmentManager.getTenantRootUri(environmentName, tenantId),
				repoConfigUri,
			).catch(() => undefined);
			this.requestRepoDiscoveryOnce(environmentName, tenantId);
		} else {
			this.repoDiscoveryRequested.delete(`${environmentName}/${tenantId}`);
		}
		const trackedCount = this.getCachedWorkflowRepoTrackedCount(environmentName, tenantId) ?? 0;
		return new WorkflowRepoNode(
			environmentName,
			tenantId,
			config,
			trackedCount,
			this.getCachedWorkflowRepoJava(environmentName, tenantId, 'main').length,
			this.getCachedWorkflowRepoJava(environmentName, tenantId, 'test').length,
		);
	}

	/** One content group under the repository row, rebuilt for `getParent()`. */
	private workflowRepoGroupFor(
		environmentName: string,
		tenantId: string,
		kind: WorkflowRepoGroupKind,
	): WorkflowRepoGroupNode {
		const count =
			kind === 'bpmn'
				? (this.getCachedWorkflowRepoFiles(environmentName, tenantId) ?? []).length
				: this.getCachedWorkflowRepoJava(
						environmentName,
						tenantId,
						kind === 'javaMain' ? 'main' : 'test',
					).length;
		return new WorkflowRepoGroupNode(environmentName, tenantId, kind, count);
	}

	/**
	 * `WorkflowRepoGroupNode`'s children: the plain file rows, byte-for-byte what
	 * `getChildren()` rendered before module-grouping existed, when `items` spans at most
	 * one distinct Maven module — `0` (an empty group) or `1`, counting the `(no module)`
	 * bucket (`undefined`) as one distinct value like any named module. Otherwise, one
	 * `WorkflowRepoModuleNode` per distinct module, sorted alphabetically by name with the
	 * `(no module)` bucket forced last — it is a fallback bucket, not a real module, so it
	 * does not compete alphabetically with ones that are.
	 *
	 * This is the one place that decides whether the module layer exists for a group at
	 * all; `getParent()`'s file-node branches call `workflowRepoFileParent()` below, which
	 * re-derives the same decision from the same cached lists so a file's parent always
	 * matches whichever shape this method actually rendered.
	 */
	private moduleGroupedChildren<T>(
		environmentName: string,
		tenantId: string,
		kind: WorkflowRepoGroupKind,
		items: readonly T[],
		moduleNameOf: (item: T) => string | undefined,
		toFileNode: (item: T) => MultiTenantTreeElement,
	): MultiTenantTreeElement[] {
		const distinct = new Set(items.map(moduleNameOf));
		if (distinct.size <= 1) return items.map(toFileNode);

		const named = [...distinct]
			.filter((m): m is string => m !== undefined)
			.sort((a, b) => a.localeCompare(b));
		const order: (string | undefined)[] = distinct.has(undefined) ? [...named, undefined] : named;
		return order.map(
			moduleName => new WorkflowRepoModuleNode(
				environmentName,
				tenantId,
				kind,
				moduleName,
				items.filter(i => moduleNameOf(i) === moduleName).length,
			),
		);
	}

	/**
	 * A file row's parent: the `WorkflowRepoModuleNode` for its module when the group it
	 * belongs to actually has the module layer (2+ distinct modules, the same test
	 * `moduleGroupedChildren()` applies), or the group node directly when it doesn't — so
	 * `reveal()` always walks back up through whichever shape was actually rendered, not a
	 * shape that assumes the module layer is always present.
	 */
	private workflowRepoFileParent(
		environmentName: string,
		tenantId: string,
		kind: WorkflowRepoGroupKind,
		allModuleNames: readonly (string | undefined)[],
		thisFilesModule: string | undefined,
	): MultiTenantTreeElement {
		const distinct = new Set(allModuleNames);
		if (distinct.size <= 1) return this.workflowRepoGroupFor(environmentName, tenantId, kind);
		const count = allModuleNames.filter(m => m === thisFilesModule).length;
		return new WorkflowRepoModuleNode(environmentName, tenantId, kind, thisFilesModule, count);
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
		return this.historyExposedThisSession.has(historyExposedStorageKey(environmentName, tenantId));
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
					new WorkflowsFolderNode(
						element.environmentName,
						element.tenantId,
						savedAdapterUrl,
						await this.hasWorkflowRepo(element.environmentName, element.tenantId),
					),
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
			// The Custom Workflow Repository needs no Workflow Adapter URL and no
			// fetch — connect/disconnect/discovery all work before Workflows has ever
			// been loaded this session — so this row is independent of `cached` below.
			const repoRow = await this.workflowRepoNodeFor(element.environmentName, element.tenantId);
			const cached = this.workflowCache.get(`${element.environmentName}/${element.tenantId}`);
			// Only a fetch of the tenant's own lists counts as "loaded". A cache entry that exists
			// solely because the repository sync wrote into it is still "not fetched".
			if (cached === undefined || (cached.definitions === undefined && cached.jars === undefined)) {
				// URL saved but not yet loaded this session — show a fetch action row.
				const children: MultiTenantTreeElement[] = element.savedAdapterUrl !== undefined
					? [new WorkflowFetchActionNode(element.environmentName, element.tenantId)]
					: [];
				// Drafts before the repository row (see the full-children branch below for why),
				// and — like there — shown only when at least one exists.
				const drafts = await this.workflowDraftsFor(element.environmentName, element.tenantId);
				if (drafts.length > 0) {
					children.push(
						new WorkflowDraftsFolderNode(element.environmentName, element.tenantId, drafts),
					);
				}
				children.push(repoRow);
				return children;
			}
			const children: MultiTenantTreeElement[] = [];
			if (cached.definitions !== undefined) {
				children.push(
					new ProcessDefinitionsFolderNode(
						element.environmentName,
						element.tenantId,
						cached.definitions,
					),
				);
			}
			if (cached.jars !== undefined) {
				children.push(
					new JarDeploymentsFolderNode(
						element.environmentName,
						element.tenantId,
						cached.jars,
						cached.unregisteredJars,
					),
				);
			}
			// One half loaded, the other not: say so with the fetch row rather than a fake empty folder.
			if ((cached.definitions === undefined || cached.jars === undefined) && element.savedAdapterUrl !== undefined) {
				children.push(new WorkflowFetchActionNode(element.environmentName, element.tenantId));
			}
			// Drafts before the repository row: a Draft is a BPMN the user is still
			// shaping before it has anywhere permanent to live, so it reads as a smaller,
			// more provisional thing than a connected repository tracking real commits —
			// putting it last, below a whole repository, had it reading as the more
			// significant of the two. Appears only when at least one exists — same rule
			// as History.
			const drafts = await this.workflowDraftsFor(element.environmentName, element.tenantId);
			if (drafts.length > 0) {
				children.push(
					new WorkflowDraftsFolderNode(element.environmentName, element.tenantId, drafts),
				);
			}
			children.push(repoRow);
			return children;
		}
		if (element instanceof WorkflowDraftsFolderNode) {
			return element.drafts.map(
				d => new WorkflowDraftNode(element.environmentName, element.tenantId, d),
			);
		}
		if (element instanceof WorkflowRepoNode) {
			// Only reachable once `WorkflowRepoNode` is collapsible, i.e. connected with
			// at least one discovered file of some kind — see its constructor. An empty
			// group is omitted rather than shown as "(0)", the same rule Drafts follows:
			// the repository Reltio provisions has Java and no BPMN, so a permanent
			// `BPMN (0)` row would be the normal case rather than the exception.
			const { environmentName, tenantId } = element;
			const counts: readonly (readonly [WorkflowRepoGroupKind, number])[] = [
				['bpmn', (this.getCachedWorkflowRepoFiles(environmentName, tenantId) ?? []).length],
				['javaMain', this.getCachedWorkflowRepoJava(environmentName, tenantId, 'main').length],
				['javaTest', this.getCachedWorkflowRepoJava(environmentName, tenantId, 'test').length],
			];
			return counts
				.filter(([, count]) => count > 0)
				.map(([kind, count]) => new WorkflowRepoGroupNode(environmentName, tenantId, kind, count));
		}
		if (element instanceof WorkflowRepoGroupNode) {
			const { environmentName, tenantId, kind } = element;
			if (kind === 'bpmn') {
				const files = this.getCachedWorkflowRepoFiles(environmentName, tenantId) ?? [];
				return this.moduleGroupedChildren(
					environmentName,
					tenantId,
					'bpmn',
					files,
					f => f.moduleName,
					f => new WorkflowRepoBpmnFileNode(
						environmentName,
						tenantId,
						f.fileUri,
						f.processId,
						f.processName,
						this.getCachedRepoSyncState(environmentName, tenantId, f.processId),
					),
				);
			}
			const sources = this.getCachedWorkflowRepoJava(
				environmentName,
				tenantId,
				kind === 'javaMain' ? 'main' : 'test',
			);
			return this.moduleGroupedChildren(
				environmentName,
				tenantId,
				kind,
				sources,
				s => s.moduleName,
				source => new WorkflowRepoJavaFileNode(environmentName, tenantId, source),
			);
		}
		if (element instanceof WorkflowRepoModuleNode) {
			const { environmentName, tenantId, kind, moduleName } = element;
			if (kind === 'bpmn') {
				const files = (this.getCachedWorkflowRepoFiles(environmentName, tenantId) ?? [])
					.filter(f => f.moduleName === moduleName);
				return files.map(
					f => new WorkflowRepoBpmnFileNode(
						environmentName,
						tenantId,
						f.fileUri,
						f.processId,
						f.processName,
						this.getCachedRepoSyncState(environmentName, tenantId, f.processId),
					),
				);
			}
			const sources = this.getCachedWorkflowRepoJava(
				environmentName,
				tenantId,
				kind === 'javaMain' ? 'main' : 'test',
			).filter(s => s.moduleName === moduleName);
			return sources.map(
				source => new WorkflowRepoJavaFileNode(environmentName, tenantId, source),
			);
		}
		if (element instanceof ProcessDefinitionsFolderNode) {
			const { changed, downloaded } = await this.localBpmnStateFor(
				element.environmentName,
				element.tenantId,
			);
			return element.definitions.map(d => {
				// D5: a definition tracked by the connected Custom Workflow Repository
				// takes its `localState` from that comparison, taking priority over the
				// downloaded-copy comparison below — the repository, not a manually
				// fetched local copy, is this definition's source of truth once one exists.
				const repoState = this.getCachedRepoSyncState(
					element.environmentName, element.tenantId, d.type,
				);
				// Two different questions, two different inputs. `localState` is about the
				// DOWNLOADED copy and alone decides which actions the row offers (Deploy, Compare and
				// Discard all act on that copy). `repoState` is only what the badge says. Merging them
				// made a repo `changed` offer Deploy on a copy that had not changed (or did not exist),
				// and a repo `clean` hide real edits to a downloaded draft.
				return new ProcessDefinitionNode(
					element.environmentName,
					element.tenantId,
					d,
					changed.has(d.type) ? 'changed' : downloaded.has(d.type) ? 'clean' : 'none',
					repoState,
				);
			});
		}
		if (element instanceof JarDeploymentsFolderNode) {
			const children: MultiTenantTreeElement[] = element.deployments.map(
				d => new JarDeploymentNode(element.environmentName, element.tenantId, d),
			);
			if ((element.unregistered?.length ?? 0) > 0) {
				children.push(
					new UnregisteredJarsFolderNode(
						element.environmentName,
						element.tenantId,
						element.unregistered ?? [],
					),
				);
			}
			return children;
		}
		if (element instanceof UnregisteredJarsFolderNode) {
			return element.jars.map(
				j => new UnregisteredJarNode(element.environmentName, element.tenantId, j),
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
