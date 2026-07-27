---
name: reltio-lca-assistant
description: Advise on Reltio Life Cycle Actions (hooks, LCA vs DVF, L3 lifecycleActions, optional Maven scaffold) using the bundled LCA knowledge base and tenant L3.
---

# LCA assistant

Normative product context: `openspec/changes/lca-assistant/design.md` (D2, D5, D6). Tracking: RP-191824.

## When to use

The user asks about **Life Cycle Actions**: hook choice, architecture, config, troubleshooting, LCA vs DVF, wiring `lifecycleActions` on entity/relation/change-request types, or scaffolding an LCA Java/Maven project.

## Partner invoke (no `.cursor` stub in partner workspaces)

After Reltio IDE activates (or **Resync agent assets**), assets live under the workspace:

- Skill: `.reltio/reltio-agent/skills/default/lca-assistant/SKILL.md`
- Knowledge base: `.reltio/reltio-agent/lca-knowledge-base/` (start at `manifest.json` or `00_INDEX_RAG_RETRIEVAL_MAP.md`)

Ask Cursor to follow this playbook, or `@`-reference those paths. Optional team override: `skills/workspace/lca-assistant/SKILL.md`.

**Sample prompts**

1. What does the `beforeSave` hook do, and when should I use it?
2. Using our open L3, attach a `beforeSave` LCA on entity type \<Name\> for enrichment — use real attribute URIs only.
3. Scaffold a Maven LCA project for that action into folder \<path\> (confirm before writing).

## Inputs

1. Active tenant **`L3.reltio.json`** / `*.reltio.json` when present.
2. Materialized KB: **`.reltio/reltio-agent/lca-knowledge-base/`** (routing via `manifest.json` / `00_INDEX…`).
3. Optional: existing LCA Java/Maven project in the workspace.

## Dual-workspace branching

| Context | Behavior |
|---------|----------|
| L3 present | **L3-first**: inventory types/attributes; propose hooks + `lifecycleActions`; ground names in real URIs. |
| Java/Maven only (no L3) | Advise from KB; **ask** for L3 path or concrete attribute URIs — never invent L3 names. |
| Both | Ground in L3; edit code only in a **user-agreed** folder. |

## Procedure

1. **Classify intent** — Read `manifest.json` `retrieval_routing` (or `00_INDEX…`). Retrieve the **minimum** doc set only; prefer section chunks.
2. **LCA vs DVF** — Resolve via KB-04 internally. Narrate the comparison only if the user asks or the choice is borderline. Answer in one context (LCA-only or DVF-only) otherwise.
3. **Clarify before build/wire** — Entity/relation/DCR type; real L3 attribute paths; trigger; cloud target when relevant.
4. **Propose** — Hook(s), action name format (`MyAction`, `Reltio/…`, `Lambda/BinaryJSON/…`, `GoogleFunction/…`, Azure HTTPS URL), and `lifecycleActions` JSON on the correct type.
5. **Apply L3 (primary)** — Patch `lifecycleActions` with case-sensitive hook names; preserve sequential lists or conditional `{ actions, filter }` groups.
6. **Scaffold Maven (opt-in only)** — Only if the user explicitly asks. Confirm target folder. Follow KB-02 patterns. Do not overwrite unrelated repos. State that **compile may require** access to Reltio Maven repos (`repo-dev.reltio.com`). Never embed secrets/tokens/PII (KB-05).
7. **User-facing answers** — Do not expose internal `KB-LCA-##` / file/line refs unless the user asks for sources. You may cite `docs.reltio.com` via KB-06. Surface known ambiguities (KB-01 §7) instead of guessing.

## Outputs

- Short plan: hook, action name, L3 URI, attributes touched.
- L3 patch and/or agreed Maven scaffold.
- Deploy/test pointers from KB-05 when relevant (deploy remains outside the IDE).
