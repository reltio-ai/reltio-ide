import * as vscode from 'vscode';
import type { EnvironmentManager } from '../workspace/environmentManager';

export async function quickSwitchEnvironment(
	environmentManager: EnvironmentManager,
): Promise<void> {
	const envs = await environmentManager.scanEnvironments();
	if (envs.length === 0) {
		void vscode.window.showInformationMessage('No Reltio environments configured.');
		return;
	}
	const pick = await vscode.window.showQuickPick(
		envs.map(e => ({
			label: e.name,
			description: e.tenants.length === 0 ? 'No tenants' : `${e.tenants.length} tenant${e.tenants.length === 1 ? '' : 's'}`,
			env: e,
		})),
		{ title: 'Switch active Reltio environment' },
	);
	if (!pick) return;

	await vscode.commands.executeCommand('workbench.view.extension.reltioExplorer');
	const tenantsWithL3 = pick.env.tenants.filter(t => t.hasL3);
	if (tenantsWithL3.length === 1) {
		const uri = environmentManager.getL3Uri(pick.env.name, tenantsWithL3[0].tenantId);
		const doc = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(doc);
	}
}
