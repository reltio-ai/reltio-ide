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
	) {
		const label = tenantId;
		super(
			label,
			hasL3
				? (autoExpand ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
				: vscode.TreeItemCollapsibleState.None,
		);
		this.contextValue = hasL3 ? 'reltio.tenant.l3' : 'reltio.tenant';
		this.description = descriptionForTState(tState, isStaleLocal, isEnvironmentAuthorized);
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
