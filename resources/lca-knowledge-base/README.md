# LCA Assistant Knowledge Base (bundled copy)

> **reltio-ide packaging:** This is a maintained copy for the Reltio IDE VSIX. See **`PROVENANCE.md`** for upstream version and RP-191824 sign-off. Content authority remains with the LCA team / life-cycle-framework-lambda repo.

This directory holds **8 focused, retrieval-optimized documents** (`KB-LCA-00` … `KB-LCA-07`) plus `manifest.json`
(routing index) and this `README.md`. Any agent should index and serve **only these 8 docs**.

```
00_INDEX_RAG_RETRIEVAL_MAP.md                  Start here — query-intent routing + source precedence
01_LCA_CORE_CONCEPTS_AND_HOOKS.md              Architecture, all 32 hooks, config schema, gotchas, known ambiguities
02_LCA_CODE_PATTERNS_AND_COOKBOOK.md           Maven setup, Java handler patterns, I/O JSON contract, testing, pitfalls
03_LCA_BUSINESS_USE_CASES.md                   Business need -> hook -> complexity map
04_DVF_AND_LCA_VS_DVF_DECISION_GUIDE.md        DVF (no-code validation) + LCA-vs-DVF decision framework
05_BEST_PRACTICES_TROUBLESHOOTING_SECURITY_DEPLOYMENT.md   Ranked best practices, troubleshooting, security, cloud deploy
06_RELTIO_DOC_PORTAL_REFERENCE.md              Curated, citable index of the official docs.reltio.com LCA pages
07_RELTIO_DATA_INGESTION_API_REFERENCE.md      Reltio ingestion/API surface mapped to LCA business needs
manifest.json                                  Doc list, per-doc topics/sections, and the intent-routing table
README.md                                      This file
```

## Why 8 focused docs (token efficiency + accuracy)

This KB was rebuilt on **2026-07-21** by comparing two prior knowledge bases and keeping the better
one, so agents stay **cheap** and **correct**:

- **Retrieve only what the query needs.** Each doc has a single job, so the agent pulls one small doc
  (all are under ~200 lines) instead of scanning a ~6,000-line mega-file. `00`'s intent table and
  `manifest.json`'s `retrieval_routing` map a query straight to the right doc(s).
- **Deduplicated.** Facts that used to appear in three+ places (e.g. the hook catalog) are now stated
  once, in the owning doc, with everything else cross-referencing it — no duplicate-retrieval noise.
- **Self-contained cross-references.** Every internal pointer resolves to one of these 8 docs (by
  `KB-LCA-##` doc ID and section), so an agent never has to open an out-of-scope file to follow a
  reference — fewer round-trips, no dangling links.
- **Verified against source and the live doc portal.** The 32-hook catalog and the `validate` hook
  were re-checked against this repo's `src/main/java/com/reltio/lifecycle/framework/ILifeCycleAction.java`;
  `06` mirrors the actively-maintained docs.reltio.com pages. Where internal notes and the public docs
  disagree, `01` §7 flags it rather than silently picking a side.

## How agents should use this KB

1. Read `manifest.json` (or `00`) for the doc list, `topics`, `retrieval_routing`, and per-section line ranges.
2. Classify the query and retrieve the **minimum** doc set for that intent.
3. Retrieve at **section granularity** — section line ranges in `manifest.json` are the intended chunk boundaries.
4. Keep internal KB references (doc IDs like *KB-LCA-01*, file names, and line numbers) **out of the user-facing answer** — use them only for internal routing, and surface them only if the user explicitly asks for sources. You may cite authoritative `docs.reltio.com` URLs (via `06`) when they add value.
5. **Precedence when sources conflict:** `06` (doc portal) wins for anything it states explicitly;
   check `01` §7 for known ambiguities; for live REST request/response schemas, defer to the
   authenticated Swagger UI (`developer.reltio.com/private/swagger.htm`).

## Editing / refreshing

- **Edit content here.** This directory is the source of truth; downstream copies are refreshed *from* here.
- After any edit that changes a doc's line count, **recompute that doc's section line ranges** in
  `manifest.json` (`rg -n '^## ' <file>`) so retrieval chunk boundaries stay correct.
- Keep references **internal** — point to one of the 8 docs by `KB-LCA-##` + section, never to a file under `archive/`.
- Re-crawl `06`'s source pages periodically — the public docs move faster than this internal KB.

## Archive

Prior material — the earlier 3-file consolidation, the old README/manifest, the legacy per-topic files,
the DVF expansion pack, and out-of-scope meta files (an agent-ops-api system prompt and a
time-to-value narrative) — is retained under `archive/` for provenance only. It is **not indexed, not
served, and not referenced** by the 8 authoritative docs. Do not re-introduce it into retrieval.
