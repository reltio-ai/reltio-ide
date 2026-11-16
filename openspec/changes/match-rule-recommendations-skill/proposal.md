## Why

Match Lab Review already ships a deterministic **Suggested Changes** tab that proposes tightening a firing match rule by adding exact keys, ranked by `fill rate × sampled disagreement`. Two limits make it narrower than the SA workflow needs:

1. **Fill rate is measured only for candidate attributes.** `attributeFillRates` is called with the handful of columns that already cleared the sampled-pair gates (60% pair coverage, 10% disagreement). Every other attribute on the entity type is never measured, so an attribute that is well populated but happens to be absent from the sampled pairs is invisible to the ranking.
2. **The tab reasons one rule at a time.** It cannot weigh an entity type's whole attribute inventory, notice that two rules should converge on the same key, or take account of business meaning the L3 does not encode.

SAs want to ask the agent in chat, "given how this tenant's attributes are actually populated, how should these match rules change?" That is a judgement task over measured evidence, which is what a skill is for — the existing `reltio-match-lab-review` playbook is the model.

The blocker is data, not prose: the evidence a skill would need (fill rate for *every* attribute of *each* entity type) is not produced today, and producing it naively is expensive. On a `prod-usg` tenant there are **1,503 attributes across the 10 entity types that have match groups** (Supplier 512, Organization 309, Contact 134, …), so a full pass is ~1,500 additional `entities/_total` calls on top of a run that already takes about two minutes.

## What Changes

- Extend fill-rate measurement to cover **every attribute of an entity type**, behind a new `reltio.matchLab.fillRateScope` setting (`candidates` default, `all` opt-in), so the normal run stays fast and the expensive pass is a deliberate choice.
- Persist measured fill rates to a **`fill-rates.json` sidecar** per entity type with a timestamp, so the expensive pass runs once and later runs reuse it until it ages out or is refreshed.
- Measure with **bounded concurrency** and progress reporting, because ~1,500 sequential counts would take several minutes.
- Add a **Fill rates** tab to the entity workbook listing every measured attribute with its dotted search path, family, which match groups already use it as a key, populated/total counts, and rate.
- Add a new skill **`match-rule-recommendations`** that reads those tabs and proposes rule changes per entity type, with a pointer under `.cursor/skills/` and a `skillsBundleVersion` bump.
- Give the skill a **write-back path**: it saves its proposals to `<EntityType>.suggestions.json`, and the panel renders that file as the **Suggested Changes** tab under an "agent-generated, not measured" banner. The extension still never calls an LLM — it writes the evidence, the agent writes the judgement, and the panel displays whichever is present.
- Keep the deterministic Suggested Changes rows as the fallback when no agent sidecar exists. The skill reasons **from** the measured tabs rather than replacing them.

## Capabilities

### New Capabilities

- `match-lab-fill-rates`: measuring, caching, and presenting per-attribute fill rate for every attribute of an entity type on the connected tenant.
- `match-rule-recommendations-skill`: agent playbook for proposing match-rule changes from measured fill rates and census, including its boundaries.

### Modified Capabilities

- _(none — no existing `openspec/specs/` capability specs in this repository.)_

## Impact

- **`src/matchLab/fillRates.ts`**: enumerate all attributes when scope is `all`; bounded concurrency; cache read/write.
- **`src/matchLab/types.ts`**: `FillRateScope`, `FillRateCacheFile`, `AttributeFillRate` gains `family` and `inRules`.
- **`src/matchLab/reductionSuggestions.ts`**: consume the shared fill-rate map rather than measuring its own candidates.
- **`src/matchLab/workbook.ts`**: new **Fill rates** tab plus docs; tab order gains it after **Rule Analysis**.
- **`src/matchLab/sidecar.ts`**: read/write `<EntityType>.fill-rates.json` and read `<EntityType>.suggestions.json`.
- **`src/matchLab/panelHtml.ts`**: overlay the agent's suggestions onto the workbook before the panel renders it.
- **`src/matchLab/runMatchLab.ts`**, **`src/commands/matchLabReview.ts`**: thread the scope setting and cache path; progress messages for the long pass.
- **`package.json`**: `reltio.matchLab.fillRateScope`, `reltio.matchLab.fillRateMaxAgeHours`.
- **`skills/reltio-default/match-rule-recommendations/SKILL.md`**, **`.cursor/skills/reltio-match-rule-recommendations/SKILL.md`**, **`resources/reltio-agent-assets.json`** (`skillsBundleVersion` 12 → 13).
- **`skills/reltio-default/match-lab-review/SKILL.md`**: cross-reference the new playbook.
- **`scripts/test-match-lab-review.cjs`**: fetch-mocked coverage for scope, cache, concurrency, tab shape, and the suggestions overlay.
- **Read-only guarantee is unchanged.** Every new call is `entities/_total`. `MatchLabApi` still exposes only the five read functions, so no path exists to a configuration write, a match-table rebuild, or `POST …/entities/_matches`.
