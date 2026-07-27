## Why

For `*.reltio.json`, property-name completion from JSON Schema works well, but **string value** completion for fields that must contain **`configuration/...` URIs** is noisy: editors surface **word-based** suggestions (fragments of strings seen elsewhere in the file), so picking `referencedEntityTypeURI`, `relationshipTypeURI`, `referencedAttributeURIs`, or similar fields produces irrelevant tokens instead of **valid model URIs from the current L3**.

## What Changes

- Introduce **semantic URI completion** for Reltio metadata JSON: when the cursor is inside a **value** position known to hold a `configuration/...` URI (or a list of such URIs), suggest **definitions from the current document** (via the existing **UriIndex**), filtered by **property name** and **URI segment** (entity types, relation types, attributes, sources, etc.).
- Narrow or rank completions so **URI suggestions** are usable (higher priority than arbitrary word matches); optionally document or contribute **editor settings** to reduce confusing word-based suggestions for `*.reltio.json` where needed.
- Keep schema validation and existing navigation (Go to Definition, diagnostics) unchanged.

## Capabilities

### New Capabilities

- `metadata-uri-completion`: Context-aware **CompletionItemProvider** for `*.reltio.json` that offers `configuration/...` strings from the **current parsed model** for URI-valued fields (including array elements such as `referencedAttributeURIs`), with filtering rules per JSON property.

### Modified Capabilities

- *(None — no existing `openspec/specs/` baseline in-repo; requirements live under this change only.)*

## Impact

- **`src/extension.ts`** — register completion provider; reuse **UriIndex** / parse pipeline already tied to open documents.
- **`src/navigation/`** — possible small additions to **UriIndex** (e.g. listing definition URIs by prefix or kind) and/or new **`uriCompletion.ts`** (provider + AST/property detection).
- **`package.json`** — optional `configurationDefaults` or documentation for `[reltio.json]` / word-based suggestions.
- **User-facing**: clearer Ctrl+Space / IntelliSense for URI fields without replacing built-in JSON schema behavior.
