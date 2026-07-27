## 1. Tree Node Model

- [x] 1.1 Create `src/tree/treeNodes.ts` with `ConfigTreeItem` class extending `vscode.TreeItem`, including `jsonPath: (string | number)[]`, `nodeType: ConfigNodeType`, and `contextValue` for menu filtering
- [x] 1.2 Define `ConfigNodeType` union type covering all node types: root, entityTypesFolder, entityType, attributesFolder, simpleAttribute, nestedAttribute, referenceAttribute, relationTypesFolder, relationType, matchGroupsFolder, matchGroup, matchRule, survivorshipGroupsFolder, survivorshipGroup, survivorshipMapping, cleanseConfigFolder, cleanseInfo, sourcesFolder, source, attributeTypesFolder, attributeTypeDefinition, changeRequestTypesFolder, changeRequestType, rolesFolder, role, groupTypesFolder, groupType, matchActionsFolder, matchAction, interactionTypesFolder, interactionType, graphTypesFolder, graphType, categoryTypesFolder, categoryType, hierarchyTypesFolder, hierarchyType, survivorshipStrategiesFolder, survivorshipStrategy, ratingsFolder, rating, activityFolder, groupingTypesFolder, groupingType, associationGroupsFolder, associationGroup, surrogateCrosswalksFolder, surrogateCrosswalk, ruleBasedAttributesFolder, ruleBasedAttribute, dependentAttributesFolder, dependentAttribute, indexingConfig, dataPipelineConfig, unmerge, hiddenConfig, matchAssets
- [x] 1.3 Map each node type to a VS Code codicon: `symbol-class` for entity types, `symbol-field` for simple attributes, `symbol-struct` for nested attributes, `references` for reference attributes, `git-compare` for relation types, `search` for match groups, `shield` for survivorship groups, `beaker` for cleanse, `database` for sources, `key` for roles, `group-by-ref-type` for group types, `graph` for graph types, `tag` for category types, `list-tree` for hierarchy types, `pulse` for interaction types, `star` for ratings, `activity-bar` for activity, `layers` for grouping types, `symbol-type-parameter` for attribute type definitions, `request-changes` for change request types, `zap` for match actions, `link` for survivorship strategies

## 2. Configuration Parser

- [x] 2.1 Create `src/parser/configParser.ts` exporting `parseDocument(text: string)` returning `{ model: ReltioBusinessModel; ast: Node; errors: ParseError[] }` using `jsonc-parser` `parseTree` and `parse`
- [x] 2.2 Export `findNodeAtPath(ast: Node, path: (string | number)[]): Node | undefined` wrapping `findNodeAtLocation`
- [x] 2.3 Export `getJsonPathAtOffset(ast: Node, offset: number): (string | number)[]` wrapping `getLocation`
- [x] 2.4 Export `findArrayInsertionPoint(ast: Node, arrayPath: (string | number)[]): { offset: number; isEmpty: boolean }` for edit commands
- [x] 2.5 Export `findNodeRangeForDeletion(text: string, ast: Node, path: (string | number)[]): { offset: number; length: number }` that includes surrounding comma/whitespace

## 3. Tree Data Provider

- [x] 3.1 Create `src/tree/configTreeProvider.ts` implementing `vscode.TreeDataProvider<ConfigTreeItem>` with `getTreeItem` and `getChildren`
- [x] 3.2 Implement `getRootChildren()` returning folder nodes for each non-empty top-level section, with item counts in labels (e.g., "Entity Types (5)")
- [x] 3.3 Implement child providers for all 17 top-level sections:
  - Entity types → attributes (recursive), matchGroups, survivorshipGroups, associationGroups, surrogateCrosswalks, cleanseConfig, ruleBasedAttributes, hidden, unmerge, indexingConfig, dataPipelineConfig
  - Relation types → attributes, startObject/endObject (show as description "Start → End"), survivorshipGroups
  - Match groups → rule tree (recursive or/and/not), matchTokenClasses, comparatorClasses
  - Survivorship groups → mapping (recursive fallbackStrategies)
  - All other sections → their respective child structures
- [x] 3.4 Implement recursive attribute nesting: `getNestedAttributes()` that returns child attribute nodes when a Nested attribute is expanded
- [x] 3.5 Implement match rule tree: `getMatchRuleChildren()` that returns or/and/not sub-rules, exact/fuzzy operands, comparatorClasses, matchTokenClasses
- [x] 3.6 Add `setDocument(document: vscode.TextDocument)` and `refresh()` methods with `onDidChangeTreeData` event emitter

## 4. Click-to-Reveal Navigation

- [x] 4.1 Create `src/commands/revealCommand.ts` with `revealInEditor(item: ConfigTreeItem)` that maps `jsonPath` to an editor range via `findNodeAtPath`
- [x] 4.2 Apply a brief highlight decoration (1.5s background color) on the revealed range, then remove it
- [x] 4.3 Handle case where the file is not visible — open it via `vscode.window.showTextDocument` before revealing
- [x] 4.4 Register `reltio.revealInEditor` command and set tree node `command` property to trigger it on click

## 5. Context Menu Actions

- [x] 5.1 Create `src/commands/editCommands.ts` with `addEntityType()`: show input box for name, validate, insert entity type JSON with uri/label/attributes via `WorkspaceEdit`
- [x] 5.2 Add `addRelationType()`: prompt for name, insert with empty startObject/endObject
- [x] 5.3 Add `addAttribute(parentItem: ConfigTreeItem)`: prompt for name, quick pick for type, handle Nested (add empty attributes array) and Reference (add required reference fields) defaults
- [x] 5.4 Add `deleteNode(item: ConfigTreeItem)`: confirmation dialog, find deletion range (including comma handling), apply `WorkspaceEdit.delete`
- [x] 5.5 Add `renameNode(item: ConfigTreeItem)`: prompt for new name, update name/label/URI via `WorkspaceEdit.replace`
- [x] 5.6 Implement `insertIntoArray` helper for proper comma handling, indentation detection, and empty-array edge case
- [x] 5.7 Register all commands in `package.json` `contributes.commands` with icons
- [x] 5.8 Register context menu items in `package.json` `contributes.menus` with `viewItem` when-clauses matching `contextValue` from node types

## 6. Extension Wiring

- [x] 6.1 Wire `ConfigTreeProvider` creation and `vscode.window.createTreeView` registration in `activate()`
- [x] 6.2 Subscribe to `vscode.workspace.onDidChangeTextDocument` to refresh tree on `.reltio.json` edits (with debounce)
- [x] 6.3 Subscribe to `vscode.window.onDidChangeActiveTextEditor` to switch tree context to new `.reltio.json` files
- [x] 6.4 Add startup scan of open editors to set initial document if a `.reltio.json` file is already open
- [x] 6.5 Register `viewsContainers` (activitybar with Reltio icon) and `views` (reltioConfigTree) in `package.json`
- [x] 6.6 Create `resources/icons/reltio.svg` for the activity bar icon
- [x] 6.7 Add `viewsWelcome` message for when no `.reltio.json` file is open

## 7. Verification

- [ ] 7.1 Verify full end-to-end: F5 → open sample `.reltio.json` → tree populates with all sections → click node reveals in editor → context menu adds/deletes/renames → undo works
- [ ] 7.2 Verify empty sections are hidden from tree
- [ ] 7.3 Verify tree refreshes on document edit and editor switch
