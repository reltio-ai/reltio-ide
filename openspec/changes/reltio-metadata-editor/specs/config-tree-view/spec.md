## ADDED Requirements

### Requirement: Sidebar tree view with Reltio activity bar icon
The extension SHALL register a view container in the activity bar with a Reltio icon and a tree view named "Configuration" that displays the structure of the active `.reltio.json` file.

#### Scenario: Reltio icon appears in activity bar
- **WHEN** the extension is activated
- **THEN** a Reltio icon SHALL appear in the VS Code activity bar on the left side

#### Scenario: Tree view shows welcome message when no file open
- **WHEN** no `.reltio.json` file is open
- **THEN** the tree view SHALL display a welcome message prompting the user to open a `.reltio.json` file

### Requirement: Tree displays full configuration hierarchy
The tree view SHALL display the configuration as a hierarchy: top-level folders (Entity Types, Relation Types, Match Groups, Survivorship Groups, Cleanse Groups, Sources) containing their respective items, with entity types expanding to show attributes and nested attributes expanding to show sub-attributes.

#### Scenario: Entity types folder with children
- **WHEN** the configuration contains 3 entity types (Individual, Organization, Location)
- **THEN** the tree SHALL show an "Entity Types" folder with count "3" containing those three entity type nodes

#### Scenario: Nested attribute expansion
- **WHEN** an entity type has a Nested attribute "Phone" with sub-attributes "PhoneNumber" and "PhoneType"
- **THEN** the "Phone" node SHALL be expandable, revealing "PhoneNumber" and "PhoneType" as children

#### Scenario: Relation types show endpoints
- **WHEN** a relation type "HasAddress" connects Individual to Location
- **THEN** the tree node SHALL display "HasAddress" with description "Individual → Location"

#### Scenario: Reference attribute shows target
- **WHEN** an attribute has type Reference pointing to entity type Location
- **THEN** the tree node SHALL display with description "Ref → Location"

#### Scenario: Empty sections are hidden
- **WHEN** the configuration has no `cleanseGroups` array (or it is empty)
- **THEN** no "Cleanse Groups" folder SHALL appear in the tree

### Requirement: Distinct icons per node type
The tree view SHALL display distinct icons for each node type: entity types, relation types, simple attributes, nested attributes, reference attributes, match groups, survivorship groups, cleanse groups, and sources.

#### Scenario: Entity type icon
- **WHEN** an entity type node is rendered
- **THEN** it SHALL display the `symbol-class` codicon

#### Scenario: Simple attribute icon
- **WHEN** a simple attribute (e.g., String, Int) is rendered
- **THEN** it SHALL display the `symbol-field` codicon

#### Scenario: Nested attribute icon
- **WHEN** a Nested attribute is rendered
- **THEN** it SHALL display the `symbol-struct` codicon

### Requirement: Tree auto-refreshes on document changes
The tree view SHALL automatically re-parse and refresh when the active `.reltio.json` document is edited or when the user switches to a different `.reltio.json` file.

#### Scenario: Edit triggers refresh
- **WHEN** the user adds a new entity type to the JSON
- **THEN** the tree SHALL update to show the new entity type without manual refresh

#### Scenario: Switching files updates tree
- **WHEN** the user switches from one `.reltio.json` file to another
- **THEN** the tree SHALL display the structure of the newly active file

### Requirement: Click-to-reveal navigation
Clicking a tree node (entity type, attribute, relation type, match group, etc.) SHALL scroll the editor to the corresponding JSON object and briefly highlight it.

#### Scenario: Click entity type reveals in editor
- **WHEN** the user clicks the "Individual" entity type in the tree
- **THEN** the editor SHALL scroll to the Individual entity type object and position the cursor at its start

#### Scenario: Click nested sub-attribute reveals in editor
- **WHEN** the user clicks the "University" sub-attribute under Education in the tree
- **THEN** the editor SHALL scroll to that specific sub-attribute within the nested Education attribute

### Requirement: Context menu for adding entity types
The tree SHALL provide an "Add Entity Type" action on the Entity Types folder that prompts for a name and inserts a new entity type object into the `entityTypes` array.

#### Scenario: Add entity type via context menu
- **WHEN** the user right-clicks the "Entity Types" folder and selects "Add Entity Type"
- **THEN** the extension SHALL prompt for a name, then insert a valid entity type JSON object with URI, label, name, and empty attributes array

#### Scenario: Add entity type with validation
- **WHEN** the user enters an invalid name (e.g., containing spaces or starting with a number)
- **THEN** the input SHALL display a validation error and not proceed

### Requirement: Context menu for adding attributes
The tree SHALL provide an "Add Attribute" action on entity type nodes and nested attribute nodes that prompts for name and type, then inserts a new attribute object.

#### Scenario: Add simple attribute
- **WHEN** the user selects "Add Attribute" on the Individual entity type and chooses name "Email" with type "String"
- **THEN** a new attribute object SHALL be inserted into Individual's attributes array with correct URI, name, label, and type

#### Scenario: Add nested attribute
- **WHEN** the user selects "Add Attribute" and chooses type "Nested"
- **THEN** the inserted attribute SHALL include `dataLabelPattern` and an empty `attributes` array

### Requirement: Context menu for deleting nodes
The tree SHALL provide a "Delete" action on entity types, attributes, and relation types that removes the corresponding JSON object after confirmation.

#### Scenario: Delete with confirmation
- **WHEN** the user selects "Delete" on an entity type
- **THEN** a confirmation dialog SHALL appear, and only upon confirmation SHALL the JSON object be removed

#### Scenario: Delete preserves valid JSON
- **WHEN** the user deletes an entity type from the middle of the array
- **THEN** the resulting JSON SHALL remain valid (proper comma handling)

### Requirement: Context menu for renaming nodes
The tree SHALL provide a "Rename" action on entity types, attributes, and relation types that updates the `name`, `label`, and `URI` properties.

#### Scenario: Rename updates all fields
- **WHEN** the user renames an entity type from "Individual" to "Person"
- **THEN** the `name`, `label`, and the last segment of `URI` SHALL all be updated to "Person"

### Requirement: All tree edits integrate with undo/redo
All tree-initiated edits (add, delete, rename) SHALL use `vscode.WorkspaceEdit` so they participate in the editor's undo/redo stack.

#### Scenario: Undo after add
- **WHEN** the user adds an entity type via the tree and then presses Ctrl+Z
- **THEN** the added entity type SHALL be removed and the tree SHALL update accordingly
