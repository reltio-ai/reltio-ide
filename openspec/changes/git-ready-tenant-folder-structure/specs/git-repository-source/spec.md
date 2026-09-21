## ADDED Requirements

### Requirement: Workspace-level git source and per-tenant git binding coexist
Two distinct Git integrations now exist: the workspace-level git-sourced mode introduced by `git-repository-source`, where the whole workspace is one cloned repository, and the per-tenant binding introduced by `tenant-git-binding`, where each tenant folder is its own repository. They SHALL remain mutually exclusive within one workspace, and the extension SHALL determine which is active without ambiguity.

#### Scenario: Git-sourced mode suppresses per-tenant binding
- **WHEN** the workspace is in git-sourced mode
- **THEN** the **Connect Tenant to Git** command is not offered on any node
- **AND** the existing git-mode menu gating is unchanged

#### Scenario: Tenant-connected mode suppresses workspace git source
- **WHEN** the workspace has connected Reltio environments with tenant folders
- **THEN** git-sourced mode is not entered on activation
- **AND** per-tenant binding is available on tenant nodes

#### Scenario: Mode detection is unambiguous
- **WHEN** the extension activates
- **THEN** it resolves exactly one of: git-sourced workspace, tenant-connected workspace, or empty workspace
- **AND** the resolved mode is reflected in the `reltio.workspaceSource` context key

### Requirement: A cloned repository carrying the component tree is recognized
When git-sourced mode discovers a repository whose layout matches the component tree, it SHALL resolve the configuration at `Business Config/BusinessConfig.json` through the normal component-tree rules rather than treating the file as an arbitrary discovered config.

#### Scenario: A component-tree repository resolves predictably
- **WHEN** a cloned repository contains `Business Config/BusinessConfig.json`
- **THEN** that file is selected as the configuration without prompting the user to disambiguate
- **AND** the ontology layout sidecar for it is resolved under `.reltio-ide/`

#### Scenario: Arbitrary repositories are unaffected
- **WHEN** a cloned repository does not match the component tree
- **THEN** the existing depth-limited discovery for `BusinessConfig.json` and `L3.json` applies unchanged

#### Scenario: Multi-config repositories still prompt
- **WHEN** a cloned repository contains several component trees or several discovered configs
- **THEN** the existing multi-source behaviour applies and each is surfaced as its own tenant row
