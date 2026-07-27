# Terms of Usage Acceptance Flow — Design

**JIRA:** [RP-190496](https://reltio.jira.com/browse/RP-190496)
**Branch:** `feature/RP-190496-terms-of-usage`

## Problem

Before a user logs in to a Reltio environment through the extension, they must accept the Reltio IDE Terms of Use. If they decline, login must not proceed. Acceptance should be asked once per user, not on every login.

Source text: "Reltio IDE Terms of Use" (Google Doc, confirmed as the sole content source for this feature — a second linked doc in the ticket was confirmed irrelevant).

## Scope

Gate the two existing login entry points in `src/extension.ts`:
- `reltio.provideToken` (manual Bearer token paste)
- `reltio.loginWithBrowser` (OAuth browser login)

Everything else in the extension (tree view, offline `*.reltio.json` editing, ontology preview) remains usable without accepting terms — only the act of logging in is gated.

Out of scope: a standalone "view terms" command/menu entry, audit logging beyond a local timestamp, telemetry.

## Design

### New module: `src/ux/termsOfUse.ts`

```ts
export const TERMS_VERSION = '1';

export async function ensureTermsAccepted(context: vscode.ExtensionContext): Promise<boolean>
```

- Reads `reltio.termsAcceptedVersion` from `context.globalState`.
- If it equals `TERMS_VERSION`, returns `true` immediately (no prompt) — this is the common path for every login after the first.
- Otherwise (never accepted, or accepted an older version):
  - Reads terms text from `resources/legal/termsOfUse.txt`, resolved via `context.extensionUri`.
  - Shows `vscode.window.showWarningMessage(text, { modal: true }, 'Accept', 'Decline')`.
  - On `'Accept'`: writes `reltio.termsAcceptedVersion = TERMS_VERSION` and `reltio.termsAcceptedAt = Date.now()` to `globalState`, returns `true`.
  - On `'Decline'` or dismissal (Escape/close): returns `false`, no state written.

### Call sites

At the top of both command handlers in `src/extension.ts`, before any credential/token/network work:

```ts
vscode.commands.registerCommand('reltio.provideToken', async (node?: EnvironmentNode) => {
	if (!node) return;
	if (!(await ensureTermsAccepted(context))) return;
	// ... existing logic unchanged
});

vscode.commands.registerCommand('reltio.loginWithBrowser', async (node?: EnvironmentNode) => {
	if (!node || !environmentManager) return;
	if (!(await ensureTermsAccepted(context))) return;
	// ... existing logic unchanged
});
```

Decline behaves like any other early-return in these handlers today (e.g. dismissing the client-ID input box) — no error message, no telemetry, login simply doesn't happen.

### Terms text bundling

- New file `resources/legal/termsOfUse.txt` — plain-text copy of the Reltio IDE Terms of Use doc content.
- Packaged the same way as `resources/icons/*` (included via `vsce package`, no `.vscodeignore` exclusion needed).
- Read with `fs.readFileSync` at prompt time (cold path only, not cached — reprompt is rare).

### Versioning

- `TERMS_VERSION` constant lives in `termsOfUse.ts` next to the bundled text.
- Bumping this constant in a future change is how Reltio forces re-acceptance after a wording change. No migration code is needed now — a version mismatch is treated identically to "never accepted."

### State keys (globalState)

| Key | Type | Purpose |
|---|---|---|
| `reltio.termsAcceptedVersion` | `string` | Compared against `TERMS_VERSION` to decide whether to prompt |
| `reltio.termsAcceptedAt` | `number` (epoch ms) | Local audit trail of when the user last accepted |

## Testing

**Update:** this repo has since grown an automated test harness (`npm test` → `scripts/run-unit-tests.cjs`, one script per OpenSpec change). This feature's automated coverage lives in `scripts/test-terms-of-use-gate.cjs` and the full contract in `openspec/changes/terms-of-use-gate/design.md`'s Test Plan — see those for current, authoritative coverage. The manual steps below remain accurate for the Tier C (GUI-driven) portion:
1. Fresh profile (clear `globalState` or use Extension Development Host with a clean user data dir) → `Provide Token` shows the modal; Decline cancels, no token stored; Accept proceeds to the existing input box.
2. Repeat login → no modal shown (version matches).
3. Bump `TERMS_VERSION` locally → modal reappears on next login attempt even though previously accepted.
4. Same behavior verified for `Login with Browser` and the Setup Wizard.
5. Run `reltio.resetTermsAcceptance` → confirm all three entry points prompt again, and a previously-active session no longer works without re-authenticating.
