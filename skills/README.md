# Reltio agent skills (Cursor / external agents)

## Layout

| Location | Role |
|----------|------|
| `skills/reltio-default/<playbook>/SKILL.md` | Versioned defaults shipped with the extension; reviewed in PRs. |
| `skills/workspace/<playbook>/SKILL.md` | Optional **workspace** overrides at the repo root (same relative paths as under `reltio-default/`). |

## Default playbooks

| Playbook | Concern |
|----------|---------|
| `entity-type-concepts` | Entity types, inheritance, URIs |
| `relation-type-concepts` | Relation types and endpoints |
| `attributes-from-concept` | Simple / nested / reference attributes |
| `match-groups-from-concept` | Match groups |
| `lca-assistant` | Life Cycle Actions (hooks, L3 `lifecycleActions`, KB) — RP-191824 |
| `workspace-merge` | Override precedence vs defaults |

## Precedence

**`skills/workspace/**` wins** over the same logical path under **`.reltio/reltio-agent/skills/default/**`** (materialized copies of `reltio-default` produced by the extension). Where a skill documents additive sections (e.g. extra examples), merges are append-only unless the skill states otherwise.

The extension **never** writes to `skills/workspace/**`; it only refreshes `.reltio/reltio-agent/` (skills, Velocity Packs, and LCA knowledge base).

## Cursor discovery

Thin pointers also live under **`.cursor/skills/`** so Cursor can surface playbooks without duplicating full bodies (**contributor** checkout of this repo). Partner workspaces typically **do not** have those stubs — after sync, invoke via materialized paths under `.reltio/reltio-agent/` (see `lca-assistant` skill “Partner invoke”). Canonical prose remains under `skills/reltio-default/`.

See **`openspec/changes/skills-and-enablement-packs-library/design.md`** (D2, D3, D3b) and **`openspec/changes/lca-assistant/design.md`** for versioning and sync behavior.
