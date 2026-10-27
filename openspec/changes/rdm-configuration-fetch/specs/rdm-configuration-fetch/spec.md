## ADDED Requirements

### Requirement: RDM service and tenant are discovered from the tenant physical configuration

The extension SHALL discover the RDM service URI and RDM tenant identifiers by requesting the tenant physical configuration at `GET https://{environment}/reltio/tenants/{tenantId}` and reading the `rdmConfig` block. Both values vary per tenant and SHALL always be read from that response: the service URI SHALL NOT be constructed from the environment name, the RDM tenant id SHALL NOT be assumed equal to the MDM tenant id, and `ReltioBusinessModel.rdmTenantId` SHALL NOT be used as a discovery source since it is not reliably populated in L3 payloads.

#### Scenario: Service URI and tenant id extracted

- **WHEN** the physical configuration contains `rdmConfig.serviceUri` of `"https://rdm.reltio.com"` and `rdmConfig.rdmTenants` of `[{ "rdmTenantId": "JpfbluZcdHoQows" }]`
- **THEN** extraction SHALL yield service URI `"https://rdm.reltio.com"` and RDM tenant ids `["JpfbluZcdHoQows"]`

#### Scenario: Request carries the environment token and client header

- **WHEN** the physical configuration is requested
- **THEN** the request SHALL send `Authorization: Bearer {token}` using the token stored for that environment, and the `xxx-client` header, consistent with all other Reltio API calls in the extension

### Requirement: Extraction of rdmConfig is total over malformed and absent input

Extraction SHALL accept any parsed JSON value and return an empty result rather than throwing, so that a tenant without RDM, or an unexpected payload shape, cannot fail the command with an unhandled error.

#### Scenario: rdmConfig absent

- **WHEN** the physical configuration has no `rdmConfig` property
- **THEN** extraction SHALL yield no service URI and an empty list of RDM tenant ids

#### Scenario: serviceUri absent or empty

- **WHEN** `rdmConfig` is present but `serviceUri` is missing, `null`, or an empty string
- **THEN** extraction SHALL yield no service URI

#### Scenario: rdmTenants empty or absent

- **WHEN** `rdmConfig` is present but `rdmTenants` is missing or an empty array
- **THEN** extraction SHALL yield an empty list of RDM tenant ids

#### Scenario: Entries missing rdmTenantId are skipped

- **WHEN** `rdmTenants` contains a mix of entries with and without a non-empty string `rdmTenantId`
- **THEN** extraction SHALL yield only the ids of entries that have one, preserving their order

### Requirement: RDM configuration is fetched from the discovered service

The extension SHALL fetch each RDM configuration at `GET {serviceUri}/configuration/{rdmTenantId}`, using the same bearer token as the MDM environment, and SHALL return the response body as text so that formatting is applied once on write.

#### Scenario: Configuration requested at the documented path

- **WHEN** the discovered service URI is `"https://rdm.reltio.com"` and the RDM tenant id is `"JpfbluZcdHoQows"`
- **THEN** the request URL SHALL be `https://rdm.reltio.com/configuration/JpfbluZcdHoQows`

#### Scenario: Service URI without a scheme is normalized

- **WHEN** the discovered service URI has no `http://` or `https://` prefix
- **THEN** the request SHALL be made over `https://`, consistent with how environment base URLs are normalized

#### Scenario: Non-success response surfaces an API error

- **WHEN** the RDM service responds with a status other than success
- **THEN** the extension SHALL raise an error carrying that HTTP status code, in the same form as other Reltio API failures

### Requirement: Fetched RDM configuration is written to the tenant folder

On success the extension SHALL pretty-print the response and write it to `RDM.{rdmTenantId}.reltio.json` inside the `{tenantId}.reltio.tenant` folder, beside `L3.reltio.json`, then refresh the configuration tree.

#### Scenario: File written and tree refreshed

- **WHEN** the RDM configuration for tenant id `JpfbluZcdHoQows` is fetched successfully under environment `test-usg.reltio.com` and MDM tenant `71YnsNpkMRLfyRh`
- **THEN** the extension SHALL write `test-usg.reltio.com.reltio.environment/71YnsNpkMRLfyRh.reltio.tenant/RDM.JpfbluZcdHoQows.reltio.json`
- **AND** the tree view SHALL be refreshed so the tenant reflects the newly available RDM configuration

#### Scenario: Already-open document is reloaded

- **WHEN** the target file is already open in an editor at the time of a successful fetch
- **THEN** the extension SHALL revert that document so the editor shows the newly written content

#### Scenario: Unparsable response is written unchanged

- **WHEN** the response body cannot be parsed as JSON
- **THEN** the extension SHALL write the body unchanged rather than failing, consistent with how L3 responses are handled

### Requirement: Every RDM tenant of the MDM tenant is fetched

When `rdmTenants` lists more than one entry the extension SHALL fetch and write each one to its own file, so that no configured RDM tenant is silently omitted.

#### Scenario: Multiple RDM tenants each get a file

- **WHEN** `rdmTenants` lists `rdmTenantId` values `"AAA"` and `"BBB"`
- **THEN** the extension SHALL write both `RDM.AAA.reltio.json` and `RDM.BBB.reltio.json` into the tenant folder

### Requirement: Tenants without RDM are handled silently

Because the chain runs on every Get Configuration, a tenant whose physical configuration declares no usable RDM service or no RDM tenants SHALL produce no notification of any kind, and SHALL NOT be reported as a failure.

#### Scenario: No RDM configured

- **WHEN** Get Configuration runs against a tenant whose physical configuration has no `rdmConfig`, no `serviceUri`, or an empty `rdmTenants` array
- **THEN** no RDM file SHALL be written
- **AND** no modal, error, or informational notification SHALL be shown for the RDM step
- **AND** the L3 fetch SHALL be reported as successful exactly as it is today

### Requirement: The tenant physical configuration is never persisted

The extension SHALL use the physical configuration response only to extract `rdmConfig` in memory, and SHALL NOT write it, or any part of it other than what appears in the fetched RDM configuration, to disk or to the workspace.

#### Scenario: No physical configuration file is produced

- **WHEN** a fetch completes, whether it succeeds, finds no RDM, or fails
- **THEN** no file containing the tenant physical configuration SHALL exist in the workspace

### Requirement: RDM is fetched as part of Get Configuration

The RDM chain SHALL run as a continuation of the existing **Get Configuration** command (`reltio.fetchL3`), after that command has successfully written L3. The extension SHALL NOT contribute a separate RDM command or menu entry.

The chain SHALL be invoked from the command handler and NOT from the shared `writeL3FromApi` helper, so that the other callers of that helper — the post-SSO tenant auto-add and the apply-defaults flow — keep their current behavior.

#### Scenario: One action fetches both configurations

- **WHEN** the user runs Get Configuration on a tenant that has RDM configured
- **THEN** the extension SHALL write `L3.reltio.json` and then each RDM configuration, from that single action

#### Scenario: Login flow is unaffected

- **WHEN** a tenant is auto-added after a successful browser sign-in and its L3 is fetched by that flow
- **THEN** no RDM request SHALL be issued as part of that flow

#### Scenario: No separate RDM command is contributed

- **WHEN** the user opens the tenant context menu or the command palette
- **THEN** no command dedicated to fetching RDM SHALL be offered

#### Scenario: Missing token reported before any request

- **WHEN** Get Configuration runs for an environment that has no stored token
- **THEN** the extension SHALL report that a token is required and SHALL NOT issue any request, for L3 or for RDM

### Requirement: An RDM failure does not fail the L3 fetch

The two fetches SHALL be reported independently. A failure anywhere in the RDM chain SHALL leave a successfully written L3 in place and SHALL NOT present the command as having failed overall.

#### Scenario: RDM service unavailable after L3 succeeds

- **WHEN** L3 is written successfully and the physical-configuration or RDM request then fails
- **THEN** `L3.reltio.json` and its baseline SHALL remain written
- **AND** the extension SHALL surface the RDM failure on its own without discarding the L3 result

#### Scenario: L3 failure skips RDM entirely

- **WHEN** the L3 fetch fails
- **THEN** the extension SHALL NOT issue the tenant physical-configuration request

#### Scenario: One RDM tenant failing does not block the others

- **WHEN** several RDM tenants are configured and fetching one of them fails
- **THEN** the extension SHALL still write the configurations it fetched successfully

### Requirement: An expired session routes to the existing re-login flow

An unauthorized response from either request in the chain SHALL be handled by the extension's existing session-expiry handling for that environment, because the RDM service uses the same environment token.

#### Scenario: Unauthorized during discovery

- **WHEN** the tenant physical configuration request returns HTTP 401
- **THEN** the extension SHALL invoke the same session-expiry handling used by other unauthorized Reltio responses for that environment

#### Scenario: Unauthorized during RDM fetch

- **WHEN** the RDM configuration request returns HTTP 401
- **THEN** the extension SHALL invoke that same session-expiry handling

### Requirement: Each RDM configuration is written with a baseline twin

Every successful RDM write SHALL be accompanied by a baseline file `RDM.{rdmTenantId}.remote-baseline.reltio.json` in the same folder, holding content identical to the configuration file, recording the server copy at the moment of that fetch.

#### Scenario: Baseline written alongside the configuration

- **WHEN** an RDM configuration for tenant id `JpfbluZcdHoQows` is written successfully
- **THEN** `RDM.JpfbluZcdHoQows.remote-baseline.reltio.json` SHALL be written in the same folder with identical content

#### Scenario: Baseline replaced on every successful re-fetch

- **WHEN** a subsequent fetch for the same RDM tenant succeeds
- **THEN** both the configuration file and its baseline SHALL be replaced with the newly fetched content

#### Scenario: No baseline written when the fetch fails

- **WHEN** the RDM request for a given RDM tenant fails
- **THEN** neither that tenant's configuration file nor its baseline SHALL be modified

### Requirement: Local RDM edits are not overwritten without warning

Before fetching, the extension SHALL compare each existing RDM configuration file in the tenant folder against its baseline, and SHALL warn the user before any file with local changes is overwritten. A file with no baseline SHALL be treated as having local changes.

#### Scenario: Drifted RDM file triggers a warning

- **WHEN** the user runs Get Configuration and an existing `RDM.*.reltio.json` differs from its baseline
- **THEN** the extension SHALL warn before overwriting it, and SHALL NOT replace it unless the user chooses to proceed

#### Scenario: Warning names the affected files

- **WHEN** more than one file has local changes
- **THEN** the warning SHALL name each affected file so the user knows what is at stake

#### Scenario: Declining leaves everything untouched

- **WHEN** the user declines at the warning
- **THEN** no configuration file and no baseline SHALL be written, for L3 or for RDM

#### Scenario: Clean files fetch without prompting

- **WHEN** every existing RDM file matches its baseline
- **THEN** no RDM drift warning SHALL be shown

### Requirement: A single warning covers L3 and RDM together

The pre-fetch check SHALL present **one** warning covering every file with local changes, rather than a separate prompt per file, so that a single user action never produces a chain of modal dialogs.

#### Scenario: L3 and RDM both drifted

- **WHEN** both `L3.reltio.json` and one or more RDM files differ from their baselines
- **THEN** the extension SHALL show a single warning naming all of them

#### Scenario: Pushing local L3 skips the RDM fetch

- **WHEN** the user chooses to apply their local L3 changes instead of fetching
- **THEN** the extension SHALL push L3 as it does today and SHALL NOT fetch any RDM configuration
