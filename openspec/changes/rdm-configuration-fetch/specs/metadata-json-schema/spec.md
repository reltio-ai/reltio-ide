## MODIFIED Requirements

### Requirement: Schema alignment verified in the editor on representative configurations

The `jsonValidation` binding for `schemas/reltio-metadata.schema.json` SHALL match `*.reltio.json` **excluding** files matching `RDM.*.reltio.json`, and after substantive schema edits maintainers SHOULD open representative `L3.reltio.json` files (for example under `examples/prod/` when available locally) and confirm that the schema validates as expected in VS Code. _(Historical: a batch `scripts/validate-corpus.cjs` harness and `VALIDATION_IMPROVEMENTS.md` supported aggregate corpus compares; both have been **removed**.)_

RDM tenant configurations share the `.reltio.json` suffix so that tenant-folder scanning and workspace activation continue to work uniformly, but their top-level shape is incompatible with the L3 business model: `tenantId`, `trackTranscodeErrors`, `lookupTypes`, `updateDate` and `version` are not recognized L3 top-level properties, and while `label`, `sources` and `updatedBy` do appear in both, RDM `sources` items have a different shape. Applying the L3 schema to an RDM file would therefore report violations the user cannot resolve, since the server produced the content. Those files SHALL be bound to `schemas/reltio-rdm.schema.json` instead.

#### Scenario: Editor validation on examples corpus files

- **WHEN** a maintainer opens `L3.reltio.json` under `examples/prod/` (or other `examples/` paths) matching `*.reltio.json`
- **THEN** VS Code SHALL apply `schemas/reltio-metadata.schema.json` via built-in `jsonValidation` and surface any schema violations in the Problems panel

#### Scenario: Editor validation on samples

- **WHEN** a maintainer opens `samples/*.reltio.json` or nested sample tenant `L3.reltio.json`
- **THEN** VS Code SHALL apply the same schema via `jsonValidation`

#### Scenario: RDM configurations excluded from the L3 binding

- **WHEN** a maintainer opens a file named `RDM.{rdmTenantId}.reltio.json` in a tenant folder
- **THEN** VS Code SHALL NOT apply `schemas/reltio-metadata.schema.json` to it
- **AND** no L3 top-level property violations SHALL be reported for that file

#### Scenario: L3 files in a tenant folder alongside RDM files still validate

- **WHEN** a tenant folder contains both `L3.reltio.json` and one or more `RDM.*.reltio.json` files
- **THEN** opening `L3.reltio.json` SHALL still apply `schemas/reltio-metadata.schema.json` unchanged
