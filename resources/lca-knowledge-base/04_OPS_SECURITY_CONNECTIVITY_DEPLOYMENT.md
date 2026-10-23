# Best Practices, Troubleshooting, Security, Connectivity & Deployment

> Doc ID: `KB-LCA-04` | Category: Operations
> Ops, security, Reltio↔cloud connectivity, runtime deploy. Maven packaging/CLI: `06_MAVEN_PROJECT_TEMPLATES.md`. Code pitfalls: `02_LCA_IMPLEMENTATION_HANDBOOK.md`.

## 1. Best Practices (ranked by cross-source recurrence)

1. **Always return `data` from `validate`**, never `null` — the single most-repeated rule across all source material.
2. Return `data` only when actually mutated in `before*` hooks; return `null` for a genuine no-op.
3. Never hardcode credentials — use `IReltioAPI` for Reltio calls, a cloud secret manager for external calls.
4. Null/empty-check before `.get(0)` on any attribute or crosswalk list; prefer helper utilities documented in `02_LCA_IMPLEMENTATION_HANDBOOK.md` §5.
5. Never write back to the same entity inside `afterSave` without an idempotency/re-entrancy guard (recursion risk). Prefer mutating in `beforeSave`.
6. Keep LCAs fast — the platform enforces a **100 ms** default execution timeout (`01_LCA_CORE_CONCEPTS_AND_HOOKS.md`).
7. Select the target crosswalk explicitly by `type`, never by list index; treat the LCA as its own source when writing.
8. Use `select` query parameters to fetch only the fields you need — performance and data-exposure best practice.
9. One hook/responsibility per class; separate entity vs. relation handlers into different classes/packages.
10. Use `ActionType` to distinguish CREATE/UPDATE/MERGE/SPLIT/VALIDATE logic within a single hook.
11. Design every `after*` hook to be idempotent — the platform may retry.
12. Use structured `ValidationError` factory methods (`incorrectAttribute`, `missedAttribute`, etc.), not raw exceptions, inside `validate`.
13. Test with real JSON fixtures via `reltio-lca-test-framework` (`02_LCA_IMPLEMENTATION_HANDBOOK.md`); enforce ≥92% JaCoCo coverage in CI (`06_MAVEN_PROJECT_TEMPLATES.md`).
14. Never log full payloads or PII in production — log entity URIs and targeted fields only (`reltioAPI.log*`).
15. Use `filter` conditions in `lifecycleActions` config to avoid unnecessary invocations (`01` §4).
16. Handle API exceptions gracefully — never swallow silently; log with context and rethrow or handle explicitly.
17. Complete cloud connectivity (`04_OPS_SECURITY_CONNECTIVITY_DEPLOYMENT.md`) before registering endpoints in tenant config.
18. Prefer DVF for validation-only rules (`04`) before writing a Java LCA when the need is flag/reject only (no mutation, no external call).
19. Follow the design/review checklist before coding (see §5 project lifecycle playbook).
20. Pin/exclude Jackson explicitly per cloud module — serialization failures often appear only post-deploy (`02` §8, `08`).


## 2. Troubleshooting Playbook


### Diagnostic first steps

1. Confirm the `lifecycleActions` binding is on the intended entity/relation type and that the hook name is exact and case-sensitive.
2. Review Reltio LCA logs and the cloud runtime log for the same test transaction. Temporarily deploy a safe diagnostic handler or capture a redacted payload when the received shape is uncertain.
3. Invoke the deployed endpoint independently with a representative captured payload, then repeat the create/update in a non-production tenant.
4. Verify connectivity, function deployment region, authentication policy, and any request-level LCA suppression flag before changing handler code.

| Symptom | Likely cause | Fix / verification |
|---|---|---|
| LCA is never invoked | Misspelled hook/case; action is bound to wrong type; request suppresses LCA; function or endpoint is unreachable | Verify the target type and exact `lifecycleActions` key; remove suppression; confirm cloud deployment, URL/function name, ingress, and `04_OPS_SECURITY_CONNECTIVITY_DEPLOYMENT.md` connectivity |
| Handler runs but changes are absent | A changed `before*` hook returned `null`; code changed a copy instead of `data.getObject()`; an exception was swallowed | Mutate the supplied object and return `data`; log and rethrow unexpected exceptions |
| Validation error is missing or platform errors | `validate` returned `null`, validation hook is not configured, or the UI operation did not invoke validation | Always return validation `data`; verify binding and operation path |
| `NullPointerException` / `IndexOutOfBoundsException` | Attribute, nested value, object, or crosswalk list was absent/empty | Null/empty-check before access; use fixture cases for absent data |
| Attribute lands on wrong source | Code selected the first crosswalk | Locate the crosswalk by required type/source, and decide explicitly what to do if absent |
| `ClassCastException` reading an attribute | Simple, nested, and reference attributes were treated as the same interface | Check the tenant model and use the matching `ISimpleAttributeValue`, `INestedAttributeValue`, or `IReferenceAttributeValue` interface |
| Recursive calls / repeated saves | `afterSave` calls PUT/POST on the same entity | Move mutation to `beforeSave`; otherwise use an idempotency key plus a config filter or marker that prevents reprocessing |
| Timeout or elevated request latency | Slow external call, full-object retrieval, no connection reuse, or cloud cold start | Keep the critical path below 100 ms; use `select`, bounded client timeouts, reusable clients, and the cloud warm-capacity setting below; move non-critical work after save |
| Works in tests but fails in production | Fixture shape differs, names/configuration differ by tenant, more crosswalks exist, secret/IAM differs, or Jackson conflicts | Capture/redact a representative payload; parameterize tenant-specific values; test multi-crosswalk input; validate identity grants; pin one patched Jackson version |
| Azure endpoint deploys but is silent | Generated `function.json` entry point does not match the fully qualified class/method annotated with `@FunctionName` | Inspect the generated artifact and match the entry point exactly; see the Azure caveat in `01_LCA_CORE_CONCEPTS_AND_HOOKS.md` §7 |
| Test framework cannot load JSON | Fixture is not under `src/test/resources` or its resource path is wrong | Place fixtures under the resource root and use a path relative to that root |
| DVF has no result / warning is invisible | `Reltio/DVFAction` is not wired, the model is unpublished, or UI/analytics visibility is absent | Wire and publish the model; confirm warning versus error semantics and relevant UI configuration; see `03_DVF_AND_LCA_VS_DVF_DECISION_GUIDE.md` |

**Safe logging pattern:** record hook name, entity URI, action type, status, latency, and a correlation ID. Do not include raw attribute values, tokens, full payloads, or stack traces that may embed them. Use `reltioAPI.logInfo`, `logWarning`, and `logError` with sanitized messages.


## 3. Security Guidelines

Detailed security controls adapted from the Lifecycle Framework security checklist. Prefer `IReltioAPI` for Reltio callbacks; reserve separate machine identity only when architecture requires it.

### Authentication and Authorization

### Use `IReltioAPI` for Standard Reltio API Calls

The `IReltioAPI` instance injected into every hook carries the caller's OAuth token automatically and is the preferred mechanism for standard Reltio API callbacks from an LCA.

```java
// CORRECT — preferred standard callback pattern
String result = reltioAPI.get("entities/123", Collections.emptyMap());
```
### Exception Pattern — Direct Reltio REST Calls with Customer-Managed OAuth Token

**Default rule:** Use the injected `IReltioAPI` for standard Reltio API callbacks inside LCAs. It carries the caller context automatically and is the preferred integration pattern.

**Exception:** In some customer implementations, an LCA may intentionally obtain its own OAuth2 bearer token using the `client_credentials` grant type and call Reltio REST APIs directly over HTTPS.

Use this exception pattern only when there is a clear architectural requirement, such as:
- the implementation must call Reltio using a dedicated machine credential rather than the caller context
- the implementation must access APIs using a token scope or identity different from the token bound to `IReltioAPI`
- the implementation is part of a controlled native/legacy integration pattern approved by the customer architecture team

**Important limitations:**
- This pattern does **not** replace or rebind the token already associated with `IReltioAPI`
- `IReltioAPI` continues to use its original platform-injected authentication context
- if you use client credentials, make direct HTTPS calls yourself; do not assume `IReltioAPI` will use the newly fetched token

**Security requirements:**
- never hardcode `clientId`, `clientSecret`, token URLs, or scopes in Java source
- load credentials from environment variables, cloud secret managers, or an approved properties source for native deployments
- never log bearer tokens
- use HTTPS only
- set short network timeouts and fail clearly

**Recommended usage pattern:**
1. Load OAuth settings from secure configuration
2. Request a bearer token using `client_credentials`
3. Call Reltio REST endpoints directly with `Authorization: Bearer <token>`
4. Use `IReltioAPI` for logging only in this pattern, unless standard callback behavior is also needed separately

**Decision rule:**
- Prefer `IReltioAPI` for normal Reltio API callbacks
- Use direct REST + client credentials only when the requirement explicitly needs a separate machine identity
### Never Hardcode Credentials

Never embed usernames, passwords, API keys, or OAuth tokens in LCA source code or JAR files.

```java
// WRONG — credentials in source
String password = "mySecretPassword123";
URL url = new URL("https://auth.reltio.com/oauth/token?password=" + password);

// CORRECT — use environment variables or cloud secret managers
String apiKey = System.getenv("EXTERNAL_SERVICE_API_KEY");
```

### Use Cloud-Native Secret Managers

| Cloud | Secret Manager |
|---|---|
| AWS Lambda | AWS Secrets Manager or Parameter Store |
| Google Cloud Functions | Google Secret Manager |
| Azure Functions | Azure Key Vault via Managed Identity |

Initialize secrets at class load time (not per-request) to minimize latency:

```java
private static final String API_KEY = loadSecret("my-service-api-key");

private static String loadSecret(String name) {
    // Cloud-specific secret manager SDK call
    return SecretManagerClient.getInstance().getSecret(name);
}
```

---

### Input Validation

### Validate and Sanitize Incoming Attribute Values

LCA code processes data submitted by external systems. Always validate before using attribute values.

```java
// Prefer validate + ValidationError for ordinary field checks (no PII in messages).
List<IAttributeValue> emails = attrs.getAttributeValues("Email");
if (emails != null) {
    for (IAttributeValue emailValue : emails) {
        Object raw = emailValue.getValue();
        String email = raw == null ? null : String.valueOf(raw);
        if (email != null && !email.matches("^[^@]+@[^@]+\\.[^@]+$")) {
            data.addValidationError(ValidationError.incorrectAttribute(
                emailValue, "Email format is invalid."));
        }
    }
}
```

Reserve thrown exceptions for hard aborts that cannot be represented as field-level validation. Never include user-controlled attribute values in exception or log messages.
### Sanitize Values Used in External API Calls

If attribute values are interpolated into URLs or API request bodies, sanitize them to prevent injection attacks.

```java
// WRONG — directly embedding user data in URL
String url = "external-service/lookup?npi=" + npiValue;

// CORRECT — URL-encode or validate format
String url = "external-service/lookup?npi=" + URLEncoder.encode(npiValue, "UTF-8");
```

---

### Network Security

### Use HTTPS Only

All external HTTP calls from LCA code must use HTTPS. Never use plain HTTP for service-to-service communication.

### Validate TLS Certificates

Use the default JVM trust store. Do not disable certificate validation.

```java
// WRONG — disabling SSL validation
HttpsURLConnection.setDefaultHostnameVerifier((hostname, session) -> true);

// CORRECT — use default validation
HttpsURLConnection conn = (HttpsURLConnection) new URL(url).openConnection();
```

### Restrict Inbound Access to Your Function Endpoint

LCA endpoints should only accept requests from Reltio's known IP ranges. Configure your cloud function's ingress policy accordingly:

- **AWS Lambda:** Restrict via API Gateway resource policy or VPC endpoint.
- **Google Cloud Functions:** Use ingress settings to allow only internal VPC traffic or specific IP ranges.
- **Azure Functions:** Use IP restrictions in Azure App Service networking settings.

---

### Data Handling

### Minimize Data Exposure in Logs

Never log PII (personally identifiable information) such as names, dates of birth, SSNs, or contact information at INFO level in production. Use entity URIs as identifiers in log messages.

```java
// WRONG — logs PII
reltioAPI.logInfo("Processing patient: " + firstName + " " + lastName + " DOB: " + dob);

// CORRECT — log URI only
reltioAPI.logInfo("[beforeSave] Processing entity: " + data.getObject().getUri());
```

### Do Not Persist Sensitive Data to External Logs or Storage

If your LCA sends data to external systems (analytics, audit databases), ensure PII fields are masked or hashed before transmission.

### Use `select` to Fetch Only Required Fields

When calling back into Reltio API to load entities, request only the attributes you need. This reduces data exposure and improves performance.

```java
// Only fetch Status and Category fields
String result = reltioAPI.get(
    "entities/" + uri + "?select=attributes.Status,attributes.Category",
    Collections.emptyMap());
```

---

### Dependency Security

### Keep Dependencies Updated

Regularly update the `life-cycle-framework` version and transitive dependencies. Older versions may contain known vulnerabilities.

### Use `dependabot` or Equivalent

Configure automated dependency scanning in your CI/CD pipeline to alert on known CVEs in transitive dependencies (Jackson, Apache Commons, etc.).

### Exclude Conflicting Jackson Versions

The framework ships with Jackson. Pin explicitly and exclude transitive Jackson to avoid classpath conflicts (which can cause serialization vulnerabilities or runtime errors):

```xml
<dependency>
  <groupId>com.reltio</groupId>
  <artifactId>life-cycle-framework-google-function</artifactId>
  <version>${lca-version}</version>
  <exclusions>
    <exclusion>
      <groupId>com.fasterxml.jackson.core</groupId>
      <artifactId>jackson-databind</artifactId>
    </exclusion>
  </exclusions>
</dependency>
<dependency>
  <groupId>com.fasterxml.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
  <version>2.15.4</version>  <!-- pin to latest patched version -->
</dependency>
```

---

### Code Security

### Avoid Reflection and Dynamic Class Loading in LCA Logic

Reflection-based code is hard to audit and can create injection surfaces. Use explicit type checks and casts.

### Do Not Log Exception Stack Traces with Sensitive Data

```java
// WRONG — full stack trace may include sensitive field values
e.printStackTrace();

// CORRECT — log message only, and the entity URI for correlation
reltioAPI.logError("Failed processing entity " + uri + ": " + e.getMessage());
```

### Handle Third-Party Library Exceptions

Wrap external library calls in try-catch. Unhandled exceptions from JSON parsers or HTTP clients may expose internal details in error messages returned to API callers.

---

### Compliance Checklist

| Item | Status |
|---|---|
| No hardcoded credentials in source code | ☐ |
| All external calls use HTTPS | ☐ |
| Secrets loaded from cloud secret manager | ☐ |
| PII not logged at INFO level in production | ☐ |
| `select` used for minimal data fetching | ☐ |
| Inbound access to function restricted to Reltio IPs | ☐ |
| Dependencies scanned for known CVEs | ☐ |
| Jackson explicitly pinned to latest patched version | ☐ |
| Test fixtures contain no real production PII | ☐ |
| LCA code reviewed for injection vulnerabilities | ☐ |
| `IReltioAPI` used for all Reltio calls (no self-auth) | ☐ |
| Exception messages do not leak sensitive data to callers | ☐ |

---

### Azure-Specific: Use Managed Identity Instead of Connection Strings

For Azure Functions accessing Azure Key Vault, Azure Storage, or other Azure services, use Managed Identity rather than connection strings:

```json
{
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "java",
    "KEY_VAULT_URI": "https://myvault.vault.azure.net/"
  }
}
```

```java
// Access Key Vault via Managed Identity (no credential in code)
SecretClient client = new SecretClientBuilder()
    .vaultUrl(System.getenv("KEY_VAULT_URI"))
    .credential(new DefaultAzureCredentialBuilder().build())
    .buildClient();
String secret = client.getSecret("my-secret-name").getValue();
```

---

### GCP-Specific: Use Service Account with Minimum Permissions

Assign a dedicated service account to your Cloud Function with only the permissions it needs (e.g. `secretmanager.versions.access` for Secret Manager access). Do not use the default Compute Engine service account.

---

### AWS-Specific: Use IAM Roles for Lambda

Assign an IAM execution role to the Lambda function with least-privilege permissions. Use IAM policies to restrict access to Secrets Manager, Parameter Store, or any other AWS services the LCA needs.

---


## 4. Deployment & Runtime Operations

> Establish connectivity first (sections 6–8 of this document). Use `KB-LCA-06` for POM packaging and base deploy CLI. This section covers runtime sizing, cold-start mitigation, monitoring, and CI/CD.

### Runtime Requirements

- **Runtime:** Java 21
- **Memory:** 512 MB minimum; 1 GB recommended for complex logic with external calls
- **Cloud function timeout:** Set as an outer bound (for example 30 seconds) so cold starts and non-critical post-persist work are not killed by the cloud runtime. This is **not** the LCA platform budget.
- **Platform LCA limit:** Critical-path hooks (`before*`, `validate`, and other synchronous lifecycle invocations) must complete within the **100 ms** default platform execution limit. Target well under that for `before*` hooks; move optional or slow work to idempotent `afterSave` / async patterns.
- **Concurrency:** Configure reserved concurrency to prevent throttling during peak loads

### Reltio–AWS Connectivity (one-time prerequisite)

Before the tenant configuration can call your Lambda, Reltio must be authorised to invoke it via IAM role assumption.

1. In Reltio Console go to **Tenant management → Lifecycle Actions → Create connection → AWS**.
2. Create a customer IAM role in your account with `lambda:InvokeFunction` permission.
3. Enter your **AWS Account ID**, **Customer IAM Role ARN**, and **AWS Region** in the wizard and submit.
4. Once Reltio creates its service role, update your role's trust policy to allow `sts:AssumeRole` from the Reltio role ARN shown in the wizard.
5. Tick the confirmation checkbox and select **Validate Trust Policy & Apply Configuration**.

Full steps: section 6 (AWS Lambda) of this document.

### Tenant Configuration

```json
{
  "beforeSave": ["Lambda/BinaryJSON/my-lambda-function-name"]
}
```

The function name is the **AWS Lambda function name** (not the handler class name).

### Deployment via AWS CLI

```bash
aws lambda update-function-code \
  --function-name my-lambda-function-name \
  --zip-file fileb://target/sample-lca-lambda-VERSION-jar-with-dependencies.jar
```

### Environment Variables

```
EXTERNAL_SERVICE_URL=https://my-service.example.com
EXTERNAL_API_KEY=arn:aws:secretsmanager:us-east-1:123456:secret:my-key
```

### VPC Configuration

If Reltio is in a VPC-peered environment, configure the Lambda function within the appropriate VPC, subnets, and security groups. Ensure outbound access to Reltio's API endpoint is allowed.

### Cold Start Mitigation

- Enable **Provisioned Concurrency** for latency-sensitive hooks (`beforeSave`, `validate`).
- Avoid heavy initialization in the constructor — use lazy initialization with `static` fields.

---

### Google Cloud Functions

### Build

GCF deployment requires a fat JAR + a ZIP file containing it.

```bash
mvn clean package
# Outputs:
#   target/sample-lca-googlefunction-VERSION-jar-with-dependencies.jar
#   target/sample-lca-googlefunction-VERSION-zip.zip  (or similar)
```

### Handler Class

Extends `LifeCycleGoogleFunction`. No HTTP annotations needed — the framework handles HTTP routing.

```java
public class BeforeSaveEntityAction extends LifeCycleGoogleFunction {
    @Override
    public ILifeCycleObjectData beforeSave(IReltioAPI api, ILifeCycleObjectData data) {
        return data;
    }
}
```

### Deployment via `gcloud`

```bash
gcloud functions deploy BeforeSaveEntityAction \
  --runtime java21 \
  --trigger-http \
  --no-allow-unauthenticated \
  --entry-point com.reltio.lca.entities.BeforeSaveEntityAction \
  --source target/sample-lca-googlefunction-VERSION-zip.zip \
  --memory 512MB \
  --timeout 60s \
  --region us-central1
# Then grant the Reltio-impersonated customer service account Cloud Functions/Cloud Run Invoker.
```

**Entry point** = fully-qualified class name.

### Reltio–GCP Connectivity (one-time prerequisite)

Before the tenant configuration can call your Cloud Function, Reltio must be authorised to invoke it via GCP service account impersonation.

1. Open a Reltio Support ticket requesting a **Reltio service account email** for your tenant (include environment name and tenant ID).
2. In GCP Console, create a customer service account and grant it the **Cloud Run Invoker** role on your project.
3. Under that service account's **Permissions**, add the Reltio service account email and assign it **Service Account User** + **Service Account Token Creator** roles.
4. Share your customer service account email back with Reltio Support.
5. Deploy your function with **`--no-allow-unauthenticated`** so only the Reltio service account can invoke it.

Full steps: section 7 (Google Cloud Functions) of this document.

### Tenant Configuration

```json
{
  "lifecycleActions": {
    "beforeSave": [
      "googlefunction/BinaryJSON/https://us-central1-PROJECT_ID.cloudfunctions.net/BeforeSaveEntityAction"
    ]
  }
}
```

### Assembly Descriptor for ZIP

`src/assembly/zip.xml` packages the fat JAR into a deployable ZIP:

```xml
<assembly>
  <id>zip</id>
  <formats><format>zip</format></formats>
  <includeBaseDirectory>false</includeBaseDirectory>
  <fileSets>
    <fileSet>
      <directory>${project.build.directory}</directory>
      <includes><include>*-jar-with-dependencies.jar</include></includes>
      <outputDirectory>/</outputDirectory>
    </fileSet>
  </fileSets>
</assembly>
```

### Cross-Cloud Comparison

| Feature | AWS Lambda | Google Cloud Functions | Azure Functions |
|---|---|---|---|
| Base class | `LifeCycleActionHandler` | `LifeCycleGoogleFunction` | `LifeCycleAzureFunction` |
| Annotations needed | None | None | `@FunctionName`, `@HttpTrigger` |
| Packaging | Fat JAR | Fat JAR + ZIP | Azure Functions package (via Maven plugin) |
| One class per hook | No (single handler class routes all hooks) | No | Yes (one class per Azure Function endpoint) |
| Cold start mitigation | Provisioned Concurrency | Min instances | Premium plan / Always On |
| Java version | 21 | 21 | 21 |
| Secret management | AWS Secrets Manager | GCP Secret Manager | Azure Key Vault |
| Config format in Reltio | `Lambda/BinaryJSON/NAME` | `googlefunction/BinaryJSON/<Google Function URL>` | `AzureFunction/BinaryJSON/<Azure Function URL>` |

---

### CI/CD Recommendations

### Build Pipeline (all clouds)

```yaml
# Example GitHub Actions step
- name: Build LCA
  run: mvn clean package -B

- name: Run tests with coverage
  run: mvn verify -B

- name: Check coverage threshold
  run: mvn jacoco:check -B  # fails if < 92% line coverage
```

### Deployment Strategy

1. **Deploy to non-production tenant first** and verify end-to-end with real data.
2. **Blue/green deployment:** Keep the previous version running while rolling out the new one.
3. **Feature flags via tenant configuration:** Point the hook to the new URL only after validation.

### Monitoring and Alerting

- Set up cloud-native alerts on function error rates and p95 latency.
- Alert when LCA execution time exceeds 5 seconds (indicates risk of platform timeout).
- Monitor Reltio LCA logs for ERROR-level messages.

---


## 5. Project Lifecycle Playbook


Use this sequence for a new or materially changed LCA: **Design → Build → Test → Deploy → Connect → Configure → Verify**.

### 1. Design

- Confirm the business scenario and hook selection in [KB-LCA-01](01_LCA_CORE_CONCEPTS_AND_HOOKS.md).
- Decide LCA versus DVF using `03_DVF_AND_LCA_VS_DVF_DECISION_GUIDE.md`.
- Define data ownership, crosswalk behavior, ActionType paths, expected validation behavior, retry/idempotency strategy, latency budget, and external-call contract.
- Identify data classification, secret/identity needs, ingress/egress restrictions, and the cloud target.

### 2. Build

- Start with the appropriate template and supported dependency versions from [KB-LCA-06](06_MAVEN_PROJECT_TEMPLATES.md).
- Apply patterns and avoid pitfalls in [KB-LCA-02](02_LCA_IMPLEMENTATION_HANDBOOK.md).
- Implement focused handlers with correct return semantics, safe attribute/crosswalk access, structured validation errors, safe logging, and controlled dependencies.
- Confirm package/class/entry-point names match the chosen cloud deployment model.

### 3. Test

- Build fixture-based tests using the payload and fixture catalog in [KB-LCA-02](02_LCA_IMPLEMENTATION_HANDBOOK.md).
- Test normal, empty/malformed, multi-crosswalk, create/update/merge/split, validation, integration-failure, retry, and no-op paths.
- Run the LCA test framework and `mvn verify`; meet the agreed JaCoCo gate and remediate dependency scan findings.

### 4. Deploy

- Package and deploy using [KB-LCA-06](06_MAVEN_PROJECT_TEMPLATES.md); set Java 21, memory, cloud timeout, identity, environment configuration, secret references, and warm-capacity controls.
- Deploy to non-production first and inspect the generated Azure function metadata when applicable.
- Establish runtime dashboards and alerts before production enablement.

### 5. Connect

- Complete the required Reltio-to-cloud IAM/service-account/Entra authentication setup in `04_OPS_SECURITY_CONNECTIVITY_DEPLOYMENT.md`.
- Validate inbound invocation and outbound connectivity from the deployed function; confirm least privilege and ingress restrictions.

### 6. Configure

- Register the exact, case-sensitive action name/URL under `lifecycleActions` for the intended type(s).
- Apply appropriate conditional filters and inheritance rules; use the implementation patterns in [KB-LCA-02](02_LCA_IMPLEMENTATION_HANDBOOK.md).
- Promote tenant configuration through the normal non-production-to-production process, using feature flags or scoped filters for rollout.

### 7. Verify

- Smoke-test the cloud endpoint and complete create/update functional tests through Reltio in non-production.
- Confirm persisted mutations, validation presentation, downstream idempotency, and expected behavior on retry.
- Review CloudWatch, Cloud Logging, or Application Insights alongside Reltio logs for errors, p95 duration, cold starts, and authorization failures.
- Record the deployed version, configuration change, rollback path, operational owner, and any known constraints before production promotion.

Official Reltio documentation:
- AWS: https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/lca-deployment-using-aws-lambda/set-up-aws-lambda-connections-for-lcas
- GCP: https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/lca-implementation-using-google-functions/lca-as-google-functions-identity-and-access-management
- Azure (Entra ID): https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/azure-functions-for-lifecycle-actions/configure-microsoft-entra-id-authentication-for-azure-lcas
- Azure (OAuth2): https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/azure-functions-for-lifecycle-actions/configure-oauth2-client-credentials-for-azure-lcas

## 6. AWS Lambda — Reltio Console Self-Service Connection

Reltio uses **IAM Role assumption** (cross-account STS) to invoke your Lambda functions. You set this up once via the Reltio Console, and Reltio's service role is then allowed to call your Lambda.

### Prerequisites

- Access to Reltio Console with LCA management permissions for your tenant.
- AWS IAM permissions to create or update IAM roles and trust policies in your account.
- Your Lambda functions already deployed (or ready to deploy) in the target AWS account.
- Familiarity with AWS S3, Lambda, CloudWatch, Java/Maven, and the Reltio API.
- Check and set the Lambda **concurrency limit** to avoid throttling under load. See [AWS Lambda scaling docs](https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html).

### Step-by-Step

**Step 1: Open Lifecycle Actions in Reltio Console**

1. In Reltio Console, go to **Tenant management → Lifecycle Actions**.
2. If no connection exists, the page shows the onboarding wizard. Select **Create connection → AWS**.

**Step 2: Prepare your AWS environment**

Follow the instructions shown in the **Setup connection - AWS Lambda** wizard page. This involves:

- Creating a customer IAM role in your AWS account that Reltio's service role can assume.
- The role needs permissions to invoke your Lambda functions (e.g. `lambda:InvokeFunction`).

**Step 3: Enter AWS connection details**

In the **AWS Details** section, provide:

| Field | Description |
|---|---|
| AWS Account ID | Your 12-digit AWS account ID |
| Customer IAM Role ARN | ARN of the role you created (e.g. `arn:aws:iam::123456789012:role/ReltioLcaInvokerRole`) |
| AWS Region | Region where your Lambda functions are deployed (e.g. `us-east-1`) |
| External ID | **Required** for production. Generate a unique External ID and add the matching `sts:ExternalId` condition on the trust policy (confused-deputy protection). |

Select **Submit request**. Reltio processes this asynchronously and creates its own service role.  
Possible statuses: **Waiting for approval**, **Reltio role created**, **Request rejected**.  
You can leave the page and return — the request persists.

**Step 4: Update your IAM role's trust policy**

Once Reltio notifies you that the Reltio role has been created (shown in the wizard), update the trust policy on your customer IAM role to allow the Reltio service role to assume it. Always include the External ID condition that matches the value entered in the wizard:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::RELTIO_ACCOUNT_ID:role/RELTIO_ROLE_NAME"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "sts:ExternalId": "YOUR_EXTERNAL_ID"
        }
      }
    }
  ]
}
```

The Reltio role name and account ID are shown in the wizard.

**Step 5: Validate and apply configuration**

1. Tick the checkbox confirming the trust policy is updated.
2. The wizard shows a preview of the tenant physical configuration that will be applied.
3. Select **Validate Trust Policy & Apply Configuration**.
   - Reltio performs a live `sts:AssumeRole` call to verify the trust relationship.
   - If validation succeeds, the tenant configuration is applied automatically.
   - If validation fails, fix the trust policy in AWS and retry.

**Step 6: Verify the connection**

In Lifecycle Actions, select **Manage Connections**. A side panel shows the connection details.  
You can **Edit** (External ID only) or **Delete** the connection.

> **Note on deletion:** Deleting a connection can take up to 3 hours to complete. You can create a new connection once the deletion is finished.

**Result:** Reltio can now invoke your Lambda functions. Proceed to deploy your LCA and register it in the tenant config using `Lambda/BinaryJSON/<function-name>`.

---

## 7. Google Cloud Functions — IAM Service Account Setup

Reltio uses **service account impersonation** to invoke your GCF endpoints. You create a GCP service account, grant it Cloud Run Invoker rights on your functions, and then allow Reltio's service account to impersonate it.

### Prerequisites

- A GCP project with Cloud Functions (Gen2) deployed or ready to deploy.
- IAM Admin permissions in GCP to create service accounts and assign roles.
- A Reltio support ticket open to receive the **Reltio service account email** for your tenant.

### Step-by-Step

**Step 1: Request Reltio's service account email**

Open a Reltio Support ticket requesting a **Reltio service account for impersonation**. Include:
- Environment name
- Tenant ID

Reltio will provide you with a service account email address (e.g. `reltio-lca-<tenant>@reltio-prod.iam.gserviceaccount.com`).

**Step 2: Create a customer service account in GCP**

1. Log in to [Google Cloud Console](https://console.cloud.google.com) with an account that has IAM Admin permissions.
2. Select (or create) your GCP project.
3. Go to **IAM & Admin → Service Accounts**.
4. Click **+ CREATE SERVICE ACCOUNT**.
5. Provide a name and description (e.g. `reltio-lca-invoker`).
6. Click **CREATE**.

**Step 3: Assign roles to the service account**

Assign the following roles to the service account you just created:

| Role | Purpose |
|---|---|
| **Cloud Run Invoker** (`roles/run.invoker`) | Allows this service account to invoke deployed Cloud Functions (Gen2) |
| **Cloud Functions Developer** (`roles/cloudfunctions.developer`) | *(Optional)* Required only if this account also deploys functions |
| **Storage Object Admin** (`roles/storage.objectAdmin`) | *(Optional)* Required only if this account uploads function ZIPs to GCS |

Click **CONTINUE** and then **DONE**.

**Step 4: Grant Reltio's service account impersonation rights**

1. Go to **IAM & Admin → Service Accounts**.
2. Click on the service account you just created.
3. Go to the **Permissions** tab → **View by Principals**.
4. Click **+ GRANT ACCESS**.
5. In the **Add principals** field, enter the Reltio service account email provided in Step 1.
6. Assign these roles to the Reltio service account:

| Role | Purpose |
|---|---|
| **Service Account User** (`roles/iam.serviceAccountUser`) | Allows Reltio to impersonate your service account |
| **Service Account Token Creator** (`roles/iam.serviceAccountTokenCreator`) | Allows Reltio to generate tokens on behalf of your service account for authentication |

7. Click **SAVE**.

**Step 5: Share your service account email with Reltio**

After setup, share your **customer service account email** back with Reltio Support. Reltio will configure the impersonation on their side for your tenant.

**Step 6: Deploy your function with `--no-allow-unauthenticated`**

Since Reltio will authenticate via the service account, deploy your function **without** `--allow-unauthenticated` for production:

```bash
gcloud functions deploy my-lca-before-save \
  --gen2 \
  --runtime=java21 \
  --region=us-central1 \
  --source=gs://MY_BUCKET/my-lca.zip \
  --entry-point=com.reltio.lifecycle.googlefunction.LcaJarExecutionGoogleHandler \
  --memory=512MB \
  --trigger-http \
  --no-allow-unauthenticated \   # secure — Reltio authenticates via service account
  --project=MY_GCP_PROJECT
```

**Result:** Reltio can now invoke your Cloud Function via service account impersonation. Register it in the tenant config as `"googlefunction/BinaryJSON/<Google Function URL>"`.

> **Security principle:** Always grant minimal necessary access. Regularly review and update permissions. Control who can impersonate your service account via the "Grant users access" section.

---

## 8. Azure Functions — Connectivity Setup

Azure supports two authentication methods. Use **Option A (Microsoft Entra ID)** unless you have a specific need for a custom identity provider.

---

### Option A: Microsoft Entra ID Authentication (Recommended)

Reltio uses a **tenant-specific Azure App Registration** to obtain tokens and call your Function App. You register Reltio's App ID as an authorized caller on your Function App's authentication configuration.

#### Prerequisites

- An Azure App Registration or access to create one (Application Administrator or Global Administrator role in Azure AD).
- A Reltio support ticket open to receive your **tenant-specific Reltio Azure App ID**.
- Your Azure Function App deployed.

#### Step 1: Get Reltio's Azure App ID

Contact Reltio Support and request your **tenant-specific Azure App ID**. Reltio will provide a GUID like `12345678-abcd-...`.

#### Step 2: Create a Service Principal for Reltio's App

Run the following Azure CLI command (requires Azure AD admin role):

```bash
az ad sp create --id <reltioAppId>
```

> Only users with **Global Administrator** or **Application Administrator** can run this. Regular users will receive a permission error.

#### Step 3: Enable Authentication on your Function App

1. In the **Azure Portal**, navigate to your Function App.
2. Under **Settings**, select **Authentication**.
3. In the **Basics** section, set **Identity Provider** to **Microsoft**.
4. In **App registration type**, choose one of:
   - **Create a new app registration** (simplest for new setups)
   - **Pick an existing app registration in this directory**
   - **Provide the details of an existing app registration**
5. Set a name and choose an appropriate **Client secret expiration** per your org's security policy.
6. Under **Additional checks → Client application requirement**, select **Allow requests from specific client applications**.
7. Add the **Reltio App ID** provided in Step 1.
8. Click **Add**.

#### Step 4: Expose an Application ID URI

Ensure your app registration exposes an **Application ID URI**. If not set, add:
```
api://<Your-Application-ID>
```

Navigate to the identity provider settings you just added (click **Edit**), and add this URI as an **Audience** so Reltio tokens are accepted.

Click **Save**.

#### Step 5: Share details with Reltio

Provide the following to your Reltio onboarding contact:

| Value | Description |
|---|---|
| `customerTenantId` | Your Azure tenant ID (Directory ID) |
| `customerFunctionAppId` | The App ID used as the identity provider in Step 3 |

Reltio adds these to your tenant's physical configuration.

**Result:** Your Function App now only accepts requests bearing tokens from Reltio's App Registration. Reltio can securely invoke your LCA endpoints.

---

### Option B: OAuth2 Client Credentials Authentication

Use this when you have an existing identity provider (Okta, Auth0, PingFederate, etc.) that issues tokens for your Azure Function. Reltio fetches a bearer token from your IdP's token endpoint before each LCA invocation.

#### Prerequisites

- An OAuth2 client in your IdP that supports the `client_credentials` grant type.
- Client ID, client secret, HTTPS token endpoint URL, and optional scope.
- A Reltio admin bearer token for the tenant.
- Reltio must enable `PUT`/`DELETE` privileges for your admin user — **open a support ticket first**.

#### Step 1: Enable the privilege

Open a Reltio Support ticket to enable `PUT` and `DELETE` access to the LCA Azure config endpoint for your admin user.

#### Step 2: Store OAuth2 credentials via Reltio API

```bash
# Load secrets from your secret manager / CI secret store — never paste into the shell.
: "${RELTIO_ADMIN_TOKEN:?set RELTIO_ADMIN_TOKEN}"
: "${AZURE_OAUTH_CLIENT_SECRET:?set AZURE_OAUTH_CLIENT_SECRET}"

REQUEST_FILE="$(mktemp)"
trap 'rm -f "$REQUEST_FILE"' EXIT
cat > "$REQUEST_FILE" <<EOF
{
  "tokenUrl": "https://auth.example.com/as/token.oauth2",
  "clientId": "your-oauth2-client-id",
  "clientSecret": "${AZURE_OAUTH_CLIENT_SECRET}",
  "scope": "lca.invoke"
}
EOF

curl -X PUT \
  "https://<reltio-env>/reltio/tenants/<tenantId>/lcaConfig/azureConfig/secrets" \
  -H "Authorization: Bearer ${RELTIO_ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @"$REQUEST_FILE"
```

Validation rules:
- `tokenUrl` must use `https://`
- `clientId` and `clientSecret` must not be blank
- `scope` is optional — omit if not required by your IdP
- Reltio performs a **live `client_credentials` token request** on save. If the IdP is unreachable or credentials are invalid, the save fails.

Successful response:
```json
{
  "successful": true,
  "message": "LCA Azure OAuth2 credentials stored successfully"
}
```

> **Authentication method:** Reltio uses `client_secret_post`. If your IdP requires `client_secret_basic`, open a support ticket.

#### Step 3: Verify

1. Trigger an Azure LCA on the tenant.
2. Check your IdP's audit log — confirm a `client_credentials` request was received for your client.
3. Check your Azure Function logs — confirm the request includes a valid `Authorization: Bearer` header.

Reltio caches tokens and refreshes them based on the `expires_in` value from your IdP.

#### Remove OAuth2 credentials (revert to Entra ID)

```bash
curl -X DELETE \
  "https://<reltio-env>/reltio/tenants/<tenantId>/lcaConfig/azureConfig/secrets" \
  -H "Authorization: Bearer <reltio-admin-token>"
```

After deletion, Azure LCAs revert to the Microsoft Entra ID authentication flow.

---

## 9. Summary — End-to-End Setup Order

| Step | AWS | GCP | Azure |
|---|---|---|---|
| 1. Deploy function | Lambda (fat JAR) | Cloud Function (JAR + ZIP) | Azure Function (ZIP) |
| 2. Establish Reltio→Cloud connectivity | Reltio Console self-service wizard (IAM role + trust policy) | GCP IAM: create SA, grant roles, allow Reltio SA impersonation | Enable Entra ID auth on Function App OR store OAuth2 credentials via API |
| 3. Share config with Reltio | Wizard applies automatically after validation | Share customer SA email with Reltio Support | Share `customerTenantId` + `customerFunctionAppId` with Reltio |
| 4. Register in tenant config | `"Lambda/BinaryJSON/<function-name>"` | `"googlefunction/BinaryJSON/<Google Function URL>"` | `"AzureFunction/BinaryJSON/<Azure Function URL>"` |
| 5. Test | Invoke Lambda test, check CloudWatch logs | Invoke GCF test, check GCP logs | Invoke Azure Function test, check Application Insights |

---
