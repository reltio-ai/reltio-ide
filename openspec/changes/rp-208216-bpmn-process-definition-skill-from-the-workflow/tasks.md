## 1. Playbook: draft, revise, and explain

- [x] 1.1 Update `skills/reltio-default/workflow-bpmn-authoring/SKILL.md` for requirement "Draft, revise, and explain from the bundled playbook" so scenario "A new process is drafted from the adapted prompts" writes one `<definitions>` document with a `bpmndi:BPMNDiagram` and does not add a YES/NO model call. Verify the playbook text states both.
- [x] 1.2 Add the revise instructions for scenario "An existing definition is revised in place": change the current `.bpmn20.xml` and do not invent a second process id. Verify that sentence is in `SKILL.md`.
- [x] 1.3 Add the explain instructions for scenario "An explanation does not rewrite the file": explain without modifying the file and without deploying it. Verify that sentence is in `SKILL.md`.
- [x] 1.4 Fold the missing authoring notes into `skills/reltio-default/workflow-bpmn-authoring/references/bpmn-rules.md` without copying Java prompt text and without naming `BpmnAiService`, `bpmn_context.json`, `explain_context.txt`, `ActivitiDefinitionValidator`, or `BpmnDiCompletenessChecker`. §12 keeps event `36×36`, gateway `50×50`, and task `100×80`, and records the designer sizes as legal. §18 names only `scripts/validate-bpmn-definition.cjs`. Verify those two sections.

## 2. Diagram preview

- [x] 2.1 For requirement "Diagram preview uses the existing viewer", name `reltio.previewWorkflowDiagram` as the step after a write or revision so scenario "A draft is shown with Show BPMN Diagram" is true. Verify `SKILL.md` contains `reltio.previewWorkflowDiagram`.
- [x] 2.2 Satisfy scenario "The skill does not add a second renderer" by leaving BPMN preview on the existing `reltio.previewWorkflowDiagram` command. Verify `package.json` still registers that command and no second preview command was added.

## 3. Local validation script

- [x] 3.1 Add `scripts/validate-bpmn-definition.cjs` as the command and `scripts/lib/validate-bpmn-definition.cjs` as the rules, for requirement "Validate a definition locally without a REST call". Cover scenario "Invalid XML is rejected and nothing is deployed", scenario "Valid XML passes and would still pass deploy", and scenario "Validation makes no REST call" in `scripts/test-bpmn-local-validation.cjs`, and register that test in `scripts/run-unit-tests.cjs`. Verify the command and the lib contain no HTTP client and the tests pass.
- [x] 3.2 Implement requirement "Validation matches the adapter process checks", scenario "A deploy-invalid document fails validation the same way", and scenario "The process graph must match the adapter leaf and start rules": one start event, allowed leaves only, `manualStart`, `true`/`false` data-object values, user-task extension elements, sequence-flow endpoints, and a `decision` enum match. Verify a fixture for each rule fails the script and leaves the file unchanged.
- [x] 3.3 Implement requirement "Diagram completeness matches the adapter checker" and scenario "Diagram interchange must cover shapes and edges": a flow node needs a `BPMNShape` with `Bounds`, and a sequence flow needs a `BPMNEdge` with at least two waypoints. Verify those fixtures fail the script.

## 4. Skill gate before deploy

- [x] 4.1 For requirement "The skill validates before deploy" and scenario "A failed validation blocks deploy", tell the agent to run `node scripts/validate-bpmn-definition.cjs` before `reltio.deployWorkflow`, not to make a REST call to validate, not to deploy on failure, and to stop after at most two repair attempts. Verify those words are in `SKILL.md`.

## 5. Bundle version

- [x] 5.1 For requirement "The updated playbook is installed with the extension" and scenario "A skills bundle version bump materializes the playbook", set `skillsBundleVersion` in `resources/reltio-agent-assets.json` from 26 to 30 and update `PINNED_SKILLS_BUNDLE_VERSION` and `PINNED_SKILLS_HASH` in `scripts/test-workflow-skills-library.cjs` together. Verify `node scripts/test-workflow-skills-library.cjs` passes.

## 6. JAR samples link

- [x] 6.1 Add [github.com/reltio-ai/samples-custom-workflow](https://github.com/reltio-ai/samples-custom-workflow) as an input on `skills/reltio-default/workflow-jar-customization/SKILL.md`, before the optional workspace skill. The same skills-bundle pin in task 5.1 covers this file. Verify the URL is in that `SKILL.md`.
