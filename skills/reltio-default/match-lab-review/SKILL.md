---
name: reltio-match-lab-review
description: Review potential matches (counts and sampled pairs) for one entity type or for every entity type that has match groups. Observational only — does not apply L3 or rebuild match tables.
---

# Match Lab review

The extension does not call an LLM; this playbook is for Cursor Agent chat.

Match Lab is an **observational** potential-match briefing. It does not apply configuration and does not rebuild match tables.

## When to use

The user wants to **review potential matches**, run **Match Lab**, understand why pairs matched, or inspect suspect / INTERNAL match groups on the connected tenant.

**Automatic rules are left out.** A rule whose type starts with `automatic` (including `automatic_grouping`) merges what it finds instead of leaving potential matches for review, so Match Lab does not count, sample, overlap or suggest changes for it, and it is not listed on any tab. Rule Activity names the ones it left out in a `Not shown: …` line above the table. An entity type whose only rules are automatic gets a `Reason:` line on every tab saying so.

## Inputs

1. Connected **environment** and **tenant** with L3 already fetched. Use the tenant the user right-clicks — do not hardcode a host, tenant id, or entity-type list.
2. TokenStore Bearer for **that** environment (**Provide Token**, or Browser Sign-In where the environment supports it).
3. Command **Match Lab Review** (`reltio.matchLabReview`) — right-click an **entity type** or its **Match Groups** section. It analyzes that one entity type and nothing else. There is no whole-tenant run; analyze entity types one at a time.

## Procedure

1. **Confirm L3 and authentication.** If there is no token or an API call returns 401, tell the user to **Provide Token** for the environment they opened and re-run. Do not invent a password grant or read token.json.
2. **Run Match Lab Review** — right-click the entity type the user is asking about, or its Match Groups section. The extension waits until matching is idle, then analyzes that entity type only, and the panel shows that entity type only. Entity types are never a committed TypeScript list. An entity type with **no match groups** is still analyzed: it gets an empty Rule Activity tab that says so, since every rule-driven tab would be empty.
3. **If matching is not idle** — report matching queue size, events queue size, and Status. Do not skip the gate unless the user explicitly confirms skip.
4. **After success** — explain from `chatSummary` (rule name plus status label) plus the webview. Do not paste pair rows, names, emails, phones, or Hub dumps into chat.
5. **Google Spreadsheets are out of band** (not this extension). Do not call Drive APIs.
6. **Never** Apply Configuration, never rebuild match tables, never POST `…/entities/_matches`, never treat GET `/reltio/tenants` as a hard dependency (403/804 is expected).

## Reading Status

Each hand-built rule gets a deterministic **Status** column on the **Rule Activity** tab. No model is involved. There is no Signal column; whether the rule looks healthy is said in words in **Lab notes**.

**Status** — what the rule is doing right now. The cell states the finding in words rather than a coined label, so quote it as written and do not shorten it back to jargon like "firing" or "idle". Exactly one of five values, decided in this order:

| Status | What was measured |
| --- | --- |
| `The count failed — unknown, not zero` | The count call errored. Never report this as 0. |
| `No potential matches; scope is INTERNAL` | Zero matches and scope `INTERNAL` — expected quiet until that source loads. |
| `Cites keys hidden in L3 or absent from the mapping list` | The rule cites L3 `hidden:true` keys while producing nothing, or cites keys the supplied mapping list does not claim while nothing populates its exact keys. Either way those keys cannot contribute. |
| `No potential matches` | Zero matches, with no other measured signal. |
| `Produces potential matches` | The rule is producing potential matches. |

A high potential-match count is not by itself a defect. Read it against the **Lab notes** before calling a rule broken: they say whether the sampled pairs agree on the rule's keys, which unused attributes usually differ, and — for a quiet rule — whether profiles populate its keys at all.

**Profiles with all rule keys populated** on the same row counts profiles that populate every exact key of a rule. It is **not** a pair count and **not** a prediction of new matches. Exact-or-null, negative-only, and hidden keys are skipped because they produce no match tokens. Read it with Status: a rule that barely fires while nothing can satisfy its keys is a data problem, not a rule problem.

For per-key disagreement — how often the sampled pairs actually differed on an attribute — select the rule on the **Rules** tab and read its `cmp_` columns (`equal`, `differ`, `A only`, `B only`). Suggested Changes has no Notes column, and it does not repeat these counts. A rule that fires while its sampled pairs disagree on a name attribute is the over-matching case.

**Rule Activity** is one row per rule and carries everything measured about that rule: Status, the tenant-wide potential-match count, the sampled pair count, its keys, and how many profiles can satisfy them.

**Lab notes** on the same row is at most **4 bullet points** in plain, customer-readable language, most important first: what the count came to, then what the sample pairs suggest (names that differ, attributes the rule ignores that usually differ, or that the matches look like real duplicates), then how the rule compares values (nicknames, sound-alike, hidden attributes) and how many profiles have the rule's attributes filled in. It is generated deterministically from the same measurements; it is not a model's opinion. Quote the bullets as written rather than paraphrasing them into shorthand.

**Scope** on the **Rules** tab is the owning rule's match scope on its own — `ALL`, `INTERNAL`, or `NONE`. An `INTERNAL` rule only compares profiles that came from the same source, which is why it can sit at zero without anything being wrong.

The tabs carry no explanatory header text — the columns are the whole content. When a reader asks why a rule matched two values that do not look identical, the answer is that cleansers, match tokens and comparators all run **inside the match engine**, so their effect never appears in the `a_*` / `b_*` columns:

- **Name Dictionary Cleanser** maps nicknames and name variants (for example Bob ↔ Robert) before comparison.
- **String Replacement Cleanser** applies configured replacements — noise words, punctuation, abbreviations — for matching tokens only.
- **Noise words and `ignoreInToken`** omit listed tokens from match tokens so they neither block nor force a match on their own.

None of these change stored profile data; they run at match time only.

## Optional user-supplied file

The customer's own file — nothing ships with the extension. Leave it blank and the lab infers unused keys from empty occupancy only.

- `reltio.matchLab.mappingFile` — JSON such as `{ "intendedAttributes": ["FirstName", "LastName"] }`. Tells an unused key apart from a tenant that simply has no data.

## Measurement settings

- `reltio.matchLab.fillRateScope` — `candidates` (default) or `all`. `all` measures every attribute of the entity type, writes `<EntityType>.fill-rates.json`, and is what the `reltio-match-rule-recommendations` playbook needs. It costs roughly one read-only count per attribute, so the run is slower.
- `reltio.matchLab.fillRateMaxAgeHours` — how long a cached full pass stays usable. Default 168 (one week).

## Suggested Changes tab (EXPERIMENTAL)

The last tab, beside **How to use**, lists each rule with its current potential-match count and generated suggestions for tuning it. A rule the sample shows no problem with gets **No change suggested** — the tab is about optimizing rules, not about reducing every count on sight. For every firing rule the extension ranks attributes the rule does **not** already compare by **this tenant's measured fill rate × sampled disagreement**. Family (demographics, identifiers, email, phone, address, name) is a tie-break only — never a hardcoded preference list, and never a per-entity TypeScript file. A column must be populated on both sides of at least 60% of the rule's pairs, disagree on at least 10% of those, and have tenant-wide fill rate of at least 30% to be offered at all.

**How an attribute is admitted as a candidate depends on what was measured.** With `reltio.matchLab.fillRateScope` set to `all`, availability is judged on the attribute's **measured tenant fill rate**, so every attribute of the entity type is weighed here. On the default `candidates` scope there is no tenant measurement to lean on, so it falls back to how often the attribute was comparable on that rule's own sampled pairs — which under-reports an attribute the tenant populates well but this rule's candidates happen to be missing. That is the practical reason to run full scope. Either way the attribute must still disagree on at least 10% of the pairs where it could be compared, over at least 4 such pairs: a key the pairs already agree on cannot reduce anything however well populated it is.

**Some rows rest on fill rate alone.** If a rule uses FirstName and LastName and never touches Phone, and Phone is populated on 88% of profiles, Match Lab proposes `Add exact Phone` even though that rule's sampled pairs never compared it. Their **After (range)** sentence says the drop cannot be estimated yet (or gives only the Data Quality ceiling), never 0, because nothing measured how far the change would actually cut the count. Treat them as "this attribute is sitting unused and the data is there", then confirm on real pairs before anyone applies them. Attributes hidden in L3 are never proposed: a hidden attribute produces no match tokens, so the rule could not fire on it.

Where an attribute is well populated tenant-wide but thin on the rule's own pairs, the **Caution** column says so explicitly — the profiles that rule matches carry it less often than the tenant does, which is a reason to prefer `exactOrNull` over `exact`.

Each row is one concrete change — either a single key (`Add exact <Attribute>` using the attribute that ranked on this tenant) or a two-key combination — with the rule's full exact key set after the change in **Resulting exact keys**. Do not paste example attribute names from another tenant as if they apply here.

Read these columns before acting on any row:

- **Est. count after (sample-based)** and **Est. change** — `Profiles with potential matches` scaled by the share of sampled pairs that would survive. This is an **extrapolation**, not a measured count: the match engine is not re-run and no match table is rebuilt. The per-pair survival counts behind it are no longer shown as columns.
- **Keys in rule** — every attribute the rule compares today, the same text as on Rule Activity, so a row can be read without switching tabs.
- **Fill rate** and **Uniqueness** — the actual whole-tenant figures for each attribute the change adds, one line per attribute: `Email: 72% (236,441 of 328,391 profiles)` and `Email: 96% of profiles unique (230,102 distinct values)`. Uniqueness is the share of profiles whose value no other profile has (`1 − sharedProfileRate`), not the Console's distinct-value percentage. Without the Data Quality API it reads `not measured`.
- **After (range)** — one sentence with the percentage only: `If you add Email to Rule1, potential matches would drop by about 80%.` A fill-rate-only row either states the Data Quality ceiling (`would drop by at least …`) or says the drop cannot be estimated yet. It never shows a percentage that was not measured.
- **Why (fill / uniqueness)** — exactly two bullets in plain words, whole tenant only, never sampled pairs. The first says how often the added attributes are filled in and what that means (`• Email is filled in on 72% of profiles, so most profiles can be compared on it.`). The second says how unique they are (`• Email is unique on 96% of profiles, so it is good at telling different profiles apart.`). When the Data Quality API is unavailable the second bullet says uniqueness was not measured. The exact counts are in **Fill rate** and **Uniqueness**.
- There is no **Notes** column. For the sampled-pair evidence behind a row, select the rule on the **Rules** tab and read the added attribute's `cmp_` column.
- **Profiles with all keys populated** — profiles populating the rule's exact keys *plus* every added key. A low number means tightening would suppress matching through nulls rather than through better discrimination.
- **Caution** — flags a change that leaves no sampled pair matching (it would effectively stop the rule), a key that may be unique per source record, and null-bearing pairs. Since the survival columns are gone, this is the only place the count of pairs that `exact` would drop for a missing value — the ones `exactOrNull` would keep — is reported. It reads `exact would also drop N sampled pair(s) missing …; exactOrNull keeps them`.

Rules with no potential matches, an unmeasurable count, or fewer than 8 sampled pairs get a stated reason instead of a suggestion. A two-key combination is only listed when the second key drops pairs the first did not.

For a fuller answer than these deterministic rows — weighing every attribute's fill rate rather than only the gated candidates — use the **`reltio-match-rule-recommendations`** playbook. It reads this workbook and writes its proposals to `<EntityType>.suggestions.json`, which the panel then renders on this tab in place of the generated rows. It needs `<EntityType>.fill-rates.json`, so set `reltio.matchLab.fillRateScope` to `all` before the run.

**Suggested Changes tab → agent rule ideas:** use skill **`reltio-match-lab-rule-suggestions`** when the user wants ranked changes using Console-style **fill rate, uniqueness, and top-value frequency**; optional export `match-lab/dq-attribute-metrics.json` from Data Quality UI.

## Rule Overlap tab

One row per **pair of hand-built match groups** on the entity type. It answers: *how many tenant profiles carry potential matches from both rules at once?* That is different from **Also matched by** on the Rules tab, which only describes the **sampled pairs** you pulled.

Columns: **Rule A**, **Rule B**, each rule's **Profiles on rule …** (the same tenant-wide figure as Rule Activity), **Profiles on both**, **Share of rule A/B** (both divided by that rule's profile count), and a plain-language **Finding**.

With only one hand-built rule there is no pair to count, so the tab has no rows and a `Reason:` line saying so (and how many ML / FERN rules were left out). Do not read it as zero overlap.

- Counts are **tenant-wide** read-only `countEntities` calls, not sampled. A failed count reads **error**, never zero.
- FERN / ML groups are omitted — overlap is measured only between hand-built rules.
- With fewer than two such rules the tab is omitted.

Use overlap to spot **competing rules**: a high share on both columns means the same profiles are flagged by two rules and tightening or retiring one may be worth discussing. It does not tell you which token caused the volume; it only names the rules that share the population.

## Fill rates (no tab)

The panel has no Fill rates tab. Fill rates and uniqueness are still measured — Suggested Changes quotes them in **Why (fill / uniqueness)** — and on a full-scope run (`reltio.matchLab.fillRateScope` = `all`) every attribute's figures are saved to `match-lab/<EntityType>.fill-rates.json`. Each row carries the dotted search `path`, `family`, `inRules` (match groups already using it as a key) and the measured figures.

Figures come from the Data Quality API (`GET …/dataQuality/statistic`, the same numbers as the Console Data Quality screen) whenever the tenant answers it; `source` is `dataQuality`. Then:

- **Fill rate** (`rate`) is `exists / (exists + missing)`.
- `sharedProfileRate` is `(exists − unique) / exists`: the share of profiles whose value another profile also holds. Data Quality's `unique` / `notUnique` count *distinct values*, not profiles, so the Console's uniqueness % (`unique / (unique + notUnique)`) answers a different question — do not quote it as a share of profiles. Exact for single-valued attributes, approximate for multi-valued ones.
- Distinct values are `uniqueValues + sharedValues`; `topValues` are the most frequent values from `frequency`.

When Data Quality is unavailable (403/404) the run falls back to `count(exists(attribute)) / count(profiles of this type)` with `source` `count`, and the uniqueness fields are absent. That count uses `exists()`, which counts non-OV values too, so it is a ceiling. Either way a container attribute reads higher than the fields inside it, and `not measured` means the call failed — it is not zero.

A full pass costs roughly one read-only call per attribute, so the result is cached in `<EntityType>.fill-rates.json` and reused for a week (`reltio.matchLab.fillRateMaxAgeHours`). Nothing is written when a run aborts on 401.

## Changing a rule

Match Lab Review **never edits L3**, never reads or deletes stored match tokens (no `removeOvercollisionedTokens`), and never rebuilds a match table. If the user wants to actually change a match group, hand off to the `reltio-match-groups-from-concept` playbook and the normal L3 edit → validate → HITL Apply path.

## Outputs

- In-editor webview tab order: **How to use** (opens first) → **Rule Activity** → **Rule Overlap** → **By Profile** → **Rules** → **Suggested Changes**. There is no Token Phrases tab. Every tab appears for every entity type. A tab with nothing to show has no rows and a single line above the table, `Reason: …`, saying why (no match rules, only automatic rules, only one rule, no sampled pairs). Quote that reason; never read the empty table as zero. **Rules** holds every sampled pair for the entity type on one tab, with a rule selector above the table that narrows it to one rule at a time; the **Rule** column names the rule on every row, so the spreadsheet copy filters the same way. Every other rule that flagged the same pair is listed under **Also matched by**; each attribute's `a_` and `b_` values sit side by side, then every `cmp_` column in the same order, then `a_crosswalks` / `b_crosswalks` and `Both URIs`. Two profiles from the same source merging is a different conversation from two sources describing the same person, which is what the crosswalk columns are there to settle. **How to use** is the numbered reading order for the workbook, six steps, one per row. An entity type with no match groups gets an empty **Rule Activity** that says why, because every rule-driven tab would be empty.
- **`<EntityType>.xlsx`** beside the JSON, one sheet per tab, written on every run. This is the shareable copy — the webview cannot be sent to a customer. Header row frozen and filtered, columns sized to content, and counts stored as real numbers so Excel can sort and total them. Written by the extension itself with no spreadsheet library and no network call; it is a local file, not a Google Sheet.
- Sidecars under `.reltio/…/<tenant>.reltio.tenant/match-lab/` (`matching-pipeline-gate.json`, `<EntityType>.json`, on a full-scope run `<EntityType>.fill-rates.json`, and optionally `<EntityType>.suggestions.json` from the match-rule-recommendations playbook). A run writes only the selected entity type's file and leaves earlier files on disk, but the panel shows only the entity type just analyzed. Sidecars written by an older engine version are ignored — their tab and column names no longer match.
- There are no `Reltio Notes` or `Customer notes` columns on any tab.
- The workbook's `entityType`, `entityTypeUri` and `engineVersion` are top-level JSON fields, not rows on a tab. There is no run-statistics tab: **Profiles with potential matches** on Rule Activity is tenant-wide, while **Sampled pairs** and everything on the Rules tab is a sample, so say which of the two you are quoting when the user asks whether a number is the whole picture.
- Chat: rule name and status label only.
