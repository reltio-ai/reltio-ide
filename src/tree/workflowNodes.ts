/**
 * Tree node classes for the Workflows sub-tree under each tenant.
 *
 * Hierarchy rendered by `MultiTenantTreeProvider.getChildren()`:
 *
 *   TenantNode
 *   ├─ BusinessConfigFolderNode   (from multiTenantNodes.ts — existing config)
 *   └─ WorkflowsFolderNode
 *       ├─ [before first fetch]  WorkflowFetchActionNode  ("Fetch Workflows…")
 *       └─ [after fetch]
 *           ├─ ProcessDefinitionsFolderNode
 *           │   └─ ProcessDefinitionNode  (one per deployed BPMN)
 *           └─ JarDeploymentsFolderNode
 *               ├─ JarDeploymentNode        (one per registered JAR)
 *               └─ UnregisteredJarsFolderNode  (only when non-empty)
 *                   └─ UnregisteredJarNode     (one per S3 JAR not yet registered)
 *
 * Node classes are intentionally kept separate from `multiTenantNodes.ts` so
 * that the `ConfigNodeType` union in `treeNodes.ts` is not widened by this
 * feature — workflow nodes are structurally distinct from config nodes.
 */
import * as vscode from 'vscode';
import type { ProcessDefinition, JarDeployment, AvailableJar } from '../api/workflowAdapterClient';
import type { WorkflowDraft } from '../workspace/workflowDrafts';

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
	) {
		super(
			'Workflows',
			savedAdapterUrl === undefined
				? vscode.TreeItemCollapsibleState.None
				: vscode.TreeItemCollapsibleState.Collapsed,
		);
		this.contextValue =
			savedAdapterUrl === undefined
				? 'reltio.workflows.folder.noUrl'
				: 'reltio.workflows.folder';
		this.iconPath = new vscode.ThemeIcon('git-branch');
		this.id = `workflows:${environmentName}/${tenantId}`;

		// When no URL is saved, clicking the folder opens the prompt directly.
		if (savedAdapterUrl === undefined) {
			this.command = {
				command: 'reltio.fetchWorkflows',
				title: 'Fetch Workflows',
				arguments: [this],
			};
			this.description = 'Click to configure';
		}
	}
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

// ─── Sub-folders ─────────────────────────────────────────────────────────────

export class ProcessDefinitionsFolderNode extends vscode.TreeItem {
	constructor(
		readonly environmentName: string,
		readonly tenantId: string,
		readonly definitions: ProcessDefinition[],
	) {
		const count = definitions.length;
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
 * present — same rule as `WorkflowDraftsFolderNode`: an always-present empty
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
		// A distinct contextValue for the edited case, so Deploy / Discard /
		// Compare appear only where they mean something.
		this.contextValue = localState === 'changed'
			? 'reltio.workflows.processDefinition.changed'
			: 'reltio.workflows.processDefinition';
		this.iconPath = new vscode.ThemeIcon(
			definition.generic ? 'symbol-method' : 'symbol-class',
			localState === 'changed'
				? new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')
				: undefined,
		);
		this.description = localState === 'changed'
			? `${definition.type} • local changes`
			: definition.type;
		// Whether a definition is Reltio's or the customer's is the first thing
		// that changes what you may safely do to it — redeploying an id that is
		// already live replaces it — so it leads, in bold, rather than trailing
		// the tooltip in brackets.
		this.tooltip = buildTooltip(
			definition.generic ? 'Built-in workflow' : 'Custom workflow',
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

// ─── Drafts ──────────────────────────────────────────────────────────────────

/**
 * Local BPMN drafts for this tenant — created but not yet deployed.
 *
 * Shown only when at least one draft exists, matching how the Configuration
 * History folder behaves. An always-present empty folder would be noise on the
 * majority of tenants, which have no drafts.
 */
export class WorkflowDraftsFolderNode extends vscode.TreeItem {
	constructor(
		readonly environmentName: string,
		readonly tenantId: string,
		readonly drafts: readonly WorkflowDraft[],
	) {
		super(
			`Drafts (${drafts.length})`,
			drafts.length > 0
				? vscode.TreeItemCollapsibleState.Expanded
				: vscode.TreeItemCollapsibleState.None,
		);
		this.contextValue = 'reltio.workflows.drafts.folder';
		this.iconPath = new vscode.ThemeIcon('edit');
		this.id = `workflowDrafts:${environmentName}/${tenantId}`;
		this.tooltip = 'BPMN files saved locally and not yet deployed to this tenant.';
	}
}

/**
 * One draft file. Backed by a real file on disk, so it sets `resourceUri` and
 * opens through `vscode.open` like a history snapshot rather than through a
 * bespoke command.
 */
export class WorkflowDraftNode extends vscode.TreeItem {
	constructor(
		readonly environmentName: string,
		readonly tenantId: string,
		readonly draft: WorkflowDraft,
	) {
		super(draft.processId, vscode.TreeItemCollapsibleState.None);
		this.contextValue = 'reltio.workflows.draft';
		this.iconPath = new vscode.ThemeIcon('file-code');
		this.resourceUri = draft.fileUri;
		this.description = 'not deployed';
		this.tooltip = [
			`ID: ${draft.processId}`,
			`File: ${draft.fileName}`,
			'Not yet deployed to this tenant.',
		].join('\n');
		this.id = `workflowDraft:${environmentName}/${tenantId}/${draft.processId}`;
		this.command = {
			command: 'vscode.open',
			title: 'Open Draft',
			arguments: [draft.fileUri],
		};
	}
}
