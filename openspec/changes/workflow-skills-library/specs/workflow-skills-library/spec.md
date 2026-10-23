## ADDED Requirements

### Requirement: Workflow playbooks shipped to the customer's AI assistant
The extension SHALL ship agent playbooks covering BPMN authoring, JAR customization, the contribution pipeline and local adapter setup, so that an assistant working in a customer workspace can produce a deployable BPMN without prior knowledge of Reltio Workflow.

#### Scenario: Playbooks reach an existing workspace
- **WHEN** a workspace was last synced under an earlier skills bundle version
- **THEN** the four workflow playbooks SHALL appear under the materialized skills directory after the bundle version is raised
- **AND** the velocity packs bundle SHALL NOT be resynced as a side effect

#### Scenario: BPMN rules are required reading, not background
- **WHEN** the BPMN authoring playbook is followed
- **THEN** the rules reference SHALL be named as an input to be read before any XML is written
- **AND** the playbook SHALL require the validation checklist to be reported item by item rather than summarised

#### Scenario: Every rule names the failure it prevents
- **WHEN** the rules reference states a constraint
- **THEN** it SHALL state the consequence of breaking it — an error code, a deploy rejection, or a named silent failure

#### Scenario: Only real classes are offered
- **WHEN** an assistant needs a service task, task listener, validator or execution listener
- **THEN** the rules reference SHALL provide the complete set of out-of-the-box class names available
- **AND** SHALL state that any class outside that set must be one the customer ships in their own JAR

#### Scenario: The cheaper path is preferred
- **WHEN** a requirement could be expressed as ordering rather than as code
- **THEN** the JAR playbook SHALL require confirming that Java is necessary before proceeding
- **AND** SHALL direct the work to BPMN authoring when it is not

#### Scenario: Internal-only material is not shipped
- **WHEN** the shipped playbooks are inspected
- **THEN** they SHALL NOT contain internal skill cross-references, internal error-catalogue numbering, internal tooling references, or instructions to act directly on AWS or S3
- **AND** a descriptive mention of where a built JAR is published SHALL remain permitted
