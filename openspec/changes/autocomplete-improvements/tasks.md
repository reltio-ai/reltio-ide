## 1. Discovery and UriIndex support

- [x] 1.1 Add a concise API on **UriIndex** (or a dedicated helper) to list **definition** URIs filtered by predicate or prefix (e.g. `configuration/entityTypes/`, `configuration/relationTypes/`, attribute paths), including keys needed for **virtual** definitions where applicable.
- [x] 1.2 Document in code the **v1 property-name → scope** table (`referencedEntityTypeURI`, `relationshipTypeURI`, `referencedAttributeURIs`, `startObject`, `endObject`, generic `uri` under known parents, etc.) aligned with `design.md` D2.

## 2. Completion provider

- [x] 2.1 Implement `ReltioUriCompletionProvider` (or equivalent) using **jsonc-parser** `findNodeAtOffset` / parent property chain to detect (a) string **value** position, (b) array-of-string context, (c) parent **property name**.
- [x] 2.2 Map detected property + surrounding object (e.g. sibling `referencedEntityTypeURI`) to a **URI filter**; query UriIndex helper for candidates; build `CompletionItem[]` with appropriate `range`, `kind`, `sortText`/`detail`; include **same-property** values from **`samePropertyValues.ts`**.
- [x] 2.3 Register provider in **`extension.ts`** for `**/*.reltio.json` with trigger characters at least **`"`** and **`/`**; ensure provider reads **current** `UriIndex` for the document (same instance as definition provider).
- [x] 2.4 Add a **reasonable cap** on returned items and **prefix filter** based on text before cursor to avoid huge lists on large L3 files.

## 3. Editor UX and documentation

- [x] 3.1 Decide and implement whether to set **`configurationDefaults`** `[reltio.json]` → `"editor.wordBasedSuggestions": "off"` (or leave default and document manual setting in **README** / **ARCHITECTURE.md**).
- [x] 3.2 Manual test pass: reference attribute snippet, relation endpoints, at least one nested `uri` field; confirm schema-driven **property** completion still works. *(Checklist codified in **ARCHITECTURE.md** → Entry Points → manual QA for URI completion.)*

## 4. Verification

- [x] 4.1 Run **`npm run compile`**; spot-check in VS Code/Cursor that Ctrl+Space in classified URI values lists model URIs.
- [x] 4.2 Update **`ARCHITECTURE.md`** package structure with `uriCompletion` (or chosen module path) and mention URI completion under language features.
