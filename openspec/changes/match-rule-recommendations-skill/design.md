## Context

Match Lab Review (`reltio.matchLabReview`) inventories every entity type with `matchGroups` from the tenant's on-disk `L3.reltio.json`, counts potential matches per rule via `entities/_total`, samples pairs, and writes one `<EntityType>.json` workbook sidecar per type under `.reltio/<env>/<tenant>.reltio.tenant/match-lab/`.

The engine is now `7.0-scoped-analyze`: one entity type per run, and the workbook is **Summary → Rule Activity → Rule Analysis → By Profile → one tab per rule → How to use → Suggested Changes**. The Coverage/Data Readiness and Rule Overlap tabs were removed along with `coverageSection`, `src/matchLab/ruleOverlap.ts` and the `reltio.matchLab.candidatesFile` setting; none of them should be reintroduced by this change.

Per-attribute fill rate exists, but only for **gated candidates** — attributes that already cleared `minCoverage` (0.6) and `minDifferShare` (0.1) on the rule's sampled pairs:

```ts
// reductionSuggestions.ts — one pass to find what is worth measuring
for (const stat of gatedDiscriminators(discriminatorStats(rulePairs, rule, typeInv))) {
    const uri = uriByName.get(stat.key);
    if (uri) candidateUris.add(uri);
}
const fillRates = await attributeFillRates(api, baseUrl, tenantId, token, typeInv.entityTypeUri, [...candidateUris], input.fillRateCache);
```

The cache is an in-memory `Map` created per entity type in `runMatchLab` and discarded when the run ends. Fill rate itself is `count(equals(type,…) and exists(attributes.<dotted path>)) / count(equals(type,…))`, using `attributeSearchPath` so nested attributes resolve to `Phone.FormattedNumber` rather than `FormattedNumber`.

Skills live at `skills/reltio-default/<name>/SKILL.md`, are copied wholesale into `.reltio/reltio-agent/skills/default/` by `reltioAgentSync` whenever `skillsBundleVersion` differs, and are surfaced to Cursor through thin pointers in `.cursor/skills/`. There is no manifest to regenerate for skills (only velocity packs have one).

## Goals / Non-Goals

**Goals:**

- Measure fill rate for every attribute of an entity type, on the connected tenant, without hardcoding attribute or entity-type lists.
- Keep the default run as fast as it is today; make the full pass opt-in and cached.
- Surface the measurements in the workbook so both a human reviewer and the agent read the same numbers.
- Ship a skill that proposes rule changes from that evidence, with explicit boundaries.

**Non-Goals:**

- Replacing the deterministic Suggested Changes rows. They stay as the fallback when the agent has written nothing.
- Editing L3, applying configuration, or rebuilding match tables. Unchanged from Match Lab's founding constraint.
- Calling an LLM from the extension or webview. The skill runs in Cursor Agent chat; the extension stays deterministic.
- Consuming a Reltio-native data-profiling endpoint. Deferred — see Open Questions.

## Decisions

1. **Scope is a setting, not a new command.** `reltio.matchLab.fillRateScope: 'candidates' | 'all'`, default `candidates`. *Rationale:* preserves today's runtime for users who only want the tab, and keeps a single entry point (`Match Lab Review`) rather than splitting the UX. A second command would duplicate the L3/token/gate preamble.

2. **Persist to `fill-rates.json` per entity type**, beside the existing workbooks, shaped as `{ engineVersion, entityTypeUri, measuredAt, typeTotal, scope, rows: [{ uri, path, name, family, populated, total, rate }] }`. *Rationale:* fill rates move on the timescale of data loads, not minutes. Paying ~1,500 counts once per week is acceptable; paying it per run is not. Keeping it separate from the workbook matters because the workbook is regenerated every run while the cache must outlive it.

3. **Reuse the cache when it is younger than `reltio.matchLab.fillRateMaxAgeHours` (default 168).** A stale or missing cache triggers re-measurement; deleting the file forces it. *Rationale:* a TTL is self-service and avoids adding a refresh command; a week matches how often match configuration is actually revisited.

4. **Bounded concurrency of 6, with progress reporting.** *Rationale:* the current sequential loop at ~200 ms per call would take about five minutes for 1,503 attributes. Six in flight brings it under a minute while staying well short of anything that would look like load. A 401 still aborts the whole pass immediately; any other failure records `rate: null`.

5. **A failed count is `null`, never `0`.** Already true in `attributeFillRates` and carried into the cache and the tab as `not measured`. *Rationale:* this is the exact bug class that produced silent zeros in the original census, and the fix must not regress when the data moves through a cache file.

6. **The Fill rates tab includes an `In rules` column** naming the match groups that already use the attribute as an exact key. *Rationale:* the single most useful join for the agent is "well populated but not used by any rule" versus "already a key", and computing it in the extension keeps the skill from re-deriving it from L3 and getting it wrong.

7. **`reductionSuggestions` consumes a fill-rate map passed in** rather than measuring its own candidates. *Rationale:* when scope is `all`, the measurements already exist; measuring twice would double the cost. When scope is `candidates`, `runMatchLab` measures exactly the current set, so behaviour is unchanged.

8. **The skill is advisory and cites only measured numbers.** It may propose a change the deterministic tab did not, but must quote the fill rate, census, and sampled-pair evidence behind it, and must label any projection as an extrapolation. *Rationale:* the tab's credibility comes from never inventing numbers; the skill inherits that constraint or it undermines both.

9. **The agent writes back to `<EntityType>.suggestions.json`, and the panel overlays it onto the Suggested Changes tab.** *Rationale:* the reviewer asked for the skill's output to appear where the tab already is, but the extension must never call an LLM, so it cannot produce that content during a run. Splitting it — extension writes evidence, agent writes judgement to a file, panel renders whichever exists — satisfies both. The overlay is version-stamped and ignored on an `engineVersion` mismatch, the same rule `loadEntityWorkbooks` already applies to stale workbooks, so an old agent file cannot masquerade as current analysis. A banner row marks the content as agent-generated so it is never mistaken for a measurement.

**Alternatives considered**

- **Always measure everything, no setting.** Simpler, but makes every run several minutes slower for users who never open the skill. Rejected in favour of opt-in plus cache.
- **Batch fill rates through `entities/_facets`.** `facetEntities` already exists and takes multiple fields, but facets return counts per *value*, not per-attribute presence, so high-cardinality attributes would return enormous payloads. Not a fit.
- **Have the skill compute fill rates itself by asking the agent to call APIs.** Non-deterministic, unbounded in cost, and would put credentials in the agent's path. Rejected; the extension measures, the skill reasons.
- **Put fill rates on an existing tab.** Rule Analysis is per *rule* (profiles populating a rule's whole exact key set); fill rate is per *attribute*. Overloading one tab with two different denominators is how the `eligible` column got misread before.
- **Have the panel call the agent to fill the tab on demand.** Would breach the no-LLM constraint in the extension. Rejected.

## Risks / Trade-offs

- **[Risk] Run time and API volume on large tenants.** Supplier alone has 512 attributes. Mitigation: opt-in scope, cache with TTL, bounded concurrency, progress messages naming the entity type and count remaining.
- **[Risk] `exists()` semantics may not equal Reltio Console's own fill-rate figure.** `exists(attributes.X)` counts profiles where the attribute is present at all, which may include non-OV values and will differ from a profiler that counts OV only. Mitigation: label the column as measured by `exists()` in the tab docs and the skill, so nobody reconciles it against the Console and assumes a bug.
- **[Risk] Container attributes inflate the picture.** `exists(attributes.Phone)` is true whenever any nested phone field is set, so a container reads higher than its leaves. Mitigation: record the attribute's nesting depth and show leaves and containers distinctly in the tab.
- **[Risk] A skill produces plausible but unmeasured advice.** Mitigation: Decision 8, plus an explicit "do not invent counts" rule and a worked example in the playbook showing evidence citation.
- **[Trade-off] Cached numbers can be stale relative to a fresh data load.** Accepted; `measuredAt` is shown in the tab so the reviewer can judge, and the TTL bounds it.
- **[Pre-existing] `test-skills-and-enablement-packs-library.cjs` currently fails** on a velocity-packs manifest byte count, unrelated to this work and reproducible with these changes stashed. It must be checked after adding a skill so a real regression is not hidden behind the known failure.

## Migration Plan

Additive. A tenant with no `fill-rates.json` simply measures on first opt-in run. Default scope `candidates` means existing users see no behaviour change until they opt in. Rollback is reverting the setting default and the new tab; cached sidecars are inert data and can be deleted.

## Resolved Questions

1. **Should fill rate use a Reltio-native data-profiling endpoint instead of `exists()` counts?** **Resolved: no, not for now.** The fill rates the reviewer sees live in the Console's Data Profiling screen and no supported API for them could be identified, so nothing was guessed. `exists()` counting stays, behind `attributeFillRates` so a profiling endpoint can replace it later without touching the tab, the cache or the skill. The consequence is documented rather than hidden: `exists()` counts profiles where the attribute is present at all, **including non-OV values**, so the tab will not reconcile exactly with the Console figure.

## Open Questions

1. **Should the skill cover relation-type match rules**, or entity types only? This plan assumes entity types only, matching Match Lab's current scope.
2. **Is a week the right TTL default**, or should it key off the L3 fetch timestamp instead of wall-clock age?
