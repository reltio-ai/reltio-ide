## MODIFIED Requirements

### Requirement: Apply RDM Configuration pushes the configuration to the RDM service

**Apply RDM Configuration** SHALL be offered on the `{rdmTenantId}` row and SHALL send the local `RDM/{rdmTenantId}/config.json` to `PUT {serviceUri}/configuration/{rdmTenantId}` using the environment bearer token.

The request body SHALL be the document's text as saved, not a re-serialization of it, so that what is pushed is what the user sees.

#### Scenario: Offered on the RDM tenant row only

- **WHEN** the user opens the context menu on the `{rdmTenantId}` row
- **THEN** **Apply RDM Configuration** SHALL be offered

#### Scenario: Not offered elsewhere

- **WHEN** the user opens the context menu on the `RDM` group row, a section folder, an entry, or any L3 node
- **THEN** **Apply RDM Configuration** SHALL NOT be offered

#### Scenario: Unsaved edits are saved first

- **WHEN** the RDM document has unsaved changes at the moment Apply runs
- **THEN** it SHALL be saved before the request is built

### Requirement: A successful apply refreshes the baseline

On success the pushed content SHALL become the tenant's RDM baseline, so that a subsequent Apply compares against what was actually pushed.

#### Scenario: Baseline matches what was pushed

- **WHEN** the PUT succeeds
- **THEN** `.reltio-ide/RDM/{rdmTenantId}.baseline.json` SHALL be replaced with the pushed content

#### Scenario: Failed apply leaves the baseline alone

- **WHEN** the PUT fails
- **THEN** neither the configuration file nor its baseline SHALL be modified
