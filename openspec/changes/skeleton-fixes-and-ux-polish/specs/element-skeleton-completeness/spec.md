## ADDED Requirements

### Requirement: Entity type skeleton includes dataLabelPattern
The `buildEntityTypeObject` function SHALL include `dataLabelPattern: ''` in the returned object so the skeleton satisfies the Reltio UI's mandatory-field check for new entity types.

#### Scenario: Insert entity type
- **WHEN** the user inserts a new entity type via the tree context menu
- **THEN** the inserted JSON object contains a `dataLabelPattern` key set to an empty string

### Requirement: Graph type skeleton includes graphStructure
The `buildGraphTypeObject` function SHALL include `graphStructure: ''` in the returned object so the skeleton satisfies the Reltio UI's mandatory-field check for new graph types.

#### Scenario: Insert graph type
- **WHEN** the user inserts a new graph type via the tree context menu
- **THEN** the inserted JSON object contains a `graphStructure` key set to an empty string

### Requirement: Source skeleton includes all required fields
The `buildSourceObject` function SHALL include `abbreviation`, `description`, and `icon` fields in addition to `uri` and `label`, so new sources are immediately valid when pushed to the tenant.

#### Scenario: Insert source
- **WHEN** the user inserts a new source via the tree context menu
- **THEN** the inserted JSON object contains `uri`, `label`, `abbreviation`, `description`, and `icon` keys

### Requirement: Source schema enforces label and abbreviation as required
The JSON schema definition for `Source` SHALL list `uri`, `label`, and `abbreviation` as required fields so the editor flags incomplete source objects with validation errors.

#### Scenario: Source missing abbreviation
- **WHEN** the open L3 file contains a source object without an `abbreviation` field
- **THEN** the JSON schema validator reports a missing required property error on that object

### Requirement: Apply-to-tenant blocks push for incomplete sources
`applyL3ConfigurationToTenant` SHALL validate that every source in the local L3 has non-empty `uri`, `label`, and `abbreviation` before pushing. If any source fails validation, the push SHALL be aborted and a descriptive error message SHALL be shown naming the offending sources.

#### Scenario: Push blocked by missing source fields
- **WHEN** the user triggers Apply Configuration and the local L3 contains a source with a missing `label`
- **THEN** the push is aborted and a VS Code error message names the invalid source(s)

#### Scenario: Push succeeds with valid sources
- **WHEN** all sources in the local L3 have non-empty `uri`, `label`, and `abbreviation`
- **THEN** the push proceeds normally without any validation error
