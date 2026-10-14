# Reltio agent skills (Cursor / external agents)

## Layout

| Location | Role |
|----------|------|
| `skills/reltio-default/<playbook>/SKILL.md` | Versioned defaults shipped with the extension; reviewed in PRs. |
| `skills/workspace/<playbook>/SKILL.md` | Optional **workspace** overrides at the repo root (same relative paths as under `reltio-default/`). |

## Precedence

**`skills/workspace/**` wins** over the same logical path under **`.reltio/reltio-agent/skills/default/**`** (materialized copies of `reltio-default` produced by the extension). Where a skill documents additive sections (e.g. extra examples), merges are append-only unless the skill states otherwise.

The extension **never** writes to `skills/workspace/**`; it only refreshes `.reltio/reltio-agent/`.

## Agent discovery

The extension also installs each default skill at **`<workspace>/.claude/skills/reltio-<playbook>/`**, where Claude Code, GitHub Copilot in VS Code and Cursor find it without an `@`-mention, plus a second copy in the editor's own folder: `.cursor/skills/` in Cursor, `.github/skills/` in VS Code. Alongside go short always-on guides (`.claude/rules/reltio-skills.md`, and `.cursor/rules/reltio-skills.mdc` in Cursor or `.github/instructions/reltio-skills.instructions.md` in VS Code) telling agents to report a missing skill instead of guessing. Only the running editor's folders exist; opening the workspace in another editor swaps them. All of these are generated, gitignored and owned by the extension; `reltio.installAgentSkills` turns them off. Durable edits belong in `skills/workspace/**`.

The discoverable copy already has the precedence applied: an override is laid over its default file by file, so an override that only replaces `SKILL.md` keeps the default `reference.md`. An override must keep the default's `name`; one that changes it is reported and nothing is installed for that playbook. A folder under `skills/workspace/` with no default counterpart is installed as a skill of its own. Edits to overrides reach agents on the next sync, which runs automatically when a file under `skills/workspace/` changes.

A skill's frontmatter `name` must be `reltio-<playbook>` (lowercase letters, digits, single hyphens, at most 64 characters) and its `description` at most 1024 characters, or agents reject it. The thin pointers under this repository's own `.cursor/skills/` are for contributors only.

See **`openspec/changes/skills-and-enablement-packs-library/design.md`** (D2, D3, D3b) for versioning and sync behavior.
