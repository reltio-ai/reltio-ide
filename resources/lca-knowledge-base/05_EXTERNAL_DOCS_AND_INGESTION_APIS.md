# External Reference — Doc Portal & Data Ingestion APIs

> Doc ID: `KB-LCA-05` | Category: External Reference
> Official docs.reltio.com LCA facts + ingestion/pre-ingestion API guidance for LCA-adjacent recommendations.
> Source root: [Customize data tasks with LCAs](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas)
> Last crawled: 2026-07-08. Pages were "Updated" between 2025-11-07 and 2026-05-08 per portal metadata — this is actively maintained content; re-crawl periodically since it moves faster than any static internal KB.
> This doc is a structured index + fact-extraction of the official pages, so the MCP tool can cite authoritative doc-portal sources directly instead of only internal engineering notes.

## Page Map

| Page | URL | Key Content |
|---|---|---|
| Customize data tasks with LCAs (root) | [link](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas) | Landing page, 2 training videos, links to all sub-pages |
| LCA Framework | [link](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/lca-framework) | Service architecture, service flow, `IReltioAPI` interface, `ILifeCycleAction` interface, `LifecycleExecutor`, JSON input template, Azure S3-JAR note |
| LCA Hooks | [link](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/lca-hooks) | Full hook list, entity/all-object/merge/unmerge/match/reference-attribute event sequencing, the `beforeSave`+`ActionType=VALIDATE` write-safety warning |
| Capturing LCA Input | [link](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/capturing-life-cycle-actions-lca-input) | (not yet crawled in depth — capture technique for real payloads; see `02_LCA_IMPLEMENTATION_HANDBOOK.md` §4 fixture-capture workflow for the internal equivalent) |
| LCA Handler | [link](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/lca-handler) | How to implement `ILifeCycleAction`, Maven dependency + settings.xml credential setup, handler testing intro |
| LCA Handler Certification | [link](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/lca-handler/lca-handler-certification) | (not yet crawled — likely Reltio's internal review/certification process before an LCA goes to production) |
| LCA Error for Batch of Entities/Relations | (not yet crawled) | Batch error-handling semantics — verify before advising on batch LCA design |
| LCA Configuration | [link](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/lca-configuration) | `lifecycleActions` schema, config inheritance rules, LCA-as-a-source pattern, distributed logging, **100ms execution timeout** |
| Conditional Execution of LCA | [link](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/lca-configuration/conditional-execution-of-lca) | `filter` syntax, `clientType`/`globalId` header mapping, bulk-UI-task caveat |
| Disable or Deregister LCA | [link](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/disable-or-deregister-lca) | `executeLCA=false` recursion-prevention parameter; deregistration steps |
| Best Practices for LCA | [link](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/best-practices-for-lca) | Prerequisites (Java/Maven/API/config knowledge); sample project repos (currently unavailable — request via support ticket); links to `recommendations-for-lca` and `non-adherence-to-lca-best-practices` sub-pages (not yet crawled) |
| Life Cycle Actions (LCA) Service API | [link](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/life-cycle-actions-lca-service-api) | Actions Configuration API + Actions Execution API; `TenantURL` = tenant ID or `Reltio` for shared actions |
| Action Object Structure | [link](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/life-cycle-actions-lca-service-api/action-object-structure) | Full Action object schema (see below) |
| Delete Action | [link](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/life-cycle-actions-lca-service-api/delete-action) | `DELETE {lifecycleServiceURL}/api/{tenantId}/actions/{ActionName}` |
| Execute Action | (linked as "next" from Delete Action — not yet crawled) | Likely the direct action-invocation endpoint |

## LCA Service API — Confirmed Facts

**Two API groups:** Actions Configuration API (CRUD on registered actions) and Actions Execution API (direct invocation).

**Action object schema:**

| Property | Type | Description |
|---|---|---|
| `name` | String | Action name, used at execution time; unique within a tenant |
| `type` | String | Fully qualified action class name |
| `module` | String | Path to the JAR containing the action class, in S3 storage |
| `state` | String | `active` or `inactive` |
| `description` | String | Free-text description |
| `updatedBy` | String | User who last updated the action |
| `updatedTime` | UTC timestamp (ms) | Last update time |

Example:
```json
{
  "name": "NpiCleanseAction",
  "type": "com.reltio.lifecycle.actions.test.NpiCleanseAction",
  "module": "life-cycle-actions/test/test.handlers-1.1.0-QA.jar",
  "state": "active",
  "description": "Life Cycle Actions for Cleansing NPI Attribute",
  "updatedBy": "jdoe",
  "updatedTime": 1440156159538
}
```

**Delete Action:**
```
DELETE {lifecycleServiceURL}/api/{tenantId}/actions/{ActionName}
Headers: Authorization: Bearer {accessToken}, Content-Type: application/json
```
Response: `{"status": "success"}`.

**`TenantURL` convention:** use the actual tenant ID for a tenant-specific action, or the literal string `Reltio` when registering a cross-tenant shared action (referenced elsewhere as the `Reltio/<name>` prefix in `lifecycleActions` config).

## LCA Hooks — Official Event Sequencing (from "LCA Hooks" page)

**Entity create/override flow:**
1. `POST /entities` → raw entities passed to `rawDataBeforeCleanse`
2. Cleanse → `rawDataAfterCleanse`
3. Match search (auto rules or crosswalks) → if match found, `beforeOverride` (receives both raw client data and the object-to-override)
4. `afterOverrideBeforeCleanse`
5. Cleanse results → `beforeSave`
6. Save to Cassandra → `afterSave` (cannot mutate or cancel)

**Generic object change flow (entities, graphs, interactions, groups):**
1. Load object → `beforeUpdate` (before content change applied)
2. `afterUpdateBeforeCleanse`
3. Cleanse → `beforeSave`
4. Save → `afterSave`

**Delete:** `beforeDelete` → `afterDelete`. **Not triggered** for the loser object during a merge.

**Merge:** `beforeMerge` → `afterMerge`, then the merge result goes through the standard save flow (`afterUpdateBeforeCleanse` → `beforeSave` → `afterSave`).

**Unmerge:** `beforeUnmerge` → `beforeNotAMatchSet`/`afterNotAMatchSet` → `beforeSave`/`afterSave` (for both resulting objects) → `afterUnmerge` (receives both post-unmerge objects).

**Match hooks:** `potentialMatchesFound` on new candidates. `beforeNotAMatchSet`/`afterNotAMatchSet`, `beforeNotAMatchReset`/`afterNotAMatchReset`, `beforeMarkAsMatch`/`afterMarkAsMatch`, `beforeUnmarkAsMatch`/`afterUnmarkAsMatch` — **all of these can cancel the operation but cannot alter object content.**

**Reference attribute hooks:** `before/afterReferenceAttributeAdded|Changed|Removed` — fire **only** for relationship-driven reference attributes, not for referenced-entity reference attributes. They execute strictly in relationship scope; parent entity attributes are unavailable to their filters/code. Use an entity hook (`beforeSave`/validation logic) for entity-level context, or store required fields directly on the relation for relation-centric rules.

**Critical write-safety warning:** `beforeSave` fires during UI validation/preview passes with `ActionType=VALIDATE`. Writes performed in that pass (`_update`, `/ignore`, delete) commit immediately and are **not rolled back** even if a DVF fails or the user cancels. See `01_LCA_CORE_CONCEPTS_AND_HOOKS.md` §5.

## LCA Configuration — Confirmed Facts

- `lifecycleActions` is a map of hook name → action list, defined per entity/relationship type in tenant JSON.
- Actions in a list execute **sequentially**; each receives the prior action's output as input.
- **Execution timeout: 100 ms by default**, enforced for tenants provisioned after the 2023.2 release; exceeding it raises a visible alert.
- Config is inherited from parent types; a hook defined on both parent and child concatenates (parent first); a hook defined on only one is used as-is; a customer's config in a higher metadata layer (e.g. L3) always overrides a lower one (e.g. L1) for the same hook.
- Cloning a profile does not trigger LCA execution — only subsequent edits do.
- **LCA-as-a-source pattern:** give an LCA its own crosswalk/source and always specify that source explicitly when writing data back — omitting it associates the written values with *every* existing crosswalk on the entity.
- Distributed logging uses log4j `SocketAppender` with dynamic S3-based configuration (since Reltio 2016.1) — no need to edit `log4j` config files per-component directly.

## Conditional Execution of LCA — Confirmed Facts

- Recommended for performance: only run an ID-generation LCA when the object doesn't already have an ID (helps incremental loads skip re-running on existing records).
- Filter syntax example: `"filter": "equals(clientType, 'Reltio UI') and equals(attributes.Group, 'GroupA')"` — confirms `and` is supported in **LCA** filters (contrast with the more limited DVF expression language).
- `clientType` maps to the `globalId` request header value (e.g., `globalId: Reltio UI` sent by the Reltio UI itself).
- **Caveat:** bulk update tasks created through the UI do **not** send the `globalId` header, so a `clientType`-based filter cannot distinguish "UI bulk job" from "external API call."

## Disable or Deregister LCA — Confirmed Facts

- **To stop an LCA-triggered write from cascading into another LCA invocation:** append `executeLCA=false` to the `POST`/`PUT`/`DELETE` call made from inside the LCA hook.
- **To fully deregister an LCA:**
  1. `DELETE {{lca_uri}}/{{tenant}}/actions/<ActionName>`
  2. Remove the corresponding entries from the `lifecycleActions` block in the type's L3 configuration.

## Data Validation APIs (DVF, related to but distinct from LCA)

- Endpoint pattern: `{HTTP Method} {myTenant}/api/{tenantId}/dvf/validate`
- Purpose: run configured Data Validation Functions against entity/relationship data **without persisting it** — for pre-ingestion checks, migrations, and external system integration.
- Interactive spec: `developer.reltio.com/private/swagger.htm?module=Configuration#/Data%20Validation%20Function` (requires authenticated developer-portal session).
- See `03_DVF_AND_LCA_VS_DVF_DECISION_GUIDE.md` for the full DVF picture and when to recommend it over an LCA.

## Related Public API Categories (for context when an LCA need overlaps with ingestion)

From the docs.reltio.com Developer Resources nav, the categories most relevant to LCA-adjacent customer conversations:

- **Entity Management APIs** — Entities API, Simultaneous Entity Updates, Attribute APIs, Crosswalks API, Merge and Unmerge Entities API, Potential Matches API, Rating API
- **Relation Management APIs**
- **Interaction Management APIs**
- **Reference Data Management APIs**
- **Load and Export APIs** — Export Service APIs, Data Loader API (incl. AI Automapping API)
- **Data Integration APIs** — Salesforce Connector API, Activation Service APIs, Batch Attribute Verification APIs, Address Autocomplete APIs, Reltio Data Pipeline for Snowflake APIs, Delta Lake API, D&B Connector APIs, Events API
- **Workflow APIs**
- **System Administration APIs**
- **Statistics Reporting Services APIs**
- **Data Validation APIs** — Validate entities using DVF
- **Hierarchy Management APIs**

Ingestion endpoint-level detail continues in the sections below.


## DVF & Validation — Official Doc Sources (curated)

Use these when answering DVF / Data Validation API questions. Prefer live portal pages over internal paraphrases when they conflict; pair with `03_DVF_AND_LCA_VS_DVF_DECISION_GUIDE.md` (authoring/enablement) and `05_EXTERNAL_DOCS_AND_INGESTION_APIS.md` (pre-ingestion architectures). Exact request/response schemas: authenticated Swagger (`developer.reltio.com/private/swagger.htm`).

| Topic | URL / entry point | Notes |
|---|---|---|
| Data Validation APIs (overview) | https://docs.reltio.com/en/developer-resources/data-validation-apis | Pre-persist validation without saving; migrations & integrations |
| Data Validation Function (Swagger) | `developer.reltio.com/private/swagger.htm?module=Configuration#/Data%20Validation%20Function` | Login-gated OpenAPI — authoritative for live schemas |
| LCA Configuration (timeout, inheritance, LCA-as-source) | https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/lca-configuration | Also covers when DVFAction is wired under lifecycle hooks |
| Disable / Deregister LCA | https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/disable-or-deregister-lca | Recursion prevention + deregistration |

**Not yet fully crawled into this KB (do not invent):** detailed Hub/Modeler click-paths for warning visibility, expression operator matrix beyond what `04` documents, and per-tenant analytical-attribute schemas. Confirm those against the customer's platform docs / Support.

## Access Notes

- The interactive Swagger reference at `developer.reltio.com/private/swagger.htm?module=<ModuleName>` requires an authenticated Reltio Developer Portal session (login-gated — not publicly fetchable). Always verify exact request/response schemas there before finalizing customer-facing implementation guidance; this KB captures structure and endpoint patterns from the public docs.reltio.com narrative pages, not the live OpenAPI spec.
- Several sub-pages referenced above ("Capturing LCA Input", "LCA Handler Certification", "LCA Error for Batch of Entities or Relations", "recommendations-for-lca", "non-adherence-to-lca-best-practices", "Execute Action") were identified via portal navigation but not yet fully crawled into this KB — flagged as follow-up crawl targets, not fabricated content.

## 11. Purpose of This Doc

The "Data Ingestion" module in Reltio's private developer Swagger groups the REST endpoints used to get data **into** a tenant (create/update entities and relationships, bulk load, upsert via crosswalk) and the adjacent match/merge/validation endpoints that ingestion pipelines commonly call. This doc maps that API surface to the LCA business-need catalog in `01_LCA_CORE_CONCEPTS_AND_HOOKS.md`, so the agent can recommend *both* the right LCA hook *and* the right ingestion-side API call when a customer describes a need.

**Confidence levels used below:**
- **[Confirmed]** — directly stated on a public docs.reltio.com page fetched during this KB build.
- **[Standard]** — a long-standing, well-documented Reltio REST convention, included for completeness; verify exact parameter names against the authenticated Swagger spec before finalizing customer-facing docs or code.

## 12. Entity Management APIs

Base pattern **[Confirmed]**: `{HTTP Method} {myTenant}/entities`

| Sub-API | Typical Operations | LCA-Relevant Notes |
|---|---|---|
| Entities API | Create (`POST`), read (`GET`), update (`PUT`/partial update), delete (`DELETE`) entities; single or batch | This is the primary trigger surface for `rawDataBeforeCleanse`, `beforeSave`, `afterSave`, `beforeUpdate`, `beforeDelete`, `afterDelete` |
| Simultaneous Entity Updates | Concurrency-safe update pattern for the same entity from multiple sources | Relevant when an LCA and an external system might race to update the same entity — design idempotency (see `02_LCA_IMPLEMENTATION_HANDBOOK.md` §5 pitfall #15) with this in mind |
| Attribute APIs | Targeted read/write of individual attributes (rather than whole-object) | Use `select`-style targeted calls from inside an LCA to avoid loading the full entity — see best practice #8 in `04_OPS_SECURITY_CONNECTIVITY_DEPLOYMENT.md` |
| Crosswalks API | Manage per-source crosswalk records on an entity | Directly relevant to the "LCA-as-a-source" pattern — an LCA should own and write through a dedicated crosswalk |
| Merge and Unmerge Entities API | Trigger/manage entity merge and split operations | Maps to `beforeMerge`/`afterMerge`/`beforeUnmerge`/`afterUnmerge` hooks |
| Potential Matches API | Retrieve/manage candidate duplicate entities | Maps to `potentialMatchesFound` and the not-a-match/mark-as-match hook family |
| Rating API | Data-quality/completeness scoring | Maps to the "data completeness scoring" and "DQ numeric scoring" use cases in `01_LCA_CORE_CONCEPTS_AND_HOOKS.md` |

## 13. Relation Management APIs

Parallel structure to Entity Management APIs but scoped to relationships. Relevant to: relation dedup/uniqueness LCAs, reference-attribute hooks (`before/afterReferenceAttributeAdded|Changed|Removed`), and any "parent-to-child propagation" or "address ranking" use case that models the address/role as a relationship rather than a nested attribute.

## 14. Load and Export APIs

| Sub-API | Purpose | LCA-Relevant Notes |
|---|---|---|
| Data Loader API (incl. AI Automapping API) **[Confirmed sub-page exists]** | Bulk file-based ingestion into a tenant, with AI-assisted field mapping | High-volume initial loads are exactly where the "run ID-generation LCA only for new entities" conditional-execution pattern (see `05_EXTERNAL_DOCS_AND_INGESTION_APIS.md`) matters most for performance |
| Export Service APIs **[Confirmed sub-page exists]** | Extract data out of a tenant | Not typically LCA-triggering, but relevant when an `afterSave`/`afterMerge` LCA needs to push data to a downstream system that also consumes exports — helps avoid duplicate integration paths |

## 15. Data Integration APIs

| Sub-API | Purpose | LCA-Relevant Notes |
|---|---|---|
| Salesforce Connector API | Bi-directional Salesforce sync | If a customer's need is "sync Salesforce changes into Reltio and trigger downstream logic," the connector handles ingestion; an `afterSave` LCA still handles Reltio-side propagation |
| Activation Service APIs | Push golden records back out to operational systems | Complements `afterSave`/`afterMerge` LCAs that need to activate/notify |
| Batch Attribute Verification APIs | Bulk-verify address/phone/email-style attributes | Overlaps with "address ranking" and "data completeness scoring" LCA use cases — prefer this API for bulk verification over a custom LCA external-call pattern where possible, since it's purpose-built and avoids the 100ms LCA timeout risk |
| Address Autocomplete APIs | Real-time address suggestion/validation | Relevant to "restrict reference attribute on add (e.g. block PO Box as primary)" — consider calling this from `beforeSave` only if it can respond within the LCA's execution budget; otherwise validate at data-entry time via the API directly rather than inside the LCA |
| Reltio Data Pipeline for Snowflake APIs / Delta Lake API | Bulk analytical export/sync | Downstream of LCA-driven data, not typically an LCA trigger point itself |
| D&B Connector APIs | Dun & Bradstreet enrichment | If a customer wants D&B enrichment on entity create, evaluate whether the connector's native scheduling can do it instead of a synchronous `beforeSave`/`afterSave` LCA call (external enrichment calls inside `before*` hooks are a documented pitfall — see `02_LCA_IMPLEMENTATION_HANDBOOK.md` #6) |
| Events API | Subscribe to/publish platform events | An alternative to `afterSave`/`afterMerge` LCA-driven notification for customers who prefer an event-subscription model over embedding notification logic in an LCA — worth raising as an architectural alternative when a customer's need is purely "notify another system," since it decouples from the LCA's synchronous constraints |

## 16. Data Validation APIs (DVF)

Endpoint **[Confirmed]**: `{HTTP Method} {myTenant}/api/{tenantId}/dvf/validate` — validate entity/relationship data against configured DVFs **without persisting**. See `03_DVF_AND_LCA_VS_DVF_DECISION_GUIDE.md` for when to recommend this instead of an LCA `validate`/`beforeSave` check.

## 17. Recommendation Framework — API + LCA Pairing

When a customer describes an ingestion-related need, use this sequence:

1. **Identify the data flow direction.** Inbound (data entering Reltio) → likely Entity/Relation Management APIs or Data Loader API. Outbound (Reltio pushing to another system) → Activation Service, Events API, or a connector.
2. **Identify whether the need is pre-persistence validation, post-persistence mutation, or a pure sync/notification.**
   - Pre-persistence, no mutation → Data Validation API + DVF (cheapest, no LCA needed).
   - Pre-persistence, needs mutation or an external call → LCA `beforeSave`/`rawDataBeforeCleanse` (respect the 100ms budget).
   - Post-persistence sync/notification → LCA `afterSave`, or consider the Events API / Activation Service as a decoupled alternative.
3. **Check for a purpose-built API before recommending custom LCA code.** Batch Attribute Verification, Address Autocomplete, and the various connectors exist specifically so customers don't have to hand-roll external-call logic inside an LCA's tight execution window.
4. **For bulk/initial loads**, always pair the recommendation with the conditional-execution guidance (`filter`/ID-existence check) from `05_EXTERNAL_DOCS_AND_INGESTION_APIS.md` so LCAs don't re-run unnecessarily on every record in a large batch.
5. **Always caveat with:** "exact request/response schemas should be confirmed against the authenticated Reltio Developer Portal Swagger spec (`developer.reltio.com/private/swagger.htm?module=Data%20Ingestion`) for the customer's specific platform version before implementation."

## 18. Pre-Ingestion Validation Architectures

Data Validation APIs execute active tenant DVFs against a payload without persisting it. They are appropriate when an upstream flow needs quality feedback before a create/update or load operation. DVFs define the rules; the API executes them; the caller owns the decision to persist, reject, route, or remediate.

### 7.1 Synchronous gateway validation

Use this pattern when an application or source API needs an immediate answer before sending data to an entity/relation save endpoint.

```text
Source system → API gateway/middleware → Data Validation API
                                          ├─ ERROR: return structured failures
                                          └─ pass / accepted warnings: call save API
```

The middleware should preserve the source correlation ID, call validation using the tenant's active configuration, return attribute context and the original DVF messages, and apply its documented `ERROR`/`WARNING` policy. Avoid treating a successful transport response as automatic approval: inspect the validation result.

### 7.2 Batch onboarding validation

Use a pre-validation stage for large extracts, migrations, and Data Loader-adjacent pipelines when the team needs an exception population before persistence.

```text
Source extract → transform/map → validation workers → valid ingest queue
                                              └────→ exception queue/report
```

Partition work safely, retain original source keys and payload snapshots, and produce an actionable exception output rather than merely failing an entire batch. Validate in a non-production tenant first when mapping or DVF changes are being introduced. A retry after model/DVF correction must re-run validation; do not assume an old failure is still valid.

### 7.3 Stewardship preview validation

Use a UI or supporting service to validate an edited payload before final submit:

```text
User edits payload → preview validation → show errors/warnings → user corrects or acknowledges → submit
```

Errors should guide correction before submit. Warnings need visible, understandable presentation and an explicit policy for whether the user may proceed. This pattern complements—not replaces—proper tenant save-time configuration.

### 7.4 Shared design requirements

- Keep DVF rules centrally governed in the tenant so gateway, batch, and UI flows evaluate the same rules.
- Preserve the calling system, correlation ID, source key, timestamp, model/DVF release where available, and validation outcome.
- Confirm the exact endpoint method, request schema, relationship support, and response schema in authenticated Swagger for the target platform version.

## 19. Pre-Ingestion Rule Catalog

| Rule | Purpose | Typical result |
|---|---|---|
| Identifier-format gate | Reject malformed NPI, email, phone, or source identifiers before a save/load request. | `ERROR` with precise attribute message |
| Country/state consistency | Require a valid US state pattern when country is US, while allowing other countries. | `ERROR` |
| Status allowlist | Prevent unrecognized source statuses from reaching ingestion. | `ERROR` |
| Source-specific onboarding gate | Ensure mapping supplies mandatory source-feed fields before queued ingestion. | Usually `ERROR`; scope/model design must match the source requirement |
| Postal/address quality preview | Highlight suspect postal format for correction without necessarily halting onboarding. | `WARNING` |
| Nested contact validation | Validate values such as `Phone/Number` in a nested structure. | `ERROR` or `WARNING` per business policy |

Rule content belongs in DVF configuration; use `KB-LCA-03` for documented expression syntax and examples. Do not replicate business rules in middleware merely because it is convenient—the middleware should invoke the tenant rule set and handle its outcome.

## 20. Exception Queue, Retry, and Audit Patterns

### 9.1 Exception queue

Route non-persisted validation failures to an exception queue or remediation report. Store at least:

- correlation ID and source record key;
- calling system/feed and ingestion batch ID;
- original payload snapshot and transformed payload, where different;
- validation messages, severity, and affected attribute context;
- timestamp, tenant/environment, and model/DVF version or release where available;
- remediation owner, status, disposition, and subsequent retry reference.

Protect payloads and logs according to data classification requirements; validation messages and snapshots can contain sensitive record data.

### 9.2 Retry

Retry only after a meaningful change: source correction, mapping correction, approved exception decision, transient transport failure, or a relevant DVF/model release. Use idempotent queue handling and a stable source/correlation key so a replay cannot produce duplicate ingestion. A validation failure is a business outcome, not an automatic retry signal; uncontrolled retries amplify load without changing the result.

Separate transient API failures from business validation failures. Apply bounded retry/backoff for the former and route the latter for remediation. After a DVF change, revalidate failed payloads rather than assuming they still fail (or now pass) for the same reason.

### 9.3 Audit

For every validation attempt, log the request time, caller, source key/correlation ID, rule/model release when available, pass/fail/warning outcome, persistence decision, and link to the eventual ingestion operation. Retain enough data to answer: “what rule evaluated this payload, what did the caller decide, and did that exact record later enter the tenant?”

## 21. Pre-Ingestion Anti-Patterns

1. Persisting first and validating later when the business process requires a fail-fast gate.
2. Reimplementing central DVF rules independently in every source or middleware layer, causing rule drift.
3. Using a Java LCA for every validation requirement even where no mutation, external call, or lifecycle behavior is needed.
4. Treating `WARNING` as identical to a blocking `ERROR` without documenting and testing that integration policy.
5. Auto-retrying deterministic validation failures without a source, mapping, or rule change.
6. Dropping attribute context or original DVF messages from exception outputs, leaving data stewards unable to remediate.
7. Assuming pre-ingestion validation removes the need to confirm save-time behavior, publication, and tenant enablement.

## 22. When to Prefer Validation API + DVF vs. LCA

Choose **Data Validation API + DVF** when the requirement is a centrally managed, no-persistence validation of attributes/nested values that produces an error or warning, and source systems or stewards need the answer before attempting ingestion. It is especially suitable for immediate gateway feedback, batch routing, migration profiling, and preview workflows.

Choose an **LCA** when processing must mutate/default/enrich data, call external systems, apply complex runtime logic outside documented DVF expression scope, or govern lifecycle events such as merge, unmerge, delete, match, reference-attribute, or DCR behavior. A `beforeSave` LCA is appropriate only when the rule genuinely needs pre-persistence custom processing; respect its execution-budget and resiliency constraints.

Use both only where each has a distinct purpose: for example, DVF/API provides early source feedback while an LCA performs necessary mutation. Do not use an LCA merely to duplicate a DVF rule, and do not force enrichment or external verification into DVF.

For the internal LCA-vs-DVF routing and full capability comparison, migration guidance, enablement, and documented expression rules, see `03_DVF_AND_LCA_VS_DVF_DECISION_GUIDE.md`. Exact validation request/response schemas remain subject to the authenticated Developer Portal Swagger specification caveat stated above.
