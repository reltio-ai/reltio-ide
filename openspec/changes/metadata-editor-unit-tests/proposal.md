## Why

The Reltio IDE extension has grown through many OpenSpec changes but automated tests are still shallow. We need CLI unit tests aligned with each OpenSpec change, a **single canonical L3 fixture** ([`samples/first-test.json`](samples/first-test.json)), and a clear rule: **only `test-code-model-and-schema`** may hardcode expectations; all other tests derive assertions from the parsed model at runtime.

## What Changes

- Keep **Option A** harness: `npm test` → `tsc` + `scripts/run-unit-tests.cjs`.
- **Canonical fixture:** [`samples/first-test.json`](samples/first-test.json) is the shared L3 input for navigation, tree, ontology, autocomplete, schema-alignment, and apply tests. All non-code-model tests **assume the JSON is fully correct** (parse succeeds, URIs resolve).
- **Code-model gate:** `test-code-model-and-schema.cjs` runs **first** in the aggregator. It is the only script that validates parsing and maintains hardcoded expectations via [`samples/code-model-manifest.json`](samples/code-model-manifest.json) (registered fixtures + expected counts/keys). Procedure documented for adding JSONs or updating expectations when fixture content changes.
- **No expectation files elsewhere:** navigation, autocomplete, config-tree, apply, etc. MUST NOT use committed spot/oracle JSON. Assertions are computed from `model` + `ast` + `UriIndex` (self-oracle). Document this prohibition in **ARCHITECTURE.md** during implementation.
- Rewrite Bugfix Round 1 tasks → **Bugfix Round 2** per updated design.
- Shared helper: `scripts/lib/load-canonical-fixture.cjs` loads and parses `first-test.json` once per script.

## Capabilities

### New Capabilities

- `openspec-aligned-unit-tests`: CLI harness, per-change scripts, canonical fixture strategy, code-model manifest, model-derived deep tests, ARCHITECTURE rules.

### Modified Capabilities

- _(none — test infrastructure only.)_

## Impact

- **Modified:** [`openspec/changes/metadata-editor-unit-tests/design.md`](design.md), [`tasks.md`](tasks.md), [`specs/openspec-aligned-unit-tests/spec.md`](specs/openspec-aligned-unit-tests/spec.md)
- **New at implement:** [`samples/code-model-manifest.json`](samples/code-model-manifest.json), `scripts/lib/load-canonical-fixture.cjs`, shared assert helpers, rewritten test scripts; **product fix** for cleanse `outputMappingRef` in `UriIndex` (see design.md)
- **ARCHITECTURE.md:** add no-hardcoded-expectations rule (except code-model manifest)
