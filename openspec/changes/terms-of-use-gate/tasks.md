## 1. Design

- [x] 1.1 Write design spec (`docs/superpowers/specs/2026-07-10-terms-of-usage-design.md`) and implementation plan (`docs/superpowers/plans/2026-07-10-terms-of-usage.md`)

## 2. Bundle the terms text

- [x] 2.1 Add `resources/legal/termsOfUse.txt` — plain-text Reltio IDE Terms of Use, packaged like any other `resources/**` asset (no `.vscodeignore` change needed)

## 3. `ensureTermsAccepted` gate module

- [x] 3.1 Add `src/ux/termsOfUse.ts`: `TERMS_VERSION` constant, `ensureTermsAccepted(context)` checking/persisting `reltio.termsAcceptedVersion` + `reltio.termsAcceptedAt` in `globalState`, modal `showWarningMessage` with Accept/Decline
- [x] 3.2 Switch the terms-text read from `fs.readFileSync` to `vscode.workspace.fs.readFile` + `TextDecoder`, and fail closed (error message, return `false`) if the read throws, instead of letting a read failure silently bypass the gate

## 4. Wire the gate into login entry points

- [x] 4.1 Gate `reltio.provideToken` and `reltio.loginWithBrowser` in `src/extension.ts` — `if (!(await ensureTermsAccepted(context))) return;` at the top of each handler, before any credential/token/network work
- [x] 4.2 Gate the Setup Wizard's auth sub-flow in `src/ux/setupWizard.ts`
- [x] 4.3 Move the wizard gate from the auth sub-step to the very start of `launchSetupWizard`, so the user is asked before investing time in earlier steps rather than partway through

## 5. Support/developer command

- [x] 5.1 Add `resetTermsAcceptance(context)` to `termsOfUse.ts` — clears both `globalState` keys
- [x] 5.2 Register `reltio.resetTermsAcceptance` command in `package.json` and `src/extension.ts`

## 6. Type-check and manual verification

- [x] 6.1 `npm run compile` clean after every task
- [x] 6.2 Manual Extension Development Host verification: first-time prompt on Provide Token, Decline cancels with no token stored, Accept proceeds, no re-prompt on subsequent logins, `TERMS_VERSION` bump forces re-prompt, Login with Browser and the Setup Wizard both gated the same way

## 7. OpenSpec artifacts and automated test coverage

- [x] 7.1 Add `openspec/changes/terms-of-use-gate/` (`proposal.md`, `design.md`, `tasks.md`, spec deltas for the new `terms-of-use-gate` capability and the modified `browser-oauth-login`/`setup-ux-redesign` capabilities), retroactively documenting this already-implemented change per this repo's CLAUDE.md rule that every feature branch needs OpenSpec artifacts
- [x] 7.2 Add `scripts/test-terms-of-use-gate.cjs` and register it in `scripts/run-unit-tests.cjs`, per the same rule's testing requirement — covers `ensureTermsAccepted` (no-prior-acceptance prompt/Accept/Decline, version-match skip, version-mismatch re-prompt, read-failure fail-closed) and `resetTermsAcceptance` at Tier A
- [x] 7.3 `npm test` passes

## 8. Bugfix round 1 — CodeRabbit PR review, PR #34 (4 actionable findings)

- [x] 8.1 `termsOfUse.ts`: reworded the read-failure error message to be flow-neutral ("Login cannot proceed" → "Authentication cannot proceed"), since the same gate also covers Setup Wizard authentication, not just explicit login (see design.md D8)
- [x] 8.2 `reltio.resetTermsAcceptance`: now also calls `tokenStore.clearAll()` and deletes every stored refresh token (`sessionStore.listEnvironments()` + `deleteRefreshToken`), then refreshes the tree/UX state — so Reset actually revokes active sessions instead of only clearing a cosmetic flag (see design.md D9)
- [x] 8.3 `resources/legal/termsOfUse.txt`'s malformed clause (line 5) intentionally left unfixed — needs actual legal-approved wording, not a guess; tracked as an Open Question in design.md (D10)
- [x] 8.4 Added the missing manual-verification step (this task list, item 6.2, and design.md's Test Plan): run `reltio.resetTermsAcceptance`, then confirm Provide Token, Login with Browser, and Setup Wizard authentication all prompt again, and that a previously-active session no longer works without re-authenticating
- [x] 8.5 `npm run compile` clean; updated `scripts/test-terms-of-use-gate.cjs` is unaffected (D8/D9 are extension.ts/manual-verification changes, not `termsOfUse.ts` API changes — no new Tier A surface)

## 9. Bugfix round 2 — CodeRabbit PR review, PR #41 full-repo review (7 findings)

- [x] 9.1 `termsOfUse.ts`: `ensureTermsAccepted` now rejects empty/whitespace-only terms content, routing it through the existing fail-closed error path instead of showing a blank modal (see design.md D11)
- [x] 9.2 `scripts/test-terms-of-use-gate.cjs`: removed a dead `showWarningMessage` stub left over from Round 1's edit, and added coverage for the new empty/whitespace-only content case (D11, D12)
- [x] 9.3 `openspec/.../proposal.md`: updated the `reltio.resetTermsAcceptance` bullet to state the session-revocation behavior added in Round 1 (D9), which Round 1 updated everywhere except this file (see design.md D13)
- [x] 9.4 `resources/legal/termsOfUse.txt`'s malformed clause re-flagged by this review — still intentionally left unfixed, same reasoning as 8.3/D10
- [x] 9.5 Updated the historical `docs/superpowers/specs/2026-07-10-terms-of-usage-design.md` (Testing section no longer claims "no test runner") and `docs/superpowers/plans/2026-07-10-terms-of-usage.md` (Task 2 pseudocode now matches the shipped fail-closed `vscode.workspace.fs.readFile` approach; Goal line now names all three gated entry points including the Setup Wizard) — see design.md D14 for why these were corrected rather than left as a frozen snapshot, unlike the cosmetic heading-level nit on the `git-repository-source` change
- [x] 9.6 `npm run compile` and `npm test` pass
