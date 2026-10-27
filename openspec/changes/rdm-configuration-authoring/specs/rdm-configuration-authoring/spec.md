## ADDED Requirements

### Requirement: Adding a lookup type inserts a minimal skeleton

**Add a new Lookup Type** SHALL insert into the RDM configuration's `lookupTypes` array an object of exactly this shape, where `{label}` is a default label not already used by another lookup type in that file:

```json
{ "uri": "rdm/lookupTypes/{label}", "label": "{label}", "enabled": true, "startDate": 0, "endDate": 0 }
```

#### Scenario: First lookup type inserted

- **WHEN** the command runs against a configuration whose `lookupTypes` contains no label beginning `LookupType`
- **THEN** the inserted object SHALL be `{ "uri": "rdm/lookupTypes/LookupType1", "label": "LookupType1", "enabled": true, "startDate": 0, "endDate": 0 }`

#### Scenario: Default label does not collide

- **WHEN** a lookup type labelled `LookupType1` already exists
- **THEN** the next insert SHALL use `LookupType2`, and its `uri` SHALL end with the same label

### Requirement: Adding a source inserts a minimal skeleton

**Add a new Source** SHALL insert into the RDM configuration's `sources` array an object of exactly this shape, where `{label}` is a default label not already used by another source in that file:

```json
{ "uri": "rdm/sources/{label}", "label": "{label}", "abbreviation": "{label}", "canonicalValueProvider": false }
```

#### Scenario: First source inserted

- **WHEN** the command runs against a configuration whose `sources` contains no label beginning `Source`
- **THEN** the inserted object SHALL be `{ "uri": "rdm/sources/Source1", "label": "Source1", "abbreviation": "Source1", "canonicalValueProvider": false }`

#### Scenario: Default label does not collide

- **WHEN** a source labelled `Source1` already exists
- **THEN** the next insert SHALL use `Source2`

### Requirement: Insert commands are offered on the section folder and the RDM tenant row

**Add a new Lookup Type** SHALL be offered on the **Lookup Types** folder, **Add a new Source** on the **Sources** folder, and **both** on the `{rdmTenantId}` row.

Both appear on the tenant row because a section the configuration does not declare has no folder to right-click, so that row is the only place the first entry of a section can be created.

#### Scenario: Offered on the matching folder

- **WHEN** the user opens the context menu on the **Lookup Types** folder
- **THEN** **Add a new Lookup Type** SHALL be offered
- **AND** **Add a new Source** SHALL NOT be offered there

#### Scenario: Both offered on the RDM tenant row

- **WHEN** the user opens the context menu on the `{rdmTenantId}` row
- **THEN** both **Add a new Lookup Type** and **Add a new Source** SHALL be offered

#### Scenario: Not offered on entries or outside RDM

- **WHEN** the user opens the context menu on an individual lookup type or source entry, on the `RDM` group row, or on any L3 node
- **THEN** neither insert command SHALL be offered

### Requirement: Inserting creates a section the configuration does not declare

When the target array is absent from the configuration, the insert SHALL create it with the new entry as its only element.

Only `lookupTypes` and `sources` SHALL be creatable this way; a request to create any other top-level array SHALL be refused.

#### Scenario: Absent section is created

- **WHEN** the user adds a source to a configuration that has no `sources` key
- **THEN** a `sources` array SHALL be created containing the new source

#### Scenario: Unrelated keys are not created

- **WHEN** an insert targets a top-level key other than `lookupTypes` or `sources`
- **THEN** the insert SHALL be refused rather than creating that key

### Requirement: Inserts edit the document through its syntax tree

Inserts SHALL be applied as a workspace edit computed from the document's parsed syntax tree, never by string manipulation, so that commas, nesting and existing formatting are preserved. After a successful insert the new block SHALL be revealed in the editor.

#### Scenario: Surrounding document is preserved

- **WHEN** an entry is inserted into a populated array
- **THEN** the document SHALL remain valid JSON
- **AND** entries other than the new one SHALL be unchanged

#### Scenario: Inserted block is revealed

- **WHEN** an insert succeeds
- **THEN** the editor SHALL reveal the inserted block so the user can edit it immediately

### Requirement: Apply RDM Configuration pushes the configuration to the RDM service

**Apply RDM Configuration** SHALL be offered on the `{rdmTenantId}` row and SHALL send the local `RDM.{rdmTenantId}.reltio.json` to `PUT {serviceUri}/configuration/{rdmTenantId}` using the environment bearer token.

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

### Requirement: Apply checks for server-side drift before overwriting

Before pushing, the extension SHALL re-fetch the remote RDM configuration and compare it against the RDM baseline, and SHALL NOT push until the user has confirmed.

A tenant with no baseline SHALL NOT be pushed: without one there is no evidence of what the server held, so the user SHALL be asked to fetch first.

#### Scenario: Server unchanged since the last fetch

- **WHEN** the remote configuration still matches the baseline
- **THEN** the user SHALL be asked to confirm, with an option to view the changes before doing so

#### Scenario: Server changed since the last fetch

- **WHEN** the remote configuration differs from the baseline
- **THEN** the extension SHALL warn that the server changed
- **AND** SHALL require the user to review a remote-versus-local comparison before an explicit confirmation

#### Scenario: Declining pushes nothing

- **WHEN** the user declines at any confirmation
- **THEN** no request SHALL be sent and no file SHALL be modified

#### Scenario: No baseline blocks the push

- **WHEN** Apply runs for an RDM tenant with no baseline on disk
- **THEN** the extension SHALL report that a fetch is needed first
- **AND** SHALL NOT send the configuration

### Requirement: A successful apply refreshes the baseline

On success the pushed content SHALL become the tenant's RDM baseline, so that a subsequent Apply compares against what was actually pushed.

#### Scenario: Baseline matches what was pushed

- **WHEN** the PUT succeeds
- **THEN** `RDM.{rdmTenantId}.remote-baseline.reltio.json` SHALL be replaced with the pushed content

#### Scenario: Failed apply leaves the baseline alone

- **WHEN** the PUT fails
- **THEN** neither the configuration file nor its baseline SHALL be modified

### Requirement: Apply failures are reported from the service response

A rejected push SHALL be reported using the detail in the service's response body where one is present, falling back to the response text and then to the HTTP status.

#### Scenario: Service rejects the configuration

- **WHEN** the RDM service rejects the push with an error body describing the problem
- **THEN** that description SHALL be shown to the user rather than only a status code

#### Scenario: Session expired

- **WHEN** any request made by Apply returns HTTP 401
- **THEN** the extension SHALL invoke the same session-expiry handling used by other unauthorized Reltio responses for that environment
