## Context

The extension currently authenticates via a manually-pasted Bearer token stored in an in-memory `TokenStore`. This token expires (typically after 1 hour) and the user must re-paste a fresh one each time. There is no persistence across restarts and no refresh mechanism.

The Reltio ecosystem already has a working browser-based OAuth login implementation in `reltio-matching-skills` (Python). It uses Reltio's Okta SSO at `https://auth.reltio.com/oauth/sso` with an Authorization Code grant, a local HTTP callback server on port 8081, and token exchange at `https://auth.reltio.com/oauth/token` using an OAuth client registered for interactive login (historically `reltio_ui` in internal tooling).

**Security gap (current code):** `src/api/oauthLogin.ts` defines `CLIENT_ID` and `CLIENT_SECRET` as compile-time constants. Anyone with the repository or packaged VSIX can extract the client secret. That is acceptable for a private reference script but **not** for a distributable IDE extension.

## Goals / Non-Goals

**Goals:**
- Let users authenticate by clicking "Login with Browser" in the sidebar — no manual token copy-paste.
- Store the refresh token in VS Code's `SecretStorage` so logins survive extension restarts.
- Silently refresh the access token on 401 without interrupting the user's workflow.
- Keep the existing "Provide Token" command as a fully supported alternative.
- **Let users supply OAuth client ID and client secret once via the tree, stored only in Secret Storage.**
- **Never bundle or hardcode client secrets in extension source or artifacts.**
- **After successful localhost callback, guide the user back to VS Code/Cursor** via an improved browser page and an in-editor notification (without requiring Reltio to allowlist a `vscode://` redirect).

**Non-Goals:**
- Support for non-Okta auth servers (e.g., `auth-stg` password grant) in this change — that is a separate internal-env concern.
- Building a custom webview for login (full browser handles Okta MFA, SSO cookies, etc.).
- PKCE — the `reltio_ui` client does not require it in the reference flow; adding PKCE would need server-side registration changes.
- Storing OAuth client credentials in `contributes.configuration` / `settings.json` (plain text on disk).
- **Replacing `localhost:8081` with a `vscode://` OAuth redirect** until Reltio/Okta allowlists an editor URI for the OAuth client (Postman-style native handoff).

## Decisions

### D1 — Authorization Code Grant via local HTTP server

**Choice:** Spin up a temporary `http.Server` (Node.js built-in) on localhost to receive the OAuth callback, then shut it down.

**Rationale:** VS Code extensions cannot register custom URI scheme handlers for the `localhost` redirect that Reltio's auth server already whitelists. A local server is the minimal, zero-dependency approach proven in the reference project.

**Alternative considered:** `vscode.env.asExternalUri` + custom URI scheme (`vscode://`) — requires the auth server to whitelist a `vscode://` redirect URI, which it currently does not.

**Port:** Try port 8081 first (matching the existing Reltio allowlist). If the port is busy, surface a clear error rather than failing silently.

### D2 — VS Code `SecretStorage` for refresh token persistence

**Choice:** Persist the refresh token in `context.secrets` (VS Code `ExtensionContext.secrets`), keyed by environment name. Access token stays in-memory only.

**Rationale:** Refresh tokens are long-lived secrets and should survive restarts (otherwise the browser flow only helps for the current session). `SecretStorage` is OS-native (Keychain / Credential Manager) and is the VS Code-recommended store for sensitive credentials. Access tokens are short-lived and don't need to be written to disk.

**Alternative considered:** Keep everything in-memory — avoids any OS storage but forces re-login on every restart, defeating the purpose.

### D3 — Extend `TokenStore` minimally; new `OAuthSession` object

**Choice:** Introduce an `OAuthSession` type (`{ accessToken, refreshToken, expiresAt }`) alongside the existing `TokenStore`. `TokenStore.setToken` continues to work as-is. Browser login uses `tokenStore.setSession()` which stores the access token in the existing token map and the refresh token in `SecretStorage`.

**Rationale:** Least-invasive change — the rest of the extension (API calls, tree nodes) continues to call `tokenStore.getToken()` without modification.

### D4 — Silent 401 refresh with one retry

**Choice:** Each API helper in `reltioClient.ts` that can fail with 401 catches the error, calls `tokenStore.tryRefreshToken(environmentName)`, and retries the request once. If the refresh also fails, propagates `ReltioApiError(401)`.

**Rationale:** This is the industry-standard pattern and matches the reference project. One retry prevents infinite loops.

**Alternative considered:** Centralized refresh interceptor wrapping all fetch calls — more elegant but requires more structural refactoring than the feature warrants.

### D5 — Browser opened via `vscode.env.openExternal`

**Choice:** Use the VS Code API rather than a Node.js `open` package.

**Rationale:** No new npm dependency; works correctly inside remote development scenarios (WSL, SSH, containers) by delegating to the host's browser.

### D6 — OAuth client ID and client secret in Secret Storage (amendment)

**Choice:** Add a dedicated tree command **`reltio.configureOAuthClient`** (title TBD, e.g. **"Configure OAuth Client…"**) on environment nodes, in the same `1_auth` context menu group as **Provide Token** and **Login with Browser**, ordered before browser login.

**Flow:**
1. User right-clicks an environment → **Configure OAuth Client…**
2. Extension prompts for **Client ID** (`showInputBox`, plain text).
3. Extension prompts for **Client secret** (`showInputBox` with `password: true`).
4. Both values are written to `context.secrets` via a small store (extend `SessionStore` or add `OAuthCredentialsStore`).
5. User runs **Login with Browser**; `oauthLogin.ts` loads credentials for that environment. If either value is missing, show an error that points to **Configure OAuth Client** (do not open the browser).

**Storage keys (per environment):**
- `reltio.oauth.{environmentName}.clientId`
- `reltio.oauth.{environmentName}.clientSecret`

**Rationale:** Per-environment keys align with refresh-token keys and allow different Reltio stacks or registered OAuth apps per host. The user configures "once" per environment before first browser login. Keys are not visible in Settings UI or `settings.json`.

**Alternative considered — installation-wide credentials:** Single pair of keys (`reltio.oauth.clientId` / `reltio.oauth.clientSecret`) shared by all environments. Simpler if every user uses the same Reltio UI client everywhere; choose this only if product confirms one global client is sufficient.

**Alternative considered — `contributes.configuration`:** Rejected; values would land in user/workspace JSON and are not encrypted by default.

**Alternative considered — hardcoded defaults with override:** Rejected; any bundled secret remains extractable from the VSIX.

**Implementation note:** `exchangeCodeForTokens` and `refreshTokens` continue to use HTTP Basic auth `base64(clientId:clientSecret)`; only the source of those strings changes.

### D7 — No credential fallback in production paths

**Choice:** If Secret Storage has no client credentials for an environment, **Login with Browser** and silent refresh that needs client auth MUST fail fast with a clear message. No compile-time `CLIENT_ID` / `CLIENT_SECRET` fallback.

**Rationale:** A fallback would preserve the vulnerability. Developers may use **Provide Token** for headless/manual auth without OAuth client setup.

### D8 — Post-login return to editor (short term; keep localhost:8081)

**Choice:** Do **not** change the OAuth `redirect_uri` registered with Reltio. Continue using `http://localhost:8081`. After the callback server receives `?code=...`, respond with **enhanced HTML** and show a **VS Code information notification** when token exchange completes.

**Callback HTML (served once per successful login):** — revised by RP-190109
- Reltio logo on the left, message block on the right (flex row, centered in the viewport).
- Heading: **Login Successful!**
- Text: "You are signed into Reltio IDE. You can now close this browser tab."
- Logo is `resources/icons/reltio-icon.png` inlined as a base64 data URI in `RELTIO_LOGO_DATA_URI`. It cannot be a file reference: `startCallbackServer()` calls `server.close()` right after writing its one response, so a second request for an image would be refused.
- No `vscode://` / `cursor://` deep links. See D8.1.

**In-editor notification (extension, after successful `exchangeCodeForTokens`):**
- Keep or refine the existing success toast (e.g. `Logged in to "{environmentName}".`).
- Add explicit copy: login complete in the browser; you may close the tab and continue in the editor.
- Do **not** require the user to click the browser link for auth to work — tokens are already stored when the notification appears.

**Rationale:** Reltio already allowlists `localhost:8081`. Token capture does not depend on refocusing the IDE. Postman-like auto-focus requires `vscode://` on the auth server allowlist (D1 alternative); until then, HTML + notification is the lowest-risk UX improvement.

**Alternative considered — `registerUriHandler` only:** Rejected as primary flow without server allowlist; can be revisited when Reltio adds `vscode://` redirect support.

### D8.1 — Drop the editor deep links from the callback page (RP-190109)

**Choice:** Remove the **Open in VS Code** / **Open in Cursor** links, the fallback note beneath them, and the now-unused `VSCODE_FOCUS_URI` / `CURSOR_FOCUS_URI` constants. The callback page is reduced to logo + confirmation message.

**Rationale:** The links never redirected anyone automatically — they required a click, and browsers frequently refuse to hand `vscode://` / `cursor://` off from a localhost page (the page carried its own "if the links do not switch apps" hedge, which is a tell). Authentication is entirely independent of them: the extension host has already exchanged the code and fired `showInformationMessage` by the time the page renders, so the only thing lost is an unreliable convenience shortcut. Keeping them would also contradict the new copy, which tells the user to close the tab.

**Trade-off:** Users lose one-click app switching and must alt-tab back to the editor. Accepted — the in-editor success toast already tells them login worked.

### D9 — Shared OAuth client pair when only one exists in Secret Storage

**Choice:** Resolve credentials for an environment as:

1. That environment’s own stored client ID + secret, if present; else  
2. The single distinct pair stored anywhere in the workspace, if exactly **one** unique pair exists across all environments; else  
3. No credentials → **Login with Browser** is unavailable for that environment.

**Tree / menu:** Environment `contextValue` includes `.oauthReady` only when resolution succeeds; otherwise `.oauthBlocked` (unauthorized) with description *Configure OAuth client (or one shared pair)*. The **Login with Browser** context menu entry uses `when: viewItem =~ /reltio\.environment\..*\.oauthReady$/` so the command is hidden (not merely disabled) when blocked.

**Rationale:** Internal users often use one Reltio UI OAuth client for every host; storing it once should not force re-entry per environment. Multiple tenants/environments with different registered clients must not accidentally share the wrong pair.

## Risks / Trade-offs

- **Port 8081 already in use** → User sees "OAuth callback port 8081 is unavailable. Close the application using that port and try again." Command aborts cleanly; no token stored. _Mitigation_: clear user-facing error message with the port number.
- **User closes browser without logging in** → Local server times out after 120 seconds and the command resolves with no token. _Mitigation_: progress notification shown during the wait; auto-dismissed on success or timeout.
- **Refresh token revoked server-side** → Refresh attempt returns 401; extension clears the stored session and prompts the user to log in again via notification. _Mitigation_: `tokenStore.clearSession()` wipes both in-memory and `SecretStorage`; tree node reverts to unauthorized state.
- **`SecretStorage` unavailable** (rare edge case in some remote environments) → Fall back to in-memory only with a one-time warning for **session** tokens; OAuth client credentials cannot be persisted — browser login should warn that credentials will not survive reload. _Mitigation_: document remote-dev limitations.
- **User misconfigures client ID/secret** → Token exchange returns 400/401. _Mitigation_: surface Reltio error body where possible; offer **Configure OAuth Client** again.
- **Secrets lost on machine migration** → User re-runs **Configure OAuth Client** and **Login with Browser**. _Mitigation_: document in OAuth security guide.
- **User does not notice login finished** → the callback page no longer offers an app-switch link (D8.1), so the user must return to the editor themselves. _Mitigation_: the `Waiting for browser login…` progress notification resolves into a `Logged in to "{env}"` toast, and the success page explicitly says to close the tab.
- **Inlined logo drifts from the shipped icon** → `RELTIO_LOGO_DATA_URI` is a copy of `resources/icons/reltio-icon.png`, so replacing the icon file alone would leave the callback page stale. _Mitigation_: `test-browser-oauth-login.cjs` re-encodes the PNG at runtime and asserts the constant still matches, so the gate fails on drift.

## Migration Plan

No migration required for existing manual token users. For browser login:

1. Ship **Configure OAuth Client** before or together with removing hardcoded secrets.
2. Document that users must run **Configure OAuth Client** once per environment (first time).
3. Remove `CLIENT_ID` / `CLIENT_SECRET` constants from `oauthLogin.ts` in the same release as the new command.
4. Optional: on first **Login with Browser** without credentials, offer a single notification with a button/command to open **Configure OAuth Client**.

Users who installed a build with embedded secrets should rotate the client secret on the Reltio/Okta side if that secret was ever considered confidential.

## Test plan

### Tier A — automated (`scripts/test-browser-oauth-login.cjs`)

- Credential resolve matrix, `buildAuthorizationUrl`, `TokenStore` aliases (existing).
- **RP-190109 callback success page** — `buildCallbackSuccessHtml()` is exported for this:
  - heading is exactly `Login Successful!`;
  - body copy is "You are signed into Reltio IDE. You can now close this browser tab.";
  - the `<img>` precedes the `<h1>` in document order (logo left, text right);
  - the inlined data URI equals a runtime re-encode of `resources/icons/reltio-icon.png` — self-oracle, no committed base64 expectation, and it fails the gate if the icon file and the constant drift apart;
  - no `vscode://` or `cursor://` substring survives anywhere in the page.

### Tier B — automated (none)

No integration tier: the callback server binds a real port and performs a live OAuth exchange, which is out of scope for the unit gate.

### Tier C — manual QA

1. **Login with Browser** on a configured environment → complete SSO → callback page shows the Reltio logo with **Login Successful!** and the message to its right; layout is centered and readable.
2. Confirm the page renders the logo with **no network access** (the data URI must not need a second request — the server has already closed).
3. Confirm the editor shows `Logged in to "{env}"` and the environment node flips to authorized, without touching the browser page.
4. Close the tab immediately → session still valid, tree still authorized.
5. Error paths unchanged: missing `code` → "No authorization code in callback URL."; bad `state` → CSRF message; 120 s idle → timeout.

## Open Questions

- **Per-environment vs global OAuth client keys:** Default in this design is per-environment. Confirm with product whether one installation-wide client is enough.
- **Clear credentials command:** Should we add **Clear OAuth Client** (and/or clear refresh token) on the same menu for support scenarios?
- **`login.reltio.com/tenant` flow** — still tracked in `pending-requirements.txt`; independent of where client credentials are stored.
- **`vscode://` redirect allowlist** — track with Reltio platform team if native “return to editor” without localhost HTML is desired long term.
