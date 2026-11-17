## MODIFIED Requirements

### Requirement: The tenant physical configuration is never persisted

The extension SHALL use the physical configuration response only to extract `rdmConfig` in memory, and SHALL NOT write it, or any part of it other than what appears in the fetched RDM configuration, to disk or to the workspace.

The **service URI** from `rdmConfig` MAY additionally be retained in memory for the lifetime of the session, so that a later lookup-value request need not rediscover it. No other part of the response SHALL be retained beyond the call, and the retained service URI SHALL NOT be written to disk.

#### Scenario: No physical configuration file is produced

- **WHEN** a fetch completes, whether it succeeds, finds no RDM, or fails
- **THEN** no file containing the tenant physical configuration SHALL exist in the workspace

#### Scenario: Only the service URI outlives the call

- **WHEN** a fetch has extracted `rdmConfig` from the physical configuration
- **THEN** the service URI MAY be held in memory for the session
- **AND** no other field of the physical configuration SHALL be retained after the call returns

#### Scenario: The retained service URI does not survive the session

- **WHEN** the extension host restarts
- **THEN** no service URI SHALL be recoverable from disk, and it SHALL be rediscovered from the tenant physical configuration when next needed
