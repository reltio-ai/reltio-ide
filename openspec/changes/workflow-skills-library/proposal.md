## Why

Parts 1 and 2 hand a customer a real BPMN file to edit. Their AI assistant knows nothing about Reltio Workflow, so it will write plausible-looking BPMN that Activiti rejects at deploy, or worse, accepts and then fails at runtime — an invented `activiti:class`, a `userTask` missing its two mandatory create listeners, a gateway with a condition on its default flow.

The extension already ships five agent playbooks into `.reltio/reltio-agent/skills/default/` through `reltioAgentSync.ts`. The mechanism needs no new code; it needs content.

The point is determinism, not advice. An assistant following these should produce a deployable BPMN on the first attempt, because the rules that decide deployability are stated as rules with named failure modes rather than left to judgement.

## What Changes

- **Four playbooks** under `skills/reltio-default/`: `workflow-bpmn-authoring`, `workflow-jar-customization`, `workflow-repo-contribution`, `workflow-local-adapter-setup`.
- **One reference file**, `workflow-bpmn-authoring/references/bpmn-rules.md`: the exact namespace block, the mandatory listener pair, the four gateway rules, the complete OOTB class allow-list, the schema ordering constraints, a ten-item validation checklist and a deny-list — each entry naming the error code or silent failure it prevents. `copyDirectory` in `reltioAgentSync.ts` recurses, so the subfolder ships.
- **Four Cursor pointers** under `.cursor/skills/`, 1:1 with the playbooks as for every existing skill.
- **`skillsBundleVersion` bumped `"1"` → `"2"`** in `resources/reltio-agent-assets.json`. Without it the sync gate is a string equality against the user's `.sync-state.json` and existing users never receive any of this.

## Capabilities

**Content**
- New: four `SKILL.md`, one `references/bpmn-rules.md`, four `.cursor/skills/*/SKILL.md`
- Modified: `resources/reltio-agent-assets.json`, `ARCHITECTURE.md`

**Tests**
- `scripts/test-workflow-skills-library.cjs`: bundle version bumped, every playbook present and materialisable, house-style conformance (two frontmatter fields, the four sections in order, the workspace-override input), pointer/playbook 1:1, and a curation guard that fails on internal-only content.

**Not in scope**
- Shipping `skill-improver` or any other internal-only skill. The internal `.claude/skills/workflow-*` set stays internal and keeps its own purpose.
- Running local adapter setup from the IDE. The playbook guides it; the extension does not orchestrate it.
- Any change to `reltioAgentSync.ts` — the delivery mechanism is already correct.
