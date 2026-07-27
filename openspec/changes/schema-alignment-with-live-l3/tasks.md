**Maintenance note:** `scripts/validate-corpus.cjs` and `VALIDATION_IMPROVEMENTS.md` were **removed** from the repository after this change shipped. The checklist below is a **historical** record; use VS Code `jsonValidation` on representative `L3.reltio.json` files for ongoing checks.

## 1. Baseline (examples + editor)

- [x] 1.1 **Baseline recorded.** The **before** corpus metrics and gap analysis were captured in a machine run over ~1,045 files under `examples/prod/` (7 valid, 83,404 error instances prior to alignment). The metrics doc has since been removed.
- [x] 1.2 **N/A / superseded.** A batch corpus script was used during implementation for full-corpus compares (see §5); that script has been **removed**.

## 2. Cleanse configuration schema

- [x] 2.1 Update `CleanseChain` in `schemas/reltio-metadata.schema.json`: allow boolean **or** string for `proceedOnSuccess`, `proceedOnFailure`, and other XSD-string boolean fields in that `$def` per design D1.
- [x] 2.2 Update `CleanseChain.params` to accept **array** (`MapEntry`) **or** `object` per design D2; spot-check in VS Code on a few `examples/prod/**/L3.reltio.json` files.
- [x] 2.3 Update `CleanseInfos` (and related cleanse `$defs`) so `useInCleansing` accepts `null` or uses `type` array including `null` per spec.

## 3. Polymorphic rules (match + relations)

- [x] 3.1 Model `matchGroups[].rule.cleanse` as a `oneOf` (string URI vs object) per design D3; spot-check in VS Code on `examples/` tenants that previously failed. _(Extended to include **array** of `MatchRuleCleanse` after corpus revealed live shape.)_
- [x] 3.2 Model relation `directionalContext[].rule` with unions covering object vs array shapes observed in live L3; spot-check at least two tenant files under `examples/` plus `samples/` if applicable.
- [x] 3.3 Resolve match/survivorship `and` nodes where both array and object forms appear—use `oneOf` or equivalent without breaking existing samples under `samples/`.

## 4. Match comparator / token parameter values

- [x] 4.1 Extend the relevant `$defs` for comparator and match-token **parameter value** objects with optional properties from the corpus histogram (`className`, `pattern`, `noiseDictionary`, `classParams`, `useNoiseIfEmpty`, etc.) per design D4.
- [x] 4.2 If residual `additionalProperties` failures remain with no stable vocabulary, document the decision to loosen `additionalProperties` for that sub-object and apply narrowly. _(Implemented as `MatchComparatorTokenParameterValue` with `additionalProperties: true` for that value object; residual errors were mostly elsewhere in the corpus.)_

## 5. Full-corpus validation, compare, iterate

- [x] 5.1 Run batch corpus validation over **`examples/prod/**/L3.reltio.json`** (historical: `node scripts/validate-corpus.cjs`; script **removed** after work completed).
- [x] 5.2 **Compare** batch summary to metrics doc (historical; doc **removed**).
- [x] 5.3 **If** error counts increased or new failure families appeared: update metrics doc and tasks; **N/A — metrics improved** during implementation (83,404 → 16,468 error instances; 7 → 253 valid files, then further to full pass).
- [x] 5.4 Finalize alignment summary; corpus script and metrics doc later **removed** from repo per cleanup.

## 6. Type model alignment (optional)

- [x] 6.1 Audit `src/model/` types for fields widened in the schema; adjust interfaces only where the parser or tests enforce stricter types and fail after schema relaxation. **Done:** `src/model/types.ts` updated for cleanse/match/survivorship unions and `MatchComparatorTokenParameterValue`; `npm run compile` clean. Follow-up schema tweak: `MatchRuleCleanse.cleanseAdapterParams` object-or-array.

## 7. Phase 2 — remaining hotspots (historical corpus metrics)

Phase 2 was driven by corpus hotspot lists from batch validation runs over `examples/prod/`. The batch script and metrics doc have been **removed**.

- [x] 7.1 **`MatchRule.weights` & `MatchRule.actionThresholds`:** Inspect failing paths in corpus output; add `oneOf` (object vs array, and any third branch found in L3) in `schemas/reltio-metadata.schema.json`; keep `samples/*.reltio.json` valid.
- [x] 7.2 **`GroupType` / `MemberType` / `GroupElement`:** Widen string-only flags to `string | boolean` (and `null` where needed) per corpus; fix `groupElements` with `oneOf` or new `$defs` if API sends array or richer object—confirm with `examples/prod/**` snippets.
- [x] 7.3 **`SurvivorshipMapping.lookupComparisonField`:** Add `oneOf` for array vs object vs string (whichever appear in corpus).
- [x] 7.4 **`MatchComparatorTokenParameterValue.groupTokenLimit`:** Schema `integer | string` (draft-07); mirror in `src/model/types.ts` if represented explicitly.
- [x] 7.5 **Nested `additionalProperties` (~180):** Trace `topSignatures` / histogram in batch corpus output; extend inner `$defs` or narrowly loosen `additionalProperties` for identified subtrees (e.g. inside `classParams`).
- [x] 7.6 **`EntityType` / `Attribute` extensions:** Add optional `access` (and any other recurring keys from corpus) to the relevant `$defs`, or document + allow a controlled extension pattern.
- [x] 7.7 **Residual `MatchRule.cleanse` `oneOf`:** List failing tenant paths from corpus output; if `null` or other wrapper appears, add schema branch; re-run corpus until `oneOf` count drops or is explained.
- [x] 7.8 **`src/model/types.ts`:** Align TypeScript interfaces with all §7 schema edits; `npm run compile` clean.
- [x] 7.9 **Doc refresh:** Update corpus metrics doc after §7 work (doc later **removed** from repo).
