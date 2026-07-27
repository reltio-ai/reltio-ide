## Tracking

- **Jira:** [RP-191824](https://reltio.jira.com/browse/RP-191824) — `[Reltio IDE] LCA Assistant — ship Cursor skill + LCA knowledge base for partners`
- **Components:** Reltio IDE + LCA (content authority for the knowledge base; IDE owns packaging/sync)
- **OpenSpec change:** `lca-assistant` (refreshed after explore 2026-07-22)

## Why

Reltio partners design and ship **Life Cycle Actions (LCAs)** — custom Java/cloud handlers hooked into entity, relation, and DCR pipelines — alongside tenant **L3** metadata. Today, reltio-ide already equips Cursor Agent for **metadata** work (entity/relation/attribute/match playbooks + Velocity Packs), but partners still leave the IDE for LCA design: which hook to use, LCA vs DVF, Maven/Lambda patterns, and how to wire `lifecycleActions` on the correct type. A curated LCA knowledge base already exists in the life-cycle-framework-lambda repo; partners need that corpus **shipped and materialized** inside the Reltio IDE workspace so Cursor Agent can advise with the same plan → ask → change flow used for metadata.

## What Changes

- Add default agent playbook **`skills/reltio-default/lca-assistant/`** (Cursor stub `.cursor/skills/reltio-lca-assistant/` kept as contributor discovery only).
- Bundle the authoritative **8-doc LCA knowledge base** under **`resources/lca-knowledge-base/`**, after **LCA-owner content sign-off** on the snapshot (upstream v3.0).
- Extend **agent asset sync** with **`lcaKnowledgeBaseBundleVersion`** → materialize to **`.reltio/reltio-agent/lca-knowledge-base/`**.
- Skill is **L3-first**: design + `lifecycleActions` wiring is the primary outcome; Maven scaffold is **opt-in** (ask folder; do not claim compile without `repo-dev.reltio.com` credentials).
- Document **partner discovery / how to invoke** (partner workspaces have no `.cursor` stub from this repo — sync + `@` paths + sample prompts).
- Skill is **dual-workspace aware**: branch behavior when L3 is present vs only Java project vs both.
- Ship a short **Tier C demo script** (canned prompts) so behavioral acceptance is reviewable.
- **No** in-extension LLM. **No** runtime Bitbucket pull. Tree insert / schema typing remain follow-ups.

## Capabilities

### New Capabilities

- `lca-assistant-skill`: Agent playbook for LCA advising (L3-first), dual-workspace routing, optional Maven scaffold, partner invoke guidance, and KB retrieval rules.
- `lca-knowledge-base`: Versioned packaging of the 8 KB docs + routing manifest, LCA sign-off gate, and workspace materialization via `lcaKnowledgeBaseBundleVersion`.

### Modified Capabilities

- *(None in `openspec/specs/`.)*

## Impact

- **New paths:** `skills/reltio-default/lca-assistant/SKILL.md`; `resources/lca-knowledge-base/**`; partner invoke notes in `ARCHITECTURE.md` (and skill “When to use” / Inputs).
- **Sync / packaging:** third bundle version; VSIX includes skill + KB.
- **Process:** LCA component owner signs off KB snapshot before merge; PR cites RP-191824.
- **QA:** Tier A sync tests + Tier C demo script (not `mvn package` as a gate).
