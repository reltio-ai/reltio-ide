## MODIFIED Requirements

### Requirement: Each RDM configuration is written with a baseline twin

Every successful RDM write SHALL be accompanied by a baseline file `RDM.{rdmTenantId}.remote-baseline.reltio.json` in the same folder, holding content identical to the configuration file, recording the server copy at the moment of that fetch.

The baseline serves two purposes: warning before a re-fetch overwrites local edits, and acting as the drift oracle for **Apply RDM Configuration**. A successful Apply SHALL also refresh it, since the pushed content is then what the server holds.

#### Scenario: Baseline written alongside the configuration

- **WHEN** an RDM configuration for tenant id `JpfbluZcdHoQows` is written successfully
- **THEN** `RDM.JpfbluZcdHoQows.remote-baseline.reltio.json` SHALL be written in the same folder with identical content

#### Scenario: Baseline replaced on every successful re-fetch

- **WHEN** a subsequent fetch for the same RDM tenant succeeds
- **THEN** both the configuration file and its baseline SHALL be replaced with the newly fetched content

#### Scenario: No baseline written when the fetch fails

- **WHEN** the RDM request for a given RDM tenant fails
- **THEN** neither that tenant's configuration file nor its baseline SHALL be modified

#### Scenario: Baseline refreshed after a successful apply

- **WHEN** Apply RDM Configuration completes successfully for an RDM tenant
- **THEN** that tenant's baseline SHALL be replaced with the content that was pushed
- **AND** the configuration file itself SHALL be left as the user wrote it
