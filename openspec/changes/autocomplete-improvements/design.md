## Context

The extension already maintains a **UriIndex** per active `*.reltio.json` document: it maps each `configuration/...` **definition** URI to an AST node and collects **reference** sites. Go to Definition and diagnostics reuse this index after `parseDocument` + `uriIndex.build(model, ast)`.

VS Code’s built-in JSON language features combine **JSON Schema** (property names, types, enums where declared) with **word-based** completions sourced from the document. For long URI strings, word-based suggestions dominate and look like “random” fragments.

## Goals / Non-Goals

**Goals:**

- When editing **URI-valued** properties, offer completions drawn from **definition URIs** present in the **same** L3 document (and virtual attribute URIs already indexed), scoped by **semantic role** (entity type vs relation type vs attribute path, etc.).
- Use **jsonc-parser** to detect cursor position: property key path + whether the cursor is in a **string value** (or inside an array of strings).
- Integrate with the **same** `UriIndex` instance used for navigation so results stay consistent with Go to Definition.

**Non-Goals:**

- Replacing JSON Schema validation or schema-driven **property** completion.
- Server-side or multi-file cross-tenant URI completion (only **current file** model for v1 unless explicitly extended later).
- Perfect ranking for every JSON editor UI edge case; first milestone is **correct candidate set** and **reasonable** sort/filter.

## Decisions

### D1 — `CompletionItemProvider` for `*.reltio.json`

**Decision:** Register `vscode.languages.registerCompletionItemProvider` with `documentSelector` matching `**/*.reltio.json`, implementing `provideCompletionItems(document, position, token, context)`.

**Rationale:** Native hook for Ctrl+Space; merges with schema completions when `CompletionList.isIncomplete` handling allows.

**Alternatives:** Only settings to disable word-based suggestions — insufficient alone; semantic list still missing.

### D2 — URI classification by JSON property name + optional path

**Decision:** Maintain an explicit **property → scope** table in code (`src/navigation/uriPropertyScopes.ts` → `PROPERTY_URI_COMPLETION_SCOPE`), derived from **velocity-pack** L3 analysis (counting `configuration/…` string values per JSON key across `resources/velocity-packs/**/BusinessConfig.json`) and from **`schemas/reltio-metadata.schema.json`** URI fields. Scopes include: top-level **entity** / **relation** URIs, **attribute paths** (match fields, keys, nested attributes, geo, …), **sources**, **match group** rule URIs, **survivorship** strategy URIs, **cleanse** mapping refs, **roles**, **vertical** reference config, `extendsTypeURI` (entity / relation / attribute type), **reference attribute** lists with sibling `referencedEntityTypeURI`, and **`uri`** as **any** indexed definition.

**Rationale:** Real L3 uses dozens of distinct property names (`matchFieldURIs`, `fieldURI`, `groupingRule`, `strategyUri`, …); a data-driven list stays closer to author intent than a minimal hand-picked set.

**Alternatives:** Infer only from schema `title`/`description` — fragile; expand the table as new keys appear in samples or support issues.

### D3 — Candidate enumeration from UriIndex

**Decision:** Extend or wrap **UriIndex** with a method such as `getDefinitionUris(filter: (uri: string) => boolean)` **or** iterate `definitions` + `virtualDefinitions` keys and filter by prefix (`configuration/entityTypes/`, etc.). Reuse existing URI strings only; do not fabricate paths.

**Rationale:** Single source of truth with diagnostics/navigation.

### D4 — Word-based suggestion noise and same-property reuse

**Decision:** (1) Prefer completion items with **`kind`** `Reference`, **`sortText`** so **same-file reuse** (below) and **model** URIs rank ahead of generic tokens. (2) **Harvest same-property values:** scan the entire AST for every string value assigned to the **same JSON property name** as the cursor (e.g. all `referencedEntityTypeURI` values in the file) and offer those as completions with detail **“Used elsewhere in this file (same property)”**, sorted before indexed definitions. (3) Ship **`configurationDefaults`** `[reltio.json]` → **`editor.wordBasedSuggestions`: `"off"`** so arbitrary substring suggestions do not drown out URI completions (users may override in settings).

**Rationale:** Reusing values already chosen elsewhere in the L3 is a strong signal; it replaces noisy word-based fragments for repeated keys without needing multiline semantic understanding.

### D5 — Trigger characters

**Decision:** Register `"` and `/` as trigger characters for URI paths (optional `"` for opening string values).

**Rationale:** Matches typing flow for `configuration/…`.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| **Performance** on very large L3 | Cap result count (e.g. 200–500 items), filter by typed prefix, debounce if profiling shows issues |
| **Wrong scope** for ambiguous properties | Start with explicit property-name table; expand iteratively |
| **Duplicate providers** with JSON extension | Use clear `label`/`detail`; avoid marking list incomplete unless implementing incremental completion |

## Migration Plan

1. Implement provider behind UriIndex + parse path.
2. Manual test matrix: Reference attribute block, relation endpoints, generic `uri` fields.
3. Optional follow-up: settings scope or user-facing doc for word-based suggestions.

## Open Questions

- Exact list of **property names** to extend in the scope table (v1 vs deferred).
