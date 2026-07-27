## ADDED Requirements

### Requirement: Default Reltio agent skills are shipped in the repository

The system SHALL maintain version-controlled **default** agent skill documents for Reltio metadata authoring under a documented root path (`skills/reltio-default/` in `design.md`). Each skill SHALL be authored as a discrete playbook (one concern per folder with `SKILL.md`) and SHALL be identifiable by **model-element concern** (entity type, relation type, attributes, match groups, workspace merge rules).

#### Scenario: Contributor finds entity playbook

- **WHEN** a contributor opens the repository to customize agent guidance for entity types  
- **THEN** they SHALL locate an `SKILL.md` under `skills/reltio-default/` dedicated to entity-type concepts without searching unrelated playbooks.

### Requirement: Workspaces MAY extend or override default skills

The system SHALL support workspace-local skill additions under `skills/workspace/` at the workspace root. When both a default skill file and a workspace skill file address the same logical playbook (same relative path under each tree), the workspace copy SHALL take **precedence** over the default copy per `design.md`.

#### Scenario: Team overrides naming conventions

- **WHEN** a workspace author adds `skills/workspace/entity-type-concepts/SKILL.md` mirroring the relative path under defaults  
- **THEN** agent guidance SHALL use the workspace document where paths collide.

### Requirement: Skills remain distinguishable by model element

The default skill layout SHALL separate **entity**, **relation**, **attribute**, and **match group** guidance into distinct folders (names per `design.md`) so orchestration can route intent without loading unrelated instructions.

#### Scenario: Agent selects relation playbook only

- **WHEN** user intent is limited to creating or revising a **relation type**  
- **THEN** documentation SHALL allow loading **relation-type-concepts** skills without requiring attribute-only playbooks.
