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
import { ReltioUriCompletionProvider } from './navigation/uriCompletionProvider';
import { OntologyPanelManager } from './ontology/ontologyPanel';
import { EnvironmentManager } from './workspace/environmentManager';
import {
	applyDefaultEnvironments,
	indexTokenFilesByCanonicalPath,
	readDefaultEnvironmentEntries,
	reloadTokenFileIntoStore,
	summarizeApplyResult,
} from './workspace/applyDefaultEnvironments';
import { TokenStore } from './api/tokenStore';
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
	clearHistoryDirectory,
	immediateOlderSnapshot,
	listLocalHistorySnapshots,
	writeHistorySnapshot,
} from './workspace/configurationHistory';
import { syncReltioAgentAssets } from './workspace/reltioAgentSync';
import { registerReltioAutoSave } from './workspace/reltioAutoSave';
import {
	isGitRepo,
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
import { discoverL3Files, deriveTenantNaming, isParsableL3File } from './workspace/l3Discovery';

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

async function tryRestoreGitSource(
	environmentManager: EnvironmentManager,
	tokenStore: TokenStore,
	workspaceRoot: vscode.Uri,
): Promise<boolean> {
	const multiMarker = await readMultiGitSourceMarker(workspaceRoot);
	if (!multiMarker || multiMarker.sources.length === 0) return false;
	if (!(await isGitRepo(workspaceRoot))) return false;

	const validSources: Array<{ environmentName: string; tenantId: string; l3Uri: vscode.Uri }> = [];
	for (const marker of multiMarker.sources) {
		const l3Uri = vscode.Uri.joinPath(workspaceRoot, marker.l3RelativePath);
		if (!isPathContainedIn(workspaceRoot, l3Uri)) continue;
		try {
			await vscode.workspace.fs.stat(l3Uri);
		} catch {
			continue;
		}
		if (!(await isParsableL3File(l3Uri))) continue;
		validSources.push({
			environmentName: marker.environmentName,
			tenantId: marker.tenantId,
			l3Uri,
		});
	}

	if (validSources.length === 0) return false;
	environmentManager.setGitSources(validSources);
	// Set token once for the environment (not per tenant)
	if (validSources.length > 0) {
		tokenStore.setToken(validSources[0].environmentName, '__reltio-git-source__');
	}
	return true;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
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

	if (environmentManager && folder) {
		const realEnvs = await environmentManager.scanEnvironments();
		if (realEnvs.length > 0) {
			setWorkspaceSource('tenant');
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
		const loc = pathTenantLocFromL3Path(pathOrKey);
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
	const uriCompletionProvider = new ReltioUriCompletionProvider();
	const ontologyManager = new OntologyPanelManager();

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

	async function ensureL3DocumentSaved(l3Uri: vscode.Uri): Promise<boolean> {
		const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === l3Uri.toString());
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
	 * True when local L3 has edits that were never published to the tenant, i.e. it no longer
	 * matches `L3.remote-baseline.reltio.json` (the snapshot recorded at the last successful fetch).
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

		const saved = await ensureL3DocumentSaved(l3Uri);
		if (!saved) {
			void vscode.window.showErrorMessage('Save L3.reltio.json before applying.');
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
				value: existingSsoTenantId ?? 'GrmSwAZFRAeVy1K',
				placeHolder: 'GrmSwAZFRAeVy1K',
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
				await ensureL3DocumentSaved(l3Uri);
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
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(e => {
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
		}),
	);

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor && isReltioDocument(editor.document)) {
				rebuildUriIndex(editor.document);
			}
		}),
	);

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(async doc => {
			if (!doc.uri.path.endsWith('/L3.reltio.json')) return;
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

			// Create sources for all valid candidates
			const sources = validCandidates.map((l3Uri) => {
				const { environmentName, tenantId } = deriveTenantNaming(root, l3Uri, validCandidates);
				return {
					l3RelativePath: vscode.workspace.asRelativePath(l3Uri, false),
					environmentName,
					tenantId,
				};
			});

			await writeMultiGitSourceMarker(root, { sources });

			const gitSources = validCandidates.map((l3Uri) => {
				const { environmentName, tenantId } = deriveTenantNaming(root, l3Uri, validCandidates);
				return { environmentName, tenantId, l3Uri };
			});

			// Set token only once per environment (not per tenant)
			if (gitSources.length > 0) {
				tokenStore.setToken(gitSources[0].environmentName, '__reltio-git-source__');
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
			const pick = await vscode.window.showWarningMessage(
				`Remove tenant "${node.tenantId}"? This cannot be undone.`,
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
				const gitSources = remainingSources.map(s => {
					const l3Uri = vscode.Uri.joinPath(folder.uri, s.l3RelativePath);
					return { environmentName: s.environmentName, tenantId: s.tenantId, l3Uri };
				});
				environmentManager.setGitSources(gitSources);
				tokenStore.clearToken(node.environmentName);
			}

			treeProvider.invalidate();
			uxBus.fire();
			void vscode.window.showInformationMessage(`Tenant "${node.environmentName}" removed.`);
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

			// Verify it's valid JSON
			if (!(await isParsableL3File(uri))) {
				void vscode.window.showErrorMessage(
					`"${vscode.workspace.asRelativePath(uri, false)}" is not valid JSON and can't be used as a tenant configuration.`,
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

			// Derive naming with conflict detection
			const { environmentName, tenantId } = deriveTenantNaming(root, uri, allL3Uris);

			// Re-derive naming for all existing sources (in case new file creates conflicts)
			const updatedSources = existingSources.map(s => {
				const srcUri = vscode.Uri.joinPath(root, s.l3RelativePath);
				const { environmentName: env, tenantId: tid } = deriveTenantNaming(root, srcUri, allL3Uris);
				return {
					l3RelativePath: s.l3RelativePath,
					environmentName: env,
					tenantId: tid,
				};
			});

			// Add new source
			updatedSources.push({
				l3RelativePath: relPath,
				environmentName,
				tenantId,
			});

			await writeMultiGitSourceMarker(root, { sources: updatedSources });

			// Rebuild git sources
			const gitSources = updatedSources.map(s => {
				const srcUri = vscode.Uri.joinPath(root, s.l3RelativePath);
				return { environmentName: s.environmentName, tenantId: s.tenantId, l3Uri: srcUri };
			});
			environmentManager.setGitSources(gitSources);
			if (gitSources.length > 0) {
				tokenStore.setToken(gitSources[0].environmentName, '__reltio-git-source__');
			}

			setWorkspaceSource('git');
			treeProvider.invalidate();
			uxBus.fire();

			void vscode.window.showInformationMessage(`Added "${relPath}" as "${tenantId}".`);
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
