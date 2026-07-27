## 1. Graph Model

- [x] 1.1 Create `src/ontology/modelToGraph.ts` with types: `GraphNode { id: string; label: string; abstract: boolean; consolidated: boolean; simpleAttrCount: number; nestedAttrCount: number; refAttrCount: number; matchGroupCount: number; x: number; y: number; width: number; height: number }`, `GraphEdge { id: string; source: string; target: string; type: 'relationship' | 'reference' | 'extends'; label: string }`, `GraphModel { nodes: GraphNode[]; edges: GraphEdge[] }`
- [x] 1.2 Implement `buildGraphModel(model: ReltioBusinessModel): GraphModel` that creates a `GraphNode` for each entity type: `id` = entity URI short name, `label` from entity `label` or `name`, `abstract` from `abstract === true`, `consolidated` from `matchGroups` present AND `abstract !== true`, attribute counts classified by type (Simple/Nested/Reference), `matchGroupCount` from `matchGroups.length`
- [x] 1.3 Implement relationship edge extraction: for each relation type with `startObject.objectTypeURI` and `endObject.objectTypeURI`, create a `GraphEdge` with `type: 'relationship'`, `label` = relation type label or URI short name, `source` = start entity short name, `target` = end entity short name
- [x] 1.4 Implement reference attribute edge extraction: for each entity type, walk attributes; for each `type === 'Reference'` with `referencedEntityTypeURI`, create a `GraphEdge` with `type: 'reference'`, `label` = attribute name, `source` = owning entity short name, `target` = referenced entity short name
- [x] 1.5 Implement inheritance edge extraction: for each entity type with `extendsTypeURI`, create a `GraphEdge` with `type: 'extends'`, `label` = "extends", `source` = child entity short name, `target` = parent entity short name (resolved from URI)
- [x] 1.6 Set default node dimensions based on label/content width estimation (fixed width ~200px, height ~70px for now; adjustable later)

## 2. ELK Layout

- [x] 2.1 Install `elkjs` dependency: `npm install elkjs`
- [x] 2.2 Create `src/ontology/elkLayout.ts` with `computeLayout(graph: GraphModel): Promise<GraphModel>` that converts GraphModel to ELK graph format (`ElkNode` with children, `ElkExtendedEdge` with sources/targets), runs `elk.layout()`, and maps resulting positions back to `GraphNode.x` / `GraphNode.y`
- [x] 2.3 Configure ELK options: algorithm `'layered'`, direction `'DOWN'` (top-to-bottom), edge routing `'ORTHOGONAL'`, node spacing 60, layer spacing 80, crossing minimization enabled
- [x] 2.4 Implement edge priority: relationship edges get `priority: 2`, reference and extends edges get `priority: 1` — this influences ELK's layering decisions so relationship edges define the primary hierarchy

## 3. Layout Persistence

- [x] 3.1 Create `src/ontology/layoutPersistence.ts` with `loadLayout(configUri: vscode.Uri): Promise<Record<string, {x: number; y: number}> | undefined>` that reads `.reltio.layout.json` sibling file, parses it, validates version, and returns positions map — returns `undefined` if file doesn't exist or is invalid
- [x] 3.2 Implement `saveLayout(configUri: vscode.Uri, positions: Record<string, {x: number; y: number}>): Promise<void>` that writes `{ version: 1, positions }` to `.reltio.layout.json`
- [x] 3.3 Implement `applyLayout(graph: GraphModel, positions: Record<string, {x: number; y: number}>): { applied: boolean; graph: GraphModel }` that applies saved positions to matching nodes; returns `applied: false` if any node is missing from the saved positions (indicating layout is stale and ELK should run instead)

## 4. Webview Panel Management

- [x] 4.1 Create `src/ontology/ontologyPanel.ts` with `OntologyPanelManager` class that tracks active panels per document URI (Map<string, vscode.WebviewPanel>)
- [x] 4.2 Implement `showPreview(document: vscode.TextDocument, extensionUri: vscode.Uri): void` that creates a new `WebviewPanel` in `ViewColumn.Beside` with `retainContextWhenHidden: true`, `enableScripts: true`, and Content Security Policy allowing only the extension's own scripts — or focuses the existing panel if already open for this document
- [x] 4.3 Implement the HTML template as an inline function: returns a minimal HTML page that loads `dist/webview.js` (resolved via `webview.asWebviewUri`) and `dist/webview.css`, with CSP nonce for script security
- [x] 4.4 Implement `postGraphToWebview(panel: vscode.WebviewPanel, graph: GraphModel): void` that sends `{ type: 'setGraph', graph }` message to the webview
- [x] 4.5 Implement message listener for incoming webview messages: handle `{ type: 'savePositions', positions }` by calling `saveLayout()`, handle `{ type: 'requestResetLayout' }` by re-running ELK and sending updated positions
- [x] 4.6 Implement document change listener: when the source `.reltio.json` changes (debounced 500ms), re-parse, rebuild graph model, apply existing layout if valid, and send updated graph to the webview
- [x] 4.7 Implement panel dispose listener: remove panel from the tracking map when closed

## 5. Webview Rendering — SVG Canvas

- [x] 5.1 Create `src/webview/ontologyView.ts` as the webview entry point: listen for `message` events from the extension, maintain local graph state, render on `setGraph` messages
- [x] 5.2 Create `src/webview/ontologyView.css` with monochrome styles: white background, node styles (fill white, stroke black), edge styles, selection highlight, inspector overlay
- [x] 5.3 Implement SVG canvas setup: create root `<svg>` element filling the viewport, with a `<g>` transform group for zoom/pan. Define SVG `<defs>` for arrowhead markers: filled arrowhead for relationships, open arrowhead for references and extends
- [x] 5.4 Implement node rendering: for each `GraphNode`, draw an SVG `<g>` group containing a `<rect>` (with appropriate border style) and `<text>` elements for label and stats line. Normal nodes: `stroke-width: 2`, solid. Consolidated: `stroke-width: 3`, solid, plus "★ Consolidated" text. Abstract: `stroke-width: 2`, `stroke-dasharray: 6 4`
- [x] 5.5 Implement edge rendering: for each `GraphEdge`, draw an SVG `<path>` from source node to target node with appropriate style. Relationship: solid stroke, filled arrowhead marker. Reference: `stroke-dasharray: 6 4`, open arrowhead. Extends: `stroke-dasharray: 2 3`, open arrowhead. Add `<text>` label at the edge midpoint
- [x] 5.6 Implement parallel edge offset: when multiple edges connect the same pair of nodes, offset each edge perpendicular to the line between nodes (e.g., 15px per parallel edge) to avoid overlap

## 6. Webview Rendering — Interaction

- [x] 6.1 Implement zoom: mouse wheel handler that scales the SVG `viewBox` around the cursor position, with min/max zoom limits (0.1x to 4x)
- [x] 6.2 Implement pan: pointer down on canvas background (not on a node/edge) starts tracking, pointer move translates the `viewBox`, pointer up stops
- [x] 6.3 Implement node drag: pointer down on a node selects it and starts drag tracking, pointer move updates the node's position (and re-routes connected edges), pointer up ends drag and sends `{ type: 'savePositions', positions }` to the extension
- [x] 6.4 Implement single-click selection: clicking a node adds a blue highlight outline (e.g., 2px solid `#3b82f6`), clicking canvas background deselects all
- [x] 6.5 Implement double-click on node: opens the entity inspector overlay
- [x] 6.6 Implement double-click on relationship edge: opens the relationship inspector overlay
- [x] 6.7 Implement double-click on reference edge: opens the reference attribute inspector overlay

## 7. Inspector Overlay

- [x] 7.1 Implement inspector container: an absolutely-positioned `<div>` overlay, max 25% of viewport width and height, positioned near the double-clicked element, with a large "×" close button in the top-right corner. Only one inspector open at a time — opening a new one closes the previous
- [x] 7.2 Implement entity inspector content: build a collapsible tree using `<details>`/`<summary>` HTML elements showing: entity label and URI at the top, then sections for Attributes (grouped by Simple/Nested/Reference, each showing name and type), Match Groups (name, type, scope), Survivorship Groups (name, default flag). Tree starts collapsed
- [x] 7.3 Implement relationship inspector content: show relationship label, URI, direction, start/end entity types, and attributes if present, using the same collapsible tree structure
- [x] 7.4 Implement reference attribute inspector content: show the reference attribute's name, type, URI, referenced entity type, and nested attributes (if any) in a collapsible tree
- [x] 7.5 Implement click-outside-to-close: clicking anywhere outside the inspector overlay closes it. Also close on Escape key

## 8. Extension Wiring

- [x] 8.1 In `src/extension.ts`, import `OntologyPanelManager` and create an instance in `activate()`
- [x] 8.2 Register command `reltio.showOntologyPreview` that calls `panelManager.showPreview()` with the active `.reltio.json` document
- [x] 8.3 Add `reltio.showOntologyPreview` to `package.json` under `contributes.commands` with title "Reltio: Show Ontology Preview" and icon `$(open-preview)`
- [x] 8.4 Add editor/title menu entry in `package.json` so the preview button appears in the editor toolbar when a `.reltio.json` file is open: `{ "command": "reltio.showOntologyPreview", "when": "resourceFilename =~ /\\.reltio\\.json$/", "group": "navigation" }`
- [x] 8.5 Add right-click context menu entry in `package.json` under `editor/context`: `{ "command": "reltio.showOntologyPreview", "when": "resourceFilename =~ /\\.reltio\\.json$/" }`
- [x] 8.6 Add second esbuild entry point in `package.json` build script: `esbuild src/webview/ontologyView.ts --bundle --outfile=dist/webview.js --format=iife --platform=browser` (separate from the extension build)
- [x] 8.7 Register command `reltio.resetOntologyLayout` with title "Reltio: Reset Ontology Layout" for re-running ELK auto-layout; add it to the webview toolbar or command palette

## 9. Verification

- [ ] 9.1 Verify with `ppl-example.reltio.json`: command opens webview, 4 entity types shown as nodes with correct attribute counts
- [ ] 9.2 Verify relationship edges: 9 relationship types drawn as solid arrows with correct labels connecting correct entity pairs
- [ ] 9.3 Verify reference attribute edges: reference attributes (Address on Merchant → Location, etc.) drawn as dashed lines
- [ ] 9.4 Verify consolidated profile styling: entity types with matchGroups have bold borders and "★ Consolidated" badge
- [ ] 9.5 Verify zoom (mouse wheel), pan (drag canvas), drag node, and selection (single click)
- [ ] 9.6 Verify layout persistence: drag a node, close preview, reopen — node is in the saved position. Delete `.reltio.layout.json` — auto-layout runs
- [ ] 9.7 Verify inspector: double-click entity → floating overlay with tree view; double-click relationship edge → relationship inspector; close with × button
- [ ] 9.8 Verify preview updates on source edit: change entity label in JSON → preview refreshes
- [ ] 9.9 Verify "Reset Layout" command re-runs ELK and repositions all nodes

## Bugfix Round 1

- [x] 1.1 Fix inspector close button — `pointerdown` handler on header captures pointer, preventing click on nested × button; changed close button to use `pointerdown` with `stopPropagation`
- [x] 1.2 Fix edge clickability — thin 2px edge paths are nearly impossible to click; added invisible 14px-wide hit area path behind each edge
- [x] 1.3 Fix zoom reset on node drag — `render()` called `fitViewBox()` every time, resetting zoom; introduced `needsFitViewBox` flag, only fit on initial load
- [x] 1.4 Fix dot grid coverage — grid rect was sized to exactly match viewBox, leaving gaps when panning; expanded grid rect to 3x viewBox in all directions
- [x] 1.5 Add attribute names to inspector — inspector only showed counts (Simple: 5, Nested: 6); added `AttrInfo[]` to `GraphNode`, render expandable attribute lists grouped by type
- [x] 1.6 Disable text selection on SVG canvas — mouse interactions caused text selection on edge labels and node text; added `user-select: none` to SVG element
- [x] 1.7 Rework node body content — node text showed "5A · 6N · 2R" which was not informative; changed to show total attrs, connections count, match rules, consolidated/abstract badge
- [x] 1.8 Custom right-click context menu — browser default context menu appeared; implemented custom menu with "Show in Editor" / "Show in Tree View" actions for nodes and edges
- [x] 1.9 Edge single-click selection — clicking edge line produced no visual feedback; added `selectedEdgeId` state, `.selected` CSS class with blue highlight and drop shadow
- [x] 1.10 Inspector draggable, resizable, scrollable — inspector was fixed position, no scrollbar, couldn't resize; added drag via header, CSS `resize: both`, `overflow-y: auto` on body

## Bugfix Round 2

- [x] 2.1 Inspector attribute tree indentation — Simple/Nested/Reference groups were not indented under parent "Attributes" node; added `.attr-tree` container with `padding-left: 16px`
- [x] 2.2 Attribute Name : Type format — simple attributes showed only name; changed to render "Name : Type" (e.g., "Business_Name : String") using `valueType` from model
- [x] 2.3 Nested attribute recursive tree — nested attributes were flat list items; made them expandable `<details>` nodes that recursively show child sub-attributes
- [x] 2.4 Reference attribute details — reference attrs showed only name; now show `relationshipTypeURI`, `referencedEntityTypeURI`, and sub-attributes as expandable tree
- [x] 2.5 Fix edge click/select broken — CSS `.edge path { pointer-events: none }` applied to all paths including invisible hit area; added `.edge-hit` class with `pointer-events: stroke`
- [x] 2.6 Fix edge double-click inspector — same root cause as 2.5; hit area path now receives pointer events, enabling double-click detection on edges
- [x] 2.7 Fix context menu for all elements — `onPointerDown` processed right-clicks (button 2), called `render()` which rebuilt DOM before `contextmenu` fired with stale target; added `if (e.button !== 0) return` guard
- [x] 2.8 Show in Tree View reveals in sidebar — "Show in Tree View" just called `revealEntityInEditor`; implemented `treeView.reveal()` via command, added `getParent()` and `findEntityTypeItem()` to `ConfigTreeProvider`
- [x] 2.9 Inspector nested tree vertical spacing — `details { margin: 4px 0 }` applied to all details including inside attribute lists; scoped margin to `.inspector-body > details` only
- [x] 2.10 Inspector action buttons — inspector had no navigation actions; added action bar below header with "Show in Editor" / "Show in Tree View" buttons, plus right-click context menu support

## Bugfix Round 3

- [x] 3.1 Reference attribute metadata too wide — full URIs like `configuration/entityTypes/Individual` take too much space; show short URI (last segment only) with a label, e.g., "Individual : Entity", "MerchantHasAddress : Relation"
- [x] 3.2 Reference attribute sub-attributes need resolved types — reference attrs should show: entity type (short URI), relation type (short URI), and sub-attributes with their types resolved from the referenced entity type's attribute definitions (e.g., `configuration/entityTypes/Location/attributes/AddressLine1` → look up AddressLine1 in Location to get its type)
- [x] 3.3 Remove action buttons bar from inspector — visible "Show in Editor" / "Show in Tree View" buttons were not requested; remove the `.inspector-actions` bar and its CSS, keep only right-click context menu on inspector
- [x] 3.4 Add scrollbars when graph doesn't fit viewport — currently the only way to navigate is pan/zoom via mouse drag and wheel; need visible scrollbars so users can see how much content is off-screen and scroll to it
- [x] 3.5 Inspector right-click should navigate to clicked element — currently right-click anywhere in inspector shows "Show in Editor" which navigates to the root entity type; when right-clicking on a specific attribute, the context menu should offer navigation to that attribute's URI in the JSON source (not the parent entity)

## Bugfix Round 4

- [x] 4.1 Scrollbar tracks too wide — reduced from 8px to 6px tracks and thumbs with 3px border-radius to match VS Code native style
- [x] 4.2 Inspector context menu items too generic — entity inspector now shows "Show <entityName> in Editor/Tree" instead of generic labels; attribute right-click adds specific "Show <attrName> in Editor" alongside parent entity actions
- [x] 4.3 Entity inspector Connections section too sparse — replaced "↔ OtherEntity (N rel, M ref)" with expandable subtrees per connected entity, listing Relationship Types and Reference Attributes individually; right-click offers entity navigation and relation type navigation via data-entity-id/data-rel-uri/data-attr-uri attributes
- [x] 4.4 Edge inspector needs relation type navigation — relation type items now carry data-rel-uri; right-click offers "Show <relationType> in Editor"; reference attribute items carry data-attr-uri for similar navigation

## Bugfix Round 5

- [x] 5.1 Horizontal scrollbar appears thinner than vertical — added 2px bottom offset to horizontal track and 2px right offset to vertical track so neither is clipped by the panel edge
- [x] 5.2 Connections section missing tree indentation — wrapped Connections subtree content in `.attr-tree` div to apply the same 16px left padding as the Attributes section
- [x] 5.3 Edge inspector missing relation type actions — added "Show <relationType> in Editor" entries for each relationship type to the edge inspector's default context menu actions

## Bugfix Round 6

- [x] 6.1 Connections subtree children not indented — wrapped inner content of each connected entity in `.attr-tree` div for consistent indentation
- [x] 6.2 Scrollbar thumbs have wrong cross-axis size — moved `min-width: 20px` to horizontal-only and `min-height: 20px` to vertical-only rules
- [x] 6.3 Edge inspector relation types need structured detail — added `RelTypeInfo` with startEntityId/endEntityId; shared `renderRelTypeTree` renders expandable subtree with Start Type, End Type, Relation Type; used in both edge and entity inspector Connections
- [x] 6.4 Edge inspector reference attributes need full detail — added `referenceAttrs: AttrInfo[]` to GraphEdge with full AttrInfo built during connection collection; edge inspector now uses `renderAttrTree` matching the entity inspector's reference attribute rendering

## Bugfix Round 7

- [x] 7.1 Replace all regex navigation with AST-based code model lookup — replaced `revealUriInEditor` and `revealEntityInEditor` to use `UriIndex.getDefinitionNode(uri)` from the existing code model; `revealUriInEditor` looks up full URIs directly; `revealEntityInEditor` resolves short names to full URIs via the parsed model then uses the index; shared `buildIndex` helper builds `UriIndex` from `parseDocument`; shared `navigateToNode` helper handles editor reveal; zero regex remaining
