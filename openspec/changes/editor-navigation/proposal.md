## Why

Reltio metadata configurations are dense webs of cross-references — entity type URIs referenced in match groups, attribute URIs in survivorship mappings, source URIs in cleanse configs, and so on. In `ppl-example.reltio.json` alone there are 702 URI definitions and 363 cross-references. Today, navigating from a reference to its definition means manual Ctrl+F searching. Reference attributes add another layer: `Merchant/Address` points to `Location`, so `Merchant/Address/attributes/City_Name` is a "virtual path" that should resolve to `Location/attributes/City_Name`. Without tooling, broken references (8 found in the sample file) go unnoticed.

## What Changes

- Add `src/navigation/uriIndex.ts` — builds an in-memory index of all URI definitions (real + virtual from reference attributes), tracks all URI references, and exposes lookup methods
- Add `src/navigation/documentLinkProvider.ts` — implements `DocumentLinkProvider` to underline URI strings and make them Ctrl+clickable
- Add `src/navigation/definitionProvider.ts` — implements `DefinitionProvider` for F12 / Alt+F12 (Peek Definition) navigation to URI definitions
- Add `src/navigation/referenceProvider.ts` — implements `ReferenceProvider` for Shift+F12 (Find All References) showing every location that references a given URI
- Add `src/navigation/diagnosticsManager.ts` — publishes Warning diagnostics for unresolved URI references, with configurable severity
- Wire all providers and diagnostics into `src/extension.ts` with lifecycle management

## Capabilities

### New Capabilities
- `uri-document-links`: All `configuration/...` string values become clickable links in the editor (underlined, Ctrl+click navigates to definition)
- `uri-go-to-definition`: F12 and Alt+F12 (Peek Definition) navigate from any URI reference to its definition site in the same file
- `uri-virtual-path-resolution`: Reference attributes synthesize virtual URI definitions by grafting the target entity's attribute tree — resolves cross-entity paths like `Merchant/Address/attributes/City_Name` → `Location/attributes/City_Name`
- `uri-find-all-references`: Shift+F12 (Find All References) shows every location in the file that references a given URI, works from both definition and reference positions
- `uri-unresolved-diagnostics`: Unresolved URI references are flagged with Warning squiggles (severity configurable via `reltio.unresolvedUriSeverity` setting)

### Modified Capabilities
- None — this change is purely additive

## Impact

- **New files**: `src/navigation/uriIndex.ts`, `src/navigation/documentLinkProvider.ts`, `src/navigation/definitionProvider.ts`, `src/navigation/referenceProvider.ts`, `src/navigation/diagnosticsManager.ts`
- **Modified files**: `src/extension.ts` (register providers, wire URI index lifecycle), `package.json` (add `reltio.unresolvedUriSeverity` configuration setting)
- **Dependencies**: None new — uses `jsonc-parser` (already installed) and VS Code API
- **Depends on**: Change 1 (`code-model-and-schema`) for TypeScript model types, Change 2 (`config-tree-view`) for `configParser.ts`
