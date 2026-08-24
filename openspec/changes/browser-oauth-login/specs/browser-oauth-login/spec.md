## ADDED Requirements

### Requirement: User can configure OAuth client credentials from the environment tree
The extension SHALL provide a **Configure OAuth Client** command on each environment node in the Reltio sidebar tree. The command SHALL prompt the user for an OAuth **client ID** and **client secret** and persist both in VS Code **Secret Storage**, keyed by environment name. Credentials SHALL NOT be stored in extension source, `settings.json`, or workspace files.

#### Scenario: User saves OAuth client credentials
- **WHEN** the user right-clicks an environment node and selects **Configure OAuth Client**
- **THEN** the extension prompts for client ID (plain input) and client secret (password input)
- **AND** both values are stored in `ExtensionContext.secrets` for that environment
- **AND** the extension confirms success without displaying the client secret again

#### Scenario: User can update credentials
- **WHEN** the user runs **Configure OAuth Client** again for the same environment
- **THEN** new values replace the previous Secret Storage entries for that environment

### Requirement: Single shared OAuth client pair is reused across environments
When exactly one distinct client ID + client secret pair is stored across all environments in the workspace, the extension SHALL treat that pair as available for browser login and token refresh on every environment, including environments that did not store their own copy.

#### Scenario: One pair configured on a single environment
- **WHEN** OAuth client credentials exist only for environment `A`
- **AND** no other environment has stored credentials
- **THEN** **Login with Browser** is available on environment `A` and on every other environment in the tree
- **AND** login on environment `B` uses the same client ID and secret as stored for `A`

#### Scenario: Multiple distinct pairs configured
- **WHEN** environment `A` and environment `B` each have stored credentials and the pairs differ
- **THEN** **Login with Browser** is available only on environments that have their own stored credentials
- **AND** environment `C` without stored credentials does not show **Login with Browser** in the context menu

#### Scenario: No credentials configured anywhere
- **WHEN** no environment has OAuth client credentials in Secret Storage
- **THEN** **Login with Browser** is not shown for any environment node
- **AND** unauthorized environment nodes indicate that OAuth client configuration is required

### Requirement: Browser login uses stored OAuth client credentials only
The extension SHALL NOT ship or fall back to hardcoded OAuth client secrets. **Login with Browser** and token refresh SHALL read client ID and client secret from Secret Storage for the target environment.

#### Scenario: Login blocked when credentials are not configured
- **WHEN** the user selects **Login with Browser** for an environment with no stored client credentials
- **THEN** the extension shows an error explaining that OAuth client credentials must be configured first
- **AND** the browser is not opened
- **AND** no token is stored

### Requirement: User can initiate browser-based login from environment node
The extension SHALL provide a **Login with Browser** command on each environment node in the Reltio sidebar tree. When invoked, it SHALL open the user's default browser to the Reltio Okta SSO authorization URL (using the configured **client ID**) and wait up to 120 seconds for the OAuth callback.

#### Scenario: Successful browser login
- **WHEN** the user right-clicks an environment node and selects **Login with Browser**
- **AND** OAuth client credentials exist in Secret Storage for that environment
- **THEN** the user's default browser opens to `https://auth.reltio.com/oauth/sso` with `response_type=code`, `client_id` set to the configured client ID, and `redirect_uri=http://localhost:8081`
- **AND** a VS Code progress notification is displayed while waiting for the callback

#### Scenario: Callback received and token exchanged
- **WHEN** the user completes Okta login in the browser and is redirected to `http://localhost:8081?code=<auth_code>`
- **THEN** the extension exchanges the authorization code for an access token and refresh token at `https://auth.reltio.com/oauth/token` using Basic authentication with the configured client ID and client secret
- **AND** the access token is stored in `TokenStore` for the environment
- **AND** the refresh token is persisted in VS Code `SecretStorage` keyed by environment name
- **AND** the environment node in the tree refreshes to show the authorized state

### Requirement: Post-login UX guides the user back to the editor (localhost callback; no Reltio redirect change)
The extension SHALL keep `redirect_uri=http://localhost:8081` and SHALL NOT require a `vscode://` or `cursor://` redirect URI on the Reltio auth server for this capability. After a successful OAuth callback, the extension SHALL improve UX so the user knows authentication finished and may return to VS Code or Cursor.

#### Scenario: Enhanced callback page after successful login
- **WHEN** the local callback server receives `GET /?code=<auth_code>` on port 8081
- **THEN** the HTTP response body is an HTML page (not plain text only) that states login succeeded
- **AND** the page renders the Reltio logo with the confirmation text to the **right** of the logo
- **AND** the heading reads **Login Successful!**
- **AND** the body text reads "You are signed into Reltio IDE. You can now close this browser tab."
- **AND** the logo is embedded in the same HTML payload as a data URI, because the callback server closes immediately after its single response and cannot serve a follow-up image request
- **AND** the page does NOT include `vscode://` or `cursor://` deep links

#### Scenario: In-editor notification after successful browser login
- **WHEN** token exchange completes successfully after **Login with Browser**
- **THEN** the extension shows an information notification that login succeeded for that environment
- **AND** the notification tells the user they may close the browser tab and continue working in the editor
- **AND** the user does not need to click the callback page link for tokens to be stored or for the environment to show as authorized

#### Scenario: Callback page is informational only
- **WHEN** the user closes the browser tab immediately after the success page appears
- **AND** token exchange already completed
- **THEN** the session remains valid in the extension (access token in memory, refresh token in Secret Storage if applicable)
- **AND** the environment node shows the authorized state

#### Scenario: Login times out
- **WHEN** 120 seconds elapse without receiving the OAuth callback
- **THEN** the local callback server is shut down
- **AND** an error notification is shown: "Login timed out. Please try again."
- **AND** no token is stored

#### Scenario: Port 8081 is unavailable
- **WHEN** **Login with Browser** is invoked but port 8081 is already in use
- **THEN** an error notification is shown: "OAuth callback port 8081 is unavailable. Close the application using that port and try again."
- **AND** no browser is opened

#### Scenario: User cancels or closes the browser without logging in
- **WHEN** the user closes the browser tab before completing login and no callback arrives within 120 seconds
- **THEN** the timeout path is followed (same as login times out scenario)

### Requirement: Existing "Provide Token" command is unchanged
The extension SHALL continue to offer the manual **Provide Token** command alongside **Configure OAuth Client** and **Login with Browser**. All auth commands SHALL appear in the environment node context menu under the `1_auth` group.

#### Scenario: Manual token entry still works after the feature is added
- **WHEN** the user right-clicks an environment node and selects **Provide Token**
- **THEN** the password input box is shown as before
- **AND** the entered token is stored in `TokenStore` exactly as it was before this change
- **AND** no OAuth client credentials are required for manual token entry

### Requirement: Stored refresh token is loaded on extension activation
The extension SHALL check `SecretStorage` on activation for each known environment and pre-populate `TokenStore` if a valid session exists, so users do not need to log in again after restarting VS Code. Silent refresh on activation SHALL use the stored OAuth client credentials for that environment; if credentials are missing, the stored refresh token SHALL be cleared and no refresh attempted.

#### Scenario: Refresh token found on startup
- **WHEN** the extension activates and a refresh token exists in `SecretStorage` for a known environment
- **AND** OAuth client credentials exist for that environment
- **THEN** the extension attempts a silent token refresh at `https://auth.reltio.com/oauth/token`
- **AND** on success, the new access token is stored in `TokenStore` and the environment node shows as authorized
- **AND** on failure (e.g., refresh token revoked), the stored session is cleared and the node shows as unauthorized

#### Scenario: Refresh token present but OAuth client credentials missing on startup
- **WHEN** the extension activates and a refresh token exists but client credentials do not
- **THEN** the extension clears the stored refresh token for that environment
- **AND** the environment node shows as unauthorized until the user configures credentials and logs in again
