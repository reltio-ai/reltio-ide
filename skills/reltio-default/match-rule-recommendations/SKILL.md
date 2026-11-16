---
name: reltio-match-rule-recommendations
description: Recommend match rule changes for one entity type from measured attribute fill rates and sampled pair evidence, to bring down potential matches without suppressing real ones. Advisory only — does not apply L3 or rebuild match tables.
---

# Match rule recommendations

The extension does not call an LLM; this playbook is for Cursor Agent chat.

This playbook turns the measured Match Lab evidence into proposed rule changes. The extension measures; you reason. Every number you quote must come from a tab — never from memory of another tenant and never from an estimate you produce yourself without labelling it.

## When to use

The user wants to **reduce potential matches** on an entity type, asks which attributes would make a better match key, asks why a rule is producing so many candidates, or asks what to change about a match group. Use it after **Match Lab Review**, never instead of it.

## Inputs

1. A **Match Lab Review** run on the entity type in question, with `reltio.matchLab.fillRateScope` set to `all`. That setting is what writes the full fill-rate file below.
2. The workbook for that entity type: `.reltio/…/<tenant>.reltio.tenant/match-lab/<EntityType>.json`, plus the shareable `<EntityType>.xlsx`.
3. The fill rates for every attribute: `match-lab/<EntityType>.fill-rates.json` (`rows[]` with `key`, `path`, `inRules`, `populated`, `total`, `rate`, and — when `source` is `dataQuality` — `uniqueValues`, `sharedValues`, `sharedProfileRate`, `topValues`). The panel has no Fill rates tab; this file is the source.

**If `<EntityType>.fill-rates.json` is absent, stop and say so.** It means the last run used the default `candidates` scope, which measures only the handful of attributes already gated as discriminators. Ask the user to set `reltio.matchLab.fillRateScope` to `all` and re-run Match Lab Review on that entity type. Do not substitute the fill rates quoted on Suggested Changes for the full file, and do not guess a fill rate from attribute names.

## Procedure

1. **Read the workbook header first.** `entityType`, `entityTypeUri` and `engineVersion` are top-level fields on the workbook JSON, not rows on any tab. You will need the engine version later. Remember that the Rules tab is sampled, so a figure taken off it is not a tenant-wide one.
2. **Read Rule Activity**, one row per rule, for the measured potential-match count. This is a profile count, not a pair count. Rank the rules by it: the rule carrying the volume is the one worth changing, and a quiet rule is rarely the problem. The same row carries that rule's **Status**, **Keys in rule**, **Sampled pairs**, **Profiles with all rule keys populated**, and **Lab notes** — the same measurements written out as sentences, including which keys were left out of the eligibility count and which attributes were empty across the whole sample.
3. **Open Rules and select each high-volume rule** to see its sampled pairs — the `cmp_` columns are where you read what the rule is actually merging.
4. **Read `<EntityType>.fill-rates.json`** for the attribute evidence — see below.
5. **Read Rule Overlap if it is present.** Use it to explain when two rules compete on the same tenant profiles: **Share of rule A/B** is profiles flagged by both, divided by that rule's potential-match count. Those figures are tenant-wide, not sampled — do not confuse them with **Also matched by** on the Rules tab, which only describes the pair sample.
6. **Read Suggested Changes** for what the extension already derived deterministically. On a full-scope run those rows are themselves fill-rate-driven: an attribute is admitted as a candidate on its measured tenant fill rate, ranked by `fill rate × sampled disagreement`; each row's **Fill rate**, **Uniqueness** and **Why (fill / uniqueness)** give the whole-tenant figures, and **After (range)** states the sample-based effect in one sentence. There is no Notes column; count sampled-pair disagreement yourself from the `cmp_` columns on the Rules tab. Rows for attributes the rule leaves unused but the tenant populates well are proposed on the fill rate alone and read `not measured` in the estimate columns — that is a gap in the evidence, not a zero, and your job on those rows is to say what would settle it. Treat it as a floor, not a ceiling: you may agree, extend, or disagree with a row, but if you disagree you must say which measured number you are reading differently.
7. **Write your proposals** to the sidecar described under *Outputs* so they appear in the panel.

## Reading the evidence

**Fill rate** (`rate` in the fill-rates file) is measured on this tenant now — from the Data Quality API (`exists / (exists + missing)`) when `source` is `dataQuality`, else `count(exists(attribute)) / count(profiles of this type)`. With Data Quality the row also gives `sharedProfileRate` (`(exists − unique) / exists`, the share of profiles sharing their value), the distinct values (`uniqueValues + sharedValues`) and `topValues`. Use them: a key almost nobody shares caps how many profiles can still match on it; a key with a handful of distinct values only splits broad groups; a placeholder top value (`[unknown]`, `Test`) keeps matching through it until it is cleansed.

| What you see | What it means for a rule change |
| --- | --- |
| High fill rate, high sampled disagreement | The strongest candidate for a new exact key: it is present to compare and it separates profiles the rule currently merges. |
| High fill rate, near-zero disagreement | Adding it changes almost nothing — the pairs already agree on it. Not a fix for over-matching. |
| High fill rate, near-total disagreement (≥95%) | Requiring it would drop nearly every current candidate. That disables the rule rather than sharpening it; say so explicitly. |
| Low fill rate (below ~30%) | Any reduction would come from **nulls**, not from discrimination. The count falls while real matches are suppressed. Propose `exactOrNull` if anything, and name the risk. |
| `not measured` | The count **failed**. It is not zero and it is not an empty attribute. Never rank on it and never report it as 0%. |
| Listed under **In rules** | The rule already uses it as a key. It is not a new key for that rule. |
| A container reading higher than its leaves | Expected: a profile with any `Address` counts for `Address` even when `Address.PostalCode` is empty. Compare leaves with leaves. |

Two limits to state whenever you lean on this tab:

- Presence is measured with `exists()`, which counts **non-OV values too**, so these rates are a ceiling and will not reconcile exactly with the Console's Data Profiling screen.
- The denominator is every profile of the entity type, not the pairs the rule matched. A tenant-wide fill rate does not tell you the key is populated on the specific profiles this rule is merging — **Profiles with all rule keys populated** on Rule Activity is the check for that.

The `cmp_` columns on the Rules tab, for the rule you selected, show how many sampled pairs had both sides populated and how many of those disagreed. That is the evidence for disagreement; the fill rate is the evidence for availability. A good proposal needs both.

## Proposing a change

Every proposal must:

1. **Name one rule and one concrete change** — `Add exact <Attribute>`, `Add exactOrNull <Attribute>`, `Add exact <A> + <B>`, or `No change`. Vague advice ("tighten the rule") is not a proposal.
2. **Cite the measured numbers behind it**: the rule's potential-match count from Rule Activity, the attribute's fill rate from the fill-rates file with its populated/total, and the comparable-and-disagreeing pair counts from the `cmp_` columns on the Rules tab. Per-pair survival is not shown as a column; `Est. change` is the extrapolation and `Caution` names the pairs a strict `exact` would drop for a missing value.
3. **Label every projection as an extrapolation.** Any "count after" figure is the census scaled by a sampled survival rate. The match engine is not re-run and no match table is rebuilt, so it is an inference, not a measurement. Say which it is in the same sentence as the number.
4. **State the risk of being wrong.** For a tightening proposal that is almost always "which real matches would this stop finding" — nulls suppressed by a low fill rate, a key that is unique per source record rather than per person, a cleanser that already normalizes the difference away.
5. **Rank the proposals** by measured reduction against risk, and lead with the rule carrying the most volume.
6. **Say when nothing should change.** A high count on a healthy rule is not a defect. `No change` with the reason is a valid and often correct output.

Prefer changes to the rule carrying the volume over changes spread across every rule, and prefer one added key with a clear basis over a combination that is hard to reason about. Propose a two-key combination only when the second key drops pairs the first did not.

## Worked example

Placeholder names — **do not carry these attribute names to another tenant.** Read the actual tab.

> `RuleAlpha` carries 412,000 profiles with potential matches (Rule Activity), the highest of the five rules. The same row gives its keys as `AttrOne + AttrTwo`, and its Lab notes say the sampled pairs disagree on a name. Selecting `RuleAlpha` on the Rules tab shows the sampled pairs agreeing on both keys while disagreeing elsewhere.
>
> In the fill-rates file, `AttrSeven` is populated on 94% of profiles (47,000/50,000) and no rule lists it under `inRules`. On the Rules tab its `cmp_` column shows both sides populated on 1,000 of 1,000 sampled pairs and disagreeing on 690 of them, and `Est. change` reads `-69%`.
>
> **Proposal:** add `AttrSeven` as an exact key on `RuleAlpha`, giving `AttrOne + AttrTwo + AttrSeven`. On the sampled evidence, 690 of 1,000 pairs would stop matching. Scaling the census by that survival rate **extrapolates** to roughly 128,000 profiles, which is an estimate and not a measured count.
>
> **Risk:** `AttrSeven`'s 94% fill rate is tenant-wide; Rule Activity reports 41,000 profiles populate all three keys, so about 6% of current candidates would be dropped for having no value rather than for disagreeing. If that matters, the Caution column names how many sampled pairs `exact` would drop purely for a missing value, and `exactOrNull AttrSeven` would keep exactly those while still dropping the genuine disagreements.

## Boundaries

- **Never edit L3.** This playbook produces a recommendation, not a change.
- **Never apply configuration, never PUT `…/configuration`, never rebuild match tables, never POST `…/entities/_matches`, never start a task or a match-table job.**
- **Never paste pair PII into chat** — no names, emails, phones, addresses, or Hub dumps. Cite counts, rates, and rule names.
- **Never invent a number.** If a figure is not on a tab, say it was not measured. `not measured` is never 0.
- **Never hardcode attribute, entity-type, or tenant names** into a recommendation, a script, or a file. Read them from the workbook the user actually ran.
- **Google Sheets and Drive are out of band.** Share the `<EntityType>.xlsx` the extension already wrote; do not call Drive APIs.
- To actually make the change, hand off to the **`reltio-match-groups-from-concept`** playbook and the normal L3 edit → validate → HITL Apply path.

## Outputs

Write your proposals to `.reltio/…/<tenant>.reltio.tenant/match-lab/<EntityType>.suggestions.json`. The panel renders it in place of the generated **Suggested Changes** rows:

```json
{
  "engineVersion": "<copy the workbook's top-level engineVersion>",
  "entityTypeUri": "<copy the workbook's top-level entityTypeUri>",
  "generatedAt": "<ISO 8601 timestamp>",
  "generatedBy": "match-rule-recommendations",
  "columns": ["Rule", "Basis", "Proposed change", "Resulting exact keys", "Projected effect", "Risk"],
  "rows": [
    {
      "Rule": "<rule short name from Rule Activity>",
      "Basis": "<the measured reason: fill rate with populated/total, uniqueness, and the comparable/disagreeing pair counts>",
      "Proposed change": "Add exact <Attribute>",
      "Resulting exact keys": "<full key set after the change>",
      "Projected effect": "<count, stated as an extrapolation (≈N approx) or a ceiling (at most N)>",
      "Risk": "<what real matches this could suppress>"
    }
  ]
}
```

- `engineVersion` **must match the workbook's** top-level field exactly. A mismatch means the workbook was rebuilt by a different engine and the panel ignores your file rather than showing stale analysis as current.
- Columns are yours to choose; the ones above are a sensible default. Keep an identifying column, such as Rule, first.
- The file replaces the generated rows in the panel. It does not change the `<EntityType>.xlsx`, the workbook JSON, or anything in L3, and re-running Match Lab Review does not delete it.
- In chat, summarize: rule name, proposed change, the measured basis in one line, and the risk. Not the table, and never pair rows.
