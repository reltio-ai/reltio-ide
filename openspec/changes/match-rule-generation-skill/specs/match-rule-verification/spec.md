## ADDED Requirements

### Requirement: Agents can test a candidate match rule against the connected tenant
The extension SHALL answer a request written to `.reltio/reltio-agent/match-verification/request.json` by writing `result.json` in the same folder, echoing the request's `requestId`. For each record pair it SHALL call the read-only `_verifyMatches` API once, with the candidate match groups in the request body, using the session the extension already holds. It SHALL NOT create, merge or change entities, and SHALL NOT deploy.

#### Scenario: A signed-in tenant verifies every pair
- **WHEN** an agent requests verification of a candidate group with three pairs for a configuration file inside a connected, signed-in tenant
- **THEN** the result has status `verified`, names that tenant, and gives each pair an outcome and a verdict per candidate rule

#### Scenario: Nothing on the tenant changes
- **WHEN** verification runs
- **THEN** the only endpoint called is `_verifyMatches`

### Requirement: Identity comes from the extension, never the request
The request SHALL name only the configuration file. The extension SHALL resolve the environment and tenant from its own scan of the tenant markers, and SHALL ignore any environment or tenant the request carries. A configuration file outside the workspace SHALL be rejected.

#### Scenario: A request names its own target
- **WHEN** a request includes an `environment` or `tenant` that differs from the tenant its configuration file belongs to
- **THEN** the call goes to the tenant the file belongs to

#### Scenario: A path escapes the workspace
- **WHEN** `configFile` resolves outside the workspace folder
- **THEN** the result is `failed` with kind `invalid-request` and no call is made

### Requirement: Results separate "could not test" from "test failed"
A result SHALL be `not-verified` with a reason (`disabled`, `repository-mode`, `no-tenant`, `signed-out`) when live testing is impossible, and `failed` with a kind (`invalid-request`, `api-error`, `untrusted-host`, `network`) when it ran and failed. A `failed` result SHALL carry the HTTP status and server body where there is one, and the pairs completed before the failure.

#### Scenario: Repository mode
- **WHEN** the workspace was opened with Connect your Repository
- **THEN** the result is `not-verified` with reason `repository-mode`

#### Scenario: Expired session that cannot be refreshed
- **WHEN** the API answers 401 and the silent refresh fails
- **THEN** the result is `not-verified` with reason `signed-out`

#### Scenario: The tenant rejects the rule
- **WHEN** the API answers 400 on the second pair
- **THEN** the result is `failed` with kind `api-error`, status 400, the server's body and the first pair's result
- **AND** no further pairs are sent

### Requirement: A satisfied rule without a shared match token is reported as such
When a rule's logic is satisfied for a pair but the pair shares no match token, the pair's outcome SHALL be `no-shared-token`, distinct from `no-match`.

#### Scenario: Rule logic passes, tokens do not intersect
- **WHEN** `_verifyMatches` reports `matchedByDocuments: true` and `matched: false` for the candidate rule
- **THEN** the pair's outcome is `no-shared-token`

### Requirement: Verification can be turned off
`reltio.enableMatchVerification` (default `true`) SHALL, when `false`, make every request return `not-verified` with reason `disabled` without calling the tenant.

#### Scenario: Setting off
- **WHEN** the setting is `false` and an agent writes a request
- **THEN** the result is `not-verified` with reason `disabled`
