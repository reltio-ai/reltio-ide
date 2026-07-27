## Context

The extension registers `schemas/reltio-metadata.schema.json` for `*.reltio.json` via VS Code `jsonValidation`. The schema was derived from the Reltio XSD-oriented model and uses many `type: string` and `additionalProperties: false` choices that do not match JSON returned by `GET /reltio/api/{tenantId}/configuration`. Alignment was informed by a large local corpus under `examples/prod/` (~1k `L3.reltio.json` files). **Regression checks:** use VS Code Problems panel and spot-check representative tenant files under `examples/` (and `samples/`); the batch `validate-corpus.cjs` harness has been **removed** from the repo.

## Goals / Non-Goals

**Goals:**

- Reduce **false-positive** JSON Schema diagnostics for configurations the Reltio platform accepts.
- Prefer **documented, testable** schema patterns: unions (`oneOf` / `anyOf`), explicit `null` where APIs emit null, and extended `$defs` where the API has a closed vocabulary of extra keys.
- After substantive schema edits, use **VS Code** (`jsonValidation` with the same schema file) and spot-checks on representative `examples/prod/**/L3.reltio.json` and `samples/*.reltio.json` files as needed.
- Keep **draft-07** compatibility unless the project explicitly upgrades `$schema`.

**Non-Goals:**

- Rewriting the parser (`src/parser`) or navigation (`UriIndex`) in the first iteration unless a schema change breaks compilation or tests.
- Treating any external batch validator as the **user-facing** UX (editor remains authoritative for squiggles).
- Persisting or fetching L3 in-repo (corpus remains local / gitignored).

## Decisions

### D1: Prefer unions over “string-only” for XSD-style booleans

**Decision:** Where live L3 uses JSON `true`/`false` but the schema says `string` (e.g. `proceedOnSuccess`, `proceedOnFailure`, similar OV/group flags), model `anyOf: [{ type: boolean }, { type: string }]` or a single `type` array `[ "boolean", "string" ]` per draft-07 support.

**Rationale:** Matches API reality; string preserved for legacy exports.

**Alternatives:** Coerce in a custom validator (rejected: VS Code does not run custom code for contributed JSON Schema).

### D2: `CleanseChain.params` as array **or** object

**Decision:** Replace strict `type: array` with `anyOf` array-of-`MapEntry` **or** `type: object` (optionally `additionalProperties: true` or a loose property map).

**Rationale:** High-volume corpus errors; object payloads are structured maps, not `MapEntry[]`.

**Alternatives:** Only `type: object` (might reject rare array-only tenants—verify against corpus before choosing).

### D3: Polymorphic `rule` / `cleanse` / `and`

**Decision:** Use `oneOf` branches: e.g. `{ type: string }` (URI), `{ $ref: ... }` for full object shapes already in `$defs`, and array forms where observed under `directionalContext`.

**Rationale:** Single `type: object` is provably wrong for live data.

**Alternatives:** Remove type keyword and use `{}` with `additionalProperties: true` (rejected first pass: loses autocomplete value).

### D4: Match comparator / token parameter **values**

**Decision:** Extend the relevant `$defs` so known keys (`className`, `pattern`, `noiseDictionary`, `classParams`, `useNoiseIfEmpty`, … per histogram) are first-class optional properties; retain `additionalProperties: false` only if the remaining surface is stable—otherwise set `additionalProperties: true` for that value object with a comment in design/tasks.

**Rationale:** Histogram shows a finite, repeating set; extending `$defs` preserves strictness for unknown keys until evidence of open-ended extensions.

### D5: Full-corpus compare (historical)

**Decision (during implementation):** A batch script (`scripts/validate-corpus.cjs`, Ajv + `ajv-formats`) validated all `examples/prod/**/L3.reltio.json` files and emitted JSON summaries for before/after comparison. That script and the companion metrics doc have since been **removed** from the repository.

**Current practice:** Rely on **VS Code** JSON schema validation (same `schemas/reltio-metadata.schema.json`) and manual spot-checks on representative tenant files.

### D6: Phase 2 — remaining corpus hotspots (historical)

**Decision:** Follow-on schema work was tracked in **tasks §7**, driven by corpus metrics and hotspot lists from the batch runs (weights/thresholds, group/member booleans, `lookupComparisonField`, `groupTokenLimit`, nested `additionalProperties`, entity `access`, residual `cleanse`).

**Rationale:** Phase 1 removed the largest buckets; phase 2 needs sample-driven `oneOf` / type unions per area to avoid over-loosening.

## Risks / Trade-offs

- **[Looser schema hides real typos]** → Mitigation: prefer unions over blanket `additionalProperties: true`; keep histogram-driven explicit properties first.
- **[Schema edge cases]** → Mitigation: spot-check the same file in the Problems panel when diagnostics look suspicious.
- **[Large schema diff review]** → Mitigation: land in focused commits per area (cleanse, match, relations).
- **`src/model` drift** → Mitigation: optional follow-up task; parser often tolerates extra fields.

## Migration Plan

1. Land schema changes on a branch; spot-check representative `L3.reltio.json` files in VS Code; attach notes or screenshots to the PR when useful.
2. No runtime migration: existing workspaces pick up validation on extension reload / schema reload.
3. Rollback: revert schema commit.

## Open Questions

- Official Reltio JSON contract: is there a newer XSD-to-JSON mapping or internal doc that should be the **source of truth** instead of corpus-only inference?
- Should a **small** set of anonymized snippets live under `samples/` for regression, instead of relying on private `examples/` trees?
