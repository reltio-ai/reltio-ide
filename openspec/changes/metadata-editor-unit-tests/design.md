## Context

CLI tests use `tsc` → `dist/` imports (Option A). Fifteen `scripts/test-<change>.cjs` files map to OpenSpec changes. Initial v1 scripts used tiny inline JSON and multiple samples; depth was insufficient.

**Replan (Bugfix Round 2):** One canonical L3 file — [`samples/first-test.json`](samples/first-test.json) — drives all model-dependent tests. Only **code-model-and-schema** validates correctness and holds hardcoded expectations. Every other test **assumes the fixture is correct** and derives checks from the parsed `ReltioBusinessModel` + AST + `UriIndex`.

Note: `first-test.json` is populated — a full production-scale L3 (~39k lines, Financial Services velocity-pack tenant export). It covers entity types, attributes (simple/nested/reference), relation types, match groups, sources, cleanse config, and cross-URI references sufficient for navigation, tree walk, ontology, and scoped autocomplete. Parse smoke: 0 parse errors, ~57ms parse + ~9ms UriIndex build on current hardware.

## Goals / Non-Goals

**Goals:**

- **`test-code-model-and-schema` runs first** in [`scripts/run-unit-tests.cjs`](scripts/run-unit-tests.cjs) — parser gate for the suite.
- **Model-derived tests** for editor-navigation, config-tree-view, ontology-view, autocomplete-improvements, schema-alignment (structure vs schema), apply (mutate copy of canonical text).
- **Zero hardcoded expectations** in non-code-model scripts (no spot JSON, no allowlists, no committed oracle files under `scripts/test-fixtures/`).
- **Code-model manifest** [`samples/code-model-manifest.json`](samples/code-model-manifest.json) — only place for hardcoded expected counts/keys per registered test JSON.
- Document maintainer procedure and ARCHITECTURE prohibition on expectation files.

**Non-Goals:**

- Velocity packs as test input (use `first-test.json` only for L3-dependent tests).
- Jest/Vitest/`@vscode/test-electron`.
- Expectation/oracle JSON for navigation, autocomplete, or tree (forbidden).

## Decisions

### D1 — Option A harness (unchanged)

`npm run compile` + `node:assert` + per-change `.cjs` scripts.

### D2 — One script per OpenSpec change (unchanged)

`scripts/test-<slug>.cjs` registered in `run-unit-tests.cjs`.

### D3 — Canonical fixture: `samples/first-test.json`

**Choice:** Single shared L3 for all model-dependent tests.

**Rationale:** One place to extend coverage; other tests stay in sync automatically when the fixture grows.

**Load:** `scripts/lib/load-canonical-fixture.cjs` → `{ text, model, ast }` via `parseDocument`.

### D4 — Assumption: fixture is correct (non-code-model tests)

**Choice:** Navigation, tree, ontology, autocomplete, schema-alignment (on canonical file), and apply tests do **not** assert parse errors or maintain expected URI lists. They call `loadCanonicalFixture()` and proceed.

**Rationale:** Code-model is the single gate; duplicate parse checks add noise.

### D5 — Code-model-only hardcoded expectations

**Choice:** [`samples/code-model-manifest.json`](samples/code-model-manifest.json) lists registered JSON paths and `expect` blocks (e.g. `noParseErrors`, `topLevelKeys`, `entityTypeCount`, `definitionUriCount`, optional `unresolvedUriCount: 0`).

**Maintainer procedure when adding or changing test JSON:**

1. Add or edit JSON under `samples/` (primary: `first-test.json`).
2. Update `code-model-manifest.json` `expect` to match new structure (run `npm test` — code-model fails until expectations updated).
3. Non-code-model tests pick up new model content automatically — no expectation file updates.

**Alternative rejected:** Expectation files per feature — forbidden outside code-model.

### D6 — No expectation files for other tests (ARCHITECTURE rule)

**Choice:** Prohibit committed oracle JSON (`*.spots.json`, `test-fixtures/**`, hardcoded URI lists in test scripts) for navigation, autocomplete, config-tree, apply, etc.

**Allowed self-oracles (computed at runtime from canonical fixture):**

| Test | Self-oracle algorithm |
|------|----------------------|
| **editor-navigation** | For every `configuration/…` string where `propertyKey !== 'uri'`: `getDefinitionNode(uri)` is the **`uri` property value** node; offset ≠ reference offset; `getAllUnresolved().length === 0` |
| **editor-navigation (refs)** | Every reference URI has `getReferences(uri).length >= 1`; definition URIs appear in `definitions` |
| **config-tree-view** | Walk all `ConfigTreeItem`s from `getConfigRootChildren` recursively; `findNodeAtPath(ast, jsonPath)` exists; definition items' AST node contains model `uri`; `getDefinitionNode(uri)` offset within item node span |
| **ontology-view** | `buildGraphModel(model)` — nodes ≥ 1; every edge `source`/`target` exists in node ids; `extends` edges when `extendsTypeURI` present in model |
| **autocomplete-improvements** | Walk every scoped string node (property in `PROPERTY_URI_COMPLETION_SCOPE`); `filterDefinitionUris(allDefs, scope, siblingEntity)` — entity scope excludes `/attributes/` paths; attributeUnderEntity only under sibling entity prefix |
| **schema-alignment-with-live-l3** | Canonical model top-level keys ⊆ schema `properties`; no separate expectation file |
| **apply-tenant-configuration-action** | Copy canonical `text` to temp; apply programmatic mutations in test code (not JSON patch files); assert `jsonDeepEqual` / guard helpers |

### D7 — Test run order

**Choice:** `run-unit-tests.cjs` runs `test-code-model-and-schema.cjs` **first**, then remaining scripts alphabetically.

**Rationale:** Parser validated before model-derived suite; matches mental model “code model gates the rest.”

### D8 — Extract pure helpers (unchanged)

`uriCompletionFilter.ts`, fix `getJsonPathAtOffset(text, ast, offset)`, existing `util/*` extractions.

### D9 — Velocity packs / skills script (unchanged scope)

`test-skills-and-enablement-packs-library.cjs` still validates packaged manifest/assets — **not** used as L3 fixture for navigation tests.

### D10 — `reltio-metadata-editor` umbrella

No dedicated script; child changes own scripts.

## Known product bug: cleanse `outputMappingRef` resolution

**Discovered via:** canonical fixture [`samples/first-test.json`](samples/first-test.json) — `UriIndex.getAllUnresolved()` reports 2 entries (same URI, two reference sites).

**Symptom:** `outputMappingRef` values such as `configuration/entityTypes/Location/cleanse/mappings/address/outputMapping` appear in `getAllUnresolved()` and Go-to-Definition cannot land on the referenced `outputMapping` array.

**Root cause:** [`UriIndex.walkAst`](src/navigation/uriIndex.ts) treats every `configuration/…` string whose parent property key is not `uri` as a **reference to a URI-defined object**. Cleanse config uses a different pattern:

- The mapping **definition** has `"uri": "configuration/entityTypes/Location/cleanse/mappings/address"`.
- The **`outputMapping`** payload is an **inline array property** on that mapping object (not a separate object with its own `uri`).
- **`outputMappingRef`** on cleanse chain steps points at `{mappingUri}/outputMapping` — a **synthetic path** to the sibling `outputMapping` array, not a registered definition.

Example in fixture (Location entity, Loqate cleanse chain):

```json
"mapping": {
  "inputMapping": [ … ],
  "outputMappingRef": "configuration/entityTypes/Location/cleanse/mappings/address/outputMapping"
}
```

The target array lives under `cleanseConfig.mappings[]` on the same entity:

```json
{
  "uri": "configuration/entityTypes/Location/cleanse/mappings/address",
  "outputMapping": [ { "attribute": "configuration/entityTypes/Location/attributes/…", … } ]
}
```

**Expected product behavior:**

- `outputMappingRef` resolves to the **`outputMapping` property value node** (the array) on the mapping object whose `uri` equals the ref with the `/outputMapping` suffix stripped.
- `getDefinitionNode(outputMappingRefUri)` returns that array node (or a virtual definition pointing at it), same as attribute virtual defs.
- After fix: `getAllUnresolved()` on canonical fixture is **0**; navigation self-oracle (D6) passes without test workarounds.

**Fix scope (implement during Bugfix Round 2):**

| Area | Change |
|------|--------|
| [`src/navigation/uriIndex.ts`](src/navigation/uriIndex.ts) | Recognize `outputMappingRef` property key; register ref URI → resolve to parent mapping object's `outputMapping` array node (walk AST or model cleanse mappings) |
| Navigation / reveal (if separate from index) | Ensure Go-to-Definition and find-references work for resolved `outputMappingRef` targets |
| Tests | No expectation-file workaround; fix product code first. Optional inline regression string in `test-editor-navigation.cjs` only if needed for isolated case — not a committed oracle file |

**Verification:** Fixed in `UriIndex.buildOutputMappingRefDefinitions()` — synthetic `{mappingUri}/outputMapping` refs resolve to the inline `outputMapping` array; canonical fixture reports zero unresolved.

**Not a fixture defect:** JSON is valid L3; the extension's URI index does not model cleanse `outputMappingRef` indirection.

## Per-change test mapping (Bugfix Round 2)

### 1. `code-model-and-schema` → runs **first**

| Tier | Coverage |
|------|----------|
| A | For each entry in `code-model-manifest.json`: `parseDocument` — `errors.length === 0`; `expect` counts match (entity types, definition URIs, top-level keys) |
| A | `first-test.json` is primary entry; optional additional samples listed in manifest only |
| A | Edit helpers on small inline strings in test script only (not separate expectation files): `findArrayInsertionPoint`, `findNodeRangeForDeletion` |
| C | Editor JSON schema validation UI |

### 2. `editor-navigation`

| Tier | Coverage |
|------|----------|
| A | Load canonical fixture; full reference→definition oracle (D6); zero unresolved (requires cleanse `outputMappingRef` fix — see above) |
| A | Virtual defs: reference attribute paths resolve via `getRealUri` |
| A | `findStringNodeAtOffset` on sampled offsets from walk |
| C | Ctrl+click in Extension Development Host |

### 3. `config-tree-view`

| Tier | Coverage |
|------|----------|
| A | Full tree walk on canonical model; every `jsonPath` resolves; reveal alignment with `getDefinitionNode` |
| A | Every section folder type present in fixture appears in roots |
| C | Context menu `when` clauses |

### 4. `ontology-view`

| Tier | Coverage |
|------|----------|
| A | `buildGraphModel` structural invariants on canonical model |
| A | `applyLayout` complete vs incomplete positions |
| C | Webview interaction |

### 5. `autocomplete-improvements`

| Tier | Coverage |
|------|----------|
| A | Walk canonical AST; per scoped property key assert filter rules (entity vs attribute separation) — **no hardcoded URI lists** |
| A | `collectStringValuesForPropertyName` consistency on discovered nodes |
| C | Ctrl+Space in editor |

### 6. `multi-tenant-tree-view`, `configuration-history`, `apply`, OAuth, UX, etc.

Unchanged where not L3-dependent (pure helpers). **Apply** uses temp copy of canonical **text** with mutations in test code.

### 7. Non-L3 scripts

`browser-oauth-login`, `setup-ux-redesign`, `no-create-wizards`, `extension-packaging`, `skills-and-enablement-packs-library` — keep pure logic / manifest checks; no `first-test.json`.

## Shared library layout

```
scripts/lib/
  import-dist.cjs
  load-canonical-fixture.cjs   # parseDocument(first-test.json)
  walk-configuration-uris.cjs  # all configuration/ string sites
  assert-navigation.cjs        # reference → definition uri node
  assert-tree-walk.cjs           # jsonPath + reveal alignment
  assert-completion-scopes.cjs   # scope rules on walked nodes
samples/
  first-test.json                # canonical L3 (populated — full tenant export)
  code-model-manifest.json       # ONLY hardcoded expectations
```

## Pipeline

```bash
npm test    # code-model first, then all scripts
npm run build && npm run package
```

## ARCHITECTURE.md (implement)

Add to **Unit tests (OpenSpec-aligned)**:

- Canonical L3: `samples/first-test.json`.
- Only `test-code-model-and-schema` + `samples/code-model-manifest.json` may hardcode expectations.
- **Forbidden:** expectation/oracle JSON files for other tests; hardcoded URI lists or spot files in navigation/autocomplete/tree scripts.
- Model-derived self-oracle pattern (D6 table).
- Procedure D5 for new sample JSONs.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Cleanse `outputMappingRef` unresolved (product bug) | Fix `UriIndex` during Round 2 before navigation self-oracle; see dedicated section above |
| Large fixture (~1.6MB) slows test suite | Parse ~60ms once per script via shared helper; monitor total `npm test` duration |
| Code-model manifest drift | Failing test forces explicit expectation update |

## Open Questions

- Rename `first-test.json` → `first-test.reltio.json` for schema association? (Optional; path fixed in manifest.)
