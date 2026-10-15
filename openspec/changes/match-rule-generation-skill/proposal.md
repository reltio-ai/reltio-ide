## Why

Jira: RP-202883. Builds on RP-200851 (`git-ready-tenant-folder-structure`). Also delivers RP-201030 (bundled skills never registered for agent discovery); its workspace-root placement point is deferred to RP-202988.

The bundled `match-groups-from-concept` skill is a short checklist. It carries none of the knowledge a correct match rule needs (operators, match token and comparator classes per kind of data, cleansers, scoring, nested attribute URIs), so an agent following it guesses. It cannot test a rule before inserting it, and agents only follow it when the user @-mentions the materialized file under `.reltio/reltio-agent/`.

A reference implementation exists on the Bitbucket branch `feature/match-rule-generation-skill`. This change takes its ideas, not its code: that branch identified the tenant by parsing folder names, which RP-200851 removed; treated a missing session as a hard stop, which leaves repository-mode users with no way to test; wrote Cursor-only copies; and committed tenant configurations and tool logs. Its two OpenSpec changes also contradicted each other on live testing.

## What Changes

- **Skill rewrite.** `match-groups-from-concept/SKILL.md` becomes a full playbook: understand the requirement, resolve names against the configuration, build, check against the schema, test against the tenant, insert, report. A new `reference.md` holds the match-rule knowledge, restricted to fields in the schema and classes used by the shipped Velocity Packs.
- **Read-only verification client.** `verifyMatches()` in `reltioClient.ts` calls `POST /reltio/api/{tenant}/entities/_verifyMatches` with candidate match groups. It never creates, merges or changes entities.
- **Verification bridge.** `src/workspace/matchVerification.ts` answers `.reltio/reltio-agent/match-verification/request.json` with `result.json`, using the session the extension already holds. The request names the configuration file; the extension resolves environment and tenant from its own marker scan. Results are `verified`, `not-verified` (the agent may reason statically, labelled as such) or `failed` (the agent must not insert).
- **Agent discovery.** `src/workspace/agentSkillDiscovery.ts` installs each skill once at `.claude/skills/reltio-<playbook>/`, which Claude Code, VS Code Copilot and Cursor all read, and writes a short always-on guide per agent telling it to report a missing skill instead of improvising. Team overrides in `skills/workspace/` are applied before installing, so the discoverable copy honours the documented precedence. Everything is extension-owned, gitignored and never overwrites a path the extension did not create.
- **User-visible failures.** Sync problems (an occupied path, a skill agents would reject, an exception) now raise a warning with a resync action instead of a console log.
- **Settings.** `reltio.enableMatchVerification` and `reltio.installAgentSkills`, both default `true`.
- `skillsBundleVersion` `1` → `2`.

## Capabilities

### New Capabilities

- `match-rule-verification`: the file bridge and its result contract.
- `agent-skill-discovery`: managed skill copies and missing-skill guides.

### Modified Capabilities

- `guided-model-elements`: match-group guidance grows from a consistency check into generation, schema checking and tested insertion.

## Impact

- Code: `src/api/reltioClient.ts`, `src/workspace/matchVerification.ts` (new), `src/workspace/agentSkillDiscovery.ts` (new), `src/workspace/reltioAgentSync.ts`, `src/extension.ts`, `package.json`.
- Content: `skills/reltio-default/match-groups-from-concept/{SKILL.md,reference.md}`, `skills/README.md`, `resources/reltio-agent-assets.json`.
- Workspace footprint: `.claude/skills/reltio-*/`, `.claude/rules/reltio-skills.md`, `.cursor/rules/reltio-skills.mdc`, `.github/instructions/reltio-skills.instructions.md`, all added to the workspace `.gitignore`.
- Network: one new read-only endpoint, called only when an agent writes a request and a session exists.
- Tests: `scripts/test-match-rule-generation-skill.cjs`; `scripts/lib/memory-fs.cjs` extracted from the RP-200851 test for reuse. `ajv` becomes an explicit dev dependency (it was already installed transitively).
- Out of scope: deploying from the skill, any LLM or MCP server inside the extension, rewriting the other bundled skills.
