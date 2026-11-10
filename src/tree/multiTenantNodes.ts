import * as vscode from 'vscode';
import type { EState, TState } from '../ux/uxState';

export class EnvironmentNode extends vscode.TreeItem {
	constructor(
		readonly environmentName: string,
		readonly isAuthorized: boolean,
		readonly canBrowserLogin: boolean,
		readonly eState: EState = 'E_NO_AUTH',
	) {
		const label = environmentName;
		super(label, vscode.TreeItemCollapsibleState.Expanded);

		// contextValue: kept compatible with existing menu when-clauses
		if (isAuthorized) {
			this.contextValue = canBrowserLogin
				? 'reltio.environment.authorized.oauthReady'
				: 'reltio.environment.authorized';
		} else if (canBrowserLogin) {
			this.contextValue = 'reltio.environment.unauthorized.oauthReady';
		} else {
			this.contextValue = 'reltio.environment.unauthorized.oauthBlocked';
		}

		// Per-row "no tenants" suffix — used by the inline + icon gating.
		// Suffixes are additive so other when-clauses that match the base
		// strings (e.g. `viewItem == reltio.environment.authorized`)
		// continue to work — those clauses already use regex matchers.
		if (eState === 'E_AUTHED_NO_TENANTS') {
			this.contextValue = `${this.contextValue}.noTenants`;
		}

		// Description: action-first next-step hint
		this.description = descriptionForEState(eState);
		this.tooltip = tooltipForEState(environmentName, eState);

		this.iconPath = new vscode.ThemeIcon(isAuthorized ? 'globe' : 'lock');
		this.id = `env:${environmentName}`;
	}
}

function descriptionForEState(state: EState): string | undefined {
	switch (state) {
		case 'E_NO_AUTH': return 'Sign in to continue';
		case 'E_HAS_OAUTH_NO_SESSION': return 'Sign In';
		case 'E_AUTHED_NO_TENANTS': return 'No tenants — click + to add';
		case 'E_READY': return undefined;
	}
}

function tooltipForEState(env: string, state: EState): string {
	switch (state) {
		case 'E_NO_AUTH':
			return `${env}\nNo authentication configured. Right-click and choose Configure OAuth Client or Provide Token.`;
		case 'E_HAS_OAUTH_NO_SESSION':
			return `${env}\nOAuth client is configured. Click the globe icon to sign in with the browser.`;
		case 'E_AUTHED_NO_TENANTS':
			return `${env}\nSigned in. Add a tenant to start editing its L3.`;
		case 'E_READY':
			return env;
	}
}

export class TenantNode extends vscode.TreeItem {
	constructor(
		readonly environmentName: string,
		readonly tenantId: string,
		readonly hasL3: boolean,
		readonly isStaleLocal: boolean,
		readonly isEnvironmentAuthorized: boolean,
		readonly tState: TState = 'T_NO_L3',
		readonly autoExpand: boolean = false,
		/** Git mode only: the plain leaf name, so a collision-qualified `tenantId` stays out of the label. */
		readonly displayLabel?: string,
		/**
		 * Current git branch of this tenant's folder, when it is bound to a remote.
		 *
		 * Read from `HEAD` at refresh time rather than stored, so an external checkout is reflected.
		 * Undefined for an unbound tenant or a detached HEAD; shown as nothing, never faked.
		 */
		readonly branch?: string,
		/**
		 * Whether this tenant folder is a Git repository.
		 *
		 * Distinct from `branch`, which is undefined on a detached HEAD even though the folder is
		 * very much a repository. The context menu keys off this, so conflating the two would hide
		 * Disconnect exactly when someone most needs it.
		 */
		readonly isGitBound: boolean = false,
		/**
		 * RDM configurations are on disk for this tenant. Informational: every tenant row is
		 * already collapsible (it always has the Workflows sub-folder), so RDM needs no special case.
		 */
		readonly hasRdm = false,
	) {
		const label = displayLabel ?? tenantId;
		// Every tenant now has at least the Workflows sub-folder, so it is
		// always collapsible — the None state is no longer valid here.
		super(
			label,
			autoExpand ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
		);
		// `.gitbound` drives which Git actions the context menu offers: Connect before binding,
		// then New Branch and Disconnect afterwards.
		this.contextValue =
			(hasL3 ? 'reltio.tenant.l3' : 'reltio.tenant') + (isGitBound ? '.gitbound' : '');
		const stateDescription = descriptionForTState(tState, isStaleLocal, isEnvironmentAuthorized);
		this.description = branch
			? [stateDescription, `⎇ ${branch}`].filter(Boolean).join('  ')
			: stateDescription;
		this.tooltip = tooltipForTState(tenantId, tState);
		this.id = `tenant:${environmentName}/${tenantId}`;

		const config = vscode.workspace.getConfiguration('reltio');
		if (config.get<boolean>('tenantSingleClickOpen', true)) {
			this.command = {
				command: tState === 'T_NO_L3' ? 'reltio.fetchL3' : 'reltio.openL3',
				title: 'Open',
				arguments: [this],
			};
		}
	}
}

function descriptionForTState(state: TState, isStaleLocal: boolean, isAuthed: boolean): string | undefined {
	if (isStaleLocal && !isAuthed) return '(local)';
	switch (state) {
		case 'T_NO_L3': return 'L3 not fetched — click to fetch';
		case 'T_L3_NEVER_OPENED': return 'Open L3 to start editing';
		case 'T_READY': return undefined;
	}
}

function tooltipForTState(tenantId: string, state: TState): string {
	switch (state) {
		case 'T_NO_L3':
			return `${tenantId}\nL3 configuration not yet fetched. Click the download icon or row to fetch.`;
		case 'T_L3_NEVER_OPENED':
			return `${tenantId}\nL3 is downloaded. Open it to start editing.`;
		case 'T_READY':
			return tenantId;
	}
}

/**
 * A directory row inside a git-sourced repository tree, mirroring the repository's own
 * folder layout (`repo / DP / dp_lif`). Purely structural: it groups config rows and
 * carries no commands or context-menu actions of its own.
 */
export class GitFolderNode extends vscode.TreeItem {
	constructor(
		readonly environmentName: string,
		/** Full path from the environment row down to and including this folder. */
		readonly folderPath: string[],
		expanded: boolean,
	) {
		super(
			folderPath[folderPath.length - 1] ?? '',
			expanded
				? vscode.TreeItemCollapsibleState.Expanded
				: vscode.TreeItemCollapsibleState.Collapsed,
		);
		this.contextValue = 'reltio.gitFolder';
		this.iconPath = vscode.ThemeIcon.Folder;
		this.tooltip = folderPath.join('/');
		this.id = `gitFolder:${environmentName}/${folderPath.join('/')}`;
	}
}

/**
 * Folder node that groups the tenant's configuration children (Configuration
 * History + all config root sections such as Entity Types, Relationship Types,
 * Sources, etc.) under a single "Business Config" row. Shown only when
 * `hasL3` is true on the parent `TenantNode`.
 */
export class BusinessConfigFolderNode extends vscode.TreeItem {
	constructor(
		readonly environmentName: string,
		readonly tenantId: string,
	) {
		super('Business Config', vscode.TreeItemCollapsibleState.Expanded);
		this.contextValue = 'reltio.businessConfig.folder';
		this.iconPath = new vscode.ThemeIcon('settings');
		this.id = `businessConfig:${environmentName}/${tenantId}`;
	}
}

export class HistoryFolderNode extends vscode.TreeItem {
	constructor(
		readonly environmentName: string,
		readonly tenantId: string,
		readonly snapshotCount: number,
	) {
		super(
			'History',
			vscode.TreeItemCollapsibleState.Expanded,
		);
		this.contextValue = snapshotCount > 0 ? 'reltio.history.folder' : 'reltio.history.folder.empty';
		this.iconPath = new vscode.ThemeIcon('history');
		this.id = `history:${environmentName}/${tenantId}`;
	}
}

export class HistorySnapshotNode extends vscode.TreeItem {
	constructor(
		readonly environmentName: string,
		readonly tenantId: string,
		readonly fileUri: vscode.Uri,
		label: string,
		/** When true, an older snapshot exists on disk (see `listLocalHistorySnapshots` order). */
		readonly hasOlderNeighbor = false,
	) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.contextValue = hasOlderNeighbor ? 'reltio.history.snapshot.hasOlder' : 'reltio.history.snapshot';
		this.iconPath = new vscode.ThemeIcon('file');
		this.resourceUri = fileUri;
		this.id = `historysnap:${fileUri.toString()}`;
	}
}

// ---------------------------------------------------------------------------
// RDM sub-tree
//
// These deliberately sit outside `ConfigTreeItem`. That class derives its
// contextValue through `contextValueFor()`, which mints `reltio.item.*` for
// every non-folder node — and `reltio.deleteNode` / `reltio.renameNode` attach
// to `/^reltio\.item\./` by regex. RDM data is read-only (nothing is ever PUT
// back to the RDM service), so those commands must not be reachable here. A
// separate `reltio.rdm.*` namespace makes that structural rather than a matter
// of keeping two regexes in sync.
// ---------------------------------------------------------------------------

/**
 * The single `RDM` grouping row under a tenant. Purely structural: it gathers
 * the tenant's RDM configurations so they read as one section alongside the L3
 * sections, rather than as loose siblings of them.
 */
export class RdmGroupNode extends vscode.TreeItem {
	constructor(
		readonly environmentName: string,
		readonly tenantId: string,
	) {
		super('RDM', vscode.TreeItemCollapsibleState.Collapsed);
		this.contextValue = 'reltio.rdm.group';
		this.iconPath = new vscode.ThemeIcon('symbol-enum');
		this.id = `rdmgroup:${environmentName}/${tenantId}`;
		this.tooltip = 'Reference Data Management';
	}
}

/**
 * One RDM tenant's configuration file, shown under the `RDM` group and
 * labelled with the RDM tenant id alone — the group above supplies the context
 * that the old `RDM_` prefix used to carry.
 */
export class RdmRootNode extends vscode.TreeItem {
	constructor(
		readonly environmentName: string,
		readonly tenantId: string,
		readonly rdmTenantId: string,
		readonly fileUri: vscode.Uri,
		/** Set when the file could not be parsed — the root still shows, but expands to nothing. */
		readonly unreadable = false,
	) {
		super(
			rdmTenantId,
			unreadable
				? vscode.TreeItemCollapsibleState.None
				: vscode.TreeItemCollapsibleState.Collapsed,
		);
		this.contextValue = 'reltio.rdm.root';
		this.iconPath = new vscode.ThemeIcon('symbol-enum');
		this.resourceUri = fileUri;
		this.id = `rdmroot:${fileUri.toString()}`;
		if (unreadable) {
			this.description = 'could not be read';
			this.tooltip = `${fileUri.fsPath}\nThis RDM configuration is not valid JSON. Use Show in Editor to inspect it.`;
		} else {
			this.tooltip = fileUri.fsPath;
		}
	}
}

/** A counted section under an RDM root, e.g. `Lookup Types (59)`. */
export class RdmFolderNode extends vscode.TreeItem {
	/** Location of this section in the RDM document, for Show in Editor. */
	readonly jsonPath: (string | number)[];

	constructor(
		readonly environmentName: string,
		readonly tenantId: string,
		readonly rdmTenantId: string,
		readonly fileUri: vscode.Uri,
		readonly sectionKey: string,
		label: string,
		count: number,
		iconId: string,
	) {
		super(`${label} (${count})`, vscode.TreeItemCollapsibleState.Collapsed);
		this.contextValue = `reltio.rdm.folder.${sectionKey}`;
		this.iconPath = new vscode.ThemeIcon(iconId);
		this.id = `rdmfolder:${fileUri.toString()}|${sectionKey}`;
		this.jsonPath = [sectionKey];
		this.tooltip = sectionKey;
	}
}

/** A single lookup type or source. Always a leaf — every field on them is scalar. */
export class RdmItemNode extends vscode.TreeItem {
	constructor(
		readonly environmentName: string,
		readonly tenantId: string,
		readonly rdmTenantId: string,
		readonly fileUri: vscode.Uri,
		readonly sectionKey: string,
		readonly jsonPath: (string | number)[],
		label: string,
		/**
		 * The entry's own `uri`, e.g. `rdm/lookupTypes/AddressTypes`. Add Value
		 * sends it as each new value's `type`, so the request carries the
		 * server's value rather than one rebuilt from the name.
		 */
		readonly uri: string | undefined,
		iconId: string,
		/**
		 * Trailing segment of `uri`, e.g. `AddressTypes`. Carried here so the
		 * Get Lookup Values command has the name the lookups endpoint is keyed
		 * by without re-parsing the URI at invocation time.
		 */
		readonly typeName = '',
	) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.contextValue = `reltio.rdm.item.${sectionKey}`;
		this.iconPath = new vscode.ThemeIcon(iconId);
		this.id = `rdmitem:${fileUri.toString()}|${jsonPath.join('/')}`;
		if (uri) {
			// The uri is what an L3 `lookupCode` actually references, so it is the
			// value a reader is most likely to want visible.
			this.description = uri;
		}
		this.tooltip = uri ?? label;
	}
}
