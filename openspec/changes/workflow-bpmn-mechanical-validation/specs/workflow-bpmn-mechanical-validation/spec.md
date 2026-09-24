## ADDED Requirements

### Requirement: BPMN validation is reported as evidence, not as self-assessment
The authoring skill SHALL direct the agent to read the extension's own report of the Reltio rules rather than assert that it walked the checklist.

#### Scenario: The agent quotes what the tool said
- **WHEN** the agent has written or edited a BPMN
- **THEN** it SHALL save the file, read the violations reported for it, and quote them
- **AND** SHALL fix every finding before reporting completion

#### Scenario: A clean file is reported as a clean report
- **WHEN** no violations are reported for the file
- **THEN** the agent SHALL state that
- **AND** SHALL NOT present a self-derived pass of the checklist as the result

#### Scenario: A finding is traceable to its rule
- **WHEN** the agent reports a finding
- **THEN** the rule it came from SHALL be identifiable from the finding itself

### Requirement: The checks no tool can perform are stated separately
Checklist items that cannot be answered from the file SHALL be presented as the agent's own responsibility, not folded into a list of machine-checked ones.

#### Scenario: Condition values against form properties
- **WHEN** the agent reports on a BPMN containing gateway conditions
- **THEN** it SHALL state explicitly whether every condition value matches its form property exactly, including case
- **AND** SHALL note that this cannot be determined from the file

#### Scenario: Whether the process id is already live
- **WHEN** the agent reports on a BPMN
- **THEN** it SHALL state explicitly whether that process id already exists on the target tenant
- **AND** SHALL state whether deploying therefore creates a new workflow or a new version of a running one

### Requirement: The rules reference says which items are machine-checked
The BPMN rules document SHALL mark each validation-checklist item according to whether the extension verifies it.

#### Scenario: Each item is marked
- **WHEN** a reader consults the validation checklist
- **THEN** every item SHALL be marked as verified by the extension or as the reader's own to verify

#### Scenario: A warning-level rule explains why it is not an error
- **WHEN** an item is verified only as a warning
- **THEN** the document SHALL state why it cannot be enforced as an error

#### Scenario: The reader is told how to change the reporting
- **WHEN** a reader wants the reporting quieter or disabled
- **THEN** the document SHALL name the setting that controls it
- **AND** SHALL state that it cannot suppress the violations the engine rejects outright
