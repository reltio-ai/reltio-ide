# Reltio Doc Portal Reference — LCA Section (docs.reltio.com)

> Doc ID: `KB-LCA-06` | Category: External Reference | New content (no prior KB equivalent)
> Source root: [Customize data tasks with LCAs](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas)
> Last crawled: 2026-07-08. Pages were "Updated" between 2025-11-07 and 2026-05-08 per portal metadata — this is actively maintained content; re-crawl periodically since it moves faster than any static internal KB.
> This doc is a structured index + fact-extraction of the official pages, so the MCP tool can cite authoritative doc-portal sources directly instead of only internal engineering notes.

## Page Map

| Page | URL | Key Content |
|---|---|---|
| Customize data tasks with LCAs (root) | [link](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas) | Landing page, 2 training videos, links to all sub-pages |
| LCA Framework | [link](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/lca-framework) | Service architecture, service flow, `IReltioAPI` interface, `ILifeCycleAction` interface, `LifecycleExecutor`, JSON input template, Azure S3-JAR note |
| LCA Hooks | [link](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/lca-hooks) | Full hook list, entity/all-object/merge/unmerge/match/reference-attribute event sequencing, the `beforeSave`+`ActionType=VALIDATE` write-safety warning |
| Capturing LCA Input | [link](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/capturing-life-cycle-actions-lca-input) | (not yet crawled in depth — capture technique for real payloads; see `02_LCA_CODE_PATTERNS_AND_COOKBOOK.md` §4 fixture-capture workflow for the internal equivalent) |
| LCA Handler | [link](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/lca-handler) | How to implement `ILifeCycleAction`, Maven dependency + settings.xml credential setup, handler testing intro |
| LCA Handler Certification | [link](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/lca-handler/lca-handler-certification) | (not yet crawled — likely Reltio's internal review/certification process before an LCA goes to production) |
| LCA Error for Batch of Entities/Relations | (not yet crawled) | Batch error-handling semantics — verify before advising on batch LCA design |
| LCA Configuration | [link](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/lca-configuration) | `lifecycleActions` schema, config inheritance rules, LCA-as-a-source pattern, distributed logging, **100ms execution timeout** |
| Conditional Execution of LCA | [link](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/lca-configuration/conditional-execution-of-lca) | `filter` syntax, `clientType`/`globalId` header mapping, bulk-UI-task caveat |
| Disable or Deregister LCA | [link](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/disable-or-deregister-lca) | `executeLCA=false` recursion-prevention parameter; deregistration steps; when to migrate an LCA to a Cleanse Function instead |
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
- **To fully deregister an LCA and replace it with a Cleanse Function:**
  1. `DELETE {{lca_uri}}/{{tenant}}/actions/<ActionName>`
  2. Remove the corresponding entries from the `lifecycleActions` block in the type's L3 configuration.
  3. Migrate the logic to a Reltio-provided Cleanser where possible (see [Data Cleansing and Standardization](https://docs.reltio.com/objectives/administer-system/system-administration-at-a-glance/system-administration-operation/quick-start-guide/data-cleansing-and-standardization)).
- Reltio's own guidance: **prefer a Cleanse Function over an LCA** when the same outcome is achievable with less engineering effort — Cleanse Functions are a lighter-weight, purpose-built mechanism for data cleansing/standardization and don't carry the LCA execution-timeout risk profile.

## Data Validation APIs (DVF, related to but distinct from LCA)

- Endpoint pattern: `{HTTP Method} {myTenant}/api/{tenantId}/dvf/validate`
- Purpose: run configured Data Validation Functions against entity/relationship data **without persisting it** — for pre-ingestion checks, migrations, and external system integration.
- Interactive spec: `developer.reltio.com/private/swagger.htm?module=Configuration#/Data%20Validation%20Function` (requires authenticated developer-portal session).
- See `04_DVF_AND_LCA_VS_DVF_DECISION_GUIDE.md` for the full DVF picture and when to recommend it over an LCA.

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

Full endpoint-level detail for the ingestion-relevant categories is in `07_RELTIO_DATA_INGESTION_API_REFERENCE.md`.

## Access Notes

- The interactive Swagger reference at `developer.reltio.com/private/swagger.htm?module=<ModuleName>` requires an authenticated Reltio Developer Portal session (login-gated — not publicly fetchable). Always verify exact request/response schemas there before finalizing customer-facing implementation guidance; this KB captures structure and endpoint patterns from the public docs.reltio.com narrative pages, not the live OpenAPI spec.
- Several sub-pages referenced above ("Capturing LCA Input", "LCA Handler Certification", "LCA Error for Batch of Entities or Relations", "recommendations-for-lca", "non-adherence-to-lca-best-practices", "Execute Action") were identified via portal navigation but not yet fully crawled into this KB — flagged as follow-up crawl targets, not fabricated content.
