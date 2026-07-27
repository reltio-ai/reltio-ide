## Why

Reltio metadata configurations define entity types, relationship types, reference attributes, and inheritance hierarchies — but reading these structures from a 13K-line JSON file is like reading a city map as a list of street addresses. Users need a visual overview of how entity types connect to each other through relationships, reference attributes, and inheritance before they can understand or modify the configuration confidently.

## What Changes

- Add `src/ontology/modelToGraph.ts` — transforms the parsed `ReltioBusinessModel` into a graph model (nodes for entity types, edges for relationships/references/inheritance) with attribute counts, match group stats, and visual flags
- Add `src/ontology/elkLayout.ts` — runs ELK.js layered layout algorithm (top-to-bottom) on the graph model, producing x/y positions for each node, with relationship edges prioritized over reference edges
- Add `src/ontology/layoutPersistence.ts` — reads/writes `.reltio.layout.json` files to persist user-arranged node positions
- Add `src/ontology/ontologyPanel.ts` — creates and manages a VS Code WebviewPanel (like Markdown Preview), handles message passing between extension and webview, triggers re-render on document changes
- Add `src/webview/ontologyView.ts` — vanilla JS + SVG rendering engine for the webview: draws entity type nodes (monochrome, with bold/dashed border variants), three edge styles (solid relationships, dashed references, dotted inheritance), zoom/pan/drag interaction, selection highlighting, and floating inspector overlay on double-click
- Add `src/webview/ontologyView.css` — styles for the webview
- Wire the "Ontology Preview" command into `src/extension.ts` and `package.json`

## Capabilities

### New Capabilities
- `ontology-preview`: Open a read-only graphical preview of any `.reltio.json` file as a webview tab, showing entity types as nodes connected by relationship types (solid arrows), reference attributes (dashed lines), and inheritance (dotted arrows from child to parent via `extendsTypeURI`). Dark theme with dot grid background
- `ontology-node-styles`: Entity types with `matchGroups` drawn with bold borders and "Consolidated" badge; entity types with `abstract: true` drawn with dashed borders; all others with normal solid borders. Node body shows total attributes, connections count, match rules, and consolidated/abstract badge
- `ontology-edge-styles`: Connection edges merge relationship and reference types between the same pair into a single orthogonal polyline edge. Edge labels describe the connection. Edges have wide invisible hit area for comfortable clicking
- `ontology-auto-layout`: Automatic hierarchical layout via ELK.js (top-to-bottom, relationship edges prioritized over reference edges), with manual repositioning via drag-and-drop
- `ontology-layout-persistence`: Node positions auto-saved to `.reltio.layout.json` on every drag; loaded on next preview open; "Reset Layout" command to re-run auto-layout
- `ontology-inspector`: Draggable, resizable, scrollable floating overlay on double-click showing recursive attribute tree (Simple with Name : Type, expandable Nested with sub-attributes, Reference with relation type URI / entity type URI / sub-attributes), match groups, and connections. Includes action buttons for "Show in Editor" and "Show in Tree View"
- `ontology-interaction`: Zoom (mouse wheel), pan (canvas drag), single-click selection for nodes and edges (with visual highlight), double-click inspector, custom right-click context menu with "Show in Editor" / "Show in Tree View" actions
- `ontology-tree-reveal`: "Show in Tree View" from ontology context menu or inspector reveals and selects the entity type in the Reltio sidebar tree view

### Modified Capabilities
- None — this change is purely additive

## Impact

- **New files**: `src/ontology/modelToGraph.ts`, `src/ontology/elkLayout.ts`, `src/ontology/layoutPersistence.ts`, `src/ontology/ontologyPanel.ts`, `src/webview/ontologyView.ts`, `src/webview/ontologyView.css`
- **Modified files**: `src/extension.ts` (register preview command), `package.json` (add command, menu entry, esbuild webview build script)
- **New dependencies**: `elkjs` (layout algorithm)
- **Build change**: Add second esbuild entry point for webview bundle (`src/webview/ontologyView.ts` → `dist/webview.js`)
- **Depends on**: Change 1 (`code-model-and-schema`) for TypeScript model types, Change 2 (`config-tree-view`) for `configParser.ts`
