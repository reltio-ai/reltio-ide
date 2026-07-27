# LCA Core Concepts, Architecture & Hook Catalog

> Doc ID: `KB-LCA-01` | Category: Core Concepts
> Authoritative doc-portal source: [Customize data tasks with LCAs](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas) (see `06_RELTIO_DOC_PORTAL_REFERENCE.md` for the full crawl)
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

Configured under `lifecycleActions` in the tenant JSON on the entity/relationship/change-request type definition. Hook names are case-sensitive.

```json
{
  "type": "configuration/entityTypes/HCP",
  "lifecycleActions": {
    "rawDataBeforeCleanse": [
      "FirstAction",
      "SecondAction",
      "Reltio/CommonAction",
      "Lambda/BinaryJSON/LambdaAction"
    ],
    "beforeSave": ["MyBeforeSaveAction"],
    "afterSave": ["MyAfterSaveAction"],
    "validate": ["MyValidationAction"]
  }
}
```

- **Simple form:** hook → ordered action-name list, executed sequentially; each action receives the previous action's output as input.
- **Conditional form:** a hook can instead hold a list of action *groups*, each with a `filter` expression gating execution per request, e.g.:
  ```json
  "lifecycleActions": {
    "beforeSave": [
      { "actions": ["LCAGroupA"],
        "filter": "equals(clientType, 'Reltio UI') and equals(attributes.Group, 'GroupA')" }
    ]
  }
  ```
  `and` is supported in LCA filter expressions (confirmed via doc portal — do not confuse with the separate, more limited DVF expression language in `04_DVF_AND_LCA_VS_DVF_DECISION_GUIDE.md`, which has no documented `and`). `clientType` is populated from the `globalId` request header (e.g. `globalId: Reltio UI`) — useful for running an LCA only for UI-originated changes, not bulk/API loads. Note: bulk update tasks created via the UI do **not** pass `globalId`, so a `clientType` filter will not distinguish them from API-originated calls.
  Filters referencing a field outside the current hook's scope (e.g. a parent entity attribute inside a reference-attribute hook filter) are **silently ignored**, not errored — the hook simply won't run. Reference-attribute hooks execute in relationship scope only; parent entity attributes are not available to them.
- **Action name format by target:** native = plain class name; shared Reltio-managed action = `Reltio/<name>` prefix; AWS Lambda = `"Lambda/BinaryJSON/<FunctionName>"`; GCF = `"GoogleFunction/<FunctionName>"` or full URL; Azure = full HTTPS endpoint URL (or S3 JAR registration name — see §7).

**Configuration inheritance:** LCA config inherits from a parent type. A hook defined only on the parent or only on the child is taken as-is. A hook defined on **both** concatenates: parent's actions run first, then the child's. A customer LCA config always overrides same-hook definitions in a lower metadata layer (e.g., L3 wins over L1). Cloning a profile does **not** trigger LCAs — they only fire on subsequent modification of the clone.

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
3. **Azure deployment model.** The public doc portal (LCA Framework page, updated 2026-05-08) states Azure has **no Lambda-equivalent Cloud Function support** and LCAs are deployed as an **S3-hosted JAR** loaded by the LCA Service. Internal framework-repo material describes a `LifeCycleAzureFunction` base class and a full Azure Functions deployment pipeline (Premium plan, Key Vault, etc. — see `05_BEST_PRACTICES_TROUBLESHOOTING_SECURITY_DEPLOYMENT.md`). These may represent two different eras/paths of Azure support. **Confirm current Azure guidance with the framework team before committing a customer to either approach.**
4. **LCA execution timeout figure.** Doc portal states **100 ms** default (post-2023.2 tenants) as a hard platform-enforced value. Some internal cookbook material references a softer "<200ms target" as a design guideline. Use 100 ms as the authoritative constraint; treat 200ms as an already-too-slow anti-pattern warning sign, not the real ceiling.

**Resolved (previously ambiguous, now confirmed by doc portal):**
- **Per-request LCA suppression:** confirmed as `executeLCA=false`, appended to a `POST`/`PUT`/`DELETE` call made from *within* an LCA hook, to stop that call from cascading into another LCA invocation. This is not a generic "disable LCA on this API call" switch for arbitrary callers — it's specifically for preventing LCA-triggered recursion.
- **LCA Service registration/CRUD API exists** and is documented: see `06_RELTIO_DOC_PORTAL_REFERENCE.md` §LCA Service API for the Action object schema and the confirmed `DELETE {lifecycleServiceURL}/api/{tenantId}/actions/{ActionName}` endpoint.
