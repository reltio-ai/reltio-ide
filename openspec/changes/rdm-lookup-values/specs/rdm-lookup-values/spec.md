## ADDED Requirements

### Requirement: Get Lookup Values is offered only on lookup type rows

The extension SHALL contribute a **Get Lookup Values** command to the context menu of a lookup type row in the RDM sub-tree, and SHALL NOT offer it on source rows, RDM tenant rows, the `RDM` group row, or any L3 configuration node.

The lookups endpoint is keyed by lookup type, so no other row has an equivalent call to make.

#### Scenario: Offered on a lookup type

- **WHEN** the user opens the context menu on a row under **Lookup Types**
- **THEN** **Get Lookup Values** SHALL be offered

#### Scenario: Not offered elsewhere in the RDM sub-tree

- **WHEN** the user opens the context menu on a row under **Sources**, on an RDM tenant row, or on the `RDM` group row
- **THEN** **Get Lookup Values** SHALL NOT be offered

#### Scenario: Not offered on L3 nodes

- **WHEN** the user opens the context menu on any L3 configuration node
- **THEN** **Get Lookup Values** SHALL NOT be offered

### Requirement: Values are fetched only when requested

The extension SHALL request lookup values only in response to an explicit **Get Lookup Values** invocation, for the single lookup type that was acted on. Fetching configuration SHALL NOT fetch values for any lookup type.

#### Scenario: Get Configuration does not fetch values

- **WHEN** the user runs Get Configuration on a tenant with lookup types
- **THEN** no request to the lookups endpoint SHALL be made

#### Scenario: One lookup type per invocation

- **WHEN** the user runs Get Lookup Values on a lookup type
- **THEN** exactly one lookups request SHALL be made, for that lookup type only

### Requirement: Lookup values are fetched from the RDM lookups endpoint

The extension SHALL request `GET {serviceUri}/lookups/{rdmTenantId}/{lookupTypeName}` using the environment bearer token, where `lookupTypeName` is the trailing segment of the lookup type's URI.

The service URI SHALL be normalized and host-checked the same way as every other Reltio base URL, because it originates from a server response rather than from user configuration.

#### Scenario: URL is built from the row's own identifiers

- **WHEN** the service URI is `https://rdm.reltio.com`, the RDM tenant id is `RdmSampleTenant`, and the lookup type URI is `rdm/lookupTypes/AddressTypes`
- **THEN** the request URL SHALL be `https://rdm.reltio.com/lookups/RdmSampleTenant/AddressTypes`

#### Scenario: Path segments are encoded

- **WHEN** an RDM tenant id or lookup type name contains a character requiring URL encoding
- **THEN** that segment SHALL be encoded in the request URL

#### Scenario: Untrusted service host is refused

- **WHEN** the discovered service URI resolves to a host outside the trusted-host allowlist
- **THEN** no request SHALL be made and the refusal SHALL be reported to the user

### Requirement: The service URI is resolved without a persisted copy

The extension SHALL resolve the service URI from an in-memory value recorded when a configuration fetch discovered it, and SHALL rediscover it from the tenant physical configuration when no such value is held. The service URI SHALL NOT be written to disk.

#### Scenario: Reused after a fetch in the same session

- **WHEN** Get Configuration has already discovered the service URI for a tenant and the user then runs Get Lookup Values
- **THEN** the extension SHALL reuse the held service URI without re-requesting the tenant physical configuration

#### Scenario: Rediscovered when not held

- **WHEN** the user runs Get Lookup Values for a tenant whose service URI is not held, for example after a window reload
- **THEN** the extension SHALL request the tenant physical configuration to rediscover it, and proceed

#### Scenario: Tenant with no RDM service

- **WHEN** rediscovery finds no usable service URI for the tenant
- **THEN** the extension SHALL report that lookup values are unavailable and SHALL NOT request the lookups endpoint

### Requirement: The response is flattened to one row per code, source and value

The extension SHALL present the response as rows of **Code**, **Source** and **Value at Source**, produced by taking each entry's `code`, each of its `sourceMappings[].source`, and each of that mapping's `values[].value`. Row order SHALL follow the order of the response.

#### Scenario: Each source of each code becomes a row

- **WHEN** a response contains 7 codes each mapped to the same 4 sources with one value apiece
- **THEN** the table SHALL contain 28 rows

#### Scenario: Several values for one source

- **WHEN** a source mapping contains more than one value
- **THEN** each value SHALL produce its own row, with the same code and source

#### Scenario: A source mapped but unpopulated

- **WHEN** a source mapping contains an empty `values` array
- **THEN** one row SHALL be produced for that code and source, with an empty Value at Source
- **AND** the row SHALL NOT be omitted, because a mapped-but-unpopulated source is a meaningful state

#### Scenario: A code with no source mappings

- **WHEN** an entry has no `sourceMappings`
- **THEN** one row SHALL be produced showing that code with empty Source and Value at Source

#### Scenario: Unexpected response shape

- **WHEN** the response is not an array, or an entry is not an object
- **THEN** flattening SHALL yield no rows for it rather than failing

### Requirement: Values are presented in a panel titled for the lookup type

The extension SHALL display the rows in a webview panel titled with the lookup type name, reusing a single panel across invocations so that opening another lookup type replaces its contents rather than accumulating tabs.

The panel SHALL also make the unmodified response available in a collapsed section, so that fields outside the three columns remain inspectable.

#### Scenario: Panel titled and populated

- **WHEN** the user runs Get Lookup Values on `AddressTypes`
- **THEN** a panel titled for `AddressTypes` SHALL show the Code / Source / Value at Source table

#### Scenario: Second lookup type reuses the panel

- **WHEN** the user runs the command on a different lookup type while the panel is open
- **THEN** the same panel SHALL be retitled and repopulated rather than a second panel opening

#### Scenario: Raw response available

- **WHEN** the panel is open
- **THEN** the unmodified response SHALL be available in a collapsed section of the panel

### Requirement: The panel renders untrusted content safely

The panel SHALL declare a content security policy of `default-src 'none'` with nonce-gated styles and scripts, and SHALL escape every value interpolated into its markup, consistent with the extension's other webviews.

#### Scenario: Policy and nonces present

- **WHEN** the panel HTML is produced
- **THEN** it SHALL contain a `default-src 'none'` content security policy
- **AND** every `<style>` and `<script>` element SHALL carry the matching nonce

#### Scenario: Markup in a value is inert

- **WHEN** a lookup value contains markup such as `<script>alert(1)</script>`
- **THEN** it SHALL appear as visible text in the table and SHALL NOT be interpreted as markup

### Requirement: Empty results and failures are distinguishable

A successful response with no values SHALL open the panel and state that the lookup type has no values. A failed request SHALL report the failure and SHALL NOT present an empty table, because an empty table asserts that the lookup type has no values.

#### Scenario: No values

- **WHEN** the lookups endpoint returns an empty array
- **THEN** the panel SHALL open and state that the lookup type has no values

#### Scenario: Request fails

- **WHEN** the lookups request fails
- **THEN** the extension SHALL report the failure
- **AND** SHALL NOT render an empty table
- **AND** any panel already open SHALL be left as it was

#### Scenario: Session expired

- **WHEN** the lookups request returns HTTP 401
- **THEN** the extension SHALL invoke the same session-expiry handling used by other unauthorized Reltio responses for that environment
