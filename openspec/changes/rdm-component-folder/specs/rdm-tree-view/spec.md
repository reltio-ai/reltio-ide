## MODIFIED Requirements

### Requirement: RDM nodes use a dedicated read-only context namespace

RDM tree nodes SHALL carry context values in a `reltio.rdm.*` namespace, distinct from the `reltio.item.*` and `reltio.folder.*` values used by L3 configuration nodes.

No RDM node SHALL offer the L3 Delete, Rename or Show in Ontology commands. Delete and Rename edit whichever document `tenantL3Uri` names, so reaching an RDM node with them would edit the wrong file; Show in Ontology renders entity and relation types, which RDM has none of.

RDM MAY offer commands of its own, scoped to `reltio.rdm.*` context values and acting on the RDM document — for example the authoring commands in `rdm-configuration-authoring`. The namespace separation is what keeps those distinct from the L3 commands, and becomes more important once the RDM document is writable, not less.

#### Scenario: L3 edit commands do not appear on RDM nodes

- **WHEN** the user opens the context menu on the RDM group, a configuration row, a section folder, or an entry
- **THEN** no Delete or Rename action SHALL be offered

#### Scenario: Context values cannot match the L3 edit patterns

- **WHEN** the context value of any RDM node is tested against the patterns that gate the Delete and Rename commands
- **THEN** it SHALL NOT match

#### Scenario: Ontology is not offered for RDM

- **WHEN** the user opens the context menu on the RDM group, a configuration row, or a section folder
- **THEN** Show in Ontology SHALL NOT be offered

#### Scenario: RDM's own commands act on the RDM document

- **WHEN** an RDM-scoped command modifies configuration
- **THEN** it SHALL edit the `RDM/{rdmTenantId}/config.json` the node came from
- **AND** SHALL NOT edit `L3.reltio.json`

### Requirement: A tenant's RDM configurations appear under a single RDM group

A tenant with at least one `RDM/{rdmTenantId}/config.json` in its folder SHALL show exactly one collapsible row labelled `RDM`, which groups that tenant's RDM configurations so they read as a single section alongside the L3 sections.

Under that group, each RDM configuration SHALL appear as a collapsible row labelled with its **RDM** tenant id taken from its subfolder name under `RDM/` — not the MDM tenant id, and without a prefix, since the group above already supplies the context.

#### Scenario: Group and configuration appear after a successful fetch

- **WHEN** a tenant folder contains `RDM/RdmSampleTenant/config.json`
- **THEN** the tenant node SHALL have a child labelled `RDM`
- **AND** expanding it SHALL show a row labelled `RdmSampleTenant`

#### Scenario: Several RDM tenants share one group

- **WHEN** a tenant folder contains RDM configurations for two different RDM tenant ids
- **THEN** a single `RDM` group SHALL appear
- **AND** it SHALL contain one row per file, each labelled with its own RDM tenant id
- **AND** those rows SHALL be ordered by RDM tenant id so the tree is stable across fetches

#### Scenario: No RDM configuration means no group

- **WHEN** a tenant folder's `RDM/` holds no subfolder with a `config.json`
- **THEN** no `RDM` group SHALL appear and the tenant's L3 sub-tree SHALL be unchanged

#### Scenario: Baseline files do not produce extra rows

- **WHEN** a tenant folder holds an RDM configuration, its baseline under `.reltio-ide/RDM/`, and the placeholder `RDM/README.md`
- **THEN** only one row SHALL appear for that RDM tenant

### Requirement: Show in Editor opens the RDM file at the selected node

RDM nodes SHALL offer **Show in Editor**, which opens the RDM configuration file the node came from — not the tenant's `L3.reltio.json` — and reveals the JSON range for that node.

#### Scenario: Revealing a lookup type

- **WHEN** the user runs Show in Editor on a lookup type node
- **THEN** the extension SHALL open that node's `RDM/{rdmTenantId}/config.json` if it is not already open
- **AND** SHALL reveal the range of that lookup type's JSON object

#### Scenario: Revealing from a tenant that also has L3 open

- **WHEN** the tenant's `L3.reltio.json` is the active editor and the user runs Show in Editor on an RDM node
- **THEN** the RDM file SHALL be opened and revealed, and the L3 document SHALL NOT be modified or scrolled
