## ADDED Requirements

### Requirement: Access token is silently refreshed on 401
When any Reltio API call returns HTTP 401 and a refresh token exists for that environment, the extension SHALL attempt one silent token refresh and retry the original request without user intervention.

#### Scenario: API call fails with 401 and refresh succeeds
- **WHEN** a Reltio API call returns HTTP 401
- **AND** a refresh token is stored for that environment
- **THEN** the extension calls `https://auth.reltio.com/oauth/token` with `grant_type=refresh_token`
- **AND** on success, the new access token is stored in `TokenStore`
- **AND** the new refresh token (if returned) is updated in `SecretStorage`
- **AND** the original API request is retried exactly once with the new access token
- **AND** the user sees no interruption

#### Scenario: API call fails with 401 and refresh also fails
- **WHEN** a Reltio API call returns HTTP 401
- **AND** the subsequent refresh token request also fails (e.g., token revoked, network error)
- **THEN** the stored session is cleared from both `TokenStore` and `SecretStorage`
- **AND** the environment node reverts to the unauthorized state in the tree
- **AND** an error notification is shown: "Session expired. Please log in again."
- **AND** the original error is propagated to the caller

#### Scenario: API call fails with 401 but no refresh token exists
- **WHEN** a Reltio API call returns HTTP 401
- **AND** no refresh token is stored for that environment (e.g., user used manual "Provide Token")
- **THEN** the extension propagates `ReltioApiError(401)` immediately without attempting a refresh
- **AND** the existing 401 error handling behavior is preserved

### Requirement: Token refresh does not cause concurrent duplicate requests
When multiple API calls fail with 401 simultaneously, the extension SHALL serialize refresh attempts — only one refresh request is sent, and the others wait for it to complete.

#### Scenario: Concurrent 401 errors trigger a single refresh
- **WHEN** two or more API calls fail with 401 concurrently for the same environment
- **THEN** exactly one refresh token request is made to the auth server
- **AND** all waiting callers receive the same new access token once the refresh completes
