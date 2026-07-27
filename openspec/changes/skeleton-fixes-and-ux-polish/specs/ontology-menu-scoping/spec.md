## ADDED Requirements

### Requirement: Show Ontology context menu is scoped to entity and relation type folders only
The `reltio.showOntologyFromTree` command SHALL appear in the tree view context menu only when the selected node is the `entityTypesFolder` or `relationTypesFolder`. It SHALL NOT appear on individual entity/relation type items, attribute folders, source folders, or any other tree node.

#### Scenario: Context menu on Entity Types folder
- **WHEN** the user right-clicks the Entity Types folder node in the configuration tree
- **THEN** the "Show Ontology" menu item is visible

#### Scenario: Context menu on Relation Types folder
- **WHEN** the user right-clicks the Relation Types folder node in the configuration tree
- **THEN** the "Show Ontology" menu item is visible

#### Scenario: Context menu on an entity type item
- **WHEN** the user right-clicks an individual entity type node (not the folder)
- **THEN** the "Show Ontology" menu item is NOT visible

#### Scenario: Context menu on any other folder
- **WHEN** the user right-clicks any folder that is not entityTypesFolder or relationTypesFolder
- **THEN** the "Show Ontology" menu item is NOT visible
