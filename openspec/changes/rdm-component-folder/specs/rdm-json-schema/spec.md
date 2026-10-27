## MODIFIED Requirements

### Requirement: RDM configuration files are bound to the RDM schema

The extension manifest SHALL bind files matching `**/RDM/*/config.json` to `schemas/reltio-rdm.schema.json` through the built-in `jsonValidation` contribution, so that fetched RDM configurations are validated on open without user setup. The pattern SHALL require a subfolder of an `RDM` folder, because `config.json` alone is too common a name to bind.

Files matching the earlier `RDM.*.reltio.json` name SHALL remain bound to the RDM schema, and excluded from the L3 schema, until they are relocated.

#### Scenario: Binding applied on open

- **WHEN** a maintainer opens `RDM/{rdmTenantId}/config.json` in a tenant folder
- **THEN** VS Code SHALL apply `schemas/reltio-rdm.schema.json` and surface any violations in the Problems panel

#### Scenario: RDM file is not validated against the L3 schema

- **WHEN** the same file is open
- **THEN** `schemas/reltio-metadata.schema.json` SHALL NOT be applied to it, and no L3 top-level property errors SHALL be reported

#### Scenario: Unrelated config.json is unaffected

- **WHEN** a `config.json` exists anywhere other than directly inside a subfolder of an `RDM` folder
- **THEN** the RDM schema SHALL NOT be applied to it
