# Reltio Data Ingestion API Reference (for LCA Business-Need Recommendations)

> Doc ID: `KB-LCA-07` | Category: External Reference | New content (no prior KB equivalent)
> Primary reference: [Reltio Developer Portal — Data Ingestion module](https://developer.reltio.com/private/swagger.htm?module=Data%20Ingestion) (interactive Swagger UI, **requires an authenticated developer-portal login** — not publicly fetchable; this doc captures structure and endpoint conventions from the public docs.reltio.com narrative pages plus well-established Reltio API conventions, and should be spot-checked against the live spec before being quoted verbatim in a customer deliverable)
> Companion doc-portal categories: [Entity Management APIs](https://docs.reltio.com/en/developer-resources/entity-management-apis), [Relation Management APIs](https://docs.reltio.com/en/developer-resources/relation-management-apis), [Load and Export APIs](https://docs.reltio.com/en/developer-resources/load-and-export-apis), [Data Integration APIs](https://docs.reltio.com/en/developer-resources/data-integration-apis), [Data Validation APIs](https://docs.reltio.com/en/developer-resources/data-validation-apis)

## Purpose of This Doc

The "Data Ingestion" module in Reltio's private developer Swagger groups the REST endpoints used to get data **into** a tenant (create/update entities and relationships, bulk load, upsert via crosswalk) and the adjacent match/merge/validation endpoints that ingestion pipelines commonly call. This doc maps that API surface to the LCA business-need catalog in `03_LCA_BUSINESS_USE_CASES.md`, so the agent can recommend *both* the right LCA hook *and* the right ingestion-side API call when a customer describes a need.

**Confidence levels used below:**
- **[Confirmed]** — directly stated on a public docs.reltio.com page fetched during this KB build.
- **[Standard]** — a long-standing, well-documented Reltio REST convention, included for completeness; verify exact parameter names against the authenticated Swagger spec before finalizing customer-facing docs or code.

## 1. Entity Management APIs

Base pattern **[Confirmed]**: `{HTTP Method} {myTenant}/entities`

| Sub-API | Typical Operations | LCA-Relevant Notes |
|---|---|---|
| Entities API | Create (`POST`), read (`GET`), update (`PUT`/partial update), delete (`DELETE`) entities; single or batch | This is the primary trigger surface for `rawDataBeforeCleanse`, `beforeSave`, `afterSave`, `beforeUpdate`, `beforeDelete`, `afterDelete` |
| Simultaneous Entity Updates | Concurrency-safe update pattern for the same entity from multiple sources | Relevant when an LCA and an external system might race to update the same entity — design idempotency (see `02_LCA_CODE_PATTERNS_AND_COOKBOOK.md` §5 pitfall #15) with this in mind |
| Attribute APIs | Targeted read/write of individual attributes (rather than whole-object) | Use `select`-style targeted calls from inside an LCA to avoid loading the full entity — see best practice #8 in `05_BEST_PRACTICES_TROUBLESHOOTING_SECURITY_DEPLOYMENT.md` |
| Crosswalks API | Manage per-source crosswalk records on an entity | Directly relevant to the "LCA-as-a-source" pattern — an LCA should own and write through a dedicated crosswalk |
| Merge and Unmerge Entities API | Trigger/manage entity merge and split operations | Maps to `beforeMerge`/`afterMerge`/`beforeUnmerge`/`afterUnmerge` hooks |
| Potential Matches API | Retrieve/manage candidate duplicate entities | Maps to `potentialMatchesFound` and the not-a-match/mark-as-match hook family |
| Rating API | Data-quality/completeness scoring | Maps to the "data completeness scoring" and "DQ numeric scoring" use cases in `03_LCA_BUSINESS_USE_CASES.md` |

## 2. Relation Management APIs

Parallel structure to Entity Management APIs but scoped to relationships. Relevant to: relation dedup/uniqueness LCAs, reference-attribute hooks (`before/afterReferenceAttributeAdded|Changed|Removed`), and any "parent-to-child propagation" or "address ranking" use case that models the address/role as a relationship rather than a nested attribute.

## 3. Load and Export APIs

| Sub-API | Purpose | LCA-Relevant Notes |
|---|---|---|
| Data Loader API (incl. AI Automapping API) **[Confirmed sub-page exists]** | Bulk file-based ingestion into a tenant, with AI-assisted field mapping | High-volume initial loads are exactly where the "run ID-generation LCA only for new entities" conditional-execution pattern (see `06_RELTIO_DOC_PORTAL_REFERENCE.md`) matters most for performance |
| Export Service APIs **[Confirmed sub-page exists]** | Extract data out of a tenant | Not typically LCA-triggering, but relevant when an `afterSave`/`afterMerge` LCA needs to push data to a downstream system that also consumes exports — helps avoid duplicate integration paths |

## 4. Data Integration APIs

| Sub-API | Purpose | LCA-Relevant Notes |
|---|---|---|
| Salesforce Connector API | Bi-directional Salesforce sync | If a customer's need is "sync Salesforce changes into Reltio and trigger downstream logic," the connector handles ingestion; an `afterSave` LCA still handles Reltio-side propagation |
| Activation Service APIs | Push golden records back out to operational systems | Complements `afterSave`/`afterMerge` LCAs that need to activate/notify |
| Batch Attribute Verification APIs | Bulk-verify address/phone/email-style attributes | Overlaps with "address ranking" and "data completeness scoring" LCA use cases — prefer this API for bulk verification over a custom LCA external-call pattern where possible, since it's purpose-built and avoids the 100ms LCA timeout risk |
| Address Autocomplete APIs | Real-time address suggestion/validation | Relevant to "restrict reference attribute on add (e.g. block PO Box as primary)" — consider calling this from `beforeSave` only if it can respond within the LCA's execution budget; otherwise validate at data-entry time via the API directly rather than inside the LCA |
| Reltio Data Pipeline for Snowflake APIs / Delta Lake API | Bulk analytical export/sync | Downstream of LCA-driven data, not typically an LCA trigger point itself |
| D&B Connector APIs | Dun & Bradstreet enrichment | If a customer wants D&B enrichment on entity create, evaluate whether the connector's native scheduling can do it instead of a synchronous `beforeSave`/`afterSave` LCA call (external enrichment calls inside `before*` hooks are a documented pitfall — see `02_LCA_CODE_PATTERNS_AND_COOKBOOK.md` #6) |
| Events API | Subscribe to/publish platform events | An alternative to `afterSave`/`afterMerge` LCA-driven notification for customers who prefer an event-subscription model over embedding notification logic in an LCA — worth raising as an architectural alternative when a customer's need is purely "notify another system," since it decouples from the LCA's synchronous constraints |

## 5. Data Validation APIs (DVF)

Endpoint **[Confirmed]**: `{HTTP Method} {myTenant}/api/{tenantId}/dvf/validate` — validate entity/relationship data against configured DVFs **without persisting**. See `04_DVF_AND_LCA_VS_DVF_DECISION_GUIDE.md` for when to recommend this instead of an LCA `validate`/`beforeSave` check.

## 6. Recommendation Framework — API + LCA Pairing

When a customer describes an ingestion-related need, use this sequence:

1. **Identify the data flow direction.** Inbound (data entering Reltio) → likely Entity/Relation Management APIs or Data Loader API. Outbound (Reltio pushing to another system) → Activation Service, Events API, or a connector.
2. **Identify whether the need is pre-persistence validation, post-persistence mutation, or a pure sync/notification.**
   - Pre-persistence, no mutation → Data Validation API + DVF (cheapest, no LCA needed).
   - Pre-persistence, needs mutation or an external call → LCA `beforeSave`/`rawDataBeforeCleanse` (respect the 100ms budget).
   - Post-persistence sync/notification → LCA `afterSave`, or consider the Events API / Activation Service as a decoupled alternative.
3. **Check for a purpose-built API before recommending custom LCA code.** Batch Attribute Verification, Address Autocomplete, and the various connectors exist specifically so customers don't have to hand-roll external-call logic inside an LCA's tight execution window.
4. **For bulk/initial loads**, always pair the recommendation with the conditional-execution guidance (`filter`/ID-existence check) from `06_RELTIO_DOC_PORTAL_REFERENCE.md` so LCAs don't re-run unnecessarily on every record in a large batch.
5. **Always caveat with:** "exact request/response schemas should be confirmed against the authenticated Reltio Developer Portal Swagger spec (`developer.reltio.com/private/swagger.htm?module=Data%20Ingestion`) for the customer's specific platform version before implementation."
