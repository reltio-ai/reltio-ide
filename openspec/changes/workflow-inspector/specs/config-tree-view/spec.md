## MODIFIED Requirements

### Requirement: Tenant children are grouped by concern
A tenant row's children SHALL be exactly two folders — `Business Config` and `Workflows` — rather than a flat list of configuration-section folders.

#### Scenario: Business Config preserves prior tenant content one level deeper
- **WHEN** a tenant with a fetched `L3.reltio.json` is expanded
- **THEN** a `Business Config` folder SHALL appear
- **AND** its children SHALL be exactly the History folder (when applicable) and every non-empty configuration section, unchanged in content and ordering from what previously rendered directly under the tenant row

#### Scenario: Workflows appears regardless of Business Config fetch state
- **WHEN** a tenant has not yet fetched its `L3.reltio.json`
- **THEN** the `Workflows` folder SHALL still appear as a sibling of `Business Config`
- **AND** its own fetch state SHALL be independent of whether `L3.reltio.json` has been fetched
