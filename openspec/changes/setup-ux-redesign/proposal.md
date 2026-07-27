## Why

PM feedback: the extension is not interactive enough. Every multi-step task (Add Environment → Sign In → Add Tenant → Open L3) requires the user to type a value into a free-text input box, then guess what the next step is from a context menu. The environment-host input does not auto-complete recent values. After each step there is no in-editor signal of what to do next; the user has to know.

Modern multi-step UX in VS Code uses a combination of **Walkthroughs**, **dynamic `viewsWelcome`** content, **per-row tree descriptions and inline action icons**, **multi-step QuickPick chains**, and a **status bar item** to give continuous "what's next" guidance without ever leaving the VS Code chrome. No custom UI / webview is required.

## What Changes

This is a full UX overhaul scoped to the **setup and navigation experience** (not editing). The L3 editor, ontology preview, schema validation, and structural edit commands are not touched.

- **State derivation:** introduce a single `deriveUxState(envManager, tokenStore, oauthCredentialsStore)` function and a `reltio.uxState` VS Code context key. Every UI surface listed below reads from this one source.
- **First-run Walkthrough:** add `contributes.walkthroughs` with 4 steps (Add Environment → Sign In → Add Tenant → Open L3) that auto-opens on first install and is reopen-able from the Command Palette. Completion of each step is auto-detected via the `reltio.uxState` context key. Text-only in v1 (no media).
- **Dynamic `viewsWelcome`:** the welcome view inside the Reltio tree shows different next-step content for an empty workspace versus a workspace with no envs configured.
- **Per-row tree descriptions:** every environment and tenant tree row carries a short action-first hint ("Sign in to continue", "L3 not fetched — click to fetch") that reflects its state.
- **Inline action icons:** each environment and tenant row gets one hover-only icon (on the right side of the row) that runs the most likely next action for that row's state. Today's right-click menu stays unchanged.
- **Status bar item:** a low-priority status bar item renders a one-line "what's next" hint or a steady-state summary; clicking it focuses the tree or runs the next-step command.
- **Multi-step Setup Wizard:** a new command `reltio.launchSetupWizard` opens a chained `QuickPick` flow (Host → Sign-in method → auth sub-flow → First tenant → Confirm). The host step is an **editable QuickPick** with autocomplete from recently-used hosts and a synthetic "Use what you typed" item. The wizard does not replace the existing tree right-click "Add Environment" — that command keeps its single-input behavior for now and will be retired in a later change once the wizard is proven.
- **Smart defaults:** persist recent hosts, recent tenants per host, and last-used auth method (workspaceState). Single-click on a tenant tree row opens L3 (or fetches L3 if missing). After the wizard finishes, focus jumps to the L3 editor. Status bar flashes briefly so the user notices state changed.
- **Rollback flag:** ship a hidden setting `reltio.uxMode: "default" | "classic"` (default `"default"`) that disables every new surface. Lets the team back out the redesign without removing code.

## Capabilities

### New Capabilities

- `ux-state-derivation`: A single function and context key that exposes the workspace's global state (`G_EMPTY` / `G_NEEDS_AUTH` / `G_NEEDS_TENANT` / `G_NEEDS_L3` / `G_READY`) and per-environment state (`E_NO_AUTH` / `E_HAS_OAUTH_NO_SESSION` / `E_AUTHED_NO_TENANTS` / `E_READY`) and per-tenant state (`T_NO_L3` / `T_L3_NEVER_OPENED` / `T_READY`), with an event emitter that fires on any state change.
- `first-run-walkthrough`: A four-step VS Code Walkthrough that teaches the cold-start workflow, with auto-detected completion driven by the `reltio.uxState` context key.
- `dynamic-views-welcome`: Empty-state welcome content for the Reltio tree that varies by workspace state.
- `tree-next-step-hints`: Per-row description text and per-row inline action icons that point to the most likely next command for that row's state.
- `setup-wizard`: A multi-step `QuickPick` chain that takes a user from "no environment" to "L3 open in the editor" in one continuous flow.
- `status-bar-next-step`: A status bar item that reflects the workspace's `G_state` and acts as a click-to-next-step shortcut.
- `setup-smart-defaults`: Recent hosts, recent tenants per host, last-used auth method, single-click tenant open, post-wizard focus management.

### Modified Capabilities

- `browser-oauth-login` (UX only): the wizard reuses the existing `Configure OAuth Client` and `Login with Browser` commands; SSO routing tenant ID and shared client pair behavior are unchanged.

## Impact

- **`src/`** — new `uxState.ts` (state derivation + event emitter), new `setupWizard.ts` (multi-step QuickPick chain), new `statusBar.ts` (status bar item lifecycle); changes to `multiTenantNodes.ts` (descriptions + inline icons), `multiTenantTreeProvider.ts` (single-click open command), `extension.ts` (wire everything up, expose `reltio.launchSetupWizard` + new helper commands), small touch to `oauthCredentialsStore.ts` for "is configured" checks.
- **`package.json`** — `contributes.walkthroughs` block, additional `viewsWelcome` entries, additional commands (`reltio.launchSetupWizard`, `reltio.signInToFirstEnvironment`, `reltio.signInEnvironment`, `reltio.quickSwitchEnvironment`), additional `view/item/context` and `view/title` menu entries with `when` clauses driven by `reltio.uxState`. New hidden setting `reltio.uxMode`.
- **`docs/`** — short addendum to `BROWSER_LOGIN.md` and possibly a new `docs/SETUP_WIZARD.md` describing the wizard from a user perspective.
- **`ARCHITECTURE.md`** — new domain concepts (UX state, walkthrough, wizard), update Bootstrap sequence, add new commands to the command table.
- **Dependencies** — no new npm packages.
