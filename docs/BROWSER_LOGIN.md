# Browser-based login

## Trigger

Right-click an environment in the **Reltio Tenants** tree and choose **Login with Browser**.

## One-time setup: Configure OAuth Client

Browser login requires a per-environment OAuth client to be configured first. Right-click an environment → **Configure OAuth Client…** and provide:

- **Client ID** — your Reltio OAuth client identifier.
- **Client secret** — your Reltio OAuth client secret. Stored in the OS keychain only.
- **SSO routing tenant ID** — the Reltio tenant whose external identity provider configuration should drive the login redirect. The default is Reltio's federated routing tenant; change it only if your organization runs a different SSO routing tenant.

The client ID and secret can be shared across environments when only one pair is stored. The SSO routing tenant ID is always per-environment.

## Step-by-step

1. **SSO check.** Before opening any browser tab, the extension POSTs to `https://auth.reltio.com/oauth/ssoCheck` with the configured tenant ID and client ID to confirm an external identity provider is configured for that tenant. If the response is `{"status":"native"}`, browser login is unavailable for the tenant and the extension shows a guided error pointing you at **Provide Token** for manual paste. If the response is `{"status":"sso"}`, the flow continues.

2. **CSRF state generated.** The extension generates a fresh 16-byte random `state` value (hex-encoded) per login attempt. It is held in memory only and verified on callback.

3. **Local callback server starts.** A tiny HTTP server binds to `http://localhost:8081` on the loopback interface only. If port 8081 is already in use, the flow aborts with a `PORT_BUSY` error — no fallback port. The server's only job is to receive a single OAuth redirect and then shut itself down.

4. **Browser opens the SSO URL.** The extension launches your default browser at:

   ```
   https://auth.reltio.com/oauth/sso?tenant_id=<sso_tenant>&response_type=code&client_id=<your-client-id>&redirect_uri=http://localhost:8081&state=<random-csrf-token>
   ```

   You authenticate against Reltio's identity provider in the browser, exactly as you would for the Reltio web UI. The extension never sees your username, password, MFA prompt, or any SSO identity-provider material — those stay entirely inside the browser.

5. **Browser redirects back to localhost.** On a successful login, the IdP redirects to `http://localhost:8081/?code=<one-time-code>&state=<state>`. The local server verifies the returned `state` matches the one generated in step 2 (`STATE_MISMATCH` error if not), captures the code, responds with a styled success page, and closes the listening socket. If no callback arrives within **120 seconds**, the flow aborts with a `TIMEOUT` error.

6. **Code is exchanged for tokens.** The extension makes a server-to-server `POST https://auth.reltio.com/oauth/token` from your local Node process (not from the browser), using:

   - `grant_type=authorization_code`
   - the one-time code
   - HTTP Basic Auth with the configured client ID and secret

   The response contains an **access token**, a **refresh token**, and an `expires_in` value. The extension converts `expires_in` to an absolute `expiresAt` timestamp.

7. **Tokens are stored.** See the security section below.

6. **The tree refreshes** and you see a "Logged in to *environment*" notification.

## Silent refresh

When any API call returns **401 Unauthorized**, the extension automatically:

1. Looks up the refresh token for that environment.
2. Posts to `https://auth.reltio.com/oauth/token` with `grant_type=refresh_token`.
3. Replaces the in-memory session and re-saves the (possibly rotated) refresh token.
4. Lets the next API call succeed transparently — no prompt is shown.

Concurrent 401s share a single in-flight refresh request, so a burst of failing calls produces exactly one network round-trip to the token endpoint. **Only if the refresh itself fails** does the extension wipe the session and show *"Session expired — log in again."*

## Session restore on activation

When Cursor / VS Code starts, the extension scans known environments. For every environment that has a refresh token in the OS keychain, it silently calls the token endpoint to mint a fresh access token. If that refresh fails (e.g., the refresh token was revoked server-side or has expired), the stored refresh token is deleted and you'll be prompted to log in again next time you hit the API.

---

## Where the tokens live — security summary

| Token | Storage | Persisted across restarts? | Visible on disk? |
|---|---|---|---|
| **Access token** | In-memory (per-environment map in the extension host process) | **No** — discarded when Cursor / VS Code closes | **No** |
| **Token expiry timestamp** | In-memory | No | No |
| **Refresh token** | **VS Code `SecretStorage`** (OS-managed keychain) **and** in-memory mirror for the running session | **Yes** — only the keychain copy survives | **Encrypted at rest by the OS** — never on disk in plaintext |

### What `SecretStorage` actually is

VS Code's `SecretStorage` delegates to the OS credential manager:

- **Windows:** DPAPI-protected entries in Windows Credential Manager (per-user, machine-bound).
- **macOS:** macOS Keychain.
- **Linux:** Secret Service (GNOME Keyring / KWallet via libsecret).

The extension never sees the raw on-disk bytes; it gets the cleartext refresh token back only after the OS decrypts it for the current user session.

### What is **not** stored anywhere

- Your password, MFA codes, or any IdP-side credentials — those stay inside the browser and are never seen by the extension.
- The access token — kept entirely in process memory and lost on every Cursor / VS Code shutdown.
- The Authorization Code returned to localhost — used once, then discarded.

### Other safeguards in the flow

- The OAuth callback server binds to `localhost` only, never `0.0.0.0`. Other machines on the network cannot reach it.
- The callback server accepts exactly one redirect and then closes its socket — there is no long-running listener.
- The flow times out after 120 seconds; an abandoned login can't leave a listener open indefinitely.
- Removing an environment from the tree also deletes its refresh token from the keychain — no orphaned secrets.
- If a refresh fails for any reason (token revoked, IdP outage, network error), the stored refresh token is deleted rather than retried indefinitely, so a compromised or revoked refresh token cannot be reused.

### What this means for plugin security posture

- A user who gains read access to your **disk** cannot recover working tokens: the access token isn't on disk, and the refresh token is encrypted by the OS for your user account only.
- A user who gains code execution as **your OS user** can read the refresh token via `SecretStorage`. That is the same trust boundary as VS Code itself and matches how the rest of the Reltio ecosystem (and other extensions) treat secrets.
- Plain workspace files (`*.reltio.json`, layout sidecars, history snapshots) never contain tokens. You can commit, share, or sync this workspace without leaking credentials.
