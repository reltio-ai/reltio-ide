## Context

Changes 1–3 established TypeScript interfaces for the Reltio Business Model, a JSON Schema for validation, a tree view for sidebar navigation, and URI-based go-to-definition / find-all-references. This change adds a graphical ontology preview — a read-only diagram showing entity types as nodes connected by relationships, reference attributes, and inheritance, rendered in a VS Code webview panel.

The example project in `ontology-editor-example/` demonstrates a similar visualization using React Flow + ELK. We use that as a visual reference only. Our implementation uses vanilla JS + SVG for minimal dependencies.

In `ppl-example.reltio.json`: 4 entity types (Merchant, Organization, Location, FinancialAccount), 9 relationship types, 5 reference attributes creating cross-entity connections, and no inheritance (`extendsTypeURI` not used in this sample).

## Goals / Non-Goals

**Goals:**
- Provide a read-only graphical preview of the data model opened via explicit command
- Show entity types as monochrome rectangular nodes with label, attribute counts (simple/nested/reference), and match group count
- Show three types of connections: relationship types (solid arrows), reference attributes (dashed lines), and inheritance via `extendsTypeURI` (dotted arrows)
- Distinguish consolidated profiles (bold border, has matchGroups) and abstract types (dashed border)
- Automatic hierarchical layout via ELK.js with relationship edges prioritized
- Manual repositioning with auto-save to `.reltio.layout.json`
- Inspector overlay on double-click showing entity/relationship/attribute tree structure
- Zoom, pan, single-click selection, drag to reposition

**Non-Goals:**
- Editing the data model from the ontology view (read-only)
- Color-coded nodes (monochrome only for now)
- Showing relation types, sources, survivorship, or other non-entity sections as nodes
- Auto-opening the preview when a file is opened
- Cross-file ontology views (each `.reltio.json` is independent)

## Decisions

### D1: Vanilla JS + SVG for webview rendering
**Decision**: The webview renders the graph using plain JavaScript manipulating SVG elements directly. No React, no React Flow, no framework.
**Rationale**: The view is read-only with ~5-20 nodes. The interactions needed (zoom, pan, drag, click, double-click) are straightforward with SVG + pointer events. This keeps the bundle small (~10KB own code + ~400KB ELK) and avoids framework complexity. The example project uses React Flow but that brings ~250KB of unused editing capabilities.

### D2: ELK.js runs in the extension host
**Decision**: The ELK layout algorithm runs in the extension host (Node.js), not in the webview. The extension computes node positions and sends them to the webview as part of the graph data.
**Rationale**: The extension already parses the model, so it can build the graph and compute layout in one step. This keeps the webview thin — it only receives positioned data and renders it. ELK.js works in Node.js natively. The webview only needs to handle re-layout when the user clicks "Reset Layout" (sends a message to the extension, which re-runs ELK and sends back new positions).

### D3: Graph model as the intermediate representation
**Decision**: A `GraphModel` type serves as the bridge between the parsed `ReltioBusinessModel` and the webview. It contains `nodes: GraphNode[]` (entity types with position, label, stats, flags) and `edges: GraphEdge[]` (connections with type, label, source, target). The extension builds this, the webview renders it.
**Rationale**: Clean separation of concerns. The model transformation (`modelToGraph.ts`) is testable without a webview. The webview rendering (`ontologyView.ts`) is independent of Reltio-specific parsing. The `GraphModel` is serializable for `postMessage`.

### D4: WebviewPanel with retainContextWhenHidden
**Decision**: The ontology preview uses `vscode.window.createWebviewPanel` with `retainContextWhenHidden: true`, opened in `ViewColumn.Beside`. The panel title shows "Ontology: <filename>". One panel per document — re-opening the command for the same file focuses the existing panel.
**Rationale**: `retainContextWhenHidden` preserves the webview state (zoom level, scroll position, inspector state) when the user switches tabs. `ViewColumn.Beside` gives side-by-side viewing with the JSON source. One-panel-per-document avoids confusion from multiple previews of the same file.

### D5: Three edge types with distinct visual styles
**Decision**: Edges are drawn as SVG `<path>` elements with marker arrows. Relationship types: solid stroke, filled arrowhead, from `startObject.objectTypeURI` to `endObject.objectTypeURI`. Reference attributes: dashed stroke (`stroke-dasharray: 6 4`), open arrowhead, from owning entity to referenced entity. Inheritance: dotted stroke (`stroke-dasharray: 2 3`), open arrowhead, from child entity to parent (via `extendsTypeURI`). Same entity pair with multiple connections → multiple parallel edges offset vertically.
**Rationale**: Three visually distinct connection types match the three semantic relationships in the data model. Parallel edges for the same pair (e.g., both a relationship and a reference between Merchant and Location) are drawn separately as requested, offset to avoid overlap.

### D6: Node visual rules
**Decision**: All nodes are monochrome (black border, white fill, black text). Normal entity types: 2px solid border. Consolidated profiles (entity types with non-empty `matchGroups` and `abstract !== true`): 3px solid border with "★ Consolidated" badge. Abstract entity types (`abstract: true`): 2px dashed border — always dashed regardless of matchGroups presence. Node body shows: label on the first line, attribute counts on the second line (`{N}A · {N}N · {N}R`), match group count (`M:{N}`) if matchGroups present.
**Rationale**: Monochrome keeps the view clean and accessible. The three border styles (normal/bold/dashed) create immediate visual hierarchy. Abstract types are always dashed because abstractness is a fundamental type property that should always be visible.

### D7: Layout persistence to .reltio.layout.json
**Decision**: Node positions are auto-saved to a `.reltio.layout.json` file (sibling to the `.reltio.json` file) on every drag-end event. The file stores `{ version: 1, positions: { [entityName]: { x, y } } }`. On preview open, if the layout file exists and covers all current entity types, positions are loaded from it. If new entity types are present or no layout file exists, ELK auto-layout runs. A "Reset Layout" command re-runs ELK and overwrites the layout file.
**Rationale**: Auto-save on drag means the user never loses their arrangement. A separate file avoids modifying the `.reltio.json` itself. The version field allows future format changes. Checking coverage (all entity types have positions) handles the case where new entity types are added to the config after the layout was saved.

### D8: Inspector as floating overlay
**Decision**: Double-clicking a node or edge opens a floating overlay panel positioned near the clicked element. The overlay is an HTML `<div>` absolutely positioned on the webview, max 25% of the canvas dimensions, with a large "×" close button in the top-right corner. Content is a collapsible tree view (HTML `<details>`/`<summary>` elements) showing the entity type's attributes, match groups, and survivorship groups (for entities), or relationship structure (for relationship edges), or reference attribute structure (for reference edges). Only one inspector is open at a time — opening a new one closes the previous.
**Rationale**: A floating overlay keeps the graph visible while inspecting details. `<details>`/`<summary>` provides native collapsible tree behavior without a framework. The 1/4 size limit prevents the inspector from obscuring the diagram. Single-inspector-at-a-time avoids clutter.

### D9: Zoom, pan, and selection interaction
**Decision**: Zoom via mouse wheel (scaling the SVG `viewBox`). Pan via mouse drag on the canvas background (translating the `viewBox`). Single-click on a node selects it (adds a highlight border — e.g., 2px blue outline). Single-click on canvas deselects. Selected nodes can be dragged to reposition. Double-click opens inspector. All interaction is handled via SVG pointer events in vanilla JS.
**Rationale**: Standard diagram interaction patterns. viewBox manipulation for zoom/pan is the simplest SVG approach and works well for the scale of diagrams we're rendering (5-20 nodes).

### D10: Separate esbuild entry point for webview
**Decision**: Add a second esbuild entry in the build script: `src/webview/ontologyView.ts → dist/webview.js`. The webview HTML template is inlined in `ontologyPanel.ts` (no separate HTML file) and references `dist/webview.js` via `webview.asWebviewUri`. CSS is either inlined or loaded from `dist/webview.css` (esbuild can bundle CSS).
**Rationale**: Two entry points keep the extension host code and webview code in separate bundles. esbuild handles both. Inlining the HTML template avoids managing a separate HTML file and allows dynamic CSP nonce injection for the webview's Content Security Policy.

### D11: Message protocol between extension and webview
**Decision**: The extension sends messages to the webview with typed payloads: `{ type: 'setGraph', graph: GraphModel }` (initial render + updates), `{ type: 'setPositions', positions: Record<string, {x,y}> }` (after ELK layout). The webview sends messages back: `{ type: 'savePositions', positions: Record<string, {x,y}> }` (on drag end), `{ type: 'requestResetLayout' }` (user clicks Reset Layout). The extension listens for webview messages and dispatches accordingly.
**Rationale**: Typed message protocol makes the extension↔webview boundary explicit and debuggable. Keeping it to a small set of message types (4) keeps the interface simple.

### D12: Dark theme with dot grid background (Bugfix Round 1)
**Decision**: The webview uses a dark color scheme (`#1a1a2e` background, `#16213e` node fill, `#0f3460` header fill, light text/strokes) with a dot grid pattern (`rgba(255,255,255,0.12)` dots at 20px spacing) covering the entire visible area.
**Rationale**: Dark theme is consistent with typical VS Code usage. The dot grid provides spatial orientation during pan/zoom and signals that the canvas is infinite. The grid rect is sized 3x beyond the viewBox to prevent gaps at edges.

### D13: Edge hit area for click detection (Bugfix Round 1)
**Decision**: Each edge has an invisible 14px-wide `<path>` with class `.edge-hit` and `pointer-events: stroke` rendered behind the visible 2px path (which has `pointer-events: none`).
**Rationale**: Thin SVG paths are nearly impossible to click precisely. The wide invisible path provides a comfortable click target. The visible path disables pointer events so clicks pass through to the hit area. The `.edge-hit` class allows CSS targeting independent of the visible path styles.

### D14: Manual double-click detection (Bugfix Round 1)
**Decision**: Double-click is detected manually via timer-based logic in `onPointerUp` (tracking `lastClickId`, `lastClickKind`, `lastClickTime` with a 350ms window) rather than using the browser's native `dblclick` event.
**Rationale**: The `render()` function destroys and recreates all SVG DOM elements. When `onPointerDown` triggers a selection change and calls `render()`, the native `dblclick` event fires on a non-existent element. Manual detection is resilient to DOM rebuilds.

### D15: Right-click isolation from pointer handling (Bugfix Round 2)
**Decision**: `onPointerDown` returns early if `e.button !== 0` (non-primary button). Right-click context menu is handled exclusively by the `contextmenu` event.
**Rationale**: Without this guard, right-click triggers `onPointerDown` → `render()` (DOM rebuild) before the `contextmenu` event fires. The `contextmenu` event then receives a stale `e.target` that no longer exists in the DOM, causing `findNodeElement`/`findEdgeElement` to fail.

### D16: Recursive attribute tree in inspector (Bugfix Round 2)
**Decision**: `AttrInfo` carries `category` (Simple/Nested/Reference), `valueType` (e.g., "String"), recursive `children?: AttrInfo[]`, and reference-specific `relationshipTypeURI` / `referencedEntityTypeURI`. The inspector renders this as a recursive HTML tree using `<details>`/`<summary>` elements.
**Rationale**: Users need to see the full attribute structure — not just counts. Simple attributes show "Name : Type", nested attributes expand to show sub-attributes, and reference attributes show their relation type, entity type, and sub-attributes. Recursive rendering handles arbitrary nesting depth.

### D17: Tree view reveal from ontology view (Bugfix Round 2)
**Decision**: "Show in Tree View" executes a registered command (`reltio.revealInTreeView`) that calls `treeView.reveal(item, { select: true, focus: true, expand: true })`. `ConfigTreeProvider` implements `getParent()` and `findEntityTypeItem()` to support the reveal API. `ConfigTreeItem` has a stable `id` derived from `jsonPath.join('/')`.
**Rationale**: VS Code's `TreeView.reveal()` requires `getParent()` on the tree data provider and a stable item identity. Routing through a registered command avoids passing the treeView reference across module boundaries.

### D18: Inspector action buttons (Bugfix Round 2)
**Decision**: The inspector overlay includes an action bar below the header with small link-style buttons ("Show in Editor", "Show in Tree View"). The inspector body also supports right-click context menu with the same actions. Entity inspectors show actions for the entity; connection inspectors show actions for both source and target entities.
**Rationale**: Navigation from the inspector is a natural user need — after inspecting an entity's details, users often want to jump to it in the editor or tree. Visible buttons are more discoverable than right-click alone.

## Risks / Trade-offs

- **[SVG performance with many nodes]** If a configuration has 50+ entity types, SVG rendering and hit testing may slow down. → Mitigation: Real-world Reltio configs typically have 5-20 entity types. If performance becomes an issue, we can add Canvas-based rendering later.

- **[ELK.js bundle size]** ELK.js adds ~400KB to the extension. → Mitigation: This is loaded once at activation and is comparable to other VS Code extensions with webviews. It only runs when the user opens the ontology preview.

- **[Layout file conflicts]** If two users work on the same config, their `.reltio.layout.json` files may conflict in version control. → Mitigation: The layout file is optional and can be `.gitignore`d. The view works fine without it (falls back to auto-layout).

- **[Edge routing complexity]** Parallel edges between the same entity pair need offset calculation to avoid overlap. Curved or orthogonal routing adds visual quality but implementation complexity. → Mitigation: Start with straight lines with vertical offset for parallel edges. Improve routing in a future iteration if needed.

- **[Inspector tree depth]** Entity types with deeply nested attributes (5+ levels) may produce very tall inspector trees. → Mitigation: The tree uses collapsible sections (`<details>`), starting collapsed. Users expand only what they need. The inspector scrolls within its 1/4-canvas bounds.

### D19: Navigation via UriIndex code model (Bugfix Round 7)
**Decision**: All "Show in Editor" navigation from the ontology view uses the existing `UriIndex` AST-based code model rather than regex text search. `revealUriInEditor` passes full URIs to `UriIndex.getDefinitionNode()`, while `revealEntityInEditor` resolves short node IDs to full URIs via the parsed `ReltioBusinessModel` then looks up the definition node.
**Rationale**: Regex-based search finds the first text match regardless of JSON structure — a URI appearing in `groupingTypes` before `entityTypes` would navigate to the wrong location. The `UriIndex` knows the exact AST position of each URI definition, consistent with how Go-to-Definition and the tree view already navigate. This eliminates an entire class of navigation bugs.
