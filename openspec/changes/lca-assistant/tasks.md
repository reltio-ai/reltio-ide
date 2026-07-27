## 0. Preconditions / contribution workflow

- [x] 0.1 Confirm local clone of life-cycle-framework-lambda KB at `.reltio/reltio-agent/lca-knowledge-base/` (manifest `version` / `generated`) is the candidate source.
- [ ] 0.2 Obtain **LCA component sign-off** on RP-191824 that the snapshot may ship in the partner VSIX (design **D3** / **D10**). Record as a Jira comment or checklist item before release cut. *(Implementation landed; human LCA approval still required before partner release.)*
- [x] 0.3 Follow [docs/CONTRIBUTION.md](../../../docs/CONTRIBUTION.md): Propose refreshed; implement via **`/opsx-apply`**.

## 1. Bundle the knowledge base

- [x] 1.1 Create `resources/lca-knowledge-base/` and copy the eight docs + `manifest.json` + `README.md` from the upstream KB (exclude `archive/` and non-indexed files). See design **D3**.
- [x] 1.2 Add provenance in `resources/lca-knowledge-base/README.md` (or `PROVENANCE.md`): upstream path, manifest `version`/`generated`, date of copy, pointer to RP-191824 sign-off.
- [x] 1.3 Verify `manifest.json` `documents[].path` files exist and section line ranges still match (`rg -n '^## '` per file); fix ranges if copy drift occurred.

## 2. Author the LCA assistant skill

- [x] 2.1 Create `skills/reltio-default/lca-assistant/SKILL.md` per design **D2**, **D5**, **D6**, **D7**: when to use; inputs; partner invoke (materialized paths + ≥2 sample prompts); dual-workspace branching; retrieval rules; L3-first `lifecycleActions`; opt-in Maven scaffold (ask folder; compile-credentials caveat); no secrets; no internal KB ids in user answers.
- [x] 2.2 Align `.cursor/skills/reltio-lca-assistant/SKILL.md` pointer (contributor-only) with canonical + materialized KB paths.
- [x] 2.3 Optionally mention `lca-assistant` in `skills/reltio-default/workspace-merge/SKILL.md` if that playbook lists sibling skills (additive only).

## 3. Extend agent asset sync

- [x] 3.1 Add `lcaKnowledgeBaseBundleVersion` to `resources/reltio-agent-assets.json`.
- [x] 3.2 Extend `ReltioAgentAssets` / `ReltioAgentSyncState` and `syncReltioAgentAssets` to copy `resources/lca-knowledge-base` → `.reltio/reltio-agent/lca-knowledge-base` on version change / missing dest / force (**D4**). Keep skills/packs independent.
- [x] 3.3 Update Resync command title/description in `package.json` to mention LCA knowledge base (keep id `reltio.resyncAgentAssets`).
- [x] 3.4 Confirm VSIX packaging includes `resources/lca-knowledge-base/**` and `skills/reltio-default/**`.

## 4. Documentation

- [x] 4.1 Update `ARCHITECTURE.md`: LCA skill path, KB bundle path, third sync version, materialized layout, **partner invoke** (no `.cursor` stub assumption), no in-extension LLM.
- [x] 4.2 Update `skills/README.md` (or equivalent) playbook list to include `lca-assistant`.
- [x] 4.3 Bump `skillsBundleVersion` when `SKILL.md` ships; bump `lcaKnowledgeBaseBundleVersion` when KB files change; cite both + RP-191824 in the PR description.

## 5. Tests, demo script, verification

- [x] 5.1 Add or extend Tier A unit test: sync copies expected KB files when `lcaKnowledgeBaseBundleVersion` advances; does not touch `skills/workspace/**`.
- [x] 5.2 Add Tier C **demo script** (e.g. `openspec/changes/lca-assistant/demo-script.md` or short section under docs) with the three prompts from design **D8**; note that `mvn package` is not a gate.
- [x] 5.3 Run `npm run compile` and `npm test`; fix sync regressions.
- [x] 5.4 `npm run package` and inspect `.vsix` for KB + `lca-assistant/SKILL.md`.
- [ ] 5.5 Manual QA: Extension Development Host → workspace with L3 → confirm materialized KB after activate/resync → run demo-script prompts. *(Human Tier C — use `openspec/changes/lca-assistant/demo-script.md`.)*
- [x] 5.6 `npm run openspec -- validate --changes` (or validate `lca-assistant`) passes.

## 6. Optional follow-ups (out of v1 — track only)

- [ ] 6.1 Maintainer script to refresh KB from a local life-cycle-framework-lambda checkout.
- [ ] 6.2 Deterministic tree/command “Insert lifecycleActions skeleton”.
- [ ] 6.3 Stronger TypeScript/JSON Schema typing for `lifecycleActions`.
- [ ] 6.4 Walkthrough / welcome mention for LCA assistant invoke.
