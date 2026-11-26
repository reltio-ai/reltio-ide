## Context

See proposal.md for why. `workflow-bpmn-authoring` already drafts from `bpmn-rules.md`, reads editor diagnostics, and names `reltio.previewWorkflowDiagram`. Those editor diagnostics are the §10 checklist. They are not the Workflow Adapter's deploy gate.

The Adapter AI loop calls `BpmnValidator.validateContent`, which runs `ActivitiDefinitionValidator.process()`, and then `BpmnDiCompletenessChecker.check`. `DeploymentValidator.validateDefinition` runs the same pair and does not register a deployment. Both walk XML. Neither check requires an HTTP call from this extension. This branch started from `skillsBundleVersion` `"26"`. The working tree ships `"30"`.

## Goals / Non-Goals

**Goals:**

- Teach the existing playbook to draft, revise, and explain, and to preview with the command that already exists.
- Give the playbook one local script that fails a file for the same structural reasons the Adapter fails it.
- Ship the playbook by bumping `skillsBundleVersion` from 26 to 30.

**Non-Goals:**

- The Workflows tree, JAR registration, and repository sync (RP-202974).
- The BPMS YES/NO prompt gate.
- A second diagram renderer.
- Any REST call to validate a definition, including a validate-without-deploy endpoint and using `POST /deployments` as a dry run.
- Starting an Activiti engine inside the extension.
- Implementing the Workflow Adapter Java endpoint in this repository.
- Copying Java prompt text into the skill verbatim.

## Decisions

### Validate with a local script, not a REST call

`scripts/validate-bpmn-definition.cjs` is the command the playbook runs. It reads one `.bpmn20.xml` from disk, prints each finding, and exits non-zero on failure. The rules live in `scripts/lib/validate-bpmn-definition.cjs`. That module reads text only: no HTTP client, no adapter URL, no token, no temp file, and no process engine. The playbook runs `node scripts/validate-bpmn-definition.cjs` on the saved file before `reltio.deployWorkflow`. On failure the agent may edit and re-run the script at most two more times, then it stops. Explain does not modify the file and does not deploy it. `scripts/run-unit-tests.cjs` runs `scripts/test-bpmn-local-validation.cjs`.

Alternative considered: `reltio.validateWorkflow` posting to a validate-without-deploy operation. Rejected. Validation must not make a REST call.

Alternative considered: asking the agent to re-read `bpmn-rules.md` and attest that it passed. Rejected. That is the self-check this repo already removed. The script is the evidence.

### Copy the Adapter's structural rules, do not boot Activiti

`scripts/lib/validate-bpmn-definition.cjs` is a prefix-aware tag walk, not an XML library and not Activiti. It implements the checks in `ActivitiDefinitionValidator.validateGraph` and `BpmnDiCompletenessChecker.check`:

- empty or not-well-formed XML fails
- the file name ends with `.bpmn20.xml`
- exactly one start event
- a node with no outgoing flow is an end event, data object, text annotation, association, extension elements, or documentation
- a data object with id and name `manualStart` is present
- `manualStart` and `deleted` values are `true` or `false`
- every user task has extension elements
- sequence-flow source and target ids exist
- `decision == '…'` matches an enum value on the upstream user task's `decision` form property
- every flow node listed by `BpmnDiCompletenessChecker` has a `BPMNShape` with `Bounds`
- every sequence flow has a `BPMNEdge` with at least two waypoints

Element names match with or without a `bpmn` prefix, as `ActivitiDefinitionValidator.isNodeType` does. DOCTYPE is rejected and not loaded. Empty content fails with `BPMN content cannot be null or empty`. A name that does not end in `.bpmn20.xml` fails with `Incorrect BPMN file extension`. A user task with no extension elements fails with `At least two form properties (decision,validator required for userTask`. A diagram gap is one `BPMN DI is incomplete` line that names the missing shapes, edges, bounds, or waypoints. The checker does not write a temp file and does not start a process engine.

The editor's `analyseBpmn` stays the §10 warning set. A missing diagram there is a warning because a file can still deploy. The script treats the same gap as a failure, because `BpmnDiCompletenessChecker` does. The two checks are not merged.

Alternative considered: shelling out to the Adapter's Java tests. Rejected. The playbook must run in a workspace that has Node and the extension, not a BPMS checkout.

### Rewrite the missing prompt rules into the current playbook

`SKILL.md` covers create, revise, and explain. A new process is one `<definitions>` document with a `bpmndi:BPMNDiagram`. A revision edits the current `.bpmn20.xml` and does not invent a second process id. An explanation stops the procedure: it does not modify the file and does not deploy it. There is no YES/NO model call.

`bpmn-rules.md` §12 records the diagram-size disagreement and keeps §11: event `36×36`, gateway `50×50`, task `100×80`. Those are the sizes this extension's diagram generator writes. Designer sizes (start and end `50×50`, tasks and data objects `100×50`, orthogonal loops) stay legal and are not what the playbook emits. §18 is the local check, plus the notes the script does not measure: one `<definitions>` document, a shape for each data object, an orthogonal backward edge, and the shape of an explanation. §12 and §18 do not name `BpmnAiService`, `bpmn_context.json`, `explain_context.txt`, `ActivitiDefinitionValidator`, or `BpmnDiCompletenessChecker`. The skill description continues to select the skill. The YES/NO gate is not copied.

### Reuse Show BPMN Diagram

After a write or a revision, step 9 runs `reltio.previewWorkflowDiagram`. An explanation stops before that step. This change does not add a webview, a layout engine, or a second command.

### Bump the skills bundle as one pin

`resources/reltio-agent-assets.json` `skillsBundleVersion` goes from `"26"` to `"30"`. `scripts/test-workflow-skills-library.cjs` updates `PINNED_SKILLS_BUNDLE_VERSION` and `PINNED_SKILLS_HASH` in the same change. `velocityPacksBundleVersion` stays as it is. The pin covers every edit under `skills/reltio-default/**` in this working tree, including the JAR samples link below. The local check is covered by `scripts/test-bpmn-local-validation.cjs`.

### Point the JAR playbook at the samples repository

`skills/reltio-default/workflow-jar-customization/SKILL.md` lists [github.com/reltio-ai/samples-custom-workflow](https://github.com/reltio-ai/samples-custom-workflow) as an input, before the optional workspace skill. The agent uses those Java, BPMN, and unit-test modules when the tenant repository does not already show the shape. The URL was already cited inside `references/java-patterns.md`. This change puts it on the playbook the agent reads first.

## Approach changes

### Approach change (2026-11-26)

Previously: bump `skillsBundleVersion` from 26 to 27, keep the validator in `scripts/validate-bpmn-definition.cjs`, and point each new `bpmn-rules.md` section at `BpmnAiService`, `bpmn_context.json`, or `explain_context.txt`.

Shipped: `skillsBundleVersion` is `"30"`. The command is still `node scripts/validate-bpmn-definition.cjs`; the rules are in `scripts/lib/validate-bpmn-definition.cjs`. §12 keeps the extension diagram sizes. §18 names only the local script. The JAR playbook lists the samples repository.

Reason: each playbook edit had to raise the skills pin, and naming the Java validators sent the agent through other checkouts. The samples link is in the same working tree and the same pin.

## Risks / Trade-offs

- [The script drifts from the Java validators] → Fixtures in `scripts/test-bpmn-local-validation.cjs` cover each rule above. A later Adapter change is a follow-up, not a silent HTTP fallback.
- [Rewritten prompts drift from `BpmnAiService`] → The playbook states the missing rules in §12 and §18 and does not name the Java files, so the agent does not go looking for them. Do not paste the Java text blocks. A later prompt change is a follow-up.
- [New diagram rules contradict §11] → §12 already records the disagreement and keeps the extension sizes. Do not add a parallel checklist.
- [Editor warnings and the script disagree on a missing diagram] → Leave them separate. The script is the deploy gate. The Problems panel stays a warning.

## Migration Plan

No stored data moves. Deploy stays `POST /deployments` and is unchanged. Rollback is reverting the playbook and the script. Older extensions keep deploying without the local check.

## Open Questions

None. Validation is local, and the script is the check the playbook runs.
