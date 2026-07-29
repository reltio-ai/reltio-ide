# Reltio agent skills (Cursor / external agents)

## Layout

| Location | Role |
|----------|------|
| `skills/reltio-default/<playbook>/SKILL.md` | Versioned defaults shipped with the extension; reviewed in PRs. |
| `skills/workspace/<playbook>/SKILL.md` | Optional **workspace** overrides at the repo root (same relative paths as under `reltio-default/`). |

## Precedence

**`skills/workspace/**` wins** over the same logical path under **`.reltio/reltio-agent/skills/default/**`** (materialized copies of `reltio-default` produced by the extension). Where a skill documents additive sections (e.g. extra examples), merges are append-only unless the skill states otherwise.

The extension **never** writes to `skills/workspace/**`; it only refreshes `.reltio/reltio-agent/`.

## Cursor discovery

Thin pointers also live under **`.cursor/skills/`** so Cursor can surface playbooks without duplicating full bodies. Canonical prose remains under `skills/reltio-default/`.

See **`openspec/changes/skills-and-enablement-packs-library/design.md`** (D2, D3, D3b) for versioning and sync behavior.
