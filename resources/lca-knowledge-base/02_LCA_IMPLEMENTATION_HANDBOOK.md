# LCA Implementation Handbook (SDK, Cookbook, Patterns, Fixtures & Testing)

> Doc ID: `KB-LCA-02` | Category: Implementation
> Single retrieval home for writing/testing LCAs: SDK, recipes, production patterns, JSON fixtures, and tests. Maven scaffolds: `06_MAVEN_PROJECT_TEMPLATES.md`. Hook semantics: `01_LCA_CORE_CONCEPTS_AND_HOOKS.md`.
> Read [KB-LCA-01](01_LCA_CORE_CONCEPTS_AND_HOOKS.md) first for lifecycle semantics, hook timing, and cloud constraints. This document is a code-generation reference: adapt names and type URIs to the tenant data model; do not copy tenant-specific IDs or credentials.

## 1. Maven Project Structure (summary)

> Full copy-paste POMs, dependency exclusions, assembly descriptors, packaging commands, and deployment guidance are in [KB-LCA-06](06_MAVEN_PROJECT_TEMPLATES.md). Use it to scaffold a project; this is only an orientation.

Use one module per cloud deployment target, with source split by responsibility rather than by one large handler:

```text
my-lca-project/
├── pom.xml
├── my-lca-lambda/
│   └── src/{main,test}/java/.../{entities,relations,merge}/
├── my-lca-googlefunction/
│   └── src/{main,test}/java/.../
└── my-lca-azure-function/
    └── src/{main,test,assembly}/...
```

Pin one compatible `${lca-version}` across framework, cloud adapter, executor, and test framework. Run `mvn clean verify` before packaging; it should enforce package-level JaCoCo line coverage of **at least 92%**. Keep cloud packaging and Jackson dependency management exactly as supplied in KB-LCA-06.

For Azure deployment and its S3-JAR caveat, use [KB-LCA-01 §7](01_LCA_CORE_CONCEPTS_AND_HOOKS.md#7-cloud-deployment-and-runtime-notes), not a copied workaround.

## 2. Java SDK object model reference

All framework types are under `com.reltio.lifecycle.framework`. A handler implements `ILifeCycleAction`, usually by extending a base class and overriding only the required hook.

### `ILifeCycleAction` and base classes

`ILifeCycleAction` exposes lifecycle methods in these groups:

```java
// Object processing
ILifeCycleObjectData rawDataBeforeCleanse(IReltioAPI api, ILifeCycleObjectData data);
ILifeCycleObjectData rawDataAfterCleanse(IReltioAPI api, ILifeCycleObjectData data);
ILifeCycleOverrideData beforeOverride(IReltioAPI api, ILifeCycleOverrideData data);
ILifeCycleObjectData afterOverrideBeforeCleanse(IReltioAPI api, ILifeCycleObjectData data);
ILifeCycleObjectData beforeSave(IReltioAPI api, ILifeCycleObjectData data);
void afterSave(IReltioAPI api, ILifeCycleObjectData data);
ILifeCycleObjectData beforeUpdate(IReltioAPI api, ILifeCycleObjectData data);
ILifeCycleObjectData afterUpdateBeforeCleanse(IReltioAPI api, ILifeCycleObjectData data);
ILifeCycleObjectData beforeDelete(IReltioAPI api, ILifeCycleObjectData data);
void afterDelete(IReltioAPI api, ILifeCycleObjectData data);

// Merge, matching, reference-attribute, DCR, and validation hooks
ILifeCycleMergeData beforeMerge(IReltioAPI api, ILifeCycleMergeData data);
void afterMerge(IReltioAPI api, ILifeCycleMergeData data);
ILifeCycleUnmergeData beforeUnmerge(IReltioAPI api, ILifeCycleUnmergeData data);
void afterUnmerge(IReltioAPI api, ILifeCycleUnmergeData data);
ILifeCycleValidationData validate(IReltioAPI api, ILifeCycleValidationData data);
```

The interface also includes potential-match and not-a-match callbacks, six reference-attribute callbacks, and `afterDCRSave`. See KB-LCA-01 for when each runs.

* `LifeCycleActionBase` is the normal foundation. Its hook methods are no-ops or return `null`; override only the hooks needed.
* `LifeCycleActionHandler`, `LifeCycleGoogleFunction`, and `LifeCycleAzureFunction` are cloud-specific bases. Azure entry points additionally require `@FunctionName` and `@HttpTrigger`; one independently exposed endpoint needs its own annotated class.
* `DefaultLcaWithLogger` serializes `data.toMap()` and calls `logFullMessage()` for every hook. Use it only for development diagnosis because full payloads can contain PII.

Mutation-capable `before*` methods must return the changed `data`. Void `after*` methods are notification/side-effect hooks. `validate` must always return its `data`, including when no errors were added.

### Lifecycle data interfaces

`ILifeCycleData` is the shared context:

```java
String getTenant();
String getEnvironment();
String getProperty(String name);
Map<String, Object> toMap();
List<Locale> getAcceptedLocales();
```

The more specific input types select the correct object model:

| Type | Important methods | Use |
|---|---|---|
| `ILifeCycleObjectData` | `getObject()`, `getActionType()` | Entity or relation hooks |
| `ILifeCycleValidationData` | `getValidationErrors()`, `addValidationError(...)`, `addValidationErrors(...)` | `validate` |
| `ILifeCycleMergeData` | `getWinner()`, `getLoserURIs()` | Merge logic |
| `ILifeCycleUnmergeData` | `getObject()`, `getSpawnURI()` | Unmerge/split logic |
| `ILifeCycleReferenceAttributeData` | `getEntityURI()`, `getAttributeName()`, `getRelation()` | Reference-attribute callbacks |
| `ILifeCycleOverrideData` | `getMatchObject()` | Override processing |

`getActionType()` lets a shared `beforeSave` distinguish `CREATE`, `UPDATE`, `MERGE`, `SPLIT`, `VALIDATE`, `RECLEANSE`, and `REVALIDATE`. Do not infer the action from missing fields.

### `IObject`: entity or relation being processed

```java
String getUri();             // e.g. entities/06G5oeG or relations/...
String getType();            // configuration entity/relation type URI
IAttributes getAttributes();
ICrosswalks getCrosswalks();
IRoles getRoles();
ITags getTags();
ICategories getCategories();
Date getStartDate();
void setStartDate(Date value);
Date getEndDate();
void setEndDate(Date value);
```

The same `IObject` abstraction represents an entity or a relation. Confirm the configured type before applying entity-specific assumptions.

### `IAttributes` and value types

`IAttributes` is the mutable attribute bag:

```java
List<IAttributeValue> getAttributeValues(String attributeName);
List<IAttributeValue> getAllAttributeValues();
void addAttributeValue(IAttributeValue value);
void removeAttributeValue(IAttributeValue value);
ISimpleAttributeValueBuilder createSimpleAttributeValue(String attributeName);
INestedAttributeValueBuilder createNestedAttributeValue(String attributeName);
```

`getAttributeValues(name)` can be absent or empty; check before indexing. Attribute values have different payload shapes:

| Value interface | `getValue()` | Appropriate use |
|---|---|---|
| `ISimpleAttributeValue` | scalar value | Text, numeric, date, Boolean, lookup code |
| `INestedAttributeValue` | `IAttributes` | Nested groups such as a phone with Number and Type |
| `IReferenceAttributeValue` | `IAttributes` | Relation projected as a reference attribute |

For simple values, use typed methods rather than unchecked casts:

```java
String getStringValue();
boolean getBooleanValue();
int getIntegerValue();
long getLongValue();
double getDoubleValue();
Date getDateValue();
void setValue(Object value);
boolean isOv();
String getUri();
String getType();
```

Build and add a simple value through the attribute bag:

```java
ISimpleAttributeValue status = attributes
    .createSimpleAttributeValue("Status")
    .value("Active")
    .build();
attributes.addAttributeValue(status);
```

### Crosswalks and source ownership

`IObject.getCrosswalks()` returns `ICrosswalks`; use `getCrosswalks()` to enumerate its `ICrosswalk` records:

```java
List<ICrosswalk> getCrosswalks();

// ICrosswalk
String getType();
String getValue();
ICrosswalkAttributes getAttributes();
boolean isDataProvider();
boolean isContributorProvider();
```

`ICrosswalkAttributes` identifies values contributed by a source. When a new value belongs to a source, associate it with the selected crosswalk:

```java
crosswalk.getAttributes().addAttribute(newValue);
// Some patterns use addAttributeURI(newValue.getUri()) when working with URI lists.
```

Never use crosswalk position as source selection. Match `ICrosswalk.getType()` to the configured source URI and handle no matching source explicitly.

### `IReltioAPI`: Reltio callbacks and logging

The framework injects `IReltioAPI` into every hook. It already carries the request's authorization context, so ordinary Reltio calls use relative paths and no Authorization header:

```java
String get(String uri, Map<String, String> headers);
String post(String uri, String body, Map<String, String> headers);
String put(String uri, String body, Map<String, String> headers);
String delete(String uri, Map<String, String> headers);
IObject getObject(String uri);

void logInfo(String message);
void logWarning(String message);
void logError(String message);
void logFullMessage(String message);
```

Pass `Collections.emptyMap()` unless a non-authentication header is required. Prefer a selective `get("entities/id?select=attributes.X", ...)` to fetching an entire entity for one field.

An OAuth client-credentials REST call is an advanced exception only when the design explicitly needs a separate machine identity. Keep its credentials in secure configuration, never log access tokens, and do not expect a new token to alter the injected `IReltioAPI` authorization.

### Structured validation errors

For user-facing validation, add `ValidationError` values in `validate` rather than throwing an exception:

```java
ValidationError.incorrectAttribute(IAttributeValue value, String message);
ValidationError.missedAttribute(String attributeTypeUri, IObjectWithURI parent, String message);
ValidationError.incorrectAttributeType(String attributeTypeUri, IObjectWithURI parent, String message);
ValidationError.createError(String attributeUri, String attributeTypeUri, String message);
ValidationError.createWarning(String attributeUri, String attributeTypeUri, String message);
```

Severity is `IValidationError.Severity.ERROR` or `IValidationError.Severity.WARNING`. Throw only for a hard abort that cannot be represented as a field-level validation issue.

### `ActionType` and `ChangeType`

```java
enum ActionType {
    UNKNOWN, CREATE, UPDATE, MERGE, SPLIT, VALIDATE, RECLEANSE, REVALIDATE
}

enum ChangeType {
    INSERT_ATTRIBUTE, UPDATE_ATTRIBUTE, DELETE_ATTRIBUTE,
    PIN_ATTRIBUTE, IGNORE_ATTRIBUTE,
    CREATE_ENTITY, CREATE_RELATIONSHIP,
    UPDATE_ROLES, UPDATE_TAGS, UPDATE_START_DATE, UPDATE_END_DATE,
    UPDATE_PROFILE_PIC_BY_URI, UPDATE_PROFILE_PIC_BY_URL
}
```

Use `ActionType` to guard lifecycle behavior. `ChangeType` describes supported change categories; do not substitute it for the operation reported by `ILifeCycleObjectData.getActionType()`.

## 3. Handler code patterns (high-level)

These are five recurring designs. Full production-ready versions, guards, and handler organization are in §§10–16 of this document.

### 1. Validation (`validate`)

Read only what is needed, add structured errors, and return the same envelope:

```java
public ILifeCycleValidationData validate(IReltioAPI api, ILifeCycleValidationData data) {
    IAttributeValue firstName = LcaAttributeUtils.getFirstValue(
        data.getObject().getAttributes(), "FirstName");
    if (firstName != null && firstName.getValue().toString().startsWith("#")) {
        data.addValidationError(ValidationError.incorrectAttribute(
            firstName, "FirstName cannot start with '#'."));
    }
    return data;
}
```

### 2. Enrichment/defaulting (`beforeSave`)

Derive or add values before persistence, attach the new value to the appropriate source crosswalk if the data model requires source ownership, then return `data`:

```java
public ILifeCycleObjectData beforeSave(IReltioAPI api, ILifeCycleObjectData data) {
    IAttributes attributes = data.getObject().getAttributes();
    LcaAttributeUtils.setOrAddSimpleAttribute(attributes, "Status", "Active");
    return data;
}
```

### 3. Cross-entity side effects (`afterSave`)

Use `afterSave` for a post-persist effect such as relation creation or workflow initiation. First check the type, action, and existing state so retries do not duplicate work:

```java
public void afterSave(IReltioAPI api, ILifeCycleObjectData data) {
    if (!isEligible(data) || relationAlreadyExists(api, data.getObject().getUri())) {
        return;
    }
    createRequiredRelation(api, data.getObject().getUri());
}
```

### 4. Pre-cleanse external lookup (`rawDataBeforeCleanse`)

Only place a bounded, required lookup before cleanse. Reject an invalid required value by throwing; return `data` when changed and `null` only when this hook intentionally makes no mutation:

```java
public ILifeCycleObjectData rawDataBeforeCleanse(IReltioAPI api, ILifeCycleObjectData data) {
    if (!isValidCode(api, data)) {
        throw new RuntimeException("CustomerCategory is not recognized.");
    }
    return null;
}
```

Latency-sensitive and optional enrichment belongs after save or in a separately designed process. Refer to KB-LCA-01 for time limits.

### 5. Notification/workflow (`afterSave`)

Initiate an external workflow or add a role only after a clear predicate, with a re-entrancy/idempotency guard:

```java
public void afterSave(IReltioAPI api, ILifeCycleObjectData data) {
    if (hasCandidateRole(data.getObject())) {
        return;
    }
    api.post("entities/" + data.getObject().getUri() + "/roles",
        "[{\"type\":\"configuration/roles/Candidate\"}]",
        Collections.emptyMap());
}
```

## 4. Attribute / nested / reference / relation cookbook

The following recipes use the helpers described in section 5. Imports are illustrative; place helpers in a project package such as `com.example.lca.common`.

### Read a simple attribute or lookup code

```java
IAttributes attributes = data.getObject().getAttributes();
String email = LcaAttributeUtils.getFirstStringValue(attributes, "Email");
String status = LcaAttributeUtils.getFirstLookupCode(attributes, "Status");
if (email == null) {
    api.logInfo("Email is not set for " + data.getObject().getUri());
}
```

### Add or replace a simple attribute

```java
String entityUri = data.getObject().getUri();
String entityId = entityUri.substring(entityUri.lastIndexOf('/') + 1);

ISimpleAttributeValue masterId = attributes.createSimpleAttributeValue("MasterId")
    .value(entityId)
    .uri("entities/" + entityId + "/attributes/MasterId/1")
    .build();
attributes.addAttributeValue(masterId);

// Prefer this null-safe helper when URI construction is not required:
LcaAttributeUtils.setOrAddSimpleAttribute(attributes, "MasterId", entityId);
```

Avoid adding duplicates on each retry. A `setOrAdd` helper should update an existing suitable simple value or add one when missing.

### Read a nested attribute

```java
List<IAttributeValue> identifiers = attributes.getAttributeValues("Identifiers");
if (identifiers != null) {
    for (IAttributeValue value : identifiers) {
        if (value instanceof INestedAttributeValue nested) {
            String type = LcaAttributeUtils.getNestedStringValue(nested, "Type");
            String id = LcaAttributeUtils.getNestedStringValue(nested, "ID");
            api.logInfo("Identifier has type=" + type + ", id present=" + (id != null));
        }
    }
}
```

### Add a nested attribute

```java
INestedAttributeValue phone = attributes.createNestedAttributeValue("Phone").build();
IAttributes phoneAttributes = (IAttributes) phone.getValue();

phoneAttributes.addAttributeValue(phoneAttributes.createSimpleAttributeValue("Number")
    .value("555-0100").build());
phoneAttributes.addAttributeValue(phoneAttributes.createSimpleAttributeValue("Type")
    .value("Mobile").build());

attributes.addAttributeValue(phone);
```

The parent nested value is not persisted until it is added to the outer `IAttributes` bag.

### Read a reference attribute

```java
List<IAttributeValue> addresses = attributes.getAttributeValues("Address");
if (addresses != null) {
    for (IAttributeValue value : addresses) {
        IReferenceAttributeValue address = LcaAttributeUtils.asReferenceValue(value);
        if (address == null) {
            continue;
        }
        String relationUri = address.getReferencedRelation().getObjectURI();
        String city = LcaAttributeUtils.getFirstStringValue(address.getValue(), "City");
        api.logInfo("Address relation=" + relationUri + ", city present=" + (city != null));
    }
}
```

Reference attributes are not simple values. Check the type before accessing their projected `IAttributes` and relation reference.

### Create or update a relation attribute

```java
// Derive the relation URI from a typed reference attribute (e.g. Address).
IReferenceAttributeValue addressReference = LcaAttributeUtils.asReferenceValue(
    LcaAttributeUtils.getFirstValue(attributes, "Address"));
if (addressReference == null) {
    return; // or skip — no address reference present
}
String relationUri = LcaRelationUtils.getRelationUri(addressReference);
String body = "[{\"value\":\"1\"}]";

// POST creates a new relation attribute value.
LcaRelationUtils.postRelationAttribute(api, relationUri, "RankOrder", body);

// PUT updates only when the exact attribute value URI is already known
// (for example, from a prior GET of the relation attributes).
String attributeId = "knownAttributeValueId"; // from relation attribute URI path
api.put(relationUri + "/attributes/RankOrder/" + attributeId,
    body, Collections.emptyMap());
```

Use `POST` to create and `PUT` only when the exact relation attribute URI is already known.

### Fetch relation endpoints and related entity data

```java
String startUri = LcaRelationUtils.getStartObjectUri(data);
String endUri = LcaRelationUtils.getEndObjectUri(data);

IObject startEntity = LcaRelationUtils.fetchEntity(
    api, startUri, "?select=attributes.RecordType");
String relationJson = api.get(relationUri, Collections.emptyMap());
```

The relation endpoint shape may differ from an entity payload. Use the relation helpers rather than assuming `data.getObject().getUri()` is an entity URI.

### Add a validation error

```java
public ILifeCycleValidationData validate(IReltioAPI api, ILifeCycleValidationData data) {
    IAttributes attrs = data.getObject().getAttributes();
    if (!LcaAttributeUtils.hasAttributeValues(attrs, "Email")) {
        LcaValidationUtils.addMissedAttributeError(
            data,
            "configuration/entityTypes/Customer/attributes/Email",
            data.getObject(),
            "Email is required.");
    }

    IAttributeValue status = LcaAttributeUtils.getFirstValue(attrs, "Status");
    if (status != null && "INVALID".equals(
            LcaAttributeUtils.getFirstStringValue(attrs, "Status"))) {
        data.addValidationError(
            ValidationError.incorrectAttribute(status, "Status value is not allowed."));
    }
    return data;
}
```

### Skip a rule for a merge

```java
public ILifeCycleObjectData beforeSave(IReltioAPI api, ILifeCycleObjectData data) {
    if (LcaRelationUtils.isMergeAction(data)) {
        return data;
    }
    if (data.getActionType() != ActionType.CREATE
            && data.getActionType() != ActionType.UPDATE) {
        return data;
    }
    // CREATE/UPDATE-only rule
    return data;
}
```

### Log safely

```java
api.logInfo("Processing " + data.getObject().getUri());
api.logWarning("Optional attribute missing: SecondaryId");
api.logError("Unable to complete enrichment step for " + data.getObject().getUri());
```

Do not use `System.out`, `printStackTrace`, or raw application loggers for normal LCA flow. Do not log entire payloads, sensitive field values, access tokens, or credentials in production.

### Make crosswalk-aware updates

```java
Map<String, ISimpleAttributeValue> valuesByUri = new HashMap<>();
List<IAttributeValue> npiValues = attributes.getAttributeValues("NPI");
if (npiValues != null) {
    for (IAttributeValue value : npiValues) {
        if (value instanceof ISimpleAttributeValue simple) {
            valuesByUri.put(simple.getUri(), simple);
        }
    }
}

for (ICrosswalk crosswalk : object.getCrosswalks().getCrosswalks()) {
    for (String uri : crosswalk.getAttributes().getAttributesURIs()) {
        ISimpleAttributeValue npi = valuesByUri.get(uri);
        if (npi != null) {
            api.logInfo("NPI belongs to crosswalk " + crosswalk.getValue());
        }
    }
}

ISimpleAttributeValue newNpi = attributes.createSimpleAttributeValue("NPI")
    .value("1234567890").build();
attributes.addAttributeValue(newNpi);
// Select the intended source by type in production; do not blindly select index zero.
```

Only attach a new value after selecting the intended crosswalk by source type. The value URI is the reliable join between attribute values and crosswalk attribute URI lists.

### Delete a relation without executing its LCA

```java
LcaRelationUtils.deleteRelation(api, relationUri, false);
```

The final `false` requests deletion with `executeLCA=false`. Use this deliberately: bypassing the relation lifecycle can skip governance or side effects.

## 5. Reusable helper APIs

The extracted sample library identifies three shared utilities: `LcaAttributeUtils` for null-safe attribute operations, `LcaRelationUtils` for relation extraction/API calls, and `LcaValidationUtils` for validation construction. The following condensed contracts are the evidenced methods a code-generation agent can recreate; keep implementations small and null-safe.

### `LcaAttributeUtils`

```java
public final class LcaAttributeUtils {
    static IAttributeValue getFirstValue(IAttributes attributes, String attributeName);
    static String getFirstStringValue(IAttributes attributes, String attributeName);
    static String getFirstLookupCode(IAttributes attributes, String attributeName);
    static boolean hasAttributeValues(IAttributes attributes, String attributeName);
    static String getNestedStringValue(INestedAttributeValue nested, String childName);
    static IReferenceAttributeValue asReferenceValue(IAttributeValue value);
    static void setOrAddSimpleAttribute(
        IAttributes attributes, String attributeName, String value);
}
```

Example:

```java
if (!LcaAttributeUtils.hasAttributeValues(attributes, "Status")) {
    LcaAttributeUtils.setOrAddSimpleAttribute(attributes, "Status", "Active");
}
String idType = LcaAttributeUtils.getNestedStringValue(identifier, "Type");
```

`getFirst...` methods should return `null` for missing or incompatible values rather than indexing a missing list. `asReferenceValue` should return `null` unless the input is an `IReferenceAttributeValue`.

### `LcaRelationUtils`

```java
public final class LcaRelationUtils {
    static String getRelationUri(IReferenceAttributeValue referenceValue);
    static String getStartObjectUri(ILifeCycleObjectData data);
    static String getEndObjectUri(ILifeCycleObjectData data);
    static IObject fetchEntity(IReltioAPI api, String entityUri, String selectQuery);
    static void postRelationAttribute(
        IReltioAPI api, String relationUri, String attributeName, String body);
    static boolean isMergeAction(ILifeCycleObjectData data);
    static void deleteRelation(IReltioAPI api, String relationUri, boolean executeLCA);
}
```

Example:

```java
if (!LcaRelationUtils.isMergeAction(data)) {
    IObject parent = LcaRelationUtils.fetchEntity(
        api, LcaRelationUtils.getStartObjectUri(data), "?select=attributes.RecordType");
}
```

`postRelationAttribute` encapsulates the relation attribute POST path; `deleteRelation` encapsulates the delete request and its `executeLCA` choice. Test their expected URI construction and headers with a mocked API.

### `LcaValidationUtils`

```java
public final class LcaValidationUtils {
    static void addMissedAttributeError(
        ILifeCycleValidationData data,
        String attributeTypeUri,
        IObjectWithURI parent,
        String message);
}
```

Example:

```java
LcaValidationUtils.addMissedAttributeError(
    data,
    "configuration/entityTypes/Customer/attributes/Email",
    data.getObject(),
    "Email is required.");
```

The helper should create and add the framework's `ValidationError.missedAttribute(...)`; it is not a substitute for returning `data`.

## 6. Input/Output contract

The usual object-hook envelope contains `object`, `environment`, `tenant`, and hook/token metadata. `object` includes `uri`, `type`, `attributes`, and `crosswalks`. Attributes are a map from short name to a list of value objects; values commonly carry `type`, `ov`, `value`, and `uri`. Crosswalks carry `type`, `value`, their attribute URIs, and provider information.

Merge input represents the winner and loser URIs. Reference-attribute input uses `entityURI`, `attributeName`, and `relation` rather than a normal `object`. Validation input additionally carries `validationErrors` and a `successful` result field.

```json
{
  "object": {
    "type": "{{typeURI}}",
    "attributes": { "{{Attribute_Values}}" },
    "crosswalks": [
      { "type": "{{crosswalkURI}}", "value": "{{crosswalkValue}}" }
    ]
  },
  "tenant": "{{tenantId}}",
  "environment": "https://{{environment}}.reltio.com/reltio",
  "token": "{{accessToken}}"
}
```

Example `beforeSave` input:

```json
{
  "object": {
    "uri": "entities/06G5oeG",
    "type": "configuration/entityTypes/HCP",
    "attributes": {
      "FirstName": [
        { "ov": true, "value": "John", "uri": ".../attributes/FirstName/oVSvuTY" }
      ],
      "LastName": [
        { "ov": true, "value": "Snow", "uri": ".../attributes/LastName/oVSvyjo" }
      ]
    },
    "crosswalks": [
      {
        "uri": ".../crosswalks/oVSw304",
        "type": "configuration/sources/Salesforce",
        "value": "06G5oeG",
        "attributes": [".../LastName/oVSvyjo", ".../FirstName/oVSvuTY"]
      }
    ]
  },
  "environment": "https://na1.reltio.com/reltio",
  "tenant": "MyTenantId",
  "hook": "beforeSave"
}
```

For a mutating hook, return the full modified data envelope; the platform persists its object state. A no-op may return the hook's expected no-op result, but never return `null` after making a mutation. `validate` returns its data with an empty or populated `validationErrors` list. Void post-event hooks have no response body to mutate.

Use §§17–26 below for the complete fixture catalog and hook-specific JSON shapes rather than manufacturing a payload from this abbreviated example.

## 7. Testing patterns

Test the handler logic, serialized lifecycle response, real fixture shapes, and deployment behavior. Keep the JaCoCo gate at **≥92% line coverage**; KB-LCA-06 contains its POM configuration.

### Test layers

| Layer | Tool/pattern | Goal |
|---|---|---|
| Unit | `reltio-lca-test-framework` + JUnit | Exercise hook decisions and mutation |
| Serialized contract | `LifecycleExecutor` + `JSONAssert` | Verify JSON-in / JSON-out behavior |
| Fixture based | `BaseTest` + `loadFromFile` | Preserve realistic payload shape |
| Integration | LCA service integration suite | Platform-level confidence |
| Post-deploy | Cloud invoke plus non-prod tenant action | Verify package, config, and persistence |

### `BaseTest` fixture template

```java
class BeforeSaveEntityActionTest extends BaseTest {
    private final BeforeSaveEntityAction action = new BeforeSaveEntityAction();

    @Test
    void defaultsStatusForCreateWhenMissing() throws Exception {
        ILifeCycleObjectData input = loadFromFile(
            "entities/beforesave/input-create-missing-status.json");

        ILifeCycleObjectData result = action.beforeSave(mockReltioAPI(), input);

        assertNotNull(result);
        assertEquals("Active",
            result.getObject().getAttributes()
                .getAttributeValues("Status").get(0).getValue());
    }
}
```

`loadFromFile(...)` paths are relative to `src/test/resources`, not the filesystem root. Organize fixtures by lifecycle scope:

```text
src/test/resources/
├── entities/beforesave/
├── entities/validate/
├── relations/beforesave/
└── merge/beforemerge/
```

Capture payloads from non-production logs, redact PII and tenant-specific data, then commit the sanitized fixture. fixture sections below provides fixture selection guidance.

### `LifecycleExecutor` and `JSONAssert`

Use `LifecycleExecutor` when the serialized contract matters:

```java
LifecycleExecutor executor = new LifecycleExecutor();
ILifeCycleAction handler = new FirstNameAppendAction();

String actual = executor.executeAction(
    handler,
    LifeCycleHook.beforeSave,
    "{\"object\":{\"uri\":\"entities/HCP.1\","
        + "\"attributes\":{\"FirstName\":[{\"value\":\"John\"}]}}}");

String expected = "{\"object\":{\"uri\":\"entities/HCP.1\","
    + "\"attributes\":{\"FirstName\":[{\"value\":\"John1\"}]},"
    + "\"crosswalks\":[]},\"successful\":true}";
JSONAssert.assertEquals(expected, actual, true);
```

Executor overloads accept an `IReltioAPI` when the test must exercise callback behavior. Use `JSONAssert` strict mode when the response structure is part of the contract. If an assertion fails, compare the actual response before editing expected JSON: executor-generated defaults such as empty `crosswalks`, roles, tags, or categories are a common mismatch source. Use lenient mode only when those unspecified fields are intentionally outside the test.

### Pass and fail tests for `validate`

Every validation rule needs both paths:

```java
@Test
void validateAddsErrorForInvalidNpi() throws Exception {
    ILifeCycleValidationData input = loadValidationFromFile(
        "entities/validate/input-invalid-npi.json");
    ILifeCycleValidationData result = action.validate(mockReltioAPI(), input);

    assertNotNull(result);
    assertFalse(result.getValidationErrors().isEmpty());
    assertTrue(result.getValidationErrors().stream()
        .anyMatch(error -> error.getMessage().contains("NPI")));
}

@Test
void validateReturnsNoErrorsForValidNpi() throws Exception {
    ILifeCycleValidationData input = loadValidationFromFile(
        "entities/validate/input-valid-npi.json");
    ILifeCycleValidationData result = action.validate(mockReltioAPI(), input);

    assertNotNull(result);
    assertTrue(result.getValidationErrors().isEmpty());
}
```

The tests must catch both a missing error and the more dangerous `null` return.

### Mock `IReltioAPI`

Use `mockReltioAPI()` from the test framework for a handler that fetches or updates Reltio:

```java
@Test
void enrichesFromLookup() throws Exception {
    IReltioAPI api = mockReltioAPI();
    // Stub the expected api.get(...) or api.getObject(...) response.

    ILifeCycleObjectData input = loadFromFile(
        "entities/beforesave/input-needs-lookup.json");
    ILifeCycleObjectData result = action.beforeSave(api, input);

    assertNotNull(result);
    // Assert the intended enrichment and API interaction.
}
```

Never call tenant APIs, put credentials, or use a real access token in a unit test.

### Required test matrix

Cover CREATE, UPDATE, MERGE, and SPLIT where relevant; absent and null attributes; empty string versus null; multiple crosswalks; OV and non-OV values; relation payloads; blocked merge behavior; and any `afterSave` re-entrancy guard. Add a test for each explicit business exception and each helper path that constructs a Reltio API URI.

### Post-deploy verification checklist

1. Invoke the deployed cloud endpoint with a sanitized captured payload.
2. Confirm HTTP success and `"successful": true` where the hook produces a response.
3. Apply hook configuration in a non-production tenant and trigger the matching UI/API operation.
4. Inspect the LCA/cloud logs for safe handler messages and unexpected exceptions.
5. Confirm expected attributes, crosswalk ownership, relation changes, or validation messages in Reltio.
6. Repeat the action when the handler has side effects to verify idempotency/re-entrancy behavior.

## 8. Common pitfalls

1. **Returning `null` after mutating a `before*` payload** — mutations are discarded. Return the modified `data`.
2. **Returning `null` from `validate`** — validation can silently pass through. Always return `data`.
3. **Writing the same entity in `afterSave` without a guard** — it can trigger recursive save cycles. Prefer `beforeSave`, or make the post-save path idempotent.
4. **Using `.get(0)` without a null/empty check** — missing fields and multiple crosswalks are ordinary payload conditions. Select sources by type, not list position.
5. **Casting every value to `ISimpleAttributeValue`** — nested and reference values have different models. Check with `instanceof`.
6. **Synchronous optional external calls before persistence** — they risk lifecycle timeouts. Keep pre-save calls bounded and essential; move optional work after save.
7. **Fetching a full object for one field** — use an API select query when possible.
8. **Swallowing exceptions** — log a safe diagnostic with the object URI and explicitly handle or rethrow the failure.
9. **Hardcoding credentials or manually obtaining tokens for ordinary callbacks** — `IReltioAPI` has the caller context. A separate machine identity is an explicit exceptional design.
10. **Logging payloads, tokens, or PII** — use concise `IReltioAPI` logging; reserve `logFullMessage`/`DefaultLcaWithLogger` for controlled development diagnosis.
11. **Generating IDs in `afterSave`** — a write-back can retrigger the lifecycle. Generate or default values in `beforeSave`.
12. **Using `RuntimeException` for normal field validation** — use `ValidationError` for structured UI feedback; reserve exceptions for genuine hard aborts.
13. **Non-idempotent post-event logic** — retries may duplicate relations, roles, or external notifications. Check existing state and use a stable idempotency key.
14. **Mixing entity and relation assumptions** — relation endpoint URIs and payload shapes require relation-specific helpers.
15. **Ignoring crosswalk ownership** — adding an attribute without associating it to the intended source can produce incorrect provenance.
16. **Jackson dependency drift** — use the exclusions and version pinning in KB-LCA-06; serialization conflicts often appear only after deployment.
17. **Testing only a hand-written minimal JSON payload** — use sanitized real fixtures and test the full envelope with `LifecycleExecutor`.
18. **Embedding tenant data in code or fixtures** — use placeholders and sanitized samples; keep configuration outside source.

See [KB-LCA-01](01_LCA_CORE_CONCEPTS_AND_HOOKS.md) for lifecycle choice and cloud restrictions, [KB-LCA-06](06_MAVEN_PROJECT_TEMPLATES.md) for build/deployment templates, §§10–16 of this document for production handler designs, and §§17–26 for fixtures.

## 9. How to use this catalog

1. Select the lifecycle concern and hook below, then adapt the condensed pattern to the tenant model.
2. Pair implementation details with earlier sections of this handbook (handler APIs, return contracts, and test examples), `KB-LCA-06` (Maven/cloud packaging), and §§17–26 (captured payload fixtures).
3. Validate null/empty inputs, attribute ownership, action type, and idempotency before making an API write.
4. Use `IReltioAPI` for platform calls; it accepts relative Reltio resource paths. Do not embed credentials or tenant URLs.

`beforeSave` and other mutation hooks return modified `data` only when changed; a no-op may return `null`. `validate` always returns its validation data. `afterSave`, `afterUnmerge`, and `afterDCRSave` are void side-effect hooks. Azure entry-point and deployment behavior has caveats: confirm `KB-LCA-01` §7 before committing to an Azure implementation.

## 10. Enrichment & ID generation patterns (`beforeSave`)

### Derive a display name

When `Name` is absent and `FirstName` plus `LastName` are meaningful, create `Name` from the two values and return `data`; otherwise return `null`. Associate the new value with the configured contributing crosswalk—not an arbitrary array position.

### Generate and own a UUID
When the OV `UniqueID` is absent, generate `UUID.randomUUID()` once and attach it to the intended LCA/source crosswalk. A generated value without explicit ownership can cause unexpected survivorship behavior.

### Allocate a sequential ID from a settings entity
Read the `CurrentSequence` from one dedicated `SystemSetting` entity, calculate the next value, contribute it under the LCA source, then persist the counter. Keep the setting URI and source URI in deployment configuration, not in code. This handler only allocates when the entity does not already have the ID, so a retry of a successfully-mutated callback does not allocate another number.

> **Concurrency warning:** a read/increment/write sequence is not an atomic counter. Two concurrent invocations can read the same value. Use this pattern only where that collision risk is acceptable or where invocation is serialized externally. For strict global uniqueness, allocate from an atomic external service or use a platform-supported reservation design. Do not claim that this sample “guarantees” uniqueness.

```java
private static final String MDM_ID = "MDM_ID";
private static final String SEQUENCE_ATTRIBUTE = "CurrentSequence";
private static final String SETTINGS_URI = "entities/SYSTEM_SETTING_URI"; // deployment configuration
private static final Map<String, String> LCA_HEADERS = Collections.singletonMap(
    "Source-System", "configuration/sources/LCA");

@Override
public ILifeCycleObjectData beforeSave(IReltioAPI api, ILifeCycleObjectData data) {
    IAttributes attrs = data.getObject().getAttributes();
    if (hasMeaningfulValue(attrs, MDM_ID)) {
        return null; // Idempotent: never replace an allocated/business ID.
    }

    IObject settings = api.getObject(SETTINGS_URI);
    Integer current = firstInteger(settings.getAttributes(), SEQUENCE_ATTRIBUTE);
    if (current == null) {
        throw new IllegalStateException(
            "System setting does not contain a numeric " + SEQUENCE_ATTRIBUTE);
    }

    int next = Math.addExact(current, 1);
    ISimpleAttributeValue assigned = attrs.createSimpleAttributeValue(MDM_ID)
        .value(String.valueOf(next))
        .build();
    attrs.addAttributeValue(assigned);

    // Attach to the configured LCA source only — never rely on crosswalk index.
    ICrosswalk lcaCrosswalk = findCrosswalkByType(
        data.getObject(), "configuration/sources/LCA");
    if (lcaCrosswalk == null) {
        throw new IllegalStateException("Configured LCA source crosswalk is missing");
    }
    lcaCrosswalk.getAttributes().addAttribute(assigned);

    try {
        String counterPatch = mapper.writeValueAsString(Map.of(
            "attributes", Map.of(SEQUENCE_ATTRIBUTE,
                Collections.singletonList(Map.of("value", String.valueOf(next))))));
        api.put(SETTINGS_URI, counterPatch, LCA_HEADERS);
    } catch (Exception e) {
        // Do not allow an ID to be returned when its reservation was not persisted.
        throw new IllegalStateException("Could not advance MDM ID counter", e);
    }
    return data;
}

private ICrosswalk findCrosswalkByType(IObject object, String sourceType) {
    if (object.getCrosswalks() == null || object.getCrosswalks().getCrosswalks() == null) {
        return null;
    }
    return object.getCrosswalks().getCrosswalks().stream()
        .filter(crosswalk -> sourceType.equals(crosswalk.getType()))
        .findFirst()
        .orElse(null);
}

private boolean hasMeaningfulValue(IAttributes attrs, String name) {
    List<IAttributeValue> values = attrs.getAttributeValues(name);
    if (values == null || values.isEmpty()) {
        return false;
    }
    return values.stream()
        .map(IAttributeValue::getValue)
        .filter(Objects::nonNull)
        .map(String::valueOf)
        .anyMatch(value -> !value.trim().isEmpty());
}

private Integer firstInteger(IAttributes attrs, String name) {
    List<IAttributeValue> values = attrs.getAttributeValues(name);
    if (values == null || values.isEmpty()) {
        return null;
    }
    return values.stream()
        .map(IAttributeValue::getValue)
        .filter(Objects::nonNull)
        .map(String::valueOf)
        .map(String::trim)
        .filter(value -> !value.isEmpty())
        .findFirst()
        .map(Integer::valueOf)
        .orElse(null);
}
```

Always associate generated values with the configured LCA crosswalk by `type`. Do not use `get(0)` for crosswalk selection; see `KB-LCA-02` for safe callback-object handling.

### Calculate a data-completeness score

Use `beforeSave` for a deterministic value derived only from the incoming object. The example writes a numeric `CompletenessScore` (0–100) and a readable `CompletenessStatus`, but avoids mutating the payload when both values already match. For a fuller data-quality score that requires an `afterSave` write-back source, use §6.

```java
private static final List<String> REQUIRED_SIMPLE = Arrays.asList(
    "FirstName", "LastName", "Email", "Country");

@Override
public ILifeCycleObjectData beforeSave(IReltioAPI api, ILifeCycleObjectData data) {
    IAttributes attrs = data.getObject().getAttributes();
    int completed = 0;

    for (String name : REQUIRED_SIMPLE) {
        if (hasMeaningfulValue(attrs, name)) {
            completed++;
        }
    }
    if (hasPhoneNumber(attrs)) {
        completed++;
    }

    int possible = REQUIRED_SIMPLE.size() + 1;
    int score = (completed * 100) / possible;
    String status = score == 100 ? "Complete" : "Incomplete";

    boolean scoreChanged = setFirstSimpleValue(attrs, "CompletenessScore",
        String.valueOf(score));
    boolean statusChanged = setFirstSimpleValue(attrs, "CompletenessStatus", status);
    return scoreChanged || statusChanged ? data : null;
}

private boolean hasPhoneNumber(IAttributes attrs) {
    List<IAttributeValue> phones = attrs.getAttributeValues("Phone");
    if (phones == null || phones.isEmpty()) {
        return false;
    }
    return phones.stream()
        .map(IAttributeValue::getValue)
        .filter(IAttributes.class::isInstance)
        .map(IAttributes.class::cast)
        .flatMap(phone -> {
            List<IAttributeValue> numbers = phone.getAttributeValues("Number");
            return numbers == null ? Stream.empty() : numbers.stream();
        })
        .map(IAttributeValue::getValue)
        .filter(Objects::nonNull)
        .map(String::valueOf)
        .anyMatch(value -> !value.trim().isEmpty());
}

private boolean setFirstSimpleValue(IAttributes attrs, String name, String required) {
    List<IAttributeValue> values = attrs.getAttributeValues(name);
    if (values == null || values.isEmpty()) {
        attrs.addAttributeValue(attrs.createSimpleAttributeValue(name)
            .value(required).build());
        return true;
    }
    IAttributeValue first = values.get(0);
    if (!(first instanceof ISimpleAttributeValue current)) {
        return false; // Nested/reference values must use typed helpers, not this path.
    }
    if (!required.equals(String.valueOf(current.getValue()))) {
        current.setValue(required);
        return true;
    }
    return false;
}
```

### Normalize names in the save path

This is appropriate only for a simple, tenant-approved normalization rule. It preserves Unicode letters and digits, collapses whitespace, and changes a value only when normalization produces a nonblank replacement. The hook does not make a source value “better” by inventing data.

```java
@Override
public ILifeCycleObjectData beforeSave(IReltioAPI api, ILifeCycleObjectData data) {
    IAttributes attrs = data.getObject().getAttributes();
    boolean changed = false;

    for (IAttributeValue rawValue : attrs.getAttributeValues("Name")) {
        if (!(rawValue instanceof ISimpleAttributeValue)) {
            continue;
        }
        ISimpleAttributeValue name = (ISimpleAttributeValue) rawValue;
        String original = name.getStringValue();
        String normalized = normalizeName(original);
        if (normalized != null && !normalized.equals(original)) {
            name.setValue(normalized);
            changed = true;
        }
    }
    return changed ? data : null;
}

private String normalizeName(String input) {
    if (input == null) {
        return null;
    }
    String normalized = input.trim()
        .replaceAll("\\s+", " ")
        .replaceAll("[^\\p{L}\\p{N} .,'&-]", "");
    return normalized.isEmpty() ? input : normalized;
}
```

### Default an attribute only for the relevant action

Action type is part of the lifecycle contract. Default on `CREATE` only when the business rule must not overwrite values on a normal update, merge, or split.

```java
@Override
public ILifeCycleObjectData beforeSave(IReltioAPI api, ILifeCycleObjectData data) {
    if (data.getActionType() != ActionType.CREATE) {
        return null;
    }

    IAttributes attrs = data.getObject().getAttributes();
    if (hasMeaningfulValue(attrs, "Status")) {
        return null;
    }

    attrs.addAttributeValue(attrs.createSimpleAttributeValue("Status")
        .value("Pending")
        .build());
    return data;
}
```

### Prevent a duplicate identifier before save

Perform the check only for creates and only after validating that the identifier has an allowed form. Build the API request with URL encoding; string concatenation makes filter syntax and injection handling unreliable. The handler excludes its own URI defensively, although a create normally has no persisted URI.

```java
@Override
public ILifeCycleObjectData beforeSave(IReltioAPI api, ILifeCycleObjectData data) {
    if (data.getActionType() != ActionType.CREATE) {
        return null;
    }
    String npi = firstString(data.getObject().getAttributes(), "NPI");
    if (npi == null) {
        return null; // Requiredness belongs in the model or validate hook.
    }
    if (!npi.matches("\\d{10}")) {
        throw new IllegalArgumentException("NPI must contain exactly 10 digits");
    }

    try {
        String filter = "equals(attributes.NPI,'" + npi + "')";
        String path = "entities?filter=" + URLEncoder.encode(filter, StandardCharsets.UTF_8)
            + "&select=uri&limit=2";
        List<Map<String, Object>> matches = mapper.readValue(
            api.get(path, Collections.emptyMap()), new TypeReference<List<Map<String, Object>>>() {});

        String currentUri = data.getObject().getUri();
        boolean duplicate = matches.stream()
            .map(match -> String.valueOf(match.get("uri")))
            .anyMatch(uri -> !uri.equals(currentUri));
        if (duplicate) {
            throw new IllegalStateException("A record already exists for NPI " + npi);
        }
    } catch (IOException e) {
        // Make the availability policy explicit. Fail closed for a uniqueness gate.
        throw new IllegalStateException("Duplicate check could not be completed", e);
    }
    return null;
}

private String firstString(IAttributes attrs, String name) {
    List<IAttributeValue> values = attrs.getAttributeValues(name);
    if (values == null || values.isEmpty()) {
        return null;
    }
    return values.stream()
        .map(IAttributeValue::getValue)
        .filter(Objects::nonNull)
        .map(String::valueOf)
        .map(String::trim)
        .filter(value -> !value.isEmpty())
        .findFirst()
        .orElse(null);
}
```

For tenant-level uniqueness and simultaneous creates, prefer a match rule or centrally enforced service. A lookup-before-create LCA alone is also subject to a race.

### Additional enrichment variants
- Generate `PartyId` only when it is absent or `ActionType` is `MERGE`/`SPLIT`; use a governed allocator, never a timestamp where uniqueness matters.
- Derive an ID from the final URI segment only when that is an explicit tenant master-ID rule and no contributed ID exists.
- For each nested `Addresses` `IAttributes` value, default a missing `AddressType` (for example, `Office`) and attach it to the configured owner. The same shape applies to `beforeSave` on a relationship type.

## 11. Validation patterns (`validate` / `rawDataBeforeCleanse`)

### Attribute and multi-field validation

Use `ValidationError` in `validate` so callers receive structured, attribute-level messages. Add every applicable error and always return `data`.

```java
List<IAttributeValue> firstNames = data.getObject().getAttributes()
    .getAttributeValues("FirstName");
if (!firstNames.isEmpty() && String.valueOf(firstNames.get(0).getValue()).startsWith("#")) {
    data.addValidationError(ValidationError.incorrectAttribute(
        firstNames.get(0), "FirstName cannot start with '#'"));
}
// Compare StartDate and EndDate only when both values exist.
return data;
```

For cross-attribute rules, read both values first—for example `StartDate` must not be after `EndDate`, or a selected country must permit the supplied state/province—then attach the error to the value the user must correct.

### Validate coordinated date and geographic values

One `validate` invocation can report several corrections at once. This example attaches each error to the value the steward should change. It treats a missing optional partner value as outside the rule; model requiredness should enforce mandatory fields.

```java
@Override
public ILifeCycleValidationData validate(IReltioAPI api, ILifeCycleValidationData data) {
    IAttributes attrs = data.getObject().getAttributes();
    IAttributeValue start = firstValue(attrs, "StartDate");
    IAttributeValue end = firstValue(attrs, "EndDate");

    LocalDate startDate = toLocalDate(start);
    LocalDate endDate = toLocalDate(end);
    if (startDate != null && endDate != null && startDate.isAfter(endDate)) {
        data.addValidationError(ValidationError.incorrectAttribute(
            start, "StartDate must be on or before EndDate"));
    }

    IAttributeValue country = firstValue(attrs, "Country");
    IAttributeValue state = firstValue(attrs, "StateProvince");
    if (country != null && state != null
            && "US".equalsIgnoreCase(String.valueOf(country.getValue()))
            && !String.valueOf(state.getValue()).matches("[A-Z]{2}")) {
        data.addValidationError(ValidationError.incorrectAttribute(
            state, "StateProvince must be a two-letter US state code when Country is US"));
    }
    return data;
}

private IAttributeValue firstValue(IAttributes attrs, String name) {
    return attrs.getAttributeValues(name).stream().findFirst().orElse(null);
}

private LocalDate toLocalDate(IAttributeValue value) {
    if (value == null || value.getValue() == null) {
        return null;
    }
    try {
        return LocalDate.parse(String.valueOf(value.getValue()));
    } catch (DateTimeParseException invalidDate) {
        return null; // The model/date validator reports malformed values.
    }
}
```

### Block a prohibited delete

`beforeDelete` is a gate, not a UI validation hook. Inspect the OV `Status`; throw only when the deletion must be aborted.

```java
boolean live = data.getObject().getAttributes().getAttributeValues("Status").stream()
    .filter(IAttributeValue::isOv)
    .anyMatch(a -> "Live".equals(a.getValue()));
if (live) throw new RuntimeException("Live entities cannot be deleted");
return data;
```

### Verify country or eligibility before merge

The merge payload gives the winner object and loser URIs. Load only the required loser fields using `entities/_byUris`, compare them to the winner's OV values, and abort when the governance rule fails. Treat missing country as an explicit policy decision, not as a match.

```java
Map<String, Object> request = Map.of("select", "uri,type,attributes.Country",
    "uris", data.getLoserURIs(), "options", "ovOnly");
String losersJson = api.post("entities/_byUris",
    mapper.writeValueAsString(request), Collections.emptyMap());
// Deserialize response, compare each loser Country to the winner Country, then throw to abort.
return data;
```

### External lookup checks

For a UI-visible validation result, call the lookup/registry from `validate` and add `ValidationError` entries. For a pre-cleanse hard gate, use `rawDataBeforeCleanse`: load lookup codes through `IReltioAPI`, reject unknown input, and return `null` on pass-through. Distinguish a business rejection from an unavailable dependency in logs and error handling.

### Validate duplicate and conditional rules

Run duplicate checks only for the relevant action (commonly `CREATE`) and only when the identifier is supplied. Also use `validate` for compound rules such as conditional required relations, product-family/status combinations, membership dates, and coordinated contact fields.

## 12. Merge / Unmerge / Match patterns

### Merge governance

`beforeMerge` is the place for same-country, same-type, or other eligibility checks. Use `getWinner()` and `getLoserURIs()`; do not assume loser attributes are contained in the envelope. Return the merge data on success and throw to prevent an invalid merge.

### Re-identify an unmerged spawn

`afterUnmerge` receives the spawned URI. If present, generate or allocate a new master ID and update that object under the intended LCA source. This must be idempotent because retry behavior can occur.

```java
String spawnUri = data.getSpawnURI();
if (spawnUri == null || spawnUri.trim().isEmpty()) {
    return;
}

IObject spawned = api.getObject(spawnUri);
if (hasMeaningfulValue(spawned.getAttributes(), "MDM_ID")) {
    return; // A retry must not replace the new ID.
}

String newId = UUID.randomUUID().toString();
String body = mapper.writeValueAsString(Map.of("attributes", Map.of("MDM_ID",
    Collections.singletonList(Map.of("value", newId)))));
api.put(spawnUri, body,
    Collections.singletonMap("Source-System", "configuration/sources/LCA"));
```

### Match-pair hooks

Potential-match and manual-match hooks are URI-oriented. Fetch full records only when needed, then use before hooks for approval/veto policies and after hooks for auditing or downstream notifications. Do not perform merge business logic solely from a match-pair notification.

## 13. Reference attribute & relation patterns

### Restrict an added reference attribute

`beforeReferenceAttributeAdded` provides `getEntityURI()`, `getAttributeName()`, and the relation. Enforce required relation attributes or disallowed values before the reference is added.

```java
List<IAttributeValue> types = data.getRelation().getAttributes()
    .getAttributeValues("AddressType");
if (types.isEmpty()) throw new RuntimeException("AddressType is required");
if ("PO Box".equals(types.get(0).getValue())) {
    throw new RuntimeException("PO Box addresses are not allowed as primary addresses");
}
```

### Rank referenced addresses from a custom flag

Run this after the reference attribute is changed. The sample promotes every DSR-approved relation to rank `1` and removes rank `1` from non-approved relations. Replace the endpoint and patch shape with the tenant’s relation-update contract, and include only state-changing requests.

```java
@Override
public void afterReferenceAttributeChanged(IReltioAPI api,
                                           ILifeCycleReferenceAttributeData data) {
    IObject entity = api.getObject(data.getEntityURI());
    Map<String, String> headers = Collections.singletonMap(
        "Source-System", "configuration/sources/LCA_Rank");

    for (IAttributeValue value : entity.getAttributes().getAttributeValues("Address")) {
        if (!(value instanceof IReferenceAttributeValue)) {
            continue;
        }
        IReferenceAttributeValue address = (IReferenceAttributeValue) value;
        IAttributes relationAttrs = address.getValue();
        boolean approved = "true".equalsIgnoreCase(firstString(relationAttrs, "DSRCheckBox"));
        String currentRank = firstString(relationAttrs, "PrimaryRank");
        String desiredRank = approved ? "1" : null;

        if (Objects.equals(currentRank, desiredRank)) {
            continue;
        }
        try {
            String body = buildRankPatch(address.getUri(), desiredRank);
            api.put("relations/" + address.getUri(), body, headers);
        } catch (Exception e) {
            api.logError("Could not rank address relation " + address.getUri()
                + " for " + data.getEntityURI() + ": " + e.getMessage());
        }
    }
}

private String buildRankPatch(String relationUri, String rank) throws JsonProcessingException {
    Map<String, Object> attrs = rank == null ? Collections.emptyMap() : Map.of(
        "PrimaryRank", Collections.singletonList(Map.of("value", rank)));
    return mapper.writeValueAsString(Map.of("uri", relationUri, "attributes", attrs));
}
```

If exactly one primary address is required, select one deterministic winner (for example, approved addresses then a business timestamp) rather than assigning rank `1` to every eligible address.

### Rank addresses and apply source priority

After a relation/reference change or entity save, load reference values, classify each by relation crosswalk source, and update ranking or ignore state only when the desired state differs. Rank high-priority qualifying addresses first; apply source-priority governance only when both high- and low-priority contributions exist. Avoid writes in loops without idempotency checks.

### Auto-create inferred relations

In `afterSave`, first verify the entity type and source attributes. Search candidate endpoints, check `relations/getByObjectUris` for an existing relation of the target type, then create only missing relations. Log failures with the entity URI; do not let one candidate prevent independent candidates from being processed.

### Enforce relation sort order

When `beforeSave` is configured on a relation type, fetch or inspect sibling relations and reject duplicate sort-order values. Exclude the current relation/update and merge-specific cases where appropriate.

## 14. After-save side effects

### Assign roles and initiate workflow

`afterSave` runs after persistence. Check whether the entity already has the required role, add a default role only when absent, then invoke the workflow endpoint. Keep external calls idempotent and include the entity URI in logs.

```java
@Override
public void afterSave(IReltioAPI api, ILifeCycleObjectData data) {
    IObject entity = data.getObject();
    if (entity == null || entity.getUri() == null || !isCandidate(entity)) {
        return;
    }

    try {
        if (!hasRole(entity, "Candidate")) {
            String roleRequest = mapper.writeValueAsString(Collections.singletonList(
                Map.of("type", "configuration/roles/Candidate")));
            api.post(entity.getUri() + "/roles", roleRequest, Collections.emptyMap());
        }

        // The receiving workflow must deduplicate by this stable business event key.
        String event = mapper.writeValueAsString(Map.of(
            "eventKey", "candidate-workflow:" + entity.getUri(),
            "entityUri", entity.getUri(),
            "eventType", "CandidateCreated"));
        api.post("external/workflow/initiate", event,
            Collections.singletonMap("Content-Type", "application/json"));
        api.logInfo("Submitted candidate workflow for " + entity.getUri());
    } catch (Exception e) {
        // Persisted entity remains valid; route retries/alerts through operations policy.
        api.logError("Workflow initiation failed for " + entity.getUri() + ": " + e.getMessage());
    }
}

private boolean isCandidate(IObject entity) {
    return "configuration/entityTypes/Person".equals(entity.getType())
        && "Candidate".equals(firstString(entity.getAttributes(), "LifecycleStage"));
}

private boolean hasRole(IObject entity, String role) {
    return entity.getRoles() != null
        && entity.getRoles().getRoles().stream()
            .anyMatch(value -> role.equals(String.valueOf(value)));
}
```

### Start a DCR workflow

Configure `afterDCRSave` on the change-request type. Serialize only the required DCR context and notify the approved downstream case/workflow system. Catch and log integration failures where the DCR must remain persisted despite notification failure.

```java
@Override
public void afterDCRSave(IReltioAPI api, ILifeCycleChangeRequestData data) {
    try {
        // Allowlist only approved, non-PII context — never data.toMap() for external systems.
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("eventType", "DCRSubmitted");
        payload.put("tenant", data.getTenant());
        payload.put("environment", data.getEnvironment());
        // Add only other destination-approved non-PII fields (e.g. DCR URI) after fixture review.

        String body = mapper.writeValueAsString(payload);
        api.post("external/ticketing/create-case", body,
            Collections.singletonMap("Content-Type", "application/json"));
        api.logInfo("Submitted DCR workflow for tenant " + data.getTenant());
    } catch (Exception e) {
        // Never throw if DCR persistence must survive a notification outage.
        api.logError("DCR workflow notification failed: " + e.getMessage());
    }
}
```

Do not send entire DCR payloads to an external system unless its data classification, access control, and retention policy have been approved. Earlier sections of this handbook cover deployable handler structure; validate the actual DCR fixture against §§17–26.

### Govern lower-priority address sources

If both trusted and lower-trust address contributions exist, mark only the lower-trust ones ignored. First classify all values, then write only the relations whose ignore state must change. The concrete API route for ignore state differs by model/API version, so keep the request builder isolated and verify it against the tenant fixture.

```java
private static final Set<String> HIGH_PRIORITY_SOURCES = Set.of("configuration/sources/HMS",
    "configuration/sources/Veeva", "configuration/sources/Reltio");
@Override
public void afterSave(IReltioAPI api, ILifeCycleObjectData data) {
    List<IAttributeValue> addressValues = data.getObject().getAttributes()
        .getAttributeValues("Address");
    if (addressValues == null || addressValues.isEmpty()) {
        return;
    }
    List<IReferenceAttributeValue> addresses = addressValues.stream()
        .filter(IReferenceAttributeValue.class::isInstance)
        .map(IReferenceAttributeValue.class::cast)
        .collect(Collectors.toList());
    if (addresses.size() < 2 || !addresses.stream().anyMatch(this::isHighPriority)) return;
    Map<String, String> headers = Collections.singletonMap("Source-System",
        "configuration/sources/LCA_Governance");
    for (IReferenceAttributeValue address : addresses) {
        if (isHighPriority(address) || Boolean.parseBoolean(
                firstString(address.getValue(), "Ignored"))) continue;
        try {
            // executeLCA=false prevents this write-back from re-entering LCA hooks.
            api.put("relations/" + address.getUri() + "/ignore?executeLCA=false",
                "{\"value\":true}", headers);
            api.logInfo("Ignored lower-priority address relation " + address.getUri());
        } catch (Exception e) {
            api.logError("Could not govern address " + address.getUri() + ": " + e.getMessage());
        }
    }
}
private boolean isHighPriority(IReferenceAttributeValue address) {
    return address.getReferencedRelation().getCrosswalks().getCrosswalks().stream()
        .map(ICrosswalk::getType)
        .anyMatch(HIGH_PRIORITY_SOURCES::contains);
}
```

### Write back data-quality scores safely

Compute the score from explicit rules and write under a dedicated DQ crosswalk/source. Guard re-entry by object URI and release the guard in `finally`; otherwise the write-back's own save can recursively trigger `afterSave`.

```java
private final Set<String> inProgress = new ConcurrentSkipListSet<>();

public void afterSave(IReltioAPI api, ILifeCycleObjectData data) {
    String uri = data.getObject().getUri();
    if (!inProgress.add(uri)) return;
    try {
        IAttributes attrs = data.getObject().getAttributes();
        int score = calculateScore(attrs);
        String current = firstString(attrs, "DQScore");
        if (String.valueOf(score).equals(current)) return;

        String patch = mapper.writeValueAsString(Map.of("attributes", Map.of("DQScore",
            Collections.singletonList(Map.of("value", String.valueOf(score))))));
        api.put(uri + "?executeLCA=false", patch, Collections.singletonMap(
            "Source-System", "configuration/sources/DQService"));
    } finally {
        inProgress.remove(uri);
    }
}

private int calculateScore(IAttributes attrs) {
    int score = 100;
    if (!hasMeaningfulValue(attrs, "Genre")) score -= 20;
    if (!hasMeaningfulValue(attrs, "Name")) score -= 30;
    if (!hasMeaningfulValue(attrs, "Country")) score -= 20;
    if (!hasPhoneNumber(attrs)) score -= 30;
    return Math.max(score, 0);
}
```

The in-memory set prevents recursion only within one warm function instance. Use the dedicated DQ source plus a state-difference check as the durable protection. If a platform invocation can occur on another instance before the first one completes, design the write path to remain idempotent.

### Auto-create relations from name matching

This pattern is useful only when matching is deterministic enough for an automated relation. The example targets Campaigns, searches candidate Brands, checks relation existence for each candidate, and isolates failures per candidate so one bad record does not block the rest.

```java
private static final String CAMPAIGN_TYPE = "configuration/entityTypes/Campaign";
private static final String BRAND_TYPE = "configuration/entityTypes/Brand";
private static final String RELATION_TYPE = "configuration/relationTypes/CampaignProductRel";
@Override
public void afterSave(IReltioAPI api, ILifeCycleObjectData data) {
    IObject campaign = data.getObject();
    if (!CAMPAIGN_TYPE.equals(campaign.getType())) return;
    String campaignName = firstString(campaign.getAttributes(), "Name");
    if (campaignName == null) return;
    try {
        String filter = "equals(type,'" + BRAND_TYPE + "')";
        String response = api.get("entities?filter="
            + URLEncoder.encode(filter, StandardCharsets.UTF_8)
            + "&select=uri,attributes.Name&limit=200", Collections.emptyMap());
        List<Map<String, Object>> brands = mapper.readValue(response,
            new TypeReference<List<Map<String, Object>>>() {});
        for (Map<String, Object> brand : brands) {
            String brandUri = (String) brand.get("uri");
            String brandName = extractFirstAttributeValue(brand, "Name");
            if (brandUri == null || brandName == null || !campaignName.contains(brandName.trim())) continue;
            ensureRelation(api, campaign.getUri(), brandUri);
        }
    } catch (Exception e) {
        api.logError("Name-match relation search failed for " + campaign.getUri() + ": " + e.getMessage());
    }
}
private void ensureRelation(IReltioAPI api, String campaignUri, String brandUri) throws Exception {
    Map<String, String> headers = Collections.singletonMap("Content-Type", "application/json");
    String lookup = mapper.writeValueAsString(Map.of(
        "objectUris", Arrays.asList(campaignUri, brandUri),
        "relationTypes", Collections.singletonList(RELATION_TYPE)));
    List<?> existing = mapper.readValue(api.post("relations/getByObjectUris", lookup, headers), List.class);
    if (!existing.isEmpty()) return;
    String create = mapper.writeValueAsString(Collections.singletonList(Map.of(
        "type", RELATION_TYPE,
        "startObject", Map.of("objectURI", campaignUri),
        "endObject", Map.of("objectURI", brandUri),
        "crosswalks", Collections.singletonList(Map.of(
            "type", "configuration/sources/LCA",
            "value", campaignUri + "|" + brandUri)))));
    api.post("relations", create, headers);
    api.logInfo("Created inferred relation for " + campaignUri + " and " + brandUri);
}
@SuppressWarnings("unchecked")
private String extractFirstAttributeValue(Map<String, Object> object, String name) {
    Object rawAttributes = object.get("attributes");
    if (!(rawAttributes instanceof Map)) return null;
    Object rawValues = ((Map<String, Object>) rawAttributes).get(name);
    if (!(rawValues instanceof List) || ((List<?>) rawValues).isEmpty()) return null;
    Object first = ((List<?>) rawValues).get(0);
    return first instanceof Map ? String.valueOf(((Map<?, ?>) first).get("value")) : null;
}
```

## 15. Pattern index
| Business need | Hook | Section | Complexity | Red flags |
|---|---|---:|---|---|
| Derive full name or defaults | `beforeSave` | 2 | Low | Missing ownership/crosswalk |
| UUID, URI, or sequential ID | `beforeSave` | 2 | Medium | Counter race, overwrite |
| Completeness score / name normalization | `beforeSave` | 2 | Low–Medium | Rewrites OV values unexpectedly |
| Create-only default / duplicate lookup | `beforeSave` | 2 | Medium | Race, filter escaping |
| Field and cross-field rules | `validate` | 3 | Low–Medium | Throwing ordinary validation |
| Reject delete | `beforeDelete` | 3 | Low | Unclear policy message |
| Merge eligibility | `beforeMerge` | 3–4 | Medium | Loading too much data |
| Spawn ID after split | `afterUnmerge` | 4 | Medium | Non-idempotent update |
| Reference restriction / custom ranking | Reference hooks | 5 | Medium | Multiple primary ranks |
| Inferred relation creation | `afterSave` | 5 | High | No existence check |
| Source-priority address governance | `afterSave` | 6 | High | Repeated ignore-state writes |
| Roles, workflow, DCR notification | `afterSave` / `afterDCRSave` | 6 | Medium | Duplicate external events |
| DQ score write-back | `afterSave` | 6 | High | Recursive invocation |

## 16. Red flags: never copy from legacy samples
- **Positional crosswalk ownership:** never attach generated values to `crosswalks().get(0)` unless the tenant has explicitly established that invariant. Locate the configured owner.
- **Unguarded `afterSave` write-back:** a save triggered by a write-back can invoke the same hook again. Use a re-entrancy guard, a dedicated source, and a state-difference check.
- **JSON string parsing of handler payloads:** use `IObject`, `IAttributes`, `IAttributeValue`, and lifecycle data interfaces for the callback payload. Serialize/parse only when an API endpoint requires a JSON request or response.
- **`RuntimeException` for ordinary validation:** use `ValidationError` in `validate` for field and business-rule feedback. Reserve throwing for true abort/gate scenarios such as prohibited deletion, failed merge governance, or pre-cleanse rejection.
- **Assuming lookup-before-create is unique:** an LCA search followed by a save is not atomic. Use a match rule or central allocator where duplicates are unacceptable.
- **Sending unfiltered DCR data externally:** minimize fields, protect endpoint access, and confirm retention obligations before notifying a workflow or ticket system.

## 17. Payload envelope & common fields

Each invocation has an envelope with platform context plus a lifecycle-specific body. Entity and relation values are represented as attribute-name maps whose values are arrays. An `ov: true` value is the operational/surviving value. A crosswalk's `attributes` list records the attribute value URIs contributed by that source.

| Field | Meaning |
|---|---|
| `object.uri` / `object.type` | Relative object URI and configuration type URI |
| `object.attributes` | Attribute name → array of values |
| `object.crosswalks` | Source contributions and their owned attributes |
| `environment`, `tenant`, `hook` | Platform context and lifecycle hook |
| `validationErrors`, `successful` | Validation-only result context |
| `losers` | `beforeMerge` loser entity URIs |
| `entityURI`, `attributeName`, `relation` | Reference-attribute hook context |

Handler contracts are in `KB-LCA-02`; use these payloads as JSON fixtures rather than parsing the handler callback body yourself.

## 18. `beforeSave` create/update fixtures

### Create request

```json
{
  "object": {
    "uri": "entities/06G5oeG",
    "type": "configuration/entityTypes/HCP",
    "attributes": {
      "FirstName": [{
        "type": "configuration/entityTypes/HCP/attributes/FirstName",
        "ov": true,
        "value": "John",
        "uri": "entities/06G5oeG/attributes/FirstName/oVSvuTY"
      }],
      "LastName": [{
        "type": "configuration/entityTypes/HCP/attributes/LastName",
        "ov": true,
        "value": "Snow",
        "uri": "entities/06G5oeG/attributes/LastName/oVSvyjo"
      }]
    },
    "isFavorite": false,
    "crosswalks": [{
      "uri": "entities/06G5oeG/crosswalks/oVSw304",
      "type": "configuration/sources/Salesforce",
      "value": "06G5oeG",
      "reltioLoadDate": "2024-04-08T14:15:50.481+00:00",
      "createDate": "2024-04-08T14:15:50.481+00:00",
      "updateDate": "2024-04-08T14:15:50.481+00:00",
      "attributes": [
        "entities/06G5oeG/attributes/LastName/oVSvyjo",
        "entities/06G5oeG/attributes/FirstName/oVSvuTY"
      ],
      "singleAttributeUpdateDates": {}
    }],
    "label": "",
    "secondaryLabel": ""
  },
  "environment": "https://na1.reltio.com/reltio",
  "tenant": "MyTenantId",
  "hook": "beforeSave"
}
```

### Mutated response with crosswalk ownership

Return the full modified object when the handler adds `Name`. The new attribute must be listed in the crosswalk that owns it.

```json
{
  "object": {
    "uri": "entities/06G5oeG",
    "type": "configuration/entityTypes/HCP",
    "attributes": {
      "FirstName": [{
        "type": "configuration/entityTypes/HCP/attributes/FirstName",
        "ov": true, "value": "John",
        "uri": "entities/06G5oeG/attributes/FirstName/oVSvuTY"
      }],
      "LastName": [{
        "type": "configuration/entityTypes/HCP/attributes/LastName",
        "ov": true, "value": "Snow",
        "uri": "entities/06G5oeG/attributes/LastName/oVSvyjo"
      }],
      "Name": [{
        "type": "configuration/entityTypes/HCP/attributes/Name",
        "value": "John Snow"
      }]
    },
    "crosswalks": [{
      "uri": "entities/06G5oeG/crosswalks/oVSw304",
      "type": "configuration/sources/Salesforce",
      "value": "06G5oeG",
      "attributes": [
        "entities/06G5oeG/attributes/LastName/oVSvyjo",
        "entities/06G5oeG/attributes/FirstName/oVSvuTY",
        "entities/06G5oeG/attributes/Name/NEW_URI"
      ]
    }]
  }
}
```

For a no-op `beforeSave`, return HTTP 200 with an empty body or `{}`; the original object is persisted. An update uses the same envelope and fixture structure, with existing attribute/crosswalk URIs and the appropriate action reflected by the lifecycle data model.

## 19. `validate` fixtures

### Request

```json
{
  "environment": "https://na1.reltio.com/reltio",
  "acceptLanguage": ["en-us", "en"],
  "hook": "validate",
  "validationErrors": [],
  "type": "configuration/entityTypes/HCP",
  "tenant": "MyTenantId",
  "object": {
    "uri": "entities/1dvqj8Yx",
    "type": "configuration/entityTypes/HCP",
    "attributes": {
      "FirstName": [{
        "type": "configuration/entityTypes/HCP/attributes/FirstName",
        "ov": true, "value": "#John1",
        "uri": "entities/1dvqj8Yx/attributes/FirstName/562VGIwVL"
      }],
      "LastName": [{
        "type": "configuration/entityTypes/HCP/attributes/LastName",
        "ov": true, "value": "#Kenn",
        "uri": "entities/1dvqj8Yx/attributes/LastName/562VGJ0lb"
      }]
    },
    "crosswalks": [{
      "uri": "entities/1dvqj8Yx/crosswalks/562VGJyRD",
      "type": "configuration/sources/Reltio",
      "value": "1dvqj8Yx",
      "dataProvider": true
    }]
  },
  "successful": true
}
```

### Multi-error response

```json
{
  "validationErrors": [
    {
      "errorType": "INCORRECT",
      "objectUri": "entities/1dvqj8Yx/attributes/FirstName/562VGIwVL",
      "objectTypeUri": "configuration/entityTypes/HCP/attributes/FirstName",
      "message": "FirstName cannot start with '#'",
      "severity": "ERROR"
    },
    {
      "errorType": "INCORRECT",
      "objectUri": "entities/1dvqj8Yx/attributes/LastName/562VGJ0lb",
      "objectTypeUri": "configuration/entityTypes/HCP/attributes/LastName",
      "message": "LastName cannot start with '#'",
      "severity": "ERROR"
    }
  ],
  "successful": true
}
```

## 20. `beforeDelete` block fixture

```json
{
  "environment": "https://na1.reltio.com/reltio",
  "hook": "beforeDelete",
  "type": "configuration/entityTypes/HCP",
  "tenant": "MyTenantId",
  "object": {
    "uri": "entities/1dbvblmC",
    "type": "configuration/entityTypes/HCP",
    "attributes": {
      "FirstName": [{
        "type": "configuration/entityTypes/HCP/attributes/FirstName",
        "ov": true, "value": "John",
        "uri": "entities/1dbvblmC/attributes/FirstName/3uVOKyLKa"
      }],
      "Status": [{
        "type": "configuration/entityTypes/HCP/attributes/Status",
        "ov": true, "value": "Live",
        "uri": "entities/1dbvblmC/attributes/Status/3uVOKyPaq"
      }]
    },
    "crosswalks": [{
      "uri": "entities/1dbvblmC/crosswalks/3uVOKzNGS",
      "type": "configuration/sources/Reltio",
      "value": "1dbvblmC",
      "dataProvider": true
    }]
  },
  "successful": true
}
```

The handler aborts this fixture by throwing because the OV `Status` is `Live`. For ordinary field validation, use the structured `validate` response instead.

## 21. `beforeMerge` winner + losers fixture

```json
{
  "environment": "https://na1.reltio.com/reltio",
  "hook": "beforeMerge",
  "tenant": "MyTenantId",
  "object": {
    "uri": "entities/1krXNcwy",
    "type": "configuration/entityTypes/HCP",
    "attributes": {
      "FirstName": [{
        "type": "configuration/entityTypes/HCP/attributes/FirstName",
        "ov": true, "value": "Jane"
      }],
      "Country": [{
        "type": "configuration/entityTypes/HCP/attributes/Country",
        "ov": true, "value": "US"
      }]
    },
    "crosswalks": []
  },
  "losers": ["entities/1Lu9RiHQ", "entities/1du0sowh"]
}
```

`object` is the winner. Tests that enforce country or eligibility rules should mock the targeted `entities/_byUris` lookup for each loser rather than assume loser attributes appear in this envelope.

## 22. Reference-attribute add/change/remove fixtures

### Add

```json
{
  "environment": "https://na1.reltio.com/reltio",
  "hook": "beforeReferenceAttributeAdded",
  "tenant": "MyTenantId",
  "entityURI": "entities/HCP123",
  "attributeName": "Address",
  "relation": {
    "uri": "relations/REL456",
    "type": "configuration/relationTypes/HasAddress",
    "attributes": {
      "AddressType": [{
        "type": "configuration/relationTypes/HasAddress/attributes/AddressType",
        "ov": true, "value": "Physical",
        "uri": "relations/REL456/attributes/AddressType/AT789"
      }]
    },
    "startObject": {
      "objectURI": "entities/HCP123",
      "type": "configuration/entityTypes/HCP"
    },
    "endObject": {
      "objectURI": "entities/LOC456",
      "type": "configuration/entityTypes/Location"
    }
  }
}
```

### Change

```json
{
  "environment": "https://na1.reltio.com/reltio",
  "hook": "afterReferenceAttributeChanged",
  "tenant": "MyTenantId",
  "entityURI": "entities/HCP123",
  "attributeName": "Address",
  "relation": {
    "uri": "relations/REL456",
    "type": "configuration/relationTypes/HasAddress",
    "attributes": {
      "AddressType": [{
        "type": "configuration/relationTypes/HasAddress/attributes/AddressType",
        "ov": true, "value": "Physical",
        "uri": "relations/REL456/attributes/AddressType/AT789"
      }]
    },
    "startObject": {"objectURI": "entities/HCP123", "type": "configuration/entityTypes/HCP"},
    "endObject": {"objectURI": "entities/LOC456", "type": "configuration/entityTypes/Location"}
  }
}
```

### Remove

```json
{
  "environment": "https://na1.reltio.com/reltio",
  "hook": "beforeReferenceAttributeRemoved",
  "tenant": "MyTenantId",
  "entityURI": "entities/HCP123",
  "attributeName": "Address",
  "relation": {
    "uri": "relations/REL456",
    "type": "configuration/relationTypes/HasAddress",
    "attributes": {},
    "startObject": {"objectURI": "entities/HCP123", "type": "configuration/entityTypes/HCP"},
    "endObject": {"objectURI": "entities/LOC456", "type": "configuration/entityTypes/Location"}
  }
}
```

The add fixture is the concrete captured shape. The change/remove fixtures preserve that same reference-hook envelope and vary only the hook and relation state for handler tests.

## 23. Nested attribute fixture

```json
{
  "object": {
    "uri": "entities/ABC123",
    "type": "configuration/entityTypes/Person",
    "attributes": {
      "FirstName": [{
        "ov": true, "value": "Maria",
        "uri": "entities/ABC123/attributes/FirstName/F1"
      }],
      "Addresses": [{
        "uri": "entities/ABC123/attributes/Addresses/A1",
        "ov": true,
        "value": {
          "AddressLine1": [{
            "type": "configuration/entityTypes/Person/attributes/Addresses/attributes/AddressLine1",
            "ov": true, "value": "123 Main St",
            "uri": "entities/ABC123/attributes/Addresses/A1/AddressLine1/AL1"
          }],
          "City": [{
            "type": "configuration/entityTypes/Person/attributes/Addresses/attributes/City",
            "ov": true, "value": "Boston",
            "uri": "entities/ABC123/attributes/Addresses/A1/City/C1"
          }]
        }
      }]
    },
    "crosswalks": [{
      "uri": "entities/ABC123/crosswalks/CW1",
      "type": "configuration/sources/MyCRM",
      "value": "EXT-001",
      "attributes": ["entities/ABC123/attributes/FirstName/F1"]
    }]
  },
  "environment": "https://na1.reltio.com/reltio",
  "tenant": "MyTenantId"
}
```

## 24. `afterSave` void / fire-and-forget contract

The input has the same object shape as `beforeSave` with `"hook": "afterSave"`, but the object has already been persisted. The hook returns no response body. Tests should assert the outgoing side effect (role/workflow/event/write-back), including idempotency or a re-entrancy guard, rather than assert a mutated response payload.

```json
{
  "object": {
    "uri": "entities/06G5oeG",
    "type": "configuration/entityTypes/HCP",
    "attributes": {},
    "crosswalks": []
  },
  "environment": "https://na1.reltio.com/reltio",
  "tenant": "MyTenantId",
  "hook": "afterSave"
}
```

## 25. Fixture directory conventions + redaction rules

Store one minimal fixture per behavior and pair requests with expected responses:

```text
src/test/resources/
  entities/
    before-save/create-request.json
    before-save/derived-name-response.json
    validate/invalid-names-request.json
    validate/invalid-names-response.json
    before-delete/live-record.json
    before-merge/winner-and-losers.json
    after-save/persisted-entity.json
  reference-attributes/
    added.json
    changed.json
    removed.json
  nested/
    address-without-type.json
```

- Replace tenant IDs, production entity/relation URIs, crosswalk values, email addresses, secrets, and customer identifiers.
- Preserve URI topology and attribute type paths so deserialization and ownership assertions remain meaningful.
- Keep payloads minimal: retain only fields needed by the handler plus fields required by the lifecycle model.
- Add fixtures for missing values, multiple crosswalks, non-OV values, retry/idempotency, and external lookup failure where the behavior depends on them.

## 26. `LifecycleExecutor` / `BaseTest` pairing notes

Use the LCA test framework's `BaseTest` to load a JSON fixture into lifecycle data and invoke the handler with a mocked `IReltioAPI`. Use `LifecycleExecutor` when verifying request/response serialization at the handler boundary. §7 of this handbook contains the full Java test setup and assertions; Maven test dependencies are in KB-LCA-06.

For a mutation test, assert the returned lifecycle data includes the new attribute and that the selected crosswalk owns it. For validation, assert every expected `ValidationError`; for void hooks, verify the expected API call and that repeat invocation does not duplicate the side effect.
