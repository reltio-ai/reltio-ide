# LCA Assistant Knowledge Base (bundled copy)

> **reltio-ide packaging:** Maintained copy for the Reltio IDE VSIX. See **`PROVENANCE.md`** for upstream version and RP-191824 sign-off. Content authority remains with the LCA team / life-cycle-framework-lambda repo.

**7 retrieval-optimized docs** (`KB-LCA-00` … `KB-LCA-06`) plus `manifest.json` and this README.
Index and serve **only these 7 docs**.

```
00_INDEX_RAG_RETRIEVAL_MAP.md                 Intent routing (read first)
01_LCA_CORE_CONCEPTS_AND_HOOKS.md             Hooks, config, ambiguities, use-case→hook
02_LCA_IMPLEMENTATION_HANDBOOK.md             SDK + cookbook + patterns + fixtures + tests
03_DVF_AND_LCA_VS_DVF_DECISION_GUIDE.md       DVF authoring & LCA-vs-DVF
04_OPS_SECURITY_CONNECTIVITY_DEPLOYMENT.md    Ops, security, connectivity, deploy
05_EXTERNAL_DOCS_AND_INGESTION_APIS.md        Doc portal facts + ingestion APIs
06_MAVEN_PROJECT_TEMPLATES.md                 Maven POMs / assembly / deploy CLI
manifest.json                                 Section line ranges + retrieval_routing
README.md                                     This file
```

## Why this shape (token efficiency)

Restructured **2026-07-27** from 12 overlapping docs into 7 intent-aligned docs:

| Always co-retrieved before | Now |
|---|---|
| `02` + `10` + `11` for "write an LCA" | Single `02` handbook (section-chunked) |
| `03` + `01`/`10` for business need | Use-case table inside `01` |
| `05` + `09` for deploy/connect | Single `04` ops doc |
| `06` + `07` for external APIs/docs | Single `05` external reference |

- **Route once** via `00` / `manifest.json`.
- **Load one section**, not a whole mega-file and not 3 sibling files with the same facts.
- **Maven stays separate** (`06`) — large copy-paste XML; only pulled for scaffold/deploy CLI intents.

## Editing

- Prefer editing in life-cycle-framework-lambda, then refresh this tree.
- After edits that change line counts, recompute `manifest.json` section ranges (`rg -n '^## ' <file>`).
- Keep references internal to `KB-LCA-00`…`06`.
- Bump `lcaKnowledgeBaseBundleVersion` in `resources/reltio-agent-assets.json` so partner workspaces re-materialize.
