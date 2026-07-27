## ADDED Requirements

### Requirement: Default LCA assistant playbook is shipped in the repository

The system SHALL maintain a version-controlled default agent skill under `skills/reltio-default/lca-assistant/SKILL.md` that instructs Cursor Agent (or compatible agents) how to advise on Life Cycle Actions, retrieve the LCA knowledge base, ground recommendations in tenant L3 when available, and apply L3 and/or project changes. A Cursor discovery stub under `.cursor/skills/reltio-lca-assistant/` SHALL point at the canonical playbook and the materialized knowledge-base path without duplicating full content (contributor convenience in the reltio-ide repo only).

#### Scenario: Contributor locates the playbook

- **WHEN** a contributor opens the repository looking for LCA agent guidance
- **THEN** they SHALL find `skills/reltio-default/lca-assistant/SKILL.md` as the canonical playbook and a thin pointer under `.cursor/skills/reltio-lca-assistant/`

#### Scenario: Workspace override takes precedence

- **WHEN** a workspace defines `skills/workspace/lca-assistant/SKILL.md`
- **THEN** agent guidance SHALL prefer that override over the default/materialized copy for the same logical playbook, and extension sync SHALL NOT overwrite `skills/workspace/**`

### Requirement: Skill documents partner invocation without relying on the contributor stub

The skill (and `ARCHITECTURE.md` agent-assets section) SHALL document how partners invoke the assistant after sync: materialized paths under `.reltio/reltio-agent/skills/default/lca-assistant/` and `.reltio/reltio-agent/lca-knowledge-base/`, plus at least two sample prompts. The documentation SHALL NOT assume a `.cursor/skills` stub exists in partner workspaces.

#### Scenario: Partner workspace has no .cursor stub

- **WHEN** a partner workspace receives only extension-synced agent assets
- **THEN** documented invoke guidance SHALL reference the materialized skill and knowledge-base paths (or `@` references to them) rather than `.cursor/skills/reltio-lca-assistant/`

### Requirement: Skill enforces knowledge-base retrieval discipline

The `lca-assistant` skill SHALL require the agent to classify user intent, consult the knowledge-base routing index (`manifest.json` and/or `00_INDEX_RAG_RETRIEVAL_MAP.md`), and retrieve only the minimum document set needed for that intent before answering. The skill SHALL require clarifying the target entity/relation/change-request type and real L3 attribute paths before producing a full build or L3 wiring proposal when those details are missing and L3 is available.

#### Scenario: Narrow hook question uses minimum docs

- **WHEN** the user asks what the `beforeSave` hook is for
- **THEN** the skill instructions SHALL direct the agent to retrieve core-concepts guidance rather than loading every knowledge-base document

#### Scenario: Build request asks for L3 attribute grounding

- **WHEN** the user requests a full LCA design or L3 wiring and the entity type or attribute paths are unspecified while an L3 is available
- **THEN** the skill instructions SHALL require the agent to ask clarifying questions and to use attribute names/URIs from the active L3 rather than inventing them

### Requirement: Skill is dual-workspace aware

The skill SHALL instruct the agent to detect whether tenant L3 configuration and/or an LCA Java/Maven project are present, and to branch: L3-first wiring when L3 is available; ask for L3 path or attribute URIs when only code is present; when both are present, ground names in L3 and edit code only in a user-agreed folder.

#### Scenario: L3-only workspace

- **WHEN** the workspace has `L3.reltio.json` (or active `*.reltio.json`) and no LCA Maven project
- **THEN** the skill instructions SHALL prioritize design and `lifecycleActions` proposals over scaffolding a new project unless the user explicitly requests a project

#### Scenario: Java-only workspace

- **WHEN** the workspace has an LCA code project but no L3 configuration file
- **THEN** the skill instructions SHALL forbid inventing attribute URIs and SHALL require the agent to ask for L3 location or concrete attribute paths before a full L3 wiring answer

### Requirement: Skill supports L3-first lifecycleActions wiring and opt-in project scaffolding

The skill SHALL describe how to propose or apply `lifecycleActions` on the correct type in `*.reltio.json`, including action-name formats for native, Reltio-managed, Lambda, Google Function, and Azure-style targets as documented in the knowledge base. Maven scaffolding SHALL be opt-in: only when the user explicitly requests a project, after confirming the target folder, using cookbook patterns from the knowledge base, without embedding secrets, and with an explicit note that compile may require partner access to Reltio Maven repositories.

#### Scenario: Partner wires an action on an entity type

- **WHEN** the user accepts a proposal to attach a `beforeSave` action to an existing entity type present in L3
- **THEN** the skill instructions SHALL direct the agent to edit that type’s `lifecycleActions` map with a case-sensitive hook name and ordered action list (or conditional group form when filters apply)

#### Scenario: Partner requests a new LCA project

- **WHEN** the user asks for a complete LCA Maven project scaffold
- **THEN** the skill instructions SHALL direct the agent to confirm the target folder, generate the project structure using cookbook patterns from the knowledge base, avoid embedding secrets or tokens, and state that successful compile may require configured access to Reltio Maven repositories
