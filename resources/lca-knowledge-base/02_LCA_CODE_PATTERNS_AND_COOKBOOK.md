# LCA Code Patterns, Cookbook & Testing

> Doc ID: `KB-LCA-02` | Category: Implementation
> Read `01_LCA_CORE_CONCEPTS_AND_HOOKS.md` first for hook semantics and data interfaces.

## 1. Maven Project Structure

**Layout** (one module per cloud target):
```
my-lca-project/
├── pom.xml                          (parent, packaging=pom)
├── my-lca-lambda/
│   ├── pom.xml
│   └── src/{main,test}/java/.../entities|relations/*.java
├── my-lca-googlefunction/
│   ├── pom.xml
│   └── src/{assembly/zip.xml, main, test}/...
└── my-lca-azure-function/
    ├── pom.xml
    └── src/{assembly/azure-function-zip.xml, main, test}/...
```

**Required repository (all clouds):** `https://repo-dev.reltio.com/content/repositories/public`

**Core dependencies per module:**
- `com.reltio:life-cycle-framework:${lca-version}` — exclude all transitive Jackson + `com.fasterxml.reltio:*-shaded` deps
- Cloud base artifact: `life-cycle-framework-aws-lambda` / `-google-function` / `-azure-function`
- `com.reltio.services.lca:reltio-lca-executor:${lca-version}` (runtime) — additionally exclude `commons-library`, `swagger-annotations`, `commons-codec`/`commons-collections`, `httpclient`, `kryo`, `joda-time`
- Pin Jackson explicitly via `<dependencyManagement>` in the module (parent BOM entries win over child imports — this is the only reliable override path). Versions differ per cloud: Lambda 2.17.3, GCF 2.13.3, Azure 2.15.4.
- Cloud SDKs: `aws-lambda-java-core:1.2.1`, `aws-java-sdk-core:1.12.178` (Lambda); `azure-functions-maven-plugin` (Azure)
- Test scope: `reltio-lca-test-framework:${lca-version}` (exclude `reltio-lca-service`), `junit-jupiter:5.8.2`, `junit:4.13.2`, `mockito-core:4.7.0`, `jsonassert:1.3.0`
- `log4j:1.2.17`, scope=provided

**Build/packaging per cloud:**

| Cloud | Packaging | Handler / entry point | Deploy | Tenant config value |
|---|---|---|---|---|
| AWS Lambda | `maven-assembly-plugin` → `jar-with-dependencies` | `com.reltio.lifecycle.lambda.LcaJarExecutionLambdaHandler` (or custom), env var `lca_class_name` | `aws lambda create-function` / `update-function-code` | `"Lambda/BinaryJSON/<function-name>"` |
| GCP Cloud Functions | fat jar zipped via custom `src/assembly/zip.xml` | `com.reltio.lifecycle.googlefunction.LcaJarExecutionGoogleHandler` | `gcloud functions deploy --gen2 --runtime=java21` | full HTTPS trigger URL |
| Azure Functions | `azure-functions-maven-plugin` generates `function.json` per `@FunctionName` class; zipped via `src/assembly/azure-function-zip.xml` | one class per hook endpoint | `az functionapp deployment source config-zip` | full HTTPS endpoint URL — **but see the S3-JAR caveat in `01_LCA_CORE_CONCEPTS_AND_HOOKS.md` §7** |

Azure gotchas: storage account names are globally unique (409 if taken); Linux Consumption plan may have zero quota (401) — use EP1 Premium; Java version must sometimes be `21.0`, not `21`.

- **Versioning:** pin `<lca-version>` (e.g. `2025.2.0.0`) consistently across all modules; the artifact's own version is independent (e.g. `1.0.0`).
- **CI gate:** `jacoco-maven-plugin:0.8.12`, PACKAGE-level LINE coverage minimum **0.92**, enforced via the `jacoco-check` goal bound to `package`/`verify`.
- **Legacy migration tool:** `unified-cloud-deployer` — Reltio CE packages JARs + generates Terraform values; customer runs `terraform apply`. Only for migrating existing legacy JARs, not new builds.
- Common commands: `mvn clean package`, `mvn clean package -pl <module>`, `mvn clean test`, `mvn clean verify` (adds the coverage gate).

## 2. Handler Code Patterns

Signature shape: `<ReturnType> hookName(IReltioAPI reltioAPI, <DataType> data)`.

### Validation handler (`validate`)
Must always return `data`, never `null`.
```java
public ILifeCycleValidationData validate(IReltioAPI api, ILifeCycleValidationData data) {
    String v = LcaAttributeUtils.getFirstStringValue(data.getObject().getAttributes(), "FirstName");
    if (v != null && v.startsWith("#")) {
        data.addValidationError(ValidationError.incorrectAttribute(
            data.getObject().getAttributes().getAttributeValues("FirstName").get(0),
            "FirstName cannot start with '#'"));
    }
    return data;
}
```

### Enrichment handler (`beforeSave` — derive/default attributes)
```java
public ILifeCycleObjectData beforeSave(IReltioAPI api, ILifeCycleObjectData data) {
    IAttributes attrs = data.getObject().getAttributes();
    ISimpleAttributeValue name = attrs.createSimpleAttributeValue("Name")
        .value(firstName + " " + lastName).build();
    attrs.addAttributeValue(name);
    data.getObject().getCrosswalks().getCrosswalks().get(0).getAttributes().addAttribute(name);
    return data;   // null discards changes — must return data when mutated
}
```

### Cross-entity update handler (`afterSave` — idempotency-guarded relation creation)
```java
public void afterSave(IReltioAPI api, ILifeCycleObjectData data) {
    if (!CAMPAIGN_TYPE.equalsIgnoreCase(data.getObject().getType())) return;
    for (Map brand : fetchCandidateBrands(api)) {
        if (nameMatches(data, brand) && !relationExists(api, data.getObject().getUri(), brand)) {
            createRelation(api, data.getObject().getUri(), (String) brand.get("uri"));
        }
    }
}
```

### External lookup / pre-cleanse validation (`rawDataBeforeCleanse` — throw to abort)
```java
public ILifeCycleObjectData rawDataBeforeCleanse(IReltioAPI api, ILifeCycleObjectData data) {
    Set<String> validCodes = fetchLookupCodes(api, "CustomerCategory");
    for (IAttributeValue v : data.getObject().getAttributes().getAttributeValues("CustomerCategory")) {
        if (!validCodes.contains((String) v.getValue()))
            throw new RuntimeException("Invalid CustomerCategory: " + v.getValue());
    }
    return null;
}
```
An advanced "direct REST call with client credentials" variant (OAuth2 `client_credentials`, manual `Authorization: Bearer` header) exists for cases needing a separate machine identity when `IReltioAPI`'s bound token isn't sufficient. This is not the default — never log tokens.

### Notification handler (`afterSave` — role assignment + external workflow trigger)
```java
public void afterSave(IReltioAPI api, ILifeCycleObjectData data) {
    if (!hasMemberRole(data.getObject())) {
        api.post("entities/" + data.getObject().getUri() + "/roles",
            "[{\"type\":\"configuration/roles/Candidate\"}]", Collections.emptyMap());
        api.post("external/workflow/initiate", "{\"entityUri\":\"" + data.getObject().getUri() + "\"}",
            Collections.singletonMap("Content-Type", "application/json"));
    }
}
```

## 3. Input/Output Contract

Payload envelope: `object` (`uri`, `type`, `attributes` map of name→list-of-value-objects each with `type`/`ov`/`value`/`uri`, `crosswalks` array with `type`/`value`/`attributes`(URIs)/`dataProvider`), plus `environment`, `tenant`, `hook`/`token`. Merge payloads carry `losers` (loser URIs) alongside/instead of `object` (winner). Reference-attribute payloads use `entityURI`/`attributeName`/`relation` instead of `object`. `validate` payloads additionally carry `validationErrors: []` and `successful`.

**Response contract:** mutating hooks return the full modified `object` — the platform persists whatever comes back; return 200 with an empty/no-op body when nothing changed. `validate` always returns `data` with `validationErrors` populated (empty array = pass); each error has `errorType`, `objectUri`, `objectTypeUri`, `message`, `severity`. To hard-block an operation, throw `RuntimeException` (surfaces as a 4xx to the caller). `afterSave`/`afterDelete`/etc. are void/fire-and-forget.

**Canonical LCA JSON input template** (per doc portal):
```json
{
  "object": {
    "type": "{{typeURI}}",
    "attributes": { "{{Attribute_Values}}" },
    "crosswalks": [{ "type": "{{crosswalkURI}}", "value": "{{crosswalkValue}}" }]
  },
  "tenant": "{{tenantId}}",
  "environment": "http://360.reltio.com/reltio/",
  "token": "{{accessToken}}"
}
```

**Compact real example** (`beforeSave` create):
```json
{
  "object": {
    "uri": "entities/06G5oeG", "type": "configuration/entityTypes/HCP",
    "attributes": {
      "FirstName": [{"ov": true, "value": "John", "uri": ".../FirstName/oVSvuTY"}],
      "LastName":  [{"ov": true, "value": "Snow", "uri": ".../LastName/oVSvyjo"}]
    },
    "crosswalks": [{"uri": "...crosswalks/oVSw304", "type": "configuration/sources/Salesforce",
                     "value": "06G5oeG", "attributes": [".../LastName/oVSvyjo", ".../FirstName/oVSvuTY"]}]
  },
  "environment": "https://na1.reltio.com/reltio", "tenant": "MyTenantId", "hook": "beforeSave"
}
```
Output adds the derived `Name` attribute and includes its URI in the owning crosswalk's `attributes` list.

## 4. Testing Patterns

**Layers:** unit tests per hook method (via `reltio-lca-test-framework` + JUnit), fixture-based JSON-in/JSON-out tests via `LifecycleExecutor` + `JSONAssert`, integration tests in `life-cycle-service`'s integration module, and a post-deploy smoke test. Target ≥92% JaCoCo line coverage (CI-gated).

**`LifecycleExecutor` pattern** (from official docs):
```java
LifecycleExecutor executor = new LifecycleExecutor();
ILifeCycleAction handler = new FirstNameAppendAction();
String actual = executor.executeAction(handler, LifeCycleHook.beforeSave,
    "{\"object\": {\"URI\":\"entities/HCP.1\", \"attributes\":{\"FirstName\":[{\"value\":\"John\"}]}}}");
String expected = "{\"object\": {\"URI\":\"entities/HCP.1\", \"attributes\":{\"FirstName\":[{\"value\":\"JohnAppended\"}]}, "
    + "\"roles\":[], \"tags\":[], \"crosswalks\":[], \"categories\":[]}, \"successful\": true}";
JSONAssert.assertEquals(expected, actual, true);
```
`executeAction` overloads accept an optional `IReltioAPI` (mock or a real `ReltioAPI(environment, tenant, token)` instance) when the test needs to exercise API calls.

**Fixture-based pattern:** extend `BaseTest`, call `loadFromFile("entities/beforesave/input.json")` (path relative to `src/test/resources/`), organized by hook (`entities/beforesave/`, `entities/validate/`, `relations/beforesave/`, `merge/beforemerge/`).

**Mocking:** `mockReltioAPI()` from the test framework stubs `IReltioAPI` — never call real tenant APIs or embed credentials in test resources.

**Test matrix to cover:** CREATE/UPDATE/MERGE/SPLIT via `ActionType`, missing/null attributes (NPE safety), empty string vs. null, multiple crosswalks (never blindly `.get(0)`), OV vs. non-OV values, relation payload shape, merge-blocked exception path, `afterSave` re-entrancy guard.

**Fixture capture workflow:** enable `logInfo`, reproduce in a non-prod tenant, capture the payload from cloud logs, redact PII/tenant URIs before committing as a fixture.

## 5. Common Pitfalls in Code

1. **Returning `null` after mutating `data` in `before*` hooks** — the platform silently discards the change. Always return `data` when mutated.
2. **Returning `null` from `validate`** — causes a silent validation pass-through. Always `return data`.
3. **`afterSave` writing back to the same entity via `api.put()`** — triggers another save cycle → cascading recursion. Prefer mutating in `beforeSave`; if unavoidable, guard with a source-system filter or a processed-flag check.
4. **`.get(0)` on attribute/crosswalk lists without null/empty checks** — NPE, `IndexOutOfBoundsException`, or writing to the wrong crosswalk. Null-check every `getAttributeValues()` result; select a crosswalk by `type`, never by position.
5. **`ClassCastException`** from casting nested/reference attributes as `ISimpleAttributeValue`. Check the tenant's data model for attribute shape; use `INestedAttributeValue`/`IReferenceAttributeValue` as needed.
6. **Blocking synchronous external HTTP calls in `before*` hooks** — the 100 ms platform timeout (see `01_LCA_CORE_CONCEPTS_AND_HOOKS.md`) makes this a hard failure mode, not just a latency concern. Move non-critical enrichment to `afterSave`, cap external calls, cache reference data, reuse HTTP clients.
7. **Loading the full entity via `getObject(uri)` for one field** — wasteful. Use targeted `get(uri + "?select=attributes.X", ...)`.
8. **Swallowing exceptions silently** (empty catch blocks) — hides production failures. Log via `reltioAPI.logError` with the entity URI, then rethrow/handle explicitly.
9. **Hardcoded credentials / manual OAuth for ordinary Reltio calls** — unnecessary; `IReltioAPI` already carries the caller's token. Reserve manual client-credentials flow for the documented separate-identity case only.
10. **`System.out.println`/raw `logger.error()`** bypasses Reltio's LCA log pipeline. Use `reltioAPI.logInfo/logWarning/logError`.
11. **Logging entire payloads in production** (`toMap()` / full-message logging) — performance and PII risk; reserve for `DefaultLcaWithLogger` in dev.
12. **Generating IDs in `afterSave`** — a `PUT` after save re-triggers the save cycle. Generate/set IDs in `beforeSave`.
13. **Monolithic classes handling 20+ hooks (500+ lines)** — split by responsibility; separate entity vs. relation handlers into distinct packages.
14. **Using `RuntimeException` for ordinary validation instead of `ValidationError`** — bypasses structured UI error display. Reserve exceptions for hard aborts.
15. **Non-idempotent `after*` hooks** — platform retries can duplicate side effects. Use the entity URI as an idempotency key; check state before acting.
16. **Jackson version conflicts** between the Reltio BOM and custom code — serialization errors appearing only post-deployment. Exclude all Jackson transitive deps and pin one version via `dependencyManagement`.
