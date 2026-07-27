## ADDED Requirements

### Requirement: Workspace filesystem convention for environments and tenants
The extension SHALL store each Reltio environment as a directory `{name}.reltio.environment/` at the workspace root and each tenant as `{tenantId}.reltio.tenant/` inside that environment directory, with optional `L3.reltio.json` and `L3.reltio.layout.json` in the tenant directory.

#### Scenario: Environment directory naming
- **WHEN** the user adds an environment for host `361.reltio.com`
- **THEN** a directory named `361.reltio.com.reltio.environment/` SHALL exist at the workspace root

#### Scenario: Tenant directory naming
- **WHEN** the user adds tenant `abc123` under that environment
- **THEN** a directory `abc123.reltio.tenant/` SHALL exist inside the environment directory

### Requirement: REST validation and tenant listing
The extension SHALL call `GET https://{host}/reltio/status` without authentication to validate reachability before creating an environment directory, and `GET https://{host}/reltio/tenants` with a Bearer token to populate the tenant picker.

#### Scenario: Validation without token
- **WHEN** the user adds an environment and the status endpoint returns HTTP 200
- **THEN** the environment directory SHALL be created without requiring a token

#### Scenario: Tenant list requires token
- **WHEN** the user invokes add tenant without a stored token for that environment
- **THEN** the extension SHALL refuse the operation and prompt for a token first

### Requirement: In-memory token storage
Tokens SHALL be held only in memory for the session; they SHALL NOT be written to disk or SecretStorage. The extension SHALL support aliasing one environment’s token resolution to another environment’s stored token.

#### Scenario: Restart clears tokens
- **WHEN** the user restarts VS Code
- **THEN** previously entered tokens SHALL NOT be available until re-entered

### Requirement: Multi-level configuration tree
The Configuration tree view SHALL show environment nodes at the root, tenant nodes as children, and the existing configuration sub-tree (sections under the Reltio Business Model) under each tenant that has a readable `L3.reltio.json`.

#### Scenario: Unauthorized environment with local L3
- **WHEN** an environment has no valid token but a tenant folder contains `L3.reltio.json`
- **THEN** the environment node SHALL indicate unauthorized state and the tenant subtree SHALL still load from the local file where possible

### Requirement: Configuration tree navigation and ontology
For every configuration sub-tree node (all `reltio.item.*` and `reltio.folder.*` context values under a tenant’s L3 subtree), the extension SHALL contribute **Show in Editor** and **Show in Ontology** actions in the Configuration view context menu. Show in Editor SHALL open the tenant `L3.reltio.json` if it is not already open and SHALL reveal the JSON range for that node. Show in Ontology SHALL open the ontology preview for that same L3 document.

#### Scenario: Primary open reveals JSON
- **WHEN** the user uses the tree’s primary open gesture on a configuration node tied to a tenant L3 file
- **THEN** the extension SHALL run the same navigation as Show in Editor (document opened if needed, caret moved to the node’s JSON)

### Requirement: Extension activation for empty workspace
The extension SHALL register activation events such that opening the Reltio Configuration view activates the extension even when no `*.reltio.environment` directory exists yet.

#### Scenario: First environment from empty folder
- **WHEN** the user opens the Configuration view in a workspace with no environment directories
- **THEN** the extension SHALL be active and the user SHALL be able to run Add Environment from the view

## MODIFIED Requirements

### Requirement: Sidebar tree view with Reltio activity bar icon
The extension SHALL register a view container in the activity bar with a Reltio icon and a tree view named "Configuration" that displays **environments, tenants, and** the structure of **each tenant’s** `L3.reltio.json` when present, instead of only the single active editor’s `.reltio.json` file.

#### Scenario: Tree view welcome when workspace empty of environments
- **WHEN** no environment directories exist yet
- **THEN** the tree view SHALL show welcome content consistent with `viewsWelcome` and SHALL allow starting Add Environment
