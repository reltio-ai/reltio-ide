## ADDED Requirements

### Requirement: Base URL resolution enforces a host allowlist and HTTPS
Before any Reltio API call attaches an `Authorization` header, the extension SHALL resolve the environment's base URL through a single function that rejects hosts outside an allowlist and forces the `https://` scheme.

#### Scenario: Trusted host is accepted
- **WHEN** an environment's stored host is `reltio.com` or a subdomain of it (e.g. `test.reltio.com`, `na-dev-1.cloud.reltio.com`)
- **THEN** the base URL resolves normally and the request proceeds

#### Scenario: Untrusted host is rejected before credentials are attached
- **WHEN** an environment's stored host does not match `reltio.com` or any suffix configured via `reltio.trustedHostSuffixes` (e.g. a workspace folder named `evil.com.reltio.environment`)
- **THEN** base URL resolution SHALL throw before any HTTP request is made
- **AND** no `Authorization` header SHALL be constructed or sent for that call

#### Scenario: Lookalike hosts are rejected
- **WHEN** the resolved host is a lookalike of an allowlisted suffix without being a true subdomain (e.g. `notreltio.com`, `reltio.com.evil.com`)
- **THEN** the host SHALL be rejected

#### Scenario: Explicit http:// is upgraded, not preserved
- **WHEN** an environment's stored host string begins with `http://`
- **THEN** the resolved base URL SHALL use `https://` instead
- **AND** the allowlist check SHALL apply to the resulting host exactly as it would for any other input

#### Scenario: Admin extends the allowlist
- **WHEN** the `reltio.trustedHostSuffixes` setting includes an additional suffix beyond the default `reltio.com`
- **THEN** hosts matching that suffix or its subdomains SHALL also be accepted

#### Scenario: Malformed base URL
- **WHEN** the stored host string does not parse as a valid URL once a scheme is applied
- **THEN** base URL resolution SHALL throw a clear error rather than sending a request to an unintended destination
