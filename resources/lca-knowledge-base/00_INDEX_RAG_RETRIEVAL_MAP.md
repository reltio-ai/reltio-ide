# RAG Retrieval Map — Life Cycle Framework Agent

> Doc ID: `KB-LCA-00` | Category: Index / Routing | Read this file FIRST, then retrieve only the doc(s) indicated below.
> Machine-readable routing lives in `manifest.json`. Prefer **section-level** retrieval (`manifest.json` line ranges) to minimize tokens.

## Document Inventory

The KB is exactly **7 retrievable docs** (`KB-LCA-00` … `KB-LCA-06`), plus `manifest.json` and `README.md`. Index only these.

| Doc ID | File | Covers |
|---|---|---|
| `KB-LCA-00` | `00_INDEX_RAG_RETRIEVAL_MAP.md` | Intent routing + source precedence |
| `KB-LCA-01` | `01_LCA_CORE_CONCEPTS_AND_HOOKS.md` | Architecture, 32 hooks, config, ambiguities, decision tree, business-need→hook map |
| `KB-LCA-02` | `02_LCA_IMPLEMENTATION_HANDBOOK.md` | SDK, cookbook, helpers, production patterns, JSON fixtures, testing, pitfalls |
| `KB-LCA-03` | `03_DVF_AND_LCA_VS_DVF_DECISION_GUIDE.md` | DVF authoring, enablement, ERROR/WARNING, LCA-vs-DVF, migration |
| `KB-LCA-04` | `04_OPS_SECURITY_CONNECTIVITY_DEPLOYMENT.md` | Best practices, troubleshooting, security, cloud connectivity, runtime/CI-CD |
| `KB-LCA-05` | `05_EXTERNAL_DOCS_AND_INGESTION_APIS.md` | docs.reltio.com LCA facts + ingestion/pre-ingestion APIs |
| `KB-LCA-06` | `06_MAVEN_PROJECT_TEMPLATES.md` | Full Maven POMs, assembly descriptors, build/deploy CLI |

## Retrieval Rules by Query Intent

Retrieve **only** the listed doc(s), at section granularity when possible. Stop once the answer is well-supported.

| User is asking about... | Retrieve |
|---|---|
| What is an LCA / hooks / architecture / decision tree / config / use-case→hook | `01` |
| Write/test LCA / SDK / cookbook / helpers / production pattern / JSON fixtures | `02` (one doc — pick the matching §) |
| Maven / POM / assembly / JaCoCo / scaffold project | `06` |
| LCA vs DVF / DVF expression / enablement / migration / WARNING vs ERROR | `03` |
| Pre-ingestion validation / exception queue / which ingestion API | `05` → `03` if validation-only |
| Not working / NPE / recursion / timeout / security / secrets / connectivity / deploy runtime | `04` (code pitfalls also in `02`) |
| Official citable doc / LCA Service API / disable-deregister | `05` |
| Ambiguous guidance | `01` §Known Ambiguities; prefer `05` for portal facts |

## Precedence Rules (when sources conflict)

1. **`05` (doc portal facts)** wins for anything it states explicitly from docs.reltio.com.
2. **`01` Known Ambiguities** flags validate-hook / Azure / timeout disagreements.
3. Implementation: `06` Maven; `02` code/patterns/fixtures; `04` connectivity/ops; `03` DVF.
4. Live REST schemas → authenticated Swagger (`developer.reltio.com/private/swagger.htm`), not this KB alone.

## Answering Pattern for the Agent

1. Classify via the table; retrieve the minimum section set.
2. Resolve LCA vs DVF vs purpose-built API internally (`03` / `05`); answer in **one context** unless the user asks for a comparison.
3. **Tenant L3 gate:** if the query is about tenant objects (types, attributes, existing `lifecycleActions`, generate/scaffold for a named type), require a connected tenant `L3.reltio.json` under `*.reltio.tenant/`. If the Reltio IDE plugin is not connected to any tenant (or L3 is not fetched), **stop** and ask the user to connect (Setup Wizard / Add Tenant / Get Configuration). Do not invent URIs or substitute packs/samples. Generic hook/architecture questions may use the KB without L3.
4. **Resolve names against L3:** exact-match entity types (e.g. `HCP`, `HCO`), relation types (e.g. `HasAddress`), DCR types, and attribute names against the connected tenant L3 from the Reltio IDE plugin. If a name is missing or only a near-miss (e.g. `CourseTopics` vs `Course`), **stop this turn**: suggest L3 options, ask the user to **confirm the actual name**, and do **not** generate LCA code (or silently use the similar type, workspace spec, or cloud templates) until they confirm.
5. **Code-generation confirmation (generate/update only):** if the object type, hook, and attributes to **read** vs add/update are already an exact L3 match, generate Java without asking. Ask only for a fact that is missing or not an exact match. Do not ask again when it is already known. Conceptual answers skip this step. A question or a mention of LCA does not start implementation. Run the workflow `step` gate and obey `allowedActions`. If `writeFiles` is false, do not create or edit files. Deploy only after an explicit yes. Check `.env` and the tenant physical configuration instead of asking the user to confirm them. Never ask for secret values.
6. Treat unresolved tenant L3 names as unknown. Never invent attribute names. Project decisions stay inside the active working directory and tenant.
7. Generate LCA code (`06` scaffold + `02` patterns/fixtures/tests) into the current working directory when the object, hook, and attributes are already known. Do **not** patch tenant L3 until the cloud function deploy succeeds. After that success, apply the `lifecycleActions` change automatically and then tell the user what was registered. Do **not** write a `lifecycleActions` change for a different type or directory.
8. After generating code, the only question is whether to deploy. If `.env` already has the cloud access details, deploy with them when the user says yes. If a detail is missing, say which key or console field is missing and do not ask the user to confirm something you can check. Document **further steps** for verification. Validation-only rules prefer DVF and do not generate an LCA.
9. Do not expose internal KB IDs/paths/line numbers unless the user asks for sources. Cite `docs.reltio.com` from `05` when useful.
