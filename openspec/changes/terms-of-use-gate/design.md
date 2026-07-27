## Context

The extension previously let a user log in to a Reltio environment (paste a Bearer token, run browser OAuth, or go through the Setup Wizard) with no acceptance step. RP-190496 requires gating login behind a one-time Terms of Use acceptance. Source text: "Reltio IDE Terms of Use" (Google Doc, confirmed as the sole content source — a second linked doc in the ticket was confirmed irrelevant).

## Goals / Non-Goals

**Goals:**
- Gate every path that results in a login: `reltio.provideToken`, `reltio.loginWithBrowser`, and the Setup Wizard.
- Ask once per user, not on every login — persist acceptance versioned so a future wording change can force re-acceptance.
- Leave everything else in the extension (tree view, offline `*.reltio.json` editing, ontology preview) fully usable without accepting.
- Fail closed: if the bundled terms text can't be read, login must not proceed.

**Non-Goals:**
- A standalone "view terms" command or menu entry.
- Audit logging beyond a local `globalState` timestamp.
- Telemetry on accept/decline.
- Exact byte-for-byte fidelity to the source Google Doc — the source doc has two typos ("terminate automaticall", a duplicated trademark sentence) corrected in the bundled text since this is a user-facing legal notice, not a document under external change control. If exact source fidelity is later required, that's a copy-only follow-up.

## Decisions

### D1 — Versioned `globalState` flag, not a one-time first-run flag

**Choice:** Store `reltio.termsAcceptedVersion` (compared against a `TERMS_VERSION` constant in `termsOfUse.ts`) rather than a plain boolean.

**Rationale:** A boolean can only ever mean "accepted once, ever." A version lets Reltio bump `TERMS_VERSION` after a wording change and have every user re-prompted exactly once, without any migration code — a version mismatch is treated identically to "never accepted."

### D2 — Gate at three call sites, not one central chokepoint

**Choice:** Check `ensureTermsAccepted(context)` at the top of `reltio.provideToken`, `reltio.loginWithBrowser`, and `launchSetupWizard`, rather than trying to intercept a single shared "login" function.

**Rationale:** There is no single shared login function — these are three independent entry points a user can reach directly (right-click menu on an environment node, or the wizard from the welcome view). Gating each one at its own top, before any credential/token/network work, is simpler and more obviously correct than routing all three through a new shared chokepoint.

### D3 — Wizard gate checked once at launch, not inside its auth sub-step

**Choice:** `launchSetupWizard` checks the gate once at the very start of the function, before the first wizard step runs — not later, inside whichever step handles authentication.

**Rationale:** This was changed from an earlier iteration that gated only the wizard's auth sub-step. Checking at launch means the user sees the terms prompt (if needed) before investing time in earlier wizard steps (host entry, etc.), rather than being asked to accept partway through a flow they've already started.

### D4 — Decline behaves like any other dismissal, no special error path

**Choice:** `ensureTermsAccepted` returns `false` on Decline or on dismissing the modal (Escape/close) — indistinguishable to the caller. Every gated call site does a plain `if (!(await ensureTermsAccepted(context))) return;`.

**Rationale:** Consistent with how these handlers already treat other early-return conditions (e.g. dismissing the client-ID input box in `loginWithBrowser`) — no error message, no telemetry, the action simply doesn't happen.

### D5 — Fail closed on a terms-text read failure

**Choice:** If `vscode.workspace.fs.readFile` on the bundled `resources/legal/termsOfUse.txt` throws, `ensureTermsAccepted` shows an error message and returns `false` — it does not silently skip the prompt and let login proceed.

**Rationale:** The whole point of the gate is that login cannot happen without an explicit accept. A missing/corrupt bundled file (e.g. a packaging regression) must block login, not silently bypass the requirement.

### D6 — Read via `vscode.workspace.fs`, not Node's `fs`

**Choice:** The shipped module reads the terms file via `vscode.workspace.fs.readFile` + `TextDecoder`, not `fs.readFileSync` (an earlier draft used the latter).

**Rationale:** Consistent with how the rest of the extension accesses workspace/extension-bundled files (`vscode.workspace.fs` throughout `environmentManager.ts`, `configurationHistory.ts`, etc.) and works uniformly across local and remote-dev scenarios where Node's `fs` wouldn't necessarily point at the right filesystem.

### D7 — `reltio.resetTermsAcceptance` developer/support command

**Choice:** Added after the initial implementation — clears both `globalState` keys so the next login attempt re-shows the terms, without needing to clear all extension state or reinstall.

**Rationale:** Needed for manual re-verification during development and for support scenarios (e.g. confirming a user actually saw the current wording).

## Bugfix Round 1 — CodeRabbit PR review (PR #34)

A CodeRabbit review of the PR raised 4 actionable findings.

### D8 — Error text is flow-neutral, not login-specific

**Choice:** The terms-text read-failure message changed from "Could not load Reltio IDE Terms of Use. **Login** cannot proceed." to "...**Authentication** cannot proceed."

**Rationale:** The same gate also covers the Setup Wizard's authentication step, not just the two explicit login commands — "login" was misleading wording for that path.

### D9 — Reset also revokes active sessions, but activation-time restore stays ungated

**Choice:** `reltio.resetTermsAcceptance` now also calls `tokenStore.clearAll()` and deletes every stored refresh token (`sessionStore.listEnvironments()` + `deleteRefreshToken` for each), then refreshes the tree/UX state. The activation-time session-restore path itself (silently calling `refreshTokens()` for a stored refresh token on startup) is **not** gated behind `ensureTermsAccepted`.

**Rationale:** CodeRabbit correctly identified that the original gate only covered explicit login actions — a user who was already signed in kept working authenticated regardless of terms state, and running Reset was purely cosmetic (it didn't touch any live session). Making Reset actually revoke sessions closes that gap for the "reset" scenario without changing everyday behavior. Gating the activation-time restore itself (the more invasive option CodeRabbit also raised) was deliberately not done: the original design explicitly scoped this feature to "the act of logging in," and gating activation would mean a modal potentially appearing on startup before the user has interacted with anything, which is a materially bigger UX change than this ticket's scope. A user who explicitly declines during an active session can still work authenticated until they restart or a token naturally expires — see the accepted limitation below.

**Accepted limitation:** if a user has an active, unexpired session and declines terms on a *fresh* prompt (e.g. after a `TERMS_VERSION` bump), that existing session is not proactively revoked at the moment of decline — only `reltio.resetTermsAcceptance` (an explicit action) revokes active sessions. This mirrors the original design's scope ("only the act of logging in is gated") rather than retroactively enforcing acceptance on already-authenticated sessions.

### D10 — Legal clause wording left untouched, flagged for legal review

**Choice:** `resources/legal/termsOfUse.txt` line 5 has a malformed clause ("...contained in the Agreement and any in accordance with any applicable documentation"). This was **not** corrected as part of this change.

**Rationale:** This is a legal notice, not ordinary prose — guessing at corrected wording risks changing the actual legal meaning of the clause. The two typos corrected during initial authoring (D-context, "terminate automaticall", a duplicated trademark sentence) were unambiguous transcription errors; this phrase is more likely a genuine (if awkwardly worded) clause from the source document, not certainly a typo. Correcting it requires the actual legal-approved wording, not a plausible guess. Tracked as an open item below.

## Bugfix Round 2 — CodeRabbit PR review (PR #41, full-repo review)

A second CodeRabbit review (a fresh PR opened against the same branch, reviewing the full diff rather than an incremental one) raised 7 findings — 3 new, 1 a repeat of the still-deliberately-unfixed legal clause (D10), and 3 targeting the historical planning docs.

### D11 — Reject empty or whitespace-only terms content

**Choice:** `ensureTermsAccepted` now throws (and so falls into the existing fail-closed error path) if the decoded terms text is empty or whitespace-only, in addition to the existing read-failure handling.

**Rationale:** `vscode.workspace.fs.readFile` succeeds for a zero-byte or whitespace-only file — without this check, a packaging regression that shipped an empty `termsOfUse.txt` would let a user "accept" a blank modal and have that persist as valid acceptance, defeating the entire purpose of the gate.

### D12 — Dead test stub removed

**Choice:** Removed a leftover `showWarningMessage` stub assignment in `scripts/test-terms-of-use-gate.cjs`'s reset test (introduced, then immediately overwritten, in the same edit during Bugfix Round 1) that was never actually invoked.

**Rationale:** Pure cleanup — the dead assignment had no effect on the test and was confusing to read.

### D13 — OpenSpec `proposal.md` updated to match the session-revocation behavior

**Choice:** `proposal.md`'s bullet describing `reltio.resetTermsAcceptance` now states the session-revocation behavior added in D9, instead of only "clears the stored acceptance."

**Rationale:** Bugfix Round 1 updated `design.md`/`tasks.md`/`specs/terms-of-use-gate/spec.md` for the D9 change but missed `proposal.md`, leaving the change's own summary document out of sync with its detailed spec — exactly the kind of drift OpenSpec artifacts exist to prevent.

### D14 — Historical planning docs (`docs/superpowers/specs/2026-07-10-terms-of-usage-design.md`, `docs/superpowers/plans/2026-07-10-terms-of-usage.md`) updated to match the shipped implementation

**Choice:** Unlike the cosmetic heading-level nit deliberately left alone on the `git-repository-source` change, these findings were substantive accuracy mismatches: the design doc's Testing section still claimed "no test runner" after automated tests were added; the plan's Task 2 pseudocode still showed the discarded `fs.readFileSync` approach instead of the shipped fail-closed `vscode.workspace.fs.readFile` version; and the plan's stated Goal only named two of the three now-gated entry points (missing the Setup Wizard). All three were corrected to match the actual shipped behavior.

**Rationale:** A plan/design doc that shows code or scope that was never shipped (or is now wrong) is worse than no doc at all — a future reader has no way to tell it's stale without cross-checking the real source. This is different in kind from a pure formatting/heading-level lint finding, which carries no risk of misleading anyone about actual behavior.

## Risks / Trade-offs

- **User declines repeatedly** → every login attempt re-shows the prompt (by design — no "don't ask again" bypass beyond actually accepting). No workaround needed since this is the intended behavior.
- **Bundled terms file missing from a packaged build** → fails closed (D5); worth a packaging smoke-test (open the built `.vsix`, confirm `resources/legal/termsOfUse.txt` is present) since there's no automated check for `.vscodeignore` coverage.
- **Wording change requiring re-acceptance** → bump `TERMS_VERSION`; every user is re-prompted on next login, no other code change needed.
- **Session continues after decline (accepted limitation, see D9)** → an already-authenticated session isn't proactively torn down the moment a user declines a re-prompt; only an explicit `reltio.resetTermsAcceptance` revokes sessions. Documented rather than silently left as a surprise.

## Migration Plan

No migration needed — this is a new gate with no prior state to reconcile. Existing installations simply see the prompt on their next login attempt after upgrading.

## Test Plan

**Automated** (`scripts/test-terms-of-use-gate.cjs`, registered in `scripts/run-unit-tests.cjs`, run via `npm test`):

| Tier | Coverage |
|------|----------|
| A | `ensureTermsAccepted`: no prior acceptance → prompts, Accept persists `TERMS_VERSION` + a timestamp and returns `true`; Decline/dismissal returns `false` with no state written; prior acceptance at the current version → no prompt, returns `true` immediately; prior acceptance at an older/different version → prompts again; a `readFile` failure fails closed (`false`, no globalState write, no prompt shown after the read error, flow-neutral error text); empty or whitespace-only terms content also fails closed without ever showing the modal; `resetTermsAcceptance` clears both keys so a subsequent call prompts again |
| B | None specific to this change |
| C (manual) | Full Extension Development Host flow for all three gated entry points (`Provide Token`, `Login with Browser`, the Setup Wizard) — first-time prompt, Decline cancels cleanly with no token stored, Accept proceeds, no re-prompt on a subsequent login, a `TERMS_VERSION` bump forces re-prompt even after prior acceptance; confirm the bundled `resources/legal/termsOfUse.txt` is present in a packaged `.vsix`; **run `reltio.resetTermsAcceptance`, then confirm each of Provide Token, Login with Browser, and Setup Wizard authentication all prompt again, and that a previously-active session no longer works without re-authenticating** |

The modal `showWarningMessage` prompt itself and the packaged-`.vsix` file-presence check are GUI/build-artifact concerns and stay Tier C.

## Open Questions

- **Legal clause wording** (see D10): `resources/legal/termsOfUse.txt` line 5 has an awkwardly-worded clause flagged by CodeRabbit. Needs the actual legal-approved replacement text before it's corrected — not fixed in this change.
