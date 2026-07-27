# Best Practices, Troubleshooting, Security & Deployment

> Doc ID: `KB-LCA-05` | Category: Operations

## 1. Best Practices (ranked by cross-source recurrence)

1. **Always return `data` from `validate`**, never `null` — the single most-repeated rule across all source material.
2. Return `data` only when actually mutated in `before*` hooks; return `null` for a genuine no-op.
3. Never hardcode credentials — use `IReltioAPI` for Reltio calls, a cloud secret manager for external calls.
4. Null/empty-check before `.get(0)` on any attribute or crosswalk list.
5. Never write back to the same entity inside `afterSave` (recursion risk).
6. Keep LCAs fast — the platform enforces a **100 ms** default execution timeout (see `01_LCA_CORE_CONCEPTS_AND_HOOKS.md`).
7. Select the target crosswalk explicitly by `type`, never by list index.
8. Use `select` query parameters to fetch only the fields you need — both a performance and a data-exposure best practice.
9. One hook/responsibility per class; separate entity vs. relation handlers into different classes/packages.
10. Use `ActionType` to distinguish CREATE/UPDATE/MERGE/SPLIT logic within a single hook.
11. Design every `after*` hook to be idempotent — the platform may retry.
12. Use structured `ValidationError` factory methods (`incorrectAttribute`, `missedAttribute`, etc.), not raw exceptions, inside `validate`.
13. Test with real JSON fixtures via `reltio-lca-test-framework`; enforce ≥92% JaCoCo coverage in CI.
14. Never log full payloads or PII in production — log entity URIs and targeted fields only.
15. Use `filter` conditions in `lifecycleActions` config to avoid unnecessary invocations.
16. Handle API exceptions gracefully — never swallow silently; log with context and rethrow or handle explicitly.
17. Follow a design/review checklist before coding (see §5 project lifecycle playbook).

## 2. Troubleshooting Playbook

| Symptom | Likely Cause | Fix |
|---|---|---|
| LCA never invoked | Wrong hook name/case, wrong entity type, per-request suppression flag set, unreachable endpoint | Verify binding in tenant config, remove suppression, test endpoint connectivity |
| Changes not persisted | `before*` hook returned `null`, or mutated a copy instead of `data.getObject()` | Return `data`; mutate the object in place |
| NPE / `IndexOutOfBoundsException` | `.get(0)` without a null/empty check | Check `isEmpty()`/null before indexing |
| Wrong crosswalk written | Blind `getCrosswalks().get(0)` | Filter by crosswalk `type`, not position |
| `ClassCastException` | Wrong attribute-value interface cast | Use `ISimpleAttributeValue`/`INestedAttributeValue`/`IReferenceAttributeValue` correctly per the model |
| Infinite loop / repeated saves | `afterSave` writes back to the same entity | Move logic to `beforeSave`, or add a re-entrancy guard |
| Timeout / high latency (LCA aborted) | Slow external call, no connection pooling, cold start | Move non-critical work to `afterSave`, reuse HTTP clients, use provisioned concurrency |
| Works in test, fails in prod | Fixture/payload mismatch, more crosswalks in prod, Jackson version conflicts | Recapture real prod fixtures, pin/exclude Jackson explicitly |
| Validation errors not shown to user | `validate` returned `null` | Always `return data` |
| Azure function silent / not triggered | `function.json` entry point mismatch with `@FunctionName` | Match entry point exactly |
| DVF defined but has no effect | `Reltio/DVFAction` not wired into `lifecycleActions`, model unpublished | Wire the action, publish the model, revalidate existing data |
| DVF warning invisible in UI | UI/analytical visibility not enabled | Update UI config; confirm WARNING vs. ERROR action type |

## 3. Security Guidelines

- Never hardcode credentials — use cloud secret managers (AWS Secrets Manager, GCP Secret Manager, Azure Key Vault via Managed Identity), loaded at class-load time.
- Use `IReltioAPI` exclusively for Reltio calls — it auto-carries the caller's OAuth token; don't build a parallel auth path for ordinary Reltio access.
- Validate/sanitize/URL-encode all inputs before sending them to any external call.
- HTTPS only — never disable TLS certificate validation.
- Restrict inbound access to Reltio's known IP ranges where the deployment target supports IP allow-listing.
- Never log PII at INFO level — log entity URIs only; ban `printStackTrace()` in favor of `reltioAPI.log*`.
- Use `select` parameters to minimize the data returned/exposed by any call.
- Keep dependencies patched — run CVE scanning, and always pin/exclude Jackson explicitly (see `02_LCA_CODE_PATTERNS_AND_COOKBOOK.md` pitfall #16).
- Avoid reflection/dynamic class loading in handler code.
- Wrap all third-party/external calls in try-catch to avoid leaking internal stack traces or implementation details.
- Cloud-specific identity: Azure Managed Identity, GCP least-privilege dedicated service account, AWS least-privilege Lambda execution role.

## 4. Deployment & Cloud Connectivity

Connectivity setup is a **one-time prerequisite** before registering any LCA endpoint URL in tenant config. Deployment itself repeats per release.

| | AWS Lambda | GCP Cloud Functions | Azure Functions |
|---|---|---|---|
| Base class | `LifeCycleActionHandler` | `LifeCycleGoogleFunction` | `LifeCycleAzureFunction` (verify current support — see `01_LCA_CORE_CONCEPTS_AND_HOOKS.md` §7 Azure caveat) |
| Connectivity setup | Cross-account IAM role via AWS Console wizard | Service-account impersonation via a Reltio support ticket | Entra ID app registration (recommended) or OAuth2 client_credentials |
| Tenant config value | `"Lambda/BinaryJSON/<name>"` | Full HTTPS URL | Full HTTPS URL (or S3 JAR registration name, per current public docs) |
| Runtime | Java 21, 512MB–1GB, timeout ≥30s | Java 21, 512MB–1GB, timeout ≤60s | Java 21, ≥1GB, Premium plan recommended |
| Cold-start mitigation | Provisioned Concurrency | `--min-instances 1` | Premium plan + Always On |
| Secrets store | AWS Secrets Manager | GCP Secret Manager | Azure Key Vault |

**CI/CD flow:** Maven build → test (JaCoCo ≥92% gate) → deploy to non-prod first → blue/green rollout → feature-flag via tenant config → alert on error rate / p95 latency.

## 5. Project Lifecycle Playbook (process wrapper)

Design → Build → Test → Deploy → Connect → Configure → Verify. This is a purely additive process overlay — it doesn't change any of the technical rules above, just sequences them into a repeatable delivery checklist for a new LCA engagement:

1. **Design** — confirm hook choice against `03_LCA_BUSINESS_USE_CASES.md` and the LCA-vs-DVF check in `04_DVF_AND_LCA_VS_DVF_DECISION_GUIDE.md`.
2. **Build** — follow the Maven template and code patterns in `02_LCA_CODE_PATTERNS_AND_COOKBOOK.md`.
3. **Test** — fixture-based + `LifecycleExecutor` tests, ≥92% coverage.
4. **Deploy** — per the cloud-specific table above, non-prod first.
5. **Connect** — one-time cloud connectivity/IAM setup, done before first tenant-config registration.
6. **Configure** — wire the `lifecycleActions` block on the target type(s), respecting inheritance rules.
7. **Verify** — confirm invocation with a test record, check logs, confirm no timeout alerts, confirm idempotency under retry.
