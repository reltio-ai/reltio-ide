# Browser OAuth login

## Setup (OAuth client credentials)

1. Right-click an environment in the **Reltio** tree → **Configure OAuth Client…**
2. Enter the OAuth **client ID** and **client secret** from your Reltio/Okta app registration.
3. Credentials are stored in VS Code **Secret Storage** (OS keychain). They are not saved in `settings.json` or shipped with the extension.

### Sharing one pair across environments

- If **only one distinct** client ID + secret pair exists in Secret Storage (typically configured on a single environment), **Login with Browser** is available on **all** environments and that pair is reused.
- If **no** credentials are stored, or **two or more different** pairs are stored for different environments, **Login with Browser** is hidden for environments that do not have their own credentials (tree shows *Configure OAuth client (or one shared pair)*).

## Login

1. **Login with Browser** on the same environment node.
2. Complete SSO in the browser; you are redirected to `http://localhost:8081`.
3. The callback page shows the Reltio logo and **Login Successful!** — it is informational only.
4. An editor notification confirms login; you may close the browser tab.

The callback page has no links: nothing there is needed for authentication. By the time it renders, the extension has already exchanged the code and stored the session, so switch back to the editor whenever you like.

## Security

- Do not commit client secrets to the repository.
- OAuth client credentials and refresh tokens use `ExtensionContext.secrets` only.
- Access tokens stay in memory until the window reloads.

## Redirect URI

Reltio must allow `http://localhost:8081` as the OAuth redirect URI for your client. A native `vscode://` redirect (Postman-style) requires additional allowlisting by Reltio and is not used today.
