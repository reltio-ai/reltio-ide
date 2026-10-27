## MODIFIED Requirements

### Requirement: Fetched RDM configuration is written to the tenant folder

On success the extension SHALL pretty-print the response and write it to `RDM/{rdmTenantId}/config.json` inside the tenant folder — the RDM component of the tenant's component tree — then refresh the configuration tree.

#### Scenario: File written and tree refreshed

- **WHEN** the RDM configuration for tenant id `JpfbluZcdHoQows` is fetched successfully for MDM tenant `71YnsNpkMRLfyRh`
- **THEN** the extension SHALL write `RDM/JpfbluZcdHoQows/config.json` inside that tenant's folder
- **AND** the tree view SHALL be refreshed so the tenant reflects the newly available RDM configuration

#### Scenario: Already-open document is reloaded

- **WHEN** the target file is already open in an editor at the time of a successful fetch
- **THEN** the extension SHALL revert that document so the editor shows the newly written content

#### Scenario: Unparsable response is written unchanged

- **WHEN** the response body cannot be parsed as JSON
- **THEN** the extension SHALL write the body unchanged rather than failing, consistent with how L3 responses are handled

### Requirement: RDM is fetched as part of Get Configuration

The RDM chain SHALL run after a successful Business Config write, wherever the extension writes one: the **Get Configuration** command (`reltio.fetchL3`), browser sign-in tenant auto-add, **Add Tenant**, the **Setup Wizard**, and **Apply default environments**. The extension SHALL NOT contribute a separate RDM fetch command or menu entry.

The chain SHALL be invoked beside the shared `writeL3FromApi` helper rather than inside it, so that Get Configuration's drift guard can still decide whether a fetch happens at all.

#### Scenario: One action fetches both configurations

- **WHEN** the user runs Get Configuration on a tenant that has RDM configured
- **THEN** the extension SHALL write the Business Config and then each RDM configuration, from that single action

#### Scenario: Connecting a tenant fetches RDM

- **WHEN** a tenant is connected by browser sign-in auto-add, **Add Tenant**, the **Setup Wizard** or **Apply default environments**, and its Business Config is written
- **THEN** the extension SHALL also fetch its RDM configuration

#### Scenario: No separate RDM command is contributed

- **WHEN** the user opens the tenant context menu or the command palette
- **THEN** no command dedicated to fetching RDM SHALL be offered

#### Scenario: Missing token reported before any request

- **WHEN** Get Configuration runs for an environment that has no stored token
- **THEN** the extension SHALL report that a token is required and SHALL NOT issue any request, for L3 or for RDM

### Requirement: Each RDM configuration is written with a baseline twin

Every successful RDM write SHALL be accompanied by a baseline file `.reltio-ide/RDM/{rdmTenantId}.baseline.json` inside the tenant folder, holding content identical to the configuration file, recording the server copy at the moment of that fetch. The baseline lives in the IDE working-state folder so that it is never part of the tracked tree.

The baseline serves two purposes: warning before a re-fetch overwrites local edits, and acting as the drift oracle for **Apply RDM Configuration**. A successful Apply SHALL also refresh it, since the pushed content is then what the server holds.

#### Scenario: Baseline written alongside the configuration

- **WHEN** an RDM configuration for tenant id `JpfbluZcdHoQows` is written successfully
- **THEN** `.reltio-ide/RDM/JpfbluZcdHoQows.baseline.json` SHALL be written with identical content

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
