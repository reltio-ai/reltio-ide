## 1. Extend TokenStore for sessions

- [x] 1.1 Add `OAuthSession` type (`{ accessToken: string; refreshToken: string; expiresAt: number }`) to `src/api/tokenStore.ts`
- [x] 1.2 Add `setSession(env, session)` method — stores access token in the existing token map, holds refresh token and expiry internally
- [x] 1.3 Add `getRefreshToken(env): string | undefined` method
- [x] 1.4 Add `clearSession(env)` method — removes access token, refresh token, and any alias
- [x] 1.5 Add `setRefreshInFlight(env, promise)` / `getRefreshInFlight(env)` to serialize concurrent refresh attempts (returns the shared promise if one is already running)

## 2. Implement OAuth login module

- [x] 2.1 Create `src/api/oauthLogin.ts` with constants: `AUTH_HOST`, `TOKEN_ENDPOINT`, `SSO_ENDPOINT`, `REDIRECT_PORT`, `REDIRECT_URI`, `SSO_TENANT_ID` (sourced from reference project)
- [x] 2.2 Implement `startCallbackServer(): Promise<{ server: http.Server; codePromise: Promise<string> }>` — binds to port 8081, resolves `codePromise` with the auth code on `GET /?code=...`, returns a simple "Done - you can close this tab." HTML response
- [x] 2.3 Implement `exchangeCodeForTokens(code): Promise<OAuthSession>` — POSTs to token endpoint with `grant_type=authorization_code`, Basic Auth using client ID and client secret, returns parsed `OAuthSession`
- [x] 2.4 Implement `refreshTokens(refreshToken): Promise<OAuthSession>` — POSTs with `grant_type=refresh_token`
- [x] 2.5 Implement `buildAuthorizationUrl(environmentBaseUrl): string` — constructs the SSO URL with all required query params
- [x] 2.6 Implement `runBrowserLogin(environmentBaseUrl): Promise<OAuthSession>` — orchestrates: start server → open browser via `vscode.env.openExternal` → race `codePromise` against a 120-second timeout → exchange code → shut down server → return session

> **Note:** Task 2.1 originally inlined `CLIENT_ID` / `CLIENT_SECRET` from the reference project. That is a security defect for a distributable extension; section **8** removes hardcoded values and sources credentials from Secret Storage instead.

## 3. Persist refresh tokens via SecretStorage

- [x] 3.1 Create `src/api/sessionStore.ts` — thin wrapper around `vscode.ExtensionContext.secrets` with `saveRefreshToken(env, token)`, `loadRefreshToken(env): Promise<string | undefined>`, `deleteRefreshToken(env)`, `listEnvironments(): Promise<string[]>`
- [x] 3.2 Pass `context.secrets` into `SessionStore` at extension activation in `src/extension.ts`

## 4. Register "Login with Browser" command

- [x] 4.1 Add `reltio.loginWithBrowser` command declaration to `package.json` (`title: "Login with Browser"`, `icon: "$(globe)"`)
- [x] 4.2 Add context menu entry to `package.json` in group `1_auth` with `when: "viewItem =~ /reltio\\.environment/"`, ordered after `provideToken`
- [x] 4.3 Register `reltio.loginWithBrowser` command handler in `src/extension.ts`:
  - Show VS Code progress notification ("Waiting for browser login…")
  - Call `runBrowserLogin(node.environmentName)`
  - On success: call `tokenStore.setSession()`, `sessionStore.saveRefreshToken()`, `treeProvider.refreshEnvironment()`
  - On port-busy error: show specific message
  - On timeout: show timeout message
  - On other error: show error message

## 5. Implement silent 401 refresh in API client

- [x] 5.1 Add `tryRefresh(env): Promise<boolean>` helper in `src/extension.ts` (or a shared module) — calls `refreshTokens()`, updates `tokenStore.setSession()` and `sessionStore.saveRefreshToken()`, returns true on success
- [x] 5.2 Wrap each API call in `reltioClient.ts` that can return 401 with a retry-on-401 helper: catch `ReltioApiError` with `statusCode === 401` → call `tryRefresh` → if true, retry once; if false, call `tokenStore.clearSession()` + `sessionStore.deleteRefreshToken()`, show "Session expired" notification, re-throw
- [x] 5.3 Use `tokenStore.getRefreshInFlight()` / `setRefreshInFlight()` to ensure concurrent 401s trigger only one refresh request

## 6. Restore session on activation

- [x] 6.1 In `src/extension.ts` activation, after scanning environments, call `sessionStore.loadRefreshToken(env)` for each known environment
- [x] 6.2 For each environment with a stored refresh token, call `refreshTokens()` silently — on success store new session; on failure call `sessionStore.deleteRefreshToken()`

## 7. Type-check and build

- [x] 7.1 Run `npm run compile` and fix all TypeScript errors
- [x] 7.2 Run `npm run build` and verify `dist/extension.js` builds cleanly
- [x] 7.3 Manual smoke test: F5 → add environment → "Login with Browser" → verify token stored → restart VS Code → verify session restored automatically

---

## 8. User-provided OAuth client credentials (security amendment)

- [x] 8.1 Add `src/api/oauthCredentialsStore.ts` (or extend `sessionStore.ts`) — `saveClientCredentials(env, { clientId, clientSecret })`, `loadClientCredentials(env)`, `deleteClientCredentials(env)`, `hasClientCredentials(env)` using `context.secrets` keys `reltio.oauth.{env}.clientId` and `reltio.oauth.{env}.clientSecret`
- [x] 8.2 Add `reltio.configureOAuthClient` to `package.json` (`title: "Configure OAuth Client…"`, icon e.g. `$(key)`) and context menu entry in group `1_auth` on `viewItem =~ /reltio\.environment/`, before **Login with Browser**
- [x] 8.3 Register command in `src/extension.ts`: prompt for client ID, then client secret (`password: true`), persist via credentials store, confirm with information message (do not echo secret)
- [x] 8.4 Refactor `oauthLogin.ts`: remove hardcoded `CLIENT_ID` / `CLIENT_SECRET`; pass `{ clientId, clientSecret }` into `buildAuthorizationUrl`, `exchangeCodeForTokens`, `refreshTokens`, and `runBrowserLogin`
- [x] 8.5 Update `reltio.loginWithBrowser` handler: load credentials for `node.environmentName` before `runBrowserLogin`; if missing, show error with action to run **Configure OAuth Client** (do not open browser)
- [x] 8.6 Update silent refresh path (`tryRefresh` / activation restore): load client credentials from Secret Storage before `refreshTokens()`; if missing, clear stale refresh token and skip refresh
- [x] 8.7 Update `openspec/changes/browser-oauth-login/specs/browser-oauth-login/spec.md` scenarios: no hardcoded `client_id=reltio_ui` in requirements; add configure-credentials and missing-credentials scenarios
- [x] 8.8 Update OAuth / security documentation (`docs/` or existing browser OAuth guide): where secrets are stored, per-environment setup, no bundled client secret, rotation if a secret was ever shipped in a build
- [x] 8.9 Run `npm run compile`, `npm run build`; manual test: configure client → login with browser → restart → session restore; test login without configure shows guided error

---

## 9. Post-login return to editor (short term; keep localhost:8081)

- [x] 9.1 Replace minimal callback HTML in `startCallbackServer()` (`oauthLogin.ts`) with a styled success page: success message, “close this tab”, optional **Open in VS Code** link (`vscode://reltio-community.reltio-metadata-editor`), optional **Open in Cursor** link (best-effort URI)
- [x] 9.2 Ensure callback HTML is returned only after a valid `code` query param is present; keep existing error/timeout behavior unchanged
- [x] 9.3 Update `reltio.loginWithBrowser` success path in `extension.ts`: information notification that login succeeded, environment name, and user may close the browser tab (complement optional browser deep link)
- [ ] 9.4 Manual test on macOS: complete browser login → confirm notification in editor → try optional VS Code/Cursor link from callback page → confirm tokens work even if link is not clicked
- [x] 9.5 Document in OAuth guide: localhost callback is required by Reltio; editor deep links are optional; full Postman-style redirect needs server allowlist change

---

## 10. Shared OAuth client pair + tree eligibility — **pending**

- [x] 10.1 Add `oauthCredentialsResolve.ts` with `resolveOAuthCredentials`, `canLoginWithBrowser`, unique-pair detection
- [x] 10.2 Use resolver in `loginWithBrowser`, `tryRefresh`, and activation restore
- [x] 10.3 Extend `EnvironmentNode` context (`oauthReady` / `oauthBlocked`) and hide **Login with Browser** via `package.json` `when`
- [x] 10.4 `MultiTenantTreeProvider.refreshBrowserLoginEligibility()` + refresh after configure credentials
- [x] 10.5 Update OpenSpec spec/design/proposal and `docs/browser-oauth-login.md`
- [ ] 10.6 Manual test: one env configured → all envs show login; two different pairs → only those envs; zero → none
