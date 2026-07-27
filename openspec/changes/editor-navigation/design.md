## Context

Changes 1 and 2 established TypeScript interfaces for the Reltio Business Model, a JSON Schema for validation, a `configParser.ts` that produces both a typed model and a position-aware AST, and a tree view for sidebar navigation. This change adds in-editor navigation: clicking a URI reference jumps to its definition, and broken references are flagged.

Reltio metadata files use URI strings as cross-references extensively. In `ppl-example.reltio.json`: 702 definitions (every object with a `uri` property), 363 unique cross-references (string values starting with `configuration/`), and 317 synthesizable virtual definitions from Reference attributes. After virtual path resolution, only 8 genuinely broken references remain — all real config bugs.

## Goals / Non-Goals

**Goals:**
- Build a URI Index that maps every `uri` property to its AST node (definition) and every `configuration/...` string value to its AST node (reference)
- Resolve virtual paths through Reference attributes: when `Merchant/Address` is `type: "Reference"` pointing to `Location`, synthesize `Merchant/Address/attributes/City_Name` → `Location/attributes/City_Name`
- Handle multi-hop reference chains (Organization/Merchant → Merchant/Address → Location)
- Provide DocumentLinkProvider (underlined Ctrl+click links) and DefinitionProvider (F12 / Alt+F12 Peek)
- Provide ReferenceProvider (Shift+F12 Find All References) to list every location referencing a given URI
- Publish diagnostics for unresolved URIs with configurable severity (Warning default)
- Rebuild the index on document changes (debounced, sharing the existing debounce in extension.ts)

**Non-Goals:**
- Cross-file URI resolution — each `.reltio.json` is self-contained
- URI rename/refactor support — future enhancement
- Custom hover content for URIs — VS Code's JSON hover from the schema is sufficient

## Decisions

### D1: URI Index as the central data structure
**Decision**: A `UriIndex` class encapsulates three maps: `definitions: Map<string, Node>` (URI → AST node of the object containing the `uri` property), `virtualDefinitions: Map<string, { realUri: string; realNode: Node }>` (synthesized URI → real target), and `references: Map<string, Node[]>` (URI → all AST nodes of string values referencing it). A single `build(model, ast)` call populates all three.
**Rationale**: All four consumers (links, definitions, references, diagnostics) need the same data. Building once avoids triple-traversal. The index is cheap to rebuild (~1ms for 13K lines) since it's a single AST walk.

### D2: Definition collection walks the entire AST
**Decision**: Instead of manually collecting URIs from known sections (entityTypes, relationTypes, sources, etc.), the definition collector walks the entire AST looking for any property named `uri` whose value is a string starting with `configuration/`. This captures all 702 definitions including sources, match groups, survivorship groups, strategies, graph types, relation sub-objects, analytics attributes, etc.
**Rationale**: The XSD has 17 top-level sections and many nested structures with `uri` properties. A generic walk is simpler and more resilient to schema changes than an exhaustive section-by-section collector.

### D3: Virtual path synthesis for Reference attributes
**Decision**: During index build, for each attribute with `type: "Reference"` and a `referencedEntityTypeURI`, find the target entity type and recursively graft its attribute tree as virtual definitions under the reference attribute's URI prefix. Multi-hop chains are handled naturally — the algorithm processes entity types in order, and since reference targets are other entity types whose attributes have already been indexed as real definitions, the virtual synthesis just adds the aliased paths.
**Rationale**: This resolves 11 cross-entity references in the sample file that would otherwise be false-positive diagnostics. The algorithm is bounded (max 2 hops in practice) and the virtual map is small (~317 entries).
**Go-to-definition behavior for virtual URIs**: Navigation targets the **real** attribute on the target entity (e.g., clicking `Merchant/Address/attributes/City_Name` jumps to `Location/attributes/City_Name`), which is the correct "go to definition" semantic.

### D4: Reference detection is value-based, position-independent
**Decision**: Any JSON string value starting with `configuration/` is treated as a URI reference, regardless of which property or section it appears in. The `uri` property itself is excluded (it's a definition, not a reference).
**Rationale**: URI references appear in many different property names (`referencedEntityTypeURI`, `comparisonAttributeUri`, `attributeUri`, `winnerSourceAttributes`, `latitude`, `longitude`, source priorities, etc.). Pattern-matching property names would be fragile. Value-based matching catches all 363 references with zero false positives.

### D5: DocumentLinkProvider for visual affordance
**Decision**: Register a `DocumentLinkProvider` for `*.reltio.json` files. For each URI reference string in the document, return a `DocumentLink` with a range covering the string value (excluding quotes) and a command URI that triggers go-to-definition.
**Rationale**: DocumentLinks give the underline + Ctrl+click visual cue that users expect from clickable references. This works alongside the DefinitionProvider (F12/Alt+F12).

### D6: DefinitionProvider for F12 / Peek
**Decision**: Register a `DefinitionProvider` that, given a cursor position inside a `configuration/...` string, returns a `Location` pointing to the definition's `uri` property value node (the string itself, not the parent object).
**Rationale**: F12 jumps to the exact line where the URI is defined. Alt+F12 opens a peek window. Targeting the `uri` value node (not the parent) gives precise highlighting.

### D7: ReferenceProvider for Shift+F12
**Decision**: Register a `ReferenceProvider` that, given a cursor position inside a `configuration/...` string, determines the URI (either a definition's own `uri` value or a reference value), then returns `Location[]` for all nodes in `index.getReferences(uri)`. When invoked on a definition, it returns all references to that URI. When invoked on a reference, it first resolves to the definition URI, then returns all references to that same URI (including the definition itself when `context.includeDeclaration` is true).
**Rationale**: The URI Index already stores `references: Map<string, Node[]>`, so the provider is a thin lookup layer. This completes the navigation triad: go-to-definition (F12), find-all-references (Shift+F12), and peek (Alt+F12).

### D8: Diagnostic severity is configurable
**Decision**: Add a `reltio.unresolvedUriSeverity` configuration setting with values `"warning"` (default), `"error"`, `"information"`, `"hint"`, and `"off"`. Diagnostics are published on document open/change, cleared on document close.
**Rationale**: Some unresolved URIs are intentional (e.g., references to entities defined in a separate config file in multi-tenant setups). Users need the ability to downgrade or disable the noise.

### D9: Index lifecycle tied to document changes
**Decision**: The URI index is rebuilt on the same debounced `onDidChangeTextDocument` event that refreshes the tree. Diagnostics are re-published after each rebuild. The index, link provider, definition provider, reference provider, and diagnostics manager are all scoped to a single document (the active `.reltio.json`).
**Rationale**: Reusing the existing debounce avoids redundant parsing. Single-document scope matches the tree view's model (one document at a time).

## Risks / Trade-offs

- **[False positive references]** A string like `"configuration/custom/something"` that isn't a real URI but starts with `configuration/` would be flagged. → Mitigation: In practice, Reltio configs only use `configuration/` as a URI prefix. If false positives appear, add an allowlist of known path segments (`entityTypes`, `relationTypes`, `sources`, etc.) as a filter.

- **[Virtual path depth]** Theoretically, a chain of Reference attributes could create deep virtual paths. → Mitigation: Add a max-depth guard (e.g., 5 hops) to prevent infinite loops from circular references. In practice, max observed depth is 2.

- **[Large file performance]** For very large configs (50K+ lines), rebuilding the index on every keystroke (debounced) may cause latency. → Mitigation: The AST walk is O(n) and parsing is already done for the tree view. Index rebuild is a second pass over the same AST, adding ~1-2ms for a 13K-line file.

- **[DocumentLink density]** With 363 references, the editor shows many underlined strings. → Mitigation: This matches VS Code's behavior for TypeScript imports and CSS class references — users expect clickable cross-references to be underlined. The underlines only appear on hover by default.
