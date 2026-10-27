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
- **THEN** it SHALL edit the `RDM.{rdmTenantId}.reltio.json` the node came from
- **AND** SHALL NOT edit `L3.reltio.json`
