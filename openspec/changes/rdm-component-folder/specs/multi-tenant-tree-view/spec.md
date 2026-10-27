## MODIFIED Requirements

### Requirement: Multi-level configuration tree

The Configuration tree view SHALL show environment nodes at the root, tenant nodes as children, and the existing configuration sub-tree (sections under the Reltio Business Model) under each tenant that has a readable `L3.reltio.json`.

Each tenant SHALL additionally show one RDM root node per `RDM/{rdmTenantId}/config.json` present in its folder, placed after the L3 sections. RDM roots SHALL be independent of L3: a tenant with RDM configurations but no readable `L3.reltio.json` SHALL still show its RDM roots, and a tenant with no RDM configurations SHALL render exactly as before.

#### Scenario: Unauthorized environment with local L3

- **WHEN** an environment has no valid token but a tenant folder contains `L3.reltio.json`
- **THEN** the environment node SHALL indicate unauthorized state and the tenant subtree SHALL still load from the local file where possible

#### Scenario: Tenant with both L3 and RDM on disk

- **WHEN** a tenant folder contains its Business Config and one or more RDM configurations under `RDM/`
- **THEN** the tenant node SHALL expand to the L3 sections followed by one root per RDM configuration

#### Scenario: RDM roots do not depend on L3

- **WHEN** a tenant folder contains an RDM configuration but no readable `L3.reltio.json`
- **THEN** the tenant node SHALL still show the RDM root
