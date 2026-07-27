## ADDED Requirements

### Requirement: Bundled Velocity Pack library ships inside the extension artifact

The system SHALL embed a **bundled** Velocity Pack reference library inside the extension package (`*.vsix`) for the initial milestone. Pack JSON and manifests SHALL be **committed in this project’s sources** (e.g. under `resources/velocity-packs/`) by maintainers; **no** live or build-time fetch from Bitbucket is required for core workflows. A future **optional** automation MAY refresh excerpts from upstream exports.

#### Scenario: Offline authoring session

- **WHEN** the extension is installed with no network access  
- **THEN** agents SHALL still access bundled pack excerpts and manifests packaged with the VSIX.

### Requirement: Each bundled pack has machine-readable manifest metadata

Every Velocity Pack included in the bundle SHALL declare **`manifest.json`** fields at minimum: stable pack **identifier**, **display name**, **version / semver**, and **industry or vertical tag**. An **optional provenance** field (e.g. upstream revision id or tag string) SHOULD be present when known. Optional excerpts MUST be listed or glob-addressable from the manifest.

#### Scenario: Trace pack excerpt to metadata

- **WHEN** an agent cites a bundled excerpt for suggestions  
- **THEN** humans SHALL be able to trace the excerpt to pack id and semver via `manifest.json`, and to optional provenance when recorded.

### Requirement: Pack excerpts are the primary corpus for structural suggestions

Guided model-element workflows SHALL treat bundled excerpts as the **primary** external corpus for **structure and naming** suggestions (attributes, common relation idioms, typical match constructs), superseding ad-hoc invented patterns when excerpts apply.

#### Scenario: Industry-specific attribute pattern reuse

- **WHEN** the author’s intent matches an industry tag supported by a bundled pack excerpt  
- **THEN** attribute and relation suggestions SHALL prefer patterns grounded in that excerpt over unconstrained invention.

### Requirement: Pack excerpts are materialized into the workspace for Cursor Agent

After extension sync, bundled Velocity Pack excerpts SHALL exist under **`.reltio/reltio-agent/velocity-packs/`** (or the extension-managed path named in `design.md` D4b) **inside the workspace folder**, as a mirror of the packaged `resources/velocity-packs/` content. Refresh SHALL follow **`velocityPacksBundleVersion`** rules in design **D3b** / **D4b**. The VSIX remains canonical; materialization exists so agents use normal workspace-relative paths and search.

#### Scenario: Agent references pack file by workspace path

- **WHEN** Cursor Agent looks up industry patterns for suggestions  
- **THEN** excerpt files SHALL be addressable under `.reltio/reltio-agent/velocity-packs/` following sync.

### Requirement: Redistribution compliance is explicit per bundled pack

Each bundled pack directory SHALL include **license / redistribution metadata** sufficient for legal review. Packs without redistribution approval SHALL NOT be embedded as excerpts inside the VSIX (documentation MAY link externally instead).

#### Scenario: Restricted pack exclusion

- **WHEN** a Velocity Pack is marked restricted for redistribution  
- **THEN** it SHALL NOT appear as bundled JSON excerpts inside the shipped artifact.
