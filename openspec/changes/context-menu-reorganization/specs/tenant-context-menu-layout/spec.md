## ADDED Requirements

### Requirement: Tenant context menu is organized into 4 ordered sections

When the user right-clicks a tenant node with a fetched configuration, the extension SHALL present the context menu with commands grouped into 4 sections, in this order:
1. Get Configuration, View Configuration History
2. Apply Configuration to Tenant
3. Add a new Entity Type, Add a new Relationship Type, Add a new Interaction Type, Add a new Hierarchy Type, Add a new Graph Type, Add a new Grouping Type, Add a new Source (in that order)
4. Copy Tenant ID, then Remove Tenant

#### Scenario: Copy Tenant ID appears second-to-last

- **WHEN** the user right-clicks a tenant node with a fetched configuration
- **THEN** **Copy Tenant ID** SHALL appear immediately before **Remove Tenant**, after every other section

#### Scenario: Add-a-new-Type actions appear in the specified order

- **WHEN** the user right-clicks a tenant node with a fetched configuration
- **THEN** the "Add a new X" actions SHALL appear in this order: Entity Type, Relationship Type, Interaction Type, Hierarchy Type, Graph Type, Grouping Type, Source

### Requirement: Insert commands are titled "Add a new X"

For every command that inserts a new configuration element (top-level types, attributes, match groups, survivorship groups, cleanse config), the extension SHALL title the command "Add a new X" rather than "Insert X". Command IDs SHALL remain unchanged.

#### Scenario: Relation type insert command is titled for a relationship

- **WHEN** the user views the command that adds a relation type (`reltio.addRelationType`)
- **THEN** its title SHALL read "Add a new Relationship Type"

### Requirement: Fetch-related tenant commands are retitled

The extension SHALL title `reltio.fetchL3` as "Get Configuration" and `reltio.fetchConfigurationHistory` as "View Configuration History".

#### Scenario: Get Configuration retains its command ID and behavior

- **WHEN** the user runs the command titled "Get Configuration"
- **THEN** it SHALL invoke `reltio.fetchL3`, unchanged in behavior from before this rename
