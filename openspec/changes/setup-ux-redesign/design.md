# Setup UX Redesign — Design

Audience: AI agents and human engineers picking up this change.

## Goals

1. Cold-start path from "I just installed this" to "I am editing L3" requires the minimum number of clicks and keystrokes.
2. At every step of that path, the user can see what to do next without reading docs or guessing.
3. Returning power users get the same fast tree access they have today (or faster).
4. Every new surface is a native VS Code primitive. No webviews. No custom HTML UI.

## Non-Goals

The redesign covers **setup and navigation**. It does not touch:

| Area | Status |
|---|---|
| L3 editing experience (JSON validation, Go-to-Definition, Find References, structural edit commands) | Untouched |
| Ontology preview | Untouched |
| Apply Configuration to Tenant (PUT + baseline drift checks) | Untouched |
| Configuration history (fetch, snapshots, compare) | Untouched |
| Workspace file layout (`*.reltio.environment/`, `*.reltio.tenant/`, `L3.reltio.json`, layout sidecars) | Untouched |
| Existing command IDs (`reltio.addEnvironment`, `reltio.fetchL3`, etc.) | Untouched — preserves muscle memory, keybindings, external scripts |
| SecretStorage key format | Untouched — existing stored credentials keep working |
| Webviews / custom HTML UI | Out of scope by direction |
| Telemetry / analytics | Out of scope — separate consent discussion |
| Localization | Out of scope for v1 — strings are hardcoded English |
| Walkthrough media (screenshots / GIFs) | Out of scope for v1 — text-only walkthrough |
| Keybindings for new commands | No new defaults shipped; users can bind manually |

## D1. Shared state model

Every UI surface reads from a single `deriveUxState()` function and re-renders when its `onUxStateChange` event fires. This is the source of truth for "what should the user do next."

### Global state (whole workspace)

| State | Meaning | Next step |
|---|---|---|
| `G_EMPTY` | No environment directories in the workspace | Add an environment |
| `G_NEEDS_AUTH` | At least one env exists; none are authenticated | Sign in |
| `G_NEEDS_TENANT` | At least one env authenticated; no tenants added under it | Add a tenant |
| `G_NEEDS_L3` | Tenants added; no L3 fetched | Fetch L3 |
| `G_READY` | At least one L3 file present | None (or steady state) |

### Per-environment state

| State | Meaning | Next step |
|---|---|---|
| `E_NO_AUTH` | No OAuth client AND no token | Configure OAuth Client OR Provide Token |
| `E_HAS_OAUTH_NO_SESSION` | OAuth client configured, no active session | Sign in (Login with Browser) |
| `E_AUTHED_NO_TENANTS` | Session or token active, no tenants added | Add a tenant |
| `E_READY` | At least one tenant added | None |

### Per-tenant state

| State | Meaning | Next step |
|---|---|---|
| `T_NO_L3` | Tenant directory exists, no `L3.reltio.json` yet | Fetch L3 |
| `T_L3_NEVER_OPENED` | L3 file exists, user has not opened it in the editor since adding the tenant | Open L3 |
| `T_READY` | L3 exists and has been opened at least once | None |

### Surfaces and what they read

| Surface | Reads | Re-renders on |
|---|---|---|
| Walkthrough | `G_state` (via `reltio.uxState` context key) | Context key change |
| `viewsWelcome` | `G_state` + `workspaceFolderCount` | `setContext` call |
| Tree item description | `E_state` for env rows, `T_state` for tenant rows | `onUxStateChange` |
| Tree inline action icon | `E_state` / `T_state` | `onUxStateChange` |
| Status bar item | `G_state` plus env / tenant counts | `onUxStateChange` |

### Events that trigger state re-derivation

- Environment added or removed (`environmentManager` events)
- Token set, cleared, or refreshed (`tokenStore` mutations)
- OAuth client credentials saved or deleted (`oauthCredentialsStore` mutations)
- Tenant directory appears or disappears (workspace file system watcher)
- An `L3.reltio.json` is written or opened in the editor

A single `onUxStateChange` event emitter fans this out to every surface. Re-derivation is a pure function over already-in-memory data; no async work, no file walks beyond the existing `scanEnvironments()` call.

## D2. First-run Walkthrough

`contributes.walkthroughs` entry in `package.json`. Auto-opens once on first install (`openOnInstall: true`, gated by `reltio.walkthroughSeen` flag in `globalState`). Reopen via Command Palette → "Welcome: Open Walkthrough" → "Reltio Metadata Editor". Text-only in v1.

**id:** `reltio.gettingStarted`
**title:** "Get started with Reltio Metadata Editor"
**featuredFor:** `**/*.reltio.json`

| # | Title | Description (markdown) | Action button | Completion event |
|---|---|---|---|---|
| 1 | Add your first Reltio environment | Tell the extension which Reltio host your tenant lives on (e.g. `361.reltio.com`). The host is validated against `/reltio/status` before it is added to your workspace. | **Add Environment** → `reltio.launchSetupWizard` | `onContext:reltio.uxState != G_EMPTY` |
| 2 | Sign in | Choose how to authenticate. **Browser login (recommended)** opens auth.reltio.com — your password never touches the extension. Or paste a Bearer token manually. | **Set up authentication** → `reltio.signInToFirstEnvironment` | `onContext:reltio.uxState in [G_NEEDS_TENANT, G_NEEDS_L3, G_READY]` |
| 3 | Add a tenant | Pick a tenant from your accessible list. The L3 configuration is downloaded automatically. | **Add Tenant** → `reltio.addTenant` on first authed env | `onContext:reltio.uxState in [G_NEEDS_L3, G_READY]` |
| 4 | Start editing | Open `L3.reltio.json` to begin. You get JSON schema validation, Go-to-Definition on URIs, Find References, structural edit commands, and the ontology preview. | **Open L3** → opens first available `L3.reltio.json` | `onContext:reltio.uxState == G_READY` AND at least one L3 file opened |

### Why "Configure OAuth Client" is not its own step

For a first-time user, Configure is a means to an end inside Step 2. The `reltio.signInToFirstEnvironment` helper command branches:

- If the user picks **browser** in the sign-in QuickPick AND no OAuth client pair is stored anywhere in the workspace → it inlines the three-input client configuration sub-flow (client ID → secret → SSO routing tenant) before launching the browser.
- If a shared OAuth pair exists → it skips configuration and goes straight to browser login.
- If the user picks **token** → it just shows the masked input box for the Bearer token.

The walkthrough step represents the user-facing milestone ("I am now signed in"), not the internal command structure. The standalone `Configure OAuth Client` and `Reset OAuth Client` commands remain available from the right-click menu and Command Palette.

### Suppression for upgrade users

On first activation of the new version, the extension checks: does this user already have any `.reltio.environment` directories, any stored OAuth credentials, or any stored refresh tokens? If yes → `reltio.walkthroughSeen` is set to `true` immediately. Walkthrough never auto-opens. Still reachable via Command Palette.

## D3. Dynamic tree

Three sub-surfaces inside the Reltio tree, all driven by D1's state model.

### D3.1 `viewsWelcome`

Replaces the current single welcome entry with two `when`-gated entries:

| `when` clause | Content |
|---|---|
| `workspaceFolderCount == 0` | "Open a folder to start working with Reltio metadata. Each folder can hold multiple Reltio environments." → **[Open Folder]** button + **[View walkthrough]** link (`command:workbench.action.openWalkthrough?reltio.gettingStarted`) |
| `workspaceFolderCount > 0 && reltio.uxState == G_EMPTY` | "Connect to a Reltio tenant in 4 steps. Start by adding your first environment." → **[Launch Setup Wizard]** button (`command:reltio.launchSetupWizard`) + **[View walkthrough]** link |

`viewsWelcome` only renders when the tree has zero items. Once any environment exists, the tree shows envs and the welcome view is hidden.

### D3.2 Per-row description text

VS Code renders a tree item's `description` field as small grey text after the label. Each env and tenant row carries one short action-first hint that reflects its state:

| Row | State | Description text |
|---|---|---|
| Environment | `E_NO_AUTH` | *Sign in to continue* |
| Environment | `E_HAS_OAUTH_NO_SESSION` | *Sign In* |
| Environment | `E_AUTHED_NO_TENANTS` | *No tenants — click + to add* |
| Environment | `E_READY` | (empty — no clutter) |
| Tenant | `T_NO_L3` | *L3 not fetched — click to fetch* |
| Tenant | `T_L3_NEVER_OPENED` | *Open L3 to start editing* |
| Tenant | `T_READY` | (empty) |

No emojis. Tooltip on the tree item spells out the same action in a full sentence.

### D3.3 Inline action icons

`contributes.menus["view/item/context"]` with `group: "inline"`. One state-appropriate next-step icon per row:

| Row | State | Codicon | Click action |
|---|---|---|---|
| Environment | `E_NO_AUTH` | `$(key)` | `reltio.signInEnvironment` (smart helper — picks browser OAuth or token by prompting) |
| Environment | `E_HAS_OAUTH_NO_SESSION` | `$(globe)` | `reltio.loginWithBrowser` |
| Environment | `E_AUTHED_NO_TENANTS` | `$(add)` | `reltio.addTenant` |
| Environment | `E_READY` | (none — right-click menu still has everything) | — |
| Tenant | `T_NO_L3` | `$(cloud-download)` | `reltio.fetchL3` |
| Tenant | `T_L3_NEVER_OPENED` | `$(go-to-file)` | `reltio.revealInEditor` |

Inline icon `when` clauses are tied to specific `contextValue` strings on the tree item (already used today — extended with the new states).

## D4. Status bar item

`vscode.window.createStatusBarItem(StatusBarAlignment.Left, priority < 100)`. One persistent item. Visibility and label derived from `G_state`:

| `G_state` | Label | On click |
|---|---|---|
| `G_EMPTY` | *Reltio: Add an environment* | `reltio.launchSetupWizard` |
| `G_NEEDS_AUTH` | *Reltio: Sign in required* | `reltio.signInToFirstEnvironment` |
| `G_NEEDS_TENANT` | *Reltio: Add a tenant* | `reltio.addTenant` on the first authed env (multi-env case → focus tree) |
| `G_NEEDS_L3` | *Reltio: Fetch L3* | Focus tree on the L3-less tenant |
| `G_READY` (single env, no tenants) | (hidden) | — |
| `G_READY` (otherwise) | *Reltio: <n> envs, <m> tenants* | Focus tree |

Hidden entirely when `workspaceFolderCount == 0` AND welcome view is showing — welcome view already does the job.

After the wizard finishes, the status bar item flashes briefly: `backgroundColor = statusBarItem.warningBackground` for 1500 ms, then reverts. Single signal that the workspace state changed.

## D5. Multi-step Setup Wizard

`vscode.commands.registerCommand('reltio.launchSetupWizard', …)`. Built on `vscode.window.createQuickPick()` and `createInputBox()`, following Microsoft's [multiStepInput.ts sample](https://github.com/microsoft/vscode-extension-samples/tree/main/quickinput-sample) for the back/cancel skeleton.

### Entry points

1. Welcome view button (`G_EMPTY` variant).
2. Walkthrough Step 1 button.
3. Status bar click (when `G_state == G_EMPTY`).
4. Tree view title `…` menu → "Launch Setup Wizard".
5. Right-click on empty tree space → "Launch Setup Wizard".
6. Command Palette.

The existing right-click "Add Environment" on the tree view title bar keeps its current single-input flow for now. It will be retired in a future change once the wizard is proven.

### Chain

Each step shows a step counter in the title (e.g., "Add Reltio environment (3 of 5)") and has built-in Back / Cancel buttons. Nothing is written to disk until Step 5 Finish.

**Step 1 — Host.** Editable `QuickPick`. Items = recent hosts from `globalState[reltio.recentHosts]` (capped at 10, move-to-front). As the user types, fuzzy filter narrows the list. When the typed value matches none of the items, a synthetic top item `$(plus) Use "<typed>"` appears and uses the typed value on Enter. The typed/picked value is then run through the existing `normalizeEnvironmentName()` helper (strips scheme, trailing slashes) and validated via `validateEnvironment()` (HTTP 200 to `/reltio/status`) with a progress notification; failure shows inline validation and lets the user re-type without restarting the chain.

**Step 2 — Sign-in method.** Plain `QuickPick`. Three items, default-highlighted by `workspaceState[reltio.lastAuthMethod]`:

```
▸ Sign in with browser (recommended)
▸ Paste a Bearer token
▸ Skip — I'll sign in later
```

**Step 3 — Auth sub-flow.** Branches by Step 2 choice:

- **Browser:** if a shared OAuth client pair already exists in `oauthCredentialsStore` → jump straight to browser login. Otherwise → three sequential masked inputs for client ID → client secret → SSO routing tenant ID (blank; the user supplies their own, required), then launch browser login. On error (`PORT_BUSY`, `NO_IDP_CONFIGURED`, etc.) → existing error UX, return user to Step 2.
- **Token:** single masked input. Validate by issuing a no-op `GET /reltio/tenants` before continuing. On 401 → re-prompt.
- **Skip:** Step 3 is no-op; jump to Step 5 with `E_NO_AUTH` state. Steps 4 and tenant work are also skipped.

**Step 4 — First tenant.** `QuickPick` populated by `listTenants(env, token)`. If the existing auto-add-tenant behavior from `feature/oauth-login-ssocheck` already created a tenant during Step 3 (because the configured SSO routing tenant is in the user's accessible list), that tenant is pre-highlighted at the top of the list with a `(already added)` suffix; the user can press Enter to keep just that tenant or pick a different one (both are added). Three special items prepended:

```
▸ $(arrow-right) Skip — I'll add a tenant later
─── Tenants you have access to ───
▸ acme-prod
▸ acme-staging
▸ acme-dev
```

A "Loading tenants…" badge shows while the API call is in flight. Type-to-filter narrows the list. On API failure → "Could not load tenants — Retry / Skip".

**Step 5 — Confirm.** Summary QuickPick:

```
   Host:    361.reltio.com
   Auth:    Browser OAuth (signed in as user@example.com)*
   Tenant:  acme-prod
   L3:      Will fetch and open

▸ Looks good — finish
▸ Back to change something
```

`signed in as` is best-effort (JWT `sub` claim decode; omit on failure).

On **Finish**, sequentially: create env directory → persist tokens / OAuth client pair → create tenant directory (if picked) → fetch L3 (if tenant picked, with progress) → open `L3.reltio.json` in editor at column 1 → push host to `reltio.recentHosts` → fire `onUxStateChange`.

### Error handling

- Host invalid (`validateEnvironment` returns false) → inline error on Step 1; no full restart.
- Auth fails → notification, return to Step 2 with "Try again" pre-highlighted.
- Tenant list fails → Step 4 shows Retry / Skip.
- L3 fetch fails after wizard finish → env + tenant directories already exist; user runs Fetch Configuration manually. Wizard does NOT roll back.
- Cancel mid-flow → nothing written to disk. Any tokens fetched during Step 3 discarded.

## D6. Smart defaults

### Persisted preferences

| Key | Storage | Used by | Effect |
|---|---|---|---|
| `reltio.recentHosts` (string[], cap 10) | `globalState` | Wizard Step 1, tree right-click Add Environment | Recent hosts surfaced first; move-to-front, dedup |
| `reltio.lastAuthMethod` (`browser` \| `token`) | `workspaceState` | Wizard Step 2 | Last-used method becomes default-highlighted item |
| `reltio.recentTenants[hostKey]` (Map<host, string[]>) | `globalState` | Wizard Step 4, standalone `Add Tenant` | Recently-picked tenants for this host surface above the API list |
| `reltio.walkthroughSeen` (boolean) | `globalState` | Walkthrough auto-open suppression | If set, walkthrough does not auto-open even on first install |
| `reltio.openedL3Files` (string[] of file URIs) | `workspaceState` | `deriveUxState()` `T_state` derivation | A tenant whose `L3.reltio.json` URI is in this list reports `T_READY`; otherwise `T_L3_NEVER_OPENED`. Appended-to when an L3 file is opened in the editor. |

### Behavior tweaks

- **Single-click open on tenant rows.** Tenant tree items get a `command` so the row's label-click runs the next-step command (Fetch L3 if `T_NO_L3`, open L3 otherwise). Matches VS Code's file explorer single-click preview semantics. Gated behind a setting `reltio.tenantSingleClickOpen` (default `true`) so it can be disabled if anyone objects.
- **Auto-add tenant after sign-in.** Existing behavior from `feature/oauth-login-ssocheck` stays: if the configured SSO routing tenant is in the user's accessible-tenants list, its tenant directory is auto-created and L3 auto-fetched.
- **`reltio.quickSwitchEnvironment` command.** New command (no default keybinding). Lists all configured envs in a QuickPick; on pick, focuses the tree on that env and, if exactly one of its tenants has L3, opens that L3. For multi-env consultants.
- **Cached tenants list (60 s in-memory TTL).** `listTenants` results are cached per env for 60 seconds. Smooths Back/Forward in the wizard and immediate-follow-up `Add Tenant` actions. Memory only; no persistence.
- **Focus management after wizard.** Tree focused, new env auto-expanded, L3 opened with focus, status bar flashes once.

### What we explicitly do not smart-default

- Do NOT auto-fetch L3 for tenants the user did not pick.
- Do NOT auto-add every accessible tenant on first sign-in.
- Do NOT persist manual Bearer tokens to disk. Manual token stays in-memory only.

## D7. Migration and rollback

### Returning users

The redesign must not surprise existing users. Three guardrails:

1. **`viewsWelcome` is gated on `G_EMPTY`.** Users with at least one env already in their workspace never see the welcome content.
2. **Walkthrough auto-open is suppressed for upgrade users.** On first activation of the new version, presence of any `.reltio.environment` directory, any OAuth credentials in SecretStorage, or any stored refresh token sets `reltio.walkthroughSeen = true` immediately. The walkthrough never auto-opens for them.
3. **All current commands behave identically.** Existing right-click "Add Environment" still shows the single `showInputBox`. New entry points (welcome view, walkthrough, status bar, view title menu) point to the wizard but never replace the existing flow.

### Rollback flag

A hidden setting `reltio.uxMode` with values `"default"` (the new UX, default value) or `"classic"` (pre-redesign UX). When `"classic"`:

- Walkthrough not registered (or `openOnInstall: false`).
- `viewsWelcome` falls back to today's single welcome entry.
- Status bar item hidden.
- `deriveUxState()` returns `G_READY` constantly so no descriptions / inline icons render.
- Wizard command stays registered (still accessible from Command Palette) but tree menu / walkthrough / status bar / welcome view don't link to it.

One toggle disables every new surface without removing code.

### Pre-merge backward-compat checklist

- Open a workspace with envs already configured via the prior token-paste flow → tree identical, no walkthrough auto-open, status bar shows `Reltio: <n> envs, <m> tenants`.
- Open a workspace with envs configured via `feature/oauth-login-ssocheck` → refresh tokens load, envs come up authenticated, no "Sign in" hints on already-authed envs.
- `reltio.addEnvironment` in Command Palette still works as a one-shot input.
- Existing custom keybindings on any `reltio.*` command still fire.
- `reltio.uxMode = "classic"` round-trips to the pre-redesign experience.

## D8. Risks

| Risk | Mitigation |
|---|---|
| `deriveUxState()` is on the hot path; a slow implementation makes the tree feel laggy. | Pure function over already-in-memory data. Benchmark with a 50-env / 200-tenant workspace before merging. |
| Walkthrough completion stuck because `reltio.uxState` context key publishes wrong values. | Single integration test that drives the wizard end-to-end and asserts each context key flips. |
| Multi-step `QuickPick` UX corners (back after error, cancel mid-network-call, double-Enter). | Use Microsoft's official multiStepInput sample as the skeleton — it handles all of these. |
| `listTenants` hangs in Step 4. | Reuse the existing 10-second `fetchWithTimeout`. On timeout, Step 4 shows Retry / Skip. |
| Status bar item competes for screen real estate with other extensions. | Hide in single-env / no-tenant ready state. Priority < 100. |
| Single-click open behavior surprises long-time users. | Gate behind setting `reltio.tenantSingleClickOpen` (default `true`); revert default if feedback says otherwise. |
| Workspace trust restricted mode — last wizard step (create env directory) fails. | Existing "untrusted workspace" error path surfaces; no new code needed. |

## D9. Rollout order

Build and ship in this sequence so each layer is independently reversible:

| Phase | What lands | Why |
|---|---|---|
| **1** | State derivation: `uxState.ts`, `reltio.uxState` context key, `onUxStateChange` emitter. No user-visible change. | Zero risk. Everything downstream depends on this. |
| **2** | Tree row descriptions + inline icons + status bar item. | Additive; doesn't change clicks; users start seeing "what's next" guidance. |
| **3** | Dynamic `viewsWelcome` variants. | Affects only empty-tree state. |
| **4** | Smart defaults + single-click open + recent-host persistence. | Compounding micro-UX wins. |
| **5** | Multi-step Setup Wizard (`reltio.launchSetupWizard`). | Biggest single piece. Existing right-click "Add Environment" stays untouched. |
| **6** | Walkthrough. | Last because it depends on state-context signals being correct from Phase 1. |

Phases 1–3 ship a meaningful UX improvement on their own. Phases 5–6 complete the story.
