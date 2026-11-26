## Purpose

Checks one BPMN file on disk with the Workflow Adapter's structural rules, without a REST call and without creating a deployment.

## ADDED Requirements

### Requirement: Validate a definition locally without a REST call
`scripts/validate-bpmn-definition.cjs` SHALL read one local `.bpmn20.xml` and print each failure. It MUST NOT open a network connection, MUST NOT call the Workflow Adapter, and MUST NOT call `POST /deployments`. A failing run MUST leave the file unchanged.

#### Scenario: Invalid XML is rejected and nothing is deployed
- **WHEN** the file is empty, not well-formed, or breaks an adapter structural rule
- **THEN** the script SHALL exit non-zero and print the failure
- **AND** SHALL leave the file unchanged
- **AND** SHALL NOT call `POST /deployments`

#### Scenario: Valid XML passes and would still pass deploy
- **WHEN** the file satisfies the adapter structural rules, including diagram completeness
- **THEN** the script SHALL exit zero
- **AND** SHALL NOT call `POST /deployments`

#### Scenario: Validation makes no REST call
- **WHEN** the script runs on any file
- **THEN** it SHALL NOT perform an HTTP request

### Requirement: Validation matches the adapter process checks
The script MUST apply the structural rules `ActivitiDefinitionValidator` applies before a deployment is registered: the name ends with `.bpmn20.xml`; the document has exactly one start event; every node with no outgoing flow is an end event, a data object, a text annotation, an association, extension elements, or documentation; a data object with id and name `manualStart` is present; `manualStart` and `deleted` values are only `true` or `false`; every user task has extension elements; a sequence flow source and target exist; a condition of the form `decision == '…'` names a value of that user task's `decision` enum. A document that fails one of these rules MUST be reported in that same class of error.

#### Scenario: A deploy-invalid document fails validation the same way
- **WHEN** a document would be rejected by `ActivitiDefinitionValidator` for one of those rules
- **THEN** the script SHALL exit non-zero and name that rule
- **AND** SHALL NOT persist a deployment

#### Scenario: The process graph must match the adapter leaf and start rules
- **WHEN** the document has zero or more than one start event, or a leaf that is not an allowed end
- **THEN** the script SHALL exit non-zero
- **AND** SHALL name the start-event or leaf failure

### Requirement: Diagram completeness matches the adapter checker
The script MUST apply `BpmnDiCompletenessChecker`: every flow node has a `BPMNShape` with `Bounds`, and every sequence flow has a `BPMNEdge` with at least two waypoints. Missing diagram interchange is a failure, not a warning.

#### Scenario: Diagram interchange must cover shapes and edges
- **WHEN** a flow node has no shape or bounds, or a sequence flow has no edge or fewer than two waypoints
- **THEN** the script SHALL exit non-zero
- **AND** SHALL name the missing shape, edge, bounds, or waypoints
