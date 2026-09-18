## 1. Playbooks

- [x] 1.1 Add `skills/reltio-default/workflow-bpmn-authoring/SKILL.md` in house style, whose first Input is the rules reference marked as required reading before any XML (D1).
- [x] 1.2 Add `skills/reltio-default/workflow-bpmn-authoring/references/bpmn-rules.md`: namespace block, process-id rules, mandatory `userTask` create listeners, the four gateway rules, OOTB class allow-list, schema ordering, file-name contract, standard topologies, ten-item validation checklist, deny-list — each entry naming the failure it prevents.
- [x] 1.3 Add `workflow-jar-customization/SKILL.md`, leading with "is Java actually required?" (D2) and stating the review gate as a gate (D3).
- [x] 1.4 Add `workflow-repo-contribution/SKILL.md` covering repository access → local proof → PR → Reltio review → pipeline build → notification → registration.
- [x] 1.5 Add `workflow-local-adapter-setup/SKILL.md` (D4).

## 2. Delivery

- [x] 2.1 Add four `.cursor/skills/reltio-<folder>/SKILL.md` pointers, 1:1 with the playbooks.
- [x] 2.2 Bump `skillsBundleVersion` `"1"` → `"2"` in `resources/reltio-agent-assets.json`; leave `velocityPacksBundleVersion` alone.
- [x] 2.3 Confirm no change to `reltioAgentSync.ts` is needed — `copyDirectory` already recurses, so `references/` ships.

## 3. Curation

- [x] 3.1 Exclude internal-only material: internal skill cross-references, internal error-catalogue numbering, config-cache tooling, AWS credential guardrails, direct S3 actions (D5).
- [x] 3.2 Keep descriptive S3 mentions — a customer should understand where their JAR comes from; what is excluded is instruction to act on it.
- [x] 3.3 Do not ship `skill-improver` or any other internal-only skill.

## 4. Tests

- [x] 4.1 Add `scripts/test-workflow-skills-library.cjs` covering the ten Tier B assertions in design.md.
- [x] 4.2 Register it in the hardcoded `SCRIPTS` array in `scripts/run-unit-tests.cjs`.
- [x] 4.3 Mutation-check the curation guard and the bundle-version assertion.

## 5. Docs

- [x] 5.1 Note the workflow playbooks in `ARCHITECTURE.md`'s agent-assets section.
- [x] 5.2 `npm run compile` and `npm test` green apart from the pre-existing velocity-packs failure; `npx openspec validate --changes` clean for this change.

## 6. Blocked on manual QA

- [ ] 6.1 Confirm the four folders materialise into a workspace carrying an older `.sync-state.json`.
- [ ] 6.2 Ask an assistant for a two-step approval BPMN in that workspace and confirm it reads the rules file, reports the checklist item by item, and produces a BPMN that deploys first time.
