---
name: reltio-match-groups-from-concept
description: Create or change Reltio match rules (match groups) from a plain-English requirement, such as "match Individuals on exact email and fuzzy first name". Resolves entity types and attributes from the workspace's BusinessConfig.json, builds a schema-valid match group, tests it against the connected tenant before inserting it, and reports the results.
---

# Match groups from concept

Turns a plain-English match requirement into a match group in the user's configuration that is schema-valid and tested against the tenant. Deploying it stays with the user, through the IDE's **Apply Configuration to Tenant** action.

Read **[reference.md](./reference.md)** before building a rule. It covers operators, match token and comparator classes, cleansers, scoring, worked examples and the test-record format.

**[examples.md](./examples.md)** holds over 40 more worked examples: every operator, one group per kind of data, the cleansers, relevance scoring, and complete scenarios (identifiers, addresses, partial values such as last N characters or ZIP5, character and word percentages, Jaro-Winkler, numeric ranges, geo, cross-source, negative rules). When a requirement resembles one, start from it rather than from scratch.

## When to use

The user wants to add, change or explain match behaviour for an entity type. For example: "merge Organizations on name and address", "fuzzy first name plus exact last name for HCP", "why don't these two records match".

## Where the configuration is

Work in the configuration file of the tenant the user is working on. Usually that is the open file, or the one they name.

| Workspace | File |
|---|---|
| Connected tenant | `<environment>/<tenant>/Business Config/BusinessConfig.json` |
| Tenant not yet migrated | `…/<tenant>.reltio.tenant/L3.reltio.json` |
| Opened with Connect your Repository | Any `BusinessConfig.json` in the repository |

If several tenants exist and it's unclear which one is meant, ask.

## Procedure

### 1. Understand the requirement

Pick out the entity type, the attributes to match on, exact or fuzzy for each, any filter (a source system, an identifier type, a flag), and what should happen to a match (merge, review, or decided by a score).

Ask before building when the request leaves out:

- **the entity type**, unless only one in the configuration fits;
- **exact or fuzzy** for an attribute ("match on email", "similar phone numbers": exact, or tolerant of formats?);
- **which attributes** a broad term means ("by location": address line, city, ZIP?);
- **the outcome**, when the user wants merging but it's unclear whether it should be automatic or reviewed.

Don't ask about anything in **Defaults** below. Ask with numbered options, all in one message.

Words such as "based on the match score", "weighted" or "auto-merge or potential match depending on how close" mean a **relevance-based** rule (reference.md §6).

### 2. Resolve names against the configuration

- Map the user's wording to a real entity type (`Prty` → `Party`). If one candidate is clearly right, use it.
- Map each attribute to its real URI on that entity type, including nested ones (`…/Email/attributes/Email`). Tenants name these differently, so read them from the file.
- Read the entity type's existing `matchGroups`. Don't reuse a `uri`, and point out any existing rule that already covers the requirement.
- **Never invent a URI.** If an attribute doesn't exist, say so and stop, or offer to add the attribute first.

### 3. Build the match group

Using reference.md:

- Choose operators per attribute and compose them inside an explicit `and` / `or` / `not`.
- Map a token class **and** a comparator class for **every** attribute in the rule, exact ones included, from the table in reference.md §3. Without a mapping the attribute falls back to its attribute type's defaults, or to exact matching, so fuzzy can silently become exact.
- Use the documented patterns (reference.md §2) for "missing on both", "present on both", "only across sources" and source filters, and `CustomMatchToken` / `CustomComparator` with a `pattern` for part of a value (last N characters, first 5 ZIP digits).
- Add `NameDictionaryCleanser` with the `SynonymFirstNamesNA_2020-09-01` dictionary for fuzzy first names. Add other cleansers only when the requirement calls for them, and never invent a hosted dictionary or noise-word URL: ask for it.
- Use `ignoreInToken` for filter-only attributes, and always with `notEquals`.
- For a relevance-based rule, set `weights` (default `1.0`) and `actionThresholds`, and work out the score for each test pair before testing.
- Write a `label` that states the logic, as the existing groups do.
- If the rule would over-merge (name only, fuzzy only), say so, and prefer `suspect` over `automatic`.

### 4. Check it against the schema

Check the group against **[match-group.schema.json](./match-group.schema.json)**, in this skill's folder. It is the match-group part of the Reltio IDE's schema, so a rule that passes it passes the IDE's validation. If you can run a JSON Schema validator, validate the candidate against that file. Otherwise compare by hand: every field and operator the rule uses must appear in the schema with the type it shows, and definitions with `"additionalProperties": false` accept nothing else.

Then confirm every attribute URI exists in the configuration. Fix problems before testing.

### 5. Test it against the tenant

Design **at least three** pairs of test records (format in reference.md §10):

1. **Exact**: every rule attribute identical. Expected: match.
2. **Near**: fuzzy attributes vary realistically (`Robert`/`Bob`, a typo), exact attributes equal. Expected: match.
3. **Different**: one required attribute clearly differs. Expected: no match.

Add pairs for filters, `exactOrNull` cases and negative rules where they apply.

Then ask the extension to run them:

1. Write `.reltio/reltio-agent/match-verification/request.json`:

   ```json
   {
     "requestId": "<new unique id for every request>",
     "configFile": "<workspace-relative path to the BusinessConfig.json you are editing>",
     "matchGroups": [ <the candidate match group> ],
     "pairs": [ { "label": "exact", "first": { … }, "second": { … } } ]
   }
   ```

   Up to 10 match groups and 10 pairs per request. The extension works out the environment and tenant from `configFile`; don't add them.

2. Wait for `.reltio/reltio-agent/match-verification/result.json` to show the same `requestId`. Check every few seconds for up to a minute.

3. Act on `status`:

| `status` | Meaning | What to do |
|---|---|---|
| `verified` | Each pair has an `outcome` and a verdict per rule. | Compare each outcome with what you expected (below). |
| `not-verified` | Live testing wasn't possible. `reason`: `signed-out`, `repository-mode`, `no-tenant` or `disabled`. | Tell the user why, using `message`. For `signed-out`, offer to rerun after they sign in. Then reason through each pair yourself, and label the results **not verified against a tenant**. |
| `failed` | The tenant or the request rejected it. `error.kind`: `invalid-request`, `api-error`, `untrusted-host` or `network`. | Fix what you can and retry with a new `requestId`. For `invalid-request`, correct the request. For `api-error` 400, recheck URIs, classes and crosswalk sources against `responseBody`. Retry 5xx or `network` once. If it still fails, **don't insert the rule**. Report `error.kind`, `httpStatus` and the server's `responseBody`. |
| no result after a minute | The extension isn't running or isn't answering. | Tell the user, then continue as for `not-verified`. |

**Outcomes.** `auto-merge` and `suspect` mean the pair matched, with that action. `matched` means it matched with an action the extension doesn't classify; report the `matchAction`. `no-match` means it didn't match. `no-shared-token` means the rule's logic holds, but the records share no match token, so Reltio would never compare them. Treat that as a defect: usually a missing or wrong token class, or every attribute in `ignoreInToken`.

If an outcome differs from what you expected, adjust the rule (or the test data, if the test was wrong), then test again. Don't present a rule whose tests disagree with its intent.

### 6. Insert and report

Insert the match group into the entity type's `matchGroups` array only after a `verified` result, or a clearly labelled `not-verified` one. Never after `failed`. Then check the Problems panel for the file.

Report, in this order:

1. **Match group**: the JSON.
2. **What it does**: the attributes and how each is compared, the cleansers, the type, scope and scoring, in plain language.
3. **Test results**: headed **verified against `<environment>/<tenant>`** or **not verified against a tenant**, then a table with one row per pair:

   | Pair | Record 1 | Record 2 | Expected | Actual |
   |---|---|---|---|---|
   | near | FirstName: Robert; LastName: Smith; Email.Email: rsmith@example.com; Address.City: Springfield | FirstName: Bob; LastName: Smith; Email.Email: rsmith@example.com; Address.City: Springfeild | match (suspect) | match (suspect) |

   - Put **every attribute** of each test record in its cell, with the values exactly as sent, separated by `; `. Write nested attributes as `Parent.Child: value`.
   - Give the outcome as the result names it (`auto-merge`, `suspect`, `no-match`, `no-shared-token`, or `matched` with its `matchAction`).
   - Don't add per-attribute scores unless the user asks. When they do, take them from each rule's `explanation` in `result.json` for verified results, or from your own reasoning, labelled as such, for unverified ones.
4. **Checks**: schema and URI status, and any false-positive risk.
5. **Next step**: deploy with **Apply Configuration to Tenant** on the tenant in the Reltio view when ready. This skill never deploys.

## Defaults

Apply these without asking.

| Setting | Default |
|---|---|
| `type` | `suspect`; `relevance_based` when the user talks about scores (thresholds `auto_merge` `0.8-1.0`, `potential_match` `0.5-0.8`, weights `1.0`) |
| `scope` | The value and casing the file's other groups use, otherwise `ALL` |
| `useOvOnly` | `true` (a boolean) |
| `scoreStandalone`, `scoreIncremental` | `0` |
| Token and comparator classes | The pairing for the data in reference.md §3, mapped explicitly for every attribute |
| Cleansers | `NameDictionaryCleanser` (`SynonymFirstNamesNA_2020-09-01`) on fuzzy first names, otherwise none |

## Inputs and overrides

- Shipped patterns: `.reltio/reltio-agent/velocity-packs/*/BusinessConfig.json`.
- A team override at `skills/workspace/match-groups-from-concept/SKILL.md` takes precedence over this file where they differ.
