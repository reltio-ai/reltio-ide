## ADDED Requirements

### Requirement: LCA knowledge base is bundled in the extension after content sign-off

The system SHALL include an approved copy of the LCA Assistant knowledge base under `resources/lca-knowledge-base/` in the repository and packaged VSIX. The bundle SHALL contain exactly the eight retrievable documents (`00`–`07`), plus `manifest.json` and `README.md`, and SHALL NOT include archive or non-indexed upstream material. The manifest SHALL retain retrieval routing metadata (document list, topics, and section line ranges) suitable for agent routing. Before a partner-facing VSIX release that includes this bundle, an LCA component owner (or designated reviewer) SHALL confirm the snapshot is approved for redistribution (recorded on RP-191824 or equivalent release checklist).

#### Scenario: Packaged VSIX contains the knowledge base

- **WHEN** a maintainer builds the extension package after the knowledge base is committed
- **THEN** the VSIX SHALL include `resources/lca-knowledge-base/manifest.json` and the eight indexed markdown documents

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
