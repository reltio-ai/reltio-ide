import * as vscode from 'vscode';
import type { EnvironmentManager } from '../workspace/environmentManager';
import type { TokenStore } from '../api/tokenStore';
import type { SessionStore } from '../api/sessionStore';
import type { OAuthCredentialsStore } from '../api/oauthCredentialsStore';
import type { UxStateBus } from './uxState';
import { loadRecentHosts, pushRecentHost, loadLastAuthMethod, saveLastAuthMethod, pushRecentTenant, loadProductionHosts } from './recents';
import { validateEnvironment, listTenants } from '../api/reltioClient';
import { runBrowserLogin, ssoCheck, OAuthLoginError } from '../api/oauthLogin';
import { ensureTermsAccepted } from './termsOfUse';

export interface WizardDeps {
	context: vscode.ExtensionContext;
	environmentManager: EnvironmentManager;
	tokenStore: TokenStore;
	sessionStore: SessionStore;
	oauthCredentialsStore: OAuthCredentialsStore;
	uxBus: UxStateBus;
	normalizeEnvironmentName: (raw: string) => string | undefined;
	writeL3FromApi: (env: string, tenantId: string, token: string) => Promise<'written' | '401' | 'error'>;
	autoAddSsoTenant: (env: string, ssoTenantId: string, accessToken: string) => Promise<string | undefined>;
}

interface WizardState {
	host?: string;
	authMethod?: 'browser' | 'token';
	accessToken?: string;
	refreshToken?: string;
	tenantId?: string;
	tenantAlreadyOnDisk?: boolean;
}

const TOTAL_STEPS = 5;

export async function launchSetupWizard(deps: WizardDeps): Promise<void> {
	if (!(await ensureTermsAccepted(deps.context))) return;

	const state: WizardState = {};
	let step = 1;
	while (step >= 1 && step <= TOTAL_STEPS) {
		const result = await runStep(step, state, deps);
		if (result === 'cancel') return;
		if (result === 'back') step = Math.max(1, step - 1);
		else step++;
	}
}

type StepResult = 'next' | 'back' | 'cancel';

async function runStep(step: number, state: WizardState, deps: WizardDeps): Promise<StepResult> {
	switch (step) {
		case 1: return stepHost(state, deps);
		case 2: return stepAuthMethod(state, deps);
		case 3: return stepAuthSubflow(state, deps);
		case 4: return stepFirstTenant(state, deps);
		case 5: return stepConfirmAndFinish(state, deps);
		default: return 'cancel';
	}
}

async function stepHost(state: WizardState, deps: WizardDeps): Promise<StepResult> {
	const recents = loadRecentHosts(deps.context.globalState);
	const productionHosts = await loadProductionHosts(deps.context);
	const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { value: string }>();
	qp.title = `Reltio Environment Setup (1 of ${TOTAL_STEPS})`;
	qp.placeholder = 'Type a Reltio host (e.g. 361.reltio.com) or pick from recents';
	qp.ignoreFocusOut = true;
	qp.matchOnDescription = true;

	const setItems = (typed: string): void => {
		const trimmed = typed.trim();
		const lower = trimmed.toLowerCase();
		const items: Array<vscode.QuickPickItem & { value: string }> = [];

		// Recents always shown (filtered when user is typing).
		const recentsToShow = trimmed
			? recents.filter(h => h.toLowerCase().includes(lower))
			: recents;
		for (const h of recentsToShow) {
			items.push({ label: h, description: 'recent', value: h });
		}

		// Production hosts only appear once the user types something — never as
		// an initial dump of the full list.
		if (trimmed) {
			const recentSet = new Set(recents.map(r => r.toLowerCase()));
			for (const h of productionHosts) {
				if (recentSet.has(h.toLowerCase())) continue;
				if (h.toLowerCase().includes(lower)) {
					items.push({ label: h, value: h });
				}
			}
		}

		// Fallback "Use what you typed" — only when typed value isn't already
		// represented above. Lets the user pick any host outside the list.
		if (trimmed) {
			const allKnown = new Set<string>([
				...recents.map(r => r.toLowerCase()),
				...productionHosts.map((p: string) => p.toLowerCase()),
			]);
			if (!allKnown.has(lower)) {
				items.unshift({
					label: `$(plus) Use "${trimmed}"`,
					description: 'typed value',
					value: trimmed,
				});
			}
		}

		qp.items = items;
	};

	setItems('');
	qp.onDidChangeValue(setItems);

	return new Promise<StepResult>(resolve => {
		qp.onDidAccept(async () => {
			const picked = qp.selectedItems[0]?.value ?? qp.value.trim();
			if (!picked) return; // ignore Enter on empty
			const normalized = deps.normalizeEnvironmentName(picked);
			if (!normalized) {
				void vscode.window.showErrorMessage('Could not parse host. Try again.');
				return;
			}
			qp.busy = true;
			const ok = await validateEnvironment(normalized);
			qp.busy = false;
			if (!ok) {
				void vscode.window.showErrorMessage(`Could not reach https://${normalized}/reltio/status. Try again.`);
				return;
			}
			state.host = normalized;
			qp.dispose();
			resolve('next');
		});
		qp.onDidHide(() => {
			qp.dispose();
			if (!state.host) resolve('cancel');
		});
		qp.show();
	});
}

async function stepAuthMethod(state: WizardState, deps: WizardDeps): Promise<StepResult> {
	void loadLastAuthMethod(deps.context.workspaceState);
	const items: Array<vscode.QuickPickItem & { value: 'browser' | 'token' }> = [
		{ label: 'Sign in with browser', description: 'recommended', value: 'browser' },
		{ label: 'Paste a Bearer token', value: 'token' },
	];
	const pick = await vscode.window.showQuickPick(items, {
		title: `Reltio Environment Setup (2 of ${TOTAL_STEPS}) — Sign in method`,
		ignoreFocusOut: true,
		matchOnDescription: true,
	});
	if (!pick) return 'cancel';
	state.authMethod = pick.value;
	await saveLastAuthMethod(deps.context.workspaceState, pick.value);
	return 'next';
}

async function stepAuthSubflow(state: WizardState, deps: WizardDeps): Promise<StepResult> {
	if (!state.host || !state.authMethod) return 'back';

	const envName = state.host;

	if (state.authMethod === 'token') {
		const token = await vscode.window.showInputBox({
			title: `Reltio Environment Setup (3 of ${TOTAL_STEPS}) — Bearer token`,
			prompt: `Token for ${envName}`,
			password: true,
			ignoreFocusOut: true,
			validateInput: v => (v?.trim() ? undefined : 'Token is required'),
		});
		if (!token) return 'cancel';
		state.accessToken = token.trim();
		// Mirror the browser branch: if the user already configured an SSO routing
		// tenant ID for this env (via Configure OAuth Client), auto-add it so
		// Step 4's tenant picker is skipped.
		const configuredTenantId = await deps.oauthCredentialsStore.loadSsoTenantId(envName);
		if (configuredTenantId) {
			const autoAdded = await deps.autoAddSsoTenant(envName, configuredTenantId, token.trim());
			if (autoAdded) {
				state.tenantId = autoAdded;
				state.tenantAlreadyOnDisk = true;
			}
		}
		return 'next';
	}

	// Browser branch
	if (!(await deps.oauthCredentialsStore.hasClientCredentials(envName))) {
		const clientId = await vscode.window.showInputBox({
			title: `Reltio Environment Setup (3 of ${TOTAL_STEPS}) — OAuth client ID`,
			prompt: `Client ID for ${envName}`,
			ignoreFocusOut: true,
			validateInput: v => (v?.trim() ? undefined : 'Client ID is required'),
		});
		if (!clientId) return 'cancel';
		const clientSecret = await vscode.window.showInputBox({
			title: `Reltio Environment Setup (3 of ${TOTAL_STEPS}) — OAuth client secret`,
			prompt: `Client secret for ${envName}`,
			password: true,
			ignoreFocusOut: true,
			validateInput: v => (v?.trim() ? undefined : 'Client secret is required'),
		});
		if (!clientSecret) return 'cancel';
		const ssoTenantId = await vscode.window.showInputBox({
			title: `Reltio Environment Setup (3 of ${TOTAL_STEPS}) — SSO routing tenant ID`,
			prompt: 'Tenant used for SSO routing during browser login.',
			placeHolder: 'Tenant ID used for SSO routing',
			ignoreFocusOut: true,
			validateInput: v => (v?.trim() ? undefined : 'SSO tenant ID is required'),
		});
		if (!ssoTenantId) return 'cancel';
		await deps.oauthCredentialsStore.saveClientCredentials(envName, {
			clientId: clientId.trim(),
			clientSecret: clientSecret.trim(),
		});
		await deps.oauthCredentialsStore.saveSsoTenantId(envName, ssoTenantId.trim());
	}

	const creds = await deps.oauthCredentialsStore.loadClientCredentials(envName);
	const ssoTenantId = await deps.oauthCredentialsStore.loadSsoTenantId(envName);
	if (!creds || !ssoTenantId) return 'back';

	try {
		const session = await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Waiting for browser login… (${envName})`,
				cancellable: false,
			},
			() => runBrowserLogin(creds, ssoTenantId),
		);
		state.accessToken = session.accessToken;
		state.refreshToken = session.refreshToken;
		// Mirror the auto-add behavior of the standalone reltio.loginWithBrowser command.
		const autoAdded = await deps.autoAddSsoTenant(envName, ssoTenantId, session.accessToken);
		if (autoAdded) {
			state.tenantId = autoAdded;
			state.tenantAlreadyOnDisk = true;
		}
	} catch (e) {
		await deps.oauthCredentialsStore.deleteClientCredentials(envName);
		const isOAuthError = e instanceof OAuthLoginError;
		const code = isOAuthError ? (e as OAuthLoginError).code : undefined;
		if (code === 'NO_IDP_CONFIGURED') {
			void vscode.window.showErrorMessage(
				`${(e as Error).message} Use "Paste a Bearer token" instead, or run Configure OAuth Client to set a different SSO routing tenant.`,
				{ modal: true },
			);
		} else if (code === 'SSO_CHECK_FAILED') {
			void vscode.window.showErrorMessage(
				`Could not check SSO configuration: ${(e as Error).message}\n\nThis usually means the OAuth client cannot reach /oauth/ssoCheck for the tenant you entered, or the tenant has no external identity provider. Verify the SSO routing tenant ID, or switch to the Bearer token sign-in method.`,
				{ modal: true },
			);
		} else {
			void vscode.window.showErrorMessage(`Login failed: ${(e as Error).message}`);
		}
		return 'back';
	}
	return 'next';
}

async function stepFirstTenant(state: WizardState, deps: WizardDeps): Promise<StepResult> {
	if (!state.host) return 'back';
	if (!state.accessToken) {
		return 'next';
	}
	if (state.tenantId) {
		// Already auto-added during Step 3 — no need to pick again.
		return 'next';
	}

	let tenants: string[];
	try {
		tenants = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: 'Loading tenants…' },
			async () => {
				try {
					return await listTenants(state.host!, state.accessToken!);
				} catch (firstErr) {
					// Reltio auth server may need a moment to propagate a freshly-issued
					// access token to the API server — silently retry once with a short delay.
					await new Promise(resolve => setTimeout(resolve, 1500));
					try {
						return await listTenants(state.host!, state.accessToken!);
					} catch {
						throw firstErr;
					}
				}
			},
		);
	} catch (e) {
		const retry = await vscode.window.showErrorMessage(
			`Could not load tenants: ${(e as Error).message}`,
			'Retry',
			'Skip',
		);
		if (retry === 'Retry') return stepFirstTenant(state, deps);
		return 'next';
	}

	const items: Array<vscode.QuickPickItem & { value: string | null }> = [
		{ label: "Skip — I'll add a tenant later", value: null },
		{ label: '', kind: vscode.QuickPickItemKind.Separator, value: null },
		...tenants.map(t => ({ label: t, value: t })),
	];

	const pick = await vscode.window.showQuickPick(items, {
		title: `Reltio Environment Setup (4 of ${TOTAL_STEPS}) — Select first tenant`,
		ignoreFocusOut: true,
		matchOnDescription: true,
	});
	if (!pick) return 'cancel';
	state.tenantId = pick.value ?? undefined;
	return 'next';
}

async function stepConfirmAndFinish(state: WizardState, deps: WizardDeps): Promise<StepResult> {
	if (!state.host) return 'back';

	const summary = [
		`Host:    ${state.host}`,
		`Auth:    ${authSummary(state)}`,
		`Tenant:  ${state.tenantId ?? '(skipped)'}`,
		`L3:      ${state.tenantId ? 'Will fetch and open' : '(no tenant picked)'}`,
	].join('\n');

	const choice = await vscode.window.showQuickPick(
		[
			{ label: 'Finish Setup', value: 'finish' as const, detail: summary },
			{ label: 'Go back and modify inputs', value: 'back' as const },
		],
		{
			title: `Reltio Environment Setup (5 of ${TOTAL_STEPS}) — Confirm`,
			ignoreFocusOut: true,
		},
	);
	if (!choice) return 'cancel';
	if (choice.value === 'back') return 'back';

	// Apply
	try {
		await deps.environmentManager.createEnvironment(state.host);
	} catch (e) {
		void vscode.window.showErrorMessage(`Failed to create environment directory: ${(e as Error).message}`);
		return 'cancel';
	}
	await pushRecentHost(deps.context.globalState, state.host);

	if (state.accessToken) {
		if (state.refreshToken) {
			deps.tokenStore.setSession(state.host, {
				accessToken: state.accessToken,
				refreshToken: state.refreshToken,
				expiresAt: Date.now() + 3600 * 1000,
			});
			await deps.sessionStore.saveRefreshToken(state.host, state.refreshToken);
		} else {
			deps.tokenStore.setToken(state.host, state.accessToken);
		}
	}

	if (state.tenantId) {
		try {
			if (!state.tenantAlreadyOnDisk) {
				await deps.environmentManager.createTenant(state.host, state.tenantId);
				const result = await deps.writeL3FromApi(state.host, state.tenantId, state.accessToken!);
				if (result !== 'written') {
					void vscode.window.showWarningMessage(
						`Environment added, but L3 download failed. Use Fetch Configuration from the tree to retry.`,
					);
				}
				// Open L3 + show the tenant-added notification ONLY when this code path
				// did the add (Step 4 picker case). The auto-add path already opened
				// L3 and showed its own notification.
				const uri = deps.environmentManager.getL3Uri(state.host, state.tenantId);
				const doc = await vscode.workspace.openTextDocument(uri);
				await vscode.window.showTextDocument(doc);
				void vscode.window.showInformationMessage(
					`Tenant "${state.tenantId}" added under "${state.host}". L3 opened for editing.`,
				);
			}
			await pushRecentTenant(deps.context.globalState, state.host, state.tenantId);
		} catch (e) {
			void vscode.window.showWarningMessage(
				`Environment added, but tenant setup failed: ${(e as Error).message}. Use Add Tenant from the tree to retry.`,
			);
		}
	} else {
		// No tenant set up — show a one-time hint so the user knows what's next.
		void vscode.window.showInformationMessage(
			`Reltio environment "${state.host}" added. Right-click the environment and pick Add Tenant to continue.`,
		);
	}

	deps.uxBus.fire();
	return 'next';
}

function authSummary(state: WizardState): string {
	if (state.authMethod === 'token') return 'Bearer token';
	return 'Browser OAuth';
}
