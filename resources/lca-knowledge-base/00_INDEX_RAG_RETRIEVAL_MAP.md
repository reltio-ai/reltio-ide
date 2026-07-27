# RAG Retrieval Map — Life Cycle Framework Agent

> Doc ID: `KB-LCA-00` | Category: Index / Routing | Read this file FIRST, then retrieve only the doc(s) indicated below.
> This is the single entry point for the `life-cycle-framework` knowledge base. Machine-readable routing (doc list + topics) lives in `manifest.json`; this file is the human/agent-readable version.

## Document Inventory

The KB is exactly **8 retrievable docs** (`KB-LCA-00` … `KB-LCA-07`), plus `manifest.json` (routing index) and `README.md` (maintenance guide). Index only these.

| Doc ID | File | Covers |
|---|---|---|
| `KB-LCA-00` | `00_INDEX_RAG_RETRIEVAL_MAP.md` | This routing map — query-intent → doc + source precedence |
| `KB-LCA-01` | `01_LCA_CORE_CONCEPTS_AND_HOOKS.md` | What an LCA is, architecture, all 32 hooks, config schema, timeouts, gotchas, glossary |
| `KB-LCA-02` | `02_LCA_CODE_PATTERNS_AND_COOKBOOK.md` | Maven project setup, Java handler code patterns, I/O JSON contract, testing, code-level pitfalls |
| `KB-LCA-03` | `03_LCA_BUSINESS_USE_CASES.md` | Business need → hook → complexity mapping table |
| `KB-LCA-04` | `04_DVF_AND_LCA_VS_DVF_DECISION_GUIDE.md` | DVF (no-code validation) overview + LCA-vs-DVF decision framework |
| `KB-LCA-05` | `05_BEST_PRACTICES_TROUBLESHOOTING_SECURITY_DEPLOYMENT.md` | Ranked best practices, symptom→cause→fix troubleshooting, security rules, cloud deployment, delivery playbook |
| `KB-LCA-06` | `06_RELTIO_DOC_PORTAL_REFERENCE.md` | Curated, linked index of the official docs.reltio.com LCA pages with extracted facts |
| `KB-LCA-07` | `07_RELTIO_DATA_INGESTION_API_REFERENCE.md` | Reltio ingestion/API surface mapped to LCA business needs, for customer-facing recommendations |

## Retrieval Rules by Query Intent

Match the user's query to a row below, then retrieve **only** the listed doc(s) — do not pull the whole KB for a narrow question. If a query spans multiple intents, retrieve each matching doc, in the listed priority order, and stop once the answer is well-supported.

| User is asking about... | Retrieve (priority order) |
|---|---|
| "What is an LCA?" / "What hooks exist?" / "What does `beforeSave` do?" / architecture, `ILifeCycleAction`, `IReltioAPI`, `ILifeCycleData` interfaces | `01` |
| Hook execution order, timeout limits, config JSON syntax, `lifecycleActions`, filters, config inheritance | `01` → `06` (for the authoritative doc-portal wording) |
| "How do I write/build an LCA?" / Maven setup / Java code examples / handler patterns / JSON input-output samples / unit tests | `02` |
| "How do I test an LCA?" / `LifecycleExecutor` / fixtures / JaCoCo coverage | `02` |
| "My LCA isn't working" / NPE / infinite loop / timeout / recursion / wrong crosswalk | `02` (code pitfalls) → `05` (troubleshooting table) |
| "What's a real-world use case for X?" / "How would I implement [business requirement] as an LCA?" | `03` → `01` (hook detail) → `02` (code pattern) |
| "Should I use an LCA or a validation rule?" / DVF / no-code validation / "just reject bad data" | `04` |
| Security review, credential handling, PII in logs, secrets management | `05` (security section) |
| Deployment, AWS Lambda/GCP/Azure setup, cloud connectivity, CI/CD | `05` (deployment section) → `02` (Maven/build detail) |
| Best-practice checklist / project delivery process / design-build-test-deploy playbook | `05` |
| "What does the official Reltio doc say about X?" / need a citable, authoritative link | `06` |
| LCA Service API / registering, deleting, or listing actions via REST / Action object schema | `06` (§LCA Service API) |
| "How do I disable/turn off an LCA?" / `executeLCA=false` / deregistration | `06` (§Disable or Deregister LCA) |
| Ingestion API questions — entities, relations, bulk load, merge/unmerge API, matches API, connectors | `07` → `03` (to connect back to a business need) |
| "What Reltio API should a customer use for X business need?" | `07` → `03` |
| Ambiguous/contradictory internal guidance — "which source is right?" | Check the "Known Ambiguities" section in `01` §7 first; prefer `06` (doc portal) as authoritative for anything it explicitly states |

## Precedence Rules (when sources conflict)

1. **`06_RELTIO_DOC_PORTAL_REFERENCE.md` wins** for anything it explicitly and directly states — it mirrors the live, actively-maintained docs.reltio.com content (pages were updated as recently as May 2026).
2. **`01_LCA_CORE_CONCEPTS_AND_HOOKS.md` §7 "Known Ambiguities"** flags every place internal engineering material and public docs disagree. Always check it before making a confident claim about hook availability, Azure deployment model, or the `validate` hook's current status.
3. For pure code-level implementation detail (Maven coordinates, Java patterns) not covered by the public doc portal, `02_LCA_CODE_PATTERNS_AND_COOKBOOK.md` is the best available source — but flag it as "internal engineering guidance, confirm current framework version" when giving it to a customer.
4. For live API request/response schemas, none of these docs replace the authenticated Swagger UI at `developer.reltio.com/private/swagger.htm`. Always tell the user/customer to confirm exact payloads there before implementation.

## Answering Pattern for the Agent

1. Classify the query using the table above and retrieve the minimum doc set needed.
2. **Resolve LCA vs. DVF internally first** (use `04`). This is an internal routing decision — do **not** narrate the comparison to the user. Answer in **one context only**:
   - Resolved to **LCA** → give a complete, LCA-only answer (hook choice, config, code, deployment). Do **not** add "not DVF" framing or DVF caveats.
   - Resolved to **DVF** → give a complete, DVF-only answer, with no LCA framing.
   - Present both sides **only** when the user explicitly asks "LCA or DVF?", or the choice is genuinely borderline — and even then, lead with a single clear recommendation.
3. **Gather the context you need before giving a full build answer.** If key details are missing, ask targeted clarifying questions first rather than assuming. For any LCA design/build request, confirm at minimum:
   - the **entity type** the LCA targets (or the relationship / DCR type) — e.g. `HCP`, `HCO`;
   - the **exact L3 attributes** (attribute names/paths from the tenant's L3 data model) the LCA must read or write — reference these real attribute names in the design and code, and never invent attribute names;
   - trigger conditions (create/update/merge/…), the owning source/crosswalk, and the target cloud (AWS/GCP/Azure) when they affect the answer.
4. **Do not expose internal KB references in the response.** Doc IDs (`KB-LCA-##`), file names, and line numbers are for internal routing only — keep them out of the user-facing answer. Provide them **only** if the user explicitly asks where the guidance came from. You may still cite authoritative external `docs.reltio.com` URLs when they add value.
5. If the customer wants a **full project** (not just a snippet), generate the complete LCA Maven project scaffold per `02` and place it in the workspace (reltio-ide), or provide a downloadable link — whichever the environment supports.
6. If the answer depends on a platform version-specific detail flagged as ambiguous in `01` §7, say so explicitly rather than guessing.
