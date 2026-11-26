## Purpose

Tells an agent how to draft, revise, and explain a Reltio BPMN process, preview the diagram, and validate the file locally before anyone deploys it.

## ADDED Requirements

### Requirement: Draft, revise, and explain from the bundled playbook
The bundled `workflow-bpmn-authoring` playbook SHALL instruct an agent to draft a new process, revise an existing `.bpmn20.xml`, and explain a process, using instructions adapted from the Workflow Adapter AI prompts. The playbook MUST NOT add a YES/NO model call that selects the skill.

#### Scenario: A new process is drafted from the adapted prompts
- **WHEN** the user asks for a new process
- **THEN** an agent following the playbook SHALL write one `<definitions>` document that includes a `bpmndi:BPMNDiagram`
- **AND** SHALL NOT ask a separate model whether the request is in scope

#### Scenario: An existing definition is revised in place
- **WHEN** the user asks to change an existing definition and the current XML is available
- **THEN** an agent following the playbook SHALL revise that document
- **AND** SHALL NOT invent a second process id

#### Scenario: An explanation does not rewrite the file
- **WHEN** the user asks what a definition does
- **THEN** an agent following the playbook SHALL explain it
- **AND** SHALL NOT modify the file
- **AND** SHALL NOT deploy it

### Requirement: Diagram preview uses the existing viewer
After a draft is written or revised, the playbook SHALL tell the agent to run Show BPMN Diagram (`reltio.previewWorkflowDiagram`). This change SHALL NOT add a second BPMN renderer.

#### Scenario: A draft is shown with Show BPMN Diagram
- **WHEN** a draft has been written or revised
- **THEN** the playbook SHALL name `reltio.previewWorkflowDiagram` as the preview step

#### Scenario: The skill does not add a second renderer
- **WHEN** this change is implemented
- **THEN** BPMN preview SHALL remain the existing `reltio.previewWorkflowDiagram` command

### Requirement: The skill validates before deploy
The playbook SHALL tell the agent to run `node scripts/validate-bpmn-definition.cjs` on the saved `.bpmn20.xml` before deploy. The playbook MUST NOT tell the agent to validate by calling the Workflow Adapter. When validation fails, the agent MUST NOT deploy. The agent MAY repair and re-run the script at most two times after the first failure, then MUST stop and report the remaining error.

#### Scenario: A failed validation blocks deploy
- **WHEN** `node scripts/validate-bpmn-definition.cjs` reports a failure
- **THEN** an agent following the playbook SHALL NOT run `reltio.deployWorkflow`
- **AND** SHALL NOT make a REST call to validate the file
- **AND** SHALL stop after at most two repair attempts with the remaining error

### Requirement: The updated playbook is installed with the extension
Installing or updating the extension SHALL materialize the updated playbook when `skillsBundleVersion` increases.

#### Scenario: A skills bundle version bump materializes the playbook
- **WHEN** `skillsBundleVersion` in `resources/reltio-agent-assets.json` changes from 26 to 30
- **THEN** the extension SHALL treat the bundled skills as newer than a workspace stamped 26
- **AND** SHALL copy the updated `workflow-bpmn-authoring` playbook into the workspace agent skills
