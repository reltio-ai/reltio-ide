## Why

The current token-based authentication requires users to manually obtain and paste a Bearer token, which expires silently and forces repeated manual intervention. A browser-based OAuth login flow would eliminate this friction and bring the plugin in line with how users already authenticate to Reltio (via Okta SSO at `auth.reltio.com`).

**Security follow-up:** The initial implementation hardcodes OAuth `client_id` and `client_secret` in `src/api/oauthLogin.ts`. That embeds a shared secret in the extension bundle (visible to anyone with the VSIX or repo) and violates least-privilege. Credentials must be supplied by the user and stored in VS Code **Secret Storage**, not in source or `settings.json`.

## What Changes

- Add a **"Login with Browser"** right-click command on environment nodes in the Reltio sidebar that opens the Reltio Okta SSO login page in the user's default browser.
- Implement a short-lived local HTTP server that captures the OAuth authorization code from the redirect callback (`http://localhost:8081`).
- Exchange the authorization code for an access token + refresh token at `https://auth.reltio.com/oauth/token`.
- Extend `TokenStore` to hold refresh tokens alongside access tokens and surface a `refreshAccessToken()` method.
- Implement silent background token refresh: when an API call receives a 401, attempt one token refresh and retry before surfacing an error to the user.
- Retain the existing **"Provide Token"** command for manual / headless scenarios — it remains unchanged and fully supported.

### Amendment — user-provided OAuth client credentials (not yet implemented)

- Add a separate tree action **"Configure OAuth Client…"** (or equivalent title) on environment nodes in the `1_auth` group, distinct from **Login with Browser** and **Provide Token**.
- Prompt the user once per environment (or once per installation — see design) for **client ID** and **client secret** via secure input (secret field for the client secret).
- Persist both values in VS Code **`ExtensionContext.secrets`** (Secret Storage), never in `package.json`, workspace `settings.json`, or committed files.
- **Login with Browser** SHALL read credentials from Secret Storage at runtime; if missing, guide the user to run **Configure OAuth Client** first (no hardcoded fallback).
- Remove hardcoded `CLIENT_ID` / `CLIENT_SECRET` constants from `oauthLogin.ts` once the above is implemented.

### Amendment — return to editor after login (short term, no Reltio redirect change)

Keep the existing **`http://localhost:8081`** OAuth callback (no new `vscode://` / `cursor://` redirect URI on the Reltio auth server). Improve post-login UX so users know they can return to the IDE:

- **Enhanced callback HTML** served by the local callback server: clear success message, instruction to return to the editor, and an optional **“Open in VS Code / Cursor”** link (e.g. `vscode://` or `cursor://` deep link) that may focus the host app when the OS registers the handler (best-effort; not required for token exchange).
- **In-editor notification** when the authorization code is received and token exchange succeeds: confirm login for the environment and remind the user they may close the browser tab.

A future **Postman-style** flow (`vscode://` redirect allowlisted by Reltio) remains out of scope until the identity provider supports it (see design).

### Amendment — shared OAuth client pair across environments

- If **exactly one** distinct client ID + secret pair exists in Secret Storage (e.g. configured on one environment only), **reuse** it for browser login and token refresh on **all** environments.
- If **zero** pairs or **two or more** distinct pairs exist, environments **without** their own stored credentials cannot use **Login with Browser** (command hidden; tree shows blocked state).

## Capabilities

### New Capabilities

- `browser-oauth-login`: Browser-based Reltio Okta SSO login flow initiated from the environment tree node, including local callback server, auth code → token exchange, refresh token persistence, **user-configured OAuth client credentials in Secret Storage**, and **post-login callback page + in-editor notification** to guide the user back to the IDE.
- `token-auto-refresh`: Automatic silent access token refresh using a stored refresh token when a 401 is detected during any Reltio API call.

### Modified Capabilities

- `browser-oauth-login` (requirements): OAuth client ID and client secret are user-supplied and stored in Secret Storage; authorization and token exchange use those values only.

## Impact

- **`src/api/tokenStore.ts`** — Extended to store refresh tokens and expiry, with `refreshAccessToken()` logic.
- **`src/api/oauthLogin.ts`** — Local callback server, browser open, auth code exchange, **richer callback HTML**; **must not ship hardcoded client secrets** after the credentials amendment.
- **`src/api/sessionStore.ts`** (or new **`oauthCredentialsStore.ts`**) — Secret Storage keys for OAuth client ID and client secret.
- **`src/api/reltioClient.ts`** — 401 handling updated to attempt silent refresh before propagating `ReltioApiError`.
- **`src/extension.ts`** — `reltio.loginWithBrowser`, **`reltio.configureOAuthClient`** (name TBD), and post-login success notification.
- **`package.json`** — Command declarations + context menu entries in `1_auth` group.
- **`docs/`** (OAuth / security guide) — Document credentials storage, localhost vs `vscode://` redirect, and optional editor deep links on the callback page.
- **Dependencies** — No new npm packages required; uses Node.js built-in `http` module and VS Code's `vscode.env.openExternal`.
