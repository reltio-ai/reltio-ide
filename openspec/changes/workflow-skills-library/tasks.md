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

## 7. Content quality pass (D6) — sourced against the public Reltio Workflow repository

- [x] 7.1 Add `bpmn-rules.md` §12 "Known Ambiguities / Needs Verification", modeled on the (reverted) LCA assistant's KB-01 §7: separate confirmed-against-source, inferred-from-observed-behavior, and genuinely-unresolved tiers. Found and documented two real discrepancies against `github.com/reltio-ai/workflow`'s own OOTB files: `dcrTwoApprovals.bpmn20.xml` omits the type task listener entirely (contradicts treating it as unconditionally mandatory), and the OOTB form-property validator package (`core.task.validator`) differs from the public repo's source-tree package (`activiti.service.validators`) for the same class names.
- [x] 7.2 Add `bpmn-rules.md` §13 and `references/reltio-doc-portal-reference.md`: official docs.reltio.com pages **do** exist for this domain (unlike an initial assumption going in) plus the public `github.com/reltio-ai/workflow` source repository, both indexed with a precedence rule — official source wins, conflicts get flagged in §12, not silently resolved.
- [x] 7.3 **Revised scope, see below:** document `RelationTypeTaskListener` and `SingleEntityTaskValidator` — confirmed to exist in the public source but previously undocumented here. Not added to §5's class tables: they are not in this extension's editor-enforced allow-list (`RELTIO_OOTB_CLASSES` in `src/workflow/bpmnDiagnostics.ts`), and §5 and that allow-list are kept in lockstep by a test, so adding one without the other would make the doc and the enforced list disagree. Documented instead in §12.5 as known-but-not-yet-wired-in, with an explicit "do not put either name in generated BPMN" until a maintainer adds both together.
- [x] 7.4 Add a "Sample prompts" section (2–3 prompts) to all four `SKILL.md` files, modeled on the LCA assistant's `SKILL.md`.
- [x] 7.5 Add `openspec/changes/workflow-skills-library/demo-script.md`: a Tier C behavioral script, modeled on the LCA assistant's `demo-script.md`, weighted toward `workflow-bpmn-authoring` (three prompts) with one prompt per remaining playbook plus a cross-cutting check that the agent surfaces §12's ambiguity rather than asserting false confidence.
- [x] 7.6 Bump `skillsBundleVersion` `"5"` → `"6"` (content-only change to shipped `SKILL.md`/`references/` files).
- [ ] 7.7 **Not done, cannot be done by this pass:** `bpmn-rules.md` has never had sign-off from a Reltio Workflow-platform SME — it was authored and validated against observed tenant behavior by this IDE team, the same gap the LCA assistant's `PROVENANCE.md` required LCA-team sign-off to close. Flagged as an open risk for a human to act on.
