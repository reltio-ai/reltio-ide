## 1. Settings and types

- [x] 1.1 In `package.json` → `contributes.configuration.properties`, add `reltio.matchLab.fillRateScope` (`string`, enum `candidates` | `all`, default `candidates`) with a description stating that `all` measures every attribute and costs roughly one count per attribute.
- [x] 1.2 Add `reltio.matchLab.fillRateMaxAgeHours` (`number`, default `168`) describing cache reuse.
- [x] 1.3 In `src/matchLab/types.ts`, add `export type FillRateScope = 'candidates' | 'all'`.
- [x] 1.4 Extend `AttributeFillRate` with `name`, `family: AttrFamily`, `depth: number`, and `inRules: string[]`.
- [x] 1.5 Add `FillRateCacheFile` (`engineVersion`, `entityTypeUri`, `measuredAt` ISO string, `scope`, `typeTotal`, `rows: AttributeFillRate[]`).
- [x] 1.6 Add `AgentSuggestionsFile` (`engineVersion`, `entityTypeUri`, `generatedAt`, `generatedBy`, `rows`) for the skill's write-back.

## 2. Measurement

- [x] 2.1 In `src/matchLab/fillRates.ts`, add `allAttributeUris(typeInv)` returning every attribute URI from `typeInv.attributes`, recording nesting depth from the count of `/attributes/` markers.
- [x] 2.2 Populate `inRules` by intersecting each attribute URI with every rule's `exactAttributeUris` / `exactOrNullAttributeUris`, storing rule `shortName`s.
- [x] 2.3 Replace the sequential `for` loop with a bounded worker pool (concurrency 6). Preserve existing behaviour exactly: 401 aborts the whole pass, any other error records `populated: null` and `rate: null`.
- [x] 2.4 Accept an `onProgress?: (done: number, total: number) => void` and report through `vscode.window.withProgress` from the command layer.
- [x] 2.5 Confirm `attributeSearchPath` is applied to every URI so nested attributes keep their dotted path — this is the bug that made `Phone.FormattedNumber` read 0.

## 3. Cache sidecar

- [x] 3.1 In `src/matchLab/sidecar.ts`, add `readFillRateCache(tenantRoot, entityType)` and `writeFillRateCache(...)` against `match-lab/<EntityType>.fill-rates.json`.
- [x] 3.2 Treat a cache as usable when `scope` is at least as broad as requested, `engineVersion` matches, and `measuredAt` is younger than `fillRateMaxAgeHours`; otherwise re-measure.
- [x] 3.3 On a partial pass (some rows `null`), still write the cache but do not let `null` rows satisfy a later request — re-measure only those.
- [x] 3.4 Never write a cache when the run aborted on 401.

## 4. Wiring

- [x] 4.1 In `src/commands/matchLabReview.ts`, read both settings and pass `fillRateScope` and `fillRateMaxAgeHours` into `runMatchLab`.
- [x] 4.2 In `src/matchLab/runMatchLab.ts`, when scope is `all`, measure the full set once per entity type before `buildReductionSuggestions`, and pass the resulting map in as `fillRateCache`.
- [x] 4.3 Change `buildReductionSuggestions` to use the supplied map when it already covers a candidate, measuring only what is missing.
- [x] 4.4 Progress messages should name the entity type and remaining count, e.g. `Supplier: fill rates 220/512`.

## 5. Workbook

- [x] 5.1 Add a `fillRatesTab` to `src/matchLab/workbook.ts` with columns: `Attribute`, `Path`, `Family`, `In rules`, `Populated`, `Total`, `Fill rate`, `Measured at`.
- [x] 5.2 Sort by fill rate descending, `not measured` rows last.
- [x] 5.3 Add `FILL_RATES_DOCS` stating the denominator is profiles of this entity type, that presence is measured with `exists()` and therefore counts non-OV values so it will not reconcile exactly with Console Data Profiling, that container attributes read higher than their leaves, and that `not measured` is a failed count rather than zero.
- [x] 5.4 Insert **Fill rates** into the tab order after **Rule Analysis**; leave it absent (not empty) when scope was `candidates`.
- [x] 5.5 Bump `MATCH_LAB_ENGINE_VERSION` in `src/matchLab/defaults.ts` to `7.1-fill-rates`.

## 6. Skill

- [x] 6.1 Create `skills/reltio-default/match-rule-recommendations/SKILL.md` with front matter `name` and `description`, following the `match-lab-review` structure: When to use / Inputs / Procedure / Reading the evidence / Proposing a change / Boundaries / Outputs.
- [x] 6.2 State the prerequisite plainly: Match Lab Review must have been run with `fillRateScope: all`, otherwise the Fill rates tab is absent and the skill should say so rather than guess.
- [x] 6.3 Document how to weigh the evidence — high fill rate plus high sampled disagreement is a strong key; low fill rate means a reduction would come from nulls; near-total disagreement means the key would disable the rule rather than sharpen it; an attribute already in `In rules` is not a new key.
- [x] 6.4 Require every proposal to cite measured numbers (potential-match count, fill rate, sampled pairs kept/dropped) and to label projections as extrapolations.
- [x] 6.5 State the boundaries: never edits L3, never applies configuration, never rebuilds match tables, never pastes pair PII into chat, hands off to `reltio-match-groups-from-concept` for the actual edit.
- [x] 6.6 Include one worked example using placeholder attribute names, with a note not to carry example names across tenants.
- [x] 6.7 Create the pointer `.cursor/skills/reltio-match-rule-recommendations/SKILL.md` matching the existing pointer format.
- [x] 6.8 Bump `skillsBundleVersion` in `resources/reltio-agent-assets.json` from `12` to `13`.
- [x] 6.9 Cross-reference the new playbook from the Suggested Changes section of `skills/reltio-default/match-lab-review/SKILL.md`.

## 7. Write-back into Suggested Changes

- [x] 7.1 In `src/matchLab/sidecar.ts`, add `agentSuggestionsPath` and `readAgentSuggestions(tenantRoot, entityType)` against `match-lab/<EntityType>.suggestions.json`.
- [x] 7.2 In `src/matchLab/workbook.ts`, add `applyAgentSuggestions(workbook, file)` that replaces the Suggested Changes rows with the agent's, prefixed by a banner row marking them agent-generated and not measured.
- [x] 7.3 Ignore the file when `engineVersion` or `entityTypeUri` does not match, so a stale agent file cannot masquerade as current analysis.
- [x] 7.4 Apply the overlay in `loadEntityWorkbooks` so the panel picks it up without the engine re-running.
- [x] 7.5 Document the file shape in the skill and have it write the file as its final step.

## 8. Tests

- [x] 8.1 `allAttributeUris` enumerates nested attributes and records depth correctly.
- [x] 8.2 Scope `all` measures every attribute; scope `candidates` measures only gated ones (assert call counts).
- [x] 8.3 Bounded concurrency drops no attributes and preserves the 401-aborts / other-errors-become-null behaviour.
- [x] 8.4 A fresh cache is reused with zero counts issued; an expired, wrong-scope, or wrong-engine-version cache triggers re-measurement.
- [x] 8.5 `null` rows are re-measured rather than treated as answered.
- [x] 8.6 No cache is written when the run aborts on 401.
- [x] 8.7 Fill rates tab shape, sort order, `not measured` rendering, and `In rules` population.
- [x] 8.8 `buildReductionSuggestions` issues no duplicate counts when given a covering map.
- [x] 8.9 A valid suggestions sidecar replaces the Suggested Changes rows and carries the banner; a stale one is ignored.
- [x] 8.10 Assert the engine stamp reads `7.1-fill-rates`.
- [x] 8.11 The playbook exists, carries the standard sections, and mentions neither Data Readiness, Rule Overlap nor `candidatesFile`.

## 9. Verification

- [x] 9.1 `npx tsc --noEmit -p ./` clean and `npm run compile` clean.
- [x] 9.2 `node scripts/test-match-lab-review.cjs` passes.
- [x] 9.3 `node scripts/run-unit-tests.cjs` — confirm the only failure is the pre-existing velocity-packs manifest one, and confirm adding a skill did not add a second failure.
- [ ] 9.4 Manual on a `prod-usg` tenant: run with scope `candidates` and confirm runtime and output are unchanged.
- [ ] 9.5 Manual with scope `all` on one entity type: confirm the Fill rates tab populates, the cache file is written, and a second run reuses it without re-counting.
- [x] 9.6 Confirm no `PUT`, no rebuild, and no `entities/_matches` call appears in the run — `MatchLabApi` still exposes only the five read functions.
