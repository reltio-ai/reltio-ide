import * as vscode from 'vscode';
import type { UxState } from './uxState';

export class StatusBarController {
	private readonly item: vscode.StatusBarItem;

	constructor() {
		this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
	}

	render(state: UxState, hasWorkspaceFolder: boolean): void {
		if (!hasWorkspaceFolder && state.global === 'G_EMPTY') {
			this.item.hide();
			return;
		}
		const view = labelAndCommand(state);
		if (!view) {
			this.item.hide();
			return;
		}
		this.item.text = view.label;
		this.item.command = view.command;
		this.item.tooltip = view.tooltip;
		this.item.show();
	}

	flashSuccess(): void {
		const original = this.item.backgroundColor;
		this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
		setTimeout(() => { this.item.backgroundColor = original; }, 1500);
	}

	dispose(): void {
		this.item.dispose();
	}
}

interface BarView {
	label: string;
	command: string;
	tooltip: string;
}

function labelAndCommand(state: UxState): BarView | undefined {
	switch (state.global) {
		case 'G_EMPTY':
			return { label: 'Reltio: Add an environment', command: 'reltio.launchSetupWizard', tooltip: 'Click to launch the setup wizard' };
		case 'G_NEEDS_AUTH':
			return { label: 'Reltio: Sign in required', command: 'reltio.signInToFirstEnvironment', tooltip: 'Click to sign in' };
		case 'G_NEEDS_TENANT':
			return { label: 'Reltio: Add a tenant', command: 'workbench.view.extension.reltioExplorer', tooltip: 'Click to focus the Reltio tree' };
		case 'G_NEEDS_L3':
			return { label: 'Reltio: Fetch L3', command: 'workbench.view.extension.reltioExplorer', tooltip: 'Click to focus the Reltio tree' };
		case 'G_READY':
			if (state.envCount === 1 && state.tenantCount === 0) return undefined;
			return {
				label: `Reltio: ${state.envCount} env${state.envCount === 1 ? '' : 's'}, ${state.tenantCount} tenant${state.tenantCount === 1 ? '' : 's'}`,
				command: 'workbench.view.extension.reltioExplorer',
				tooltip: 'Click to focus the Reltio tree',
			};
	}
}
