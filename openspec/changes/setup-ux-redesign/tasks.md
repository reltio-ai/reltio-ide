# Setup UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared "what's next" UX state model that drives a first-run Walkthrough, dynamic viewsWelcome, per-row tree descriptions and inline action icons, a status bar item, and a multi-step Setup Wizard — entirely with native VS Code primitives.

**Architecture:** Introduce `src/ux/` containing the state derivation function, an event emitter, the status bar item, the wizard chain, and small helper commands. Mutation sites in `extension.ts` fire a single `onUxStateChange` event so every UI surface re-renders from the same source. Existing code is touched minimally; new files hold the new behavior.

**Tech Stack:** TypeScript 5.x, VS Code Extension API (engine `^1.85.0`), esbuild bundler. **No test runner exists in this project** — verification per task is `npm run compile` (type-check) + `npm run build` (bundle) + manual smoke against `samples/` in Extension Development Host.

**Spec:** `openspec/changes/setup-ux-redesign/design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/ux/uxState.ts` | new | `GState`, `EState`, `TState` types; `deriveUxState()` pure function; `UxStateBus` (the single event emitter); `publishUxStateContext()` helper that calls `setContext('reltio.uxState', g)` |
| `src/ux/statusBar.ts` | new | `StatusBarController` class that owns the single `vscode.StatusBarItem`; subscribes to the bus and re-renders |
| `src/ux/setupWizard.ts` | new | `launchSetupWizard()` entry point; multi-step `QuickPick` / `InputBox` chain with Back/Cancel; `Finish` handler that persists results and opens L3 |
| `src/ux/signInHelper.ts` | new | `signInToFirstEnvironment()` and `signInEnvironment(env)` smart helpers used by walkthrough + inline tree icon |
| `src/ux/quickSwitch.ts` | new | `quickSwitchEnvironment()` command body |
| `src/ux/recents.ts` | new | Tiny wrappers around `globalState` for `reltio.recentHosts` and `reltio.recentTenants` (move-to-front, cap 10) and `workspaceState` for `reltio.lastAuthMethod` and `reltio.openedL3Files` |
| `src/extension.ts` | modify | Construct `UxStateBus`, register new commands, subscribe surfaces to the bus, fire bus from every mutation site (env added, token set, etc.) |
| `src/tree/multiTenantNodes.ts` | modify | Extend `EnvironmentNode` and `TenantNode` constructors to take a state value and render description/tooltip from it |
| `src/tree/multiTenantTreeProvider.ts` | modify | Single-click open `command` on tenant rows; subscribe to bus and call `refresh()` on change; pass `EState` and `TState` into node constructors |
| `package.json` | modify | New commands, new `view/item/context` menu entries (inline icons + state-gated swaps), new `view/title` menu entry for "Launch Setup Wizard", new `viewsWelcome` entries, `contributes.walkthroughs` block, new hidden setting `reltio.uxMode` |
| `ARCHITECTURE.md` | modify | Document new domain concepts (UX state, walkthrough, wizard) + new commands |
| `docs/BROWSER_LOGIN.md` | modify | Small addendum pointing users at the Setup Wizard |

---

## Conventions

- **No emojis** in user-facing strings (renders inconsistently across themes).
- **All commit messages** must NOT include `Co-Authored-By: Claude` per project preference.
- **Each commit is a single task** unless tasks are explicitly grouped at the end.
- **Verification per task**: `npm run compile` should pass; `npm run build` should produce `dist/extension.js` without warnings; manual smoke matches the "Smoke" line on each task.

---

## Phase 1 — State Derivation (foundation, no user-visible change)

### Task 1.1: Add UX state types and pure derivation function

**Files:**
- Create: `src/ux/uxState.ts`

- [ ] **Step 1: Create the types file**

Create `src/ux/uxState.ts`:

```typescript
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

/** Logical key for an L3 file under (env, tenant). Matches workspace path. */
export function l3FileUri(env: string, tenantId: string): string {
	return `${env}.reltio.environment/${tenantId}.reltio.tenant/L3.reltio.json`;
}
```

- [ ] **Step 2: Type-check**

Run: `npm run compile`
Expected: exits 0 with no output (the project's tsc is silent on success).

- [ ] **Step 3: Commit**

```bash
git add src/ux/uxState.ts
git commit -m "feat(ux): add UxState types and deriveUxState pure function"
```

---

### Task 1.2: Add the UxStateBus event emitter

**Files:**
- Modify: `src/ux/uxState.ts`

- [ ] **Step 1: Append the bus class**

Append to `src/ux/uxState.ts`:

```typescript
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
```

- [ ] **Step 2: Type-check**

Run: `npm run compile`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/ux/uxState.ts
git commit -m "feat(ux): add UxStateBus event emitter and context-key publisher"
```

---

### Task 1.3: Wire the bus into extension.ts (silent — no surfaces yet)

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: Add imports near the other ux/ imports won't exist yet — add at top of import block (around line 30)**

Add this import line in `src/extension.ts` near the existing imports for `OAuthCredentialsStore`:

```typescript
import { UxStateBus, deriveUxState, publishUxStateContext } from './ux/uxState';
```

- [ ] **Step 2: Construct the bus inside `activate()` after the other stores are constructed**

In `src/extension.ts`, immediately after the line `const oauthCredentialsStore = new OAuthCredentialsStore(context.secrets);`, add:

```typescript
	const uxBus = new UxStateBus();
	context.subscriptions.push({ dispose: () => uxBus.dispose() });

	// In-memory set of L3 file URIs the user has opened at least once.
	// Persisted via workspaceState — see Task 4.5.
	const openedL3Files = new Set<string>(
		context.workspaceState.get<string[]>('reltio.openedL3Files', []),
	);

	async function refreshUxState(): Promise<void> {
		if (!environmentManager) return;
		const environments = await environmentManager.scanEnvironments();
		const state = await deriveUxState({
			environments,
			hasToken: env => tokenStore.hasToken(env),
			hasOAuthClient: env => oauthCredentialsStore.hasClientCredentials(env),
			openedL3Files,
		});
		await publishUxStateContext(state);
	}
```

- [ ] **Step 3: Fire `refreshUxState` once at the end of `activate()` (just before the closing brace of the function)**

Find the activation-time block that already restores OAuth sessions (the `if (environmentManager) { void (async () => { ... })(); }` block near the end of `activate`). Immediately after that block, before the closing `}` of `activate`, add:

```typescript
	void refreshUxState();
	uxBus.onChange(() => { void refreshUxState(); });
```

- [ ] **Step 4: Build and smoke**

Run: `npm run compile && npm run build`
Expected: both exit 0; `dist/extension.js` rebuilt.

Smoke: launch Extension Development Host on `samples/`. The extension should activate without errors. Open Output → "Extension Host" log — no `[Error]` lines from Reltio.

- [ ] **Step 5: Commit**

```bash
git add src/extension.ts
git commit -m "feat(ux): construct UxStateBus and wire refreshUxState into activation"
```

---

### Task 1.4: Fire the bus from every mutation site

**Files:**
- Modify: `src/extension.ts`

For each of the following call sites in `src/extension.ts`, add `uxBus.fire();` immediately after the mutation. This is the minimum set; we wire surfaces to react in Phase 2.

- [ ] **Step 1: After environment add**

Find the body of `reltio.addEnvironment` (around line 690). After `treeProvider.addEnvironment(name);` add:

```typescript
			uxBus.fire();
```

- [ ] **Step 2: After environment remove**

Find the body of `reltio.removeEnvironment` (around line 721). After `treeProvider.removeEnvironment(node.environmentName);` add:

```typescript
			uxBus.fire();
```

- [ ] **Step 3: After token set**

Find the body of `reltio.provideToken`. After `tokenStore.setToken(node.environmentName, token);` add:

```typescript
			uxBus.fire();
```

- [ ] **Step 4: After OAuth client configure / reset**

Find the body of `reltio.configureOAuthClient`. After `await oauthCredentialsStore.saveClientCredentials(...)`, add:

```typescript
			uxBus.fire();
```

In the body of `reltio.resetOAuthClient`, after `await oauthCredentialsStore.deleteClientCredentials(node.environmentName);` add `uxBus.fire();`.

- [ ] **Step 5: After session set (Login with Browser success)**

Find the body of `reltio.loginWithBrowser`. After `await sessionStore.saveRefreshToken(node.environmentName, session.refreshToken);` add `uxBus.fire();`.

Also after the auto-add-tenant `void autoAddSsoTenant(...)` completes — wrap it: change `void autoAddSsoTenant(...)` to:

```typescript
			void autoAddSsoTenant(node.environmentName, ssoTenantId, session.accessToken).then(() => uxBus.fire());
```

- [ ] **Step 6: After tenant add and tenant remove**

Find `reltio.addTenant`. After `treeProvider.addTenant(node.environmentName, pick);` add `uxBus.fire();`.

Find `reltio.removeTenant`. After `treeProvider.removeTenant(node.environmentName, node.tenantId);` add `uxBus.fire();`.

- [ ] **Step 7: After L3 write**

Inside the `writeL3FromApi` function (around line 465). After `return 'written';` is hit — actually, fire right before the return. Change the success branch:

```typescript
			treeProvider.refresh();
			uxBus.fire();
			return 'written';
```

- [ ] **Step 8: After silent token refresh succeeds**

Inside `tryRefresh()`. In the inner promise's `try` block, after `await sessionStore.saveRefreshToken(environmentName, session.refreshToken);` add `uxBus.fire();`.

- [ ] **Step 9: After session expires (handle401 cleanup)**

Inside `handle401`. After `await sessionStore.deleteRefreshToken(environmentName);` (where it's followed by `treeProvider.refresh()`) add `uxBus.fire();`.

- [ ] **Step 10: Build and smoke**

Run: `npm run compile && npm run build`

Smoke: launch Extension Development Host. Add an environment. Hit `Ctrl+Shift+P` → "Developer: Show Running Extensions" → click Reltio → check there are no errors. The "Add Environment" success notification should still appear. No visible UI change yet (Phase 2 adds surfaces).

- [ ] **Step 11: Commit**

```bash
git add src/extension.ts
git commit -m "feat(ux): fire UxStateBus from every state-mutating command"
```

---

## Phase 2 — Tree descriptions + inline icons + status bar

### Task 2.1: Extend EnvironmentNode to take an EState and render description

**Files:**
- Modify: `src/tree/multiTenantNodes.ts`

- [ ] **Step 1: Replace the EnvironmentNode class**

In `src/tree/multiTenantNodes.ts`, replace the entire `EnvironmentNode` class with:

```typescript
import type { EState } from '../ux/uxState';

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
```

- [ ] **Step 2: Type-check**

Run: `npm run compile`
Expected: type errors from `multiTenantTreeProvider.ts` because it calls the old constructor signature. We fix that in 2.2.

- [ ] **Step 3: Do not commit yet — Task 2.2 must land together**

---

### Task 2.2: Pass EState into EnvironmentNode from the tree provider

**Files:**
- Modify: `src/tree/multiTenantTreeProvider.ts`

- [ ] **Step 1: Add UxState lookup field**

In `src/tree/multiTenantTreeProvider.ts`, add to imports at the top:

```typescript
import type { EState, TState, UxState } from '../ux/uxState';
```

Add a private field on the class:

```typescript
	private uxState: UxState | undefined;
```

And add a method on the provider:

```typescript
	setUxState(state: UxState): void {
		this.uxState = state;
		this.invalidate();
	}
```

- [ ] **Step 2: Use state when constructing EnvironmentNode**

Find every `new EnvironmentNode(name, isAuthorized, canBrowserLogin)` call inside the file. Replace each with:

```typescript
new EnvironmentNode(
	name,
	isAuthorized,
	canBrowserLogin,
	this.uxState?.perEnv.get(name) ?? 'E_NO_AUTH',
)
```

(There is typically one or two construction sites — search the file.)

- [ ] **Step 3: Subscribe in extension.ts**

In `src/extension.ts`, inside `refreshUxState()` (added in Task 1.3), after computing `state`, also push it into the tree provider. Change the function to:

```typescript
	async function refreshUxState(): Promise<void> {
		if (!environmentManager) return;
		const environments = await environmentManager.scanEnvironments();
		const state = await deriveUxState({
			environments,
			hasToken: env => tokenStore.hasToken(env),
			hasOAuthClient: env => oauthCredentialsStore.hasClientCredentials(env),
			openedL3Files,
		});
		await publishUxStateContext(state);
		treeProvider.setUxState(state);
	}
```

- [ ] **Step 4: Build and smoke**

Run: `npm run compile && npm run build`

Smoke: launch Extension Development Host. Add an environment without auth — its row should now show grey text "Sign in to continue" after the environment name. Configure OAuth client — text changes to "Sign In". Log in — text disappears (E_READY).

- [ ] **Step 5: Commit**

```bash
git add src/tree/multiTenantNodes.ts src/tree/multiTenantTreeProvider.ts src/extension.ts
git commit -m "feat(ux): render per-env next-step description on tree rows"
```

---

### Task 2.3: Extend TenantNode with TState description

**Files:**
- Modify: `src/tree/multiTenantNodes.ts`
- Modify: `src/tree/multiTenantTreeProvider.ts`

- [ ] **Step 1: Replace TenantNode**

In `src/tree/multiTenantNodes.ts`, replace the `TenantNode` class with:

```typescript
import type { TState } from '../ux/uxState';

export class TenantNode extends vscode.TreeItem {
	constructor(
		readonly environmentName: string,
		readonly tenantId: string,
		readonly hasL3: boolean,
		readonly isStaleLocal: boolean,
		readonly isEnvironmentAuthorized: boolean,
		readonly tState: TState = 'T_NO_L3',
	) {
		const label = tenantId;
		super(
			label,
			hasL3
				? vscode.TreeItemCollapsibleState.Collapsed
				: vscode.TreeItemCollapsibleState.None,
		);
		this.contextValue = hasL3 ? 'reltio.tenant.l3' : 'reltio.tenant';
		this.description = descriptionForTState(tState, isStaleLocal, isEnvironmentAuthorized);
		this.tooltip = tooltipForTState(tenantId, tState);
		this.id = `tenant:${environmentName}/${tenantId}`;
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
```

- [ ] **Step 2: Pass TState into TenantNode construction in the tree provider**

In `src/tree/multiTenantTreeProvider.ts`, find every `new TenantNode(...)` call. Add the `tState` argument:

```typescript
new TenantNode(
	envName,
	t.tenantId,
	t.hasL3,
	isStaleLocal,
	isAuthed,
	this.uxState?.perTenant.get(`${envName}/${t.tenantId}`) ?? 'T_NO_L3',
)
```

(Search for `new TenantNode` in the file — there's typically one site.)

- [ ] **Step 3: Build and smoke**

Run: `npm run compile && npm run build`

Smoke: with a tenant added but L3 not fetched, the tenant row should now show "L3 not fetched — click to fetch". After Fetch Configuration, it should show "Open L3 to start editing". After opening the L3 file once, the hint should disappear (after Task 4.5 wires the persistence, for now it'll continue to show until restart — that's expected).

- [ ] **Step 4: Commit**

```bash
git add src/tree/multiTenantNodes.ts src/tree/multiTenantTreeProvider.ts
git commit -m "feat(ux): render per-tenant next-step description on tree rows"
```

---

### Task 2.4: Add inline action icons to the tree

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the new helper commands declaration**

In `package.json`, inside `contributes.commands`, add (alongside the existing reltio commands):

```json
      {
        "command": "reltio.signInEnvironment",
        "title": "Sign In to Environment",
        "icon": "$(key)"
      },
      {
        "command": "reltio.openL3",
        "title": "Open L3",
        "icon": "$(go-to-file)"
      }
```

- [ ] **Step 2: Add inline menu entries**

In `package.json`, inside `contributes.menus["view/item/context"]`, add (preserve existing entries):

```json
        {
          "command": "reltio.signInEnvironment",
          "when": "viewItem == reltio.environment.unauthorized.oauthBlocked",
          "group": "inline@1"
        },
        {
          "command": "reltio.loginWithBrowser",
          "when": "viewItem == reltio.environment.unauthorized.oauthReady",
          "group": "inline@1"
        },
        {
          "command": "reltio.addTenant",
          "when": "viewItem == reltio.environment.authorized && reltio.envHasNoTenants",
          "group": "inline@1"
        },
        {
          "command": "reltio.fetchL3",
          "when": "viewItem == reltio.tenant",
          "group": "inline@1"
        },
        {
          "command": "reltio.openL3",
          "when": "viewItem == reltio.tenant.l3",
          "group": "inline@1"
        }
```

> The `reltio.envHasNoTenants` context key is set in extension.ts based on UxState in step 4 below.

- [ ] **Step 3: Register the new commands in extension.ts**

In `src/extension.ts`, inside `activate()` where other commands are registered, add:

```typescript
		vscode.commands.registerCommand('reltio.signInEnvironment', async (node?: EnvironmentNode) => {
			if (!node) return;
			const method = await vscode.window.showQuickPick(
				[
					{ label: 'Sign in with browser (recommended)', value: 'browser' as const },
					{ label: 'Paste a Bearer token', value: 'token' as const },
				],
				{ title: `Sign in to ${node.environmentName}` },
			);
			if (!method) return;
			if (method.value === 'browser') {
				if (!(await oauthCredentialsStore.hasClientCredentials(node.environmentName))) {
					await vscode.commands.executeCommand('reltio.configureOAuthClient', node);
				}
				await vscode.commands.executeCommand('reltio.loginWithBrowser', node);
			} else {
				await vscode.commands.executeCommand('reltio.provideToken', node);
			}
		}),
		vscode.commands.registerCommand('reltio.openL3', async (node?: TenantNode) => {
			if (!node || !environmentManager) return;
			const uri = environmentManager.getL3Uri(node.environmentName, node.tenantId);
			const doc = await vscode.workspace.openTextDocument(uri);
			await vscode.window.showTextDocument(doc);
		}),
```

- [ ] **Step 4: Publish the `reltio.envHasNoTenants` context key from refreshUxState**

In `src/extension.ts`, extend `refreshUxState()`:

```typescript
		// True iff ANY env is in E_AUTHED_NO_TENANTS — used by inline + icon gating
		const anyAuthedNoTenants = Array.from(state.perEnv.values()).some(s => s === 'E_AUTHED_NO_TENANTS');
		await vscode.commands.executeCommand('setContext', 'reltio.envHasNoTenants', anyAuthedNoTenants);
```

- [ ] **Step 5: Build and smoke**

Run: `npm run compile && npm run build`

Smoke: hover over an unauthenticated env row → see a key icon on the right. Click it → smart sign-in QuickPick. Hover an authed env with no tenants → see a `+` icon. Hover a tenant with no L3 → see a cloud-download icon. Hover a tenant with L3 → see a go-to-file icon.

- [ ] **Step 6: Commit**

```bash
git add package.json src/extension.ts
git commit -m "feat(ux): add inline action icons on env and tenant tree rows"
```

---

### Task 2.5: Add the status bar item

**Files:**
- Create: `src/ux/statusBar.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: Create the status bar controller**

Create `src/ux/statusBar.ts`:

```typescript
import * as vscode from 'vscode';
import type { UxState, GState } from './uxState';

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
```

- [ ] **Step 2: Wire into extension.ts**

In `src/extension.ts`, after `const uxBus = new UxStateBus();`, construct the controller:

```typescript
	const statusBar = new StatusBarController();
	context.subscriptions.push({ dispose: () => statusBar.dispose() });
```

Add `import { StatusBarController } from './ux/statusBar';` at the top.

Extend `refreshUxState()` so it also calls the status bar:

```typescript
		statusBar.render(state, !!folder);
```

- [ ] **Step 3: Register the `reltio.signInToFirstEnvironment` command**

In `src/extension.ts`, register:

```typescript
		vscode.commands.registerCommand('reltio.signInToFirstEnvironment', async () => {
			if (!environmentManager) return;
			const envs = await environmentManager.scanEnvironments();
			const unauthed = envs.find(e => !tokenStore.hasToken(e.name));
			if (!unauthed) {
				void vscode.window.showInformationMessage('All environments are already signed in.');
				return;
			}
			// Build a synthetic EnvironmentNode-ish object for the helper
			await vscode.commands.executeCommand('reltio.signInEnvironment', {
				environmentName: unauthed.name,
			});
		}),
```

- [ ] **Step 4: Add the command declaration to package.json**

In `contributes.commands`, add:

```json
      {
        "command": "reltio.signInToFirstEnvironment",
        "title": "Sign in to Reltio",
        "icon": "$(sign-in)"
      }
```

- [ ] **Step 5: Build and smoke**

Run: `npm run compile && npm run build`

Smoke: status bar bottom-left should now show "Reltio: Add an environment" with an empty workspace. After adding an env, it changes to "Reltio: Sign in required". Click it → triggers the sign-in QuickPick.

- [ ] **Step 6: Commit**

```bash
git add src/ux/statusBar.ts src/extension.ts package.json
git commit -m "feat(ux): add status bar item with state-driven next-step label"
```

---

## Phase 3 — Dynamic viewsWelcome

### Task 3.1: Replace single viewsWelcome with two state-gated entries

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Replace the viewsWelcome block**

In `package.json`, replace the existing `viewsWelcome` array:

```json
    "viewsWelcome": [
      {
        "view": "reltioConfigTree",
        "contents": "Open a folder to start working with Reltio metadata. Each folder can hold multiple Reltio environments.\n\n[Open Folder](command:workbench.action.files.openFolder)\n[View walkthrough](command:workbench.action.openWalkthrough?%5B%22reltio-community.reltio-metadata-editor%23reltio.gettingStarted%22%5D)\n\nOpen any *.reltio.json file for schema validation and navigation.",
        "when": "workspaceFolderCount == 0"
      },
      {
        "view": "reltioConfigTree",
        "contents": "Connect to a Reltio tenant in 4 steps. Start by adding your first environment.\n\n[Launch Setup Wizard](command:reltio.launchSetupWizard)\n[View walkthrough](command:workbench.action.openWalkthrough?%5B%22reltio-community.reltio-metadata-editor%23reltio.gettingStarted%22%5D)\n\nOr use the [classic Add Environment](command:reltio.addEnvironment) flow.",
        "when": "workspaceFolderCount > 0 && reltio.uxState == G_EMPTY"
      }
    ],
```

> The walkthrough command argument is URL-encoded JSON `["<extensionId>#<walkthroughId>"]` — VS Code requires this exact format.

- [ ] **Step 2: Build and smoke**

Run: `npm run compile && npm run build`

Smoke: open VS Code Extension Development Host with NO workspace folder → welcome view shows the "Open Folder" variant. Open a workspace folder with no env directories → welcome view shows the "Connect to a Reltio tenant" variant with the Launch Setup Wizard button (button is wired in Phase 5; clicking shows "command not found" for now — acceptable until Phase 5 lands).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat(ux): split viewsWelcome into workspace-empty and reltio-empty variants"
```

---

## Phase 4 — Smart defaults

### Task 4.1: Recent hosts persistence

**Files:**
- Create: `src/ux/recents.ts`

- [ ] **Step 1: Create the recents module**

Create `src/ux/recents.ts`:

```typescript
import * as vscode from 'vscode';

const RECENT_HOSTS_KEY = 'reltio.recentHosts';
const RECENT_TENANTS_KEY = 'reltio.recentTenants';
const LAST_AUTH_METHOD_KEY = 'reltio.lastAuthMethod';
const OPENED_L3_KEY = 'reltio.openedL3Files';
const RECENT_HOSTS_CAP = 10;
const RECENT_TENANTS_PER_HOST_CAP = 10;

export function loadRecentHosts(global: vscode.Memento): string[] {
	return global.get<string[]>(RECENT_HOSTS_KEY, []);
}

export async function pushRecentHost(global: vscode.Memento, host: string): Promise<void> {
	const list = loadRecentHosts(global).filter(h => h !== host);
	list.unshift(host);
	while (list.length > RECENT_HOSTS_CAP) list.pop();
	await global.update(RECENT_HOSTS_KEY, list);
}

export function loadRecentTenants(global: vscode.Memento, host: string): string[] {
	const map = global.get<Record<string, string[]>>(RECENT_TENANTS_KEY, {});
	return map[host] ?? [];
}

export async function pushRecentTenant(global: vscode.Memento, host: string, tenantId: string): Promise<void> {
	const map = { ...global.get<Record<string, string[]>>(RECENT_TENANTS_KEY, {}) };
	const list = (map[host] ?? []).filter(t => t !== tenantId);
	list.unshift(tenantId);
	while (list.length > RECENT_TENANTS_PER_HOST_CAP) list.pop();
	map[host] = list;
	await global.update(RECENT_TENANTS_KEY, map);
}

export type AuthMethod = 'browser' | 'token';

export function loadLastAuthMethod(workspace: vscode.Memento): AuthMethod | undefined {
	const v = workspace.get<string>(LAST_AUTH_METHOD_KEY);
	return v === 'browser' || v === 'token' ? v : undefined;
}

export async function saveLastAuthMethod(workspace: vscode.Memento, method: AuthMethod): Promise<void> {
	await workspace.update(LAST_AUTH_METHOD_KEY, method);
}

export function loadOpenedL3Files(workspace: vscode.Memento): Set<string> {
	return new Set(workspace.get<string[]>(OPENED_L3_KEY, []));
}

export async function saveOpenedL3Files(workspace: vscode.Memento, set: Set<string>): Promise<void> {
	await workspace.update(OPENED_L3_KEY, Array.from(set));
}
```

- [ ] **Step 2: Use `pushRecentHost` after successful Add Environment**

In `src/extension.ts`, inside `reltio.addEnvironment` after `treeProvider.addEnvironment(name);`, add:

```typescript
			await pushRecentHost(context.globalState, name);
```

Add `import { pushRecentHost } from './ux/recents';` at the top.

- [ ] **Step 3: Build and smoke**

Run: `npm run compile && npm run build`

Smoke: add an environment. In the Cursor Developer Tools (Help → Toggle Developer Tools → Application → Storage → Local Storage), check that `reltio.recentHosts` contains the host. Not user-visible yet; surfaces in the wizard (Phase 5).

- [ ] **Step 4: Commit**

```bash
git add src/ux/recents.ts src/extension.ts
git commit -m "feat(ux): persist recent hosts in globalState"
```

---

### Task 4.2: Persist openedL3Files

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: Subscribe to text-document open events**

In `src/extension.ts` inside `activate()`, find the existing block that listens for active editor changes (`vscode.window.onDidChangeActiveTextEditor`). After that block, add:

```typescript
	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(async doc => {
			if (!doc.uri.path.endsWith('/L3.reltio.json')) return;
			// Workspace-root-relative key — must match l3FileUri() format in uxState.ts
			const relPath = vscode.workspace.asRelativePath(doc.uri, false);
			if (openedL3Files.has(relPath)) return;
			openedL3Files.add(relPath);
			await saveOpenedL3Files(context.workspaceState, openedL3Files);
			uxBus.fire();
		}),
	);
```

Add `import { saveOpenedL3Files } from './ux/recents';` at the top.

- [ ] **Step 2: Build and smoke**

Run: `npm run compile && npm run build`

Smoke: in a workspace with a tenant + L3 fetched, the tenant row should show "Open L3 to start editing". Click to open the L3 file. The hint should disappear. Reload the window. The hint should still be absent (state persisted).

- [ ] **Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "feat(ux): persist opened L3 files in workspaceState for T_state derivation"
```

---

### Task 4.3: Single-click open on tenant rows

**Files:**
- Modify: `src/tree/multiTenantNodes.ts`
- Modify: `package.json`

- [ ] **Step 1: Add setting**

In `package.json`, inside `contributes.configuration.properties`, add:

```json
        "reltio.tenantSingleClickOpen": {
          "type": "boolean",
          "default": true,
          "description": "When clicking a tenant row, open the next action immediately (fetch L3 if missing, open L3 if present). Disable to require the inline icon click instead."
        }
```

- [ ] **Step 2: Wire command on TenantNode**

In `src/tree/multiTenantNodes.ts`, inside `TenantNode` constructor, after setting `this.id`, add:

```typescript
		const config = vscode.workspace.getConfiguration('reltio');
		if (config.get<boolean>('tenantSingleClickOpen', true)) {
			this.command = {
				command: tState === 'T_NO_L3' ? 'reltio.fetchL3' : 'reltio.openL3',
				title: 'Open',
				arguments: [this],
			};
		}
```

- [ ] **Step 3: Build and smoke**

Run: `npm run compile && npm run build`

Smoke: tenant with no L3 → single-click fetches L3 with progress. Tenant with L3 → single-click opens L3.reltio.json. Toggle setting off → single-click stops triggering actions; only the inline icon or right-click does.

- [ ] **Step 4: Commit**

```bash
git add src/tree/multiTenantNodes.ts package.json
git commit -m "feat(ux): single-click open on tenant rows (gated by reltio.tenantSingleClickOpen)"
```

---

### Task 4.4: Quick-switch environment command

**Files:**
- Create: `src/ux/quickSwitch.ts`
- Modify: `src/extension.ts`
- Modify: `package.json`

- [ ] **Step 1: Create the command body**

Create `src/ux/quickSwitch.ts`:

```typescript
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
		const uri = vscode.Uri.joinPath(
			vscode.workspace.workspaceFolders![0].uri,
			`${pick.env.name}.reltio.environment`,
			`${tenantsWithL3[0].tenantId}.reltio.tenant`,
			'L3.reltio.json',
		);
		const doc = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(doc);
	}
}
```

- [ ] **Step 2: Register command in extension.ts**

In `src/extension.ts`:

```typescript
		vscode.commands.registerCommand('reltio.quickSwitchEnvironment', async () => {
			if (!environmentManager) return;
			await quickSwitchEnvironment(environmentManager);
		}),
```

Add `import { quickSwitchEnvironment } from './ux/quickSwitch';`.

- [ ] **Step 3: Declare command in package.json**

In `contributes.commands`:

```json
      {
        "command": "reltio.quickSwitchEnvironment",
        "title": "Reltio: Switch active environment"
      }
```

- [ ] **Step 4: Build and smoke**

Run: `npm run compile && npm run build`

Smoke: Command Palette → "Reltio: Switch active environment" → see all configured envs. Pick one with exactly one L3 tenant → tree focuses + L3 opens.

- [ ] **Step 5: Commit**

```bash
git add src/ux/quickSwitch.ts src/extension.ts package.json
git commit -m "feat(ux): add reltio.quickSwitchEnvironment for multi-env users"
```

---

## Phase 5 — Setup Wizard

### Task 5.1: Multi-step input scaffold

**Files:**
- Create: `src/ux/setupWizard.ts`

This step lays the framework. Subsequent tasks fill in the steps.

- [ ] **Step 1: Create the wizard file with skeleton**

Create `src/ux/setupWizard.ts`:

```typescript
import * as vscode from 'vscode';
import type { EnvironmentManager } from '../workspace/environmentManager';
import type { TokenStore } from '../api/tokenStore';
import type { SessionStore } from '../api/sessionStore';
import type { OAuthCredentialsStore } from '../api/oauthCredentialsStore';
import type { UxStateBus } from './uxState';
import { loadRecentHosts, pushRecentHost, loadLastAuthMethod, saveLastAuthMethod, pushRecentTenant } from './recents';
import { validateEnvironment, listTenants } from '../api/reltioClient';
import { runBrowserLogin, ssoCheck } from '../api/oauthLogin';

export interface WizardDeps {
	context: vscode.ExtensionContext;
	environmentManager: EnvironmentManager;
	tokenStore: TokenStore;
	sessionStore: SessionStore;
	oauthCredentialsStore: OAuthCredentialsStore;
	uxBus: UxStateBus;
	normalizeEnvironmentName: (raw: string) => string | undefined;
	writeL3FromApi: (env: string, tenantId: string, token: string) => Promise<'written' | '401' | 'error'>;
}

interface WizardState {
	host?: string;
	authMethod?: 'browser' | 'token' | 'skip';
	accessToken?: string;
	refreshToken?: string;
	tenantId?: string;
}

const TOTAL_STEPS = 5;

export async function launchSetupWizard(deps: WizardDeps): Promise<void> {
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

// Step bodies fleshed out in subsequent tasks
async function stepHost(_: WizardState, __: WizardDeps): Promise<StepResult> { return 'cancel'; }
async function stepAuthMethod(_: WizardState, __: WizardDeps): Promise<StepResult> { return 'cancel'; }
async function stepAuthSubflow(_: WizardState, __: WizardDeps): Promise<StepResult> { return 'cancel'; }
async function stepFirstTenant(_: WizardState, __: WizardDeps): Promise<StepResult> { return 'cancel'; }
async function stepConfirmAndFinish(_: WizardState, __: WizardDeps): Promise<StepResult> { return 'cancel'; }
```

- [ ] **Step 2: Type-check**

Run: `npm run compile`
Expected: passes (placeholders compile).

- [ ] **Step 3: Commit**

```bash
git add src/ux/setupWizard.ts
git commit -m "feat(ux): scaffold multi-step Setup Wizard with placeholder steps"
```

---

### Task 5.2: Wizard Step 1 — Host (editable QuickPick with autocomplete)

**Files:**
- Modify: `src/ux/setupWizard.ts`

- [ ] **Step 1: Replace `stepHost` with a real implementation**

In `src/ux/setupWizard.ts`, replace `stepHost`:

```typescript
async function stepHost(state: WizardState, deps: WizardDeps): Promise<StepResult> {
	const recents = loadRecentHosts(deps.context.globalState);
	const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { value: string }>();
	qp.title = `Add Reltio environment (1 of ${TOTAL_STEPS})`;
	qp.placeholder = 'Type a Reltio host (e.g. 361.reltio.com) or pick from recents';
	qp.ignoreFocusOut = true;
	qp.matchOnDescription = true;

	const setItems = (typed: string): void => {
		const base: Array<vscode.QuickPickItem & { value: string }> = recents.map(h => ({
			label: h,
			description: 'recent',
			value: h,
		}));
		const trimmed = typed.trim();
		if (trimmed && !recents.includes(trimmed)) {
			base.unshift({
				label: `$(plus) Use "${trimmed}"`,
				description: 'typed value',
				value: trimmed,
			});
		}
		qp.items = base;
	};

	setItems('');
	qp.onDidChangeValue(setItems);

	return new Promise<StepResult>(resolve => {
		qp.onDidAccept(async () => {
			const picked = qp.selectedItems[0]?.value ?? qp.value.trim();
			if (!picked) return; // ignore Enter on empty
			const normalized = deps.normalizeEnvironmentName(picked);
			if (!normalized) {
				qp.validationMessage = 'Could not parse host. Try again.';
				return;
			}
			qp.busy = true;
			const ok = await validateEnvironment(normalized);
			qp.busy = false;
			if (!ok) {
				qp.validationMessage = `Could not reach https://${normalized}/reltio/status. Try again.`;
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
```

- [ ] **Step 2: Build and smoke**

Run: `npm run compile && npm run build`

Smoke: invoke the wizard via Command Palette → "reltio.launchSetupWizard" (Phase 5 registers it; for now test by manually running `vscode.commands.executeCommand` from extension dev console or wait until Task 5.7). Skip the rest of the wizard by pressing Esc — flow should cancel cleanly.

- [ ] **Step 3: Commit**

```bash
git add src/ux/setupWizard.ts
git commit -m "feat(ux): wizard step 1 — editable host QuickPick with recents and validation"
```

---

### Task 5.3: Wizard Step 2 — Sign-in method

**Files:**
- Modify: `src/ux/setupWizard.ts`

- [ ] **Step 1: Replace `stepAuthMethod`**

```typescript
async function stepAuthMethod(state: WizardState, deps: WizardDeps): Promise<StepResult> {
	const last = loadLastAuthMethod(deps.context.workspaceState);
	const items: Array<vscode.QuickPickItem & { value: 'browser' | 'token' | 'skip' }> = [
		{ label: 'Sign in with browser', description: 'recommended', value: 'browser' },
		{ label: 'Paste a Bearer token', value: 'token' },
		{ label: "Skip — I'll sign in later", value: 'skip' },
	];
	const pick = await vscode.window.showQuickPick(items, {
		title: `Add Reltio environment (2 of ${TOTAL_STEPS}) — Sign in method`,
		ignoreFocusOut: true,
		matchOnDescription: true,
	});
	if (!pick) return 'cancel';
	state.authMethod = pick.value;
	if (pick.value !== 'skip') {
		await saveLastAuthMethod(deps.context.workspaceState, pick.value);
	}
	return 'next';
}
```

Note: `showQuickPick` does not have native Back button support — Back is only meaningful in multi-step flows that share state. For Step 2 we accept that Cancel exits cleanly; back navigation is approximated by re-running the wizard. The richer `createQuickPick()` form (used in Step 1) supports custom buttons; if Back from Step 2 is required, future iteration can upgrade to `createQuickPick()`.

- [ ] **Step 2: Build and smoke**

Run: `npm run compile && npm run build`

- [ ] **Step 3: Commit**

```bash
git add src/ux/setupWizard.ts
git commit -m "feat(ux): wizard step 2 — sign-in method QuickPick"
```

---

### Task 5.4: Wizard Step 3 — Auth sub-flow

**Files:**
- Modify: `src/ux/setupWizard.ts`

- [ ] **Step 1: Replace `stepAuthSubflow`**

```typescript
async function stepAuthSubflow(state: WizardState, deps: WizardDeps): Promise<StepResult> {
	if (!state.host || !state.authMethod) return 'back';
	if (state.authMethod === 'skip') return 'next';

	const envName = state.host;

	if (state.authMethod === 'token') {
		const token = await vscode.window.showInputBox({
			title: `Add Reltio environment (3 of ${TOTAL_STEPS}) — Bearer token`,
			prompt: `Token for ${envName}`,
			password: true,
			ignoreFocusOut: true,
			validateInput: v => (v?.trim() ? undefined : 'Token is required'),
		});
		if (!token) return 'cancel';
		// Validate by issuing a list-tenants call; surface 401 cleanly
		try {
			await listTenants(envName, token.trim());
		} catch (e) {
			void vscode.window.showErrorMessage(`Token validation failed: ${(e as Error).message}`);
			return 'back';
		}
		state.accessToken = token.trim();
		return 'next';
	}

	// Browser branch
	// If no OAuth client pair configured for this env, prompt inline
	if (!(await deps.oauthCredentialsStore.hasClientCredentials(envName))) {
		const clientId = await vscode.window.showInputBox({
			title: `Add Reltio environment (3 of ${TOTAL_STEPS}) — OAuth client ID`,
			prompt: `Client ID for ${envName}`,
			ignoreFocusOut: true,
			validateInput: v => (v?.trim() ? undefined : 'Client ID is required'),
		});
		if (!clientId) return 'cancel';
		const clientSecret = await vscode.window.showInputBox({
			title: `Add Reltio environment (3 of ${TOTAL_STEPS}) — OAuth client secret`,
			prompt: `Client secret for ${envName}`,
			password: true,
			ignoreFocusOut: true,
			validateInput: v => (v?.trim() ? undefined : 'Client secret is required'),
		});
		if (!clientSecret) return 'cancel';
		const ssoTenantId = await vscode.window.showInputBox({
			title: `Add Reltio environment (3 of ${TOTAL_STEPS}) — SSO routing tenant ID`,
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
	} catch (e) {
		void vscode.window.showErrorMessage(`Login failed: ${(e as Error).message}`);
		return 'back';
	}
	return 'next';
}
```

- [ ] **Step 2: Build and smoke**

Run: `npm run compile && npm run build`

- [ ] **Step 3: Commit**

```bash
git add src/ux/setupWizard.ts
git commit -m "feat(ux): wizard step 3 — auth sub-flow (browser, token, skip branches)"
```

---

### Task 5.5: Wizard Step 4 — First tenant

**Files:**
- Modify: `src/ux/setupWizard.ts`

- [ ] **Step 1: Replace `stepFirstTenant`**

```typescript
async function stepFirstTenant(state: WizardState, deps: WizardDeps): Promise<StepResult> {
	if (!state.host) return 'back';
	if (state.authMethod === 'skip' || !state.accessToken) {
		// Skipped auth → can't list tenants
		return 'next';
	}

	let tenants: string[];
	try {
		tenants = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: 'Loading tenants…' },
			() => listTenants(state.host!, state.accessToken!),
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
		title: `Add Reltio environment (4 of ${TOTAL_STEPS}) — Select first tenant`,
		ignoreFocusOut: true,
		matchOnDescription: true,
	});
	if (!pick) return 'cancel';
	state.tenantId = pick.value ?? undefined;
	return 'next';
}
```

- [ ] **Step 2: Build and smoke**

Run: `npm run compile && npm run build`

- [ ] **Step 3: Commit**

```bash
git add src/ux/setupWizard.ts
git commit -m "feat(ux): wizard step 4 — first tenant QuickPick from listTenants"
```

---

### Task 5.6: Wizard Step 5 — Confirm and Finish

**Files:**
- Modify: `src/ux/setupWizard.ts`

- [ ] **Step 1: Replace `stepConfirmAndFinish`**

```typescript
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
			{ label: 'Looks good — finish', value: 'finish' as const, detail: summary },
			{ label: 'Back to change something', value: 'back' as const },
		],
		{
			title: `Add Reltio environment (5 of ${TOTAL_STEPS}) — Confirm`,
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
			await deps.environmentManager.createTenant(state.host, state.tenantId);
			await pushRecentTenant(deps.context.globalState, state.host, state.tenantId);
			const result = await deps.writeL3FromApi(state.host, state.tenantId, state.accessToken!);
			if (result === 'written') {
				const uri = deps.environmentManager.getL3Uri(state.host, state.tenantId);
				const doc = await vscode.workspace.openTextDocument(uri);
				await vscode.window.showTextDocument(doc);
			}
		} catch (e) {
			void vscode.window.showWarningMessage(
				`Environment added, but tenant setup failed: ${(e as Error).message}. Use Add Tenant from the tree to retry.`,
			);
		}
	}

	deps.uxBus.fire();
	void vscode.window.showInformationMessage(`Reltio environment "${state.host}" added.`);
	return 'next'; // pushes step counter past TOTAL_STEPS → wizard exits
}

function authSummary(state: WizardState): string {
	if (state.authMethod === 'skip') return '(skipped)';
	if (state.authMethod === 'token') return 'Bearer token';
	return 'Browser OAuth';
}
```

- [ ] **Step 2: Build and smoke**

Run: `npm run compile && npm run build`

- [ ] **Step 3: Commit**

```bash
git add src/ux/setupWizard.ts
git commit -m "feat(ux): wizard step 5 — confirm summary + finish handler"
```

---

### Task 5.7: Register the wizard command and entry points

**Files:**
- Modify: `src/extension.ts`
- Modify: `package.json`

- [ ] **Step 1: Register command**

In `src/extension.ts`, near the other reltio command registrations:

```typescript
		vscode.commands.registerCommand('reltio.launchSetupWizard', async () => {
			if (!environmentManager) {
				void vscode.window.showErrorMessage('Open a workspace folder to use the setup wizard.');
				return;
			}
			await launchSetupWizard({
				context,
				environmentManager,
				tokenStore,
				sessionStore,
				oauthCredentialsStore,
				uxBus,
				normalizeEnvironmentName,
				writeL3FromApi,
			});
		}),
```

Add `import { launchSetupWizard } from './ux/setupWizard';`.

- [ ] **Step 2: Declare command in package.json**

In `contributes.commands`:

```json
      {
        "command": "reltio.launchSetupWizard",
        "title": "Reltio: Launch Setup Wizard",
        "icon": "$(rocket)"
      }
```

- [ ] **Step 3: Add view-title menu entry**

In `contributes.menus["view/title"]`, add (alongside the existing `addEnvironment` entry):

```json
        {
          "command": "reltio.launchSetupWizard",
          "when": "view == reltioConfigTree",
          "group": "navigation"
        }
```

- [ ] **Step 4: Build and smoke**

Run: `npm run compile && npm run build`

Smoke: from empty workspace welcome view → click **Launch Setup Wizard** button → wizard steps appear. Run through all 5 steps with a real Reltio host and creds. After Finish, env appears in tree, L3 opens in editor.

- [ ] **Step 5: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat(ux): register reltio.launchSetupWizard and wire entry points"
```

---

## Phase 6 — Walkthrough

### Task 6.1: Add `contributes.walkthroughs` block

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the block**

In `package.json`, inside `contributes`, add (it can sit alongside other contributes properties):

```json
    "walkthroughs": [
      {
        "id": "reltio.gettingStarted",
        "title": "Get started with Reltio Metadata Editor",
        "description": "Connect to a Reltio tenant and open its L3 configuration in 4 steps.",
        "featuredFor": ["**/*.reltio.json"],
        "steps": [
          {
            "id": "addEnvironment",
            "title": "Add your first Reltio environment",
            "description": "Tell the extension which Reltio host your tenant lives on (e.g. `361.reltio.com`). The host is validated against `/reltio/status` before it is added to your workspace.\n\n[Add Environment](command:reltio.launchSetupWizard)",
            "media": { "markdown": "media/walkthrough/step1.md" },
            "completionEvents": [
              "onContext:reltio.uxState != G_EMPTY"
            ]
          },
          {
            "id": "signIn",
            "title": "Sign in",
            "description": "Choose how to authenticate. **Browser login (recommended)** opens auth.reltio.com — your password never touches the extension. Or paste a Bearer token manually.\n\n[Set up authentication](command:reltio.signInToFirstEnvironment)",
            "media": { "markdown": "media/walkthrough/step2.md" },
            "completionEvents": [
              "onContext:reltio.uxState == G_NEEDS_TENANT",
              "onContext:reltio.uxState == G_NEEDS_L3",
              "onContext:reltio.uxState == G_READY"
            ]
          },
          {
            "id": "addTenant",
            "title": "Add a tenant",
            "description": "Pick a tenant from your accessible list. The L3 configuration is downloaded automatically.\n\n[Add Tenant](command:reltio.addTenant)",
            "media": { "markdown": "media/walkthrough/step3.md" },
            "completionEvents": [
              "onContext:reltio.uxState == G_NEEDS_L3",
              "onContext:reltio.uxState == G_READY"
            ]
          },
          {
            "id": "openL3",
            "title": "Start editing",
            "description": "Open `L3.reltio.json` to begin. You get JSON schema validation, Go-to-Definition on URIs, Find References, structural edit commands, and the ontology preview.\n\n[Open L3](command:workbench.view.extension.reltioExplorer)",
            "media": { "markdown": "media/walkthrough/step4.md" },
            "completionEvents": [
              "onContext:reltio.uxState == G_READY"
            ]
          }
        ]
      }
    ]
```

- [ ] **Step 2: Create the step-media markdown placeholders**

Create `media/walkthrough/step1.md`:

```markdown
Add your first Reltio environment via the **Setup Wizard** or the classic **Add Environment** action in the tree view title bar.
```

Create `media/walkthrough/step2.md`:

```markdown
Browser login (recommended) opens `auth.reltio.com` in your default browser. Your password is entered in the browser and never seen by the extension. The local callback captures only a one-time authorization code over `http://localhost:8081`.

If you can't use browser login, paste a Bearer token instead — it is held in memory only and is never written to disk.
```

Create `media/walkthrough/step3.md`:

```markdown
Pick a tenant from the QuickPick. The extension downloads the tenant's L3 configuration to `<host>.reltio.environment/<tenantId>.reltio.tenant/L3.reltio.json` and saves a remote baseline copy for drift detection on Apply.
```

Create `media/walkthrough/step4.md`:

```markdown
Open `L3.reltio.json` to edit it with JSON schema validation, Go-to-Definition on `configuration/...` URIs, Find References, and structural edit commands. The ontology preview is available from the editor title bar.
```

- [ ] **Step 3: Build and smoke**

Run: `npm run compile && npm run build`

Smoke: Command Palette → "Welcome: Open Walkthrough" → pick "Get started with Reltio Metadata Editor". All 4 steps render with text. Click "Add Environment" → wizard launches. Complete the wizard. Walkthrough step 1 should auto-tick. Sign in → step 2 ticks. Add tenant → step 3 ticks. Open L3 → step 4 ticks.

- [ ] **Step 4: Commit**

```bash
git add package.json media/walkthrough/
git commit -m "feat(ux): add Get Started walkthrough with 4 auto-completing steps"
```

---

### Task 6.2: Upgrade-user suppression for walkthrough

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: Add suppression logic at activation**

In `src/extension.ts`, inside `activate()`, AFTER the initial OAuth session restore block and BEFORE the first `void refreshUxState();`, add:

```typescript
	// Suppress walkthrough auto-open for upgrade users (anyone with existing state).
	if (environmentManager) {
		const seenKey = 'reltio.walkthroughSeen';
		const alreadySeen = context.globalState.get<boolean>(seenKey, false);
		if (!alreadySeen) {
			const envs = await environmentManager.scanEnvironments();
			const hasAnyOAuth = await Promise.any(
				envs.map(e => oauthCredentialsStore.hasClientCredentials(e.name)),
			).catch(() => false);
			if (envs.length > 0 || hasAnyOAuth) {
				await context.globalState.update(seenKey, true);
			}
		}
	}
```

Note: `activate()` is currently synchronous (returns `void`). To `await` here we need to make it async. Change the signature:

```typescript
export async function activate(context: vscode.ExtensionContext): Promise<void> {
```

VS Code's extension API accepts async activate.

- [ ] **Step 2: Build and smoke**

Run: `npm run compile && npm run build`

Smoke A (new user): clear workspaceState + globalState → activate extension → walkthrough auto-opens.

Smoke B (upgrade user): set globalState to have any env or OAuth client → activate → walkthrough does not auto-open. Command Palette → "Welcome: Open Walkthrough" still finds and shows it.

- [ ] **Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "feat(ux): suppress walkthrough auto-open for upgrade users with existing state"
```

---

## Phase 7 — Rollback flag + docs + final smoke

### Task 7.1: Add `reltio.uxMode` setting and bypass logic

**Files:**
- Modify: `package.json`
- Modify: `src/extension.ts`
- Modify: `src/ux/uxState.ts`

- [ ] **Step 1: Declare the setting**

In `package.json` `contributes.configuration.properties`:

```json
        "reltio.uxMode": {
          "type": "string",
          "enum": ["default", "classic"],
          "default": "default",
          "description": "UX mode. 'default' enables the redesigned setup experience (wizard, walkthrough, status bar, next-step hints). 'classic' restores the pre-redesign behavior."
        }
```

- [ ] **Step 2: Honor the setting at activation**

In `src/extension.ts`, near the top of `activate()`:

```typescript
	const uxMode = vscode.workspace.getConfiguration('reltio').get<string>('uxMode', 'default');
	const isClassic = uxMode === 'classic';
```

In `refreshUxState()`:

```typescript
		if (isClassic) {
			// In classic mode, publish a fixed G_READY so no hints render
			await vscode.commands.executeCommand('setContext', 'reltio.uxState', 'G_READY');
			return;
		}
```

In the status bar construction:

```typescript
	const statusBar = isClassic ? null : new StatusBarController();
	if (statusBar) context.subscriptions.push({ dispose: () => statusBar.dispose() });
```

And in `refreshUxState()` where the status bar is rendered:

```typescript
		statusBar?.render(state, !!folder);
```

In the tree provider's setUxState:

```typescript
		if (isClassic) {
			treeProvider.setUxState({
				global: 'G_READY',
				perEnv: new Map(),
				perTenant: new Map(),
				envCount: 0,
				tenantCount: 0,
			});
			return;
		}
```

- [ ] **Step 3: Build and smoke**

Run: `npm run compile && npm run build`

Smoke: set `reltio.uxMode = classic` in settings → reload Extension Development Host → status bar hidden, tree row descriptions absent, walkthrough does not auto-open (welcome view falls back to the no-env variant only). Setting `default` → all features restored.

- [ ] **Step 4: Commit**

```bash
git add package.json src/extension.ts src/ux/uxState.ts
git commit -m "feat(ux): add reltio.uxMode setting with classic-mode bypass"
```

---

### Task 7.2: Update ARCHITECTURE.md

**Files:**
- Modify: `ARCHITECTURE.md`

- [ ] **Step 1: Append new "UX state" domain concept to the glossary table**

In `ARCHITECTURE.md`, in the Domain Concepts table, add:

```markdown
| UX state | A pure-function projection (`deriveUxState`) of the workspace's environments + tokens + OAuth credentials + opened-L3 files into a global state (`G_EMPTY` / `G_NEEDS_AUTH` / `G_NEEDS_TENANT` / `G_NEEDS_L3` / `G_READY`), per-environment state, and per-tenant state. Published as the `reltio.uxState` context key. Every "what's next" surface (walkthrough, viewsWelcome, tree descriptions, inline icons, status bar) reads from this single source. |
| Setup Wizard | Multi-step `QuickPick` chain (`src/ux/setupWizard.ts`) that takes a user from "no environment" to "L3 open in the editor" in one continuous flow. Reachable from the welcome view, the tree view title bar, the status bar, the Walkthrough, and the Command Palette. The existing single-input **Add Environment** command remains for now and will be retired in a later change. |
```

- [ ] **Step 2: Add the new package row**

In the Package Structure table:

```markdown
| `src/ux/` | UX state derivation (`uxState.ts`), status bar item (`statusBar.ts`), Setup Wizard (`setupWizard.ts`), recents persistence (`recents.ts`), quick-switch command (`quickSwitch.ts`). The "what's next" guidance layer. |
```

- [ ] **Step 3: Add new commands to the command table**

```markdown
| `reltio.launchSetupWizard` | Welcome view, view title bar, status bar, walkthrough, Command Palette | Multi-step QuickPick chain: host → sign-in method → auth sub-flow → first tenant → confirm. Persists results and opens L3 on finish. |
| `reltio.signInEnvironment` | Inline tree icon on `E_NO_AUTH` env rows | Smart helper: QuickPick to choose browser-OAuth vs token, then runs the matching command. |
| `reltio.signInToFirstEnvironment` | Walkthrough step 2, status bar (when `G_NEEDS_AUTH`) | Same as above but picks the first unauthed env automatically. |
| `reltio.openL3` | Inline tree icon on tenants with L3, single-click on tenant row when `reltio.tenantSingleClickOpen` is true | Opens the tenant's `L3.reltio.json` in the editor. |
| `reltio.quickSwitchEnvironment` | Command Palette | QuickPick across configured envs; focuses the tree and opens L3 if exactly one tenant has it. |
```

- [ ] **Step 4: Note the new settings**

In the Configuration section:

```markdown
| `reltio.uxMode` | `default` \| `classic` | `default` | Toggles the redesigned setup experience. `classic` restores the pre-redesign behavior. |
| `reltio.tenantSingleClickOpen` | `boolean` | `true` | Single-click on a tenant row triggers the next action (fetch L3 if missing, open L3 if present). |
```

- [ ] **Step 5: Commit**

```bash
git add ARCHITECTURE.md
git commit -m "docs: document UX state, Setup Wizard, and new commands in ARCHITECTURE.md"
```

---

### Task 7.3: Final smoke matrix

This task does not produce code, only validation that everything composes. Run through this checklist manually in the Extension Development Host.

- [ ] **Step 1: Fresh-install smoke**

In a fresh `samples/` (no `*.reltio.environment` dirs):
- Status bar shows `Reltio: Add an environment`.
- Welcome view shows the "Connect to a Reltio tenant" variant with **Launch Setup Wizard** button.
- Walkthrough auto-opens (if first install).
- Run the wizard end-to-end → env added, signed in, tenant added, L3 fetched, L3 opened.
- After finish: status bar updates, walkthrough all 4 steps ticked, tree shows env + tenant with no description hints.

- [ ] **Step 2: Re-run wizard for a second env**

- Launch the wizard again via view title bar.
- Step 1 shows the first host in recents.
- Step 2 defaults to whichever method was used last.
- Step 3 reuses the shared OAuth client pair → no Configure prompts.
- Step 4 shows the second env's tenants.

- [ ] **Step 3: Sign-out + re-sign-in**

- Right-click env → Re-Login with Browser → goes through sso flow → status bar flashes warning color briefly → tree row description momentarily shows "Sign In" then returns to (empty).

- [ ] **Step 4: Classic mode**

- Set `reltio.uxMode = classic` → reload → all new surfaces hidden; status bar absent; tree descriptions absent.
- Set back to `default` → reload → everything returns.

- [ ] **Step 5: Removal cascade**

- Remove an env → tree updates, walkthrough may re-tick backward (acceptable since completionEvents are one-way in VS Code; this is informational).

- [ ] **Step 6: Walkthrough media**

- Each step renders the text markdown placeholder. No broken images, no missing media warning.

- [ ] **Step 7: No regressions on existing flows**

- `reltio.addEnvironment` (classic single-input) from view title still works.
- `Provide Token` still works.
- `Apply Configuration to Tenant` still works.
- Configuration history fetch + compare flows still work.
- Ontology preview still opens.

- [ ] **Step 8: Type-check final**

Run: `npm run compile && npm run build && npm run package`
Expected: a `.vsix` is produced under `target/`.

- [ ] **Step 9: Commit smoke results (no code change)**

No commit needed unless the smoke uncovers issues. If issues are found, file them as new tasks before merging.

---

## Self-Review (writing-plans skill required pass)

**1. Spec coverage**

| Spec section | Task(s) |
|---|---|
| D1 (state model) | 1.1, 1.2, 1.3, 1.4, 4.2 |
| D2 (walkthrough) | 6.1, 6.2 |
| D3.1 (viewsWelcome) | 3.1 |
| D3.2 (tree descriptions) | 2.1, 2.2, 2.3 |
| D3.3 (inline icons) | 2.4 |
| D4 (status bar) | 2.5 |
| D5 (Setup Wizard) | 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7 |
| D6 (smart defaults) | 4.1, 4.2, 4.3, 4.4 |
| D7 (migration + rollback) | 6.2, 7.1 |
| D8 (risks) | covered by smoke matrix 7.3 |
| D9 (rollout order) | reflected in phase order |

**2. Placeholders:** none — every task has concrete code, file paths, and verification.

**3. Type consistency:** `EState`, `TState`, `GState`, `UxState`, `UxStateBus`, `deriveUxState`, `publishUxStateContext` are defined in 1.1/1.2 and used consistently downstream. `WizardDeps` and `WizardState` are introduced in 5.1 and used in 5.2–5.6. Command IDs (`reltio.launchSetupWizard`, `reltio.signInEnvironment`, `reltio.signInToFirstEnvironment`, `reltio.openL3`, `reltio.quickSwitchEnvironment`) are consistent across tasks and `package.json` entries.

**4. Ambiguity:** wizard back navigation in Step 2 documented as "Cancel exits cleanly; richer back via `createQuickPick` is future work." All other steps explicit.
