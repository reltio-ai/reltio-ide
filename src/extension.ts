import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { MultiTenantTreeProvider } from './tree/multiTenantTreeProvider';
import { ConfigTreeItem } from './tree/treeNodes';
import { getConcreteEntityTypeUris } from './tree/configSubtree';
import { revealInEditor } from './commands/revealCommand';
import {
	addEntityType,
	addRelationType,
	addGroupingType,
	addGraphType,
	addHierarchyType,
	addInteractionType,
	addSource,
	insertAttribute,
	insertMatchGroup,
	insertSurvivorshipGroup,
	insertCleanseConfig,
	deleteNode,
	renameNode,
} from './commands/editCommands';
import { parseDocument } from './parser/configParser';
import { UriIndex } from './navigation/uriIndex';
import { ReltioDocumentLinkProvider } from './navigation/documentLinkProvider';
import { ReltioDefinitionProvider } from './navigation/definitionProvider';
import { ReltioReferenceProvider } from './navigation/referenceProvider';
import { DiagnosticsManager } from './navigation/diagnosticsManager';
import {
	BpmnDiagnosticsManager,
	bpmnProcessIdForDocument,
} from './workflow/bpmnDiagnosticsManager';
import { ReltioUriCompletionProvider } from './navigation/uriCompletionProvider';
import { OntologyPanelManager } from './ontology/ontologyPanel';
import { EnvironmentManager, type GitSource } from './workspace/environmentManager';
import {
	applyDefaultEnvironments,
	indexTokenFilesByCanonicalPath,
	readDefaultEnvironmentEntries,
	reloadTokenFileIntoStore,
	summarizeApplyResult,
} from './workspace/applyDefaultEnvironments';
import { TokenStore, GIT_SOURCE_TOKEN } from './api/tokenStore';
import { SessionStore } from './api/sessionStore';
import { OAuthCredentialsStore } from './api/oauthCredentialsStore';
import {
	UxStateBus,
	deriveUxState,
	l3FileUri,
	publishUxStateContext,
	publishWorkspaceSourceContext,
	type WorkspaceSource,
} from './ux/uxState';
import type { EState, TState } from './ux/uxState';
import { StatusBarController } from './ux/statusBar';
import { pushRecentHost, saveOpenedL3Files } from './ux/recents';
import { quickSwitchEnvironment } from './ux/quickSwitch';
import { launchSetupWizard } from './ux/setupWizard';
import { openSetupGuidePanel } from './ux/setupGuidePanel';
import { showEntityDetailPanel } from './entityBrowser/entityDetailPanel';
import { resolveOAuthCredentials } from './api/oauthCredentialsResolve';
import { runBrowserLogin, refreshTokens, OAuthLoginError } from './api/oauthLogin';
import { pathTenantLocFromL3Path } from './util/pathTenantLoc';
import { ensureTermsAccepted, resetTermsAcceptance } from './ux/termsOfUse';
import {
	validateEnvironment,
	listTenants,
	fetchL3Configuration,
	searchEntities,
	fetchConfigurationHistory,
	putL3Configuration,
	ReltioApiError,
	toHttpsBase,
	setTrustedHostSuffixes,
} from './api/reltioClient';
import { prettyPrintJsonIfPossible } from './api/formatJson';
import { tenantIdFromTreeContext } from './util/tenantIdFromTreeContext';
import {
	hasUnpublishedLocalChangesFromText,
	remoteMatchesBaseline,
	tryParseJson,
} from './util/fetchConfigurationGuard';
import { EnvironmentNode, TenantNode, HistoryFolderNode, HistorySnapshotNode } from './tree/multiTenantNodes';
import {
	WorkflowsFolderNode,
	WorkflowFetchActionNode,
	ProcessDefinitionsFolderNode,
	ProcessDefinitionNode,
	JarDeploymentsFolderNode,
	JarDeploymentNode,
	UnregisteredJarNode,
	jarModuleFileName,
	WorkflowDraftsFolderNode,
	WorkflowDraftNode,
	WorkflowRepoNode,
	WorkflowRepoBpmnFileNode,
} from './tree/workflowNodes';
import {
	listJarDeployments,
	listAvailableJars,
	registerJarDeployment,
	listProcessDefinitions,
	getProcessDefinitionXml,
	deployProcessDefinition,
	guessWorkflowAdapterUrl,
} from './api/workflowAdapterClient';
import { lookupWorkflowAdapterUrl } from './workflow/workflowAdapterRegistry';
import { classifyWorkflowError } from './workflow/workflowErrorReporting';
import { hasDiagramSection } from './workflow/bpmnModel';
import { withGeneratedDiagram } from './workflow/bpmnLayout';
import { BpmnPanelManager } from './workflow/bpmnPanel';
import type { ProcessDefinition, JarDeployment, AvailableJar, DeploymentResult } from './api/workflowAdapterClient';
import {
	loadWorkflowAdapterUrl,
	saveWorkflowAdapterUrl,
} from './workspace/workflowAdapterConfig';
import { BpmnContentProvider, BPMN_SCHEME } from './providers/bpmnContentProvider';
import {
	bpmnBaselineFileName,
	bpmnFileName,
	hasLocalBpmnChanges,
	listLocalBpmnFiles,
	readTextFile,
	remoteBpmnMatchesBaseline,
	writeBpmnFile,
} from './workspace/workflowBpmnFiles';
import {
	buildBpmnSkeleton,
	draftFileName,
	listWorkflowDrafts,
	processIdValidationMessage,
	resolveDraftContext,
	rewriteProcessIdentity,
	writeWorkflowDraft,
} from './workspace/workflowDrafts';
import {
	clearHistoryDirectory,
	immediateOlderSnapshot,
	listLocalHistorySnapshots,
	writeHistorySnapshot,
} from './workspace/configurationHistory';
import { syncReltioAgentAssets } from './workspace/reltioAgentSync';
import { registerReltioAutoSave } from './workspace/reltioAutoSave';
import {
	isGitRepo,
	findEnclosingGitRepository,
	getRemoteUrl,
	isGitRepoWithRemote,
	isFolderEmpty,
	isPathContainedIn,
	cloneRepository,
	GitNotFoundError,
} from './workspace/gitConfigSource';
import {
	readMultiGitSourceMarker,
	writeMultiGitSourceMarker,
	type MultiGitSourceMarker,
} from './workspace/gitSourceMarker';
import { isTenantConfigPath } from './workspace/tenantFolderStructure';
import {
	bindTenantToGit,
	createAndPublishBranch,
	disconnectFromGit,
	getCurrentBranch,
	hasUncommittedChanges,
	listRemoteBranches,
	switchToExistingBranch,
} from './workspace/tenantGitBinding';
import { ensureGitignoreEntries, ensureWorkspaceGitignored } from './workspace/gitSourceMarker';
import {
	hasMigrationBackup,
	migrateWorkspace,
	renderMigrationDetail,
	undoMigration,
} from './workspace/layoutMigration';
import {
	deleteWorkflowRepoConfig,
	loadWorkflowRepoConfig,
	saveWorkflowRepoConfig,
	storableRepoUrl,
	toOpenableHttpsUrl,
} from './workspace/workflowRepoConfig';
import { cloneUrlProblem, redactUrl } from './workspace/gitConfigSource';
import { clearGeneratedReadmeBeforeClone, restoreGeneratedReadme } from './workspace/workflowRepoConnect';
import { describeDeploy, planDeploy, type DeployPlan } from './workspace/workflowDeployPlan';
import { KeyedDebouncer } from './util/keyedDebouncer';
import { extractProcessModel } from './workflow/bpmnModel';
import {
	reconcileAllWorkflowRepoGitignores,
	reconcileWorkflowRepoGitignore,
} from './workspace/workflowRepoGitignore';
import { discoverBpmnFilesDetailed, resolveRepoBpmnContext } from './workspace/workflowRepoDiscovery';
import { discoverJavaSources } from './workspace/workflowRepoJavaDiscovery';
import { compareBpmnContent, type RepoSyncState } from './workspace/workflowRepoSync';

/** Remote shared by every tenant in a promotion flow; pre-fills the Connect to Git prompt. */
const LAST_GIT_REMOTE_KEY = 'reltio.lastGitRemote';
import {
	discoverL3Files,
	deriveTenantNamings,
	isParsableL3File,
	isBusinessConfigFile,
} from './workspace/l3Discovery';

const DEBOUNCE_MS = 300;
const RELTIO_SELECTOR: vscode.DocumentSelector = [
	{ pattern: '**/*.reltio.json' },
	{ pattern: '**/L3.json' },
	{ pattern: '**/BusinessConfig.json' },
];
const HISTORY_PAGE_SIZE = 10;
const ENTITY_BROWSER_PAGE_SIZE = 25;
const HISTORY_COMPARE_A_KEY = 'reltio.history.compareA.v1';
const RELTIO_FILTER_DOCS_URI = vscode.Uri.parse(
	'https://docs.reltio.com/en/developer-resources/entity-management-apis/entity-management-apis-at-a-glance/entities-api/get-entity/filtering-entities',
);
const RELTIO_FILTER_DOCS_BUTTON: vscode.QuickInputButton = {
	iconPath: new vscode.ThemeIcon('book'),
	tooltip: 'Open Reltio filter documentation',
};

function tenantLocFromSnapshotOrL3Uri(u: vscode.Uri): { environmentName: string; tenantId: string } | undefined {
	const parts = u.fsPath.split(/[/\\]/).filter(Boolean);
	const ti = parts.findIndex(p => p.endsWith('.reltio.tenant'));
	if (ti < 1) return undefined;
	const tenantSeg = parts[ti];
	const envSeg = parts[ti - 1];
	if (!envSeg?.endsWith('.reltio.environment')) return undefined;
	return {
		tenantId: tenantSeg.slice(0, -'.reltio.tenant'.length),
		environmentName: envSeg.slice(0, -'.reltio.environment'.length),
	};
}

function normalizeEnvironmentName(raw: string): string {
	const t = raw.trim();
	if (!t) return '';
	try {
		const withProto = t.includes('://') ? t : `https://${t}`;
		const u = new URL(withProto);
		return (u.hostname + (u.port ? `:${u.port}` : '')).toLowerCase();
	} catch {
		return t.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
	}
}

function getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
	return vscode.workspace.workspaceFolders?.[0];
}

function isReltioDocument(doc: vscode.TextDocument): boolean {
	if (doc.fileName.endsWith('.reltio.json')) return true;
	const base = doc.fileName.split(/[\/]/).pop()?.toLowerCase() ?? '';
	return base === 'l3.json' || base === 'businessconfig.json';
}

function getActiveReltioDocument(): vscode.TextDocument | undefined {
	const editor = vscode.window.activeTextEditor;
	if (editor && isReltioDocument(editor.document)) {
		return editor.document;
	}
	return undefined;
}

async function openL3DocumentForEntityRelationCommand(
	item: ConfigTreeItem | TenantNode | undefined,
	environmentManager: EnvironmentManager | null,
): Promise<vscode.TextDocument | undefined> {
	if (item instanceof ConfigTreeItem && item.tenantL3Uri) {
		return vscode.workspace.openTextDocument(item.tenantL3Uri);
	}
	if (item instanceof TenantNode && item.hasL3 && environmentManager) {
		const uri = environmentManager.getL3Uri(item.environmentName, item.tenantId);
		return vscode.workspace.openTextDocument(uri);
	}
	return getActiveReltioDocument();
}

async function openL3DocumentForTreeItem(item: ConfigTreeItem): Promise<vscode.TextDocument | undefined> {
	if (item.tenantL3Uri) {
		return vscode.workspace.openTextDocument(item.tenantL3Uri);
	}
	return getActiveReltioDocument();
}

function getValueAtPath(root: unknown, pathParts: (string | number)[]): unknown {
	let current = root;
	for (const part of pathParts) {
		if (current == null || typeof current !== 'object') return undefined;
		current = (current as Record<string, unknown>)[String(part)];
	}
	return current;
}

function entityTypePathFromBrowserItem(item: ConfigTreeItem): (string | number)[] {
	return item.jsonPath;
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

function readStringProperty(value: unknown, key: string): string | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const candidate = (value as Record<string, unknown>)[key];
	return typeof candidate === 'string' ? candidate : undefined;
}

function entityQuickPickLabel(entity: unknown): Pick<vscode.QuickPickItem, 'label' | 'description' | 'detail'> {
	const uri = readStringProperty(entity, 'uri');
	const label = readStringProperty(entity, 'label') || uri?.split('/').pop() || '(entity)';
	const type = readStringProperty(entity, 'type');
	const updatedTime = readStringProperty(entity, 'updatedTime');
	return {
		label,
		description: uri,
		detail: [type, updatedTime ? `updated ${updatedTime}` : undefined].filter(Boolean).join('  '),
	};
}

function promptForEntityFilter(title: string): Promise<string | undefined> {
	return new Promise(resolve => {
		const input = vscode.window.createInputBox();
		let done = false;
		const disposables: vscode.Disposable[] = [];
		const finish = (value: string | undefined): void => {
			if (done) return;
			done = true;
			for (const disposable of disposables) {
				disposable.dispose();
			}
			input.dispose();
			resolve(value);
		};

		input.title = title;
		input.prompt = 'Optional Reltio filter to combine with the selected entity type. Use the book button for filter syntax.';
		input.placeholder = 'exists(attributes.FirstName)';
		input.buttons = [RELTIO_FILTER_DOCS_BUTTON];

		disposables.push(
			input.onDidAccept(() => finish(input.value)),
			input.onDidHide(() => finish(undefined)),
			input.onDidTriggerButton(button => {
				if (button === RELTIO_FILTER_DOCS_BUTTON) {
					void vscode.env.openExternal(RELTIO_FILTER_DOCS_URI);
				}
			}),
		);

		input.show();
	});
}

/**
 * Names every discovered config in one pass so folder rows, leaf names, and the
 * uniqueness qualifiers stay consistent no matter which flow produced the list.
 */
function buildGitSources(root: vscode.Uri, l3Uris: vscode.Uri[]): GitSource[] {
	const namings = deriveTenantNamings(root, l3Uris);
	return l3Uris.map((l3Uri, i) => ({ ...namings[i], l3Uri }));
}

async function tryRestoreGitSource(
	environmentManager: EnvironmentManager,
	tokenStore: TokenStore,
	workspaceRoot: vscode.Uri,
): Promise<boolean> {
	const multiMarker = await readMultiGitSourceMarker(workspaceRoot);
	if (!multiMarker || multiMarker.sources.length === 0) return false;
	if (!(await isGitRepo(workspaceRoot))) return false;

	const validUris: vscode.Uri[] = [];
	for (const marker of multiMarker.sources) {
		const l3Uri = vscode.Uri.joinPath(workspaceRoot, marker.l3RelativePath);
		if (!isPathContainedIn(workspaceRoot, l3Uri)) continue;
		try {
			await vscode.workspace.fs.stat(l3Uri);
		} catch {
			continue;
		}
		if (!(await isParsableL3File(l3Uri))) continue;
		validUris.push(l3Uri);
	}

	// Re-derive rather than trusting the marker's stored ids: a dropped or added file changes
	// which names are unique, and markers written by older builds hold dotted ids.
	const validSources = buildGitSources(workspaceRoot, validUris);
	if (validSources.length === 0) return false;
	environmentManager.setGitSources(validSources);
	// Set token once for the environment (not per tenant)
	if (validSources.length > 0) {
		tokenStore.setToken(validSources[0].environmentName, GIT_SOURCE_TOKEN);
	}
	return true;
}

/** Reads `reltio.trustedHostSuffixes` and applies it to `reltioClient`'s host allowlist. */
function applyTrustedHostSuffixes(): void {
	const suffixes = vscode.workspace
		.getConfiguration('reltio')
		.get<string[]>('trustedHostSuffixes', ['reltio.com']);
	setTrustedHostSuffixes(suffixes);
}

const CREATE_BRANCH_ITEM = '$(add) Create a new branch…';

/**
 * Asks which branch this tenant should sit on.
 *
 * Existing remote branches are offered as a pick list, because a branch name is something the
 * team already agreed on and recalling it exactly is needless friction. Creating a new one stays
 * available as free text, since the first tenant in a promotion flow has nothing to pick from.
 *
 * A remote with no branches, or one that could not be listed, falls straight through to free text
 * rather than showing an empty picker.
 */
async function pickBranch(
	tenantId: string,
	remoteBranches: string[],
	listFailed: boolean,
	currentBranch?: string,
): Promise<string | undefined> {
	const askFreeText = async (prompt: string): Promise<string | undefined> => {
		const typed = await vscode.window.showInputBox({
			title: 'Connect to Git',
			prompt,
			placeHolder: 'dev',
			ignoreFocusOut: true,
			validateInput: value => {
				const name = value.trim();
				if (!name) return 'Enter a branch name.';
				// Cheap guard against the names git will reject outright.
				if (/[~^:?*[\\\s]/.test(name) || name.startsWith('-') || name.endsWith('.lock')) {
					return 'Not a valid Git branch name.';
				}
				return undefined;
			},
		});
		return typed?.trim() || undefined;
	};

	if (listFailed) {
		return askFreeText(`Branch for tenant "${tenantId}" (could not read the remote's branches)`);
	}
	if (remoteBranches.length === 0) {
		return askFreeText(
			currentBranch
				? `New branch for tenant "${tenantId}" (no other branches on origin)`
				: `Branch for tenant "${tenantId}" (the remote has no branches yet)`,
		);
	}

	const picked = await vscode.window.showQuickPick(
		[
			...remoteBranches.map(name => ({ label: name, description: 'existing branch on origin' })),
			{
				label: CREATE_BRANCH_ITEM,
				description: currentBranch
					? `branch off "${currentBranch}", keeping your changes`
					: 'type a new name',
			},
		],
		{
			title: currentBranch ? `Connect to a New Branch (on "${currentBranch}")` : 'Connect to Git',
			placeHolder: `Branch for tenant "${tenantId}"`,
			ignoreFocusOut: true,
		},
	);
	if (!picked) return undefined;
	if (picked.label !== CREATE_BRANCH_ITEM) return picked.label;
	return askFreeText(`New branch for tenant "${tenantId}"`);
}

/** Explains the enclosing-repository problem and the two ways out of it. */
function renderEnclosingRepositoryHelp(enclosing: vscode.Uri, workspaceRoot: vscode.Uri): string {
	return [
		'# Git repository above your tenant folders',
		'',
		`A repository exists at \`${enclosing.fsPath}\`.`,
		`Your workspace is \`${workspaceRoot.fsPath}\`.`,
		'',
		'## Why this matters',
		'',
		'Reltio IDE makes each **tenant folder** its own repository. That is what keeps the',
		'environment host and tenant ID out of every tracked path, so the same configuration',
		'pushed for a Dev tenant and a Prod tenant lands at identical paths and the branches can',
		'be diffed and merged.',
		'',
		'A repository rooted above the tenants breaks that in one of two ways:',
		'',
		'| Situation | What happens |',
		'|---|---|',
		'| Tenants not yet connected to Git | Everything is tracked by the outer repository, so paths become `dev/<tenantId>/Business Config/BusinessConfig.json`. Branches can no longer be compared. |',
		'| A tenant is connected to Git | The outer repository stores the tenant as a *gitlink* (mode 160000): a commit pointer, not the files. Cloning the outer repository gives an empty tenant folder. |',
		'',
		'## Recommended',
		'',
		'Remove the outer repository and connect each tenant individually:',
		'',
		'```',
		`rm -rf "${enclosing.fsPath}/.git"`,
		'```',
		'',
		'Then run **Connect to Git** on each tenant row.',
		'',
		'## If you want to keep the outer repository',
		'',
		'Use **Ignore Tenant Folders** on the warning. That adds each environment folder to the',
		'outer `.gitignore`, so it stops tracking tenant content while each tenant stays free to be',
		'its own repository. Files it already tracks remain tracked until you untrack them:',
		'',
		'```',
		'git rm -r --cached <environment-folder>',
		'```',
		'',
		'Extension-managed state (`.reltio/`, `.reltio-ide/`, `.reltio-ide-backup/` and the marker',
		'files) is already excluded by the workspace-root `.gitignore` the extension maintains.',
	].join('\n');
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	applyTrustedHostSuffixes();
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('reltio.trustedHostSuffixes')) {
				applyTrustedHostSuffixes();
			}
		}),
	);

	const folder = getWorkspaceFolder();
	const environmentManager = folder ? new EnvironmentManager(folder.uri) : null;
	const tokenStore = new TokenStore();
	const sessionStore = new SessionStore(context.secrets, context.globalState);
	const oauthCredentialsStore = new OAuthCredentialsStore(context.secrets);
	const uxMode = vscode.workspace.getConfiguration('reltio').get<string>('uxMode', 'default');
	const isClassic = uxMode === 'classic';

	const uxBus = new UxStateBus();
	context.subscriptions.push({ dispose: () => uxBus.dispose() });

	let workspaceSource: WorkspaceSource = undefined;
	let fetchConfigFromGitInFlight = false;
	let agentAssetsSynced = false;
	/** Deferred until a mode (tenant or git) is actually chosen — syncing eagerly would create `.reltio/`
	 *  before the user decides, which made a freshly-opened folder look non-empty to `reltio.fetchConfigFromGit`. */
	function ensureAgentAssetsSynced(): void {
		if (agentAssetsSynced) return;
		agentAssetsSynced = true;
		void syncReltioAgentAssets(context).catch(err => {
			console.error('Reltio agent asset sync failed:', err);
		});
	}
	function setWorkspaceSource(source: WorkspaceSource): void {
		workspaceSource = source;
		void publishWorkspaceSourceContext(workspaceSource);
		if (source !== undefined) {
			ensureAgentAssetsSynced();
		}
	}

	/**
	 * Moves any tenant still on the legacy flat layout onto the component tree.
	 *
	 * Automatic and unprompted by design, so a team never ends up running two layouts side by
	 * side. The safety comes from the migration itself: a backup before the first move, a stamp
	 * written only on full success, and a refusal on a dirty worktree.
	 */
	async function runLayoutMigration(em: EnvironmentManager, workspaceRoot: vscode.Uri): Promise<void> {
		let report;
		try {
			report = await migrateWorkspace(workspaceRoot, em, context.workspaceState);
		} catch (e) {
			console.error('Reltio layout migration failed:', e);
			return;
		}
		if (
			report.migrated.length === 0 &&
			report.skipped.length === 0 &&
			report.renamedFolders.length === 0 &&
			report.prunedFolders.length === 0
		) return;

		treeProvider.refresh();
		uxBus.fire();

		const parts: string[] = [];
		if (report.migrated.length > 0) {
			parts.push(`${report.migrated.length} tenant(s) migrated to the Git-ready folder structure`);
		}
		if (report.renamedFolders.length > 0) {
			parts.push(`${report.renamedFolders.length} folder(s) renamed`);
		}
		if (report.prunedFolders.length > 0) {
			parts.push(`${report.prunedFolders.length} unused folder(s) removed`);
		}
		if (report.skipped.length > 0) {
			parts.push(`${report.skipped.length} skipped`);
		}
		const choice = await vscode.window.showInformationMessage(parts.join(', ') + '.', 'Show details');
		if (choice === 'Show details') {
			const doc = await vscode.workspace.openTextDocument({
				content: renderMigrationDetail(report),
				language: 'plaintext',
			});
			await vscode.window.showTextDocument(doc, { preview: true });
		}
	}

	const ENCLOSING_REPO_DISMISSED_KEY = 'reltio.enclosingRepoWarningDismissed';

	/**
	 * Warns when a Git repository sits at or above the workspace root.
	 *
	 * Each tenant folder is meant to be its own repository. One rooted higher up either pulls the
	 * environment and tenant names back into every tracked path, which is precisely what this
	 * layout exists to avoid, or swallows a bound tenant as a gitlink whose contents it does not
	 * store. The extension cannot prevent `git init`, so it reports the situation and offers a fix.
	 */
	async function warnAboutEnclosingRepository(
		em: EnvironmentManager,
		workspaceRoot: vscode.Uri,
	): Promise<void> {
		if (context.workspaceState.get<boolean>(ENCLOSING_REPO_DISMISSED_KEY, false)) return;

		const enclosing = await findEnclosingGitRepository(workspaceRoot);
		if (!enclosing) return;

		const where =
			enclosing.fsPath === workspaceRoot.fsPath
				? 'this workspace folder'
				: `a parent folder (${enclosing.fsPath})`;
		const choice = await vscode.window.showWarningMessage(
			`A Git repository exists at ${where}. Reltio IDE expects each tenant folder to be its own repository, so tracked paths carry no environment or tenant name. A repository above them undoes that.`,
			'Ignore Tenant Folders',
			'Show Details',
			'Don\'t Show Again',
		);

		if (choice === 'Don\'t Show Again') {
			await context.workspaceState.update(ENCLOSING_REPO_DISMISSED_KEY, true);
			return;
		}
		if (choice === 'Show Details') {
			const doc = await vscode.workspace.openTextDocument({
				content: renderEnclosingRepositoryHelp(enclosing, workspaceRoot),
				language: 'markdown',
			});
			await vscode.window.showTextDocument(doc, { preview: true });
			return;
		}
		if (choice === 'Ignore Tenant Folders') {
			// Excludes the environment folders from the enclosing repository, so it stops tracking
			// tenant content while each tenant folder stays free to be its own repository.
			const envs = await em.scanEnvironments();
			const entries = envs
				.map(e => em.environmentFolderNameFor(e.name))
				.filter((n): n is string => !!n)
				.map(n => [`${n}/`, [n]] as const);
			if (entries.length === 0) {
				void vscode.window.showInformationMessage('No environment folders to ignore yet.');
				return;
			}
			await ensureGitignoreEntries(enclosing, entries);
			void vscode.window.showInformationMessage(
				`Added ${entries.length} environment folder(s) to ${enclosing.fsPath}\\.gitignore. Already-tracked files stay tracked until you run: git rm -r --cached <folder>`,
			);
		}
	}

	if (environmentManager && folder) {
		const realEnvs = await environmentManager.scanEnvironments();
		if (realEnvs.length > 0) {
			setWorkspaceSource('tenant');
			// Off the activation critical path: the window stays responsive and the tree refreshes
			// when this finishes. Only runs in tenant mode — a git-sourced workspace has no tenant
			// folders of ours to migrate.
			void runLayoutMigration(environmentManager, folder.uri).then(async () => {
				if (!environmentManager || !folder) return;
				// Safety net first: a repository rooted above the tenants must not sweep in synced
				// agent assets, the migration backup or the environment marker.
				await ensureWorkspaceGitignored(folder.uri).catch(() => undefined);
				await warnAboutEnclosingRepository(environmentManager, folder.uri).catch(() => undefined);
				// D10: the mirror-image hazard, one level down — catches a tenant that was bound
				// to Git in a session (or by a teammate) after its Custom Workflow Repository was
				// already connected. Also re-run per-tenant on tree refresh; see `getChildren()`.
				await reconcileAllWorkflowRepoGitignores(environmentManager).catch(() => undefined);
			});
		} else if (await tryRestoreGitSource(environmentManager, tokenStore, folder.uri)) {
			setWorkspaceSource('git');
		} else {
			setWorkspaceSource(undefined);
		}
	}

	const statusBar = isClassic ? null : new StatusBarController();
	if (statusBar) context.subscriptions.push({ dispose: () => statusBar.dispose() });

	/** Normalize legacy relative paths (root or `.reltio/`) to logical l3FileUri keys. */
	function logicalOpenedL3Key(pathOrKey: string): string {
		// Folder names no longer encode identity, so prefer the manager's scan-built reverse index
		// and fall back to parsing legacy suffixed paths.
		const loc =
			environmentManager?.locFromPath(pathOrKey) ?? pathTenantLocFromL3Path(pathOrKey);
		return loc ? l3FileUri(loc.environmentName, loc.tenantId) : pathOrKey;
	}

	// In-memory set of L3 logical keys the user has opened at least once.
	// Persisted via workspaceState — see Task 4.5.
	const openedL3Files = new Set<string>(
		(context.workspaceState.get<string[]>('reltio.openedL3Files', [])).map(logicalOpenedL3Key),
	);

	async function refreshUxState(): Promise<void> {
		if (!environmentManager) return;
		if (workspaceSource !== 'git') {
			const currentEnvs = await environmentManager.scanEnvironments();
			if (currentEnvs.length > 0) {
				if (workspaceSource !== 'tenant') {
					setWorkspaceSource('tenant');
				}
			} else if (workspaceSource === 'tenant') {
				// The environments are gone (user deleted them). Without this the flag stays
				// latched at 'tenant' for the rest of the session and blocks Connect your Repository.
				setWorkspaceSource(undefined);
			}
		}
		if (isClassic) {
			const environments = await environmentManager.scanEnvironments();
			const perEnv = new Map<string, EState>();
			const perTenant = new Map<string, TState>();
			let tenantCount = 0;
			for (const env of environments) {
				perEnv.set(env.name, 'E_READY');
				for (const t of env.tenants) {
					perTenant.set(`${env.name}/${t.tenantId}`, 'T_READY');
					tenantCount++;
				}
			}
			await vscode.commands.executeCommand('setContext', 'reltio.uxState', 'G_READY');
			await vscode.commands.executeCommand('setContext', 'reltio.envHasNoTenants', false);
			treeProvider.setUxState({
				global: 'G_READY',
				perEnv,
				perTenant,
				envCount: environments.length,
				tenantCount,
			});
			return;
		}
		const environments = await environmentManager.scanEnvironments();
		const state = await deriveUxState({
			environments,
			hasToken: env => tokenStore.hasToken(env),
			getToken: env => tokenStore.getToken(env),
			hasOAuthClient: env => oauthCredentialsStore.hasClientCredentials(env),
			openedL3Files,
		});
		if (workspaceSource === 'git') {
			// The "opened" bookkeeping key is built from the tenant-mode folder convention and never matches
			// a git-sourced L3's real path, so this would otherwise perpetually show "Open L3 to start editing".
			// A git-sourced tenant's config already exists on disk — there's no "not yet opened" state for it.
			for (const key of state.perTenant.keys()) {
				state.perTenant.set(key, 'T_READY');
			}
		}
		await publishUxStateContext(state);
		treeProvider.setUxState(state);
		statusBar?.render(state, !!folder);
	}

	const treeProvider = new MultiTenantTreeProvider(
		environmentManager,
		tokenStore,
		context.workspaceState,
		oauthCredentialsStore,
	);
	const historyFetchLocks = new Set<string>();
	const uriIndex = new UriIndex();
	const linkProvider = new ReltioDocumentLinkProvider();
	const defProvider = new ReltioDefinitionProvider();
	const refProvider = new ReltioReferenceProvider();
	const diagnosticsManager = new DiagnosticsManager();
	const bpmnDiagnosticsManager = new BpmnDiagnosticsManager();
	const uriCompletionProvider = new ReltioUriCompletionProvider();
	const ontologyManager = new OntologyPanelManager();
	const bpmnManager = new BpmnPanelManager();
	context.subscriptions.push({ dispose: () => bpmnManager.dispose() });

	const treeView = vscode.window.createTreeView('reltioConfigTree', {
		treeDataProvider: treeProvider,
		showCollapseAll: true,
	});
	context.subscriptions.push(treeView);

	registerReltioAutoSave(context);

	context.subscriptions.push(
		vscode.commands.registerCommand('reltio.resyncAgentAssets', async () => {
			try {
				await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: 'Resyncing Reltio agent assets…',
					},
					() => syncReltioAgentAssets(context, { force: true }),
				);
				void vscode.window.showInformationMessage(
					'Reltio agent skills and Velocity Packs were refreshed under .reltio/reltio-agent/ (workspace overrides were not changed).',
				);
			} catch (e) {
				void vscode.window.showErrorMessage(`Resync failed: ${(e as Error).message}`);
			}
		}),
	);

	context.subscriptions.push(
		vscode.languages.registerDocumentLinkProvider(RELTIO_SELECTOR, linkProvider),
		vscode.languages.registerDefinitionProvider(RELTIO_SELECTOR, defProvider),
		vscode.languages.registerReferenceProvider(RELTIO_SELECTOR, refProvider),
		vscode.languages.registerCompletionItemProvider(RELTIO_SELECTOR, uriCompletionProvider, '"', '/'),
		diagnosticsManager,
		bpmnDiagnosticsManager,
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('reltio.showOntologyPreview', () => {
			const doc = getActiveReltioDocument();
			if (!doc) return;
			void ontologyManager.showPreview(doc, context.extensionUri);
		}),
		vscode.commands.registerCommand('reltio.resetOntologyLayout', () => {
			const doc = getActiveReltioDocument();
			if (!doc) return;
			void ontologyManager.showPreview(doc, context.extensionUri);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('reltio.revealInEditor', async (item?: ConfigTreeItem) => {
			if (!item || !(item instanceof ConfigTreeItem)) return;
			let doc: vscode.TextDocument;
			if (item.tenantL3Uri) {
				doc = await vscode.workspace.openTextDocument(item.tenantL3Uri);
			} else {
				const active = getActiveReltioDocument();
				if (!active) {
					void vscode.window.showErrorMessage('Open a *.reltio.json file or expand a tenant with L3 to use this command.');
					return;
				}
				doc = active;
			}
			const { ast } = parseDocument(doc.getText());
			const targetUri = item.tenantL3Uri ?? doc.uri;
			await revealInEditor(item, ast, targetUri);
		}),
		vscode.commands.registerCommand('reltio.showOntologyFromTree', async (item?: ConfigTreeItem) => {
			if (!item || !(item instanceof ConfigTreeItem)) return;
			if (!item.tenantL3Uri) {
				void vscode.window.showErrorMessage('This node is not under a tenant L3 file.');
				return;
			}
			const doc = await vscode.workspace.openTextDocument(item.tenantL3Uri);
			await ontologyManager.showPreview(doc, context.extensionUri);
		}),
		vscode.commands.registerCommand('reltio.revealInTreeView', async (nodeId: string) => {
			const found = await treeProvider.findEntityTypeItem(nodeId);
			if (found) {
				await treeView.reveal(found, { select: true, focus: true, expand: true });
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'reltio.addEntityType',
			async (item?: ConfigTreeItem | TenantNode) => {
				const doc = await openL3DocumentForEntityRelationCommand(item, environmentManager);
				if (!doc) {
					void vscode.window.showWarningMessage(
						'Open a *.reltio.json file or right‑click the tenant (with L3), Entity Types, or Relation Types in the tree.',
					);
					return;
				}
				await vscode.window.showTextDocument(doc, { preview: false });
				const { ast } = parseDocument(doc.getText());
				void addEntityType(doc.uri, ast).then(ok => {
					if (ok) void treeProvider.refresh();
				});
			},
		),
		vscode.commands.registerCommand(
			'reltio.addRelationType',
			async (item?: ConfigTreeItem | TenantNode) => {
				const doc = await openL3DocumentForEntityRelationCommand(item, environmentManager);
				if (!doc) {
					void vscode.window.showWarningMessage(
						'Open a *.reltio.json file or right‑click the tenant (with L3), Entity Types, or Relation Types in the tree.',
					);
					return;
				}
				await vscode.window.showTextDocument(doc, { preview: false });
				const { ast } = parseDocument(doc.getText());
				void addRelationType(doc.uri, ast).then(ok => {
					if (ok) void treeProvider.refresh();
				});
			},
		),
		vscode.commands.registerCommand('reltio.insertSimpleAttribute', async (item: ConfigTreeItem) => {
			const doc = await openL3DocumentForTreeItem(item);
			if (!doc) {
				void vscode.window.showWarningMessage('Open a *.reltio.json file or expand a tenant with L3.');
				return;
			}
			await vscode.window.showTextDocument(doc, { preview: false });
			const { ast } = parseDocument(doc.getText());
			void insertAttribute(item, doc.uri, ast, 'String').then(ok => {
				if (ok) void treeProvider.refresh();
			});
		}),
		vscode.commands.registerCommand('reltio.insertNestedAttribute', async (item: ConfigTreeItem) => {
			const doc = await openL3DocumentForTreeItem(item);
			if (!doc) {
				void vscode.window.showWarningMessage('Open a *.reltio.json file or expand a tenant with L3.');
				return;
			}
			await vscode.window.showTextDocument(doc, { preview: false });
			const { ast } = parseDocument(doc.getText());
			void insertAttribute(item, doc.uri, ast, 'Nested').then(ok => {
				if (ok) void treeProvider.refresh();
			});
		}),
		vscode.commands.registerCommand('reltio.insertReferenceAttribute', async (item: ConfigTreeItem) => {
			const doc = await openL3DocumentForTreeItem(item);
			if (!doc) {
				void vscode.window.showWarningMessage('Open a *.reltio.json file or expand a tenant with L3.');
				return;
			}
			await vscode.window.showTextDocument(doc, { preview: false });
			const { ast } = parseDocument(doc.getText());
			void insertAttribute(item, doc.uri, ast, 'Reference').then(ok => {
				if (ok) void treeProvider.refresh();
			});
		}),
		vscode.commands.registerCommand('reltio.insertMatchGroup', async (item: ConfigTreeItem) => {
			const doc = await openL3DocumentForTreeItem(item);
			if (!doc) {
				void vscode.window.showWarningMessage('Open a *.reltio.json file or expand a tenant with L3.');
				return;
			}
			await vscode.window.showTextDocument(doc, { preview: false });
			const { ast } = parseDocument(doc.getText());
			void insertMatchGroup(item, doc.uri, ast).then(ok => {
				if (ok) void treeProvider.refresh();
			});
		}),
		vscode.commands.registerCommand('reltio.insertSurvivorshipGroup', async (item: ConfigTreeItem) => {
			const doc = await openL3DocumentForTreeItem(item);
			if (!doc) {
				void vscode.window.showWarningMessage('Open a *.reltio.json file or expand a tenant with L3.');
				return;
			}
			await vscode.window.showTextDocument(doc, { preview: false });
			const { ast } = parseDocument(doc.getText());
			void insertSurvivorshipGroup(item, doc.uri, ast).then(ok => {
				if (ok) void treeProvider.refresh();
			});
		}),
		vscode.commands.registerCommand('reltio.insertCleanseConfig', async (item: ConfigTreeItem) => {
			const doc = await openL3DocumentForTreeItem(item);
			if (!doc) {
				void vscode.window.showWarningMessage('Open a *.reltio.json file or expand a tenant with L3.');
				return;
			}
			await vscode.window.showTextDocument(doc, { preview: false });
			const { ast } = parseDocument(doc.getText());
			void insertCleanseConfig(item, doc.uri, ast).then(ok => {
				if (ok) void treeProvider.refresh();
			});
		}),
		vscode.commands.registerCommand(
			'reltio.insertGroupingType',
			async (item?: ConfigTreeItem | TenantNode) => {
				const doc = await openL3DocumentForEntityRelationCommand(item, environmentManager);
				if (!doc) {
					void vscode.window.showWarningMessage(
						'Open a *.reltio.json file or right‑click a tenant with L3.',
					);
					return;
				}
				await vscode.window.showTextDocument(doc, { preview: false });
				const { ast } = parseDocument(doc.getText());
				void addGroupingType(doc.uri, ast).then(ok => {
					if (ok) void treeProvider.refresh();
				});
			},
		),
		vscode.commands.registerCommand(
			'reltio.insertGraphType',
			async (item?: ConfigTreeItem | TenantNode) => {
				const doc = await openL3DocumentForEntityRelationCommand(item, environmentManager);
				if (!doc) {
					void vscode.window.showWarningMessage(
						'Open a *.reltio.json file or right‑click a tenant with L3.',
					);
					return;
				}
				await vscode.window.showTextDocument(doc, { preview: false });
				const { ast } = parseDocument(doc.getText());
				void addGraphType(doc.uri, ast).then(ok => {
					if (ok) void treeProvider.refresh();
				});
			},
		),
		vscode.commands.registerCommand(
			'reltio.insertInteractionType',
			async (item?: ConfigTreeItem | TenantNode) => {
				const doc = await openL3DocumentForEntityRelationCommand(item, environmentManager);
				if (!doc) {
					void vscode.window.showWarningMessage(
						'Open a *.reltio.json file or right‑click a tenant with L3.',
					);
					return;
				}
				await vscode.window.showTextDocument(doc, { preview: false });
				const { ast } = parseDocument(doc.getText());
				void addInteractionType(doc.uri, ast).then(ok => {
					if (ok) void treeProvider.refresh();
				});
			},
		),
		vscode.commands.registerCommand(
			'reltio.insertSource',
			async (item?: ConfigTreeItem | TenantNode) => {
				const doc = await openL3DocumentForEntityRelationCommand(item, environmentManager);
				if (!doc) {
					void vscode.window.showWarningMessage(
						'Open a *.reltio.json file or right‑click a tenant with L3.',
					);
					return;
				}
				await vscode.window.showTextDocument(doc, { preview: false });
				const { ast } = parseDocument(doc.getText());
				void addSource(doc.uri, ast).then(ok => {
					if (ok) void treeProvider.refresh();
				});
			},
		),
		vscode.commands.registerCommand(
			'reltio.insertHierarchyType',
			async (item?: ConfigTreeItem | TenantNode) => {
				const doc = await openL3DocumentForEntityRelationCommand(item, environmentManager);
				if (!doc) {
					void vscode.window.showWarningMessage(
						'Open a *.reltio.json file or right‑click a tenant with L3.',
					);
					return;
				}
				await vscode.window.showTextDocument(doc, { preview: false });
				const { ast } = parseDocument(doc.getText());
				void addHierarchyType(doc.uri, ast).then(ok => {
					if (ok) void treeProvider.refresh();
				});
			},
		),
		vscode.commands.registerCommand('reltio.deleteNode', async (item: ConfigTreeItem) => {
			const doc = await openL3DocumentForTreeItem(item);
			if (!doc) {
				void vscode.window.showWarningMessage('Open a *.reltio.json file or expand a tenant with L3.');
				return;
			}
			await vscode.window.showTextDocument(doc, { preview: false });
			const { ast } = parseDocument(doc.getText());
			void deleteNode(item, doc.uri, ast).then(ok => {
				if (ok) void treeProvider.refresh();
			});
		}),
		vscode.commands.registerCommand('reltio.renameNode', async (item: ConfigTreeItem) => {
			const doc = await openL3DocumentForTreeItem(item);
			if (!doc) {
				void vscode.window.showWarningMessage('Open a *.reltio.json file or expand a tenant with L3.');
				return;
			}
			await vscode.window.showTextDocument(doc, { preview: false });
			const { ast } = parseDocument(doc.getText());
			void renameNode(item, doc.uri, ast).then(ok => { if (ok) treeProvider.refresh(); });
		}),
	);

	async function tryRefresh(environmentName: string): Promise<boolean> {
		const inFlight = tokenStore.getRefreshInFlight(environmentName);
		if (inFlight) return inFlight;

		const rt = tokenStore.getRefreshToken(environmentName);
		if (!rt) return false;

		const envNames = environmentManager
			? (await environmentManager.scanEnvironments()).map(e => e.name)
			: [environmentName];
		const credentials = await resolveOAuthCredentials(
			oauthCredentialsStore,
			environmentName,
			envNames,
		);
		if (!credentials) {
			tokenStore.clearSession(environmentName);
			await sessionStore.deleteRefreshToken(environmentName);
			return false;
		}

		const promise = (async () => {
			try {
				const session = await refreshTokens(rt, credentials);
				tokenStore.setSession(environmentName, session);
				await sessionStore.saveRefreshToken(environmentName, session.refreshToken);
				uxBus.fire();
				return true;
			} catch {
				return false;
			} finally {
				tokenStore.clearRefreshInFlight(environmentName);
			}
		})();

		tokenStore.setRefreshInFlight(environmentName, promise);
		return promise;
	}

	async function tryReloadFromTokenFile(environmentName: string): Promise<boolean> {
		if (!folder || !vscode.workspace.isTrusted) return false;
		const bindings = indexTokenFilesByCanonicalPath(
			readDefaultEnvironmentEntries(),
			normalizeEnvironmentName,
			folder.uri,
		);
		const binding = bindings.find(b => b.hosts.includes(environmentName));
		if (!binding) return false;
		const result = await reloadTokenFileIntoStore(binding, tokenStore);
		if (!('ok' in result) || !result.ok) {
			return false;
		}
		console.log(
			`[reltio] reloaded shared tokenFile once for ${result.hosts.length} host(s) after 401`,
		);
		uxBus.fire();
		treeProvider.refresh();
		return true;
	}

	async function handle401(environmentName: string): Promise<void> {
		const refreshed = await tryRefresh(environmentName);
		if (refreshed) {
			// Token silently refreshed — no error shown; next invocation will succeed
			return;
		}
		// Provide Token / tokenFile path: re-read shared tokenFile once (covers Forge renewal).
		if (await tryReloadFromTokenFile(environmentName)) {
			return;
		}
		tokenStore.clearSession(environmentName);
		await sessionStore.deleteRefreshToken(environmentName);
		treeProvider.refresh();
		uxBus.fire();
		await vscode.window.showErrorMessage(
			`Session expired for "${environmentName}". Log in again.`,
		);
	}

	type L3WriteResult = 'written' | '401' | 'error';

	async function writeL3FromApi(
		environmentName: string,
		tenantId: string,
		token: string,
	): Promise<L3WriteResult> {
		if (!environmentManager) return 'error';
		let body: string;
		try {
			body = await fetchL3Configuration(environmentName, tenantId, token);
		} catch (e) {
			if (e instanceof ReltioApiError && e.statusCode === 401) {
				return '401';
			}
			void vscode.window.showErrorMessage((e as Error).message);
			return 'error';
		}
		try {
			const formatted = prettyPrintJsonIfPossible(body);
			const uri = await environmentManager.writeL3(environmentName, tenantId, formatted);
			await environmentManager.writeRemoteBaseline(environmentName, tenantId, formatted);
			const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
			if (open && !open.isClosed) {
				await vscode.commands.executeCommand('workbench.action.files.revert', uri);
			}
			treeProvider.refresh();
			uxBus.fire();
			return 'written';
		} catch (err) {
			void vscode.window.showErrorMessage(`Failed to write L3: ${(err as Error).message}`);
			return 'error';
		}
	}

	async function browseEntitiesFromTree(item?: ConfigTreeItem): Promise<void> {
		if (!environmentManager) return;
		if (!item && treeView.selection.length > 0 && treeView.selection[0] instanceof ConfigTreeItem) {
			item = treeView.selection[0];
		}
		if (!item || !(item instanceof ConfigTreeItem) || (item.nodeType !== 'entityBrowser' && item.nodeType !== 'entityType')) {
			void vscode.window.showErrorMessage('Choose Browse Entities under an entity type.');
			return;
		}
		if (!item.tenantL3Uri) {
			void vscode.window.showErrorMessage('Fetch the tenant L3 configuration before browsing entities.');
			return;
		}
		const loc = tenantLocFromSnapshotOrL3Uri(item.tenantL3Uri);
		if (!loc) {
			void vscode.window.showErrorMessage('Could not resolve the environment and tenant for this entity type.');
			return;
		}
		const token = tokenStore.getToken(loc.environmentName);
		if (!token) {
			void vscode.window.showErrorMessage('Provide a token for this environment first.');
			return;
		}

		let entityTypeUris: string[] = item.browseEntityTypeUris ?? [];
		let entityTypeLabel = item.nodeLabel;
		try {
			const doc = await vscode.workspace.openTextDocument(item.tenantL3Uri);
			const model = JSON.parse(doc.getText()) as unknown;
			const entityType = getValueAtPath(model, entityTypePathFromBrowserItem(item));
			const entityTypeUri = readStringProperty(entityType, 'uri');
			entityTypeLabel = readStringProperty(entityType, 'label') || entityTypeUri?.split('/').pop() || entityTypeLabel;
			if (entityTypeUris.length === 0) {
				entityTypeUris = getConcreteEntityTypeUris(model as Parameters<typeof getConcreteEntityTypeUris>[0], entityTypePathFromBrowserItem(item));
			}
		} catch (e) {
			void vscode.window.showErrorMessage(`Could not read entity type from local L3: ${(e as Error).message}`);
			return;
		}
		const typeFilter = typeFilterForUris(entityTypeUris);
		if (!typeFilter) {
			void vscode.window.showInformationMessage(`No concrete entity types descend from "${entityTypeLabel}".`);
			return;
		}

		const extraFilter = await promptForEntityFilter(`Browse ${entityTypeLabel}`);
		if (extraFilter === undefined) return;

		const trimmedExtraFilter = extraFilter.trim();
		const filter = trimmedExtraFilter ? `and(${typeFilter},${trimmedExtraFilter})` : typeFilter;
		let offset = 0;

		while (true) {
			let entities: unknown[];
			try {
				entities = await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: `Loading ${entityTypeLabel} entities…`,
					},
					() => searchEntities(loc.environmentName, loc.tenantId, token, {
						filter,
						max: ENTITY_BROWSER_PAGE_SIZE,
						offset,
						activeness: 'all',
					}),
				);
			} catch (e) {
				if (e instanceof ReltioApiError && e.statusCode === 401) {
					await handle401(loc.environmentName);
					return;
				}
				void vscode.window.showErrorMessage((e as Error).message);
				return;
			}

			if (entities.length === 0 && offset === 0) {
				void vscode.window.showInformationMessage(`No ${entityTypeLabel} entities matched this filter.`);
				return;
			}

			type EntityPick = vscode.QuickPickItem & {
				entity?: unknown;
				action?: 'next' | 'previous';
			};
			const picks: EntityPick[] = entities.map(entity => ({
				...entityQuickPickLabel(entity),
				entity,
			}));
			if (offset > 0) {
				picks.unshift({
					label: 'Previous Page',
					description: `Rows ${Math.max(1, offset - ENTITY_BROWSER_PAGE_SIZE + 1)}-${offset}`,
					action: 'previous',
				});
			}
			if (entities.length === ENTITY_BROWSER_PAGE_SIZE) {
				picks.push({
					label: 'Next Page',
					description: `Rows ${offset + ENTITY_BROWSER_PAGE_SIZE + 1}-${offset + ENTITY_BROWSER_PAGE_SIZE * 2}`,
					action: 'next',
				});
			}

			const pick = await vscode.window.showQuickPick(picks, {
				title: `${entityTypeLabel} entities`,
				placeHolder: `${loc.environmentName} / ${loc.tenantId} / rows ${offset + 1}-${offset + entities.length}`,
				matchOnDescription: true,
				matchOnDetail: true,
			});
			if (!pick) return;
			if (pick.action === 'previous') {
				offset = Math.max(0, offset - ENTITY_BROWSER_PAGE_SIZE);
				continue;
			}
			if (pick.action === 'next') {
				offset += ENTITY_BROWSER_PAGE_SIZE;
				continue;
			}
			if (pick.entity !== undefined) {
				showEntityDetailPanel(pick.entity, {
					environmentName: loc.environmentName,
					tenantId: loc.tenantId,
					entityTypeLabel,
				});
				return;
			}
		}
	}

	async function runApplyDefaultEnvironments(showEmptyWarning: boolean): Promise<void> {
		if (!environmentManager || !folder) {
			void vscode.window.showErrorMessage(
				'Open a workspace folder to apply default Reltio environments.',
			);
			return;
		}
		if (!vscode.workspace.isTrusted) {
			void vscode.window.showErrorMessage(
				'Workspace Trust is required to apply default environments (tokenFile reads and host network calls). Trust this folder, then retry.',
			);
			return;
		}
		const fetchL3 = vscode.workspace
			.getConfiguration('reltio')
			.get<boolean>('fetchL3AfterApplyDefaults', false);
		const result = await applyDefaultEnvironments({
			workspaceRoot: folder.uri,
			environmentManager,
			tokenStore,
			normalizeEnvironmentName,
			onEnvironmentCreated: name => {
				treeProvider.addEnvironment(name);
				void pushRecentHost(context.globalState, name);
			},
			onTenantCreated: (host, tenantId) => {
				treeProvider.addTenant(host, tenantId);
			},
			writeL3FromApi: fetchL3 ? writeL3FromApi : undefined,
			fetchL3,
		});
		treeProvider.refresh();
		uxBus.fire();

		const summary = summarizeApplyResult(result);
		if (result.errors.length > 0 && result.scaffolded === 0 && result.authenticated === 0) {
			void vscode.window.showErrorMessage(summary);
			return;
		}
		if (result.errors.length > 0) {
			void vscode.window.showWarningMessage(summary);
			return;
		}
		const nothingHappened =
			result.scaffolded === 0 && result.authenticated === 0 && result.fetched === 0;
		if (nothingHappened && !showEmptyWarning) {
			// Silent on auto-activate when already scaffolded / nothing new to report.
			return;
		}
		void vscode.window.showInformationMessage(summary);
	}

	/**
	 * After a successful browser login, if the SSO routing tenant ID is also an accessible
	 * tenant in the user's tenant list, add it to the workspace automatically. Best-effort;
	 * failures are swallowed because the user can always run Add Tenant manually.
	 */
	async function autoAddSsoTenant(
		environmentName: string,
		ssoTenantId: string,
		accessToken: string,
	): Promise<string | undefined> {
		if (!environmentManager) {
			console.error('[reltio] autoAddSsoTenant: no environmentManager');
			return undefined;
		}
		let tenants: string[];
		try {
			tenants = await listTenants(environmentName, accessToken);
		} catch (firstErr) {
			console.error('[reltio] autoAddSsoTenant: first listTenants failed, retrying in 1.5s', firstErr);
			await new Promise(resolve => setTimeout(resolve, 1500));
			try {
				tenants = await listTenants(environmentName, accessToken);
			} catch (secondErr) {
				console.error('[reltio] autoAddSsoTenant: listTenants retry also failed; giving up', secondErr);
				void vscode.window.showWarningMessage(
					`Auto-add tenant "${ssoTenantId}" failed: could not list tenants (${(secondErr as Error).message}). Use Add Tenant manually.`,
				);
				return undefined;
			}
		}
		if (!tenants.includes(ssoTenantId)) {
			console.error(
				`[reltio] autoAddSsoTenant: configured tenant "${ssoTenantId}" is NOT in the accessible list:`,
				tenants,
			);
			void vscode.window.showWarningMessage(
				`Auto-add skipped: tenant "${ssoTenantId}" is not in your accessible tenants list for "${environmentName}". Use Add Tenant to pick a different one.`,
			);
			return undefined;
		}
		try {
			await environmentManager.createTenant(environmentName, ssoTenantId);
			treeProvider.addTenant(environmentName, ssoTenantId);
			await writeL3FromApi(environmentName, ssoTenantId, accessToken);
			// Open the L3 file in the editor so the user lands directly in their work.
			// Idempotent — if it's already open, VS Code focuses the existing tab.
			try {
				const uri = environmentManager.getL3Uri(environmentName, ssoTenantId);
				const doc = await vscode.workspace.openTextDocument(uri);
				await vscode.window.showTextDocument(doc);
			} catch {
				// L3 was written but couldn't be opened — non-fatal
			}
			void vscode.window.showInformationMessage(
				`Tenant "${ssoTenantId}" added under "${environmentName}". L3 opened for editing.`,
			);
			return ssoTenantId;
		} catch (e) {
			console.error('[reltio] autoAddSsoTenant: createTenant/writeL3 failed', e);
			void vscode.window.showWarningMessage(
				`Auto-add tenant "${ssoTenantId}" failed during creation: ${(e as Error).message}. Use Add Tenant manually.`,
			);
			return undefined;
		}
	}

	/**
	 * Save a document if the user has unsaved edits, so a command never acts on
	 * stale disk contents. URI-generic: used for L3 files and for BPMN drafts.
	 */
	async function ensureDocumentSaved(fileUri: vscode.Uri): Promise<boolean> {
		const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === fileUri.toString());
		if (doc?.isDirty) {
			return doc.save();
		}
		return true;
	}

	async function openRemoteVsLocalDiff(remoteText: string, l3Uri: vscode.Uri, title: string): Promise<void> {
		const formatted = prettyPrintJsonIfPossible(remoteText);
		const tmpPath = path.join(os.tmpdir(), `reltio-apply-remote-${Date.now()}.json`);
		const tmpUri = vscode.Uri.file(tmpPath);
		await vscode.workspace.fs.writeFile(tmpUri, new TextEncoder().encode(formatted));
		await vscode.commands.executeCommand('vscode.diff', tmpUri, l3Uri, title);
	}

	/** After opening a diff, confirm the pending action with a non-modal message so the user can review the editor first. */
	async function confirmAfterReview(message: string, confirmLabel: string, cancelLabel = "Don't apply"): Promise<boolean> {
		const choice = await vscode.window.showInformationMessage(message, { modal: false }, confirmLabel, cancelLabel);
		return choice === confirmLabel;
	}

	/**
	 * True when the local configuration has edits that were never published to the tenant, i.e. it
	 * no longer matches `.reltio-ide/BusinessConfig.baseline.json` (the snapshot recorded at the
	 * last successful fetch).
	 * A missing or unparsable baseline is treated as "unpublished changes" — we have no evidence
	 * it's safe to discard the local file.
	 */
	async function hasUnpublishedLocalChanges(l3Uri: vscode.Uri, baselineUri: vscode.Uri): Promise<boolean> {
		let localText: string;
		try {
			localText = new TextDecoder().decode(await vscode.workspace.fs.readFile(l3Uri));
		} catch {
			return false;
		}
		let baselineText: string | undefined;
		try {
			baselineText = new TextDecoder().decode(await vscode.workspace.fs.readFile(baselineUri));
		} catch {
			baselineText = undefined;
		}
		return hasUnpublishedLocalChangesFromText(localText, baselineText);
	}

	async function applyL3ConfigurationToTenant(node: TenantNode): Promise<void> {
		if (!environmentManager || !node.hasL3) {
			return;
		}
		const token = tokenStore.getToken(node.environmentName);
		if (!token) {
			void vscode.window.showErrorMessage('Provide a token for this environment first.');
			return;
		}
		const l3Uri = environmentManager.getL3Uri(node.environmentName, node.tenantId);
		const baselineUri = environmentManager.getRemoteBaselineUri(node.environmentName, node.tenantId);

		let baselineText: string;
		try {
			const bytes = await vscode.workspace.fs.readFile(baselineUri);
			baselineText = new TextDecoder().decode(bytes);
		} catch {
			void vscode.window.showErrorMessage(
				'No remote baseline on disk. Run "Fetch Configuration" once to record the server copy, then edit and apply.',
			);
			return;
		}

		const saved = await ensureDocumentSaved(l3Uri);
		if (!saved) {
			void vscode.window.showErrorMessage('Save BusinessConfig.json before applying.');
			return;
		}

		let remoteText: string;
		try {
			remoteText = await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: 'Checking remote configuration…' },
				() => fetchL3Configuration(node.environmentName, node.tenantId, token),
			);
		} catch (e) {
			if (e instanceof ReltioApiError && e.statusCode === 401) {
				await handle401(node.environmentName);
				return;
			}
			void vscode.window.showErrorMessage((e as Error).message);
			return;
		}

		const localBytes = await vscode.workspace.fs.readFile(l3Uri);
		const localText = new TextDecoder().decode(localBytes);

		if (!tryParseJson(baselineText) || !tryParseJson(remoteText)) {
			void vscode.window.showErrorMessage('Could not parse baseline or remote configuration as JSON.');
			return;
		}
		const serverMatchesBaseline = remoteMatchesBaseline(baselineText, remoteText);

		const diffTitle = `Remote (server) ↔ Local L3 (${node.tenantId})`;

		if (serverMatchesBaseline) {
			const pick = await vscode.window.showWarningMessage(
				'Remote configuration matches your last fetch (baseline). Apply your local L3 to the tenant?',
				{ modal: true },
				'Yes',
				'View changes',
				"Don't apply",
			);
			if (pick === "Don't apply" || pick === undefined) {
				return;
			}
			if (pick === 'View changes') {
				await openRemoteVsLocalDiff(remoteText, l3Uri, diffTitle);
				const ok = await confirmAfterReview(
					'Review the diff tab (remote vs local). When ready, apply your local L3 to the tenant or cancel.',
					'Apply to tenant',
				);
				if (!ok) {
					return;
				}
			}
		} else {
			const pick = await vscode.window.showWarningMessage(
				'Configuration on the server changed since your last fetch. Review before applying.',
				{ modal: true },
				'Review changes',
				'Skip',
			);
			if (pick !== 'Review changes') {
				return;
			}
			await openRemoteVsLocalDiff(remoteText, l3Uri, diffTitle);
			const ok = await confirmAfterReview(
				'Review the diff tab (remote vs local). Server configuration changed since your last fetch. Apply your local L3 only if you accept overwriting remote changes.',
				'Apply to tenant',
			);
			if (!ok) {
				return;
			}
		}

		const { model: localModel } = parseDocument(localText);
		const invalidSources = (localModel.sources ?? []).filter(
			s => !s.uri || !s.label || !s.abbreviation,
		);
		if (invalidSources.length > 0) {
			const names = invalidSources.map(s => s.uri || '(unknown)').join(', ');
			void vscode.window.showErrorMessage(
				`Cannot apply: the following sources are missing required fields (uri, label, abbreviation): ${names}`,
			);
			return;
		}

		await pushLocalToTenant(node, token, localText);
	}

	/**
	 * PUTs `localText` to the tenant and refreshes the baseline on success — no confirmation
	 * dialog of its own. Callers are responsible for deciding when it's safe to call this
	 * (e.g. `applyL3ConfigurationToTenant` after its own drift check, or the Fetch review flow
	 * after the user has already seen a diff and explicitly chosen to push their local edits).
	 */
	async function pushLocalToTenant(node: TenantNode, token: string, localText: string): Promise<void> {
		if (!environmentManager) return;
		try {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Applying configuration (${node.tenantId})…`,
				},
				() => putL3Configuration(node.environmentName, node.tenantId, token, localText),
			);
		} catch (e) {
			if (e instanceof ReltioApiError && e.statusCode === 401) {
				await handle401(node.environmentName);
				return;
			}
			const msg = (e as Error).message;
			const useModal = msg.includes('\n\n') || msg.length > 360;
			void vscode.window.showErrorMessage(msg, { modal: useModal }, 'OK');
			return;
		}

		void vscode.window.showInformationMessage(`Configuration applied for tenant "${node.tenantId}".`);

		try {
			const refreshed = await fetchL3Configuration(node.environmentName, node.tenantId, token);
			const formatted = prettyPrintJsonIfPossible(refreshed);
			await environmentManager.writeRemoteBaseline(node.environmentName, node.tenantId, formatted);
		} catch {
			void vscode.window.showWarningMessage(
				'Applied successfully, but the baseline file could not be refreshed from the server. Run "Fetch Configuration" to resync.',
			);
		}
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('reltio.addEnvironment', async () => {
			if (!environmentManager) {
				void vscode.window.showErrorMessage('Open a workspace folder to add Reltio environments.');
				return;
			}
			const raw = await vscode.window.showInputBox({
				title: 'Add Reltio environment',
				prompt: 'Environment host or URL (e.g. 361.reltio.com)',
				validateInput: v => (v?.trim() ? undefined : 'Enter a host or URL'),
			});
			if (!raw) return;
			const name = normalizeEnvironmentName(raw);
			if (!name) return;
			const ok = await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: 'Validating environment…' },
				async () => validateEnvironment(name),
			);
			if (!ok) {
				void vscode.window.showErrorMessage(
					`Could not reach https://${name}/reltio/status (HTTP 200 required).`,
				);
				return;
			}
			try {
				await environmentManager.createEnvironment(name);
				treeProvider.addEnvironment(name);
				uxBus.fire();
				await pushRecentHost(context.globalState, name);
				void vscode.window.showInformationMessage(`Environment "${name}" added.`);
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to create environment: ${(e as Error).message}`);
			}
		}),
		vscode.commands.registerCommand('reltio.removeEnvironment', async (node?: EnvironmentNode) => {
			if (!environmentManager || !node) return;
			const pick = await vscode.window.showWarningMessage(
				`Remove environment "${node.environmentName}" and all tenant data?`,
				{ modal: true },
				'Remove',
			);
			if (pick !== 'Remove') return;
			try {
				await environmentManager.removeEnvironment(node.environmentName);
				tokenStore.clearSession(node.environmentName);
				void sessionStore.deleteRefreshToken(node.environmentName);
				void oauthCredentialsStore.deleteClientCredentials(node.environmentName);
				treeProvider.removeEnvironment(node.environmentName);
				uxBus.fire();
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to remove environment: ${(e as Error).message}`);
			}
		}),
		vscode.commands.registerCommand('reltio.provideToken', async (node?: EnvironmentNode) => {
			if (!node) return;
			if (!(await ensureTermsAccepted(context))) return;
			const token = await vscode.window.showInputBox({
				title: 'Bearer token',
				prompt: `Token for ${node.environmentName}`,
				password: true,
				ignoreFocusOut: true,
			});
			if (!token) return;
			tokenStore.setToken(node.environmentName, token);
			uxBus.fire();
			treeProvider.refreshEnvironment(node.environmentName);
			const configuredTenantId = await oauthCredentialsStore.loadSsoTenantId(node.environmentName);
			if (configuredTenantId) {
				void autoAddSsoTenant(node.environmentName, configuredTenantId, token).then(() => uxBus.fire());
			}
		}),
		vscode.commands.registerCommand('reltio.applyDefaultEnvironments', async () => {
			await runApplyDefaultEnvironments(true);
		}),
		vscode.commands.registerCommand('reltio.configureOAuthClient', async (node?: EnvironmentNode) => {
			if (!node) return;
			const clientId = await vscode.window.showInputBox({
				title: 'OAuth client ID',
				prompt: `Client ID for ${node.environmentName}`,
				ignoreFocusOut: true,
				validateInput: v => (v?.trim() ? undefined : 'Client ID is required'),
			});
			if (!clientId?.trim()) return;
			const clientSecret = await vscode.window.showInputBox({
				title: 'OAuth client secret',
				prompt: `Client secret for ${node.environmentName}`,
				password: true,
				ignoreFocusOut: true,
				validateInput: v => (v?.trim() ? undefined : 'Client secret is required'),
			});
			if (!clientSecret?.trim()) return;
			const existingSsoTenantId = await oauthCredentialsStore.loadSsoTenantId(node.environmentName);
			const ssoTenantId = await vscode.window.showInputBox({
				title: 'SSO routing tenant ID',
				prompt: 'Tenant used for SSO routing during browser login.',
				value: existingSsoTenantId,
				placeHolder: 'Tenant ID used for SSO routing',
				ignoreFocusOut: true,
				validateInput: v => (v?.trim() ? undefined : 'SSO tenant ID is required'),
			});
			if (!ssoTenantId?.trim()) return;
			await oauthCredentialsStore.saveClientCredentials(node.environmentName, {
				clientId: clientId.trim(),
				clientSecret: clientSecret.trim(),
			});
			uxBus.fire();
			await oauthCredentialsStore.saveSsoTenantId(node.environmentName, ssoTenantId.trim());
			treeProvider.refresh();
			void vscode.window.showInformationMessage(
				`OAuth client credentials saved for "${node.environmentName}". If this is the only pair in the workspace, other environments can use Login with Browser once they have their own SSO tenant ID configured.`,
			);
		}),
		vscode.commands.registerCommand('reltio.loginWithBrowser', async (node?: EnvironmentNode) => {
			if (!node || !environmentManager) return;
			if (!(await ensureTermsAccepted(context))) return;
			const envNames = (await environmentManager.scanEnvironments()).map(e => e.name);
			const credentials = await resolveOAuthCredentials(
				oauthCredentialsStore,
				node.environmentName,
				envNames,
			);
			if (!credentials) {
				const pick = await vscode.window.showErrorMessage(
					`Login with Browser is not available for "${node.environmentName}". Configure OAuth client credentials for this environment, or configure a single shared pair used by only one environment.`,
					'Configure OAuth Client',
				);
				if (pick === 'Configure OAuth Client') {
					await vscode.commands.executeCommand('reltio.configureOAuthClient', node);
				}
				return;
			}
			const ssoTenantId = await oauthCredentialsStore.loadSsoTenantId(node.environmentName);
			if (!ssoTenantId) {
				const pick = await vscode.window.showErrorMessage(
					`No SSO routing tenant configured for "${node.environmentName}". Run Configure OAuth Client to set one.`,
					'Configure OAuth Client',
				);
				if (pick === 'Configure OAuth Client') {
					await vscode.commands.executeCommand('reltio.configureOAuthClient', node);
				}
				return;
			}
			let session;
			try {
				session = await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: `Waiting for browser login… (${node.environmentName})`,
						cancellable: false,
					},
					() => runBrowserLogin(credentials, ssoTenantId),
				);
			} catch (e) {
				if (e instanceof OAuthLoginError && e.code === 'PORT_BUSY') {
					void vscode.window.showErrorMessage(e.message);
				} else if (e instanceof OAuthLoginError && e.code === 'TIMEOUT') {
					void vscode.window.showErrorMessage(e.message);
				} else if (e instanceof OAuthLoginError && e.code === 'NO_IDP_CONFIGURED') {
					void vscode.window.showErrorMessage(
						`${e.message} Use "Provide Token" to paste a Bearer token manually instead.`,
						{ modal: true },
					);
				} else if (e instanceof OAuthLoginError && e.code === 'STATE_MISMATCH') {
					void vscode.window.showErrorMessage(e.message);
				} else if (e instanceof OAuthLoginError && e.code === 'SSO_CHECK_FAILED') {
					void vscode.window.showErrorMessage(
						`Could not check SSO configuration: ${e.message}\n\nThis usually means the configured OAuth client cannot reach /oauth/ssoCheck for the tenant you entered, or the tenant has no external identity provider. Verify the SSO routing tenant ID under Configure OAuth Client, or use "Provide Token" to paste a Bearer token manually instead.`,
						{ modal: true },
					);
				} else {
					void vscode.window.showErrorMessage(`Login failed: ${(e as Error).message}`);
				}
				return;
			}
			tokenStore.setSession(node.environmentName, session);
			await sessionStore.saveRefreshToken(node.environmentName, session.refreshToken);
			uxBus.fire();
			treeProvider.refreshEnvironment(node.environmentName);
			void vscode.window.showInformationMessage(
				`Logged in to "${node.environmentName}". You can close the browser tab and continue in the editor.`,
			);
			void autoAddSsoTenant(node.environmentName, ssoTenantId, session.accessToken).then(() => uxBus.fire());
		}),
		vscode.commands.registerCommand('reltio.resetOAuthClient', async (node?: EnvironmentNode) => {
			if (!node) return;
			const confirm = await vscode.window.showWarningMessage(
				`Reset OAuth client credentials for "${node.environmentName}"? This will also clear any active session.`,
				{ modal: true },
				'Reset',
			);
			if (confirm !== 'Reset') return;
			await oauthCredentialsStore.deleteClientCredentials(node.environmentName);
			uxBus.fire();
			tokenStore.clearSession(node.environmentName);
			await sessionStore.deleteRefreshToken(node.environmentName);
			treeProvider.refresh();
			await vscode.commands.executeCommand('reltio.configureOAuthClient', node);
		}),
		vscode.commands.registerCommand('reltio.reLoginWithBrowser', async (node?: EnvironmentNode) => {
			if (!node) return;
			tokenStore.clearSession(node.environmentName);
			await sessionStore.deleteRefreshToken(node.environmentName);
			treeProvider.refreshEnvironment(node.environmentName);
			await vscode.commands.executeCommand('reltio.loginWithBrowser', node);
		}),
		vscode.commands.registerCommand('reltio.addTenant', async (node?: EnvironmentNode) => {
			if (!environmentManager) return;
			// Resolve env when invoked without a node (e.g., from the walkthrough button)
			let resolvedEnvName: string;
			if (node) {
				resolvedEnvName = node.environmentName;
			} else {
				const envs = await environmentManager.scanEnvironments();
				if (envs.length === 0) {
					const pick = await vscode.window.showWarningMessage(
						'Add a Reltio environment first.',
						'Launch Setup Wizard',
					);
					if (pick === 'Launch Setup Wizard') {
						await vscode.commands.executeCommand('reltio.launchSetupWizard');
					}
					return;
				}
				const authedEnvs = envs.filter(e => tokenStore.hasToken(e.name));
				if (authedEnvs.length === 0) {
					const pick = await vscode.window.showWarningMessage(
						'Sign in to an environment first.',
						'Sign In',
					);
					if (pick === 'Sign In') {
						await vscode.commands.executeCommand('reltio.signInToFirstEnvironment');
					}
					return;
				}
				if (authedEnvs.length === 1) {
					resolvedEnvName = authedEnvs[0].name;
				} else {
					const choice = await vscode.window.showQuickPick(
						authedEnvs.map(e => ({ label: e.name, value: e.name })),
						{ title: 'Add tenant to which environment?' },
					);
					if (!choice) return;
					resolvedEnvName = choice.value;
				}
			}
			const token = tokenStore.getToken(resolvedEnvName);
			if (!token) {
				void vscode.window.showErrorMessage('Provide a token for this environment first.');
				return;
			}
			let tenants: string[];
			try {
				tenants = await vscode.window.withProgress(
					{ location: vscode.ProgressLocation.Notification, title: 'Loading tenants…' },
					() => listTenants(resolvedEnvName, token),
				);
			} catch (e) {
				if (e instanceof ReltioApiError && e.statusCode === 401) {
					await handle401(resolvedEnvName);
				} else {
					void vscode.window.showErrorMessage((e as Error).message);
				}
				return;
			}
			const pick = await vscode.window.showQuickPick(tenants, { title: 'Select tenant' });
			if (!pick) return;
			try {
				await environmentManager.createTenant(resolvedEnvName, pick);
				treeProvider.addTenant(resolvedEnvName, pick);
				uxBus.fire();
			} catch (err) {
				void vscode.window.showErrorMessage(`Failed to add tenant: ${(err as Error).message}`);
				return;
			}
			const fetchResult = await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: `Fetching L3 for ${pick}…` },
				() => writeL3FromApi(resolvedEnvName, pick, token),
			);
			if (fetchResult === '401') {
				await handle401(resolvedEnvName);
			} else if (fetchResult === 'error') {
				void vscode.window.showWarningMessage(
					`Tenant "${pick}" was added, but L3 could not be downloaded. Use Fetch Configuration to retry.`,
				);
			}
		}),
		vscode.commands.registerCommand('reltio.undoLayoutMigration', async () => {
			const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
			if (!environmentManager || !workspaceRoot) return;

			if (!(await hasMigrationBackup(workspaceRoot))) {
				void vscode.window.showInformationMessage(
					'No layout migration backup found in this workspace. There is nothing to undo.',
				);
				return;
			}

			const pick = await vscode.window.showWarningMessage(
				'Restore the legacy tenant folder layout from the migration backup? Files currently in the component tree will be replaced.',
				{ modal: true },
				'Restore',
			);
			if (pick !== 'Restore') return;

			try {
				const { restored } = await vscode.window.withProgress(
					{ location: vscode.ProgressLocation.Notification, title: 'Restoring legacy layout…' },
					() => undoMigration(workspaceRoot, environmentManager!, context.workspaceState),
				);
				treeProvider.refresh();
				uxBus.fire();
				void vscode.window.showInformationMessage(
					restored.length > 0
						? `Restored the legacy layout for: ${restored.join(', ')}.`
						: 'No tenants were restored.',
				);
			} catch (e) {
				void vscode.window.showErrorMessage(`Undo failed: ${(e as Error).message}`);
			}
		}),
		vscode.commands.registerCommand('reltio.tenantNewBranch', async (node?: TenantNode) => {
			if (!node || !environmentManager) return;
			const tenantRoot = environmentManager.getTenantRootUri(node.environmentName, node.tenantId);

			const remoteUrl = await getRemoteUrl(tenantRoot);
			if (!remoteUrl) {
				void vscode.window.showErrorMessage(
					`Tenant "${node.tenantId}" has no "origin" remote configured.`,
				);
				return;
			}

			let remoteBranches: string[] = [];
			let listFailed = false;
			try {
				remoteBranches = await vscode.window.withProgress(
					{ location: vscode.ProgressLocation.Notification, title: 'Reading branches…' },
					() => listRemoteBranches(tenantRoot, remoteUrl),
				);
			} catch {
				listFailed = true;
			}

			const current = await getCurrentBranch(tenantRoot);
			// The branch it is already on is not a useful thing to switch to.
			const selectable = remoteBranches.filter(b => b !== current);
			const branch = await pickBranch(node.tenantId, selectable, listFailed, current);
			if (!branch) return;

			const isExisting = remoteBranches.includes(branch);
			try {
				if (isExisting) {
					await vscode.window.withProgress(
						{ location: vscode.ProgressLocation.Notification, title: `Switching to ${branch}…` },
						() => switchToExistingBranch(tenantRoot, branch),
					);
					treeProvider.refresh();
					void vscode.window.showInformationMessage(
						`Tenant "${node.tenantId}" is now on branch "${branch}". Its configuration reflects that branch; fetch again to pull the tenant's current state from Reltio.`,
					);
					return;
				}

				const result = await vscode.window.withProgress(
					{ location: vscode.ProgressLocation.Notification, title: `Creating ${branch}…` },
					() => createAndPublishBranch(tenantRoot, branch),
				);
				treeProvider.refresh();
				if (result.published) {
					void vscode.window.showInformationMessage(
						`Created and published branch "${branch}" from "${current ?? 'the current commit'}". Your configuration is unchanged and comes with you.`,
					);
				} else {
					void vscode.window.showWarningMessage(
						`Branch "${branch}" was created locally but could not be published: ${result.reason}`,
					);
				}
			} catch (e) {
				void vscode.window.showErrorMessage((e as Error).message);
			}
		}),
		vscode.commands.registerCommand('reltio.disconnectTenantFromGit', async (node?: TenantNode) => {
			if (!node || !environmentManager) return;
			const tenantRoot = environmentManager.getTenantRootUri(node.environmentName, node.tenantId);

			const dirty = await hasUncommittedChanges(tenantRoot);
			const warning = dirty
				? `Disconnect tenant "${node.tenantId}" from Git? It has uncommitted changes. Your files stay exactly as they are, but the repository and its local history are removed and unpushed commits are lost.`
				: `Disconnect tenant "${node.tenantId}" from Git? Your files stay exactly as they are; the repository and its local history are removed.`;
			const pick = await vscode.window.showWarningMessage(warning, { modal: true }, 'Disconnect');
			if (pick !== 'Disconnect') return;

			try {
				await disconnectFromGit(tenantRoot);
				treeProvider.refresh();
				void vscode.window.showInformationMessage(
					`Tenant "${node.tenantId}" is no longer connected to Git. Its files are untouched.`,
				);
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to disconnect: ${(e as Error).message}`);
			}
		}),
		vscode.commands.registerCommand('reltio.connectTenantToGit', async (node?: TenantNode) => {
			if (!node || !environmentManager) return;
			const tenantRoot = environmentManager.getTenantRootUri(node.environmentName, node.tenantId);

			if (await isGitRepo(tenantRoot)) {
				void vscode.window.showInformationMessage(
					`Tenant "${node.tenantId}" is already connected to Git.`,
				);
				return;
			}

			// Binding inside another repository produces a nested one: the outer repo then stores
			// this tenant as a gitlink and cloning it yields an empty folder. Say so up front.
			const enclosingRepo = await findEnclosingGitRepository(
				vscode.Uri.joinPath(tenantRoot, '..'),
			);
			if (enclosingRepo) {
				const proceed = await vscode.window.showWarningMessage(
					`A Git repository already exists at ${enclosingRepo.fsPath}. Connecting this tenant creates a repository inside it, and the outer one will store the tenant as a pointer rather than its files.`,
					{ modal: true },
					'Connect Anyway',
				);
				if (proceed !== 'Connect Anyway') return;
			}

			// Every tenant in a promotion flow shares one remote, so remember it per workspace.
			const lastRemote = context.workspaceState.get<string>(LAST_GIT_REMOTE_KEY, '');
			const remoteUrl = await vscode.window.showInputBox({
				title: 'Connect to Git',
				prompt: 'Git remote URL holding this tenant\'s configuration',
				placeHolder: 'https://github.com/org/reltio-config.git',
				value: lastRemote,
				ignoreFocusOut: true,
			});
			if (!remoteUrl?.trim()) return;

			// Offer the remote's existing branches rather than making the user recall them. Listing
			// needs no clone, so nothing is written to disk if they back out here.
			let remoteBranches: string[] = [];
			let listFailed = false;
			try {
				remoteBranches = await vscode.window.withProgress(
					{ location: vscode.ProgressLocation.Notification, title: 'Reading branches…' },
					() => listRemoteBranches(tenantRoot, remoteUrl.trim()),
				);
			} catch {
				// Unreachable remote, or credentials the helper could not supply. Fall back to
				// free text rather than blocking: the bind itself will report the real failure.
				listFailed = true;
			}

			const branch = await pickBranch(node.tenantId, remoteBranches, listFailed);
			if (!branch) return;

			try {
				const outcome = await vscode.window.withProgress(
					{ location: vscode.ProgressLocation.Notification, title: 'Connecting tenant to Git…' },
					() =>
						bindTenantToGit({
							tenantRoot,
							remoteUrl: remoteUrl.trim(),
							branch: branch.trim(),
							environmentName: node.environmentName,
							tenantId: node.tenantId,
							confirmCreateBranch: async (b, url) =>
								(await vscode.window.showWarningMessage(
									`Branch "${b}" does not exist on ${url}. Create it from the default branch and push it?`,
									{ modal: true },
									'Create Branch',
								)) === 'Create Branch',
						}),
				);

				if (outcome.kind === 'declined') {
					void vscode.window.showInformationMessage(
						`Branch "${outcome.branch}" was not created. Tenant is not connected to Git.`,
					);
					return;
				}

				await context.workspaceState.update(LAST_GIT_REMOTE_KEY, remoteUrl.trim());
				treeProvider.refresh();
				uxBus.fire();

				if (outcome.kind === 'branch-created-not-pushed') {
					void vscode.window.showWarningMessage(
						`Branch "${outcome.branch}" was created locally but could not be pushed: ${outcome.reason}`,
					);
				} else if (outcome.kind === 'initialized-empty-remote') {
					// Not a failure: an unborn branch cannot be pushed, so the first commit is the
					// user's to make. Phrase it as the next step rather than as something going wrong.
					void vscode.window.showInformationMessage(
						`Tenant "${node.tenantId}" is connected to Git on branch "${outcome.branch}". The remote is empty, so your configuration will be its first commit: commit and push from Source Control.`,
					);
				} else if (outcome.kind === 'branch-created') {
					void vscode.window.showInformationMessage(
						`Created and pushed branch "${outcome.branch}" for tenant "${node.tenantId}".`,
					);
				} else if (outcome.kind === 'adopted') {
					// The config was already on disk, so it is now an uncommitted change against the
					// branch. Say so, otherwise a full-looking diff in Source Control is a surprise.
					void vscode.window.showInformationMessage(
						`Tenant "${node.tenantId}" is connected to Git on branch "${outcome.branch}". Its existing configuration is staged as changes against that branch. Review and commit them in Source Control.`,
					);
				} else {
					void vscode.window.showInformationMessage(
						`Tenant "${node.tenantId}" is connected to Git on branch "${outcome.branch}".`,
					);
				}
			} catch (e) {
				void vscode.window.showErrorMessage(
					`Failed to connect tenant to Git: ${(e as Error).message}`,
				);
			}
		}),
		/**
		 * reltio.connectWorkflowRepository
		 * Clones the customer's Reltio-provisioned Custom Workflow Repository into
		 * `Workflows/Custom Workflows/` (D1) and records the binding in
		 * `WorkflowRepo.reltio.json` (D3). A second, distinct remote from whatever
		 * the tenant itself may be bound to via `reltio.connectTenantToGit` — see
		 * `workflowRepoGitignore.ts` for how the two stay safely nested.
		 *
		 * Takes a tree node or a `WorkflowCommandArgs` object, so an agent can call it
		 * without one. The modal confirmation below is unchanged either way: cloning
		 * into the tenant folder is the irreversible half of this command.
		 */
		vscode.commands.registerCommand(
			'reltio.connectWorkflowRepository',
			async (arg?: WorkflowRepoNode | WorkflowCommandArgs) => {
			const args = workflowCommandArgs(arg);
			if (!args || !environmentManager) return;
			const loc = await resolveWorkflowTenant(args);
			if (!loc) return;
			const { environmentName, tenantId } = loc;

			const repoConfigUri = environmentManager.getWorkflowRepoConfigUri(environmentName, tenantId);
			if (await loadWorkflowRepoConfig(repoConfigUri)) {
				void vscode.window.showInformationMessage(
					`Tenant "${tenantId}" already has a Custom Workflow Repository connected.`,
				);
				return;
			}

			const repoUrl = await vscode.window.showInputBox({
				title: 'Connect Custom Workflow Repository',
				prompt: 'Git URL Reltio gave you for this tenant\u2019s custom workflow code',
				placeHolder: 'https://bitbucket.org/acme/acme-workflows.git',
				ignoreFocusOut: true,
				// Credentials in the URL are refused up front, with the supported alternatives in the message.
				validateInput: value => (value.trim() ? cloneUrlProblem(value.trim()) : undefined),
			});
			if (!repoUrl?.trim()) return;

			const repoDir = environmentManager.getWorkflowRepoDirectoryUri(environmentName, tenantId);
			const relativePath = 'Workflows/Custom Workflows';

			let removedReadme: string | undefined;
			try {
				await vscode.workspace.fs.createDirectory(repoDir);
				// D1's placeholder folder already carries a generated README by the time anyone
				// connects a real repository — clear it before the emptiness check, not after.
				removedReadme = await clearGeneratedReadmeBeforeClone(repoDir);

				if (await isGitRepoWithRemote(repoDir)) {
					void vscode.window.showInformationMessage(
						`Tenant "${tenantId}" already has a Custom Workflow Repository connected.`,
					);
					return;
				}
				if (!(await isFolderEmpty(repoDir))) {
					void vscode.window.showErrorMessage(
						'Workflows/Custom Workflows already has files in it. Move or remove them, then try again.',
					);
					return;
				}

				await vscode.window.withProgress(
					{ location: vscode.ProgressLocation.Notification, title: 'Cloning Custom Workflow Repository…' },
					() => cloneRepository(repoUrl.trim(), repoDir),
				);
				await saveWorkflowRepoConfig(repoConfigUri, { repoUrl: storableRepoUrl(repoUrl.trim()), relativePath });

				// D10, Order 2 (tenant already bound, repo connected second): we control this
				// moment, so fix the outer .gitignore immediately rather than waiting for the
				// next activation/refresh sweep.
				await reconcileWorkflowRepoGitignore(
					environmentManager.getTenantRootUri(environmentName, tenantId),
					repoConfigUri,
				);

				await refreshWorkflowRepoSyncState(environmentName, tenantId);
				treeProvider.refresh();
				uxBus.fire();

				// D8: no code changes to JAR registration, just a one-time nudge toward it.
				void vscode.window.showInformationMessage(
					`Connected the Custom Workflow Repository for "${tenantId}". If it built a new JAR, use Refresh JARs to pick it up.`,
				);
			} catch (e) {
				// Nothing was cloned, so the placeholder the tenant tree seeded must still be there.
				await restoreGeneratedReadme(repoDir, removedReadme);
				if (e instanceof GitNotFoundError) {
					void vscode.window.showErrorMessage(e.message);
					return;
				}
				void vscode.window.showErrorMessage(
					`Failed to connect Custom Workflow Repository: ${(e as Error).message}`,
				);
			}
		}),
		/**
		 * reltio.disconnectWorkflowRepository
		 * Removes only `.git` and the sidecar (D2.2) — the cloned files stay
		 * exactly where they are, same contract as `reltio.disconnectTenantFromGit`.
		 *
		 * Agent-callable, and the modal warning stays: discarding local history is not
		 * recoverable from inside the IDE.
		 */
		vscode.commands.registerCommand(
			'reltio.disconnectWorkflowRepository',
			async (arg?: WorkflowRepoNode | WorkflowCommandArgs) => {
			const args = workflowCommandArgs(arg);
			if (!args || !environmentManager) return;
			const loc = await resolveWorkflowTenant(args);
			if (!loc) return;
			const { environmentName, tenantId } = loc;

			const repoDir = environmentManager.getWorkflowRepoDirectoryUri(environmentName, tenantId);
			const repoConfigUri = environmentManager.getWorkflowRepoConfigUri(environmentName, tenantId);

			const dirty = await hasUncommittedChanges(repoDir);
			const warning = dirty
				? `Disconnect the Custom Workflow Repository for "${tenantId}"? It has uncommitted changes. Your files stay exactly as they are, but the repository and its local history are removed and unpushed commits are lost.`
				: `Disconnect the Custom Workflow Repository for "${tenantId}"? Your files stay exactly as they are; the repository and its local history are removed.`;
			const pick = await vscode.window.showWarningMessage(warning, { modal: true }, 'Disconnect');
			if (pick !== 'Disconnect') return;

			try {
				await disconnectFromGit(repoDir);
				await deleteWorkflowRepoConfig(repoConfigUri);
				await refreshWorkflowRepoSyncState(environmentName, tenantId);
				treeProvider.refresh();
				uxBus.fire();
				void vscode.window.showInformationMessage(
					`Tenant "${tenantId}" is no longer connected to a Custom Workflow Repository. Its files are untouched.`,
				);
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to disconnect: ${(e as Error).message}`);
			}
		}),
		/**
		 * reltio.openWorkflowRepoFolder
		 * Reveals the connected repository's root in the OS file explorer. Still the
		 * escape hatch for everything the tree deliberately does not list — `pom.xml`,
		 * `pipeline/`, `repository.properties` — now that the row groups BPMN and Java
		 * rather than mirroring the repository's folders.
		 */
		vscode.commands.registerCommand(
			'reltio.openWorkflowRepoFolder',
			async (arg?: WorkflowRepoNode | WorkflowCommandArgs) => {
			const args = workflowCommandArgs(arg);
			if (!args || !environmentManager) return;
			const loc = await resolveWorkflowTenant(args);
			if (!loc) return;
			const repoDir = environmentManager.getWorkflowRepoDirectoryUri(loc.environmentName, loc.tenantId);
			await vscode.commands.executeCommand('revealFileInOS', repoDir);
		}),
		/**
		 * reltio.openWorkflowRepoInBrowser
		 * D7's one nice-to-have beyond the sync badge: open the stored `repoUrl`
		 * in the system browser. No Bitbucket API call, no in-IDE browser — just
		 * handing a URL to `openExternal`.
		 */
		vscode.commands.registerCommand(
			'reltio.openWorkflowRepoInBrowser',
			async (arg?: WorkflowRepoNode | WorkflowCommandArgs) => {
			const args = workflowCommandArgs(arg);
			if (!args || !environmentManager) return;
			const loc = await resolveWorkflowTenant(args);
			if (!loc) return;
			const repoConfigUri = environmentManager.getWorkflowRepoConfigUri(loc.environmentName, loc.tenantId);
			const config = await loadWorkflowRepoConfig(repoConfigUri);
			if (!config) return;
			// Only an https page is ever opened. The sidecar is committed, so its URL is not something to
			// hand to the OS as-is; an ssh or scp-style remote has no page, so it is copied instead.
			const openable = toOpenableHttpsUrl(config.repoUrl);
			if (!openable) {
				await vscode.env.clipboard.writeText(redactUrl(config.repoUrl));
				void vscode.window.showInformationMessage(
					'This repository has no web page to open from here, so its address was copied to the clipboard.',
				);
				return;
			}
			try {
				await vscode.env.openExternal(vscode.Uri.parse(openable));
			} catch (e) {
				void vscode.window.showErrorMessage(`Could not open the repository URL: ${(e as Error).message}`);
			}
		}),
		/**
		 * reltio.refreshWorkflowRepoSync
		 * Manual recompute of the sync badge (D5), for a repo file edited outside
		 * a Fetch/Deploy cycle. A watcher *invalidates* stale state but never recomputes
		 * it — the comparison fetches deployed XML, which is not a per-keystroke call.
		 */
		vscode.commands.registerCommand(
			'reltio.refreshWorkflowRepoSync',
			async (arg?: WorkflowRepoNode | WorkflowCommandArgs) => {
			const args = workflowCommandArgs(arg);
			if (!args) return;
			const loc = await resolveWorkflowTenant(args);
			if (!loc) return;
			await refreshWorkflowRepoSyncState(loc.environmentName, loc.tenantId);
			treeProvider.refresh();
		}),
		vscode.commands.registerCommand('reltio.removeTenant', async (node?: TenantNode) => {
			if (!node || !environmentManager) return;
			const pick = await vscode.window.showWarningMessage(
				`Remove tenant "${node.tenantId}" from ${node.environmentName}?`,
				{ modal: true },
				'Remove',
			);
			if (pick !== 'Remove') return;
			try {
				await environmentManager.removeTenant(node.environmentName, node.tenantId);
				treeProvider.removeTenant(node.environmentName, node.tenantId);
				uxBus.fire();
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to remove tenant: ${(e as Error).message}`);
			}
		}),
		vscode.commands.registerCommand('reltio.copyTenantId', async (node?: unknown) => {
			let tenantId = tenantIdFromTreeContext(node);
			if (!tenantId && treeView.selection.length > 0) {
				tenantId = tenantIdFromTreeContext(treeView.selection[0]);
			}
			if (!tenantId) return;
			try {
				await vscode.env.clipboard.writeText(tenantId);
				void vscode.window.setStatusBarMessage(`Copied tenant ID: ${tenantId}`, 3000);
			} catch (e) {
				void vscode.window.showErrorMessage(`Failed to copy tenant ID: ${(e as Error).message}`);
			}
		}),
		vscode.commands.registerCommand('reltio.browseEntities', async (node?: ConfigTreeItem) => {
			await browseEntitiesFromTree(node);
		}),
		vscode.commands.registerCommand('reltio.fetchL3', async (node?: TenantNode) => {
			if (!node || !environmentManager) return;
			const token = tokenStore.getToken(node.environmentName);
			if (!token) {
				void vscode.window.showErrorMessage('Provide a token for this environment first.');
				return;
			}

			if (node.hasL3) {
				const l3Uri = environmentManager.getL3Uri(node.environmentName, node.tenantId);
				await ensureDocumentSaved(l3Uri);
				const baselineUri = environmentManager.getRemoteBaselineUri(node.environmentName, node.tenantId);
				if (await hasUnpublishedLocalChanges(l3Uri, baselineUri)) {
					const pick = await vscode.window.showWarningMessage(
						`Local L3 configuration for "${node.tenantId}" has changes that haven't been applied to the tenant. Fetching will overwrite them with the server's configuration.`,
						{ modal: true },
						'Review changes',
						'Fetch anyway',
					);
					if (pick === undefined) {
						return;
					}
					if (pick === 'Review changes') {
						let remoteText: string;
						try {
							remoteText = await vscode.window.withProgress(
								{ location: vscode.ProgressLocation.Notification, title: 'Checking remote configuration…' },
								() => fetchL3Configuration(node.environmentName, node.tenantId, token),
							);
						} catch (e) {
							if (e instanceof ReltioApiError && e.statusCode === 401) {
								await handle401(node.environmentName);
								return;
							}
							void vscode.window.showErrorMessage((e as Error).message);
							return;
						}
						await openRemoteVsLocalDiff(remoteText, l3Uri, `Remote (server) ↔ Local L3 (${node.tenantId})`);
						const choice = await vscode.window.showInformationMessage(
							'Review the diff tab (remote vs local). "Fetch and overwrite" replaces your local file with the remote (left) version. "Apply my changes instead" pushes your local edits to the tenant.',
							{ modal: false },
							'Fetch and overwrite',
							'Apply my changes instead',
							'Cancel',
						);
						if (choice === 'Apply my changes instead') {
							const localBytes = await vscode.workspace.fs.readFile(l3Uri);
							const localText = new TextDecoder().decode(localBytes);
							await pushLocalToTenant(node, token, localText);
							return;
						}
						if (choice !== 'Fetch and overwrite') {
							return;
						}
					}
				}
			}

			const result = await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: 'Fetching L3 configuration…' },
				() => writeL3FromApi(node.environmentName, node.tenantId, token),
			);
			if (result === '401') {
				await handle401(node.environmentName);
			}
		}),
		vscode.commands.registerCommand('reltio.applyL3Configuration', async (node?: TenantNode) => {
			if (!node) return;
			await applyL3ConfigurationToTenant(node);
		}),
		vscode.commands.registerCommand('reltio.fetchConfigurationHistory', async (node?: TenantNode) => {
			if (!node?.hasL3 || !environmentManager) return;
			const lockKey = `${node.environmentName}::${node.tenantId}`;
			if (historyFetchLocks.has(lockKey)) return;
			const token = tokenStore.getToken(node.environmentName);
			if (!token) {
				void vscode.window.showErrorMessage('Provide a token for this environment first.');
				return;
			}
			historyFetchLocks.add(lockKey);
			try {
				await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: `Fetching configuration history (${node.tenantId})…`,
					},
					async () => {
						const historyDir = environmentManager.getHistoryDirectoryUri(
							node.environmentName,
							node.tenantId,
						);
						await clearHistoryDirectory(historyDir);
						let rows;
						try {
							rows = await fetchConfigurationHistory(
								node.environmentName,
								node.tenantId,
								token,
								0,
								HISTORY_PAGE_SIZE,
							);
						} catch (e) {
							if (e instanceof ReltioApiError && e.statusCode === 401) {
								await handle401(node.environmentName);
								return;
							}
							void vscode.window.showErrorMessage((e as Error).message);
							return;
						}
						for (const entry of rows) {
							await writeHistorySnapshot(historyDir, entry);
						}
						treeProvider.markHistoryExposed(node.environmentName, node.tenantId);
					},
				);
			} finally {
				historyFetchLocks.delete(lockKey);
			}
		}),
		vscode.commands.registerCommand('reltio.fetchMoreConfigurationHistory', async (node?: HistoryFolderNode) => {
			if (!node || !environmentManager) return;
			const lockKey = `${node.environmentName}::${node.tenantId}`;
			if (historyFetchLocks.has(lockKey)) return;
			const token = tokenStore.getToken(node.environmentName);
			if (!token) {
				void vscode.window.showErrorMessage('Provide a token for this environment first.');
				return;
			}
			historyFetchLocks.add(lockKey);
			try {
				await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: `Fetching more configuration history (${node.tenantId})…`,
					},
					async () => {
						const historyDir = environmentManager.getHistoryDirectoryUri(
							node.environmentName,
							node.tenantId,
						);
						const existing = await listLocalHistorySnapshots(historyDir);
						const offset = existing.length;
						let rows;
						try {
							rows = await fetchConfigurationHistory(
								node.environmentName,
								node.tenantId,
								token,
								offset,
								HISTORY_PAGE_SIZE,
							);
						} catch (e) {
							if (e instanceof ReltioApiError && e.statusCode === 401) {
								await handle401(node.environmentName);
								return;
							}
							void vscode.window.showErrorMessage((e as Error).message);
							return;
						}
						for (const entry of rows) {
							await writeHistorySnapshot(historyDir, entry);
						}
						treeProvider.markHistoryExposed(node.environmentName, node.tenantId);
					},
				);
			} finally {
				historyFetchLocks.delete(lockKey);
			}
		}),
		vscode.commands.registerCommand('reltio.historyCompareWithCurrent', async (node?: HistorySnapshotNode) => {
			if (!node || !environmentManager) return;
			const l3Uri = environmentManager.getL3Uri(node.environmentName, node.tenantId);
			const title = `${node.label} ↔ Current L3`;
			await vscode.commands.executeCommand('vscode.diff', node.fileUri, l3Uri, title);
		}),
		vscode.commands.registerCommand('reltio.historyCompareWithPrevious', async (node?: HistorySnapshotNode) => {
			if (!node || !environmentManager) return;
			const historyDir = environmentManager.getHistoryDirectoryUri(node.environmentName, node.tenantId);
			const snaps = await listLocalHistorySnapshots(historyDir);
			const older = immediateOlderSnapshot(snaps, node.fileUri);
			if (!older) {
				void vscode.window.showInformationMessage(
					'This is the oldest configuration snapshot on disk; there is no previous version to compare.',
				);
				return;
			}
			const title = `Previous snapshot ↔ ${node.label}`;
			await vscode.commands.executeCommand('vscode.diff', older.fileUri, node.fileUri, title);
		}),
		vscode.commands.registerCommand('reltio.historySelectForCompare', async (node?: HistorySnapshotNode) => {
			if (!node) return;
			await context.workspaceState.update(HISTORY_COMPARE_A_KEY, node.fileUri.toString());
			void vscode.window.showInformationMessage('First snapshot selected. Use “Compare selected” on another snapshot.');
		}),
		vscode.commands.registerCommand('reltio.historyCompareSelected', async (node?: HistorySnapshotNode) => {
			if (!node) return;
			const aStr = context.workspaceState.get<string>(HISTORY_COMPARE_A_KEY);
			if (!aStr) {
				void vscode.window.showWarningMessage('No snapshot selected. Use “Select for compare” on a snapshot first.');
				return;
			}
			const aUri = vscode.Uri.parse(aStr);
			const locA = tenantLocFromSnapshotOrL3Uri(aUri);
			const locB = tenantLocFromSnapshotOrL3Uri(node.fileUri);
			if (!locA || !locB || locA.environmentName !== locB.environmentName || locA.tenantId !== locB.tenantId) {
				void vscode.window.showErrorMessage('Compare two snapshots from the same tenant only.');
				return;
			}
			const title = 'History snapshot ↔ History snapshot';
			await vscode.commands.executeCommand('vscode.diff', aUri, node.fileUri, title);
			await context.workspaceState.update(HISTORY_COMPARE_A_KEY, undefined);
		}),
		vscode.commands.registerCommand('reltio.refreshEnvironment', async (node?: EnvironmentNode) => {
			if (!node) return;
			treeProvider.refreshEnvironment(node.environmentName);
		}),
		vscode.commands.registerCommand('reltio.signInEnvironment', async (node?: EnvironmentNode | { environmentName: string }) => {
			if (!node) return;
			const method = await vscode.window.showQuickPick(
				[
					{ label: 'Sign in with browser (recommended)', value: 'browser' as const },
					{ label: 'Paste a Bearer token', value: 'token' as const },
				],
				{ title: `Sign in to ${node.environmentName}` },
			);
			if (!method) return;
			if (method.value === 'browser') {
				if (!(await oauthCredentialsStore.hasClientCredentials(node.environmentName))) {
					await vscode.commands.executeCommand('reltio.configureOAuthClient', node);
				}
				await vscode.commands.executeCommand('reltio.loginWithBrowser', node);
			} else {
				await vscode.commands.executeCommand('reltio.provideToken', node);
			}
		}),
		vscode.commands.registerCommand('reltio.openL3', async (node?: TenantNode) => {
			if (!node || !environmentManager) return;
			const uri = environmentManager.getL3Uri(node.environmentName, node.tenantId);
			const doc = await vscode.workspace.openTextDocument(uri);
			await vscode.window.showTextDocument(doc);
		}),
		vscode.commands.registerCommand('reltio.openFirstAvailableL3', async () => {
			if (!environmentManager) return;
			const envs = await environmentManager.scanEnvironments();
			for (const env of envs) {
				for (const t of env.tenants) {
					if (!t.hasL3) continue;
					const uri = environmentManager.getL3Uri(env.name, t.tenantId);
					const doc = await vscode.workspace.openTextDocument(uri);
					await vscode.window.showTextDocument(doc);
					return;
				}
			}
			// No L3 file anywhere. Pick the best recovery action based on state.
			if (envs.length === 0) {
				const pick = await vscode.window.showWarningMessage(
					'Add a Reltio environment first.',
					'Launch Setup Wizard',
				);
				if (pick === 'Launch Setup Wizard') {
					await vscode.commands.executeCommand('reltio.launchSetupWizard');
				}
				return;
			}
			const authedEnvs = envs.filter(e => tokenStore.hasToken(e.name));
			if (authedEnvs.length === 0) {
				const pick = await vscode.window.showWarningMessage(
					'Sign in to an environment first.',
					'Sign In',
				);
				if (pick === 'Sign In') {
					await vscode.commands.executeCommand('reltio.signInToFirstEnvironment');
				}
				return;
			}
			const envsWithTenants = envs.filter(e => e.tenants.length > 0);
			if (envsWithTenants.length === 0) {
				const pick = await vscode.window.showWarningMessage(
					'Add a tenant first.',
					'Add Tenant',
				);
				if (pick === 'Add Tenant') {
					await vscode.commands.executeCommand('reltio.addTenant');
				}
				return;
			}
			// Envs + tenants exist but no L3 fetched yet
			void vscode.window.showInformationMessage(
				'No L3 has been fetched yet. Click a tenant in the Reltio tree to fetch its L3.',
			);
		}),
		vscode.commands.registerCommand('reltio.signInToFirstEnvironment', async () => {
			if (!environmentManager) return;
			const envs = await environmentManager.scanEnvironments();
			if (envs.length === 0) {
				const pick = await vscode.window.showWarningMessage(
					'Add a Reltio environment first.',
					'Launch Setup Wizard',
				);
				if (pick === 'Launch Setup Wizard') {
					await vscode.commands.executeCommand('reltio.launchSetupWizard');
				}
				return;
			}
			const unauthed = envs.find(e => !tokenStore.hasToken(e.name));
			if (!unauthed) {
				void vscode.window.showInformationMessage('All environments are already signed in.');
				return;
			}
			await vscode.commands.executeCommand('reltio.signInEnvironment', {
				environmentName: unauthed.name,
			});
		}),
		vscode.commands.registerCommand('reltio.quickSwitchEnvironment', async () => {
			if (!environmentManager) return;
			await quickSwitchEnvironment(environmentManager);
		}),
		vscode.commands.registerCommand('reltio.launchSetupWizard', async () => {
			if (!environmentManager) {
				void vscode.window.showErrorMessage('Open a workspace folder to use the setup wizard.');
				return;
			}
			await launchSetupWizard({
				context,
				environmentManager,
				tokenStore,
				sessionStore,
				oauthCredentialsStore,
				uxBus,
				normalizeEnvironmentName,
				writeL3FromApi,
				autoAddSsoTenant,
			});
		}),
		vscode.commands.registerCommand('reltio.openSetupGuide', () => {
			openSetupGuidePanel(context);
		}),
		vscode.commands.registerCommand('reltio.resetWalkthrough', async () => {
			// Reset our own first-install suppression flag.
			await context.globalState.update('reltio.walkthroughSeen', false);
			// Tell VS Code to mark every walkthrough step incomplete and re-open the walkthrough.
			// VS Code does not expose a stable public API for resetting walkthrough step completion,
			// so this is best-effort: we re-open the walkthrough and ask the user to confirm any
			// completed steps look unticked. If they don't, the user can dismiss and reload.
			try {
				await vscode.commands.executeCommand(
					'workbench.action.openWalkthrough',
					'reltio-community.reltio-metadata-editor#reltio.gettingStarted',
					true,
				);
			} catch (e) {
				void vscode.window.showWarningMessage(
					`Could not open the walkthrough: ${(e as Error).message}`,
				);
				return;
			}
			void vscode.window.showInformationMessage(
				'Walkthrough opened. If steps still appear complete, restart your VS Code / Cursor window — VS Code caches per-step completion globally.',
			);
		}),
		vscode.commands.registerCommand('reltio.resetTermsAcceptance', async () => {
			await resetTermsAcceptance(context);
			// Resetting acceptance without also revoking active sessions would be cosmetic — anyone already
			// signed in would keep working authenticated with no re-acceptance ever required. Sign everyone
			// out too, so the next action of any kind requires accepting the terms again.
			tokenStore.clearAll();
			const sessionEnvs = await sessionStore.listEnvironments();
			await Promise.all(sessionEnvs.map(env => sessionStore.deleteRefreshToken(env)));
			treeProvider.refresh();
			uxBus.fire();
			void vscode.window.showInformationMessage(
				'Terms of Use acceptance has been reset and all active sessions have been signed out. You will be asked to accept the terms and sign in again.',
			);
		}),
	);

	// ── Workflow Inspector ────────────────────────────────────────────────────
	// Register the read-only BPMN virtual document provider.
	const bpmnProvider = new BpmnContentProvider();
	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider(BPMN_SCHEME, bpmnProvider),
	);

	/**
	 * One place that turns a Workflow Adapter failure into a message and a
	 * recovery action.
	 *
	 * Extracted because the three call sites had drifted: `openWorkflowBpmn` had
	 * no 403 branch at all, so a permissions failure surfaced as a raw adapter
	 * response string. Returns `true` when the caller should treat the error as
	 * handled.
	 *
	 * The decision of *what* to say is `classifyWorkflowError()` in
	 * `workflowErrorReporting.ts` — a pure function with no `vscode` dependency,
	 * so its branch set (401/403/404-on-deploy/429/`WorkflowConnectionError`/
	 * `UntrustedHostError`/generic) is unit-testable on its own. This function is
	 * only the `vscode.window`/`vscode.commands` plumbing around that decision:
	 * showing the message, offering "Edit Adapter URL", and re-authenticating on
	 * a 401.
	 */
	async function reportWorkflowError(
		e: unknown,
		ctx: { environmentName: string; tenantId: string; operation: 'fetch' | 'open' | 'deploy' | 'register' },
	): Promise<boolean> {
		const action = classifyWorkflowError(e, ctx);
		if (action.kind === 'reauthenticate') {
			await handle401(ctx.environmentName);
			return true;
		}
		if (action.kind === 'message-with-edit-adapter-url') {
			const choice = await vscode.window.showErrorMessage(action.message, 'Edit Adapter URL');
			if (choice === 'Edit Adapter URL') {
				await vscode.commands.executeCommand('reltio.editWorkflowAdapterUrl', {
					environmentName: ctx.environmentName,
					tenantId: ctx.tenantId,
				});
			}
			return true;
		}
		void vscode.window.showErrorMessage(action.message);
		return true;
	}

	/**
	 * The half of the JAR refresh that is allowed to fail silently.
	 *
	 * `listAvailableJars()` depends on a `jarsLocation` tenant config that not
	 * every tenant has — confirmed live on a tenant with 6 working registered
	 * JARs and no S3 discovery at all. Any failure here (the known
	 * `notConfigured` case, an unexpected error code, or a network failure) must
	 * not fail the surrounding "refresh JARs" action, which is why this is a
	 * standalone function with its own catch rather than inline in the two
	 * callers: getting that swallow-everything behaviour right once, here, beats
	 * re-deriving it at each call site.
	 *
	 * @returns The JARs on S3 that are not already in `registeredJars` (by
	 *          `module`), or `undefined` when discovery isn't available.
	 */
	async function fetchUnregisteredJars(
		adapterUrl: string,
		tenantId: string,
		environmentUrl: string,
		token: string,
		registeredJars: readonly JarDeployment[],
	): Promise<AvailableJar[] | undefined> {
		try {
			const result = await listAvailableJars(adapterUrl, tenantId, environmentUrl, token);
			if (result.kind !== 'ok') return undefined;
			const registeredModules = new Set(registeredJars.map(j => j.module));
			return result.jars.filter(j => !registeredModules.has(j.module));
		} catch {
			return undefined;
		}
	}

	/**
	 * Core fetch helper — shared by fetchWorkflows and refreshWorkflows.
	 * Returns `false` and shows an appropriate error message on failure so the
	 * command handler can abort without duplicating error-display logic.
	 */
	async function doFetchWorkflows(
		environmentName: string,
		tenantId: string,
		adapterUrl: string,
	): Promise<boolean> {
		const token = tokenStore.getToken(environmentName);
		if (!token) {
			void vscode.window.showErrorMessage('Provide a token for this environment before fetching workflows.');
			return false;
		}
		// Claimed before the network call starts, so an overlapping fetch of the same kind for the
		// same tenant (e.g. a deploy's own post-deploy re-fetch) cannot have its newer result
		// clobbered by this one resolving later — see `markWorkflowsLoaded()`.
		const generation = treeProvider.beginWorkflowFetch('workflows', environmentName, tenantId);
		let result: [ProcessDefinition[], JarDeployment[]] | undefined;
		let unregisteredJars: AvailableJar[] | undefined;

		try {
			// environmentName is stored as a bare hostname (e.g. demo-01.reltio.com) after
			// normalizeEnvironmentName() strips the scheme. The Workflow Adapter's
			// EnvironmentURL header requires the full https:// URL — toHttpsBase() adds the
			// scheme. It must stay inside this try: environmentName comes from a workspace
			// folder name, so a folder like `evil.com.reltio.environment` makes it throw
			// UntrustedHostError, and outside the try that surfaces as an unhandled command
			// failure instead of the handled message below.
			const environmentUrl = toHttpsBase(environmentName);
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Fetching workflows for ${tenantId}…`,
					cancellable: false,
				},
				async () => {
					result = await Promise.all([
						listProcessDefinitions(adapterUrl, tenantId, environmentUrl, token),
						listJarDeployments(adapterUrl, tenantId, environmentUrl, token),
					]);
					unregisteredJars = await fetchUnregisteredJars(
						adapterUrl, tenantId, environmentUrl, token, result[1],
					);
				},
			);
		} catch (e) {
			await reportWorkflowError(e, { environmentName, tenantId, operation: 'fetch' });
			return false;
		}

		if (!result) return false; // withProgress was cancelled (shouldn't happen; cancellable: false)
		const [definitions, jars] = result;
		treeProvider.markWorkflowsLoaded(environmentName, tenantId, definitions, jars, unregisteredJars, generation);
		await refreshWorkflowRepoSyncState(environmentName, tenantId);
		return true;
	}

	/**
	 * Refresh only the process-definition list.
	 *
	 * The two lists come from independent endpoints, so standing on Process
	 * Definitions and wanting fresh data should cost one call, not two.
	 */
	async function doFetchProcessDefinitions(
		environmentName: string,
		tenantId: string,
		adapterUrl: string,
	): Promise<boolean> {
		const token = tokenStore.getToken(environmentName);
		if (!token) {
			void vscode.window.showErrorMessage('Provide a token for this environment before fetching workflows.');
			return false;
		}
		// See `doFetchWorkflows()` — claimed before the fetch starts so a slower, earlier-started
		// refresh cannot overwrite a faster, later-started one (e.g. a post-deploy re-fetch).
		const generation = treeProvider.beginWorkflowFetch('processDefinitions', environmentName, tenantId);
		let definitions: ProcessDefinition[] | undefined;
		try {
			const environmentUrl = toHttpsBase(environmentName);
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Refreshing BPMNs for ${tenantId}…`,
					cancellable: false,
				},
				async () => {
					definitions = await listProcessDefinitions(adapterUrl, tenantId, environmentUrl, token);
				},
			);
		} catch (e) {
			await reportWorkflowError(e, { environmentName, tenantId, operation: 'fetch' });
			return false;
		}
		if (!definitions) return false;
		treeProvider.markProcessDefinitionsLoaded(environmentName, tenantId, definitions, generation);
		await refreshWorkflowRepoSyncState(environmentName, tenantId);
		return true;
	}

	/** Refresh only the registered-JAR list. */
	async function doFetchJarDeployments(
		environmentName: string,
		tenantId: string,
		adapterUrl: string,
	): Promise<boolean> {
		const token = tokenStore.getToken(environmentName);
		if (!token) {
			void vscode.window.showErrorMessage('Provide a token for this environment before fetching workflows.');
			return false;
		}
		// See `doFetchWorkflows()`.
		const generation = treeProvider.beginWorkflowFetch('jarDeployments', environmentName, tenantId);
		let jars: JarDeployment[] | undefined;
		let unregisteredJars: AvailableJar[] | undefined;
		try {
			const environmentUrl = toHttpsBase(environmentName);
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Refreshing JARs for ${tenantId}…`,
					cancellable: false,
				},
				async () => {
					jars = await listJarDeployments(adapterUrl, tenantId, environmentUrl, token);
					unregisteredJars = await fetchUnregisteredJars(
						adapterUrl, tenantId, environmentUrl, token, jars,
					);
				},
			);
		} catch (e) {
			await reportWorkflowError(e, { environmentName, tenantId, operation: 'fetch' });
			return false;
		}
		if (!jars) return false;
		treeProvider.markJarDeploymentsLoaded(environmentName, tenantId, jars, unregisteredJars, generation);
		return true;
	}

	/**
	 * Try the `{env}-workflow.<rest>` naming-convention guess (see
	 * `guessWorkflowAdapterUrl`) before falling back to asking the user.
	 *
	 * Requires a token for the environment — confirming the guess means
	 * actually calling it. Silent on any failure: this is a convenience, and
	 * the manual prompt right after it is the real fallback, unchanged either
	 * way.
	 */
	async function discoverAndSaveAdapterUrl(
		environmentName: string,
		tenantId: string,
		configUri: vscode.Uri,
	): Promise<string | undefined> {
		const token = tokenStore.getToken(environmentName);
		if (!token) return undefined;

		let guessed: string | undefined;
		try {
			guessed = await guessWorkflowAdapterUrl(
				environmentName, tenantId, toHttpsBase(environmentName), token,
			);
		} catch {
			return undefined;
		}
		if (!guessed) return undefined;

		await saveWorkflowAdapterUrl(configUri, guessed);
		void vscode.window.showInformationMessage(
			`Found the Workflow Adapter URL for "${tenantId}" automatically: ${guessed}`,
		);
		return guessed;
	}

	/**
	 * Ask which of the bundled candidates to use for an environment the source
	 * mapping answers two ways (see `AMBIGUOUS_ADAPTERS`).
	 *
	 * Deliberately a question rather than a default. Both candidate hosts are
	 * real and answer like an Adapter, so `guessWorkflowAdapterUrl()` would
	 * confirm whichever it tried first and the user would never learn that the
	 * other one existed.
	 */
	async function pickAmbiguousAdapterHost(
		environmentName: string,
		candidates: readonly string[],
	): Promise<string | undefined> {
		return vscode.window.showQuickPick([...candidates], {
			title: `Workflow Adapter for ${environmentName}`,
			placeHolder: 'Two adapters are documented for this environment — choose the one it uses.',
			ignoreFocusOut: true,
		});
	}

	/**
	 * Resolve and persist a tenant's Workflow Adapter URL.
	 *
	 * Order is bundled registry, then the naming-convention guess, then asking.
	 * The registry comes first because it is instant, needs no token, and is
	 * right about the cases the guess is wrong about — shared adapters serving
	 * several environments, and hosts that use `-workflow-adapter` or a
	 * different domain.
	 *
	 * A bundled host is passed through `toHttpsBase()` like any hand-typed one,
	 * so shipping a host grants it no trust. When the allowlist refuses it (the
	 * `reltiocn.cn` entries, until an operator extends
	 * `reltio.trustedHostSuffixes`) the prompt opens pre-filled with that host,
	 * so the message and the value it refers to are on screen together.
	 */
	async function resolveAndSaveAdapterUrl(
		environmentName: string,
		tenantId: string,
		configUri: vscode.Uri,
	): Promise<string | undefined> {
		const known = lookupWorkflowAdapterUrl(environmentName);
		const knownHost = known === undefined
			? undefined
			: known.kind === 'url'
				? known.host
				: await pickAmbiguousAdapterHost(environmentName, known.candidates);

		if (knownHost) {
			try {
				const validated = toHttpsBase(knownHost);
				await saveWorkflowAdapterUrl(configUri, validated);
				void vscode.window.showInformationMessage(
					`Using the documented Workflow Adapter for "${environmentName}": ${validated}`,
				);
				return validated;
			} catch (e) {
				void vscode.window.showErrorMessage((e as Error).message);
				return promptAndSaveAdapterUrl(environmentName, tenantId, knownHost);
			}
		}

		// Not on the table, or ambiguous and the user dismissed the choice. Only
		// try the guess in the former case: an ambiguous environment is precisely
		// where a confirmed-but-wrong guess does damage.
		if (known === undefined) {
			const guessed = await discoverAndSaveAdapterUrl(environmentName, tenantId, configUri);
			if (guessed) return guessed;
		}
		return promptAndSaveAdapterUrl(environmentName, tenantId);
	}

	/** Prompt for the Adapter URL when none is saved, then validate and persist it. */
	async function promptAndSaveAdapterUrl(
		environmentName: string,
		tenantId: string,
		currentValue?: string,
	): Promise<string | undefined> {
		if (!environmentManager) return undefined;
		const configUri = environmentManager.getWorkflowAdapterConfigUri(environmentName, tenantId);

		const input = await vscode.window.showInputBox({
			title: `Workflow Adapter URL for ${tenantId}`,
			prompt: 'Enter the base URL of the Reltio Workflow Adapter service (e.g. https://demo-01-workflow.reltio.com).',
			value: currentValue ?? '',
			ignoreFocusOut: true,
			validateInput(value) {
				const trimmed = value.trim();
				if (!trimmed) return 'URL is required.';
				try {
					toHttpsBase(trimmed);
					return undefined; // valid
				} catch (e) {
					return (e as Error).message;
				}
			},
		});

		if (!input) return undefined;

		// Run the allowlist check one final time (in case validateInput was skipped).
		let validated: string;
		try {
			validated = toHttpsBase(input.trim());
		} catch (e) {
			void vscode.window.showErrorMessage((e as Error).message);
			return undefined;
		}

		await saveWorkflowAdapterUrl(configUri, validated);
		return validated;
	}

	context.subscriptions.push(
		/**
		 * reltio.fetchWorkflows
		 * Triggered by clicking the "Workflows" folder (when no URL is saved) or the
		 * "Fetch Workflows…" action row. Prompts for the Adapter URL if not yet saved,
		 * then fetches both lists and populates the tree.
		 */
		vscode.commands.registerCommand(
			'reltio.fetchWorkflows',
			async (node?: WorkflowsFolderNode | WorkflowFetchActionNode) => {
				if (!node || !environmentManager) return;
				const configUri = environmentManager.getWorkflowAdapterConfigUri(
					node.environmentName,
					node.tenantId,
				);

				let adapterUrl = await loadWorkflowAdapterUrl(configUri);
				if (!adapterUrl) {
					adapterUrl = await resolveAndSaveAdapterUrl(
						node.environmentName,
						node.tenantId,
						configUri,
					);
					if (!adapterUrl) return;
					// Refresh the tree now that a URL has been saved (folder becomes collapsible).
					treeProvider.invalidate();
				}

				// After a window reload this row reappears with local files still on
				// disk, so the same overwrite guard applies as on an explicit refresh.
				if (!(await guardBeforeWorkflowRefresh(node.environmentName, node.tenantId))) return;
				if (!(await doFetchWorkflows(node.environmentName, node.tenantId, adapterUrl))) return;
				const ctx = await workflowCallContext(node.environmentName, node.tenantId);
				if (ctx) await refreshLocalBpmnCopies(node.environmentName, node.tenantId, ctx, false);
			},
		),

		/**
		 * reltio.refreshWorkflows
		 * Explicit "refresh" from the context menu on the Workflows folder. Uses the
		 * already-saved URL — does not re-prompt.
		 */
		vscode.commands.registerCommand(
			'reltio.refreshWorkflows',
			// Reachable from the Workflows folder and from each of its sub-folders —
			// looking at Process Definitions and wanting a refresh should not mean
			// walking back up a level to find the action.
			async (node?: WorkflowsFolderNode | ProcessDefinitionsFolderNode | JarDeploymentsFolderNode | WorkflowDraftsFolderNode) => {
				if (!node || !environmentManager) return;
				const configUri = environmentManager.getWorkflowAdapterConfigUri(
					node.environmentName,
					node.tenantId,
				);
				const adapterUrl = await loadWorkflowAdapterUrl(configUri);
				if (!adapterUrl) {
					// No URL saved — fall back to the fetch command which will prompt.
					await vscode.commands.executeCommand('reltio.fetchWorkflows', node);
					return;
				}
				if (!(await guardBeforeWorkflowRefresh(node.environmentName, node.tenantId))) return;
				if (!(await doFetchWorkflows(node.environmentName, node.tenantId, adapterUrl))) return;
				const ctx = await workflowCallContext(node.environmentName, node.tenantId);
				if (ctx) await refreshLocalBpmnCopies(node.environmentName, node.tenantId, ctx, false);
			},
		),

		/**
		 * reltio.refreshProcessDefinitions
		 * Refreshes the BPMN list only — one endpoint, one call.
		 */
		vscode.commands.registerCommand(
			'reltio.refreshProcessDefinitions',
			async (node?: { environmentName: string; tenantId: string }) => {
				if (!node || !environmentManager) return;
				const { environmentName, tenantId } = node;
				if (!(await guardBeforeWorkflowRefresh(environmentName, tenantId))) return;
				const ctx = await workflowCallContext(environmentName, tenantId);
				if (!ctx) return;
				if (!(await doFetchProcessDefinitions(environmentName, tenantId, ctx.adapterUrl))) return;
				await refreshLocalBpmnCopies(environmentName, tenantId, ctx, false);
			},
		),

		/**
		 * reltio.refreshJarDeployments
		 * Refreshes the registered-JAR list only.
		 */
		vscode.commands.registerCommand(
			'reltio.refreshJarDeployments',
			async (node?: { environmentName: string; tenantId: string }) => {
				if (!node || !environmentManager) return;
				const adapterUrl = await loadWorkflowAdapterUrl(
					environmentManager.getWorkflowAdapterConfigUri(node.environmentName, node.tenantId),
				);
				if (!adapterUrl) {
					void vscode.window.showErrorMessage('No Workflow Adapter URL saved. Run "Fetch Workflows" first.');
					return;
				}
				await doFetchJarDeployments(node.environmentName, node.tenantId, adapterUrl);
			},
		),

		/**
		 * reltio.copyJarModulePath
		 * The module path is the value needed to reference a registered JAR
		 * anywhere else, and it is too long to retype from the tooltip.
		 */
		vscode.commands.registerCommand(
			'reltio.copyJarModulePath',
			async (node?: JarDeploymentNode) => {
				if (!node) return;
				await vscode.env.clipboard.writeText(node.deployment.module);
				void vscode.window.showInformationMessage(
					`Copied JAR module path: ${node.deployment.module}`,
				);
			},
		),

		/**
		 * reltio.registerJarDeployment
		 * Turns an S3 JAR the "Unregistered" subfolder found into a live
		 * `JarDeployment`. This is the step `workflow-repo-contribution`'s SKILL
		 * used to describe as "either you via the registration API or Reltio's
		 * workflow team" — now doable from the tree without a hand-built request.
		 *
		 * Takes a tree node or a `WorkflowCommandArgs` object (`module`, `name`,
		 * `description`), so the same command serves a click and an agent that
		 * already knows which JAR to register and what to call it.
		 */
		vscode.commands.registerCommand(
			'reltio.registerJarDeployment',
			async (arg?: UnregisteredJarNode | WorkflowCommandArgs) => {
				if (!environmentManager) return;

				let environmentName: string;
				let tenantId: string;
				let jarModule: string;
				let prefilledName: string | undefined;
				let prefilledDescription: string | undefined;

				if (arg instanceof UnregisteredJarNode) {
					({ environmentName, tenantId } = arg);
					jarModule = arg.jar.module;
				} else {
					const args = workflowCommandArgs(arg);
					if (!args) return;
					const target = await resolveWorkflowTenant(args);
					if (!target) return;
					({ environmentName, tenantId } = target);

					const jar = await pickUnregisteredJar(environmentName, tenantId, args.module);
					if (!jar) return;
					jarModule = jar.module;
					prefilledName = args.name;
					prefilledDescription = args.description;
				}

				const adapterUrl = await loadWorkflowAdapterUrl(
					environmentManager.getWorkflowAdapterConfigUri(environmentName, tenantId),
				);
				if (!adapterUrl) {
					void vscode.window.showErrorMessage('No Workflow Adapter URL saved. Run "Fetch Workflows" first.');
					return;
				}
				const token = tokenStore.getToken(environmentName);
				if (!token) {
					void vscode.window.showErrorMessage('Provide a token for this environment before registering a JAR.');
					return;
				}

				// A supplied name is still validated, not trusted outright — an
				// agent's guess is as capable of colliding (errorCode 10055) or being
				// blank after trimming as one typed by hand.
				const name = prefilledName?.trim()
					? prefilledName.trim()
					: await vscode.window.showInputBox({
						title: `Register JAR on ${tenantId}`,
						prompt: 'Name — how this JAR will be identified under JAR Deployments.',
						value: jarModuleFileName(jarModule),
						ignoreFocusOut: true,
						validateInput(value) {
							return value.trim() ? undefined : 'A name is required.';
						},
					});
				if (!name) return;
				// Optional field: unlike `name` above, an empty or cancelled entry here
				// is not a reason to abort — registration proceeds either way.
				const description = prefilledDescription !== undefined
					? prefilledDescription
					: await vscode.window.showInputBox({
						title: `Register JAR on ${tenantId}`,
						prompt: 'Description (optional)',
						ignoreFocusOut: true,
					});

				try {
					const environmentUrl = toHttpsBase(environmentName);
					await vscode.window.withProgress(
						{
							location: vscode.ProgressLocation.Notification,
							title: `Registering "${name.trim()}" on ${tenantId}…`,
							cancellable: false,
						},
						() => registerJarDeployment(adapterUrl, tenantId, environmentUrl, token, {
							module: jarModule,
							name: name.trim(),
							description: description?.trim() || undefined,
						}),
					);
				} catch (e) {
					await reportWorkflowError(e, { environmentName, tenantId, operation: 'register' });
					return;
				}

				await doFetchJarDeployments(environmentName, tenantId, adapterUrl);
				void vscode.window.showInformationMessage(`Registered "${name.trim()}" on ${tenantId}.`);
			},
		),

		/**
		 * reltio.editWorkflowAdapterUrl
		 * Context-menu recovery action: lets the user correct a wrong Adapter URL
		 * without hunting through settings. Pre-fills the current saved value.
		 *
		 * Also accepts a `WorkflowCommandArgs` object with `adapterUrl`, so an
		 * agent that already knows the correct URL (from a prior error message
		 * naming it, or from being told directly) can save it without opening a
		 * prompt only a human can answer.
		 */
		vscode.commands.registerCommand(
			'reltio.editWorkflowAdapterUrl',
			async (arg?: WorkflowsFolderNode | WorkflowCommandArgs) => {
				if (!environmentManager) return;
				const args = workflowCommandArgs(arg);
				if (!args) return;
				const target = await resolveWorkflowTenant(args);
				if (!target) return;
				const { environmentName, tenantId } = target;

				const configUri = environmentManager.getWorkflowAdapterConfigUri(environmentName, tenantId);
				const current = await loadWorkflowAdapterUrl(configUri);

				let newUrl: string | undefined;
				if (args.adapterUrl?.trim()) {
					// Supplied outright: still validated and still saved through the
					// same allowlist check a typed value takes, not trusted just
					// because it did not come from a prompt.
					try {
						newUrl = toHttpsBase(args.adapterUrl.trim());
						await saveWorkflowAdapterUrl(configUri, newUrl);
					} catch (e) {
						void vscode.window.showErrorMessage((e as Error).message);
						return;
					}
				} else {
					newUrl = await promptAndSaveAdapterUrl(environmentName, tenantId, current);
				}
				if (!newUrl) return;
				// Immediately re-fetch with the corrected URL.
				await doFetchWorkflows(environmentName, tenantId, newUrl);
			},
		),

		/**
		 * reltio.openWorkflowBpmn
		 * Opens the BPMN XML for one process type in a read-only virtual document.
		 * The XML is fetched on demand (not at tree-load time) so large XMLs don't
		 * slow down the initial Workflows fetch.
		 */
		vscode.commands.registerCommand(
			'reltio.openWorkflowBpmn',
			async (node?: ProcessDefinitionNode) => {
				if (!node || !environmentManager) return;
				const { environmentName, tenantId } = node;
				const processId = node.definition.type;

				// Settle any other BPMN in this tenant that has undeployed edits before
				// moving on to this one, so a pending change cannot be abandoned by
				// simply clicking elsewhere.
				if (!(await guardPendingBpmnChanges(environmentName, tenantId, processId))) return;

				const localUri = environmentManager.getWorkflowBpmnUri(environmentName, tenantId, processId);
				const localText = await readTextFile(localUri);
				const baselineText = await readTextFile(
					environmentManager.getWorkflowBpmnBaselineUri(environmentName, tenantId, processId),
				);

				// Already downloaded: open what is on disk rather than silently
				// replacing the user's edits. Re-downloading is an explicit action.
				if (localText !== undefined) {
					if (hasLocalBpmnChanges(localText, baselineText)) {
						const pick = await vscode.window.showWarningMessage(
							`"${processId}" has local changes that have not been deployed.`,
							{ modal: true },
							'Open local version',
							'Review changes',
							'Discard and fetch fresh',
						);
						if (pick === undefined) return;
						if (pick === 'Review changes') {
							await openBpmnLocalVsBaselineDiff(environmentName, tenantId, processId);
							return;
						}
						if (pick === 'Discard and fetch fresh') {
							const ctx = await workflowCallContext(environmentName, tenantId);
							if (!ctx) return;
							const fresh = await downloadBpmn(environmentName, tenantId, processId, ctx);
							if (!fresh) return;
							await vscode.window.showTextDocument(
								await vscode.workspace.openTextDocument(fresh), { preview: false },
							);
							return;
						}
					}
					await vscode.window.showTextDocument(
						await vscode.workspace.openTextDocument(localUri), { preview: false },
					);
					return;
				}

				// First open: fetch, write the editable copy and its baseline.
				const ctx = await workflowCallContext(environmentName, tenantId);
				if (!ctx) return;
				const fileUri = await downloadBpmn(environmentName, tenantId, processId, ctx);
				if (!fileUri) return;
				await vscode.window.showTextDocument(
					await vscode.workspace.openTextDocument(fileUri), { preview: false },
				);
			},
		),
	);

	// ── BPMN authoring ────────────────────────────────────────────────────────

	/** Adapter URL + token + environment URL for one tenant, or undefined with a message shown. */
	async function workflowCallContext(
		environmentName: string,
		tenantId: string,
	): Promise<{ adapterUrl: string; token: string; environmentUrl: string } | undefined> {
		if (!environmentManager) return undefined;
		const token = tokenStore.getToken(environmentName);
		if (!token) {
			void vscode.window.showErrorMessage('Provide a token for this environment first.');
			return undefined;
		}
		// A Git-sourced workspace holds a sentinel, not a Reltio token. It is harmless on the wire
		// (only allowlisted hosts are contacted) but every call would fail with a confusing 401, so
		// say what is actually true instead.
		if (token === GIT_SOURCE_TOKEN) {
			void vscode.window.showErrorMessage(
				'Workflows need a connected tenant. This workspace was opened from a Git repository, so there is no tenant to deploy to.',
			);
			return undefined;
		}
		const adapterUrl = await loadWorkflowAdapterUrl(
			environmentManager.getWorkflowAdapterConfigUri(environmentName, tenantId),
		);
		if (!adapterUrl) {
			void vscode.window.showErrorMessage('No Workflow Adapter URL saved. Run "Fetch Workflows" first.');
			return undefined;
		}
		// environmentName comes from a workspace folder name, so a folder such as
		// `evil.com.reltio.environment` makes this throw UntrustedHostError. Every
		// caller treats `undefined` as "already reported and handled"; letting the
		// throw escape instead surfaces as an unhandled command failure, which is
		// the exact defect the Part 1 review fixed in the two fetch handlers.
		let environmentUrl: string;
		try {
			environmentUrl = toHttpsBase(environmentName);
		} catch (e) {
			void vscode.window.showErrorMessage((e as Error).message);
			return undefined;
		}
		return { adapterUrl, token, environmentUrl };
	}

	/**
	 * D5's sync badge, recomputed for every deployed definition whose process id
	 * matches a file `discoverBpmnFiles()` finds in the connected Custom Workflow
	 * Repository. Called after Fetch Workflows, after Refresh (Process Definitions)
	 * — which a successful Deploy also triggers — and by the manual
	 * `reltio.refreshWorkflowRepoSync` command. Never on a filesystem watcher: see
	 * design.md D5/4.3.
	 *
	 * No repository connected is the common case and must stay silent and cheap —
	 * checked before `workflowCallContext()`, which shows an error toast on a
	 * missing token/Adapter URL that would otherwise fire on every fetch for every
	 * tenant that has never connected one.
	 */
	async function refreshWorkflowRepoSyncState(environmentName: string, tenantId: string): Promise<void> {
		if (!environmentManager) return;
		// Claimed up front, before any of the awaits below, so a disconnect (or another sync
		// recomputation) started after this one wins regardless of which finishes first — see
		// `markWorkflowRepoSync()`.
		const generation = treeProvider.beginWorkflowFetch('repoSync', environmentName, tenantId);
		const repoConfigUri = environmentManager.getWorkflowRepoConfigUri(environmentName, tenantId);
		const config = await loadWorkflowRepoConfig(repoConfigUri);
		if (!config) {
			treeProvider.markWorkflowRepoSync(environmentName, tenantId, undefined, new Map(), [], [], generation);
			return;
		}

		const repoDir = environmentManager.getWorkflowRepoDirectoryUri(environmentName, tenantId);
		// Both walks happen before the tenant call below, and Java discovery is purely
		// local — so the Java groups populate even on a tenant whose Adapter URL or
		// token is missing, where `workflowCallContext()` returns nothing and no badge
		// can be computed. A provisioned repository is mostly Java; its contents should
		// not be hostage to the sync comparison succeeding.
		const [discovery, javaSources] = await Promise.all([
			discoverBpmnFilesDetailed(repoDir),
			discoverJavaSources(repoDir),
		]);
		const discovered = discovery.files;
		noteTruncatedDiscovery(environmentName, tenantId, discovery.truncated);

		const ctx = await workflowCallContext(environmentName, tenantId);
		const definitionTypes = new Set(
			treeProvider.getCachedProcessDefinitions(environmentName, tenantId).map(d => d.type),
		);

		const sync = new Map<string, RepoSyncState>();
		if (ctx) {
			for (const file of discovered) {
				if (!definitionTypes.has(file.processId)) continue;
				try {
					const [repoText, deployedXml] = await Promise.all([
						readTextFile(file.fileUri),
						getProcessDefinitionXml(
							ctx.adapterUrl, tenantId, ctx.environmentUrl, ctx.token, file.processId,
						),
					]);
					if (repoText === undefined) continue;
					sync.set(file.processId, compareBpmnContent(repoText, deployedXml));
				} catch {
					// One definition's comparison failing (deleted on the tenant since
					// discovery, a network hiccup) must not block the rest — it simply
					// keeps no cached state, which the tree renders as no badge.
				}
			}
		}
		treeProvider.markWorkflowRepoSync(
			environmentName,
			tenantId,
			discovered.length,
			sync,
			discovered,
			javaSources,
			generation,
		);
	}

	const truncationReported = new Set<string>();
	function noteTruncatedDiscovery(environmentName: string, tenantId: string, truncated: boolean): void {
		const key = `${environmentName}/${tenantId}`;
		if (!truncated || truncationReported.has(key)) return;
		truncationReported.add(key);
		void vscode.window.showWarningMessage(
			`The Custom Workflow Repository for "${tenantId}" has more XML files than are scanned, so some BPMN files may not be listed.`,
		);
	}

	/**
	 * Fill the repository row from disk alone — no tenant call, no token — so a connected repository
	 * is populated on the first render after a window reload instead of waiting for Fetch or Refresh
	 * Sync. Keeps whatever sync badges were already computed.
	 */
	async function refreshWorkflowRepoLocalState(environmentName: string, tenantId: string): Promise<void> {
		if (!environmentManager) return;
		const config = await loadWorkflowRepoConfig(environmentManager.getWorkflowRepoConfigUri(environmentName, tenantId));
		if (!config) return;
		const repoDir = environmentManager.getWorkflowRepoDirectoryUri(environmentName, tenantId);
		const [discovery, javaSources] = await Promise.all([
			discoverBpmnFilesDetailed(repoDir),
			discoverJavaSources(repoDir),
		]);
		noteTruncatedDiscovery(environmentName, tenantId, discovery.truncated);
		treeProvider.markWorkflowRepoFilesDiscovered(environmentName, tenantId, discovery.files, javaSources);
	}
	treeProvider.setInvalidRepoConfigHandler((_environmentName, tenantId, reason) => {
		void vscode.window.showWarningMessage(
			`The Custom Workflow Repository settings for "${tenantId}" were ignored: ${reason}`,
		);
	});
	treeProvider.setWorkflowRepoDiscoveryHandler((environmentName, tenantId) => {
		void refreshWorkflowRepoLocalState(environmentName, tenantId).catch(err =>
			console.error('Reltio repository discovery failed:', err),
		);
	});

	/**
	 * Ask for a process id, refusing invalid and already-taken ones.
	 *
	 * Asked before anything is written, deliberately. The id is the workflow's
	 * identity on the tenant and the filename derives from it, so a placeholder to
	 * be replaced later would either deploy as a real process type or force a
	 * rename that breaks the draft's path-derived tenant context.
	 */
	async function promptForProcessId(
		environmentName: string,
		tenantId: string,
		defaultValue: string,
		deployed: readonly { type: string; generic: boolean }[],
	): Promise<string | undefined> {
		const drafts = await listWorkflowDrafts(
			environmentManager!.getWorkflowDraftsDirectoryUri(environmentName, tenantId),
		);
		const takenByDraft = new Set(drafts.map(d => d.processId));

		const processId = await vscode.window.showInputBox({
			title: `New workflow on ${tenantId}`,
			prompt: 'ID — the technical identifier the system uses: it becomes the file name and the workflow’s identity on the tenant.',
			value: defaultValue,
			ignoreFocusOut: true,
			validateInput(value) {
				const message = processIdValidationMessage(value);
				if (message) return message;
				if (takenByDraft.has(value.trim())) return 'A draft with this ID already exists.';
				return undefined;
			},
		});
		if (!processId) return undefined;
		const trimmed = processId.trim();

		// Deploying a BPMN whose id already exists does not create a new workflow —
		// it creates the next *version* of the live one. Worth a modal, especially
		// when the collision is with a Reltio built-in.
		const clash = deployed.find(d => d.type === trimmed);
		if (clash) {
			const confirm = await vscode.window.showWarningMessage(
				clash.generic
					? `"${trimmed}" is a Reltio built-in workflow already deployed on this tenant. Deploying a draft with this ID would replace it with a new version, for everyone using this tenant.`
					: `"${trimmed}" is already deployed on this tenant. Deploying a draft with this ID would create a new version of it rather than a new workflow.`,
				{ modal: true },
				'Use this ID anyway',
			);
			if (confirm !== 'Use this ID anyway') return undefined;
		}
		return trimmed;
	}

	/**
	 * Write a new BPMN, open it, and reveal it in the tree.
	 *
	 * Routes to the connected Custom Workflow Repository instead of Drafts when the
	 * tenant has one. Drafts exist for tenants with nowhere else to put a BPMN being
	 * shaped — once a repository is connected, that *is* the somewhere else, and a
	 * self-service file an agent or the user creates belongs with the rest of what the
	 * repository already tracks, not in a side folder they would otherwise have to move
	 * it out of by hand. Both `reltio.newWorkflowDraft` and `reltio.duplicateWorkflowDraft`
	 * share this through a single call site, so neither can drift from the other.
	 */
	async function createDraft(
		environmentName: string,
		tenantId: string,
		processId: string,
		xml: string,
	): Promise<void> {
		const repoConfig = await loadWorkflowRepoConfig(
			environmentManager!.getWorkflowRepoConfigUri(environmentName, tenantId),
		);
		if (repoConfig) {
			await createInConnectedRepo(environmentName, tenantId, processId, xml);
			return;
		}
		const fileUri = await writeWorkflowDraft(
			environmentManager!.getWorkflowDraftsDirectoryUri(environmentName, tenantId),
			draftFileName(processId),
			xml,
		);
		treeProvider.notifyWorkflowDraftsChanged();
		const doc = await vscode.workspace.openTextDocument(fileUri);
		await vscode.window.showTextDocument(doc, { preview: false });
		try {
			const drafts = await listWorkflowDrafts(
				environmentManager!.getWorkflowDraftsDirectoryUri(environmentName, tenantId),
			);
			const draft = drafts.find(d => d.processId === processId);
			if (draft) {
				await treeView.reveal(new WorkflowDraftNode(environmentName, tenantId, draft), {
					select: true,
				});
			}
		} catch {
			// Reveal is a convenience; the draft is written and open either way.
		}
	}

	/**
	 * `createDraft()`'s repository-connected path. Written at the repository root rather
	 * than inside any particular Maven module: D6 already discovers BPMN by content at
	 * any depth, including entirely outside every module, so there is no "correct" module
	 * to guess, and placing it at the root keeps a brand-new file visible without the
	 * module/package structure the Java side cares about but a lone BPMN does not.
	 *
	 * Refuses rather than overwrites when the process id already belongs to a file the
	 * repository tracks — two files both claiming the same `<process id>` is a collision
	 * `promptForProcessId()`'s own checks (Drafts, deployed) cannot see, since neither
	 * walks the repository.
	 */
	async function createInConnectedRepo(
		environmentName: string,
		tenantId: string,
		processId: string,
		xml: string,
	): Promise<void> {
		const repoDir = environmentManager!.getWorkflowRepoDirectoryUri(environmentName, tenantId);
		const { files: discovered } = await discoverBpmnFilesDetailed(repoDir);
		const existing = discovered.find(f => f.processId === processId);
		if (existing) {
			void vscode.window.showErrorMessage(
				`"${processId}" already exists in the connected repository at "${vscode.workspace.asRelativePath(existing.fileUri)}". Open that file instead of creating a new one.`,
			);
			return;
		}
		// The check above is content-based (D6: identity is the XML's id, not the filename), so it
		// cannot see a file that already sits at this exact path but carries a different id — or
		// none at all, e.g. something left over, hand-renamed, or not valid BPMN. Writing here is
		// a plain filesystem write with no merge, so that file would otherwise be silently replaced.
		const targetUri = vscode.Uri.joinPath(repoDir, bpmnFileName(processId));
		if ((await readTextFile(targetUri)) !== undefined) {
			void vscode.window.showErrorMessage(
				`A file already exists at "${vscode.workspace.asRelativePath(targetUri)}" in the connected repository. Rename or remove it before creating "${processId}" here.`,
			);
			return;
		}
		const fileUri = await writeBpmnFile(repoDir, bpmnFileName(processId), xml);
		await refreshWorkflowRepoLocalState(environmentName, tenantId);
		const doc = await vscode.workspace.openTextDocument(fileUri);
		await vscode.window.showTextDocument(doc, { preview: false });
		try {
			await treeView.reveal(
				new WorkflowRepoBpmnFileNode(
					environmentName, tenantId, fileUri, processId, extractProcessModel(xml).processName, undefined,
				),
				{ select: true },
			);
		} catch {
			// Reveal is a convenience; the file is written and open either way.
		}
	}

	/**
	 * Download a deployed definition to disk and record a baseline beside it.
	 *
	 * Mirrors what Fetch Configuration does for L3: the editable copy and the
	 * snapshot of what the server had at that moment. Without the baseline there
	 * is no way to answer "have I changed this?" or "did the server move?".
	 */
	async function downloadBpmn(
		environmentName: string,
		tenantId: string,
		processId: string,
		ctx: { adapterUrl: string; token: string; environmentUrl: string },
	): Promise<vscode.Uri | undefined> {
		let xml: string | undefined;
		try {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Fetching ${processId}…`,
					cancellable: false,
				},
				async () => {
					xml = await getProcessDefinitionXml(
						ctx.adapterUrl, tenantId, ctx.environmentUrl, ctx.token, processId,
					);
				},
			);
		} catch (e) {
			await reportWorkflowError(e, { environmentName, tenantId, operation: 'open' });
			return undefined;
		}
		if (xml === undefined) return undefined;

		const dir = environmentManager!.getWorkflowDraftsDirectoryUri(environmentName, tenantId);
		const fileUri = await writeBpmnFile(dir, bpmnFileName(processId), xml);
		await writeBpmnFile(dir, bpmnBaselineFileName(processId), xml);
		treeProvider.notifyWorkflowDraftsChanged();
		return fileUri;
	}

	/** Diff a local BPMN against the baseline captured at its last fetch. */
	async function openBpmnLocalVsBaselineDiff(
		environmentName: string,
		tenantId: string,
		processId: string,
	): Promise<void> {
		const baselineUri = environmentManager!.getWorkflowBpmnBaselineUri(environmentName, tenantId, processId);
		const localUri = environmentManager!.getWorkflowBpmnUri(environmentName, tenantId, processId);
		await vscode.commands.executeCommand(
			'vscode.diff',
			baselineUri,
			localUri,
			`Deployed (last fetch) ↔ Local (${processId})`,
		);
	}

	/**
	 * Force a decision about one BPMN that has undeployed local changes.
	 *
	 * Returns false only when the user backs out, which aborts whatever
	 * navigation triggered this. "Keep for now" is a decision too — the point is
	 * that the state is acknowledged, not that it must be resolved immediately.
	 */
	async function resolvePendingBpmn(
		environmentName: string,
		tenantId: string,
		processId: string,
	): Promise<boolean> {
		let offerReview = true;
		for (;;) {
			const items = offerReview
				? ['Review changes', 'Deploy now', 'Discard changes', 'Keep for now']
				: ['Deploy now', 'Discard changes', 'Keep for now'];
			const pick = await vscode.window.showWarningMessage(
				`"${processId}" has local changes that have not been deployed to ${tenantId}.`,
				{ modal: true },
				...items,
			);
			if (pick === undefined) return false;
			if (pick === 'Keep for now') return true;
			if (pick === 'Review changes') {
				await openBpmnLocalVsBaselineDiff(environmentName, tenantId, processId);
				offerReview = false;
				continue;
			}
			if (pick === 'Discard changes') {
				await discardBpmnChanges(environmentName, tenantId, processId);
				return true;
			}
			if (pick === 'Deploy now') {
				const fileUri = environmentManager!.getWorkflowBpmnUri(environmentName, tenantId, processId);
				await deployBpmnFile(environmentName, tenantId, processId, fileUri);
				return true;
			}
		}
	}

	/**
	 * Before opening a BPMN, settle any other one in the same tenant that has
	 * undeployed edits — so a pending change cannot be left behind and forgotten
	 * while the user moves on to the next definition.
	 */
	async function guardPendingBpmnChanges(
		environmentName: string,
		tenantId: string,
		exceptProcessId?: string,
	): Promise<boolean> {
		if (!environmentManager) return true;
		const files = await listLocalBpmnFiles(
			environmentManager.getWorkflowDraftsDirectoryUri(environmentName, tenantId),
		);
		for (const f of files) {
			if (!f.hasLocalChanges || f.processId === exceptProcessId) continue;
			if (!(await resolvePendingBpmn(environmentName, tenantId, f.processId))) return false;
		}
		return true;
	}

	/**
	 * Guard a refresh the way Fetch Configuration guards L3.
	 *
	 * Refreshing brings local copies back in line with the tenant, so it can
	 * destroy undeployed edits. Naming which ones, before anything is overwritten,
	 * is the same courtesy the configuration flow already extends.
	 *
	 * Returns false when the user backs out, which cancels the refresh entirely.
	 */
	async function guardBeforeWorkflowRefresh(
		environmentName: string,
		tenantId: string,
	): Promise<boolean> {
		if (!environmentManager) return true;
		const files = await listLocalBpmnFiles(
			environmentManager.getWorkflowDraftsDirectoryUri(environmentName, tenantId),
		);
		const changed = files.filter(f => f.hasLocalChanges);
		if (changed.length === 0) return true;

		const names = changed.map(f => f.processId).join(', ');
		const pick = await vscode.window.showWarningMessage(
			changed.length === 1
				? `"${names}" has local changes that have not been deployed to "${tenantId}". Refreshing will overwrite them with the tenant's version.`
				: `${changed.length} BPMNs have local changes that have not been deployed to "${tenantId}" (${names}). Refreshing will overwrite them with the tenant's versions.`,
			{ modal: true },
			'Review changes',
			'Refresh anyway',
		);
		if (pick === undefined) return false;

		if (pick === 'Review changes') {
			// One decision per file, same dialog as navigating away. Anything the
			// user chooses to keep stops counting as changed below, so the refresh
			// leaves it alone rather than overwriting what they just protected.
			for (const f of changed) {
				if (!(await resolvePendingBpmn(environmentName, tenantId, f.processId))) return false;
			}
		}
		return true;
	}

	/**
	 * Re-download the local copies of definitions already on disk, so a refresh
	 * updates files and not just the tree rows.
	 *
	 * Skips anything still carrying local changes: by this point the user has
	 * either been warned and chosen to overwrite, or explicitly kept it.
	 */
	async function refreshLocalBpmnCopies(
		environmentName: string,
		tenantId: string,
		ctx: { adapterUrl: string; token: string; environmentUrl: string },
		overwriteChanged: boolean,
	): Promise<void> {
		if (!environmentManager) return;
		const dir = environmentManager.getWorkflowDraftsDirectoryUri(environmentName, tenantId);
		const files = await listLocalBpmnFiles(dir);
		const targets = files.filter(
			f => f.baselineText !== undefined && (overwriteChanged || !f.hasLocalChanges),
		);
		if (targets.length === 0) return;

		for (const f of targets) {
			try {
				const xml = await getProcessDefinitionXml(
					ctx.adapterUrl, tenantId, ctx.environmentUrl, ctx.token, f.processId,
				);
				await writeBpmnFile(dir, bpmnFileName(f.processId), xml);
				await writeBpmnFile(dir, bpmnBaselineFileName(f.processId), xml);
			} catch {
				// A definition deleted on the tenant since the last fetch should not
				// fail the whole refresh; the list is the authority on what exists.
			}
		}
		treeProvider.notifyWorkflowDraftsChanged();
	}

	/** Restore a local BPMN to its baseline, discarding local edits. */
	async function discardBpmnChanges(
		environmentName: string,
		tenantId: string,
		processId: string,
	): Promise<void> {
		const baselineUri = environmentManager!.getWorkflowBpmnBaselineUri(environmentName, tenantId, processId);
		const baselineText = await readTextFile(baselineUri);
		if (baselineText === undefined) {
			void vscode.window.showErrorMessage(
				`No baseline exists for "${processId}", so there is nothing to restore. Fetch it from the tenant first.`,
			);
			return;
		}
		const dir = environmentManager!.getWorkflowDraftsDirectoryUri(environmentName, tenantId);
		await writeBpmnFile(dir, bpmnFileName(processId), baselineText);
		treeProvider.notifyWorkflowDraftsChanged();
		void vscode.window.showInformationMessage(`Local changes to "${processId}" discarded.`);
	}

	/**
	 * Deploy one local BPMN file, whether it is an edited deployment or a draft.
	 *
	 * When a baseline exists, the server is checked first: deploying over someone
	 * else's change without seeing it is the failure this guard exists to prevent,
	 * and it is the same check Apply Configuration makes for L3.
	 */
	async function deployBpmnFile(
		environmentName: string,
		tenantId: string,
		processId: string,
		fileUri: vscode.Uri,
		/**
		 * D6: direct deploy, no promote-to-Draft copy. A repo-sourced file has no
		 * baseline in `Workflows/BPMN/` before this call and must not gain one as a
		 * side effect — its own file, untouched in `Workflows/Custom Workflows/`, is
		 * already the record of what was deployed, and D5's sync badge (not this
		 * baseline mechanism) is how a later edit is surfaced as `changed`.
		 */
		isRepoSource = false,
	): Promise<boolean> {
		const ctx = await workflowCallContext(environmentName, tenantId);
		if (!ctx) return false;

		const doc = await vscode.workspace.openTextDocument(fileUri);
		if (!(await ensureDocumentSaved(fileUri))) {
			void vscode.window.showErrorMessage('Could not save the file, so it was not deployed.');
			return false;
		}
		const xml = doc.getText();
		if (!xml.trim()) {
			void vscode.window.showErrorMessage('The BPMN is empty.');
			return false;
		}
		// The id that was confirmed with the user must be the id inside what is about to be uploaded:
		// the engine deploys the XML's id, and the file can change between the confirmation and the
		// save above (an agent, a formatter, the user).
		const xmlProcessId = extractProcessModel(xml).processId;
		if (xmlProcessId !== processId) {
			void vscode.window.showErrorMessage(
				`The process id inside the file is "${xmlProcessId ?? 'missing'}", not the "${processId}" that was confirmed, so nothing was deployed. Deploy again to confirm the current id.`,
			);
			return false;
		}

		const baselineUri = environmentManager!.getWorkflowBpmnBaselineUri(environmentName, tenantId, processId);
		const baselineText = await readTextFile(baselineUri);

		if (baselineText !== undefined) {
			let remoteText: string | undefined;
			try {
				remoteText = await vscode.window.withProgress(
					{ location: vscode.ProgressLocation.Notification, title: 'Checking the deployed version…' },
					() => getProcessDefinitionXml(ctx.adapterUrl, tenantId, ctx.environmentUrl, ctx.token, processId),
				);
			} catch (e) {
				await reportWorkflowError(e, { environmentName, tenantId, operation: 'deploy' });
				return false;
			}
			if (remoteText !== undefined && !remoteBpmnMatchesBaseline(baselineText, remoteText)) {
				const pick = await vscode.window.showWarningMessage(
					`"${processId}" changed on the tenant since your last fetch. Deploying will replace those changes.`,
					{ modal: true },
					'Review changes',
					'Deploy anyway',
				);
				if (pick === undefined) return false;
				if (pick === 'Review changes') {
					const remoteUri = bpmnProvider.store(environmentName, tenantId, processId, remoteText);
					await vscode.commands.executeCommand(
						'vscode.diff', remoteUri, fileUri, `Tenant (now) ↔ Local (${processId})`,
					);
					const confirm = await vscode.window.showWarningMessage(
						'Review the diff tab. Deploy your local version over what is on the tenant?',
						{ modal: true },
						'Deploy',
					);
					if (confirm !== 'Deploy') return false;
				}
			}
		}

		let deployResult: DeploymentResult;
		try {
			deployResult = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Deploying ${processId} to ${tenantId}…`,
					cancellable: false,
				},
				() => deployProcessDefinition(
					ctx.adapterUrl, tenantId, ctx.environmentUrl, ctx.token,
					processId, bpmnFileName(processId), xml,
				),
			);
		} catch (e) {
			await reportWorkflowError(e, { environmentName, tenantId, operation: 'deploy' });
			return false;
		}

		// The engine re-serialises on deploy, so the new baseline has to come from
		// the server rather than from what was uploaded — otherwise the very next
		// comparison would report a change nobody made. Skipped entirely for a
		// repo-sourced deploy (D6) — see the `isRepoSource` doc comment above.
		try {
			if (!isRepoSource) {
				const deployed = await getProcessDefinitionXml(
					ctx.adapterUrl, tenantId, ctx.environmentUrl, ctx.token, processId,
				);
				const dir = environmentManager!.getWorkflowDraftsDirectoryUri(environmentName, tenantId);
				await writeBpmnFile(dir, bpmnBaselineFileName(processId), deployed);
			}
		} catch {
			// Deploy succeeded; a stale baseline only means the next comparison is
			// pessimistic, so this is not worth failing the operation over.
		}

		// The Adapter's own contract defines `warning` for "succeeded, but there
		// were some problems" — worth a second, distinct message rather than
		// folding it into the success toast where it would go unread.
		void vscode.window.showInformationMessage(`Deployed "${processId}" to ${tenantId}.`);
		if (deployResult.warning) {
			void vscode.window.showWarningMessage(`"${processId}" deployed with a warning: ${deployResult.warning}`);
		}
		await doFetchProcessDefinitions(environmentName, tenantId, ctx.adapterUrl);
		return true;
	}

	/**
	 * What an agent can pass in place of a tree node.
	 *
	 * The authoring commands were reachable only from the tree, which meant their
	 * only argument was a `TreeItem` subclass instance — something
	 * `vscode.commands.executeCommand` cannot produce from a chat session. An
	 * agent asked to "create a new approval workflow" could describe the steps
	 * and not take them. A plain object is the missing entry point.
	 *
	 * Every field is optional and every missing field is prompted for, so one
	 * implementation serves a fully-specified agent call, a half-specified one,
	 * and a bare click from the tree.
	 */
	interface WorkflowCommandArgs {
		readonly environmentName?: string;
		readonly tenantId?: string;
		readonly processId?: string;
		readonly displayName?: string;
		/** Duplicate only: the deployed definition to copy from. */
		readonly sourceProcessId?: string;
		/** Register only: the S3 module path of the JAR to register (see `AvailableJar.module`). */
		readonly module?: string;
		/** Register only: the name to give the JAR under JAR Deployments. */
		readonly name?: string;
		/** Register only: optional description for the JAR. */
		readonly description?: string;
		/** Edit-adapter-url only: the new Workflow Adapter base URL, saved without prompting. */
		readonly adapterUrl?: string;
	}

	/**
	 * Read a command argument that may be a tree node, an args object, or absent.
	 *
	 * A tree node satisfies `WorkflowCommandArgs` structurally — it carries
	 * `environmentName` and `tenantId` — so both shapes are handled by reading
	 * the same two fields rather than by branching on the class.
	 */
	function workflowCommandArgs(
		arg: unknown,
	): WorkflowCommandArgs | undefined {
		if (arg === undefined || arg === null) return {};
		if (typeof arg !== 'object') return undefined;
		const candidate = arg as { environmentName?: unknown; tenantId?: unknown };
		if (typeof candidate.environmentName === 'string' && typeof candidate.tenantId === 'string') {
			return arg as WorkflowCommandArgs;
		}
		return undefined;
	}

	/**
	 * Settle which tenant a workflow command acts on.
	 *
	 * Asks only when it has to. With one connected tenant there is nothing to
	 * ask, and a needless "which tenant?" in front of every agent-driven create
	 * is the kind of prompt that trains people to stop reading prompts.
	 */
	async function resolveWorkflowTenant(
		args: WorkflowCommandArgs,
	): Promise<{ environmentName: string; tenantId: string } | undefined> {
		if (args.environmentName && args.tenantId) {
			return { environmentName: args.environmentName, tenantId: args.tenantId };
		}
		if (!environmentManager) return undefined;

		const environments = await environmentManager.scanEnvironments();
		const candidates = environments.flatMap(env =>
			env.tenants.map(tenant => ({ environmentName: env.name, tenantId: tenant.tenantId })),
		);

		if (candidates.length === 0) {
			void vscode.window.showErrorMessage(
				'No tenant is connected yet. Add an environment and a tenant first, then create a workflow.',
			);
			return undefined;
		}
		if (candidates.length === 1) return candidates[0];

		const picked = await vscode.window.showQuickPick(
			candidates.map(candidate => ({
				label: candidate.tenantId,
				description: candidate.environmentName,
				candidate,
			})),
			{ title: 'Which tenant?', placeHolder: 'Choose the tenant this workflow belongs to.', ignoreFocusOut: true },
		);
		return picked?.candidate;
	}

	/**
	 * The tenant's deployed definitions, fetched now when this session has never fetched them.
	 *
	 * A collision check against an empty cache answers "nothing is deployed", which is wrong for a
	 * tenant nobody has opened this session and is exactly how a draft ends up replacing a live
	 * workflow without a warning. `silent` is for flows that must keep working offline (creating a
	 * draft): any failure returns `undefined` without a toast, and the deploy path — which cannot
	 * proceed without the list — asks again, loudly.
	 */
	async function ensureDeployedDefinitions(
		environmentName: string,
		tenantId: string,
		options: { silent: boolean },
	): Promise<ProcessDefinition[] | undefined> {
		if (treeProvider.hasFetchedProcessDefinitions(environmentName, tenantId)) {
			return treeProvider.getCachedProcessDefinitions(environmentName, tenantId);
		}
		if (options.silent) {
			const adapterUrl = environmentManager
				? await loadWorkflowAdapterUrl(environmentManager.getWorkflowAdapterConfigUri(environmentName, tenantId))
				: undefined;
			if (!adapterUrl || !tokenStore.getToken(environmentName)) return undefined;
			const ok = await doFetchProcessDefinitions(environmentName, tenantId, adapterUrl);
			return ok ? treeProvider.getCachedProcessDefinitions(environmentName, tenantId) : undefined;
		}
		const ctx = await workflowCallContext(environmentName, tenantId);
		if (!ctx) return undefined;
		const ok = await doFetchProcessDefinitions(environmentName, tenantId, ctx.adapterUrl);
		return ok ? treeProvider.getCachedProcessDefinitions(environmentName, tenantId) : undefined;
	}

	/**
	 * Decide what a deploy would do, validate it, and — for an agent — get the user's
	 * confirmation before anything leaves the machine.
	 *
	 * `requireConfirmation` is never a parameter an agent gets to set: the call sites in
	 * `reltio.deployWorkflow` derive it structurally from *how* the command was invoked, not
	 * from anything the caller asked for. A tree row, an editor title-bar button, or the
	 * command palette with no args all mean a person just clicked something with their own
	 * eyes on the row that said "deploy this" — that click is the confirmation, and a second
	 * modal asking the same question a different way is friction, not safety. A
	 * `WorkflowCommandArgs` object naming a tenant and a process id is different in kind: it is
	 * how an agent reaches this command with no Uri and no tree selection to click, which means
	 * no human had anything in front of them to click on in the first place — so that path
	 * still shows the modal, unconditionally, with no way for anything upstream to suppress it.
	 * That is what keeps this the one checkpoint between a chat message and a change on a
	 * customer's live tenant, while a human's own, deliberate click stops asking it to confirm
	 * itself.
	 *
	 * Validation (`plan.ok === false` — no process id, an invalid one, the tenant's deployed
	 * list not loaded yet) always runs and always reports, regardless of `requireConfirmation`:
	 * skipping the confirmation is about trusting a human's click, never about skipping the
	 * check that the file is even deployable.
	 *
	 * The id used is the one inside the XML (see `workflowDeployPlan.ts`); the file's name is only a hint.
	 * Distinct from the drift check inside `deployBpmnFile`, which asks whether the tenant moved since the
	 * last fetch.
	 */
	async function confirmedDeployPlan(
		environmentName: string,
		tenantId: string,
		fileProcessId: string,
		fileUri: vscode.Uri,
		requireConfirmation: boolean,
	): Promise<Extract<DeployPlan, { ok: true }> | undefined> {
		const doc = await vscode.workspace.openTextDocument(fileUri);
		const deployed = await ensureDeployedDefinitions(environmentName, tenantId, { silent: false });
		if (deployed === undefined) return undefined;
		const plan = planDeploy(doc.getText(), fileProcessId, deployed);
		if (!plan.ok) {
			void vscode.window.showErrorMessage(plan.message);
			return undefined;
		}
		if (!requireConfirmation) return plan;
		const confirmation = describeDeploy(plan, tenantId);
		const choice = await vscode.window.showWarningMessage(
			confirmation.message,
			{ modal: true, detail: confirmation.detail },
			confirmation.action,
		);
		return choice === undefined ? undefined : plan;
	}

	/**
	 * Settle which deployed definition to copy.
	 *
	 * `requested` is matched against the process id case-sensitively, because that
	 * is how the Adapter identifies a definition. A name that does not match is a
	 * fall-through to the picker rather than an error: an agent working from a
	 * user's wording ("the data change request one") will approximate, and showing
	 * the real list is more useful than refusing.
	 */
	async function pickProcessDefinition(
		environmentName: string,
		tenantId: string,
		requested: string | undefined,
	): Promise<ProcessDefinition | undefined> {
		const definitions = treeProvider.getCachedProcessDefinitions(environmentName, tenantId);
		if (!definitions || definitions.length === 0) {
			void vscode.window.showErrorMessage(
				`No workflows have been listed for ${tenantId} yet. Open the Workflows folder to fetch them, then try again.`,
			);
			return undefined;
		}

		if (requested) {
			const exact = definitions.find(definition => definition.type === requested);
			if (exact) return exact;
		}

		const picked = await vscode.window.showQuickPick(
			definitions.map(definition => ({
				label: definition.type,
				description: definition.displayName,
				// Naming Reltio's own definitions matters here: copying one is the
				// normal way to start, whereas copying a custom one may duplicate
				// work the customer already owns.
				detail: definition.generic ? 'Reltio built-in' : 'Custom workflow',
				definition,
			})),
			{
				title: `Which workflow should be copied?`,
				placeHolder: requested
					? `No workflow called "${requested}" on ${tenantId} — pick from the list.`
					: `Workflows deployed on ${tenantId}`,
				ignoreFocusOut: true,
			},
		);
		return picked?.definition;
	}

	/**
	 * Settle which unregistered JAR to register.
	 *
	 * `requested` is matched against the module path exactly, since that is the
	 * Adapter's own identity for a JAR — same reasoning as `pickProcessDefinition`.
	 * A module that doesn't match anything cached is a fall-through to the
	 * picker rather than an error: an agent working from a file name someone
	 * typed will approximate, and showing the real list is more useful than
	 * refusing outright.
	 */
	async function pickUnregisteredJar(
		environmentName: string,
		tenantId: string,
		requested: string | undefined,
	): Promise<AvailableJar | undefined> {
		const jars = treeProvider.getCachedUnregisteredJars(environmentName, tenantId);
		if (!jars || jars.length === 0) {
			void vscode.window.showErrorMessage(
				`No unregistered JARs are known for ${tenantId} yet. Open the JAR Deployments folder to fetch them, then try again.`,
			);
			return undefined;
		}

		if (requested) {
			const exact = jars.find(jar => jar.module === requested);
			if (exact) return exact;
		}

		const picked = await vscode.window.showQuickPick(
			jars.map(jar => ({
				label: jarModuleFileName(jar.module),
				description: jar.module,
				jar,
			})),
			{
				title: 'Which JAR should be registered?',
				placeHolder: requested
					? `No unregistered JAR matches "${requested}" — pick from the list.`
					: `Unregistered JARs on ${tenantId}`,
				ignoreFocusOut: true,
			},
		);
		return picked?.jar;
	}

	context.subscriptions.push(
		/**
		 * reltio.newWorkflowDraft
		 * Boilerplate → editable draft. Prompts for the process id first (see
		 * promptForProcessId) and never writes a placeholder.
		 *
		 * Takes a tree node or a `WorkflowCommandArgs` object, so the same command
		 * serves a click and an agent that already knows the id and name.
		 */
		vscode.commands.registerCommand(
			'reltio.newWorkflowDraft',
			async (
				arg?: ProcessDefinitionsFolderNode | WorkflowsFolderNode | WorkflowDraftsFolderNode | WorkflowCommandArgs,
			) => {
				if (!environmentManager) return;
				const args = workflowCommandArgs(arg);
				if (!args) return;
				const target = await resolveWorkflowTenant(args);
				if (!target) return;
				const { environmentName, tenantId } = target;

				// Not `node.definitions` — that only exists on the Process Definitions
				// folder, and this command is also reachable from Workflows and Drafts.
				// The deployed-id collision warning has to fire from every entry point.
				const deployed = (await ensureDeployedDefinitions(environmentName, tenantId, { silent: true })) ?? [];
				// A supplied id is still validated and still checked for collisions —
				// it is pre-filled into the same prompt rather than trusted. An agent
				// inventing an id that versions a live workflow is exactly the mistake
				// this prompt exists to catch.
				const processId = await promptForProcessId(
					environmentName, tenantId, args.processId ?? '', deployed,
				);
				if (!processId) return;

				const displayName = args.displayName ?? await vscode.window.showInputBox({
					title: `Display name for ${processId}`,
					prompt: 'Business-friendly name shown to reviewers in the Reltio console and in this tree (not the technical ID).',
					value: processId,
					ignoreFocusOut: true,
				});
				if (displayName === undefined) return;

				await createDraft(environmentName, tenantId, processId, buildBpmnSkeleton(processId, displayName));
			},
		),

		/**
		 * reltio.duplicateWorkflowDraft
		 * Real work usually starts from an existing workflow rather than a blank
		 * file. The new id defaults to `{type}Copy` — keeping the original id would
		 * silently version the live workflow instead of copying it.
		 */
		vscode.commands.registerCommand(
			'reltio.duplicateWorkflowDraft',
			async (arg?: ProcessDefinitionNode | WorkflowCommandArgs) => {
				if (!environmentManager) return;
				const args = workflowCommandArgs(arg);
				if (!args) return;
				const target = await resolveWorkflowTenant(args);
				if (!target) return;
				const { environmentName, tenantId } = target;

				const source = arg instanceof ProcessDefinitionNode
					? arg.definition
					: await pickProcessDefinition(environmentName, tenantId, args.sourceProcessId);
				if (!source) return;

				const ctx = await workflowCallContext(environmentName, tenantId);
				if (!ctx) return;

				let sourceXml: string | undefined;
				try {
					await vscode.window.withProgress(
						{
							location: vscode.ProgressLocation.Notification,
							title: `Copying ${source.type}…`,
							cancellable: false,
						},
						async () => {
							sourceXml = await getProcessDefinitionXml(
								ctx.adapterUrl,
								tenantId,
								ctx.environmentUrl,
								ctx.token,
								source.type,
							);
						},
					);
				} catch (e) {
					await reportWorkflowError(e, { environmentName, tenantId, operation: 'open' });
					return;
				}
				if (sourceXml === undefined) return;

				// The whole tenant list, not only the source: another deployed id would otherwise slip
				// past the collision warning. Falls back to the source when the list cannot be fetched.
				const deployedNow = (await ensureDeployedDefinitions(environmentName, tenantId, { silent: true })) ?? [source];
				const processId = await promptForProcessId(
					environmentName,
					tenantId,
					args.processId ?? `${source.type}Copy`,
					deployedNow,
				);
				if (!processId) return;

				const displayName = args.displayName ?? await vscode.window.showInputBox({
					title: `Display name for ${processId}`,
					prompt: 'Business-friendly name shown to reviewers in the Reltio console and in this tree (not the technical ID).',
					value: `${source.displayName || source.type} (copy)`,
					ignoreFocusOut: true,
				});
				if (displayName === undefined) return;

				const xml = rewriteProcessIdentity(sourceXml, processId, displayName);
				if (xml === undefined) {
					void vscode.window.showErrorMessage(
						'Could not find a <process> element in the deployed definition, so its identity cannot be rewritten. Copying it unchanged would deploy a new version of the original workflow.',
					);
					return;
				}

				// A definition deployed before diagram interchange was written into
				// authored BPMNs has no shapes to copy, so the draft would open as a
				// blank canvas in every viewer. Lay one out now — the copy is new
				// authored content, unlike the fetched original, which is left as its
				// author laid it out.
				const withDiagram = hasDiagramSection(xml) ? xml : await withGeneratedDiagram(xml);
				await createDraft(environmentName, tenantId, processId, withDiagram);
			},
		),

		/**
		 * reltio.deployWorkflowDraft
		 * Reachable from the tree, the editor title bar and the palette. The last
		 * two carry no tenant context, so it is recovered from the file's own path
		 * rather than from the tree selection — three tenants can hold drafts with
		 * the same name.
		 */
		vscode.commands.registerCommand(
			'reltio.deployWorkflow',
			async (
				arg?: ProcessDefinitionNode | WorkflowDraftNode | WorkflowRepoBpmnFileNode | vscode.Uri | WorkflowCommandArgs,
			) => {
				if (!environmentManager) return;

				// A deployed definition carries its own identity; a draft and an editor
				// tab do not, so those resolve from the file's own path.
				if (arg instanceof ProcessDefinitionNode) {
					const fileUri = environmentManager.getWorkflowBpmnUri(
						arg.environmentName, arg.tenantId, arg.definition.type,
					);
					if ((await readTextFile(fileUri)) === undefined) {
						void vscode.window.showErrorMessage(
							`"${arg.definition.type}" has not been downloaded yet. Open it first, make your changes, then deploy.`,
						);
						return;
					}
					// A `ProcessDefinitionNode` only ever comes from clicking its row in the tree —
					// no agent path constructs one — so this is always a human's own click.
					const planned = await confirmedDeployPlan(
						arg.environmentName, arg.tenantId, arg.definition.type, fileUri, false,
					);
					if (!planned) return;
					await deployBpmnFile(arg.environmentName, arg.tenantId, planned.processId, fileUri);
					return;
				}

				// An args object names a tenant and a process id; the file is then the
				// draft that id maps to, which is how an agent refers to a draft it has
				// never had a Uri for.
				const objectArgs =
					arg instanceof WorkflowDraftNode || arg instanceof WorkflowRepoBpmnFileNode || arg instanceof vscode.Uri
						? undefined
						: workflowCommandArgs(arg);

				let fileUri: vscode.Uri | undefined;
				if (objectArgs?.processId) {
					const target = await resolveWorkflowTenant(objectArgs);
					if (!target) return;
					fileUri = environmentManager.getWorkflowBpmnUri(
						target.environmentName, target.tenantId, objectArgs.processId,
					);
					if ((await readTextFile(fileUri)) === undefined) {
						void vscode.window.showErrorMessage(
							`No BPMN called "${objectArgs.processId}" exists under ${target.tenantId}. Create it as a draft first.`,
						);
						return;
					}
				} else {
					fileUri = arg instanceof WorkflowDraftNode
						? arg.draft.fileUri
						: arg instanceof WorkflowRepoBpmnFileNode
							? arg.fileUri
							: arg instanceof vscode.Uri
								? arg
								: vscode.window.activeTextEditor?.document.uri;
				}

				if (!fileUri) {
					void vscode.window.showErrorMessage('Open a BPMN, or run this from the Workflows tree.');
					return;
				}
				// Cheapest first: a Draft's filename is this extension's own convention, so
				// the sync check is a string parse. Only a miss there means checking whether
				// the file instead lives under a connected Custom Workflow Repository (D6),
				// where identity has to come from content, not filename.
				const fromDraft = resolveDraftContext(fileUri.fsPath, environmentManager);
				const draftCtx = fromDraft ?? await resolveRepoBpmnContext(fileUri.fsPath, environmentManager);
				if (!draftCtx) {
					void vscode.window.showErrorMessage(
						'This file is not a BPMN inside a tenant folder, so there is no tenant to deploy it to.',
					);
					return;
				}

				// `objectArgs?.processId` is only set on the agent path above — a tenant/process-id
				// object with no Uri and no tree node to have clicked. Every other way into this
				// branch (a Draft/Repo tree row, the editor title bar, the palette with no args
				// falling back to the active editor) is a human who just clicked something.
				const planned = await confirmedDeployPlan(
					draftCtx.environmentName, draftCtx.tenantId, draftCtx.processId, fileUri,
					Boolean(objectArgs?.processId),
				);
				if (!planned) return;

				await deployBpmnFile(
					draftCtx.environmentName, draftCtx.tenantId, planned.processId, fileUri, !fromDraft,
				);
			},
		),

		/**
		 * reltio.previewWorkflowDiagram
		 * Read-only diagram for a draft, a deployed definition, or the BPMN in the
		 * active editor. Same argument-resolution shape as `reltio.deployWorkflow`,
		 * with one deliberate difference: a definition that has not been downloaded
		 * yet is fetched rather than refused. "Show me this diagram" is a read, and
		 * making the user run Open BPMN first to satisfy a precondition they cannot
		 * see would be a worse answer than doing it for them.
		 *
		 * Also accepts a `WorkflowCommandArgs` object (`processId`, resolved via
		 * `resolveWorkflowTenant`), so an agent that knows a process id — deployed
		 * or draft-only — can ask for the diagram without first finding a tree row.
		 */
		vscode.commands.registerCommand(
			'reltio.previewWorkflowDiagram',
			async (
				arg?: ProcessDefinitionNode | WorkflowDraftNode | WorkflowRepoBpmnFileNode | vscode.Uri | WorkflowCommandArgs,
			) => {
				let fileUri: vscode.Uri | undefined;

				if (arg instanceof ProcessDefinitionNode) {
					if (!environmentManager) return;
					const { environmentName, tenantId } = arg;
					const processId = arg.definition.type;
					fileUri = environmentManager.getWorkflowBpmnUri(environmentName, tenantId, processId);
					if ((await readTextFile(fileUri)) === undefined) {
						const ctx = await workflowCallContext(environmentName, tenantId);
						if (!ctx) return;
						fileUri = await downloadBpmn(environmentName, tenantId, processId, ctx);
					}
				} else if (
					arg instanceof WorkflowDraftNode ||
					arg instanceof WorkflowRepoBpmnFileNode ||
					arg instanceof vscode.Uri
				) {
					fileUri = arg instanceof WorkflowDraftNode
						? arg.draft.fileUri
						: arg instanceof WorkflowRepoBpmnFileNode
							? arg.fileUri
							: arg;
				} else {
					const objectArgs = workflowCommandArgs(arg);
					if (objectArgs?.processId && environmentManager) {
						const target = await resolveWorkflowTenant(objectArgs);
						if (!target) return;
						const { environmentName, tenantId } = target;
						const { processId } = objectArgs;

						fileUri = environmentManager.getWorkflowBpmnUri(environmentName, tenantId, processId);
						if ((await readTextFile(fileUri)) === undefined) {
							// Same convenience as the tree-node path: a deployed definition
							// not yet downloaded is fetched rather than refused — but only
							// when it actually is deployed; a name that matches neither a
							// draft on disk nor a deployed definition is a real "not found",
							// not something a fetch would resolve.
							const deployed = treeProvider.getCachedProcessDefinitions(environmentName, tenantId);
							if (!deployed.some(d => d.type === processId)) {
								void vscode.window.showErrorMessage(
									`No BPMN called "${processId}" exists under ${tenantId}. Create it as a draft first, or check the spelling of a deployed one.`,
								);
								return;
							}
							const ctx = await workflowCallContext(environmentName, tenantId);
							if (!ctx) return;
							fileUri = await downloadBpmn(environmentName, tenantId, processId, ctx);
						}
					} else {
						fileUri = vscode.window.activeTextEditor?.document.uri;
					}
				}

				if (!fileUri) {
					void vscode.window.showErrorMessage('Open a BPMN, or run this from the Workflows tree.');
					return;
				}

				const document = await vscode.workspace.openTextDocument(fileUri);
				await bpmnManager.showPreview(document, context.extensionUri);
			},
		),

		/**
		 * reltio.discardWorkflowBpmnChanges
		 * Restores the local copy to the baseline captured at the last fetch.
		 */
		vscode.commands.registerCommand(
			'reltio.discardWorkflowBpmnChanges',
			async (node?: ProcessDefinitionNode) => {
				if (!node || !environmentManager) return;
				const processId = node.definition.type;
				const confirm = await vscode.window.showWarningMessage(
					`Discard your local changes to "${processId}" and restore the version last fetched from ${node.tenantId}?`,
					{ modal: true },
					'Discard changes',
				);
				if (confirm !== 'Discard changes') return;
				await discardBpmnChanges(node.environmentName, node.tenantId, processId);
			},
		),

		/**
		 * reltio.compareWorkflowBpmn
		 * Local copy against the baseline from its last fetch — no network call.
		 */
		vscode.commands.registerCommand(
			'reltio.compareWorkflowBpmn',
			async (node?: ProcessDefinitionNode) => {
				if (!node || !environmentManager) return;
				const processId = node.definition.type;
				const baselineText = await readTextFile(
					environmentManager.getWorkflowBpmnBaselineUri(node.environmentName, node.tenantId, processId),
				);
				if (baselineText === undefined) {
					void vscode.window.showErrorMessage(
						`"${processId}" has not been downloaded yet, so there is nothing to compare.`,
					);
					return;
				}
				await openBpmnLocalVsBaselineDiff(node.environmentName, node.tenantId, processId);
			},
		),

		/**
		 * reltio.deleteWorkflowDraft
		 * Local only — deleting a draft never touches anything already deployed.
		 */
		vscode.commands.registerCommand(
			'reltio.deleteWorkflowDraft',
			async (node?: WorkflowDraftNode) => {
				if (!node) return;
				const confirm = await vscode.window.showWarningMessage(
					`Delete the draft "${node.draft.processId}"? This removes the local file only; anything already deployed to ${node.tenantId} is unaffected.`,
					{ modal: true },
					'Delete',
				);
				if (confirm !== 'Delete') return;
				try {
					await vscode.workspace.fs.delete(node.draft.fileUri, { useTrash: true });
				} catch (e) {
					void vscode.window.showErrorMessage(`Could not delete the draft: ${(e as Error).message}`);
					return;
				}
				treeProvider.notifyWorkflowDraftsChanged();
			},
		),
	);

	/**
	 * A BPMN can land on disk without going through any `reltio.*` command — an
	 * AI agent writing files directly, a git pull, a manual copy. Without this,
	 * the tree only learns about it the next time something else happens to
	 * call `notifyWorkflowDraftsChanged()`, which reads as "the extension didn't
	 * notice my file". `notifyWorkflowDraftsChanged()` already debounces
	 * (150ms), so firing it once per touched file here is cheap even when the
	 * extension's own code just wrote the same file a moment earlier.
	 */
	context.subscriptions.push(
		(() => {
			// No tenant-folder segment in this glob: a tenant folder's name carries no
			// identity any more (bare or legacy-suffixed), so matching on `Workflows/BPMN/`
			// wherever it appears in the workspace covers both without guessing the shape
			// of whatever sits above it.
			const watcher = vscode.workspace.createFileSystemWatcher(
				'**/Workflows/BPMN/*.bpmn20*.xml',
			);
			watcher.onDidCreate(() => treeProvider.notifyWorkflowDraftsChanged());
			watcher.onDidChange(() => treeProvider.notifyWorkflowDraftsChanged());
			watcher.onDidDelete(() => treeProvider.notifyWorkflowDraftsChanged());
			return watcher;
		})(),
	);

	/**
	 * The same problem one folder over: a BPMN edited inside the connected Custom
	 * Workflow Repository was covered by no watcher at all, because the glob above
	 * names `Workflows/BPMN/` and the repository is cloned into
	 * `Workflows/Custom Workflows/`. Its sync badge therefore went on asserting
	 * `synced` against content that had since changed.
	 *
	 * Invalidates, never recomputes — see `invalidateWorkflowRepoSync()`.
	 *
	 * The glob has to be `*.xml` rather than `*.bpmn20*.xml`, since D4 forbids treating
	 * a customer's filename as identity. That means `pom.xml` matches it too, so the
	 * handler filters against the files content-driven discovery actually found: a
	 * `pom.xml` save must not blank out the BPMN badges, and a file nobody has
	 * discovered yet has no stale badge to invalidate in the first place.
	 */
	const repoRediscovery = new KeyedDebouncer(DEBOUNCE_MS);
	context.subscriptions.push(
		(() => {
			const watcher = vscode.workspace.createFileSystemWatcher(
				'**/Workflows/Custom Workflows/**/*.xml',
			);
			const samePath = (a: string, b: string): boolean =>
				process.platform === 'win32'
					? a.toLowerCase() === b.toLowerCase()
					: a === b;
			const invalidateIfDiscovered = (uri: vscode.Uri): void => {
				const loc = environmentManager?.locFromPath(uri.fsPath);
				if (!loc) return;
				const discovered = treeProvider.getCachedWorkflowRepoFiles(
					loc.environmentName,
					loc.tenantId,
				);
				if (!discovered?.some(file => samePath(file.fileUri.fsPath, uri.fsPath))) return;
				treeProvider.invalidateWorkflowRepoSync(loc.environmentName, loc.tenantId);
			};
			watcher.onDidChange(invalidateIfDiscovered);
			watcher.onDidDelete(invalidateIfDiscovered);
			// A new or removed file is not in the discovered list yet (or no longer should be), so the
			// handler above ignores it. Re-discover locally, debounced per tenant.
			const rediscover = (uri: vscode.Uri): void => {
				const loc = environmentManager?.locFromPath(uri.fsPath);
				if (!loc) return;
				repoRediscovery.schedule(`${loc.environmentName}/${loc.tenantId}`, () => {
					void refreshWorkflowRepoLocalState(loc.environmentName, loc.tenantId).catch(() => undefined);
				});
			};
			watcher.onDidCreate(rediscover);
			watcher.onDidDelete(rediscover);
			const javaWatcher = vscode.workspace.createFileSystemWatcher('**/Workflows/Custom Workflows/**/*.java');
			javaWatcher.onDidCreate(rediscover);
			javaWatcher.onDidDelete(rediscover);
			return { dispose: () => { watcher.dispose(); javaWatcher.dispose(); repoRediscovery.dispose(); } };
		})(),
	);

	/**
	 * Enforce "at most one BPMN under local edit" the moment a second one
	 * actually diverges from its baseline — not only when the user happens to
	 * navigate to it through the tree.
	 *
	 * `reltio.openWorkflowBpmn` already settles other pending BPMNs, but that
	 * only fires when the *next* file is opened through that command. A file
	 * saved from an already-open tab, from Quick Open, or written by an agent
	 * bypasses it entirely, which is exactly how a customer ended up with
	 * several BPMNs silently diverged at once and a pile of catch-up dialogs at
	 * the next refresh. Hooking the save event instead means the prompt appears
	 * right when the second file starts to diverge, one at a time, regardless
	 * of how it was edited.
	 *
	 * Guarded by `resolvingPendingBpmn` because `resolvePendingBpmn`'s "Deploy
	 * now" branch calls `ensureDocumentSaved`, which can itself fire this same
	 * save event — without the guard that would re-enter the dialog loop for
	 * the file already being resolved.
	 */
	let resolvingPendingBpmn = false;
	context.subscriptions.push(
		vscode.workspace.onDidSaveTextDocument(async doc => {
			if (resolvingPendingBpmn || !environmentManager) return;
			const ctx = resolveDraftContext(doc.uri.fsPath, environmentManager);
			if (!ctx) return;

			const baselineText = await readTextFile(
				environmentManager.getWorkflowBpmnBaselineUri(ctx.environmentName, ctx.tenantId, ctx.processId),
			);
			// No baseline means this is a draft, not an edited deployment — drafts
			// are free to accumulate; the one-at-a-time rule is only about BPMNs
			// that already exist on the tenant.
			if (!hasLocalBpmnChanges(doc.getText(), baselineText)) return;

			resolvingPendingBpmn = true;
			try {
				await guardPendingBpmnChanges(ctx.environmentName, ctx.tenantId, ctx.processId);
			} finally {
				resolvingPendingBpmn = false;
			}
		}),
	);

	function rebuildUriIndex(doc: vscode.TextDocument): void {
		const { model, ast } = parseDocument(doc.getText());
		uriIndex.build(model, ast);
		linkProvider.setIndex(uriIndex);
		defProvider.setIndex(uriIndex);
		refProvider.setIndex(uriIndex);
		uriCompletionProvider.setIndex(uriIndex);
		diagnosticsManager.update(doc, uriIndex);
	}

	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	// One timer per document: a shared one dropped the first file's diagnostics whenever a second
	// file changed inside the window (a refactor, a checkout).
	const bpmnDiagnosticsDebounce = new KeyedDebouncer(DEBOUNCE_MS);
	context.subscriptions.push({ dispose: () => bpmnDiagnosticsDebounce.dispose() });
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(e => {
			// A sibling branch, not a widening of the one above it: `isReltioDocument`
			// answers "is this Business Config JSON", which a BPMN is not. The BPMN
			// preview panel has a debounce of its own, but it only exists while a
			// diagram is open and these findings have to work with no diagram at all.
			if (bpmnProcessIdForDocument(e.document)) {
				bpmnDiagnosticsDebounce.schedule(e.document.uri.toString(), () => {
					bpmnDiagnosticsManager.update(e.document);
				});
				return;
			}
			if (!isReltioDocument(e.document)) return;
			treeProvider.onL3DocumentChanged(e.document);
			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => {
				rebuildUriIndex(e.document);
			}, DEBOUNCE_MS);
		}),
	);

	context.subscriptions.push(
		vscode.workspace.onDidCloseTextDocument(doc => {
			if (isReltioDocument(doc)) {
				diagnosticsManager.clear(doc.uri);
			}
			if (bpmnProcessIdForDocument(doc)) {
				// A pending update for a document that just closed would put findings back on it.
				bpmnDiagnosticsDebounce.cancel(doc.uri.toString());
				bpmnDiagnosticsManager.clear(doc.uri);
			}
		}),
	);

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (!editor) return;
			if (isReltioDocument(editor.document)) {
				rebuildUriIndex(editor.document);
			}
			// Unconditional rather than `else`: activating a BPMN is the moment a user
			// expects the Problems panel to be about the file in front of them, and it
			// is also the only chance to report on a file opened before this listener
			// existed — one downloaded from the tenant and never edited since.
			bpmnDiagnosticsManager.update(editor.document);
		}),
	);

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(async doc => {
			if (!isTenantConfigPath(doc.uri.path)) return;
			const key = logicalOpenedL3Key(doc.uri.fsPath);
			if (openedL3Files.has(key)) return;
			openedL3Files.add(key);
			await saveOpenedL3Files(context.workspaceState, openedL3Files);
			uxBus.fire();
		}),
	);

	const activeEditor = vscode.window.activeTextEditor;
	if (activeEditor && isReltioDocument(activeEditor.document)) {
		rebuildUriIndex(activeEditor.document);
	}
	if (activeEditor) {
		bpmnDiagnosticsManager.update(activeEditor.document);
	}

	// Restore OAuth sessions from SecretStorage for all known environments
	if (environmentManager) {
		void (async () => {
			try {
				const envs = await environmentManager.scanEnvironments();
				await Promise.all(
					envs.map(async env => {
						const rt = await sessionStore.loadRefreshToken(env.name);
						if (!rt) return;
						const credentials = await resolveOAuthCredentials(
							oauthCredentialsStore,
							env.name,
							envs.map(e => e.name),
						);
						if (!credentials) {
							await sessionStore.deleteRefreshToken(env.name);
							return;
						}
						try {
							const session = await refreshTokens(rt, credentials);
							tokenStore.setSession(env.name, session);
							await sessionStore.saveRefreshToken(env.name, session.refreshToken);
						} catch {
							await sessionStore.deleteRefreshToken(env.name);
						}
					}),
				);
				treeProvider.refresh();
			} catch {
				// Ignore scan failures at activation
			}
		})();
	}

	// Suppress walkthrough auto-open for upgrade users (anyone with existing state).
	if (environmentManager) {
		const seenKey = 'reltio.walkthroughSeen';
		const alreadySeen = context.globalState.get<boolean>(seenKey, false);
		if (!alreadySeen) {
			const envs = await environmentManager.scanEnvironments();
			let hasAnyOAuth = false;
			for (const e of envs) {
				if (await oauthCredentialsStore.hasClientCredentials(e.name)) {
					hasAnyOAuth = true;
					break;
				}
			}
			if (envs.length > 0 || hasAnyOAuth) {
				await context.globalState.update(seenKey, true);
			}
		}
	}

	// Auto-open the Setup Guide on first activation in a workspace with no envs.
	// Per-workspace flag in workspaceState — auto-opens once per workspace.
	if (environmentManager && !isClassic) {
		const guideAutoOpenedKey = 'reltio.setupGuideAutoOpened';
		const alreadyAutoOpened = context.workspaceState.get<boolean>(guideAutoOpenedKey, false);
		if (!alreadyAutoOpened) {
			const envs = await environmentManager.scanEnvironments();
			if (envs.length === 0) {
				openSetupGuidePanel(context);
				await context.workspaceState.update(guideAutoOpenedKey, true);
			}
		}
	}

	void refreshUxState();
	uxBus.onChange(() => { void refreshUxState(); });

	/** One FileSystemWatcher per unique tokenFile; change → one read → fan-out to all hosts. */
	const tokenFileWatcherDisposables: vscode.Disposable[] = [];
	const tokenFileReloadTimers = new Map<string, ReturnType<typeof setTimeout>>();

	function disposeTokenFileWatchers(): void {
		for (const d of tokenFileWatcherDisposables.splice(0)) {
			d.dispose();
		}
		for (const t of tokenFileReloadTimers.values()) {
			clearTimeout(t);
		}
		tokenFileReloadTimers.clear();
	}

	function setupTokenFileWatchers(): void {
		disposeTokenFileWatchers();
		if (!folder || !vscode.workspace.isTrusted) {
			return;
		}
		const bindings = indexTokenFilesByCanonicalPath(
			readDefaultEnvironmentEntries(),
			normalizeEnvironmentName,
			folder.uri,
		);
		for (const binding of bindings) {
			const base = vscode.Uri.file(path.dirname(binding.canonicalFsPath));
			const pattern = new vscode.RelativePattern(base, path.basename(binding.canonicalFsPath));
			const watcher = vscode.workspace.createFileSystemWatcher(pattern);
			const applyReload = (reason: 'startup' | 'changed'): void => {
				void reloadTokenFileIntoStore(binding, tokenStore).then(result => {
					if (!('ok' in result) || !result.ok) {
						console.error(
							`[reltio] tokenFile ${reason} load failed (${binding.canonicalFsPath}):`,
							'error' in result ? result.error : result,
						);
						return;
					}
					console.log(
						`[reltio] tokenFile ${reason} — one read, updated ${result.hosts.length} host(s)`,
					);
					uxBus.fire();
					treeProvider.refresh();
				});
			};
			const scheduleReload = (): void => {
				const prev = tokenFileReloadTimers.get(binding.canonicalFsPath);
				if (prev) clearTimeout(prev);
				tokenFileReloadTimers.set(
					binding.canonicalFsPath,
					setTimeout(() => {
						tokenFileReloadTimers.delete(binding.canonicalFsPath);
						applyReload('changed');
					}, 300),
				);
			};
			tokenFileWatcherDisposables.push(
				watcher,
				watcher.onDidChange(scheduleReload),
				watcher.onDidCreate(scheduleReload),
			);
			// Watcher alone does not fire for an already-existing file — load once at setup.
			applyReload('startup');
		}
	}

	context.subscriptions.push({ dispose: disposeTokenFileWatchers });
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('reltio.defaultEnvironments')) {
				setupTokenFileWatchers();
			}
		}),
	);
	setupTokenFileWatchers();

	// Git configuration-source commands (RP-189575).
	context.subscriptions.push(
		vscode.commands.registerCommand('reltio.fetchConfigFromGit', async () => {
			if (fetchConfigFromGitInFlight) {
				void vscode.window.showWarningMessage('Already fetching configuration from version control — please wait.');
				return;
			}
			fetchConfigFromGitInFlight = true;
			try {
			if (!folder || !environmentManager) {
				void vscode.window.showErrorMessage('Open a workspace folder to connect a repository.');
				return;
			}
			if (workspaceSource === 'tenant') {
				// Re-check disk rather than trusting the cached flag: the user may have deleted the
				// environment folders since activation, and file deletions do not refresh it.
				const currentEnvs = await environmentManager.scanEnvironments();
				if (currentEnvs.length > 0) {
					void vscode.window.showErrorMessage(
						'This workspace already has a connected Reltio tenant. Open a different, empty folder to connect a repository instead.',
					);
					return;
				}
				setWorkspaceSource(undefined);
			}
			const root = folder.uri;
			const alreadyTracked = await isGitRepoWithRemote(root);

			if (!alreadyTracked) {
				const url = await vscode.window.showInputBox({
					title: 'Connect your Repository',
					prompt: 'Git remote URL to clone (e.g. https://github.com/org/repo.git)',
					ignoreFocusOut: true,
					validateInput: v => (v?.trim() ? undefined : 'Enter a git remote URL'),
				});
				if (!url) return;

				let folderIsEmpty: boolean;
				try {
					folderIsEmpty = await isFolderEmpty(root);
				} catch (e) {
					void vscode.window.showErrorMessage(
						`Could not verify the folder is empty: ${(e as Error).message}`,
					);
					return;
				}
				if (!folderIsEmpty) {
					void vscode.window.showErrorMessage(
						'The open folder is not empty. Open an empty folder to clone into, then run this command again.',
					);
					return;
				}

				// `git clone` requires a literally empty directory on disk, but activation may have already
				// created `.reltio/` (synced agent skills/Velocity Packs) — move it aside for the clone, then restore it.
				// The temp location must be on the same volume as `root` (a sibling folder), not the OS temp dir —
				// os.tmpdir() can be a different drive on Windows, which makes `rename` fail with EXDEV and would
				// silently reintroduce the exact "folder not empty" deadlock this is meant to fix.
				const reltioFolderUri = vscode.Uri.joinPath(root, '.reltio');
				const reltioTempUri = vscode.Uri.file(path.join(path.dirname(root.fsPath), `.reltio-tmp-${Date.now()}`));
				let movedReltioAside = false;
				let reltioExists = true;
				try {
					await vscode.workspace.fs.stat(reltioFolderUri);
				} catch {
					reltioExists = false;
				}
				if (reltioExists) {
					try {
						await vscode.workspace.fs.rename(reltioFolderUri, reltioTempUri, { overwrite: true });
						movedReltioAside = true;
					} catch (e) {
						void vscode.window.showErrorMessage(
							`Could not clear the folder for cloning: failed to temporarily move .reltio aside (${(e as Error).message}).`,
						);
						return;
					}
				}

				try {
					await vscode.window.withProgress(
						{ location: vscode.ProgressLocation.Notification, title: 'Cloning repository…' },
						() => cloneRepository(url.trim(), root),
					);
				} catch (e) {
					if (e instanceof GitNotFoundError) {
						void vscode.window.showErrorMessage(e.message);
					} else {
						void vscode.window.showErrorMessage(`Clone failed: ${(e as Error).message}`);
					}
					return;
				} finally {
					if (movedReltioAside) {
						try {
							await vscode.workspace.fs.rename(reltioTempUri, reltioFolderUri, { overwrite: true });
						} catch {
							// Best-effort restore; a reload will re-sync `.reltio/` from scratch if this fails.
						}
					}
				}
			}

			const candidates = await discoverL3Files(root);

			if (candidates.length === 0) {
				const picked = await vscode.window.showOpenDialog({
					title: 'No BusinessConfig.json found. Locate the L3 configuration file',
					canSelectMany: false,
					filters: { 'Reltio L3 config': ['json'] },
					defaultUri: root,
				});
				if (!picked || picked.length === 0) return;
				const chosen = picked[0];
				if (!isPathContainedIn(root, chosen)) {
					void vscode.window.showErrorMessage(
						'The selected file must be inside the connected folder. Pick a file within the repository.',
					);
					return;
				}
				if (!(await isParsableL3File(chosen))) {
					void vscode.window.showErrorMessage(
						`"${vscode.workspace.asRelativePath(chosen, false)}" is not valid JSON and can't be used as the config source.`,
					);
					return;
				}
				candidates.push(chosen);
			}

			// Validate all candidates
			const validCandidates: vscode.Uri[] = [];
			for (const candidate of candidates) {
				if (await isParsableL3File(candidate)) {
					validCandidates.push(candidate);
				}
			}

			if (validCandidates.length === 0) {
				void vscode.window.showErrorMessage('No valid BusinessConfig.json files found in the repository.');
				return;
			}

			const gitSources = buildGitSources(root, validCandidates);
			await writeMultiGitSourceMarker(root, {
				sources: gitSources.map(g => ({
					l3RelativePath: vscode.workspace.asRelativePath(g.l3Uri, false),
					environmentName: g.environmentName,
					tenantId: g.tenantId,
				})),
			});

			// Set token only once per environment (not per tenant)
			if (gitSources.length > 0) {
				tokenStore.setToken(gitSources[0].environmentName, GIT_SOURCE_TOKEN);
			}

			environmentManager.setGitSources(gitSources);
			setWorkspaceSource('git');
			treeProvider.invalidate();
			uxBus.fire();

			const message = validCandidates.length === 1
				? `Loaded configuration from the repository.`
				: `Loaded ${validCandidates.length} configurations from the repository.`;
			void vscode.window.showInformationMessage(
				alreadyTracked ? message : `Cloned and ${message.toLowerCase()}`,
			);
			} finally {
				fetchConfigFromGitInFlight = false;
			}
		}),
		vscode.commands.registerCommand('reltio.removeGitSource', async (node?: EnvironmentNode) => {
			if (!folder || !environmentManager || workspaceSource !== 'git') return;
			const pick = await vscode.window.showWarningMessage(
				'Remove this repository connection? This unlinks all tenants from the workspace and deletes all files in this folder — this cannot be undone.',
				{ modal: true },
				'Remove',
			);
			if (pick !== 'Remove') return;
			let deleteError: Error | undefined;
			try {
				const entries = await vscode.workspace.fs.readDirectory(folder.uri);
				for (const [name] of entries) {
					const entryUri = vscode.Uri.joinPath(folder.uri, name);
					try {
						// Prefer the OS trash so an accidental confirm click is recoverable.
						await vscode.workspace.fs.delete(entryUri, { recursive: true, useTrash: true });
					} catch {
						// Trash isn't available on every filesystem (network drives, some remote/WSL setups) —
						// fall back to a permanent delete for this entry rather than failing the whole removal.
						await vscode.workspace.fs.delete(entryUri, { recursive: true, useTrash: false });
					}
				}
			} catch (e) {
				deleteError = e as Error;
			} finally {
				// Clear git-source state even on a partial failure — leaving `workspaceSource` at 'git'
				// would point the tree at files that may no longer exist.
				environmentManager.clearGitSource();
				// Clear all git source tokens
				const marker = await readMultiGitSourceMarker(folder.uri);
				if (marker) {
					for (const source of marker.sources) {
						tokenStore.clearToken(source.environmentName);
					}
				}
				setWorkspaceSource(undefined);
				treeProvider.invalidate();
				uxBus.fire();
			}
			if (deleteError) {
				void vscode.window.showErrorMessage(
					`Repository state was cleared, but some files could not be deleted: ${deleteError.message}`,
				);
			} else {
				void vscode.window.showInformationMessage('Repository removed. The folder is now empty.');
			}
		}),
		vscode.commands.registerCommand('reltio.removeGitTenant', async (node?: TenantNode) => {
			if (!folder || !environmentManager || !node || workspaceSource !== 'git') return;
			// Prompt and report with the row's own label. `tenantId` may carry a collision qualifier
			// the user never saw, so echoing it back would name a config that is not on screen.
			const shown = node.displayLabel ?? node.tenantId;
			const pick = await vscode.window.showWarningMessage(
				`Remove configuration "${shown}"? This cannot be undone.`,
				{ modal: true },
				'Remove',
			);
			if (pick !== 'Remove') return;

			// Read current marker
			const marker = await readMultiGitSourceMarker(folder.uri);
			if (!marker || marker.sources.length === 0) return;

			// Filter out the removed tenant by tenantId (not environmentName, since all share the same repo name)
			const remainingSources = marker.sources.filter(s => s.tenantId !== node.tenantId);

			if (remainingSources.length === 0) {
				// Last tenant removed - disconnect repository entirely
				void vscode.window.showInformationMessage(
					'Last tenant removed. Use "Remove Repository" from the view title to delete all files.',
				);
				// Just clear the marker and state, but keep files
				environmentManager.clearGitSource();
				tokenStore.clearToken(node.environmentName);
				setWorkspaceSource(undefined);
				try {
					const markerUri = vscode.Uri.joinPath(folder.uri, '.reltio-config-source.json');
					await vscode.workspace.fs.delete(markerUri);
				} catch {
					// Ignore if marker doesn't exist
				}
			} else {
				// Update marker with remaining sources
				await writeMultiGitSourceMarker(folder.uri, { sources: remainingSources });

				// Rebuild git sources
				const gitSources = buildGitSources(
					folder.uri,
					remainingSources.map(s => vscode.Uri.joinPath(folder.uri, s.l3RelativePath)),
				);
				environmentManager.setGitSources(gitSources);
				// Every source in a repository shares one environment name (see the filter above), so
				// clearing the token here would revoke git mode for the configs that remain: the tree
				// would fall back to the flat tenant-mode branch and the environment would ask the user
				// to sign in. Re-assert it instead, matching connect, restore, and Add Config.
				tokenStore.setToken(gitSources[0].environmentName, GIT_SOURCE_TOKEN);
			}

			treeProvider.invalidate();
			uxBus.fire();
			void vscode.window.showInformationMessage(`Removed "${shown}".`);
		}),
		vscode.commands.registerCommand('reltio.addFileAsTenant', async (uri: vscode.Uri) => {
			if (!environmentManager || !uri) return;
			const folder = getWorkspaceFolder();
			if (!folder) {
				void vscode.window.showErrorMessage('No workspace folder open.');
				return;
			}
			const root = folder.uri;

			// Verify it's a git repo
			if (!(await isGitRepo(root))) {
				void vscode.window.showErrorMessage('This command only works in git repositories. Use "Connect your Repository" first.');
				return;
			}

			// Verify file is within workspace
			if (!isPathContainedIn(root, uri)) {
				void vscode.window.showErrorMessage('The selected file must be inside the workspace folder.');
				return;
			}

			// Only a real business configuration may be adopted: a repository is full of other JSON
			// (permissions, lookups, cleanse config) that would produce an unusable tree row.
			if (!(await isBusinessConfigFile(uri))) {
				void vscode.window.showErrorMessage(
					`"${vscode.workspace.asRelativePath(uri, false)}" is not a valid Reltio business configuration`,
				);
				return;
			}

			// Read existing marker
			const existing = await readMultiGitSourceMarker(root);
			const existingSources = existing?.sources ?? [];

			// Check if this file is already added
			const relPath = vscode.workspace.asRelativePath(uri, false);
			if (existingSources.some(s => s.l3RelativePath === relPath)) {
				void vscode.window.showInformationMessage(`"${relPath}" is already added.`);
				return;
			}

			// Build list of all L3 URIs (existing + new)
			const existingUris = existingSources.map(s => vscode.Uri.joinPath(root, s.l3RelativePath));
			const allL3Uris = [...existingUris, uri];

			// Adding a file can change which names are unique, so re-derive the whole set.
			const gitSources = buildGitSources(root, allL3Uris);
			await writeMultiGitSourceMarker(root, {
				sources: gitSources.map(g => ({
					l3RelativePath: vscode.workspace.asRelativePath(g.l3Uri, false),
					environmentName: g.environmentName,
					tenantId: g.tenantId,
				})),
			});
			environmentManager.setGitSources(gitSources);
			if (gitSources.length > 0) {
				tokenStore.setToken(gitSources[0].environmentName, GIT_SOURCE_TOKEN);
			}

			setWorkspaceSource('git');
			treeProvider.invalidate();
			uxBus.fire();

			const added = gitSources.find(g => g.l3Uri.path === uri.path);
			void vscode.window.showInformationMessage(`Added "${relPath}" as "${added?.tenantId ?? relPath}".`);
		}),
	);

	const applyOnActivate = vscode.workspace
		.getConfiguration('reltio')
		.get<boolean>('applyDefaultsOnActivate', false);
	if (applyOnActivate && environmentManager && folder && vscode.workspace.isTrusted) {
		void runApplyDefaultEnvironments(false).catch(err => {
			console.error('[reltio] applyDefaultEnvironments on activate failed:', err);
		});
	}

}

export function deactivate(): void {
	// Cleanup handled by subscriptions
}
