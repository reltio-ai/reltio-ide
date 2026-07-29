---
name: reltio-workspace-merge
description: Combine team skill overrides with defaults without silent conflicts.
---

# Workspace merge (skills)

Normative product context: `openspec/changes/skills-and-enablement-packs-library/design.md` (D3, D3b).

## When to use

The repo uses **`skills/workspace/**`** (or Cursor workspace skills) alongside bundled defaults.

## Rules

1. **Overrides** — A file at `skills/workspace/<playbook>/SKILL.md` overrides the same path under **`.reltio/reltio-agent/skills/default/<playbook>/SKILL.md`** for that playbook name (`entity-type-concepts`, etc.).
2. **Extension sync** — The extension **only** refreshes `.reltio/reltio-agent/skills/default/**` and **`velocity-packs/**`**. It **never** deletes or writes `skills/workspace/**`.
3. **Additive sections** — Unless a workspace skill explicitly defines merge semantics, treat “Examples” blocks as **append-only**: default examples remain conceptually present; workspace adds local policy (PII, locale-specific labels).
4. **Conflicts** — If workspace guidance contradicts defaults, the workspace copy **wins** for that playbook. Call out the divergence in agent summaries so authors know which file governed the answer.

## Procedure

1. Check whether `skills/workspace/<playbook>/SKILL.md` exists before answering.
2. Prefer quoting **workspace** sections when they exist; otherwise quote **default** (materialized or `skills/reltio-default/`).
3. After extension upgrades, remind authors that **defaults** may refresh; workspace files are stable until the team edits them.
