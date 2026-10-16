import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { parse } from 'jsonc-parser';
import { buildDeployPlan, redactCommandOutput } from '../lca/deployPlan';
import { findTypeJsonPath, replaceLifecycleActions } from '../lca/l3Edit';
import { proposeLifecycleChange } from '../lca/lifecycleConfig';
import { cloudRegistration } from '../lca/cloud';
import { discoverEnvFile } from '../lca/envCheck';
import { readProjectContext, writeProjectContext, type ProjectContext } from '../lca/context';
import { findDeployArtifact } from '../lca/sources';
import { discoverTenantL3 } from '../lca/tenantGate';
import { noteDeploySuccess, workflowFromContext, contextPatchFromWorkflow } from '../lca/workflow';
import { formatLifecycleDiff } from '../lca/present';

const execFileAsync = promisify(execFile);
const DEPLOY_TIMEOUT_MS = 3 * 60 * 1000;

export interface LcaCommandResult {
	ok: boolean;
	cancelled?: boolean;
	exitCode?: number;
	message: string;
}

function workspaceFolders(): string[] {
	return (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath);
}

function insideWorkspace(directory: string): boolean {
	const target = path.resolve(directory);
	return workspaceFolders().some(folder => {
		const relative = path.relative(path.resolve(folder), target);
		return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
	});
}

function loadContexts(): ProjectContext[] {
	const found: ProjectContext[] = [];
	for (const folder of workspaceFolders()) {
		const dir = path.join(folder, '.reltio', 'lca-context');
		let names: string[] = [];
		try {
			names = fs.readdirSync(dir);
		} catch {
			continue;
		}
		for (const name of names) {
			if (!name.endsWith('.json')) continue;
			let parsed: ProjectContext;
			try {
				parsed = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as ProjectContext;
			} catch {
				continue;
			}
			if (!parsed.workingDirectory || !insideWorkspace(parsed.workingDirectory)) continue;
			const stored = readProjectContext(parsed.workingDirectory, parsed.tenantId);
			if (stored) found.push(stored);
		}
	}
	return found;
}

function saveWorkflow(context: ProjectContext, workflow: ReturnType<typeof workflowFromContext>): void {
	writeProjectContext({
		...context,
		...contextPatchFromWorkflow(workflow),
		workingDirectory: context.workingDirectory,
		tenantId: context.tenantId,
	});
}

/** Lifecycle registration derived from the deployed function name. AWS is `Lambda/BinaryJSON/<name>`. */
function registrationName(context: ProjectContext): string | undefined {
	const name = context.cloudFunctionIdentifier?.trim();
	if (!name) return undefined;
	const provider = context.cloudProvider ?? 'aws';
	if (provider === 'native') return name;
	return cloudRegistration(provider, name);
}

function actionNames(entry: unknown): string[] {
	if (!Array.isArray(entry)) return [];
	const names: string[] = [];
	for (const item of entry) {
		if (typeof item === 'string') names.push(item);
		else if (item && typeof item === 'object' && Array.isArray((item as { actions?: unknown }).actions)) {
			for (const name of (item as { actions: unknown[] }).actions) {
				if (typeof name === 'string') names.push(name);
			}
		}
	}
	return names;
}

export function registerLcaCommands(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('reltio.lcaDeploy', () => deployLca()),
		vscode.commands.registerCommand('reltio.lcaApplyLifecycleActions', () => applyLifecycleActions()),
	);
}

async function deployLca(): Promise<LcaCommandResult> {
	const context = loadContexts().find(item => item.phase === 'DEPLOY' && item.deploymentApproved);
	if (!context) {
		const message = 'Deploy is not approved. Confirm the deploy preview in the assistant first.';
		void vscode.window.showInformationMessage(message);
		return { ok: false, message };
	}
	const workflow = workflowFromContext(context, 'generate');
	if (workflow.cloudProvider === 'azure' || workflow.cloudProvider === 'native') {
		const message = workflow.cloudProvider === 'azure'
			? 'Azure LCA deployment is unresolved. This command will not deploy it.'
			: 'Native LCA deployment does not use this cloud command.';
		void vscode.window.showInformationMessage(message);
		return { ok: false, message };
	}
	const artifact = findDeployArtifact(context.workingDirectory);
	if (!artifact) {
		const message = 'No .jar or .zip artifact was found in the working directory. Build it, then run the deploy command again.';
		void vscode.window.showInformationMessage(message);
		return { ok: false, message };
	}
	const envPath = discoverEnvFile(context.workingDirectory);
	let envText = '';
	if (envPath) {
		try {
			envText = fs.readFileSync(envPath, 'utf8');
		} catch {
			envText = '';
		}
	}
	const functionName = workflow.cloudFunctionIdentifier ?? '';
	const launch = buildDeployPlan({
		provider: workflow.cloudProvider ?? 'aws',
		workingDirectory: context.workingDirectory,
		functionName,
		artifactPath: artifact,
		envText,
		baseEnv: process.env,
	});
	if (!launch.ok) {
		void vscode.window.showErrorMessage(launch.message);
		return { ok: false, message: launch.message };
	}
	const choice = await vscode.window.showWarningMessage(
		`Deploy ${functionName} with ${launch.plan.summary}? Credential values stay in the deploy process and are not shown.`,
		{ modal: true },
		'Deploy',
	);
	if (choice !== 'Deploy') {
		return { ok: false, cancelled: true, message: 'Deploy cancelled.' };
	}
	let stdout = '';
	let stderr = '';
	let exitCode = 0;
	try {
		const result = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: `Deploying ${functionName}…` },
			() => execFileAsync(launch.plan.executable, launch.plan.args, {
				cwd: launch.plan.cwd,
				env: launch.env,
				timeout: DEPLOY_TIMEOUT_MS,
				maxBuffer: 1024 * 1024,
				killSignal: 'SIGTERM',
			}),
		);
		stdout = result.stdout ?? '';
		stderr = result.stderr ?? '';
	} catch (error) {
		const err = error as { code?: string | number; stdout?: string; stderr?: string; message?: string };
		if (err.code === 'ENOENT') {
			const message = `${launch.plan.executable} was not found on PATH.`;
			void vscode.window.showErrorMessage(message);
			return { ok: false, message };
		}
		stdout = err.stdout ?? '';
		stderr = err.stderr ?? '';
		exitCode = typeof err.code === 'number' ? err.code : 1;
		const message = redactCommandOutput(`${stderr}\n${stdout}\n${err.message ?? ''}`, launch.secretValues);
		void vscode.window.showErrorMessage(message.slice(0, 400));
		return { ok: false, exitCode, message };
	}
	saveWorkflow(context, noteDeploySuccess(workflow, functionName));
	const message = redactCommandOutput(`Deploy succeeded for ${functionName}.\n${stdout}\n${stderr}`, launch.secretValues);
	void vscode.window.showInformationMessage(`Deploy succeeded for ${functionName}. Review the lifecycleActions diff before applying it.`);
	return { ok: true, exitCode, message };
}

async function applyLifecycleActions(): Promise<LcaCommandResult> {
	const context = loadContexts().find(item => item.phase === 'L3_UPDATE' && item.l3UpdateApproved && !!registrationName(item) && !!item.hooks?.[0]);
	const action = context ? registrationName(context) : undefined;
	if (!context?.targetTypeUri || !context.hooks?.[0] || !action) {
		const message = 'The lifecycleActions diff is not approved. Confirm it in the assistant first.';
		void vscode.window.showInformationMessage(message);
		return { ok: false, message };
	}
	const locations = discoverTenantL3(context.workingDirectory);
	const folders = workspaceFolders();
	const pool = locations.length > 0 ? locations : folders.flatMap(folder => discoverTenantL3(folder));
	const selected = context.tenantId
		? pool.find(location => location.tenantId === context.tenantId)
		: (pool.length === 1 ? pool[0] : undefined);
	if (!selected || !insideWorkspace(path.dirname(selected.path))) {
		const message = 'The connected tenant L3 for this working directory was not found.';
		void vscode.window.showErrorMessage(message);
		return { ok: false, message };
	}
	const l3Path = selected.path;
	const text = fs.readFileSync(l3Path, 'utf8');
	const model = parse(text) as Record<string, unknown>;
	const jsonPath = findTypeJsonPath(model, context.targetTypeUri);
	if (!jsonPath) {
		const message = `${context.targetTypeUri} was not found in the connected L3.`;
		void vscode.window.showErrorMessage(message);
		return { ok: false, message };
	}
	const parentPath = jsonPath.slice(0, -1);
	let cursor: unknown = model;
	for (const segment of parentPath) {
		if (!cursor || typeof cursor !== 'object') break;
		cursor = (cursor as Record<string, unknown>)[String(segment)];
	}
	const typeObject = cursor as { lifecycleActions?: Record<string, unknown> } | undefined;
	const proposal = proposeLifecycleChange({
		current: typeObject?.lifecycleActions,
		hook: context.hooks[0],
		kind: context.targetKind,
		op: 'append',
		action,
	});
	if (!proposal.ok) {
		const message = proposal.message ?? 'The lifecycleActions change was rejected.';
		void vscode.window.showErrorMessage(message);
		return { ok: false, message };
	}
	const diff = formatLifecycleDiff({
		hook: context.hooks[0],
		current: actionNames(proposal.current[context.hooks[0]]),
		proposed: actionNames(proposal.proposed[context.hooks[0]]),
	});
	const choice = await vscode.window.showWarningMessage(
		`Apply this lifecycleActions change to ${context.targetType ?? context.targetTypeUri}?\n\n${diff.slice(0, 1200)}`,
		{ modal: true },
		'Apply',
	);
	if (choice !== 'Apply') {
		return { ok: false, cancelled: true, message: 'LifecycleActions update cancelled.' };
	}
	const nextText = replaceLifecycleActions(text, jsonPath, proposal.proposed);
	const uri = vscode.Uri.file(l3Path);
	const document = await vscode.workspace.openTextDocument(uri);
	const edit = new vscode.WorkspaceEdit();
	const last = document.positionAt(document.getText().length);
	edit.replace(uri, new vscode.Range(new vscode.Position(0, 0), last), nextText);
	const applied = await vscode.workspace.applyEdit(edit);
	if (!applied) {
		return { ok: false, message: 'The editor did not apply the lifecycleActions change.' };
	}
	const workflow = workflowFromContext(context, 'generate');
	saveWorkflow(context, {
		...workflow,
		state: 'TENANT_CONFIG_APPLIED',
		phase: 'COMPLETE',
		l3UpdateApproved: true,
		pendingConfigurationPatch: proposal.proposed,
	});
	const message = `Registered ${action} on ${context.hooks[0]} for ${context.targetType ?? context.targetTypeUri}.`;
	void vscode.window.showInformationMessage(message);
	return { ok: true, message };
}
