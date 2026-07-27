## Why

Even with JSON Schema validation, navigating a 1000+ line Reltio metadata configuration by scrolling is painful. The file contains 17 top-level sections, each with deeply nested structures (entity types with attributes, match groups with recursive rule trees, survivorship groups with mapping chains). A sidebar tree view showing the full hierarchy with click-to-reveal navigation and context menu editing turns a flat JSON file into a structured, navigable document.

## What Changes

- Add `src/parser/configParser.ts` — uses `jsonc-parser` to parse JSON text into a typed `ReltioBusinessModel` (from Change 1) plus an AST with offset/length positions
- Add `src/tree/treeNodes.ts` — `ConfigTreeItem` class and `ConfigNodeType` union type covering all node kinds
- Add `src/tree/configTreeProvider.ts` — implements `TreeDataProvider` with `getTreeItem` and `getChildren` for all 17 top-level sections and their nested structures
- Add `src/commands/revealCommand.ts` — click-to-reveal that scrolls the editor to the JSON object and briefly highlights it
- Add `src/commands/editCommands.ts` — add, delete, rename operations via `vscode.WorkspaceEdit` for undo/redo integration
- Register activity bar icon, tree view, commands, and context menus in `package.json`

## Capabilities

### New Capabilities
- `config-tree-view`: Sidebar tree view with hierarchical navigation across all 17 configuration sections, distinct icons per node type, click-to-reveal in editor, context menu actions (add entity type, add attribute, delete, rename), auto-refresh on edits, and undo/redo support via WorkspaceEdit

### Modified Capabilities

## Impact

- **New files**: `src/parser/configParser.ts`, `src/tree/treeNodes.ts`, `src/tree/configTreeProvider.ts`, `src/commands/revealCommand.ts`, `src/commands/editCommands.ts`, `resources/icons/reltio.svg`
- **Modified files**: `package.json` (add viewsContainers, views, commands, menus), `src/extension.ts` (wire tree provider, subscriptions)
- **Dependencies**: `jsonc-parser` (already added in Change 1)
- **Depends on**: Change 1 (`code-model-and-schema`) for TypeScript interfaces in `src/model/types.ts`
