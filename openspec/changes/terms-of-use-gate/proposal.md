## Why

Before a user logs in to a Reltio environment through the extension, they must accept the Reltio IDE Terms of Use (RP-190496). If they decline, login must not proceed. Acceptance should be asked once per user, not on every login, and everything else in the extension (tree view, offline `*.reltio.json` editing, ontology preview) must remain usable without accepting — only the act of logging in is gated.

## What Changes

- New module `src/ux/termsOfUse.ts` exposing `ensureTermsAccepted(context)`: checks a versioned `globalState` flag (`reltio.termsAcceptedVersion` against a `TERMS_VERSION` constant); if unset or stale, reads the bundled terms text via `vscode.workspace.fs` and shows it in a modal warning dialog with **Accept**/**Decline**. Accept persists the version and a `reltio.termsAcceptedAt` timestamp and returns `true`; Decline or dismissal returns `false` with no state written. A read failure — including a missing file, or one that reads as empty/whitespace-only — fails closed (shows an error, authentication cannot proceed) rather than silently skipping the gate or showing a blank modal.
- New bundled file `resources/legal/termsOfUse.txt` — plain-text Reltio IDE Terms of Use, packaged like any other `resources/**` asset.
- The gate is checked at the top of three call sites, before any credential/token/network work: `reltio.provideToken`, `reltio.loginWithBrowser`, and `launchSetupWizard` (checked once at wizard launch, not deeper in its auth sub-step, so the user isn't asked again mid-flow).
- New developer/support command `reltio.resetTermsAcceptance` clears stored acceptance, revokes active sessions, and deletes stored refresh tokens, so the next login attempt shows the terms again and no previously-authenticated session keeps working untouched (for support scenarios and manual re-verification).
- Versioning: bumping `TERMS_VERSION` in a future change is how Reltio forces re-acceptance after a wording change — a version mismatch is treated identically to "never accepted," no migration code needed.

## Capabilities

### New Capabilities
- `terms-of-use-gate`: One-time, versioned Terms of Use acceptance gate shown before any login action, persisted in `globalState`, with a reset command for support/testing.

### Modified Capabilities
- `browser-oauth-login`: `reltio.provideToken` and `reltio.loginWithBrowser` now check `ensureTermsAccepted(context)` first and bail out (return, no error, no telemetry) if it resolves `false` — identical to any other early-return already present in these handlers (e.g. dismissing an input box).
- `setup-ux-redesign`: `launchSetupWizard` checks the same gate once at the very start of the wizard, before any step runs.

## Impact

- **New files**: `src/ux/termsOfUse.ts`, `resources/legal/termsOfUse.txt`
- **Modified files**: `src/extension.ts` (import, gate in `reltio.provideToken`/`reltio.loginWithBrowser`, new `reltio.resetTermsAcceptance` command), `src/ux/setupWizard.ts` (gate at the top of `launchSetupWizard`), `package.json` (command declaration for `reltio.resetTermsAcceptance`)
- **Dependencies**: None new — uses `vscode.workspace.fs`, `context.globalState`, `vscode.window.showWarningMessage` (modal)
- **Depends on**: `browser-oauth-login` (the two commands being gated), `setup-ux-redesign` (the wizard being gated) — this change adds a precondition to existing entry points in both, it doesn't change their own behavior once the gate passes
