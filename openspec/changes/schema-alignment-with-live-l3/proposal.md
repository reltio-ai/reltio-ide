## Why

Batch validation of real tenant L3 JSON from Reltio APIs (`examples/prod/**/L3.reltio.json`) against `schemas/reltio-metadata.schema.json` showed that **over 99% of configurations failed** validation (historical corpus analysis prior to alignment) for patterns that the platform clearly accepts—boolean flags encoded as strings in the schema, `params` modeled as arrays while APIs return objects, strict `additionalProperties: false` on match configuration leaves out documented platform fields, and polymorphic `rule` / `cleanse` shapes. Editors therefore surface **noise and false positives** instead of actionable issues. Aligning the JSON Schema with live L3 reduces friction for multi-tenant workflows and restores trust in schema-backed validation.

## What Changes

- Widen JSON Schema types for cleanse-chain and related fields where the API emits **booleans** or **`null`** but the schema requires **strings** (and similar XSD-to-JSON mismatches).
- Relax or remodel **`CleanseChain.params`** so both **array** (`MapEntry` list) and **object** (free-form key maps) validate, matching observed L3.
- Introduce **union / `oneOf`** (or equivalent) for polymorphic nodes such as **`matchGroups[].rule.cleanse`**, **`directionalContext[].rule`**, and match/survivorship **`and`** where the API returns **string**, **object**, or **array** depending on context.
- Extend **`$defs`** for match comparator / match-token **parameter value** objects to include high-frequency API keys (`className`, `pattern`, `noiseDictionary`, `classParams`, `useNoiseIfEmpty`, etc.) **or** selectively loosen `additionalProperties` where the platform is open-ended.
- **Measure progress** after schema edits: use **VS Code** validation (same schema file) and spot-check representative `examples/prod/**/L3.reltio.json` files. _(Historical: a batch `validate-corpus.cjs` harness and metrics doc were used during implementation; both have been **removed**.)_
- **Phase 2 (corpus-driven):** Close remaining hotspots—`MatchRule` weights/action thresholds, group/member booleans and `groupElements`, `lookupComparisonField`, `groupTokenLimit` typing, nested `additionalProperties`, entity/attribute keys such as `access`, and residual `cleanse` `oneOf`—see spec requirements and §7 tasks.
- **Non-goals (initial scope):** changing `src/parser` runtime behavior, UriIndex, or ontology graph logic unless a schema-driven type change forces it; replacing VS Code’s JSON Language Service.

## Capabilities

### New Capabilities

- `metadata-json-schema`: Requirements for how `schemas/reltio-metadata.schema.json` describes live L3 tenant metadata—type unions, nullable fields, polymorphic rules, and match-parameter shapes—so VS Code validation matches platform JSON.

### Modified Capabilities

- _(None.)_ There are no existing capability specs under `openspec/specs/` to modify; this introduces the first spec for schema validation behavior.

## Impact

- **`schemas/reltio-metadata.schema.json`** — primary edit surface; draft-07; affects all `*.reltio.json` including `L3.reltio.json` via `package.json` `jsonValidation`.
- **Corpus tooling (removed):** `VALIDATION_IMPROVEMENTS.md` and **`scripts/validate-corpus.cjs`** were used during implementation for batch metrics; they are no longer in the repository.
- **`src/model/types.ts`** — phase 1 (task 6.1) aligned with initial schema widenings; **phase 2** (tasks §7) keeps types in sync with match/group/survivorship/entity extensions.
- **Users** — fewer spurious Problems panel entries; possible subtle behavior change if any consumer relied on overly strict validation as a gate.
