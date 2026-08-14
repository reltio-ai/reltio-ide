# Tasks: harden-reltio-client-base-url

## 1. Client change (`src/api/reltioClient.ts`)

- [x] 1.1 Add `export class UntrustedHostError extends Error` (name set in constructor), thrown instead of a bare `Error` so tests and future callers can distinguish it.
- [x] 1.2 Add module-level `let trustedHostSuffixes: string[] = ['reltio.com']`, `export function setTrustedHostSuffixes(suffixes: readonly string[]): void`, and a private `isTrustedHost(hostname: string): boolean` suffix matcher (design D3).
- [x] 1.3 Rewrite `toHttpsBase()`: force-upgrade an explicit `http://` scheme to `https://` (design D4); parse the resulting URL with `new URL()` to get the hostname (design D2); throw `UntrustedHostError` for a hostname that fails `isTrustedHost()` or for a `baseUrl` that does not parse as a URL at all; return the normalized string unchanged otherwise.
- [x] 1.4 Correct the `RELTIO_CLIENT_HEADER` comment per design D6 — genuine Reltio balancer-routing header, not placeholder naming, kept as-is.
- [x] 1.5 Introduce `const MAX_ERROR_BODY_CHARS = 12_000` and use it in `formatPutConfigurationFailureMessage()` in place of the magic number, with a one-line comment (design D7). No behavior change.
- [x] 1.6 Leave every other helper in the file (timeout handling, status-code branches, response validation) untouched.

## 2. Setting + wiring (`package.json`, `src/extension.ts`)

- [x] 2.1 Add `reltio.trustedHostSuffixes` under `contributes.configuration.properties` in `package.json`: `array` of `string`, default `["reltio.com"]`, description explaining it extends the host allowlist enforced by `toHttpsBase()`.
- [x] 2.2 In `extension.ts` activation, read the setting and call `setTrustedHostSuffixes()`; also subscribe to `vscode.workspace.onDidChangeConfiguration` and re-apply when `reltio.trustedHostSuffixes` changes.
- [x] 2.3 Confirm no call site needs its own try/catch changes — every existing site already catches `Error` and shows `(e as Error).message`, which now includes `UntrustedHostError`'s message.

## 3. Tests

- [x] 3.1 Create `scripts/test-harden-reltio-client-base-url.cjs` covering Tier A/B rows 1–7 of the design Test plan, following the stub-`fetch` pattern in `scripts/test-replace-tenants-with-enhanced-tenants.cjs`. No network access.
- [x] 3.2 Register the new script in the `SCRIPTS` array in `scripts/run-unit-tests.cjs`, alphabetically.
- [x] 3.3 Run `npm test` and confirm every script passes, including pre-existing ones (no regression from the `toHttpsBase()` change on already-trusted hosts used in other test fixtures). Note: `test-skills-and-enablement-packs-library.cjs` fails on this checkout with a velocity-packs manifest byte-count mismatch; confirmed pre-existing on `main` and unrelated to `resources/` or this change.

## 4. Docs

- [x] 4.1 Update the `src/api/` row in the `ARCHITECTURE.md` Package Structure table and the Network section to mention the host allowlist.
- [x] 4.2 Checked `README.md`/`docs/` for a settings list — none exists, so nothing to update.

## 5. Verification

- [x] 5.1 `npm run compile` clean.
- [x] 5.2 `npm test` green (aside from the pre-existing unrelated failure noted in 3.3).
- [x] 5.3 `npm run build` clean (extension host and webview bundles).
- [ ] 5.4 Work the Tier C manual QA table in `design.md`. Needs a live workspace/environment; not runnable from this session.
- [x] 5.5 `npm run openspec -- validate --changes` clean for this change.

## 6. Pull request

- [x] 6.1 Commit on `RP-195041-harden-reltio-client-base-url`. Verify no access token appears in any diff, fixture, or commit message.
- [ ] 6.2 Open a PR naming RP-195041 and this OpenSpec change.
