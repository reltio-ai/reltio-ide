## ADDED Requirements

### Requirement: A tenant's RDM configurations appear under a single RDM group

A tenant with at least one `RDM.{rdmTenantId}.reltio.json` in its folder SHALL show exactly one collapsible row labelled `RDM`, which groups that tenant's RDM configurations so they read as a single section alongside the L3 sections.

Under that group, each RDM configuration file SHALL appear as a collapsible row labelled with its **RDM** tenant id taken from the file name — not the MDM tenant id, and without a prefix, since the group above already supplies the context.

#### Scenario: Group and configuration appear after a successful fetch

- **WHEN** a tenant folder contains `RDM.RdmSampleTenant.reltio.json`
- **THEN** the tenant node SHALL have a child labelled `RDM`
- **AND** expanding it SHALL show a row labelled `RdmSampleTenant`

#### Scenario: Several RDM tenants share one group

- **WHEN** a tenant folder contains RDM configurations for two different RDM tenant ids
- **THEN** a single `RDM` group SHALL appear
- **AND** it SHALL contain one row per file, each labelled with its own RDM tenant id
- **AND** those rows SHALL be ordered by RDM tenant id so the tree is stable across fetches

#### Scenario: No RDM configuration means no group

- **WHEN** a tenant folder contains no `RDM.*.reltio.json`
- **THEN** no `RDM` group SHALL appear and the tenant's L3 sub-tree SHALL be unchanged

#### Scenario: Baseline files do not produce extra rows

- **WHEN** a tenant folder contains `RDM.{rdmTenantId}.remote-baseline.reltio.json` beside the configuration it shadows
- **THEN** only one row SHALL appear for that RDM tenant

### Requirement: The RDM group is placed after the L3 sections

The `RDM` group SHALL appear below the tenant's L3 configuration sections, so that the position and behaviour of the existing L3 sub-tree are unchanged.

#### Scenario: Ordering under a tenant

- **WHEN** a tenant has a readable `L3.reltio.json` and at least one RDM configuration
- **THEN** the tenant's children SHALL be ordered: configuration history (when shown), then the L3 sections, then the `RDM` group

### Requirement: RDM sections appear as counted folders

An RDM configuration row SHALL expand to one folder per recognized array-valued section of the configuration — `lookupTypes` as **Lookup Types** and `sources` as **Sources** — each labelled with the number of entries it contains, matching how L3 sections are rendered.

A section that is absent or empty SHALL be omitted rather than shown as an empty folder. A section the extension does not recognize SHALL be omitted rather than rendered generically, because RDM configurations vary per tenant and an unrecognized array cannot be labelled meaningfully.

#### Scenario: Populated sections are listed with counts

- **WHEN** an RDM configuration has 59 lookup types and 12 sources
- **THEN** that row SHALL expand to `Lookup Types (59)` and `Sources (12)`

#### Scenario: Empty sections are omitted

- **WHEN** an RDM configuration has an empty `sources` array
- **THEN** no Sources folder SHALL appear under that row

### Requirement: Lookup types and sources appear as leaf nodes

Each entry in a section SHALL appear as a leaf node labelled by its `label`, falling back to the trailing segment of its `uri` when `label` is absent, with the full `uri` shown as the node's description.

Entries SHALL NOT be expandable: every field of a lookup type and of a source is a scalar value, and lookup *values* are served by a different endpoint and are not present in this payload.

#### Scenario: Entry labelled by label with uri as description

- **WHEN** a lookup type is `{ "uri": "rdm/lookupTypes/MaritalStatuses", "label": "MaritalStatuses" }`
- **THEN** the node SHALL be labelled `MaritalStatuses` and SHALL show `rdm/lookupTypes/MaritalStatuses` as its description

#### Scenario: Entry without a label falls back to the uri tail

- **WHEN** a source has `uri` of `rdm/sources/SAP` and no `label`
- **THEN** the node SHALL be labelled `SAP`

#### Scenario: Entries are leaves

- **WHEN** the user views any lookup type or source node
- **THEN** it SHALL have no expand affordance

### Requirement: RDM nodes use a dedicated read-only context namespace

RDM tree nodes SHALL carry context values in a `reltio.rdm.*` namespace, distinct from the `reltio.item.*` and `reltio.folder.*` values used by L3 configuration nodes.

Consequently no RDM node SHALL offer Delete, Rename, any "Add a new …" command, or Show in Ontology. The extension cannot write RDM configurations back to the RDM service, so an edit made through the tree could only produce local divergence that the next fetch discards.

#### Scenario: Edit commands do not appear on RDM nodes

- **WHEN** the user opens the context menu on the RDM group, a configuration row, a section folder, or an entry
- **THEN** no Delete, Rename, or "Add a new …" action SHALL be offered

#### Scenario: Context values cannot match the L3 edit patterns

- **WHEN** the context value of any RDM node is tested against the patterns that gate the Delete and Rename commands
- **THEN** it SHALL NOT match

#### Scenario: Ontology is not offered for RDM

- **WHEN** the user opens the context menu on the RDM group, a configuration row, or a section folder
- **THEN** Show in Ontology SHALL NOT be offered

### Requirement: Show in Editor opens the RDM file at the selected node

RDM nodes SHALL offer **Show in Editor**, which opens the RDM configuration file the node came from — not the tenant's `L3.reltio.json` — and reveals the JSON range for that node.

#### Scenario: Revealing a lookup type

- **WHEN** the user runs Show in Editor on a lookup type node
- **THEN** the extension SHALL open that node's `RDM.{rdmTenantId}.reltio.json` if it is not already open
- **AND** SHALL reveal the range of that lookup type's JSON object

#### Scenario: Revealing from a tenant that also has L3 open

- **WHEN** the tenant's `L3.reltio.json` is the active editor and the user runs Show in Editor on an RDM node
- **THEN** the RDM file SHALL be opened and revealed, and the L3 document SHALL NOT be modified or scrolled

### Requirement: An unreadable RDM configuration still shows its root

An RDM file that cannot be parsed SHALL still contribute a root node, marked as unreadable and expanding to nothing, rather than being omitted from the tree.

Omitting it silently would leave a user who has just fetched successfully with no indication of why the data is missing.

#### Scenario: Unparsable file

- **WHEN** an `RDM.*.reltio.json` in the tenant folder is not valid JSON
- **THEN** a root SHALL still appear for it, indicating that it could not be read
- **AND** expanding it SHALL yield no children
- **AND** Show in Editor SHALL still open the file so the user can inspect it
