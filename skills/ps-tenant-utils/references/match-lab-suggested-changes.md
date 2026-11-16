# Match Lab — Suggested changes (normative)

Single source of truth for the deterministic Suggested changes tab and the Attribute profile tab.
Code under `src/matchLab/suggestedChanges/` must implement this document exactly.
Thresholds live in `src/matchLab/suggestedChanges/constants.ts` only.

Last updated: 2026-03-24

---

## 1. Workbook tabs (order)

| # | Tab | Purpose |
|---|-----|---------|
| 1 | **SA Briefing** | Run context: entity type, tenant, timestamps, matching gate, rule count. Unchanged shape from prior Match Lab briefing. |
| 2 | **Census** | Per-rule counts and keys (no suggested-change verdicts). Same census columns as before Rule notes split. |
| 3 | **Suggested changes** | One primary row per match group URI; optional **Also** rows for secondary findings. This document defines the contract. |
| 4 | **Attribute profile** | One row per entity type × attribute used in any rule; all uniqueness metrics. |
| 5 | **By entity** | Profile-centric navigation (formerly “By Profile”). |
| 6 | **Rules** | Sampled pair rows (pair tab); rule picker in the panel. |
| 7 | **How to use** | Reading order for the tabs above. |

**Optional extensions** (same workbook when data exists): **Fill rates** (full-scope pass), **Rule Overlap** (tenant-wide pair counts for hand-built rules). Automatic rules are not shown on any tab. They are not inputs to the decision table.

**Retired as visible tabs**

| Old tab / column | New home |
|------------------|----------|
| Rule Activity (combined) | **SA Briefing** + **Census** + Signal/Status remain on Census |
| Rule notes — Formatted rule, Keys in rule | **Suggested changes → Current rule** |
| Rule notes — unmapped / hidden key finding | **Suggested changes → Verdict Data quality, code D02** |
| Rule tokens | **Suggested changes → Current rule / Suggested rule** |
| Old Suggested Changes (Kind, Basis, Caution, …) | Replaced by Verdict + Reason code + Why + Risk |
| Coverage (visible) | Hidden discriminator stats only; **Missed duplicates suspected (M01)** |

---

## 2. Suggested changes — column contract

Banner row (first data row after header labels):

> Rule-based. Not L3 authority. Changes go through match-groups-from-concept and HITL Apply.

Exactly **one primary row per match group**, keyed by `matchGroup.uri`. Secondary findings: extra rows, same Rule name, **Verdict = Also**, same Reason code when applicable.

| # | Column | Content |
|---|--------|---------|
| 1 | Rule | Match group short name |
| 2 | Type · Scope | e.g. `suspect · ALL` |
| 3 | Potential matches | Census profile count, or `error` / `not measured` |
| 4 | Sampled pairs | Pair rows for this rule on the Rules tab |
| 5 | Verdict | See §2.1 |
| 6 | Reason code | Catalog code (§6) |
| 7 | Attribute | Attribute short name, or blank |
| 8 | Current rule | `Operator: … · Token: … · Comparator: …` plus `Keys: …` and trimmed `Formatted: …` from L3 |
| 9 | Suggested rule | Same format; only changed parts; blank when no change |
| 10 | Why | Catalog Why line, placeholders filled |
| 11 | Risk | Catalog Risk line, placeholders filled |
| 12 | Est. potential matches after | Integer or `not estimated` |
| 13 | Est. change | Signed % or blank |
| 14 | Confidence | `Measured (labels)` \| `Sample only` \| `Not enough data` |

### 2.1 Verdict values (only these)

`No change` · `Idle` · `Not enough sample` · `Data quality` · `Pairing mismatch` · `Comparator stricter` · `Add exact key` · `Hold` · `Token narrower` · `Missed duplicates suspected` · `Also`

---

## 3. Attribute profile — columns

`Entity type` · `Attribute` · `Used in rules` · `Fill rate` · `Distinct ratio (sample)` · `Top value` · `Top-value share` · `Placeholder found` · `Chance agreement (u)` · `Agreement on true pairs (m)` · `Same-source agreement` · `Cross-source agreement` · `Stability` · `Uniqueness class` · `Measurement notes`

See §4 for metric definitions.

---

## 4. Metric definitions

All thresholds are named constants in `constants.ts`.

- **Fill rate** — `populated ÷ total` for the entity type via read-only `entities/_total` / fill-rate pass.
- **Distinct ratio (sample)** — distinct normalized values ÷ populated value slots among sampled profiles. Below minimum profile count → `not measured`.
- **Facets** — `POST …/entities/_facets`, `orderType: count`, `pageSize: 50`, `searchByOv` when any using rule has `useOvOnly`.
- **Facet word-split check** — Compare ≥ `facetWordSplitMinTerms` facet terms to sampled normalized values; if &lt; `facetWordSplitMinMatchShare` match → top value, top-value share, u = `not measured`; Measurement notes = `facet terms are word-split`.
- **Empty facet** — top value, top-value share, u = `not measured`; never compute u from empty facets.
- **u** — \(u = \sum p_i^2 + R^2 / D_{rest}\), \(p_i = count_i / populated\), \(R = 1 - \sum p_i\), \(D_{rest} = \max(1, \round(distinctRatio \times populated) - termCount)\). Requires measured distinct ratio.
- **m** — agreement on pairs labeled true match; requires ≥ `minLabeledPairsForM` else `no labels`.
- **Stability** — `stable` \| `per-source` \| `unclear` \| `not measured` (insufficient same/cross pairs).
- **Uniqueness class** — `high` \| `medium` \| `low` \| `unknown` (only when both u and distinct ratio measured).

---

## 5. Reference pairing table

Loaded from `resources/match-lab/token-comparator-pairings.json` (source URL and checked date in file).

- Unknown token or comparator → `not in reference table` (code **P02**).
- Invalid pair → **P01**; do not invent a suggested pairing (**Hard ban §7**).

---

## 6. Decision table (first match wins)

| Order | Condition | Verdict | Code |
|------:|-----------|---------|------|
| 1 | Census = 0 and scope INTERNAL | Idle | I01 |
| 2 | Census = 0 and rule cites unmapped/hidden key | Data quality | D02 |
| 3 | Census = 0 | Idle | I02 |
| 4 | Sampled pairs &lt; minimum | Not enough sample | N01 |
| 5 | Placeholder in sampled pairs at ≥ threshold share | Data quality | D01 |
| 6 | Token/comparator not valid pair or not in reference table | Pairing mismatch | P01 / P02 |
| 7 | Fuzzy attribute, disagree share ≥ threshold, disagreements mostly in not-a-match labels | Comparator stricter | C01 |
| 8 | Best add-key candidate passes fill, uniqueness, stable, no placeholder, m threshold | Add exact key | K01 / K02 |
| 9 | Best candidate per-source stability | Hold | H01 |
| 10 | Fuzzy/phonetic token, uniqueness low, attribute not under fuzzy operator | Token narrower | T01 |
| 11 | Labeled true pairs, typo-only disagree on exact-token attribute | Missed duplicates suspected | M01 |
| 12 | Else | No change | X01 |

Secondary findings (e.g. additional P01 attributes) → **Also** rows.

---

## 7. Message catalog

Only these templates; fill `{placeholders}` numerically. No other prose.

| Code | Why | Risk |
|------|-----|------|
| I01 | Scope is INTERNAL and the rule produces no potential matches. | None. |
| I02 | The rule produces no potential matches. | None. |
| N01 | {sampled} sampled pairs; at least {min} are needed to judge this rule. | Not judged. Re-run with a larger sample cap for this rule. |
| D01 | {attr} value "{value}" appears in {n} of {sampled} sampled pairs ({pct}%). | These pairs will stay matched until the value is cleansed. |
| D02 | {attr} is not mapped, so it cannot contribute. | The rule can't match on loaded data. |
| P01 | {attr} uses token {token} with comparator {comparator}; the reference pairing for {token} is {expected}. | Candidates may not reach the comparator as intended. |
| P02 | {class} on {attr} is not in the reference table. | Pairing not checked. |
| C01 | {attr} differs in {k} of {n} populated sampled pairs ({pct}%). | The stricter comparator also drops {t} labeled true pairs. |
| K01 | {attr}: fill {fill}%, uniqueness {class}, stable across sources; {k} of {n} sampled pairs agree. | Drops {miss} sampled pairs missing {attr}. |
| K02 | Same as K01, with exactOrNull. | exactOrNull keeps the {miss} pairs with {attr} missing. |
| H01 | {attr} agrees in {same}% of same-source pairs but {cross}% of cross-source pairs. | Exact {attr} would drop cross-source duplicates. |
| T01 | {attr} uniqueness is low (u = {u}); the fuzzy token creates large candidate groups. | Potential matches mostly unchanged; candidate volume drops. |
| M01 | {k} labeled true pairs differ on {attr} only by a typo. | A wider token may increase potential matches. |
| X01 | No rule in the decision table applies to this sample. | None. |

---

## 8. Estimates

**Est. potential matches after** = census × (surviving sampled pairs ÷ sampled pairs), integer round.

`not estimated` for codes: I01, I02, D02, N01, P01, P02, T01, M01, H01.

**Confidence**

- `Measured (labels)` — verdict uses m.
- `Sample only` — otherwise (when judged).
- `Not enough data` — N01.

---

## 9. Validation checks (CI / tests)

1. Every Why/Risk matches catalog regex for its Reason code.
2. Verdict and Reason code consistent with decision table row.
3. No suggested token/comparator pair outside reference table.
4. No exact-token suggestion for an attribute under `fuzzy` operator.
5. No `No change` when sampled pairs &lt; minimum (must be N01).
6. No verdict using uniqueness class when class is `unknown` or metric `not measured`.
7. Same fixture input → byte-identical Suggested changes rows (determinism).
8. Primary row count = hand-built match group count.
