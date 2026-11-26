## ADDED Requirements

### Requirement: A dedicated JSON Schema validates RDM configurations

The extension SHALL provide a JSON Schema at `schemas/reltio-rdm.schema.json` that validates an RDM tenant configuration as returned by `GET {serviceUri}/configuration/{rdmTenantId}`. The schema SHALL recognize and type-check `tenantId` (string), `label` (string), `trackTranscodeErrors` (boolean), `lookupTypes` (array), `sources` (array), `updatedBy` (string), `updateDate` (number), and `version` (number), plus `$schema`.

The RDM schema SHALL be separate from `schemas/reltio-metadata.schema.json`. The two top-level shapes partially overlap — `label`, `sources` and `updatedBy` appear in both — but are incompatible: `tenantId`, `trackTranscodeErrors`, `lookupTypes`, `updateDate` and `version` are not recognized L3 top-level properties, and RDM `sources` items have a different shape from L3 `sources` items.

#### Scenario: Fetched RDM configuration validates cleanly

- **WHEN** an RDM configuration fetched from the RDM service is opened in the editor
- **THEN** no validation errors SHALL be reported

#### Scenario: Recognized property of the wrong type is reported

- **WHEN** an RDM configuration sets `trackTranscodeErrors` to a string instead of a boolean
- **THEN** the editor SHALL display a type validation error on that property

### Requirement: The schema tolerates properties it does not recognize

RDM configurations vary per tenant, and the schema is derived from a limited sample, so the recognized property set SHALL be treated as a lower bound rather than a closed specification. The schema SHALL NOT declare `additionalProperties: false` at any level, so that a property absent from the sample but present in a tenant's real configuration does not produce a validation error on server-produced content.

#### Scenario: Unrecognized top-level property tolerated

- **WHEN** an RDM configuration contains a top-level property outside the recognized set
- **THEN** no validation error SHALL be reported for that property

#### Scenario: Unrecognized property on a lookup type tolerated

- **WHEN** an entry in `lookupTypes` contains a property outside the recognized set
- **THEN** no validation error SHALL be reported for that property

#### Scenario: Unrecognized property on a source tolerated

- **WHEN** an entry in `sources` contains a property outside the recognized set
- **THEN** no validation error SHALL be reported for that property

### Requirement: Schema validates RDM lookup type entries

The schema SHALL validate objects in the `lookupTypes` array, type-checking `uri` (string), `label` (string), `enabled` (boolean), `startDate` (number), and `endDate` (number), and SHALL require `uri`, because that URI is the identity L3 `lookupCode` values reference. No constraint SHALL be placed on the number of entries, which varies per tenant.

#### Scenario: Lookup type with the recognized properties accepted

- **WHEN** a lookup type object is `{ "uri": "rdm/lookupTypes/MaritalStatuses", "label": "MaritalStatuses", "enabled": true, "startDate": 0, "endDate": 0 }`
- **THEN** no validation error SHALL be reported for that entry

#### Scenario: Lookup type missing uri rejected

- **WHEN** a lookup type object has no `uri` property
- **THEN** the editor SHALL display a validation error on that entry

#### Scenario: Empty lookupTypes array accepted

- **WHEN** an RDM configuration has an empty `lookupTypes` array
- **THEN** no validation error SHALL be reported

### Requirement: Schema validates RDM source entries

The schema SHALL validate objects in the `sources` array, type-checking `uri` (string), `label` (string), `abbreviation` (string), and `canonicalValueProvider` (boolean), and SHALL require `uri`. No constraint SHALL be placed on the number of entries.

#### Scenario: Source with the recognized properties accepted

- **WHEN** a source object is `{ "uri": "rdm/sources/SAP", "label": "SAP", "abbreviation": "SAP", "canonicalValueProvider": false }`
- **THEN** no validation error SHALL be reported for that entry

#### Scenario: Source missing uri rejected

- **WHEN** a source object has no `uri` property
- **THEN** the editor SHALL display a validation error on that entry

### Requirement: RDM configuration files are bound to the RDM schema

The extension manifest SHALL bind files matching `RDM.*.reltio.json` to `schemas/reltio-rdm.schema.json` through the built-in `jsonValidation` contribution, so that fetched RDM configurations are validated on open without user setup.

#### Scenario: Binding applied on open

- **WHEN** a maintainer opens `RDM.{rdmTenantId}.reltio.json` in a tenant folder
- **THEN** VS Code SHALL apply `schemas/reltio-rdm.schema.json` and surface any violations in the Problems panel

#### Scenario: RDM file is not validated against the L3 schema

- **WHEN** the same file is open
- **THEN** `schemas/reltio-metadata.schema.json` SHALL NOT be applied to it, and no L3 top-level property errors SHALL be reported
