## ADDED Requirements

### Requirement: Read-only inspection of a tenant's deployed workflows and JARs
The extension SHALL allow a user to list a tenant's deployed process definitions, list its registered custom JARs, and view one process definition's raw BPMN XML, using only GET requests against the Workflow Adapter, without deriving or guessing the adapter's base URL.

#### Scenario: Workflows folder starts unfetched
- **WHEN** a tenant row is expanded for the first time
- **THEN** a `Workflows` folder SHALL appear as a sibling of `Business Config`
- **AND** it SHALL show an unfetched state (no child rows, a "click to fetch" affordance) until the user explicitly runs Fetch Workflows

#### Scenario: First fetch prompts for the Workflow Adapter URL
- **WHEN** the user runs Fetch Workflows on a tenant with no persisted Workflow Adapter URL
- **THEN** the extension SHALL prompt for the URL
- **AND** SHALL NOT attempt any request to a guessed or derived URL beforehand

#### Scenario: URL is persisted per tenant
- **WHEN** the user supplies a Workflow Adapter URL that passes validation
- **THEN** the extension SHALL persist it to a sidecar file inside that tenant's directory
- **AND** SHALL NOT prompt again for that tenant on a subsequent session unless the user runs Edit Workflow Adapter URL

#### Scenario: Successful fetch populates two subfolders
- **WHEN** Fetch Workflows succeeds
- **THEN** the Workflows folder SHALL show `Process Definitions (N)` and `Custom JARs (N)` child folders
- **AND** each row SHALL reflect the API response without a write of any kind

#### Scenario: Viewing a process definition's BPMN
- **WHEN** the user opens a process definition row
- **THEN** the extension SHALL fetch and display its BPMN XML as a read-only document
- **AND** the document SHALL NOT be saveable back to the tenant or to a new file as part of this flow

#### Scenario: Reusing the existing session token
- **WHEN** any Workflow Adapter call is made
- **THEN** it SHALL use the same Bearer token already stored for that tenant's environment
- **AND** SHALL NOT prompt for a separate credential

#### Scenario: Workflow Adapter URL is subject to the same host allowlist as every other outbound call
- **WHEN** a user-supplied Workflow Adapter URL resolves to a host outside `reltio.trustedHostSuffixes`
- **THEN** the extension SHALL reject it before attaching any Authorization header, with the same error behavior already enforced for Reltio environment URLs

#### Scenario: Connection-level failure offers URL correction
- **WHEN** a Workflow Adapter call fails for a network-level reason (unreachable host, DNS failure, timeout)
- **THEN** the error notification SHALL offer an action to edit the persisted URL
- **AND** an HTTP-level error (401/403/etc.) SHALL NOT offer that same action, since the URL itself is not implicated
