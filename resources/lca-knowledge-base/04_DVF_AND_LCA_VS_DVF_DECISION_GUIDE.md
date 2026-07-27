# DVF Overview & LCA vs. DVF Decision Guide

> Doc ID: `KB-LCA-04` | Category: Architecture Decisions
> Cross-reference: `07_RELTIO_DATA_INGESTION_API_REFERENCE.md` §Data Validation APIs for the live REST endpoint.

## 1. What is DVF

**DVF (Data Validation Function)** is a **declarative, no-code, config-driven** validation rule attached to an attribute, entity type, or relationship type. Unlike an LCA, a DVF **cannot mutate data and cannot call external services** — it only evaluates and reports.

**Definition schema:** `name`, `expression`, `action` (`ERROR` | `WARNING`), `message`.

**Expression language:** functions like `equals(attr,'value')`, `regexp(attr,'pattern')`, `not(expr)`, combined via `or`/negation (no explicit `and` operator documented). Can target simple attributes, nested children (e.g. `Phone/Number`), and both entity and relationship types.

**Enablement steps:**
1. Enable DVF on the relevant entity types.
2. Enable on relationship types if needed.
3. Define the DVF rules in the data model.
4. Wire the internal action `Reltio/DVFAction` under `lifecycleActions.validate` or `.beforeSave` on the type.
5. Configure analytical attributes to surface validation results.
6. Enable UI visibility so stewards see warnings, not just errors.
7. Revalidate existing data — config changes do not automatically re-run against already-loaded records.

## 2. Live API

Reltio also exposes DVF execution as a standalone REST API — **Data Validation APIs** — so validation can run *before* data ever reaches a tenant:

```
{HTTP Method} {myTenant}/api/{tenantId}/dvf/validate
```
Purpose: evaluate entity/relationship data against configured DVFs **without persisting** it. Useful for migrations, system integrations, large-scale profiling, and enforcing quality rules at the point of entry in an external/upstream system. See the [Data Validation APIs doc-portal page](https://docs.reltio.com/en/developer-resources/data-validation-apis) and the interactive spec at `developer.reltio.com/private/swagger.htm?module=Configuration#/Data%20Validation%20Function` (requires an authenticated developer-portal session).

## 3. LCA vs. DVF — Decision Guide

> **Presentation rule (how the agent uses this guide):** the LCA-vs-DVF choice below is an **internal routing decision**. Once you resolve it, answer the user in that **single context only** — a resolved LCA need gets a complete LCA answer; a resolved DVF need gets a complete DVF answer. Do **not** narrate "use LCA, not DVF" (or vice-versa) in the response unless the user explicitly asks for the comparison, or the case is genuinely borderline (then lead with one clear recommendation). Keep the reasoning below internal.

**Core rule:** if the need is validation-only (no mutation, no external call, no merge/unmerge/delete/match governance), **use DVF first**. Anything requiring mutation, external calls, post-save side effects, or lifecycle governance (merge, unmerge, delete, match, DCR) **requires an LCA**.

| Need | Recommendation |
|---|---|
| Modify data before persistence | LCA (`beforeSave`) |
| User-visible validation error/warning only | DVF |
| Pre-ingestion validation, no persistence | Data Validation API + DVF |
| External lookup/service call | LCA |
| Merge/unmerge governance | LCA (`beforeMerge`/`afterUnmerge`) |
| Post-save notification/sync | LCA (`afterSave`) |
| Simple regex/required-field rule | DVF |
| Delete guard | LCA (`beforeDelete`) |

**Anti-patterns to flag when advising a customer:**
- Writing a full Java LCA for a simple regex/required-field check — DVF is faster to build, faster to run, and doesn't consume the 100 ms LCA execution budget.
- Trying to use DVF for enrichment — DVF cannot mutate data by design.
- Using `afterSave` to write back to the same entity — recursion risk (see `02_LCA_CODE_PATTERNS_AND_COOKBOOK.md` pitfall #3).
- Using DVF for merge/delete governance — unsupported; DVF has no concept of lifecycle-event governance, only attribute-level rule evaluation.

## 4. Recommendation Checklist for Customer Conversations

1. Ask: "Does this rule need to change the data, or just flag/reject it?" → mutation = LCA, flag/reject = DVF.
2. Ask: "Does this rule need to call anything outside Reltio (an external API, a lookup service)?" → yes = LCA.
3. Ask: "Is this about entities/relationships being created/updated, or about merge, unmerge, delete, or match decisions?" → the latter set is LCA-only territory.
4. Ask: "Does this need to run before the data is even loaded into the tenant (at the point of entry in an upstream system)?" → Data Validation API + DVF.
5. If DVF is chosen, remember to revalidate existing data after any DVF config change — it does not retroactively apply.
