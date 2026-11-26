## Why

Partners authoring a workflow in Reltio IDE follow `workflow-bpmn-authoring`, which can draft a file and open the existing diagram preview, but it does not explain a definition the way the Workflow Adapter AI endpoint does. The adapter rejects a bad definition before deploy by walking the XML. The playbook has no equivalent local check, so invalid XML is discovered only by `POST /deployments`, which writes a deployment.

## What Changes

- Extend `workflow-bpmn-authoring` so an agent can draft a new Reltio-style process, revise an existing `.bpmn20.xml`, and explain it. The instructions were adapted from the Workflow Adapter AI prompts (`BpmnAiService`, `bpmn_context.json`, `explain_context.txt`). The shipped playbook does not name those files. The BPMS YES/NO selection gate stays in BPMS and is not copied.
- Add the rules this skill does not already state: one `<definitions>` document, a shape for each data object, and orthogonal backward edges. `bpmn-rules.md` §12 keeps the extension diagram sizes (event `36×36`, gateway `50×50`, task `100×80`) and records the Reltio designer sizes as also legal. §18 is the local check. There is no second rule file.
- After a draft or revision, the skill invokes the existing **Show BPMN Diagram** command (`reltio.previewWorkflowDiagram`). An explanation stops before that step. No second renderer is added.
- Add `scripts/validate-bpmn-definition.cjs`. The command reads a file and makes no REST call. The rules are in `scripts/lib/validate-bpmn-definition.cjs`, a tag walk with the same structural checks as `ActivitiDefinitionValidator` and `BpmnDiCompletenessChecker`. The skill runs the command before any deploy. On failure it may repair and re-run the script at most two times, then it stops without deploying.
- Add the samples repository [github.com/reltio-ai/samples-custom-workflow](https://github.com/reltio-ai/samples-custom-workflow) as an input on `workflow-jar-customization`, before the optional workspace skill.
- Bump `skillsBundleVersion` from 26 to 30 so installing the updated extension materializes the playbook. The pin includes the JAR samples link.

## Capabilities

### New Capabilities

- `bpmn-process-definition-skill`: Draft, revise, and explain through the bundled playbook; show the existing diagram preview; block deploy when the local check fails; ship the playbook on a skills-bundle version bump.
- `bpmn-local-validation`: Check one `.bpmn20.xml` on disk with the Workflow Adapter's structural rules. No REST call and no deployment.

### Modified Capabilities

- None. `openspec/specs/` has no archived requirements to delta.

## Impact

- `skills/reltio-default/workflow-bpmn-authoring/SKILL.md` and `references/bpmn-rules.md`.
- `skills/reltio-default/workflow-jar-customization/SKILL.md` (samples repository input).
- `resources/reltio-agent-assets.json` (`skillsBundleVersion` 26 → 30) and the pin in `scripts/test-workflow-skills-library.cjs`.
- `scripts/validate-bpmn-definition.cjs` (command), `scripts/lib/validate-bpmn-definition.cjs` (rules), `scripts/test-bpmn-local-validation.cjs`, and the entry in `scripts/run-unit-tests.cjs`.
- The rules come from `ActivitiDefinitionValidator` and `BpmnDiCompletenessChecker` in the Workflow Adapter. This change copies those checks into a local script. It does not call the Adapter and it does not start an Activiti engine.
- Out of scope: the Workflows tree, JAR registration, and repository sync (RP-202974); the BPMS YES/NO prompt gate; a second diagram renderer; any REST call to validate a definition, including a validate-without-deploy endpoint and using `POST /deployments` as a dry run; starting an Activiti engine inside the extension; implementing the Workflow Adapter Java endpoint in this repository; copying Java prompt text into the skill verbatim.
