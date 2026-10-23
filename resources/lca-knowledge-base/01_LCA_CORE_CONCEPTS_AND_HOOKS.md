# LCA Core Concepts, Architecture & Hook Catalog

> Doc ID: `KB-LCA-01` | Category: Core Concepts
> Authoritative for hooks, architecture, tenant config, known ambiguities, and business-need→hook routing. Implementation code: `02_LCA_IMPLEMENTATION_HANDBOOK.md`. DVF decisions: `03_DVF_AND_LCA_VS_DVF_DECISION_GUIDE.md`.
> Authoritative doc-portal source: [Customize data tasks with LCAs](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas) (see `05_EXTERNAL_DOCS_AND_INGESTION_APIS.md` for the full crawl)
> Framework source of truth: this repo's `src/main/java/com/reltio/lifecycle/framework/ILifeCycleAction.java` (interface) and sibling `ILifeCycle*Data` / `LifeCycleActionBase` classes.

## 1. What is an LCA

A **Life Cycle Action (LCA)** is custom logic — typically a Java implementation of `ILifeCycleAction` — that Reltio invokes synchronously at specific points ("hooks") in the processing pipeline for an **entity**, **relationship**, or **Data Change Request (DCR)**. LCAs let a customer embed business rules (validation, enrichment, ID generation, merge governance, cross-entity propagation, downstream notification) into the platform without Reltio engineering changes.

- Runs on the **request's critical path** for `before*` hooks (synchronous); `after*` hooks are fire-and-forget notifications.
- Deployed as: a JAR loaded natively by the LCA Service, an AWS Lambda function, a Google Cloud Function, or (per current public docs) an S3-hosted JAR for Azure tenants — see §7 for the Azure caveat.
- The platform serializes the triggering object to JSON, calls the LCA, and — for mutation-capable hooks — substitutes the object with whatever the LCA returns.

## 2. Architecture

**Core interface:** `com.reltio.lifecycle.framework.ILifeCycleAction` — one method per hook (32 hooks total). Mutating hooks return a typed `ILifeCycleData` subtype; notification-only hooks return `void`.

**Base classes** (extend one, override only the hooks you need — all hooks no-op by default):

| Base Class | Target |
|---|---|
| `LifeCycleActionBase` | Native LCA Service / all-cloud parent |
| `LifeCycleActionHandler` (`com.reltio.lifecycle.lambda`) | AWS Lambda |
| `LifeCycleGoogleFunction` | Google Cloud Functions |
| `LifeCycleAzureFunction` | Azure Functions (framework-repo capability; needs one class per hook with `@FunctionName`/`@HttpTrigger` — confirm current support, see §7) |
| `DefaultLcaWithLogger` | Dev/diagnostic only — logs full payload, never mutates, never throws |

**Execution model:**
- A hook fires only if at least one action is configured for it on that object type — otherwise it is silently skipped.
- Actions within one hook's list run **sequentially**; each action receives the output of the previous one as input (per official LCA Configuration docs).
- `before*` hooks are pre-persistence and mutation-capable. `after*` hooks are post-persistence, `void`, side-effect-only, and their return value is ignored.
- **LCA execution timeout is 100 ms by default** for tenants provisioned after the 2023.2 release (official doc-portal value — supersedes any "~200ms" figure from older internal notes). Exceeding it surfaces an alert/error in Reltio.
- Throwing a `RuntimeException` from a `before*` hook aborts the triggering operation (the platform's built-in "block this operation" mechanism).

**Injected context:** every hook receives an `IReltioAPI` instance carrying the caller's auth automatically:
- `String get/post/put/delete(String uri, [String body,] Map<String,String> headers)`, plus URI-encoded variants
- `getObject(uri)`, `logInfo/logWarning/logError(String message)`
- No need to specify the full API URL or tenant name — URIs are relative.

**Key data interfaces** (all extend `ILifeCycleData`: `getTenant()`, `getEnvironment()`, `getProperty()`, `toMap()`):

| Interface | Carries | Used by |
|---|---|---|
| `ILifeCycleObjectData` | `getObject(): IObject`, `getActionType()` (CREATE / UPDATE / MERGE / SPLIT / VALIDATE / RECLEANSE / REVALIDATE / UNKNOWN) | Most entity/relation hooks |
| `ILifeCycleMergeData` | `getWinner()`, `getLoserURIs()` | `beforeMerge` |
| `ILifeCycleUnmergeData` | origin object, `getSpawnURI()` | `beforeUnmerge` |
| `ILifeCycleOverrideData` | adds `getMatchObject()` | `beforeOverride` |
| `ILifeCycleValidationData` | `getValidationErrors()`, `addValidationError(...)` | `validate` |
| `ILifeCyclePotentialMatchesData` | list of candidate URIs | match-found/removed hooks |
| `ILifeCycleObjectsPairData` | a pair of objects | not-a-match / mark-as-match hooks |
| `ILifeCycleReferenceAttributeData` | `getEntityURI()`, `getAttributeName()`, `getRelation()` | reference-attribute hooks |
| `ILifeCycleChangeRequestData` | DCR payload | `afterDCRSave` |

**Domain model:** `IObject` (uri, type, `IAttributes`, `ICrosswalks`, roles/tags/categories, start/end date) → `IAttributes` → `ISimpleAttributeValue` / `INestedAttributeValue` / `IReferenceAttributeValue`.

## 3. Hook Catalog (32 hooks)

| Hook | Returns | Mutates | Fires when / typical use |
|---|---|---|---|
| `rawDataBeforeCleanse` | `ILifeCycleObjectData` | Yes | Before cleanse — fix incoming formats, reject bad payloads |
| `rawDataAfterCleanse` | `ILifeCycleObjectData` | Yes | Right after cleanse — validate cleanse output |
| `beforeUpdate` | `ILifeCycleObjectData` | Yes | Before in-memory update applied — derive/auto-populate attributes |
| `afterUpdateBeforeCleanse` | `ILifeCycleObjectData` | Yes | After update, before the post-update cleanse pass |
| `beforeSave` ⭐ | `ILifeCycleObjectData` | Yes | **Most-used hook** — before persist commit; ID generation, defaults, enrichment, validation |
| `afterSave` | void | No | After persist — publish events, sync downstream, kick off workflows |
| `beforeDelete` | `ILifeCycleObjectData` | Yes | Before delete — compliance/legal-hold guard (throw to block) |
| `afterDelete` | void | No | After delete — tombstone events, external cleanup |
| `beforeOverride` | `ILifeCycleOverrideData` | Yes | Match-and-overwrite commit — survivorship hints, veto conflicts |
| `afterOverrideBeforeCleanse` | `ILifeCycleObjectData` | Yes | After override, before the next cleanse pass |
| `beforeMerge` | `ILifeCycleMergeData` | Yes | Winner/losers determined — merge eligibility rules |
| `afterMerge` | void | No | After merge — notify downstream of the merged identity |
| `beforeUnmerge` | `ILifeCycleUnmergeData` | Yes | Split start — audit snapshot, prep new spawn ID |
| `afterUnmerge` | void | No | After split — update registries, emit events |
| `potentialMatchesFound` | void | No | New match candidates surfaced — steward queue routing |
| `potentialMatchesRemoved` | void | No | Match candidates cleared — queue cleanup |
| `beforeNotAMatchSet` | void | No | Before persisting "not a match" — policy checks |
| `afterNotAMatchSet` | void | No | After not-a-match persisted — audit/sync |
| `beforeNotAMatchReset` | void | No | Before clearing a not-a-match decision |
| `afterNotAMatchReset` | void | No | After clearing — report reopened candidates |
| `beforeMarkAsMatch` | void | No | Before manual match confirmation — approval workflow |
| `afterMarkAsMatch` | void | No | After manual match — update golden record |
| `beforeUnmarkAsMatch` | void | No | Before removing a manual match link |
| `afterUnmarkAsMatch` | void | No | After removal — maintain match-graph consistency |
| `beforeReferenceAttributeAdded` | void | No | New relation affecting a reference attribute — validate |
| `afterReferenceAttributeAdded` | void | No | After add processed — audit/sync |
| `beforeReferenceAttributeChanged` | void | No | Reference-affecting relation updated — re-rank |
| `afterReferenceAttributeChanged` | void | No | After change — downstream propagation |
| `beforeReferenceAttributeRemoved` | void | No | Reference-affecting relation removed — guard (e.g. require ≥1 active) |
| `afterReferenceAttributeRemoved` | void | No | After removal — cleanup/audit |
| `afterDCRSave` | void | No | DCR created/updated — **only hook for change-request types**; kick off approval workflow |
| `validate` | `ILifeCycleValidationData` | Errors only | Explicit validation call (not automatic on every save) — must **always** return `data`, never `null` |

**Scope by object type:** entity types get all hooks except `afterDCRSave`. Relationship types get the same set as entities, **with `validate` treated as unreliable/unsupported** — sources disagree (see Known Ambiguities below), so confirm with a spike before relying on it for relations. Change-request types get only `afterDCRSave`.

## 4. Configuration

Configure `lifecycleActions` in tenant JSON on an entity, relationship, or change-request type definition. Hook and action names are case-sensitive.

### Basic structure

```json
{
  "type": "configuration/entityTypes/HCP",
  "lifecycleActions": {
    "rawDataBeforeCleanse": ["FirstAction", "SecondAction"],
    "beforeSave": ["MyBeforeSaveAction"],
    "afterSave": ["MyAfterSaveAction"],
    "validate": ["MyValidationAction"]
  }
}
```

Each hook key maps to an ordered action list (or, for conditional execution, ordered action groups). An unconfigured hook is not invoked.

### Action name formats

| Deployment target | Tenant configuration value |
|---|---|
| Native LCA Service | `"MyActionClassName"` |
| Reltio-managed/shared action | `"Reltio/CommonAction"` |
| AWS Lambda | `"Lambda/BinaryJSON/MyFunctionName"` |
| Google Cloud Function | `"googlefunction/BinaryJSON/<Google Function URL>"` |
| Azure Function | `"AzureFunction/BinaryJSON/<Azure Function URL>"` |
| Azure S3-hosted JAR / native registration | Registered action name; confirm the current tenant-supported Azure path (§7) |

### Simple configuration

Use a plain ordered list when the same actions should run every time the hook fires:

```json
{
  "type": "configuration/entityTypes/Organization",
  "lifecycleActions": {
    "beforeSave": ["OrgIdGeneratorAction"],
    "afterSave": ["SyncToDownstreamAction"],
    "beforeMerge": ["MergeGovernanceAction"]
  }
}
```

### Conditional filters

Use action groups when an action should run only for matching requests:

```json
{
  "type": "configuration/entityTypes/HCP",
  "lifecycleActions": {
    "beforeSave": [
      {
        "actions": ["UiOnlyEnrichmentAction"],
        "filter": "equals(clientType, 'Reltio UI') and equals(attributes.Group, 'GroupA')"
      },
      {
        "actions": ["NonUiEnrichmentAction"],
        "filter": "not(equals(clientType, 'Reltio UI'))"
      }
    ]
  }
}
```

`and` is supported in LCA filter expressions. Do not infer that support from the separate, more limited DVF expression language; see `KB-LCA-03` for the LCA-versus-DVF decision and `KB-LCA-05` for portal facts. `clientType` is populated from the `globalId` request header (for example, `globalId: Reltio UI`), which is useful for UI-originated changes. Bulk update tasks created in the UI do **not** pass `globalId`, so this filter cannot distinguish those tasks from API-originated calls.

Filters that reference data outside the current hook scope are silently ignored: the action simply does not run. Reference-attribute hooks run in relationship scope; parent entity attributes are not available to their filters.

### Multiple hooks on an entity

```json
{
  "type": "configuration/entityTypes/HCP",
  "lifecycleActions": {
    "rawDataBeforeCleanse": ["PreCleanseNormalizerAction"],
    "beforeSave": ["IdGeneratorAction", "FullNameDeriverAction"],
    "afterSave": ["WorkflowInitiatorAction"],
    "beforeDelete": ["DeleteGuardAction"],
    "beforeMerge": ["MergeValidatorAction"],
    "afterMerge": ["DownstreamMergeSyncAction"],
    "validate": ["FieldValidationAction"]
  }
}
```

### Relationship type configuration

Configure a relationship on its `relationTypes` definition. The framework interface contains `validate`, but relationship support is unresolved; do not configure it as a dependency without confirming it for the tenant (§7).

```json
{
  "type": "configuration/relationTypes/HasAddress",
  "lifecycleActions": {
    "beforeSave": ["AddressTypeDefaulterAction"],
    "beforeReferenceAttributeAdded": ["AddressAddedNotifierAction"],
    "beforeReferenceAttributeChanged": ["AddressRankUpdaterAction"],
    "beforeReferenceAttributeRemoved": ["AddressRemovedCleanupAction"]
  }
}
```

### DCR configuration

`afterDCRSave` belongs on the change-request type, not on an entity type:

```json
{
  "type": "configuration/changeRequestTypes/ProfileUpdate",
  "lifecycleActions": {
    "afterDCRSave": ["DCRWorkflowKickoffAction"]
  }
}
```

### Cloud tenant configuration examples

AWS Lambda action values use the deployed function name:

```json
{
  "type": "configuration/entityTypes/HCP",
  "lifecycleActions": {
    "beforeSave": ["Lambda/BinaryJSON/hcp-before-save-handler"],
    "afterSave": ["Lambda/BinaryJSON/hcp-after-save-handler"]
  }
}
```

Google Cloud Function values use the `googlefunction/BinaryJSON/` prefix plus the deployed function URL:

```json
{
  "type": "configuration/entityTypes/HCP",
  "lifecycleActions": {
    "beforeSave": ["googlefunction/BinaryJSON/https://us-central1-PROJECT.cloudfunctions.net/BeforeSaveEntityAction"],
    "validate": ["googlefunction/BinaryJSON/https://us-central1-PROJECT.cloudfunctions.net/ValidateEntityAction"]
  }
}
```

Azure Function values use the `AzureFunction/BinaryJSON/` prefix plus the deployed function URL when that deployment model is enabled for the tenant:

```json
{
  "type": "configuration/entityTypes/HCP",
  "lifecycleActions": {
    "beforeSave": ["AzureFunction/BinaryJSON/https://YOUR-APP.azurewebsites.net/api/BeforeSaveEntityAction"],
    "afterSave": ["AzureFunction/BinaryJSON/https://YOUR-APP.azurewebsites.net/api/AfterSaveAzureLcaHandler"]
  }
}
```

See `KB-LCA-04` for deployment and connectivity prerequisites and `KB-LCA-06` for Maven packaging. The Azure model remains a known ambiguity (§7).

### Chaining multiple actions

Actions in a hook list run sequentially, and later actions receive the preceding action's output:

```json
{
  "beforeSave": [
    "Step1_NormalizeAction",
    "Step2_EnrichFromExternalAction",
    "Step3_ValidateAction"
  ]
}
```

Order is part of the design: place a normalizer before an enricher and an enricher before a validator that depends on its result. Keep each action independently testable and idempotent where practical.

### `executeLCA=false`

`executeLCA=false` is the confirmed platform parameter for a `POST`, `PUT`, or `DELETE` issued **from within an LCA**. It prevents that callback from recursively invoking LCAs. It is not a general switch that arbitrary callers can use to disable tenant LCAs. See `KB-LCA-05` for portal guidance and `KB-LCA-03` for the LCA-versus-DVF/recursion decision.

### Configuration tips

- Test tenant JSON changes in a non-production tenant first; begin with one hook and verify its full request path.
- Deploy `DefaultLcaWithLogger` first when payload shape is uncertain, then replace it with narrowly scoped business logic.
- Use filters to avoid costly logic on unwanted request paths, but do not rely on `clientType` to identify UI-created bulk tasks.
- Keep a hook chain short enough for the 100 ms platform default; move slow work to an idempotent post-persist integration pattern.
- Treat action names as deployable contracts: change the deployed function/class and tenant JSON together.

### Configuration inheritance

LCA config inherits from a parent type. A hook defined only on the parent or only on the child is taken as-is. A hook defined on **both** concatenates: parent's actions run first, then the child's. A customer LCA config always overrides same-hook definitions in a lower metadata layer (e.g., L3 wins over L1). Cloning a profile does **not** trigger LCAs — they only fire on subsequent modification of the clone.

**Ownership pattern:** treat an LCA as its own data source. Give it a dedicated crosswalk and always write back through that named source — if the source reference is omitted when writing data, the written values get associated with **all** existing crosswalks in the entity (a serious data-integrity bug class).

**Maven dependency:**
```xml
<dependency>
  <groupId>com.reltio</groupId>
  <artifactId>life-cycle-framework</artifactId>
  <version>${lca-version}</version> <!-- e.g. 2025.2.0.0, Java 21 -->
</dependency>
```
Repository: `https://repo-dev.reltio.com/content/repositories/public` (or `releases`/`snapshots` per `settings.xml` credentials). Always pin the latest `life-cycle-framework` version — stale versions can cause unexpected data-loading errors.

## 5. Key Gotchas & Constraints

- **`beforeSave` also fires during UI validation/preview flows**, with `ActionType=VALIDATE` (not just CREATE/UPDATE/MERGE/SPLIT/RECLEANSE). If a `beforeSave` handler performs write operations (`_update`, `/ignore`, delete) during this preview pass, **those writes commit immediately and are NOT rolled back** if a DVF fails or the user clicks Cancel. Never perform write side effects inside `beforeSave` when `ActionType == VALIDATE`; only perform them during an actual save.
- **`executeLCA=false`** is the confirmed platform parameter: append it to a `POST`/`PUT`/`DELETE` call made *from within an LCA hook itself* to prevent that call from cascading back into another LCA invocation (the platform's official fix for LCA-triggered infinite loops).
- Synchronous, critical-path execution with a **100 ms default timeout** — keep `before*` hooks fast; long external calls risk aborting the whole operation.
- `after*` hooks must be **idempotent** — platform retries can invoke them more than once for the same event.
- `validate` must **never** return `null` — always return `data`, with errors appended via `addValidationError`.
- Unconfigured hooks are silently skipped — no error, no call.
- `afterSave`'s return value is ignored; writing back to the *same* entity inside `afterSave` without a guard risks a save→afterSave→save re-entrancy loop.
- Batch APIs can send many objects to one LCA invocation — handle batching/ordering, don't assume single-object payloads.
- Action-chain ordering matters — later actions in a hook's list see earlier mutations.
- Garbage collection in LCA works like any regular JVM app — no need to null out locals or call `System.gc()`.
- Banned anti-patterns: hardcoded credentials/tenant IDs/URLs; manual HTTP auth for Reltio calls (use the injected `IReltioAPI`); `System.out`/raw stack traces (use `reltioAPI.log*`); `RuntimeException` for ordinary validation instead of `ValidationError`; raw `Map` manipulation instead of typed `IObject`/`IAttributes`; monolithic classes handling 20+ hooks.

## 6. Terminology Glossary

- **LCA** — custom logic invoked at a lifecycle hook point.
- **Hook** — named pipeline point (e.g. `beforeSave`) where configured actions run.
- **DCR** — Data Change Request; the only hook available is `afterDCRSave`.
- **OV (Of Value)** — the surviving/winning attribute value per survivorship rules (`isOv()`).
- **Crosswalk** — a source-system record contributing to an entity.
- **Winner/Loser** — surviving entity vs. merged-away URIs in a merge.
- **Spawn** — the new entity created by an unmerge/split.
- **Reference Attribute** — a relationship projected onto an entity as an attribute.
- **Potential Match** — a candidate duplicate surfaced by the matching engine.
- **Not-a-Match** — a manual/API decision that two entities are not duplicates (reversible).
- **ActionType** — enum on `ILifeCycleObjectData` (CREATE/UPDATE/MERGE/SPLIT/VALIDATE/RECLEANSE/REVALIDATE/UNKNOWN).
- **IReltioAPI** — injected, pre-authenticated callback client for REST calls and logging.
- **LifecycleExecutor** — test-framework class to run a handler against a JSON string and get JSON back, for unit testing.

## 7. Known Ambiguities / Needs Verification

Flagging these because sources disagree — verify against the current `life-cycle-framework` codebase or with Reltio Platform Engineering before advising a customer:

1. **Dedicated `validate` hook vs. `beforeSave` with `ActionType=VALIDATE`.** The current public "LCA Hooks" doc-portal page (updated 2026-05-08) lists 26 hooks and does **not** include a standalone `validate` hook — instead it states validation flows call `beforeSave` with `ActionType=VALIDATE`. **This repo's `src/main/java/com/reltio/lifecycle/framework/ILifeCycleAction.java` declares all 32 hook methods, including a first-class `validate(IReltioAPI, ILifeCycleValidationData)` and the four the public list omits (`potentialMatchesRemoved`, `beforeUnmarkAsMatch`, `afterUnmarkAsMatch`, `afterDCRSave`) — so at this framework version they exist in the interface.** The gap therefore means the public docs page is a non-exhaustive/older enumeration, not that the hooks are absent. **Still confirm against the `life-cycle-framework` version deployed on the customer's tenant (an older or newer platform build may differ), and treat `beforeSave` + `ActionType` inspection as the more future-proof validation pattern where portability matters.**
2. **`validate` on relationships specifically.** Given ambiguity #1, whether relationships support a distinct `validate` hook at all (vs. relying on `beforeSave`+`ActionType=VALIDATE`) is unresolved. Treat as unreliable for relationships until confirmed.
3. **Azure deployment model.** The public doc portal (LCA Framework page, updated 2026-05-08) states Azure has **no Lambda-equivalent Cloud Function support** and LCAs are deployed as an **S3-hosted JAR** loaded by the LCA Service. Internal framework-repo material describes a `LifeCycleAzureFunction` base class and a full Azure Functions deployment pipeline (Premium plan, Key Vault, etc. — see `04_OPS_SECURITY_CONNECTIVITY_DEPLOYMENT.md`). These may represent two different eras/paths of Azure support. **Confirm current Azure guidance with the framework team before committing a customer to either approach.**
4. **LCA execution timeout figure.** Doc portal states **100 ms** default (post-2023.2 tenants) as a hard platform-enforced value. Some internal cookbook material references a softer "<200ms target" as a design guideline. Use 100 ms as the authoritative constraint; treat 200ms as an already-too-slow anti-pattern warning sign, not the real ceiling.

**Resolved (previously ambiguous, now confirmed by doc portal):**
- **Per-request LCA suppression:** confirmed as `executeLCA=false`, appended to a `POST`/`PUT`/`DELETE` call made from *within* an LCA hook, to stop that call from cascading into another LCA invocation. This is not a generic "disable LCA on this API call" switch for arbitrary callers — it's specifically for preventing LCA-triggered recursion.
- **LCA Service registration/CRUD API exists** and is documented: see `05_EXTERNAL_DOCS_AND_INGESTION_APIS.md` §LCA Service API for the Action object schema and the confirmed `DELETE {lifecycleServiceURL}/api/{tenantId}/actions/{ActionName}` endpoint.

## 8. Hook decision tree & return-type quick map

Choose the hook from the lifecycle event and whether the action must change or reject the in-flight object:

```text
Need to modify an entity or relationship before persistence?
  └─ beforeSave
Need to reject a validation flow with validation errors?
  └─ validate (also account for beforeSave with ActionType=VALIDATE; see §7)
Need to normalize raw data before cleansing?
  └─ rawDataBeforeCleanse
Need to inspect or adjust the post-cleanse object before saving?
  └─ rawDataAfterCleanse or afterUpdateBeforeCleanse
Need a post-persistence side effect?
  └─ afterSave
Need to prevent or govern a delete, merge, or unmerge?
  └─ beforeDelete, beforeMerge, or beforeUnmerge
Need a merge/unmerge notification after it persists?
  └─ afterMerge or afterUnmerge
Need to react to a reference-attribute relation change?
  └─ before/afterReferenceAttributeAdded, Changed, or Removed
Need to react to a DCR?
  └─ afterDCRSave
```

| Hook / family | Return type | Return rule |
|---|---|---|
| `beforeSave`, cleanse, update, delete, override | Corresponding `ILifeCycle*Data` subtype | Return the data object after mutation; use the hook’s no-op contract for unchanged data. |
| `beforeMerge` | `ILifeCycleMergeData` | Return the data; throw only to block an operation under a deliberate policy. |
| `beforeUnmerge` | `ILifeCycleUnmergeData` | Return the data after any permitted adjustment. |
| `validate` | `ILifeCycleValidationData` | Always return `data`; append `ValidationError` values as appropriate; never return `null`. |
| `after*`, match, and reference-attribute notification hooks | `void` | Do not attempt to return a mutation; make external effects idempotent. |

For implementation patterns, SDK, and fixtures, see `02_LCA_IMPLEMENTATION_HANDBOOK.md` (`KB-LCA-02`).

## 9. Anti-patterns never generate

The following patterns are unsafe, non-portable, or conflict with the LCA execution model:

1. **Hardcoded credentials, tenant IDs, or environment URLs.** Do not embed usernames, passwords, OAuth secrets, Basic-auth headers, tenant IDs, or customer endpoints in code. Use deployment configuration and platform-provided identity.
2. **Manual authentication for Reltio callbacks.** Do not call Reltio auth endpoints with `HttpURLConnection` just to invoke Reltio APIs. Use injected `IReltioAPI`, which already carries request context and authentication.
3. **Unstructured console logging.** Do not use `System.out` or `printStackTrace`; use `reltioAPI.logInfo`, `logWarning`, and `logError` with operation-safe context.
4. **Exceptions for ordinary validation.** Do not throw `RuntimeException` to report field-level validation. Use `ValidationError` values in `validate`. Reserve a runtime exception for intentionally blocking an operation where the hook contract supports that policy.
5. **Returning `null` from `validate`.** Always return the supplied validation data after adding any errors.
6. **Raw `Map`-driven business logic.** Prefer `IObject`, `IAttributes`, `IReferenceAttributeValue`, and other typed framework interfaces; use `toMap()` only when its payload representation is actually needed.
7. **Unchecked list access.** Do not call `.get(0)` without proving the collection is non-empty. Apply null and cardinality checks before reading attributes, crosswalks, or relations.
8. **`afterSave` write-back without recursion control.** Updating the same object in `afterSave` can cause re-entrancy. Use an explicit business guard and, where the callback is made from an LCA, `executeLCA=false`.
9. **External blocking work in a synchronous hook.** Do not make slow, retry-unsafe network calls on the critical path. The default LCA timeout is 100 ms; use a post-persist, idempotent integration design when latency is not bounded.
10. **Side effects during validation preview.** `beforeSave` can run with `ActionType=VALIDATE`. Do not write, delete, or invoke non-reversible external operations in that path because cancellation or DVF failure does not roll them back.
11. **A monolithic multi-hook class.** Do not build 500-line handlers that own dozens of unrelated hooks. Keep a handler focused, extract typed helpers, and test hooks independently.
12. **Customer-specific names in reusable packages.** Avoid customer names in shared package and class names; use a neutral namespace such as `com.example.lca` and keep customer configuration outside code.
13. **Assuming one object per invocation.** Batch APIs may pass multiple objects. Do not encode single-record assumptions into payload traversal, ordering, or idempotency.
14. **Filter scope assumptions.** Do not filter a reference-attribute hook using parent entity fields; unsupported references are silently ignored and the action will not run.

## 10. Business need → hook map

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

## 11. Notes on use-case sourcing

Each row above distills a recurring pattern from a much larger set of historical customer-specific LCA implementations. The `life-cycle-framework` repo itself provides the building blocks — the framework interfaces and base classes under `src/main/java/com/reltio/lifecycle/framework/` (`ILifeCycleAction`, `LifeCycleActionBase`, the `ILifeCycle*Data` types, and `validation/ValidationError`). When a customer's need matches a row, start from the matching production pattern in `02_LCA_IMPLEMENTATION_HANDBOOK.md` (with cookbook/helpers in `02_LCA_IMPLEMENTATION_HANDBOOK.md`) rather than writing bespoke plumbing from scratch, and cover it to the ≥92% JaCoCo gate.

## 12. How to use the use-case table when advising

1. Restate the business need in terms of the object lifecycle moment it affects (on create? on every update? only on merge? only on delete?) — that maps directly to a hook.
2. Check `03_DVF_AND_LCA_VS_DVF_DECISION_GUIDE.md` first if the need is "reject/flag bad data with no mutation and no external call" — DVF is very likely the cheaper, no-code answer.
3. If the need requires mutating data, calling an external system, or reacting to merge/unmerge/delete, it's an LCA. Use the complexity column to set customer expectations on build effort (Simple: hours-days; Medium: days; Complex: 1-2+ weeks including test fixtures).
4. Cross-check whether the same need also implies an ingestion-side change (e.g., pre-validating a source file before it ever reaches Reltio) — see `05_EXTERNAL_DOCS_AND_INGESTION_APIS.md`.
5. Before writing code, confirm the **target entity type** (e.g. `HCP`, `HCO`) and the **exact L3 attributes** (attribute names/paths from the tenant's L3 data model) the LCA must read or write. Build the handler against those real attribute names — do not invent them. If they aren't provided, ask for them before generating code.
6. Keep the LCA-vs-DVF reasoning internal — once resolved, answer the customer in that single context (see the presentation rule in `03_DVF_AND_LCA_VS_DVF_DECISION_GUIDE.md`). Do not surface internal KB doc IDs, file names, or line numbers in the customer-facing answer unless they explicitly ask for sources.
