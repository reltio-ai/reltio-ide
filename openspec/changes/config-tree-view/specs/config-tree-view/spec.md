## ADDED Requirements

### Requirement: Sidebar tree view with Reltio activity bar icon
The extension SHALL register a view container in the activity bar with a Reltio icon and a tree view named "Configuration" that displays the structure of the active `.reltio.json` file.

#### Scenario: Reltio icon appears in activity bar
- **WHEN** the extension is activated
- **THEN** a Reltio icon SHALL appear in the VS Code activity bar on the left side

#### Scenario: Tree view shows welcome message when no file open
- **WHEN** no `.reltio.json` file is open
- **THEN** the tree view SHALL display a welcome message prompting the user to open a `.reltio.json` file

### Requirement: Tree displays all 17 configuration sections
The tree view SHALL display the configuration as a hierarchy with top-level folders for all 17 sections defined in the Reltio Business Model: Entity Types, Attribute Types, Relation Types, Interaction Types, Group Types, Graph Types, Category Types, Hierarchy Types, Change Request Types, Roles, Match Actions, Survivorship Strategies, Sources, Ratings, Activity, Grouping Types. Empty sections SHALL be hidden.

#### Scenario: Entity types folder with children
- **WHEN** the configuration contains 3 entity types
- **THEN** the tree SHALL show an "Entity Types (3)" folder containing those three entity type nodes

#### Scenario: All 17 sections displayed when populated
- **WHEN** the configuration contains items in all 17 sections
- **THEN** the tree SHALL show a folder for each section with the correct item count

#### Scenario: Empty sections are hidden
- **WHEN** a section has no items (e.g., `hierarchyTypes` is absent or empty)
- **THEN** no folder SHALL appear for that section in the tree

### Requirement: Entity type nodes expand to show full internal structure
Entity type nodes SHALL expand to show all their internal structures: attributes (with recursive nesting), match groups, survivorship groups, association groups, surrogate crosswalks, cleanse config, rule-based attributes, hidden configs, unmerge config, indexing config, and data pipeline config.

#### Scenario: Entity type with attributes
- **WHEN** an entity type has 5 attributes
- **THEN** the entity type node SHALL expand to show an "Attributes (5)" folder containing those attribute nodes

#### Scenario: Nested attribute expansion
- **WHEN** an attribute has type Nested with sub-attributes "PhoneNumber" and "PhoneType"
- **THEN** the attribute node SHALL be expandable, revealing "PhoneNumber" and "PhoneType" as children

#### Scenario: Recursive nesting
- **WHEN** a nested attribute contains further nested attributes (3+ levels deep)
- **THEN** the tree SHALL display all levels correctly

#### Scenario: Entity type match groups
- **WHEN** an entity type has 2 match groups
- **THEN** the entity type node SHALL show a "Match Groups (2)" sub-folder

### Requirement: Relation types show endpoint information
Relation type nodes SHALL display the `startObject` and `endObject` endpoint types as a description (e.g., "Individual → Organization").

#### Scenario: Relation type with endpoints
- **WHEN** a relation type has `startObject.objectTypeURI` "configuration/entityTypes/Individual" and `endObject.objectTypeURI` "configuration/entityTypes/Organization"
- **THEN** the tree node SHALL display "Individual → Organization" as the description

#### Scenario: Reference attribute shows target
- **WHEN** an attribute has a `referencedEntityTypeURI` pointing to Location
- **THEN** the tree node SHALL display with description "Ref → Location"

### Requirement: Match groups expand to show rule tree
Match group nodes SHALL expand to show their rule structure, including the recursive composition of `or`, `and`, `not` sub-rules, and the operands (`exact`, `fuzzy`, etc.).

#### Scenario: Match rule with operands
- **WHEN** a match group has a rule with 3 `exact` operands
- **THEN** expanding the match group SHALL show the rule node, which expands to show the 3 exact operand entries

#### Scenario: Nested or/and/not rules
- **WHEN** a match rule contains `or` and `and` sub-rules
- **THEN** the tree SHALL display the composition as nested expandable nodes

### Requirement: Survivorship groups expand to show mappings
Survivorship group nodes SHALL expand to show their mapping structure, including recursive fallback strategies.

#### Scenario: Survivorship mapping with fallbacks
- **WHEN** a survivorship group has a mapping with 2 fallback strategies
- **THEN** expanding the survivorship group SHALL show the mapping, which expands to show the fallback strategies

### Requirement: Distinct icons per node type
The tree view SHALL display distinct VS Code codicons for each node type to provide visual differentiation.

#### Scenario: Entity type icon
- **WHEN** an entity type node is rendered
- **THEN** it SHALL display the `symbol-class` codicon

#### Scenario: Simple attribute icon
- **WHEN** a simple attribute is rendered
- **THEN** it SHALL display the `symbol-field` codicon

#### Scenario: Nested attribute icon
- **WHEN** a Nested attribute is rendered
- **THEN** it SHALL display the `symbol-struct` codicon

#### Scenario: Reference attribute icon
- **WHEN** a Reference attribute is rendered
- **THEN** it SHALL display the `references` codicon

#### Scenario: Relation type icon
- **WHEN** a relation type is rendered
- **THEN** it SHALL display the `git-compare` codicon

### Requirement: Tree auto-refreshes on document changes
The tree view SHALL automatically re-parse and refresh when the active `.reltio.json` document is edited or when the user switches to a different `.reltio.json` file.

#### Scenario: Edit triggers refresh
- **WHEN** the user adds a new entity type to the JSON
- **THEN** the tree SHALL update to show the new entity type without manual refresh

#### Scenario: Switching files updates tree
- **WHEN** the user switches from one `.reltio.json` file to another
- **THEN** the tree SHALL display the structure of the newly active file

### Requirement: Click-to-reveal navigation
Clicking a tree node SHALL scroll the JSON editor to the corresponding object and briefly highlight it.

#### Scenario: Click entity type reveals in editor
- **WHEN** the user clicks an entity type in the tree
- **THEN** the editor SHALL scroll to that entity type's JSON object and briefly highlight it

#### Scenario: Click nested sub-attribute reveals in editor
- **WHEN** the user clicks a deeply nested sub-attribute in the tree
- **THEN** the editor SHALL scroll to that specific sub-attribute within the JSON

#### Scenario: File not visible
- **WHEN** the JSON file is not currently visible in any editor tab
- **THEN** the extension SHALL open the file before revealing the location

### Requirement: Context menu for adding entity types
The tree SHALL provide an "Add Entity Type" action on the Entity Types folder that prompts for a name and inserts a new entity type object.

#### Scenario: Add entity type via context menu
- **WHEN** the user right-clicks the "Entity Types" folder and selects "Add Entity Type"
- **THEN** the extension SHALL prompt for a name, then insert a valid entity type JSON object with uri, label, and empty attributes array

### Requirement: Context menu for adding attributes
The tree SHALL provide an "Add Attribute" action on entity type nodes and nested attribute nodes.

#### Scenario: Add simple attribute
- **WHEN** the user selects "Add Attribute" on an entity type and enters name "Email" with type "String"
- **THEN** a new attribute object SHALL be inserted into the entity type's attributes array

#### Scenario: Add nested attribute
- **WHEN** the user selects "Add Attribute" and chooses type "Nested"
- **THEN** the inserted attribute SHALL include an empty `attributes` array

### Requirement: Context menu for deleting nodes
The tree SHALL provide a "Delete" action on deletable nodes that removes the corresponding JSON object after confirmation.

#### Scenario: Delete with confirmation
- **WHEN** the user selects "Delete" on an entity type
- **THEN** a confirmation dialog SHALL appear, and only upon confirmation SHALL the JSON object be removed

#### Scenario: Delete preserves valid JSON
- **WHEN** the user deletes an entity type from the middle of an array
- **THEN** the resulting JSON SHALL remain valid (proper comma handling)

### Requirement: Context menu for renaming nodes
The tree SHALL provide a "Rename" action that updates the `name`, `label`, and `uri` properties.

#### Scenario: Rename updates all fields
- **WHEN** the user renames an entity type from "Individual" to "Person"
- **THEN** the `label` and the last segment of `uri` SHALL both be updated

### Requirement: All tree edits integrate with undo/redo
All tree-initiated edits SHALL use `vscode.WorkspaceEdit` so they participate in the editor's undo/redo stack.

#### Scenario: Undo after add
- **WHEN** the user adds an entity type via the tree and then presses Ctrl+Z
- **THEN** the added entity type SHALL be removed and the tree SHALL update accordingly
