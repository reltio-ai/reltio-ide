/**
 * Tree node classes for the Workflows sub-tree under each tenant.
 *
 * Hierarchy rendered by `MultiTenantTreeProvider.getChildren()`:
 *
 *   TenantNode
 *   ├─ BusinessConfigFolderNode   (from multiTenantNodes.ts — existing config)
 *   └─ WorkflowsFolderNode            (connect / disconnect / sync status live on this row)
 *       ├─ [before first fetch]  WorkflowFetchActionNode  ("Fetch Workflows…")
 *       ├─ ProcessDefinitionsFolderNode   (one merged list, one row per process id)
 *       │   ├─ ProcessDefinitionNode      (deployed: OOTB or custom)
 *       │   └─ WorkflowDraftNode          (not deployed: local draft or repository file)
 *       ├─ JarDeploymentsFolderNode
 *       │   ├─ JarDeploymentNode        (one per registered JAR)
 *       │   └─ UnregisteredJarsFolderNode  (only when non-empty)
 *       │       └─ UnregisteredJarNode     (one per S3 JAR not yet registered)
 *       └─ [only when a Custom Workflow Repository is connected]
 *           ├─ WorkflowRepoGroupNode "Java Classes"
 *           └─ WorkflowRepoGroupNode "Java Tests"
 *               └─ WorkflowRepoModuleNode → WorkflowRepoJavaFileNode
 *
 * Node classes are intentionally kept separate from `multiTenantNodes.ts` so
 * that the `ConfigNodeType` union in `treeNodes.ts` is not widened by this
 * feature — workflow nodes are structurally distinct from config nodes.
 */
import * as vscode from 'vscode';
import type { ProcessDefinition, JarDeployment, AvailableJar } from '../api/workflowAdapterClient';
import type { WorkflowDraft } from '../workspace/workflowDrafts';
import type { WorkflowRepoConfig } from '../workspace/workflowRepoConfig';
import type { DiscoveredJavaSource } from '../workspace/workflowRepoJavaDiscovery';
import type { ProcessRow, RepoRowState } from './processDefinitionRows';
import { redactUrl } from '../workspace/gitConfigSource';

// ─── Tooltip helpers ─────────────────────────────────────────────────────────

/**
 * Escape the characters that would otherwise be read as Markdown syntax.
 *
 * Every value in these tooltips comes from the Adapter — a `displayName` is the
 * BPMN's own `<process name="...">`, which the customer wrote. An underscore or
 * asterisk in it would silently italicise the rest of the line. Same reasoning
 * as `escapeHtml()` in `src/ontology/inspectorHtml.ts`, for a different sink.
 *
 * Only the inline constructs are escaped. A full CommonMark escape set would
 * also take `.`, `-` and `#`, which matter solely at the start of a line — and
 * every value here is preceded by its `Label: `, so none of them ever is. Taking
 * them anyway is not merely harmless noise: it renders `jane@acme\.com` and
 * `com\.acme:workflow:1\.2\.0`, turning an email and a module path into
 * something the user cannot copy.
 */
function escapeMarkdown(value: string): string {
	return value.replace(/[\\`*_[\]<>]/g, '\\$&');
}

/**
 * Render an epoch-millisecond timestamp, or `undefined` when there isn't one.
 *
 * `isProcessDefinition`/`isJarDeployment` require only the identity field, so
 * every other field on a row is genuinely optional at runtime. Passing a missing
 * timestamp to `new Date()` yields the string "Invalid Date", which reads like a
 * data problem on the tenant rather than a field the Adapter simply omitted.
 */
function formatTimestamp(epochMs: number | undefined): string | undefined {
	if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) return undefined;
	const date = new Date(epochMs);
	return Number.isNaN(date.getTime()) ? undefined : date.toLocaleString();
}

/**
 * Build a tooltip whose first line is a bold classification and whose remaining
 * lines are `Label: value` pairs, skipping any pair without a value.
 *
 * Two trailing spaces force a Markdown line break, keeping the fields in one
 * block; a blank line would space them out like paragraphs.
 */
function buildTooltip(
	heading: string,
	fields: readonly (readonly [string, string | undefined])[],
	footer?: string,
): vscode.MarkdownString {
	const lines = fields
		.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
		.map(([label, value]) => `${label}: ${escapeMarkdown(value)}`);

	let text = `**${heading}**\n\n${lines.join('  \n')}`;
	if (footer) text += `\n\n${escapeMarkdown(footer)}`;

	// Left untrusted (the default): these strings are server-derived, and a
	// trusted MarkdownString would let one render a `command:` link.
	return new vscode.MarkdownString(text);
}

// ─── Top-level folder ────────────────────────────────────────────────────────

/**
 * The "Workflows" folder shown directly under a `TenantNode`, regardless of
 * whether the tenant has an L3 loaded. Clicking it (when no URL is saved)
 * triggers the `reltio.fetchWorkflows` command.
 *
 * It is also where the Custom Workflow Repository lives in the UI: connect, disconnect, open and
 * sync status are this row's context menu and description, not a row of their own. The
 * `.repo` suffix on the contextValue is what switches the menu from "Connect…" to the rest.
 */
export class WorkflowsFolderNode extends vscode.TreeItem {
	constructor(
		readonly environmentName: string,
		readonly tenantId: string,
		/**
		 * `undefined` when no URL has been saved yet (pre-first-fetch).
		 * Present when the URL sidecar exists (may still be loading).
		 */
		readonly savedAdapterUrl: string | undefined,
		/**
		 * The connected Custom Workflow Repository, if any. A connected repository needs no Adapter
		 * URL, so the folder has children to show even before one is saved; without that the folder
		 * was not expandable and the repository's Java could never be reached.
		 */
		readonly repoConfig: WorkflowRepoConfig | undefined = undefined,
	) {
		const hasRepo = repoConfig !== undefined;
		super(
			'Workflows',
			savedAdapterUrl === undefined && !hasRepo
				? vscode.TreeItemCollapsibleState.None
				: vscode.TreeItemCollapsibleState.Collapsed,
		);
		this.contextValue =
			(savedAdapterUrl === undefined
				? 'reltio.workflows.folder.noUrl'
				: 'reltio.workflows.folder') + (hasRepo ? '.repo' : '');
		this.iconPath = new vscode.ThemeIcon('git-branch');
		this.id = `workflows:${environmentName}/${tenantId}`;

		// When no URL is saved, clicking the folder opens the prompt directly — unless a repository is
		// connected, where a click must expand the folder rather than interrupt with a prompt (the
		// URL can still be set from the folder's context menu).
		if (savedAdapterUrl === undefined && !hasRepo) {
			this.command = {
				command: 'reltio.fetchWorkflows',
				title: 'Fetch Workflows',
				arguments: [this],
			};
		}
		this.description = describeWorkflowsFolder(savedAdapterUrl !== undefined, hasRepo);
		this.tooltip = repoConfig
			? buildTooltip('Workflows', [
				['Custom Workflow Repository', redactUrl(repoConfig.repoUrl)],
				['Folder', repoConfig.relativePath],
			])
			: 'Right-click to connect a Custom Workflow Repository, the Java side of custom workflows.';
	}
}

/** Description for the Workflows row: what still needs doing, or that a repository is connected. */
export function describeWorkflowsFolder(hasAdapterUrl: boolean, hasRepo: boolean): string | undefined {
	if (!hasAdapterUrl) return hasRepo ? 'Adapter URL not set • repository connected' : 'Click to configure';
	return hasRepo ? 'repository connected' : undefined;
}

// ─── Pre-fetch action row ─────────────────────────────────────────────────────

/**
 * Shown as the sole child of `WorkflowsFolderNode` when an Adapter URL has
 * been saved but workflows haven't been loaded into memory yet for this
 * session (e.g. after a window reload). Clicking it triggers a fetch.
 */
export class WorkflowFetchActionNode extends vscode.TreeItem {
	constructor(
		readonly environmentName: string,
		readonly tenantId: string,
	) {
		super('Fetch Workflows…', vscode.TreeItemCollapsibleState.None);
		this.contextValue = 'reltio.workflows.fetchAction';
		this.iconPath = new vscode.ThemeIcon('cloud-download');
		this.id = `workflowFetch:${environmentName}/${tenantId}`;
		this.command = {
			command: 'reltio.fetchWorkflows',
			title: 'Fetch Workflows',
			arguments: [this],
		};
	}
}

/**
 * "Connect Custom Workflow Repository…", shown under the Workflows row while no repository is
 * connected. The same action is on the row's context menu; this makes it discoverable without a
 * right-click. It disappears once a repository is connected, when Java Classes and Java Tests
 * take its place and the Workflows row itself carries the connection status.
 */
export class WorkflowConnectRepoActionNode extends vscode.TreeItem {
	constructor(
		readonly environmentName: string,
		readonly tenantId: string,
	) {
		super('Connect Custom Workflow Repository…', vscode.TreeItemCollapsibleState.None);
		this.contextValue = 'reltio.workflows.connectRepoAction';
		this.iconPath = new vscode.ThemeIcon('plug');
		this.id = `workflowConnectRepo:${environmentName}/${tenantId}`;
		this.tooltip = 'Clone your Reltio-provisioned workflow repository into this tenant\'s Workflows folder.';
		this.command = {
			command: 'reltio.connectWorkflowRepository',
			title: 'Connect Custom Workflow Repository',
			arguments: [this],
		};
	}
}

// ─── Sub-folders ─────────────────────────────────────────────────────────────

/**
 * The single "Process Definitions" list: deployed workflows, local drafts and repository files
 * merged by process id (see `processDefinitionRows.ts`).
 */
export class ProcessDefinitionsFolderNode extends vscode.TreeItem {
	constructor(
		readonly environmentName: string,
		readonly tenantId: string,
		readonly rows: readonly ProcessRow<vscode.Uri>[],
	) {
		const count = rows.length;
		super(
			`Process Definitions (${count})`,
			count > 0
				? vscode.TreeItemCollapsibleState.Expanded
				: vscode.TreeItemCollapsibleState.None,
		);
		this.contextValue = 'reltio.workflows.processDefinitions.folder';
		this.iconPath = new vscode.ThemeIcon('symbol-event');
		this.id = `workflowProcessDefs:${environmentName}/${tenantId}`;
	}
}

export class JarDeploymentsFolderNode extends vscode.TreeItem {
	constructor(
		readonly environmentName: string,
		readonly tenantId: string,
		readonly deployments: JarDeployment[],
		/**
		 * JARs found on the tenant's S3 location that are not yet registered, or
		 * `undefined` when that discovery isn't available for this tenant this
		 * session — either it hasn't been fetched yet, or the tenant lacks the
		 * `jarsLocation` config `listJars` depends on (confirmed real: a tenant can
		 * have working registered JARs without it). Both cases render identically —
		 * no nested folder — so the difference between them is not tracked here.
		 */
		readonly unregistered: readonly AvailableJar[] | undefined = undefined,
	) {
		const count = deployments.length;
		super(
			`JAR Deployments (${count})`,
			count > 0 || (unregistered?.length ?? 0) > 0
				? vscode.TreeItemCollapsibleState.Expanded
				: vscode.TreeItemCollapsibleState.None,
		);
		this.contextValue = 'reltio.workflows.jarDeployments.folder';
		this.iconPath = new vscode.ThemeIcon('package');
		this.id = `workflowJars:${environmentName}/${tenantId}`;
	}
}

/**
 * Nested under `JarDeploymentsFolderNode`, shown only when at least one JAR is
 * present: an always-present empty
 * folder is noise on the (expected to be common) tenants where everything on
 * S3 is already registered.
 */
export class UnregisteredJarsFolderNode extends vscode.TreeItem {
	constructor(
		readonly environmentName: string,
		readonly tenantId: string,
		readonly jars: readonly AvailableJar[],
	) {
		super(
			`Unregistered (${jars.length})`,
			jars.length > 0
				? vscode.TreeItemCollapsibleState.Expanded
				: vscode.TreeItemCollapsibleState.None,
		);
		this.contextValue = 'reltio.workflows.unregisteredJars.folder';
		this.iconPath = new vscode.ThemeIcon('archive');
		this.id = `workflowUnregisteredJars:${environmentName}/${tenantId}`;
		this.tooltip =
			'JARs found in this tenant\u2019s S3 location that have not been registered yet. ' +
			'Right-click one to register it.';
	}
}

// ─── Leaves ──────────────────────────────────────────────────────────────────

/**
 * One deployed BPMN process definition. Clicking it opens the BPMN XML in a
 * read-only virtual document via `reltio.openWorkflowBpmn`.
 *
 * Which of the deployed-row states it shows, in precedence order: local edits, then
 * "differs from repository", then "not tracked in repository" (see `processDefinitionRows.ts`).
 */
export class ProcessDefinitionNode extends vscode.TreeItem {
	constructor(
		readonly environmentName: string,
		readonly tenantId: string,
		readonly definition: ProcessDefinition,
		/**
		 * Local state of this definition's downloaded copy:
		 *   'none'    — not downloaded
		 *   'clean'   — downloaded, matches the baseline from the last fetch
		 *   'changed' — downloaded and edited, not yet deployed
		 */
		readonly localState: 'none' | 'clean' | 'changed' = 'none',
	) {
		super(definition.displayName || definition.type, vscode.TreeItemCollapsibleState.None);
		// A distinct contextValue per case, so Deploy / Discard / Compare appear only where they
		// mean something.
		this.contextValue = localState === 'changed'
			? 'reltio.workflows.processDefinition.changed'
			: 'reltio.workflows.processDefinition';

		// Where a row came from is the icon: a method for Reltio's own (OOTB) workflows, a class for
		// the customer's workflows deployed on the tenant. Repository files use a repository icon and
		// local drafts a pencil, so the four origins read apart at a glance.
		this.iconPath = new vscode.ThemeIcon(
			definition.generic ? 'symbol-method' : 'symbol-class',
			localState === 'changed' ? new vscode.ThemeColor('gitDecoration.modifiedResourceForeground') : undefined,
		);
		this.description = localState === 'changed' ? `${definition.type} • local changes` : definition.type;
		// Whether a definition is Reltio's or the customer's is the first thing
		// that changes what you may safely do to it — redeploying an id that is
		// already live replaces it — so it leads, in bold, rather than trailing
		// the tooltip in brackets.
		this.tooltip = buildTooltip(
			definition.generic ? 'OOTB workflow' : 'Custom workflow',
			[
				['Name', definition.displayName || definition.type],
				['ID', definition.type],
				['Deployed by', definition.deployedBy],
				['Deployed', formatTimestamp(definition.deployTime)],
			],
			localState === 'changed'
				? 'You have local changes that have not been deployed.'
				: localState === 'clean'
					? 'Downloaded locally; matches the tenant.'
					: undefined,
		);
		this.id = `workflowDef:${environmentName}/${tenantId}/${definition.type}`;
		this.command = {
			command: 'reltio.openWorkflowBpmn',
			title: 'Open BPMN',
			arguments: [this],
		};
	}
}

/**
 * One registered JAR deployment. Read-only info node (no command).
 */
export class JarDeploymentNode extends vscode.TreeItem {
	constructor(
		readonly environmentName: string,
		readonly tenantId: string,
		readonly deployment: JarDeployment,
	) {
		super(deployment.name || deployment.module, vscode.TreeItemCollapsibleState.None);
		this.contextValue = 'reltio.workflows.jarDeployment';
		this.iconPath = new vscode.ThemeIcon('file-binary');
		this.description = deployment.description || undefined;
		this.tooltip = buildTooltip('Custom JAR', [
			['Name', deployment.name],
			['Description', deployment.description],
			['Module', deployment.module],
			['Registered by', deployment.createdBy],
			['Registered', formatTimestamp(deployment.createTime)],
		]);
		this.id = `workflowJar:${environmentName}/${tenantId}/${deployment.module}`;
	}
}

/**
 * The file name at the end of an S3 module path, e.g.
 * `reltio.workflow-custom-jars/Acme/my-1.0.0.jar` → `my-1.0.0.jar`. Used as
 * the label and as the pre-filled suggestion when registering — it is rarely
 * the final name a customer wants (that's why registration still asks), but
 * it is a better starting point than the full path.
 */
export function jarModuleFileName(module: string): string {
	const lastSlash = module.lastIndexOf('/');
	return lastSlash === -1 ? module : module.slice(lastSlash + 1);
}

/** Human-readable byte size, e.g. `1.2 MB`. Whole-number byte counts are shown as-is. */
function formatBytes(bytes: number | undefined): string | undefined {
	if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return undefined;
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB'];
	let value = bytes / 1024;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}
	return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * One JAR found on S3 but not yet registered on the tenant. Clicking it starts
 * registration (`reltio.registerJarDeployment`) — the same action available
 * from the context menu, so a first-time user discovers it without needing to
 * know to right-click.
 */
export class UnregisteredJarNode extends vscode.TreeItem {
	constructor(
		readonly environmentName: string,
		readonly tenantId: string,
		readonly jar: AvailableJar,
	) {
		super(jarModuleFileName(jar.module), vscode.TreeItemCollapsibleState.None);
		this.contextValue = 'reltio.workflows.unregisteredJar';
		this.iconPath = new vscode.ThemeIcon('circle-large-outline');
		this.tooltip = buildTooltip(
			'Not yet registered',
			[
				['Module', jar.module],
				['Size', formatBytes(jar.size)],
				['Last modified', formatTimestamp(jar.updateTime)],
			],
			'Right-click, or click, to register this JAR on the tenant.',
		);
		this.id = `workflowUnregisteredJar:${environmentName}/${tenantId}/${jar.module}`;
		this.command = {
			command: 'reltio.registerJarDeployment',
			title: 'Register JAR',
			arguments: [this],
		};
	}
}

// ─── Custom Workflow Repository content ──────────────────────────────────────

/**
 * Which kind of repository Java a `WorkflowRepoGroupNode` stands for. BPMN is not a group: it is
 * merged into Process Definitions, where it sits beside the deployed workflow it implements.
 */
export type WorkflowRepoGroupKind = 'javaMain' | 'javaTest';

const GROUP_LABELS: Record<WorkflowRepoGroupKind, string> = {
	javaMain: 'Java Classes',
	javaTest: 'Java Tests',
};

const GROUP_ICONS: Record<WorkflowRepoGroupKind, string> = {
	javaMain: 'symbol-class',
	javaTest: 'beaker',
};

const GROUP_TOOLTIPS: Record<WorkflowRepoGroupKind, string> = {
	javaMain: 'Java sources under src/main/java. Edited in place; reaching the tenant still requires Reltio\u2019s review and JAR registration.',
	javaTest: 'Java sources under src/test/java. The review gate requires 80% coverage, so these are part of getting a change merged.',
};

/**
 * One kind of repository Java, a top-level sibling of Process Definitions and JAR Deployments.
 * Present only while a repository is connected, and then always, even at zero: the folder's
 * presence is what says "a repository is connected" at a glance.
 *
 * Inside it the files are always grouped by Maven module (`WorkflowRepoModuleNode`), even for a
 * single module: the layout is the same whether the repository has one module or ten, so
 * nothing shifts when a second one is added.
 */
export class WorkflowRepoGroupNode extends vscode.TreeItem {
	constructor(
		readonly environmentName: string,
		readonly tenantId: string,
		readonly kind: WorkflowRepoGroupKind,
		readonly count: number,
	) {
		super(
			`${GROUP_LABELS[kind]} (${count})`,
			// Tests start collapsed; main sources do not. Main sources are what the customer came
			// to look at, whereas tests are opened when a coverage gate fails.
			count === 0
				? vscode.TreeItemCollapsibleState.None
				: kind === 'javaTest'
					? vscode.TreeItemCollapsibleState.Collapsed
					: vscode.TreeItemCollapsibleState.Expanded,
		);
		this.contextValue = `reltio.workflows.customRepo.group.${kind}`;
		this.iconPath = new vscode.ThemeIcon(GROUP_ICONS[kind]);
		this.id = `workflowRepoGroup:${environmentName}/${tenantId}/${kind}`;
		this.tooltip = GROUP_TOOLTIPS[kind];
	}
}

/** Label and id-segment for a file with no detected Maven module — see `nearestModuleFor()`. */
const NO_MODULE_LABEL = '(no module)';
const NO_MODULE_ID_SEGMENT = '\u0000no-module';

/**
 * The grouping layer between a `WorkflowRepoGroupNode` (Java Classes / Java Tests) and its
 * file rows, inserted by `multiTenantTreeProvider.ts`'s `getChildren()` always — even for a
 * single-module repository, so the layout does not shift when a second module is added.
 *
 * Modeled directly on `WorkflowRepoGroupNode`: the same collapsed-by-default state, the
 * same `tenant/environment + kind`-based id convention with the module name appended, and
 * `vscode.ThemeIcon.Folder` — already used for `GitFolderNode` elsewhere in this tree —
 * rather than a new icon, since a Maven module is, physically, a directory.
 *
 * This claims only that these files share a Maven module's directory — never that they
 * implement the same logical workflow, and never that one calls the other. `bpmnModel.ts`
 * extracts the literal `activiti:class` string only, not delegate expressions or listener
 * bindings, so a stronger claim would misreport shared helper classes — and every test
 * class — as unrelated (`workflow-repo-contents-and-agent-access` design.md, decision D4).
 * A file with no detected module is never dropped to keep this grouping tidy; it renders
 * in the literal `(no module)` bucket instead.
 */
export class WorkflowRepoModuleNode extends vscode.TreeItem {
	constructor(
		readonly environmentName: string,
		readonly tenantId: string,
		readonly kind: WorkflowRepoGroupKind,
		/** `undefined` for the `(no module)` bucket — no `pom.xml` ancestor was found. */
		readonly moduleName: string | undefined,
		readonly count: number,
	) {
		super(`${moduleName ?? NO_MODULE_LABEL} (${count})`, vscode.TreeItemCollapsibleState.Collapsed);
		this.contextValue = `reltio.workflows.customRepo.module.${kind}`;
		this.iconPath = vscode.ThemeIcon.Folder;
		this.id = `workflowRepoModule:${environmentName}/${tenantId}/${kind}/${moduleName ?? NO_MODULE_ID_SEGMENT}`;
		// User-facing text, kept short: the "shared folder, not shared workflow" nuance in this
		// class's own doc comment above is for engineers reading the code, not something to
		// surface — and an internal design-doc citation has no business in a tooltip either.
		this.tooltip = moduleName
			? `Maven module: ${moduleName}`
			: 'No enclosing Maven module (no pom.xml between the file and the repository root).';
	}
}

/**
 * One Java source `discoverJavaSources()` found inside the connected repository.
 *
 * Read-only by construction (D6): the label, the package in `description`, and a
 * single `vscode.open` command. No action here writes, moves, renames or deletes
 * anything — editing and saving go through the ordinary editor, which already
 * works, and that is what bounds what this node can break.
 *
 * It deliberately makes no claim about which BPMN files reference the class (D4).
 * `bpmnModel.ts` extracts `activiti:class` only, so shared helpers called from
 * other Java, delegates bound via `activiti:delegateExpression` or a listener, and
 * every test class would all read as referenced by nothing — a confident wrong
 * answer being worse than no answer.
 */
export class WorkflowRepoJavaFileNode extends vscode.TreeItem {
	constructor(
		readonly environmentName: string,
		readonly tenantId: string,
		readonly source: DiscoveredJavaSource,
	) {
		super(source.simpleName, vscode.TreeItemCollapsibleState.None);
		this.contextValue = 'reltio.workflows.customRepo.javaFile';
		this.resourceUri = source.fileUri;
		this.description = source.packageName || '(default package)';
		this.iconPath = new vscode.ThemeIcon('symbol-class');
		this.tooltip = buildTooltip('Custom workflow Java source', [
			['Class', source.fullyQualifiedName],
			['Maven module', source.moduleName],
		]);
		this.id = `workflowRepoJava:${environmentName}/${tenantId}/${source.relativePath}`;
		this.command = {
			command: 'vscode.open',
			title: 'Open Java source',
			arguments: [source.fileUri],
		};
	}
}

// ─── Not-deployed rows ───────────────────────────────────────────────────────

/**
 * A workflow that is not a deployed row: a local draft in `Workflows/bpmn/`, or a file that came
 * from the connected repository (kept as its own row even when its id is deployed).
 *
 * Backed by a real file on disk and opens through `vscode.open`.
 *
 * `source` decides the menu: a `local` draft is the extension's own file and can be duplicated or
 * deleted; a `repo` row is the customer's file under their own conventions, so only Deploy and
 * Preview apply to it.
 */
export class WorkflowDraftNode extends vscode.TreeItem {
	constructor(
		readonly environmentName: string,
		readonly tenantId: string,
		readonly draft: WorkflowDraft,
		readonly source: 'local' | 'repo' = 'local',
		/** How a `repo` row compares to the tenant. Ignored for a local draft. */
		readonly repoState: RepoRowState = 'unknown',
	) {
		// Matches `ProcessDefinitionNode`'s own label rule (name when present, id otherwise), so
		// the same workflow does not read as two different things depending on which row of the
		// tree is showing it.
		super(draft.processName || draft.processId, vscode.TreeItemCollapsibleState.None);
		this.contextValue = source === 'repo' ? 'reltio.workflows.draft.repo' : 'reltio.workflows.draft';
		this.iconPath = source === 'repo'
			? new vscode.ThemeIcon('repo', repoState === 'differs' ? new vscode.ThemeColor('gitDecoration.modifiedResourceForeground') : undefined)
			: new vscode.ThemeIcon('edit');
		// No `resourceUri` on either kind of row: that would opt it into VS Code's native
		// Problems-count badge, which reads as a deploy blocker on a BPMN mid-edit and is not one.
		// (The icon is explicit, so nothing relies on `resourceUri` to drive it.)
		// The id is what Deploy actually keys on, so once the label is showing the friendlier
		// name instead, the id still needs to be visible without a hover.
		const repoNote = {
			notDeployed: 'not deployed',
			differs: 'differs from tenant',
			same: 'same as tenant',
			deployed: 'deployed • not compared yet',
			unknown: undefined,
		}[repoState];
		this.description = source === 'repo'
			? [draft.processId, 'repository', repoNote].filter(Boolean).join(' • ')
			: draft.processName ? `${draft.processId} • draft` : '• draft';
		this.tooltip = [
			draft.processName ? `Name: ${draft.processName}` : undefined,
			`ID: ${draft.processId}`,
			`File: ${draft.fileName}`,
			source === 'repo'
				? `From the connected Custom Workflow Repository${repoNote ? ` (${repoNote})` : ''}. It is its own row even when the tenant has a workflow with this id.`
				: 'Not yet deployed to this tenant.',
		].filter((line): line is string => line !== undefined).join('\n');
		// A repository row is keyed by its file: the same process id can appear on a tenant row, a
		// local draft and several repository files, and tree ids must be unique.
		this.id = source === 'repo'
			? `workflowRepoFile:${environmentName}/${tenantId}/${draft.fileUri.toString()}`
			: `workflowDraft:${environmentName}/${tenantId}/${draft.processId}`;
		this.command = {
			command: 'vscode.open',
			title: 'Open Draft',
			arguments: [draft.fileUri],
		};
	}
}
