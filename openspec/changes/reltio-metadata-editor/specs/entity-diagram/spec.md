## ADDED Requirements

### Requirement: Diagram opens via command
The extension SHALL register a command "Reltio: Show Diagram" that opens a webview panel displaying the entity-relationship diagram for the active `.reltio.json` file.

#### Scenario: Open diagram command
- **WHEN** the user runs "Reltio: Show Diagram" from the command palette
- **THEN** a webview panel SHALL open beside the editor showing the entity-relationship diagram

#### Scenario: No file open
- **WHEN** no `.reltio.json` file is open and the user runs "Reltio: Show Diagram"
- **THEN** the extension SHALL display an informational message that no configuration file is open

### Requirement: Entity types rendered as nodes
Each entity type in the configuration SHALL be rendered as a node in the diagram, displaying the entity type name and a collapsible list of its attributes.

#### Scenario: Entity node shows name and attributes
- **WHEN** the configuration has an "Individual" entity type with attributes FirstName, LastName, SSN
- **THEN** the diagram SHALL show an "Individual" node with those attribute names listed

#### Scenario: Attribute types shown in node
- **WHEN** an entity node lists its attributes
- **THEN** each attribute SHALL display its name and type (e.g., "FirstName: String", "Education: Nested")

### Requirement: Relation types rendered as edges
Each relation type in the configuration SHALL be rendered as a labeled edge connecting its start entity type node to its end entity type node.

#### Scenario: Relation edge between entities
- **WHEN** the configuration has a relation type "EmployedBy" with startEntityType Individual and endEntityType Organization
- **THEN** the diagram SHALL show a labeled edge "EmployedBy" from the Individual node to the Organization node

#### Scenario: Relation with no matching entity nodes
- **WHEN** a relation type references an entity type URI that does not exist in the configuration
- **THEN** the edge SHALL still be rendered with a placeholder or warning indicator

### Requirement: Auto-layout positions nodes
The diagram SHALL automatically position entity nodes using a directed graph layout algorithm (dagre or elkjs) so that nodes do not overlap and edges are readable.

#### Scenario: Initial layout
- **WHEN** the diagram first renders with 3 entity types and 2 relations
- **THEN** all nodes SHALL be visible without overlapping and edges SHALL not cross unnecessarily

### Requirement: Diagram supports zoom, pan, and minimap
The diagram SHALL support zoom in/out, panning, and display a minimap for navigation in large configurations.

#### Scenario: Zoom and pan
- **WHEN** the user scrolls or pinches on the diagram
- **THEN** the diagram SHALL zoom in/out and the user SHALL be able to pan by dragging the background

#### Scenario: Minimap navigation
- **WHEN** the configuration has many entity types
- **THEN** a minimap SHALL be visible in the corner showing the full diagram with a viewport indicator

### Requirement: Click node to reveal in editor
Clicking an entity type node in the diagram SHALL send a message to the extension host which reveals the corresponding entity type in the JSON editor.

#### Scenario: Click entity node
- **WHEN** the user clicks the "Organization" node in the diagram
- **THEN** the JSON editor SHALL scroll to and highlight the Organization entity type object

### Requirement: Diagram updates on JSON changes
The diagram SHALL update when the underlying `.reltio.json` file is modified in the editor.

#### Scenario: Add entity type in editor
- **WHEN** the user adds a new entity type in the JSON editor
- **THEN** the diagram SHALL re-render to include the new entity type node

### Requirement: Diagram respects VS Code theme
The diagram webview SHALL use VS Code theme CSS variables for colors so it renders correctly in both light and dark themes.

#### Scenario: Dark theme rendering
- **WHEN** the user has a dark VS Code theme active
- **THEN** the diagram background, node colors, and edge colors SHALL match the dark theme
