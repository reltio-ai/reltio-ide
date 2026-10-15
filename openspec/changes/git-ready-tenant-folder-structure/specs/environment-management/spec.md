## ADDED Requirements

### Requirement: Tenant-local paths resolve to component-tree locations
`EnvironmentManager` SHALL be the single place that maps an (environment, tenant) pair to an on-disk path. All five accessors SHALL resolve to component-tree locations, and no other module SHALL construct a tenant-local path from string fragments.

| Accessor | Resolves to, relative to the tenant folder |
|---|---|
| `getL3Uri` | `Business Config/BusinessConfig.json` |
| `getRemoteBaselineUri` | `.reltio-ide/BusinessConfig.baseline.json` |
| `getLayoutUri` | `.reltio-ide/BusinessConfig.layout.json` |
| `getHistoryDirectoryUri` | `.reltio-ide/history/` |
| `getTenantRootUri` | the tenant folder itself, unchanged |

#### Scenario: Every consumer follows the accessors
- **WHEN** any feature reads or writes a tenant-local file
- **THEN** it obtains the URI from an `EnvironmentManager` accessor
- **AND** no hardcoded `L3.reltio.json` path remains outside `EnvironmentManager`

#### Scenario: The logical tenant key matches the physical layout
- **WHEN** a UX surface derives the logical key for a tenant's configuration file
- **THEN** the key reflects the component-tree path rather than the legacy flat path

#### Scenario: First-open tracking recognizes the renamed file
- **WHEN** a tenant's `Business Config/BusinessConfig.json` is opened for the first time
- **THEN** the extension records it as opened and the UX state advances exactly as it did for `L3.reltio.json`

### Requirement: Environment folders are created at the workspace root
`createEnvironment` SHALL create new environment directories directly under the workspace root. Discovery SHALL continue to scan both the workspace root and `.reltio/`, preferring an existing location for an environment that is already known.

#### Scenario: A new environment is created at the root
- **WHEN** the user adds an environment to a workspace with no existing environment folders
- **THEN** `{host}.reltio.environment/` is created directly under the workspace root

#### Scenario: An existing `.reltio/` environment keeps its location
- **WHEN** an environment already exists under `.reltio/` and the user adds a tenant to it
- **THEN** the tenant is created inside the existing `.reltio/` environment folder, not at the workspace root

#### Scenario: Both locations remain discoverable
- **WHEN** a workspace has one environment at the root and another under `.reltio/`
- **THEN** both appear in the tree and both are fully usable

### Requirement: Adding a tenant materializes the component tree
`createTenant` SHALL create the tenant directory and materialize the full component tree with its `README.md` placeholders, so a tenant folder is Git-ready before any configuration is fetched.

#### Scenario: A newly added tenant is Git-ready
- **WHEN** the user adds a tenant
- **THEN** the tenant folder contains the complete component tree
- **AND** it can be committed and pushed with no further setup

#### Scenario: Tenant removal is unchanged
- **WHEN** the user removes a tenant
- **THEN** the whole tenant folder is deleted, including the component tree and `.reltio-ide/`
