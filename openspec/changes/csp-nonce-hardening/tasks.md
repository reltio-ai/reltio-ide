# Tasks: csp-nonce-hardening

## 1. Code

- [x] 1.1 `src/ontology/ontologyPanel.ts`: import `crypto`; rewrite `getNonce()` to `return crypto.randomBytes(16).toString('hex');`.
- [x] 1.2 `src/entityBrowser/entityDetailPanel.ts`: import `crypto`; rewrite `getNonce()` to `return crypto.randomBytes(16).toString('hex');`.

## 2. Tests

- [x] 2.1 Create `scripts/test-csp-nonce-hardening.cjs`: source-inspect both files for the absence of `Math.random` and the presence of the `crypto.randomBytes(16).toString('hex')` call; separately assert the call's output shape (32-char lowercase hex, non-colliding across two calls).
- [x] 2.2 Register the new script in the `SCRIPTS` array in `scripts/run-unit-tests.cjs`, alphabetically.
- [x] 2.3 Run `npm test` and confirm every script passes, including pre-existing ones. Note: `test-skills-and-enablement-packs-library.cjs` fails on this checkout with a pre-existing, unrelated velocity-packs manifest byte-count mismatch (also seen and confirmed pre-existing in prior changes on `main`).

## 3. Verification

- [x] 3.1 `npm run compile` clean.
- [x] 3.2 `npm test` green (aside from the pre-existing unrelated failure noted in 2.3).
- [x] 3.3 `npm run build` clean (extension host and webview bundles both build).
- [ ] 3.4 Manual: open the Ontology preview and an Entity Detail panel, confirm both render normally (a malformed nonce would break the page's CSP). Needs a live session; not runnable from this environment.
- [x] 3.5 `npm run openspec -- validate --changes` clean for this change.

## 4. Pull request

- [x] 4.1 Commit on `RP-195046-csp-nonce-hardening`.
- [ ] 4.2 Open a PR referencing this OpenSpec change.
