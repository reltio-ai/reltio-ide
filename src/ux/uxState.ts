import * as vscode from 'vscode';
import type { EnvironmentInfo } from '../workspace/environmentManager';
import type { TokenStore } from '../api/tokenStore';
import type { OAuthCredentialsStore } from '../api/oauthCredentialsStore';

export type GState =
	| 'G_EMPTY'
	| 'G_NEEDS_AUTH'
	| 'G_NEEDS_TENANT'
	| 'G_NEEDS_L3'
	| 'G_READY';

export type EState =
	| 'E_NO_AUTH'
	| 'E_HAS_OAUTH_NO_SESSION'
	| 'E_AUTHED_NO_TENANTS'
	| 'E_READY';

export type TState = 'T_NO_L3' | 'T_L3_NEVER_OPENED' | 'T_READY';

export interface UxState {
	global: GState;
	perEnv: Map<string, EState>;
	perTenant: Map<string, TState>; // key: `${env}/${tenantId}`
	envCount: number;
	tenantCount: number;
}

export interface UxStateInputs {
	environments: EnvironmentInfo[];
	hasToken: (env: string) => boolean;
	hasOAuthClient: (env: string) => Promise<boolean>;
	openedL3Files: Set<string>; // URIs of L3 files the user has opened at least once
}

export async function deriveUxState(inputs: UxStateInputs): Promise<UxState> {
	const perEnv = new Map<string, EState>();
	const perTenant = new Map<string, TState>();
	let tenantCount = 0;

	for (const env of inputs.environments) {
		const authed = inputs.hasToken(env.name);
		const hasOAuth = await inputs.hasOAuthClient(env.name);

		let eState: EState;
		if (!authed && !hasOAuth) {
			eState = 'E_NO_AUTH';
		} else if (!authed && hasOAuth) {
			eState = 'E_HAS_OAUTH_NO_SESSION';
		} else if (authed && env.tenants.length === 0) {
			eState = 'E_AUTHED_NO_TENANTS';
		} else {
			eState = 'E_READY';
		}
		perEnv.set(env.name, eState);

		for (const t of env.tenants) {
			tenantCount++;
			const tKey = `${env.name}/${t.tenantId}`;
			let tState: TState;
			if (!t.hasL3) {
				tState = 'T_NO_L3';
			} else if (!inputs.openedL3Files.has(l3FileUri(env.name, t.tenantId))) {
				tState = 'T_L3_NEVER_OPENED';
			} else {
				tState = 'T_READY';
			}
			perTenant.set(tKey, tState);
		}
	}

	const global = deriveGlobal(inputs.environments, perEnv, perTenant);
	return {
		global,
		perEnv,
		perTenant,
		envCount: inputs.environments.length,
		tenantCount,
	};
}

function deriveGlobal(
	envs: EnvironmentInfo[],
	perEnv: Map<string, EState>,
	perTenant: Map<string, TState>,
): GState {
	if (envs.length === 0) return 'G_EMPTY';
	const anyAuthed = Array.from(perEnv.values()).some(
		s => s === 'E_AUTHED_NO_TENANTS' || s === 'E_READY',
	);
	if (!anyAuthed) return 'G_NEEDS_AUTH';
	const anyTenants = envs.some(e => e.tenants.length > 0);
	if (!anyTenants) return 'G_NEEDS_TENANT';
	const anyL3 = Array.from(perTenant.values()).some(s => s === 'T_L3_NEVER_OPENED' || s === 'T_READY');
	if (!anyL3) return 'G_NEEDS_L3';
	return 'G_READY';
}

/**
 * Logical key for an L3 file under (env, tenant).
 * Physical path may be under `.reltio/` or (legacy) workspace root — use this key, not asRelativePath.
 */
export function l3FileUri(env: string, tenantId: string): string {
	return `${env}.reltio.environment/${tenantId}.reltio.tenant/L3.reltio.json`;
}

/**
 * Single event emitter that every UX surface subscribes to. Fired after any mutation
 * that could change the UxState (env added, token set, L3 written, etc.).
 *
 * Surfaces re-derive their own state by calling `deriveUxState()` after each fire.
 * This keeps the bus payload-free (just a notification) and lets each surface read
 * only what it needs.
 */
export class UxStateBus {
	private readonly emitter = new vscode.EventEmitter<void>();

	readonly onChange: vscode.Event<void> = this.emitter.event;

	fire(): void {
		this.emitter.fire();
	}

	dispose(): void {
		this.emitter.dispose();
	}
}

/**
 * Publish the global UX state as a VS Code context key so `when` clauses in
 * package.json (walkthrough completion events, viewsWelcome, menu items) can
 * reference it.
 */
export function publishUxStateContext(state: UxState): Thenable<unknown> {
	return vscode.commands.executeCommand('setContext', 'reltio.uxState', state.global);
}
