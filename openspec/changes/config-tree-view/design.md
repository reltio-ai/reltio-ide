## Context

Change 1 (`code-model-and-schema`) establishes TypeScript interfaces for the complete Reltio Business Model and a JSON Schema for validation. This change builds the tree view and cross-navigation layer on top of that code model.

Reltio metadata files are 1000+ line JSON documents with 17 top-level sections and deep nesting (entity types contain attributes that contain nested attributes, match groups contain recursive rule trees, survivorship groups contain mapping chains with fallback strategies). The tree view must present this hierarchy in a navigable sidebar with click-to-reveal and context menu editing.

## Goals / Non-Goals

**Goals:**
- Display all 17 configuration sections as a navigable tree hierarchy in a VS Code sidebar
- Provide click-to-reveal: clicking any tree node scrolls the JSON editor to that object
- Provide context menu actions (add, delete, rename) that integrate with VS Code's undo/redo
- Auto-refresh the tree on document edits and editor switches
- Handle recursive structures (nested attributes, match rule composition, survivorship fallback chains)

**Non-Goals:**
- Diagram visualization (separate future change)
- Drag-and-drop reordering of tree nodes
- Multi-file configuration (each `.reltio.json` is independent)
- Editor-to-tree sync (highlighting the tree node for the cursor position — future enhancement)

## Decisions

### D1: Parser bridges JSON text and code model
**Decision**: `configParser.ts` uses `jsonc-parser` to produce both a typed `ReltioBusinessModel` object (for tree content) and the raw AST root with offset/length positions (for editor navigation). A single `parseDocument(text: string)` call returns both.
**Rationale**: The tree needs typed data to know what children to show. The reveal command needs character offsets to position the cursor. Parsing once and returning both avoids double-parsing.
**Alternative considered**: Parse to model only, then re-parse for offsets on demand. Rejected — `jsonc-parser`'s `parseTree` already gives both for free.

### D2: Tree covers all 17 top-level sections
**Decision**: Each of the 17 sections from the XSD becomes a potential folder node at the tree's root level. Empty sections are hidden (no folder shown). Folder labels include item counts (e.g., "Entity Types (5)").
**Rationale**: Users need visibility into the complete configuration, not just the common sections. Hiding empties keeps the tree clean. Counts give a quick overview without expanding.

### D3: ConfigNodeType determines icons, labels, and context menus
**Decision**: Define a `ConfigNodeType` union type with one member per kind of node (root, entityTypesFolder, entityType, simpleAttribute, nestedAttribute, referenceAttribute, relationTypesFolder, relationType, matchGroupsFolder, matchGroup, matchRule, survivorshipGroupsFolder, survivorshipGroup, cleanseConfigFolder, source, etc.). Each type maps to a codicon, a label format, and a set of `contextValue` strings that control which context menu items appear.
**Rationale**: Adding a new node type is mechanical — define the type, pick an icon, specify available actions. The `contextValue` / `when`-clause system in VS Code menus means no if/else chains.

### D4: Tree editing via WorkspaceEdit
**Decision**: All add/delete/rename operations apply changes through `vscode.WorkspaceEdit`, not by rewriting the file.
**Rationale**: Integrates with VS Code's undo/redo stack, works with auto-save, and preserves the user's formatter settings. The parser's AST provides exact offsets for surgical edits.

### D5: Bidirectional navigation (tree-to-editor first)
**Decision**: Phase 1 implements tree-to-editor navigation (click node → scroll to JSON). Phase 2 (future) adds editor-to-tree navigation (cursor in JSON → highlight tree node).
**Rationale**: Tree-to-editor is simpler (node already stores the JSON path → `findNodeAtLocation` gives offset → `revealRange`). Editor-to-tree requires offset-to-JSON-path mapping and tree item lookup, which is more complex and can be added later.

### D6: Brief highlight on reveal
**Decision**: When reveal scrolls to a JSON object, apply a background highlight decoration for 1.5 seconds, then remove it.
**Rationale**: Without the flash, the user may not notice where the cursor landed in a dense file. The timeout avoids permanent visual clutter.

### D7: Activity bar icon and view registration
**Decision**: Register a custom view container in the activity bar with a Reltio icon (`resources/icons/reltio.svg`). The container holds one view: the configuration tree.
**Rationale**: A dedicated activity bar entry makes the extension discoverable. Users working with `.reltio.json` files can dock the sidebar for persistent navigation.

## Risks / Trade-offs

- **[Deep nesting performance]** Some configurations may have deeply nested attribute trees (5+ levels) or match rules with heavy or/and/not composition. → Mitigation: Tree items are created lazily (only when expanded). `getChildren` is called per-node, so unexpanded subtrees cost nothing.

- **[AST offset accuracy]** `jsonc-parser`'s `findNodeAtLocation` works with JSON path segments. If the JSON has duplicate keys (technically valid JSON), offsets may be ambiguous. → Mitigation: Reltio configs use arrays (not duplicate keys) for repeated items, so this is unlikely in practice.

- **[Edit command complexity]** Inserting/deleting array elements requires correct comma handling (trailing comma, empty array edge case). → Mitigation: An `insertIntoArray` helper encapsulates all comma/indentation logic. Delete uses `findNodeAtLocation` to get the exact range including surrounding separators.

- **[Icon availability]** VS Code's codicon set may not have perfect icons for all node types (e.g., cleanse groups, survivorship groups). → Mitigation: Use semantically close codicons (e.g., `shield` for survivorship, `beaker` for cleanse) and improve later if custom icons are warranted.
