# DVF Overview & LCA vs. DVF Decision Guide

> Doc ID: `KB-LCA-03` | Category: Architecture Decisions
> DVF authoring, enablement, LCA-vs-DVF routing, migration. Pre-ingestion architectures: `05_EXTERNAL_DOCS_AND_INGESTION_APIS.md`.
> Cross-reference: `05_EXTERNAL_DOCS_AND_INGESTION_APIS.md` for the live validation endpoint and pre-ingestion architectures.

## 1. What is DVF

**Data Validation Function (DVF)** is a declarative, configuration-driven Reltio validation rule. It evaluates attribute values and returns a business-facing error or warning without custom Java code, cloud deployment, data mutation, or external service calls.

A DVF is configured in the tenant data model and evaluated by Reltio's validation framework; it is not a Java Lifecycle Action (LCA) and does not run in Lambda, Google Cloud Functions, Azure Functions, or the native LCA executor.

### Object model and scope

Each DVF contains these essential fields:

| Field | Purpose |
|---|---|
| `name` | Unique rule name |
| `expression` | Expression that must evaluate successfully for the value to pass |
| `action` | `ERROR` or `WARNING` result on failure |
| `message` | User-visible business message |

DVFs can be anchored to simple attributes, nested attribute children, entity validation contexts, and relationship validation contexts where the tenant model supports validation. Typical targets include `Email`, `Status`, `NPI`, `Phone/Number`, and `Address/PostalCode`.

### Strengths

- No-code rules that business and model owners can maintain in tenant configuration.
- Attribute-level, nested, conditional, and format validation.
- Structured error/warning output for UI, validation responses, analytics, and upstream consumers.
- Reusable central rules for save-time and pre-ingestion validation flows.

### Limits

DVF validates and reports only. It cannot mutate the incoming object, orchestrate multi-step processing, call Reltio APIs or external services, trigger post-save effects, or govern merge, unmerge, match, delete, reference-attribute, or DCR lifecycle events.

## 2. Expression Language and Authoring Rules

Documented expression patterns include:

| Rule pattern | Expression |
|---|---|
| Equality | `equals(Status, 'Active')` |
| Regular expression | `regexp(Email, '^[^@]+@[^@]+\\.[^@]+$')` |
| Negation | `not(equals(Country, 'US'))` |
| Conditional required/format | `not(equals(Country, 'US')) or regexp(State, '^[A-Z]{2}$')` |
| Allowlist | `equals(Status, 'Active') or equals(Status, 'Inactive') or equals(Status, 'Pending')` |

Use `or` to compose alternatives and `not(...)` to express a negated predicate. **Do not invent or rely on an `and` operator:** it is not documented for DVF expressions in this KB. For comparison, LCA action filters have their own documented filter capabilities in `KB-LCA-01`; do not transfer those filter assumptions to DVF syntax.

Authoring rules:

1. Keep one clear business failure and one message per DVF.
2. Prefer short expressions over deeply nested constructs; split unrelated conditions into separate rules.
3. Use business-readable messages that identify the correction, not implementation details.
4. Attach the rule to the right simple attribute or nested path and test a representative payload.
5. For conditional required logic, express the valid alternatives explicitly: for example, “not US” **or** “valid two-letter state.”

## 3. `ERROR` vs. `WARNING` Semantics and Consumer Policy

| Action | Meaning | Recommended consumer behavior |
|---|---|---|
| `ERROR` | A failed validation is an error and normally blocks the validation/save operation. | Treat as blocking unless a documented, approved exception path applies. Return the original message and attribute context to the source or steward. |
| `WARNING` | A failed validation is advisory and may not block processing, depending on the validation context. | Surface it to the user/caller. Decide explicitly whether the integration accepts, escalates, or routes warning-bearing records for review. |

Warnings are not useful if consumers discard them. Configure UI/analytical visibility and ensure API gateway, batch, and stewardship clients parse warning output rather than treating a technically successful response as a clean record. An integration may choose to upgrade a warning to a local gate, but that is an orchestration policy—not a change to DVF semantics—and must be documented consistently.

## 4. Example Rule Catalog

The following configurations illustrate expression patterns; align attribute names and paths to the tenant model.

### Email format

```json
{
  "name": "ValidateEmailFormat",
  "expression": "regexp(Email, '^[^@]+@[^@]+\\.[^@]+$')",
  "action": "ERROR",
  "message": "Email format is invalid."
}
```

### US state condition

```json
{
  "name": "ValidateUsState",
  "expression": "not(equals(Country, 'US')) or regexp(State, '^[A-Z]{2}$')",
  "action": "ERROR",
  "message": "State must be a two-letter code when Country is US."
}
```

### Status allowlist

```json
{
  "name": "ValidateStatusAllowlist",
  "expression": "equals(Status, 'Active') or equals(Status, 'Inactive') or equals(Status, 'Pending')",
  "action": "ERROR",
  "message": "Status must be Active, Inactive, or Pending."
}
```

### Postal-code quality warning

```json
{
  "name": "WarnOnInvalidPostalCode",
  "expression": "regexp(PostalCode, '^[A-Za-z0-9 -]{3,12}$')",
  "action": "WARNING",
  "message": "Postal code format may be invalid."
}
```

### Nested phone number

```json
{
  "name": "ValidatePhoneNumber",
  "expression": "regexp(Phone/Number, '^[0-9]{10}$')",
  "action": "ERROR",
  "message": "Phone number must contain exactly 10 digits."
}
```

## 5. Tenant Enablement and `Reltio/DVFAction` Wiring

A DVF definition alone is not operational. Apply this sequence:

1. Enable DVF support for each target entity type.
2. Enable the relevant relationship type when relationship validation is required.
3. Define and publish the DVFs on the correct attributes or nested paths.
4. Configure the internal `Reltio/DVFAction` in business configuration.
5. Configure analytical attributes that expose attribute-validation outcomes.
6. Make validation errors/warnings visible in the relevant UI layout and response consumer.
7. Validate sample records, then revalidate existing data as needed.

### Entity checklist and wiring

```json
{
  "type": "configuration/entityTypes/HCP",
  "lifecycleActions": {
    "validate": ["Reltio/DVFAction"],
    "beforeSave": ["Reltio/DVFAction"]
  }
}
```

`Reltio/DVFAction` is an internal Reltio action, not a customer-deployed cloud function. `validate` is the primary validation-oriented placement; `beforeSave` may be used where the tenant's supported save flow expects validation. Confirm the supported hook pattern for the tenant before publishing.

### Relationship checklist and wiring

For relationship rules, enable DVF on the relationship type, attach functions to its relevant attributes, and configure the internal action where the tenant model/runtime supports it:

```json
{
  "type": "configuration/relationTypes/HasAddress",
  "lifecycleActions": {
    "validate": ["Reltio/DVFAction"]
  }
}
```

Relationship `validate` behavior can be tenant/runtime dependent. Treat relationship-validation support and hook behavior as an ambiguity to verify against the tenant configuration and `KB-LCA-01 §7`; do not assume entity behavior transfers unchanged.

### Analytical attributes, visibility, and revalidation

Analytical attributes make validation-state summaries available to UI, search, reporting, or data-quality views. A conceptual example is:

```json
{
  "name": "attributeValidations",
  "type": "Analytical"
}
```

Use the tenant's official model schema for exact definitions. Ensure warning output is visible in layouts and validation API responses. Model changes do not automatically refresh validation state on data already loaded: publish, allow propagation where required, rerun representative tests, and execute the supported revalidation flow.

### Safe rollout

Start with one entity type and one clear rule in non-production; wire the action, validate positive and negative samples, confirm warning/error visibility, then add rules incrementally. Revalidate after each change set before expanding the scope.

## 6. LCA vs. DVF Decision Guide

> **Presentation rule:** this choice is an internal routing decision. After resolving it, respond in that single context: give a complete DVF answer for a DVF need or a complete LCA answer for an LCA need. Do not narrate “use LCA, not DVF” (or the reverse) unless the user explicitly requests a comparison or the case is genuinely borderline; then lead with one clear recommendation.

Default to DVF for validation-only rules that can be expressed over attributes and result in an error/warning. Use LCA when the need requires mutation, external calls, lifecycle governance, or post-save effects.

| Need | Recommended approach |
|---|---|
| Regex, allowlist, conditional required field | DVF |
| User-visible attribute error or warning | DVF |
| Validate before ingestion without persistence | Data Validation API + DVF |
| Modify/default/enrich before persistence | LCA `beforeSave` |
| External lookup or policy call | LCA |
| Merge, unmerge, match, delete, reference, or DCR governance | LCA |
| Post-save notification or synchronization | LCA `afterSave` or an appropriate decoupled integration |

| Capability | DVF | LCA |
|---|---|---|
| No-code attribute validation | Yes | No |
| Error/warning output | Yes | Yes, through validation logic |
| Mutation before save | No | Yes |
| External API call | No | Yes |
| Post-save side effect | No | Yes |
| Merge/delete/match governance | No | Yes |
| Cloud deployment / Java required | No | Yes |

### Anti-patterns

- Building a Java `validate` LCA for a simple regex or required-field check; it adds deployment and operational cost and consumes the LCA execution budget.
- Using DVF for enrichment, defaults, or multi-step orchestration; DVF cannot change data.
- Writing back to the same entity in `afterSave` when a value should be set before save; this risks recursive/re-entrant processing.
- Using DVF for merge/delete governance; these are lifecycle-event decisions outside DVF scope.
- Recreating DVF rules independently in every upstream system; central rules should remain governed in Reltio and be invoked through the validation API.

## 7. Migration Playbook: Java `validate` LCA to DVF

### Eligibility

Migrate when the current LCA is expression-based validation only: it reads available attributes, performs no mutation, makes no Reltio/external call, has no event-specific dependency, and maps failures cleanly to user-visible attribute messages.

### Keep the LCA when

Keep Java validation when it depends on external systems or runtime data outside DVF expression scope, requires complex object-state branching that is not practical to author/test as expressions, mutates data, or participates in lifecycle governance beyond validation.

### Steps and rollback

1. Inventory LCA validation branches, messages, target attributes, and consumers.
2. Classify each branch as DVF-eligible or retain it in the LCA; do not force a complex rule into a fragile expression.
3. Create equivalent DVFs with separate, precise messages and test pass/fail payloads.
4. Enable the type, wire `Reltio/DVFAction`, configure analytical/UI visibility, and validate through the same save and pre-ingestion flows used by consumers.
5. Run parallel, non-production comparisons between LCA and DVF outcomes; reconcile intentional differences, especially warnings.
6. Release incrementally, monitor validation responses and exception queues, and revalidate existing records where appropriate.
7. Keep the prior LCA deployment/configuration available until acceptance criteria are met; rollback by restoring its action wiring and removing/disable the new DVF flow according to the tenant change process.

## 8. Troubleshooting DVF

| Symptom | Likely cause | Resolution |
|---|---|---|
| Rule exists but no validation appears | Action not wired, wrong attribute/path, model unpublished, type not enabled, or wrong test flow | Check `Reltio/DVFAction`, target path, published model, enablement chain, and supported validate/save flow. |
| Warning exists but nobody sees it | UI/analytical visibility missing or caller ignores warnings | Expose the relevant validation output and update consumers to parse warning results. |
| Recent changes seem inactive | Propagation delay, stale model revision, or cached test assumptions | Confirm publication/environment state, use a fresh payload, wait if required, and rerun validation. |
| Relationship rule does not behave like entity rule | Relationship validation support/hook behavior differs | Verify the specific tenant relationship configuration and `KB-LCA-01 §7`. |

## 9. Live Data Validation API

The Data Validation API evaluates configured DVFs against entity/relationship data **without persisting** it:

```text
{HTTP Method} {myTenant}/api/{tenantId}/dvf/validate
```

Use it for upstream gates, migrations, profiling, and validation previews. See `KB-LCA-05` for synchronous, batch, and stewardship architectures; confirm exact request/response schemas in the authenticated developer Swagger before implementation.

## 10. Recommendation Checklist for Customer Conversations

1. Does the requirement only flag or reject data, or must it change the data? Flag/reject favors DVF; mutation requires LCA.
2. Does it call an external API, lookup service, or require runtime data beyond the payload? Use LCA.
3. Is it a create/update attribute rule, or merge/unmerge/delete/match/reference/DCR governance? The latter requires LCA.
4. Must feedback occur before tenant persistence? Use the Data Validation API + DVF.
5. Can the condition be expressed with documented functions, `or`, and `not`? If not, retain/evaluate LCA rather than inventing DVF syntax.
6. Who consumes warnings, and are they advisory or locally blocking? Define and test that policy.
7. If DVF is selected, have type enablement, action wiring, publish, visibility, rollout, and revalidation been planned?
