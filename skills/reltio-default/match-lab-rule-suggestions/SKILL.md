---
name: reltio-match-lab-rule-suggestions
description: Ranked match rule change ideas from Match Lab sidecars, L3, and optional Console DQ metrics (fill rate, uniqueness, top values). Use for "Suggestion changes", "rule suggestions", "match rule changes", "fill rate", "uniqueness", "reduce potential matches", after Match Lab Review, or Match Lab sidecar work on the Suggested Changes tab.
---

# Match Lab rule suggestions

When the user is on **Match Lab Review → Suggested Changes** (or asks for rule change ideas), read Match Lab sidecars and tenant L3, optionally join **Console Data Quality** exports, and produce **ranked tightening suggestions** only. This is not generative rule invention: every number must trace to evidence on disk or to filters documented in sidecar metadata. Do not call tenant APIs from this skill unless the user explicitly runs a separate allowed command.

## When to use

- The user mentions **Suggestion changes**, **Suggested Changes**, **rule suggestions**, or **match rule changes**.
- They ask about **fill rate**, **uniqueness**, **top values**, or **reduce potential matches** in the context of Match Lab.
- They finished **Match Lab Review** and want next steps grounded in the **Match Lab sidecar** for one entity type.

## Inputs (workspace — do not invent paths)

Resolve the tenant from the user’s connected environment (`.reltio/…/<tenant>.reltio.tenant/`).

1. **Match Lab sidecars** — `match-lab/` under that tenant:
   - `<EntityType>.json` — workbook JSON: Rule Activity census per rule (`Profiles with potential matches`, `censusStatus` if present in census export), `engineVersion`, `entityTypeUri`. Use **Rule Overlap** and **Suggested Changes** tabs as printed in the file. Do **not** echo pair attribute values (`a_*`, `b_*`, `cmp_*`) or Hub URLs in chat.
   - `matching-pipeline-gate.json` — gate context only (idle/skipped).
   - Optional: `<EntityType>.fill-rates.json` — cached full-scope fill pass for every attribute (the panel has no Fill rates tab). Rows with `source: "dataQuality"` already carry Data Quality figures: `uniqueValues`, `sharedValues`, `sharedProfileRate` and `topValues`. Use them as the DQ metrics when `dq-attribute-metrics.json` is absent.
2. **L3** — `L3.reltio.json` for that tenant: match groups on the entity type, **Exact** / **exactOrNull** keys, `ignoreInToken`, **rule** vs **negativeRule**, hidden attributes, FERN/automatic groups (do not suggest changes on FERN groups).
3. **Optional (preferred for fill / uniqueness aligned with Console DQ)** — `match-lab/dq-attribute-metrics.json`  
   Per-attribute objects:
   - `name`, `path` (e.g. `attributes.Phone.FormattedNumber`)
   - `filled`, `missing`, `fillRate` (0–1 or 0–100 — normalize to percent in prose)
   - `uniqueFilled`, `uniquenessRate`
   - `topValues`: `[{ "value", "count" }]`
   If this file is missing, write `not measured` in **Fill rate** / **Uniqueness**, and make **After (range)** the "we cannot yet say" sentence for rows that need them. Tell the user in chat which attributes need metrics — **do not guess percentages**.
4. **Optional** — `match-lab/match-lab-candidates.json` — human rows with `filter` / requirement text; treat as candidate ideas only if filters are present.

## Outputs

### 1. Chat (SA-facing)

Reply with a markdown table:

| Target rule | Keys in rule | Suggested change | Fill rate | Uniqueness | Why (fill / uniqueness) | Census now | After (range) |
| --- | --- | --- | --- | --- | --- | --- | --- |

**Keys in rule** lists every attribute the rule compares today, comma-separated, exactly as on Rule Activity (hidden ones read `(not mapped)`).

There is no **Priority** column; list the rows most important first instead.

**Fill rate** and **Uniqueness** hold the actual whole-tenant figures for each added attribute, one line per attribute: `Email: 72% (236,441 of 328,391 profiles)` and `Email: 96% of profiles unique (230,102 distinct values)`. Uniqueness is the share of profiles whose value no other profile has, `1 − (filled − unique) / filled`. Write `not measured` when the figure is missing.

There are no **Notes**, **Confidence**, **Evidence**, **Reltio Notes** or **Customer notes** columns; the panel drops them if written. Say how solid a figure is in **After (range)** itself (see *After (range) wording*).

**Why (fill / uniqueness)** is exactly two bullets (`• …` lines separated by a line break), whole tenant only, from `dq-attribute-metrics.json` or `.fill-rates.json`, never figures from the sampled pairs. The first bullet covers how often the added attributes are filled in and what that means for matching. The second covers how unique they are. Example: `• Email is filled in on 72% of profiles, so most profiles can be compared on it.` then `• Email is unique on 96% of profiles, so it is good at telling different profiles apart.` Give sampled-pair evidence, cautions and the files you read in chat, not on the tab.

### 2. Panel overlay (optional write-back)

To replace generated rows on **Suggested Changes**, write:

`.reltio/…/<tenant>.reltio.tenant/match-lab/<EntityType>.suggestions.json`

```json
{
  "engineVersion": "<same as EntityType.json workbook>",
  "entityTypeUri": "<from workbook>",
  "generatedAt": "<ISO-8601>",
  "generatedBy": "match-lab-rule-suggestions",
  "columns": [
    "Rule",
    "Keys in rule",
    "Suggested change",
    "Fill rate",
    "Uniqueness",
    "Why (fill / uniqueness)",
    "Census now",
    "After (range)"
  ],
  "rows": [ { ... } ]
}
```

`engineVersion` must match the workbook or the panel ignores the file.

## After (range) wording

Write **After (range)** as one plain sentence about what the change does to the rule's potential matches, the same way the generated rows do:

| Write | When |
| --- | --- |
| `If you add Email to Rule1, potential matches would drop by about 80%.` | Sample survival or n/k for that rule is in the sidecar; scale the census with the stated formula. |
| `If you add Email to Rule1, potential matches would drop by at least 70%, because only some profiles share their Email value with another profile.` | Only a ceiling is known (Data Quality `filled − unique`, eligible-only, collision bound). |
| `If you add Email to Rule1, we cannot yet say how much potential matches would drop, because …` | Fill or uniqueness unknown, or fewer than 8 sampled pairs on that rule. Say in chat what would settle it. |
| `If you add Email to Rule1, potential matches would stay about the same.` | The sample shows no pair would be dropped. |

Never write a percentage that was not measured or derived from a stated ceiling.

## Decision rules (order)

1. **censusStatus error** (or Rule Activity `Profiles with potential matches` = `error`) → one row: **NO CENSUS — fix count first**.
2. Join each rule’s **Exact** key attributes to `dq-attribute-metrics.json` by **path** (fallback: `.fill-rates.json`; uniqueness is available there when `source` is `dataQuality`, otherwise it **needs metrics**). Data Quality `unique` / `notUnique` count distinct values, not profiles: the share of profiles that share a value is `(filled − unique) / filled`, and as an exact key at most `filled − unique` profiles can still match.
3. **Fill rate** (use DQ when present; else `.fill-rates.json`):
   - **&lt; 40%**: do **not** recommend “Add as Exact to cut PMs”; recommend DQ/mapping or **exactOrNull** with **needs metrics** / eligible language from sidecar if available.
   - **40–70%**: **exactOrNull** only if tightening; warn about the missing-data drop in chat.
   - **≥ 70%**: may recommend **Exact** tighten if uniqueness + sample support it.
4. **Uniqueness / frequency** (DQ file):
   - Low uniqueness or dominant top value (e.g. &gt;1% of filled or obvious junk): suggest **ignore value** / **negative rule** / **ignoreInToken** — name the value from `topValues`; After reads `at most N`; no fabricated total drop.
   - High uniqueness (**≥ 85%**) + high fill: candidate extra **Exact** key on that rule only, with an "about N%" After sentence if sample n/k exists in sidecar.
5. Do **not** recommend **loosening** rules. Skip **FERN** and automatic groups — Match Lab does not list automatic rules on any tab.
6. **New rules**: never state exact “after PM count”; eligible / **bounded** language only.
7. **Never** PUT L3, never rebuild match table, never paste bearer tokens or pair PII.

## Citing sources (in chat)

End your chat reply with short pointers only, e.g. `Contact.json Rule Activity Firing`, `Contact.fill-rates.json Phone 88%`, `dq-attribute-metrics.json path attributes.Email`, `Rule Overlap Firing×Rule2 share 42%`, `Suggested Changes row 3`.

## Boundaries

- Extension **Suggested Changes** rows are experimental measurements; your table **supersedes** them only when written to `.suggestions.json`.
- For applying changes, hand off to **`reltio-match-groups-from-concept`** and HITL Apply.
- **`reltio-match-rule-recommendations`** remains valid for fill-rate × disagreement ranking from measured tabs alone; use **this** skill when DQ uniqueness / top values or SA-style priority tables are required.
