## 1. Project Scaffold

- [ ] 1.1 Create package.json with extension manifest (name, publisher, engines, activationEvents, main entry point)
- [ ] 1.2 Create tsconfig.json for TypeScript compilation (Node16 module, ES2022 target, strict mode)
- [ ] 1.3 Create esbuild.config.mjs with `mainFields: ["module", "main"]` and `external: ["vscode"]`
- [ ] 1.4 Create .vscode/launch.json with extensionHost debug configuration
- [ ] 1.5 Create .vscode/tasks.json with npm watch build task
- [ ] 1.6 Install dependencies: jsonc-parser, @types/vscode, @types/node, esbuild, typescript
- [ ] 1.7 Create src/extension.ts with empty activate/deactivate functions
- [ ] 1.8 Verify extension builds and activates in Extension Development Host (F5)

## 2. JSON Schema Validation

- [ ] 2.1 Create schemas/reltio-metadata.schema.json with top-level properties (label, description, schemaVersion, entityTypes, relationTypes, matchGroups, survivorshipGroups, cleanseGroups, sources) and additionalProperties: false
- [ ] 2.2 Add EntityType definition (URI, label, name, description, attributes) with required fields and additionalProperties: false
- [ ] 2.3 Add Attribute definition with all 24+ type enum values and common properties (URI, name, label, type, hidden, required, description, faceted, cardinality, attributeOrdering, skipInDataAccess, defaultValue)
- [ ] 2.4 Add Nested attribute conditional properties (dataLabelPattern, matchFieldURIs, matchFieldURIsExactOrAllNull, matchFieldURIsExactOrNull, matchFieldURIsIgnoreCase, singleValue, singleValueByCrosswalk, matchOvOnly, recursive attributes array) with if/then requiring attributes array when type is Nested
- [ ] 2.5 Add Reference attribute conditional properties (relationshipTypeURI, referencedEntityTypeURI, referencedAttributeURIs, relationshipLabelPattern, doNotOverrideForSourceURIs, referenceAttributeDirection, immutable) with if/then requiring reference fields when type is Reference
- [ ] 2.6 Add RelationType definition (URI, label, name, startEntityType, endEntityType, attributes)
- [ ] 2.7 Add MatchGroup, MatchRule, MatchOperand definitions with comparator enum (Exact, Fuzzy, Phonetic, Metaphone, Soundex, Normalized)
- [ ] 2.8 Add SurvivorshipGroup, SurvivorshipRule definitions with strategy enum (MostFrequent, MostRecent, Longest, Shortest, SourcePriority, etc.)
- [ ] 2.9 Add CleanseGroup, CleanseRule definitions with cleanseFunction enum
- [ ] 2.10 Add Source definition (URI with pattern, name, label)
- [ ] 2.11 Add Cardinality, AttributeOrdering, SingleValueByCrosswalkSources sub-object definitions
- [ ] 2.12 Register schema via contributes.jsonValidation for *.reltio.json in package.json
- [ ] 2.13 Add $schema property to allowed top-level properties for inline schema references
- [ ] 2.14 Create samples/example.reltio.json with 3 entity types, 2 relation types, match groups, survivorship, cleanse groups, and sources
- [ ] 2.15 Verify validation errors appear for unknown properties and missing required fields

## 3. TypeScript Model and Parser

- [ ] 3.1 Create src/model/types.ts with interfaces: ReltioConfiguration, EntityType, RelationType, Attribute (with all optional fields for nested/reference/enum), MatchGroup, MatchRule, MatchOperand, SurvivorshipGroup, SurvivorshipRule, CleanseGroup, CleanseRule, Source, Cardinality, AttributeOrdering
- [ ] 3.2 Create src/parser/configParser.ts with parseConfig(text) returning typed config, errors, and AST root
- [ ] 3.3 Implement findNodeAtPath(text, jsonPath) returning {offset, length} using jsonc-parser findNodeAtLocation
- [ ] 3.4 Implement getJsonPathAtOffset(text, offset) returning JSONPath using jsonc-parser getLocation
- [ ] 3.5 Implement findArrayInsertionPoint(text, arrayPath) returning offset of closing bracket and array length
- [ ] 3.6 Implement findNodeRangeForDeletion(text, jsonPath) returning offset/length including surrounding commas
- [ ] 3.7 Implement findPropertyValue(text, objectPath, propertyName) returning value node location

## 4. Configuration Tree View

- [ ] 4.1 Create src/tree/treeNodes.ts with ConfigTreeItem class extending vscode.TreeItem, including jsonPath, nodeType, and contextValue for menu filtering
- [ ] 4.2 Define ConfigNodeType union type covering all node types (root, entityTypesFolder, entityType, simpleAttribute, nestedAttribute, referenceAttribute, relationTypesFolder, relationType, matchGroupsFolder, matchGroup, survivorshipGroupsFolder, survivorshipGroup, cleanseGroupsFolder, cleanseGroup, sourcesFolder, source)
- [ ] 4.3 Map each node type to a VS Code ThemeIcon (codicon) — symbol-class for entities, symbol-field for simple attributes, symbol-struct for nested, references for reference, git-compare for relations, etc.
- [ ] 4.4 Create src/tree/configTreeProvider.ts implementing TreeDataProvider with getTreeItem and getChildren
- [ ] 4.5 Implement getRootChildren returning top-level folders with item counts, hiding empty sections
- [ ] 4.6 Implement getEntityTypes, getRelationTypes, getMatchGroups, getSurvivorshipGroups, getCleanseGroups, getSources child providers
- [ ] 4.7 Implement nested attribute child resolution (getNestedAttributes) supporting recursive depth
- [ ] 4.8 Implement relation type attribute children and relation endpoint description (start → end)
- [ ] 4.9 Add setDocument(document) and refresh() methods with onDidChangeTreeData event emitter
- [ ] 4.10 Register viewsContainers (activitybar with Reltio icon) and views (reltioConfigTree) in package.json
- [ ] 4.11 Create resources/icons/reltio.svg for the activity bar icon
- [ ] 4.12 Add viewsWelcome message for when no .reltio.json file is open

## 5. Click-to-Reveal Navigation

- [ ] 5.1 Create src/commands/revealCommand.ts with revealInEditor function that maps tree node jsonPath to editor range
- [ ] 5.2 Register reltio.revealInEditor command in extension.ts
- [ ] 5.3 Set tree node command property to reltio.revealInEditor so clicking triggers reveal
- [ ] 5.4 Add brief highlight animation (1.5s decoration) on the revealed range
- [ ] 5.5 Handle case where the file is not visible — open it via showTextDocument before revealing

## 6. Tree Context Menu Actions

- [ ] 6.1 Create src/commands/editCommands.ts with addEntityType function (showInputBox for name/label, insert JSON via WorkspaceEdit)
- [ ] 6.2 Implement addRelationType function (prompt for name, insert with empty startEntityType/endEntityType)
- [ ] 6.3 Implement addAttribute function (prompt for name, showQuickPick for type, handle Nested/Reference defaults)
- [ ] 6.4 Implement deleteNode function (confirmation dialog, find range for deletion, apply WorkspaceEdit.delete)
- [ ] 6.5 Implement renameNode function (prompt for new name, update name/label/URI properties via WorkspaceEdit.replace)
- [ ] 6.6 Implement insertIntoArray helper for proper comma handling and indentation
- [ ] 6.7 Register all commands in package.json contributes.commands with icons
- [ ] 6.8 Register context menu items in package.json contributes.menus with viewItem when-clauses
- [ ] 6.9 Register all commands in extension.ts activate function

## 7. Extension Activation Wiring

- [ ] 7.1 Wire ConfigTreeProvider creation and TreeView registration in activate()
- [ ] 7.2 Subscribe to onDidChangeTextDocument to refresh tree on .reltio.json edits
- [ ] 7.3 Subscribe to onDidChangeActiveTextEditor to switch tree context to new .reltio.json files
- [ ] 7.4 Add startup scan of open documents to set initial document if .reltio.json is already open
- [ ] 7.5 Verify full end-to-end: F5 → open sample → tree populates → click reveals → context menu edits → undo works

## 8. Entity-Relationship Diagram

- [ ] 8.1 Create webview-ui/diagram/ directory with package.json, tsconfig, and vite config for React app
- [ ] 8.2 Install @xyflow/react and dagre dependencies in webview-ui/diagram
- [ ] 8.3 Create custom EntityNode component showing entity name and collapsible attribute list
- [ ] 8.4 Create custom RelationEdge component with label
- [ ] 8.5 Create App.tsx that receives config via postMessage and renders React Flow with nodes/edges
- [ ] 8.6 Implement dagre auto-layout for initial node positioning
- [ ] 8.7 Add minimap, controls, and background components from React Flow
- [ ] 8.8 Apply VS Code theme CSS variables for dark/light mode compatibility
- [ ] 8.9 Create src/diagram/diagramPanel.ts managing webview lifecycle (create, dispose, postMessage)
- [ ] 8.10 Register "Reltio: Show Diagram" command in package.json and extension.ts
- [ ] 8.11 Implement JSON → diagram sync (re-send config on document change)
- [ ] 8.12 Implement node click → postMessage → revealInEditor flow
- [ ] 8.13 Add esbuild config for webview bundle (separate entry point, output to dist/webview)
- [ ] 8.14 Verify diagram renders correctly with sample config in both light and dark themes

## 9. AI Assistant

- [ ] 9.1 Create src/ai/llmClient.ts with LlmClient interface (sendMessage returning AsyncIterable<string>)
- [ ] 9.2 Implement OpenAI adapter using openai npm package
- [ ] 9.3 Implement Anthropic adapter using @anthropic-ai/sdk
- [ ] 9.4 Implement Ollama adapter using fetch to local Ollama API
- [ ] 9.5 Add VS Code settings contribution for reltio.ai.provider, reltio.ai.apiKey, reltio.ai.model, reltio.ai.ollamaUrl
- [ ] 9.6 Create webview-ui/ai-chat/ directory with React app scaffold
- [ ] 9.7 Build chat UI with message list (user/assistant), input field, and send button
- [ ] 9.8 Render assistant messages as markdown with syntax-highlighted JSON code blocks
- [ ] 9.9 Add "Apply" button on JSON code blocks that sends content back to extension via postMessage
- [ ] 9.10 Create src/ai/aiPanel.ts managing chat webview lifecycle and message relay
- [ ] 9.11 Build system prompt including compact JSON schema and current file contents
- [ ] 9.12 Implement streaming: relay LLM tokens to webview via postMessage for progressive rendering
- [ ] 9.13 Implement "Apply" handler in extension: parse JSON from AI, insert into active document via WorkspaceEdit
- [ ] 9.14 Register "Reltio: Ask AI" command in package.json and extension.ts
- [ ] 9.15 Handle no-provider-configured state with helpful setup message in chat panel
- [ ] 9.16 Verify end-to-end: configure provider → ask question → receive streaming response → apply JSON to editor
