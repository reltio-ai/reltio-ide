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
 *               └─ JarDeploymentNode      (one per registered JAR)
 *
 * Node classes are intentionally kept separate from `multiTenantNodes.ts` so
 * that the `ConfigNodeType` union in `treeNodes.ts` is not widened by this
 * feature — workflow nodes are structurally distinct from config nodes.
 */
import * as vscode from 'vscode';
import type { ProcessDefinition, JarDeployment } from '../api/workflowAdapterClient';
import type { WorkflowDraft } from '../workspace/workflowDrafts';

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
	) {
		const count = deployments.length;
		super(
			`JAR Deployments (${count})`,
			count > 0
				? vscode.TreeItemCollapsibleState.Expanded
				: vscode.TreeItemCollapsibleState.None,
		);
		this.contextValue = 'reltio.workflows.jarDeployments.folder';
		this.iconPath = new vscode.ThemeIcon('package');
		this.id = `workflowJars:${environmentName}/${tenantId}`;
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
		this.tooltip = [
			`Type: ${definition.type}`,
			`Deployed by: ${definition.deployedBy}`,
			`Deploy time: ${new Date(definition.deployTime).toLocaleString()}`,
			definition.generic ? '(Reltio built-in)' : '(Custom)',
			localState === 'changed'
				? 'You have local changes that have not been deployed.'
				: localState === 'clean'
					? 'Downloaded locally; matches the tenant.'
					: '',
		].filter(Boolean).join('\n');
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
		this.tooltip = [
			`Name: ${deployment.name}`,
			deployment.description ? `Description: ${deployment.description}` : '',
			`Module: ${deployment.module}`,
			`Registered by: ${deployment.createdBy}`,
			`Register time: ${new Date(deployment.createTime).toLocaleString()}`,
		]
			.filter(Boolean)
			.join('\n');
		this.id = `workflowJar:${environmentName}/${tenantId}/${deployment.module}`;
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
			`Process ID: ${draft.processId}`,
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
