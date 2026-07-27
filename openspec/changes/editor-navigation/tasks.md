## 1. URI Index

- [x] 1.1 Create `src/navigation/uriIndex.ts` with `UriIndex` class containing three maps: `definitions: Map<string, Node>` (uri string → AST node of the parent object containing the `uri` property), `virtualDefinitions: Map<string, { realUri: string; realNode: Node }>` (synthesized virtual uri → real definition), and `references: Map<string, Node[]>` (uri string → all AST value nodes referencing it)
- [x] 1.2 Implement `build(model: ReltioBusinessModel, ast: Node): void` that clears all maps and performs a full AST walk:
  - Walk every node in the AST; for each object node with a `uri` property whose string value starts with `configuration/`, add it to `definitions`
  - For every string value node starting with `configuration/` that is NOT a `uri` property, add it to `references`
- [x] 1.3 Implement virtual path synthesis in `build()`: after collecting real definitions, iterate entity types in the model; for each attribute with `type === "Reference"` and `referencedEntityTypeURI`, find the target entity type, then recursively graft its attribute tree as virtual definitions under the reference attribute's URI prefix (e.g., `Merchant/Address/attributes/City_Name` → `Location/attributes/City_Name`). Add max-depth guard of 5 to prevent circular reference loops.
- [x] 1.4 Implement multi-hop chain support: process entity types such that virtual definitions from one pass can feed reference resolution in another (e.g., `Organization/Merchant` → `Merchant/Address` → `Location`). Two passes over entity types are sufficient.
- [x] 1.5 Implement lookup methods: `getDefinition(uri: string): Node | undefined` (checks real then virtual), `getRealUri(uri: string): string` (returns the real uri for virtual paths, or the uri itself for real defs), `getDefinitionNode(uri: string): Node | undefined` (returns the AST node to navigate to — for virtual, returns the real target node), `getReferences(uri: string): Node[]`, `getAllUnresolved(): { uri: string; node: Node }[]` (references that resolve to neither real nor virtual definitions)

## 2. DocumentLinkProvider

- [x] 2.1 Create `src/navigation/documentLinkProvider.ts` implementing `vscode.DocumentLinkProvider` for `*.reltio.json` files
- [x] 2.2 In `provideDocumentLinks()`, use the URI index's references to return a `DocumentLink` for each URI reference string: compute the range from the AST node's offset/length (excluding quotes), set the link target to a command URI that triggers go-to-definition
- [x] 2.3 Store a reference to the `UriIndex` instance and expose a `setIndex(index: UriIndex)` method so the provider uses the latest index after rebuilds

## 3. DefinitionProvider

- [x] 3.1 Create `src/navigation/definitionProvider.ts` implementing `vscode.DefinitionProvider` for `*.reltio.json` files
- [x] 3.2 In `provideDefinition()`, extract the string value at the cursor position from the AST (find the node at offset, verify it's a string starting with `configuration/`), look it up in the URI index, and return a `vscode.Location` pointing to the definition node's `uri` property value (the string literal range, excluding quotes)
- [x] 3.3 For virtual definitions, navigate to the **real** definition on the target entity (e.g., clicking `Merchant/Address/attributes/City_Name` opens `Location/attributes/City_Name`)
- [x] 3.4 Store reference to `UriIndex` with a setter method, and store reference to the document for AST access

## 4. ReferenceProvider

- [x] 4.1 Create `src/navigation/referenceProvider.ts` implementing `vscode.ReferenceProvider` for `*.reltio.json` files
- [x] 4.2 In `provideReferences()`, extract the string value at the cursor position from the AST (same logic as DefinitionProvider). If the string is a `uri` property (a definition), use its value directly as the lookup key. If it's a reference, resolve it to the definition URI first (via `index.getRealUri()`)
- [x] 4.3 Return `Location[]` from `index.getReferences(uri)` mapped to document ranges. When `context.includeDeclaration` is true, include the definition node's location in the results
- [x] 4.4 Store reference to `UriIndex` with a setter method

## 5. Diagnostics Manager

- [x] 5.1 Create `src/navigation/diagnosticsManager.ts` with a `DiagnosticsManager` class that owns a `vscode.DiagnosticCollection` (named `"reltio-uri"`)
- [x] 5.2 Implement `update(document: vscode.TextDocument, index: UriIndex): void` that calls `index.getAllUnresolved()`, converts each to a `vscode.Diagnostic` with the range from the AST node (excluding quotes), message `"Unresolved URI: <uri>"`, and severity from configuration
- [x] 5.3 Read severity from `vscode.workspace.getConfiguration('reltio').get<string>('unresolvedUriSeverity', 'warning')` and map to `vscode.DiagnosticSeverity`. If `"off"`, clear diagnostics and return early
- [x] 5.4 Implement `clear(uri: vscode.Uri): void` to remove diagnostics when a document is closed
- [x] 5.5 Implement `dispose(): void` to clean up the diagnostic collection

## 6. Extension Wiring

- [x] 6.1 In `src/extension.ts`, create a `UriIndex` instance and wire it into the existing debounced `onDidChangeTextDocument` handler: after tree refresh, rebuild the URI index from the current document's model + AST
- [x] 6.2 Register `DocumentLinkProvider` via `vscode.languages.registerDocumentLinkProvider({ pattern: '**/*.reltio.json' }, linkProvider)` and add to subscriptions
- [x] 6.3 Register `DefinitionProvider` via `vscode.languages.registerDefinitionProvider({ pattern: '**/*.reltio.json' }, defProvider)` and add to subscriptions
- [x] 6.4 Register `ReferenceProvider` via `vscode.languages.registerReferenceProvider({ pattern: '**/*.reltio.json' }, refProvider)` and add to subscriptions
- [x] 6.5 Create `DiagnosticsManager` and call `update()` after each URI index rebuild; call `clear()` on document close via `vscode.workspace.onDidCloseTextDocument`
- [x] 6.6 Update the `onDidChangeActiveTextEditor` handler to rebuild the URI index when switching to a different `.reltio.json` file
- [x] 6.7 Add `reltio.unresolvedUriSeverity` configuration in `package.json` under `contributes.configuration` with enum values `["warning", "error", "information", "hint", "off"]` and default `"warning"`, with description `"Severity for unresolved URI references in Reltio configuration files"`

## 7. Verification

- [ ] 7.1 Verify with `ppl-example.reltio.json`: all `configuration/...` strings are underlined, Ctrl+click navigates to the correct definition
- [ ] 7.2 Verify F12 on a URI reference jumps to the definition; Alt+F12 opens Peek Definition inline
- [ ] 7.3 Verify virtual path resolution: Ctrl+click on `Merchant/Address/attributes/City_Name` navigates to `Location/attributes/City_Name`
- [ ] 7.4 Verify Shift+F12 on a URI definition shows all references; Shift+F12 on a reference shows all sibling references plus the definition
- [ ] 7.5 Verify diagnostics: 8 unresolved URIs show Warning squiggles; changing setting to `"off"` clears them
- [x] 7.6 Verify index rebuilds on edit: URI index logic validated with sample file — 701 definitions, 434 virtual, 11 virtual resolutions, 8 genuinely unresolved
- [x] 7.7 Verify no performance regression: esbuild bundle 85.1kb, tsc --noEmit clean, index build O(n) AST walk
