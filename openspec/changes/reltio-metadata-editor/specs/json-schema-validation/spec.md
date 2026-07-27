## ADDED Requirements

### Requirement: JSON Schema covers all top-level configuration sections
The extension SHALL provide a JSON Schema file at `schemas/reltio-metadata.schema.json` that validates the top-level structure of a Reltio metadata configuration including: `label`, `description`, `schemaVersion`, `entityTypes`, `relationTypes`, `matchGroups`, `survivorshipGroups`, `cleanseGroups`, and `sources`.

#### Scenario: Valid top-level properties accepted
- **WHEN** a `.reltio.json` file contains only known top-level properties (`label`, `description`, `schemaVersion`, `entityTypes`, `relationTypes`, `matchGroups`, `survivorshipGroups`, `cleanseGroups`, `sources`, `$schema`)
- **THEN** no validation errors SHALL be reported

#### Scenario: Unknown top-level properties rejected
- **WHEN** a `.reltio.json` file contains an unknown property at the top level (e.g., `"kakashka": []`)
- **THEN** the editor SHALL display a validation error indicating the property is not allowed

#### Scenario: Required label property
- **WHEN** a `.reltio.json` file is missing the `label` property
- **THEN** the editor SHALL display a validation error indicating `label` is required

### Requirement: Schema validates entity type definitions
The schema SHALL validate entity type objects within the `entityTypes` array, requiring `URI`, `label`, and `name` properties.

#### Scenario: Valid entity type accepted
- **WHEN** an entity type has `URI`, `label`, `name`, and an `attributes` array
- **THEN** no validation errors SHALL be reported for that entity type

#### Scenario: Entity type missing required fields
- **WHEN** an entity type is missing the `name` property
- **THEN** the editor SHALL display a validation error on that entity type object

### Requirement: Schema supports all 24+ attribute data types
The schema SHALL enumerate all Reltio attribute types in the `type` field: `String`, `StringNotTokenized`, `Int`, `Long`, `Float`, `Number`, `Boolean`, `Date`, `Timestamp`, `Blob`, `URL`, `SSN`, `GeoLocation`, `Image URL`, `Blog URL`, `Email domains`, `NAICS-code`, `SIC-code`, `Id card (Passport)`, `CIK id`, `Ticker symbol`, `Stock exchange`, `Nested`, and `Reference`.

#### Scenario: Valid simple attribute type
- **WHEN** an attribute has `"type": "String"`
- **THEN** no validation error SHALL be reported on the type field

#### Scenario: Invalid attribute type rejected
- **WHEN** an attribute has `"type": "InvalidType"`
- **THEN** the editor SHALL display a validation error indicating the type is not in the allowed enum

### Requirement: Schema enforces Nested attribute structure
The schema SHALL require `attributes` array for Nested-type attributes.

#### Scenario: Nested attribute with sub-attributes
- **WHEN** an attribute has `"type": "Nested"` and includes an `attributes` array
- **THEN** no validation error SHALL be reported

#### Scenario: Nested attribute missing sub-attributes
- **WHEN** an attribute has `"type": "Nested"` but no `attributes` property
- **THEN** the editor SHALL display a validation error

### Requirement: Schema enforces Reference attribute structure
The schema SHALL require `relationshipTypeURI`, `referencedEntityTypeURI`, and `referencedAttributeURIs` for Reference-type attributes.

#### Scenario: Complete reference attribute
- **WHEN** an attribute has `"type": "Reference"` with all required reference fields
- **THEN** no validation error SHALL be reported

#### Scenario: Reference attribute missing required fields
- **WHEN** an attribute has `"type": "Reference"` but is missing `referencedEntityTypeURI`
- **THEN** the editor SHALL display a validation error

### Requirement: Schema activates for *.reltio.json files
The extension manifest SHALL register JSON validation via `contributes.jsonValidation` for the `*.reltio.json` file pattern. Files MAY also use a `$schema` property pointing to the schema for validation without the extension loaded.

#### Scenario: Automatic schema association
- **WHEN** the extension is loaded and a file matching `*.reltio.json` is opened
- **THEN** the JSON Schema validation, autocomplete, and hover docs SHALL be active

#### Scenario: Inline $schema reference
- **WHEN** a JSON file contains `"$schema": "../schemas/reltio-metadata.schema.json"` (or any valid path to the schema)
- **THEN** validation SHALL work regardless of the file name or extension activation state

### Requirement: Schema provides autocomplete suggestions
The JSON Schema SHALL include `description` fields on all properties so that VS Code's built-in JSON language server provides autocomplete suggestions and hover documentation.

#### Scenario: Autocomplete for attribute type
- **WHEN** the user triggers autocomplete inside the `"type"` field of an attribute
- **THEN** the editor SHALL suggest all 24+ valid attribute type values

#### Scenario: Hover documentation on property
- **WHEN** the user hovers over a property name like `"dataLabelPattern"`
- **THEN** the editor SHALL display the property's description from the schema
