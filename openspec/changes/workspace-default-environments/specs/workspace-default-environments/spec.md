## ADDED Requirements

### Requirement: Workspace default environments setting

The extension SHALL support a workspace configuration property `reltio.defaultEnvironments` describing zero or more default Reltio environments to seed in the workspace.

Each entry SHALL include:

- `host` (string) — Reltio environment host name used for the `{host}.reltio.environment/` directory
- `tenantId` (string) — tenant identifier used for the `{tenantId}.reltio.tenant/` directory
- `tokenFile` (optional string) — workspace-relative path to a JSON file containing an `access_token` field

`host` and `tenantId` SHALL pass a canonical path-segment validator that rejects empty values, path separators, `..`, and traversal before any directories are created.

`tokenFile` SHALL be workspace-relative. Absolute paths and paths that escape the workspace root SHALL be rejected.

When more than one distinct `tokenFile` is configured for the same host, the extension SHALL report a conflict error and SHALL NOT load a token for that host.

The setting SHALL NOT define properties for embedding bearer tokens, refresh tokens, or OAuth client secrets. Documentation and the setting description SHALL state that secrets must live only in local token files or Secret Storage, never in settings.

#### Scenario: Scaffold folders from settings

- **WHEN** the user runs **Reltio: Apply default environments** (or apply-on-activate is enabled) and `reltio.defaultEnvironments` contains an entry with `host` and `tenantId`
- **THEN** the extension SHALL ensure the corresponding environment and tenant directories exist under `.reltio/` (or reuse a legacy root location if already present) using the existing naming convention

#### Scenario: Authenticate from token file path

- **WHEN** an entry includes `tokenFile` and that path resolves to a readable JSON object with a string `access_token`
- **THEN** the extension SHALL load that access token into the in-memory token store for that host using the same session semantics as **Provide Token**
- **AND** the extension SHALL NOT write the token into `settings.json` or any other git-tracked configuration file

#### Scenario: Load tokenFile at activation without applyDefaultsOnActivate

- **WHEN** the workspace is trusted, `reltio.defaultEnvironments` lists a valid `tokenFile`, and extension activation (or settings change) sets up token-file watchers
- **THEN** the extension SHALL read each unique token file once and fan out the bearer to all hosts bound to that file
- **AND** SHALL do so even when `reltio.applyDefaultsOnActivate` is false

#### Scenario: Missing or invalid token file

- **WHEN** `tokenFile` is set but the file is missing, unreadable, not JSON, or lacks `access_token`
- **THEN** the extension SHALL show an error that identifies the path
- **AND** SHALL still attempt to apply other default environment entries

#### Scenario: No inline secrets from settings

- **WHEN** a default-environment entry contains only host/tenant (and optional tokenFile path)
- **THEN** the extension SHALL treat that as valid configuration
- **WHEN** implementing or documenting this feature
- **THEN** the extension MUST NOT encourage or require placing token string values in settings

#### Scenario: Reject unsafe host or tenantId

- **WHEN** `host` or `tenantId` contains a path separator, `..`, or is empty after trim
- **THEN** the extension SHALL reject that entry without creating directories

#### Scenario: Reject absolute or escaping tokenFile

- **WHEN** `tokenFile` is absolute or resolves outside the workspace root
- **THEN** the extension SHALL reject that tokenFile and SHALL NOT read the file

#### Scenario: Conflicting tokenFiles for one host

- **WHEN** two or more entries for the same host specify different resolved `tokenFile` paths
- **THEN** the extension SHALL report a conflict for that host and SHALL NOT load a token for it

### Requirement: Apply defaults command and optional activation

The extension SHALL register a command **Reltio: Apply default environments** that applies `reltio.defaultEnvironments`.

The extension SHALL support an opt-in boolean setting (default `false`) to run that apply once during extension activation when a workspace folder is open.

Apply-on-activate and the apply command SHALL require a trusted workspace. Untrusted workspaces SHALL NOT read `tokenFile` or call configured hosts via this flow.

#### Scenario: Manual apply

- **WHEN** the user invokes **Reltio: Apply default environments** with a non-empty `reltio.defaultEnvironments` array
- **THEN** the extension SHALL scaffold and optionally authenticate per the requirements above
- **AND** SHALL refresh the Reltio tree so authorized state is visible

#### Scenario: Activation opt-in

- **WHEN** apply-on-activate is `false` (default)
- **THEN** activation SHALL NOT automatically scaffold folders or fetch L3 from default environments
- **AND** activation MAY still load tokens from configured `tokenFile` paths (see Load tokenFile at activation)
- **WHEN** apply-on-activate is `true`, a workspace folder is open, and the workspace is trusted
- **THEN** activation SHALL apply default environments exactly once without requiring the user to open the command palette
- **WHEN** the workspace is not trusted
- **THEN** activation SHALL NOT automatically apply default environments and SHALL NOT read `tokenFile`

### Requirement: No automatic apply-to-tenant

Applying default environments SHALL NOT automatically execute **Apply Configuration to Tenant** (live configuration PUT).

#### Scenario: Fetch remains separate or explicitly gated

- **WHEN** defaults are applied successfully
- **THEN** the extension SHALL NOT PUT local L3 to the tenant as part of that flow
- **AND** any automatic Fetch L3 behavior SHALL be disabled by default or explicitly gated by a separate setting
