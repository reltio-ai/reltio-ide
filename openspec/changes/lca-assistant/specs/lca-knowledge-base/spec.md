## ADDED Requirements

### Requirement: LCA knowledge base is bundled in the extension after content sign-off

The system SHALL include an approved copy of the LCA Assistant knowledge base under `resources/lca-knowledge-base/` in the repository and packaged VSIX. The bundle SHALL contain exactly the seven retrievable documents (`00`–`06`), plus `manifest.json` and `README.md`, and SHALL NOT include archive or non-indexed upstream material. The manifest SHALL retain retrieval routing metadata (document list, topics, and section line ranges) suitable for agent routing. Before a partner-facing VSIX release that includes this bundle, an LCA component owner (or designated reviewer) SHALL confirm the snapshot is approved for redistribution (recorded on RP-191824 or equivalent release checklist).

#### Scenario: Packaged VSIX contains the knowledge base

- **WHEN** a maintainer builds the extension package after the knowledge base is committed
- **THEN** the VSIX SHALL include `resources/lca-knowledge-base/manifest.json` and the seven indexed markdown documents

#### Scenario: Provenance is recorded

- **WHEN** a contributor inspects the bundled knowledge base
- **THEN** documentation in that tree SHALL record the upstream knowledge-base version (or generation date) used for the copy so refreshes are traceable

#### Scenario: LCA sign-off before partner release

- **WHEN** the team prepares a partner-facing release that ships the LCA knowledge base
- **THEN** the release checklist SHALL include recorded LCA approval of the bundled snapshot (e.g. comment on RP-191824)

### Requirement: Knowledge base is materialized into the workspace on version advance

The extension SHALL declare an independent `lcaKnowledgeBaseBundleVersion` in `resources/reltio-agent-assets.json` and SHALL materialize `resources/lca-knowledge-base/` to `.reltio/reltio-agent/lca-knowledge-base/` when that version differs from `.reltio/reltio-agent/.sync-state.json`, when the destination is missing, or when the user runs the existing Resync agent-assets command. Materialization SHALL NOT overwrite `skills/workspace/**`. Skills and Velocity Pack sync behavior SHALL remain independently versioned.

#### Scenario: Fresh workspace receives the knowledge base after activation

- **WHEN** a workspace folder is open and agent-asset sync runs while the bundled LCA knowledge-base version is newer than the stamp (or the destination is absent)
- **THEN** the extension SHALL copy the bundled knowledge base to `.reltio/reltio-agent/lca-knowledge-base/` and update `lcaKnowledgeBaseBundleVersion` in `.sync-state.json`

#### Scenario: Resync refreshes the knowledge base without touching team skill overrides

- **WHEN** the user invokes Resync for Reltio agent assets
- **THEN** the extension SHALL re-copy the bundled LCA knowledge base into `.reltio/reltio-agent/lca-knowledge-base/` and SHALL leave `skills/workspace/**` unchanged

#### Scenario: Unchanged version skips unnecessary copy

- **WHEN** sync runs, the destination exists, force is false, and `lcaKnowledgeBaseBundleVersion` matches the stamp
- **THEN** the extension SHALL NOT replace the knowledge-base directory solely due to that check

### Requirement: LCA assistant generates code and further-steps docs, not L3 patches

The LCA assistant skill and knowledge-base answering pattern SHALL treat tenant L3 as the source of truth for types and attributes. When the type, hook, and attributes already exact-match that L3, the agent SHALL write the LCA source in that turn and SHALL ask only whether to deploy. The agent SHALL NOT add, merge, or edit a `lifecycleActions` section in the generate turn. After the deploy tool succeeds, the agent SHALL apply that `lifecycleActions` change without a second confirmation. A failed deploy SHALL leave L3 unchanged.

#### Scenario: Generate LCA does not patch L3

- **WHEN** the user asks the LCA assistant to generate an LCA for a type, hook, and attributes that exact-match the connected tenant L3
- **THEN** the agent SHALL produce LCA code in that turn and SHALL leave the L3 file unchanged (no `lifecycleActions` write)

#### Scenario: Further steps are documented instead of applied

- **WHEN** the agent finishes generating LCA code
- **THEN** the reply SHALL ask whether to deploy and SHALL include further-steps documentation for verification
- **AND** the agent SHALL NOT apply `lifecycleActions` until the deploy tool succeeds

### Requirement: Tenant-object LCA queries require a connected tenant L3

The LCA assistant skill and knowledge-base answering pattern SHALL require a **connected tenant L3** before answering queries about tenant objects (entity, relation, or change-request types, attribute URIs, existing `lifecycleActions`, or generating/scaffolding an LCA for a named type). A connected L3 is `Business Config/BusinessConfig.json` in a tenant folder whose `.reltio-config-source.json` has `kind: "tenant"`, `L3.reltio.json` under a legacy `*.reltio.tenant/` directory, or a git-connected `BusinessConfig.json` / `L3.reltio.json` named by `.reltio-config-source.json`. Advice that names any tenant object, not only HCP, HCO, or HasAddress, is tenant-object work. If the Reltio IDE plugin is not connected to any tenant, or a tenant exists without fetched L3, the agent SHALL **stop** and ask the user to connect (Setup Wizard, Add Tenant, and/or Get Configuration / fetch L3). The agent SHALL NOT invent type or attribute URIs and SHALL NOT treat Velocity Packs or sample JSON as a substitute for that tenant. Generic conceptual questions (hooks, architecture, LCA vs DVF, ops) MAY be answered from the knowledge base without L3.

#### Scenario: Plugin not connected to a tenant

- **WHEN** the user asks an LCA question about a tenant object and the workspace has no `*.reltio.tenant/` directory (or no environment/session)
- **THEN** the agent SHALL not generate type-specific LCA code or invent URIs, and SHALL ask the user to connect a tenant via the Reltio IDE plugin (`reltio.launchSetupWizard` / `reltio.addTenant`)

#### Scenario: Tenant added but L3 not fetched

- **WHEN** a tenant folder exists without `Business Config/BusinessConfig.json` or legacy `L3.reltio.json` and the user asks a tenant-object LCA question
- **THEN** the agent SHALL ask the user to fetch configuration (`reltio.fetchL3`) before continuing

#### Scenario: Generic LCA knowledge does not require L3

- **WHEN** the user asks a conceptual LCA question that does not name or depend on tenant metadata (for example, what `beforeSave` does)
- **THEN** the agent MAY answer from the knowledge base without a connected tenant

### Requirement: Missing L3 names are clarified with available tenant options

When tenant L3 is connected, the LCA assistant SHALL resolve user-named tenant, entity type, relation type, change-request type, and attribute values against that L3 using **exact** label or URI-local-name match (case-insensitive) before generating type-specific LCA code. This includes names such as `HCP`, `HCO`, `HasAddress`, and any attribute on those types. If a named value is absent, a near-miss only (for example `CourseTopics` when L3 has `Course`), ambiguous, or omitted when required, the agent SHALL **stop that turn**, ask the user to **confirm the actual name**, and SHALL list suggested plus available options from the connected L3 (uri and label; lists MAY be capped). The agent SHALL NOT generate LCA source, SHALL NOT silently substitute a similar type, and SHALL NOT use a workspace type spec, Velocity Pack, sample JSON, or cloud template as a stand-in for the missing name. If tenant L3 is not available, the connected-tenant requirement above still applies: connect first, then resolve names.

#### Scenario: Named entity type is not in L3

- **WHEN** the user asks to generate an LCA for an entity type whose uri/label is not an exact match in the connected `L3.reltio.json`
- **THEN** the agent SHALL not generate that LCA in the same turn, SHALL ask the user to confirm the actual entity type name, and SHALL list suggested plus available entity types (uri + label) from this L3

#### Scenario: Near-miss type is not auto-selected

- **WHEN** the user names `CourseTopics` (or any type such as `HCP` / `HasAAddress`) that is not in L3 and a similar type such as `Course` / `HasAddress` is in L3
- **THEN** the agent SHALL offer the similar type only as a confirmation option and SHALL NOT generate an LCA for it (or say it will use it) until the user explicitly confirms that name

#### Scenario: Named attribute is not on the resolved type

- **WHEN** the user names an attribute that is not on the resolved entity or relation type in L3
- **THEN** the agent SHALL ask for the correct attribute and SHALL list attributes available on that type

#### Scenario: Required type omitted

- **WHEN** the user asks to generate an LCA without naming an entity, relation, or DCR type
- **THEN** the agent SHALL ask which type to target and SHALL list available types from the connected L3

### Requirement: Known L3 names are written in the same turn

When the user asks to **generate or update** LCA source (including an opt-in Maven scaffold) and the object type, hook, and attributes already exact-match the connected L3, the agent SHALL print the design (object type with uri, attributes to **read**, attributes to **add or update**) and SHALL write the Java in that turn. The project SHALL be `<tenant folder>/LifeCycle Actions/<type>-<hook>-<name>-lca/`. The agent SHALL ask only whether to deploy. The agent SHALL ask before writing code only when a required name is missing or not an exact L3 match. Conceptual questions that do not request code SHALL skip this step.

#### Scenario: Generate LCA writes code when the names match

- **WHEN** the user asks to generate an LCA for an entity or relation type, hook, and attributes that exact-match L3
- **THEN** the agent SHALL list the object type and the attributes to read vs add/update, SHALL emit the Maven project at `<tenant folder>/LifeCycle Actions/<type>-<hook>-<name>-lca/` in that turn, and SHALL ask only whether to deploy

#### Scenario: Update existing LCA uses the same rule

- **WHEN** the user asks to update existing LCA code and the type, hook, and attributes already exact-match L3
- **THEN** the agent SHALL write the update in that turn and SHALL ask only whether to deploy

#### Scenario: Advice without code skips confirmation

- **WHEN** the user asks what a hook does and does not request generated code
- **THEN** the agent MAY answer from the knowledge base without writing code
