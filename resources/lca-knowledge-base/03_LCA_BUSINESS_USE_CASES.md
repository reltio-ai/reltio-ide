# LCA Business Use Case Catalog

> Doc ID: `KB-LCA-03` | Category: Business Use Cases
> Use this doc to map a customer's stated business need to a hook + complexity estimate. Pair with `07_RELTIO_DATA_INGESTION_API_REFERENCE.md` when the need also touches ingestion APIs, and `04_DVF_AND_LCA_VS_DVF_DECISION_GUIDE.md` if the need is validation-only.

## Use Case → Hook Map

| Business Need | LCA Hook(s) | Complexity |
|---|---|---|
| Derive a display name, cleanse/normalize strings | `beforeSave` | Simple |
| Sequential/human-readable ID generation (MDM ID, LSID, counter entity) | `beforeSave` | Medium |
| UUID/master ID generation on crosswalk create | `beforeSave` | Simple |
| Party ID regeneration on CREATE/MERGE/SPLIT | `beforeSave` | Medium |
| ID generation derived from entity URI | `beforeSave` | Simple |
| Block manual ID edits / prevent duplicate business IDs (e.g. NPI) | `beforeSave` + `validate` | Medium |
| Reject invalid attribute values (regex/format checks) | `validate` | Simple |
| Cross-attribute validation (date ranges, country/state consistency) | `validate` | Medium |
| Mandatory relation/membership/roster validation | `validate` + `beforeSave` | Medium–Complex |
| External registry/sanctions-list lookup validation | `validate` | Complex |
| Pre-cleanse lookup-table validation | `rawDataBeforeCleanse` | Medium |
| Data completeness scoring | `beforeSave` | Simple |
| DQ numeric scoring with write-back (re-entrancy guarded) | `afterSave` | Complex |
| Block deletion of protected-status records | `beforeDelete` | Simple |
| Country-match check before merge / merge eligibility governance | `beforeMerge` | Medium |
| Re-ID a spawned entity after unmerge/split | `afterUnmerge` | Simple |
| Default nested/relation attribute values | `beforeSave` | Simple |
| Address ranking/re-prioritization, source-priority OV governance | `afterSave` / `afterReferenceAttributeChanged` | Medium–Complex |
| Restrict a reference attribute on add (e.g. block PO Box as primary address) | `beforeReferenceAttributeAdded` | Simple |
| Parent-to-child attribute propagation | `afterSave` | Medium |
| Relation dedup / sort-order uniqueness / compound-relation guards | `afterSave` / `beforeSave` (relation type) | Medium |
| Workflow/role assignment after save; DCR approval kickoff | `afterSave` / `afterDCRSave` | Medium |
| Auto-create relations via name matching against a candidate set | `afterSave` | Complex |
| Diagnostic payload logging (non-production) | any hook via `DefaultLcaWithLogger` | Simple |

## Notes on Sourcing

Each row above distills a recurring pattern from a much larger set of historical customer-specific LCA implementations. The `life-cycle-framework` repo itself provides the building blocks — the framework interfaces and base classes under `src/main/java/com/reltio/lifecycle/framework/` (`ILifeCycleAction`, `LifeCycleActionBase`, the `ILifeCycle*Data` types, and `validation/ValidationError`). When a customer's need matches a row, start from the matching hook + code pattern in `02_LCA_CODE_PATTERNS_AND_COOKBOOK.md` rather than writing bespoke plumbing from scratch, and cover it to the ≥92% JaCoCo gate.

## How to Use This Table When Advising a Customer

1. Restate the business need in terms of the object lifecycle moment it affects (on create? on every update? only on merge? only on delete?) — that maps directly to a hook.
2. Check `04_DVF_AND_LCA_VS_DVF_DECISION_GUIDE.md` first if the need is "reject/flag bad data with no mutation and no external call" — DVF is very likely the cheaper, no-code answer.
3. If the need requires mutating data, calling an external system, or reacting to merge/unmerge/delete, it's an LCA. Use the complexity column to set customer expectations on build effort (Simple: hours-days; Medium: days; Complex: 1-2+ weeks including test fixtures).
4. Cross-check whether the same need also implies an ingestion-side change (e.g., pre-validating a source file before it ever reaches Reltio) — see `07_RELTIO_DATA_INGESTION_API_REFERENCE.md`.
5. Before writing code, confirm the **target entity type** (e.g. `HCP`, `HCO`) and the **exact L3 attributes** (attribute names/paths from the tenant's L3 data model) the LCA must read or write. Build the handler against those real attribute names — do not invent them. If they aren't provided, ask for them before generating code.
6. Keep the LCA-vs-DVF reasoning internal — once resolved, answer the customer in that single context (see the presentation rule in `04_DVF_AND_LCA_VS_DVF_DECISION_GUIDE.md`). Do not surface internal KB doc IDs, file names, or line numbers in the customer-facing answer unless they explicitly ask for sources.
