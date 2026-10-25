## ADDED Requirements

### Requirement: BPMN files are checked against the Reltio rules as they are edited
Editing a local BPMN process definition SHALL report violations of the Reltio workflow rules in the editor, on the element at fault, without contacting a tenant.

#### Scenario: A finding lands on the element responsible
- **WHEN** a rule is violated by a particular element
- **THEN** the reported range SHALL cover that element's opening tag
- **AND** SHALL NOT default to the start of the file

#### Scenario: A finding names the rule it came from
- **WHEN** a violation is reported
- **THEN** it SHALL carry a stable code identifying the rule

#### Scenario: A compliant file is silent
- **WHEN** the file satisfies every checked rule
- **THEN** no violations SHALL be reported

#### Scenario: A draft created by the extension is compliant
- **WHEN** the user creates a new workflow draft through the extension
- **THEN** the resulting file SHALL produce no violations

#### Scenario: A file being typed is not yet a violation
- **WHEN** the document contains no process element
- **THEN** no violations SHALL be reported

### Requirement: The silent failure modes are reported
Rules whose breach produces no signal at deploy time SHALL be reported in the editor.

#### Scenario: An exclusive gateway without a fallback
- **WHEN** an exclusive gateway has no default flow
- **THEN** a violation SHALL be reported on that gateway
- **AND** the message SHALL state that an unmatched value hangs the process instance

#### Scenario: A default flow that also carries a condition
- **WHEN** a gateway's default flow carries a condition expression
- **THEN** a violation SHALL be reported on the flow, not on the gateway

#### Scenario: A default flow that is not the gateway's own
- **WHEN** a gateway names a default flow that does not leave it, or that does not exist
- **THEN** a violation SHALL be reported on that gateway

#### Scenario: A user task missing a required create listener
- **WHEN** any user task in the process lacks either required create listener
- **THEN** a violation SHALL be reported on that task
- **AND** the message SHALL name only the listeners actually missing

#### Scenario: Compliance is checked per task, not per file
- **WHEN** one user task carries both required listeners and another does not
- **THEN** only the non-compliant task SHALL be reported

#### Scenario: A diagram plane describing another process
- **WHEN** the diagram's plane names a process id other than this file's
- **THEN** a violation SHALL be reported
- **AND** the message SHALL name both ids

### Requirement: Structural rules are reported before a deploy is attempted
Violations Activiti would reject on upload SHALL be reported locally.

#### Scenario: A duplicated element id
- **WHEN** two elements in the process share an id
- **THEN** a violation SHALL be reported on the later occurrence only

#### Scenario: A flow that does not connect two elements
- **WHEN** a sequence flow has no source or target, or names one that is not in the file
- **THEN** a violation SHALL be reported on that flow, naming which end is at fault

#### Scenario: A gateway with fewer than two outgoing flows
- **WHEN** a gateway has fewer than two outgoing flows
- **THEN** a violation SHALL be reported, stating how many it has

#### Scenario: A process that deploys but cannot run
- **WHEN** the process is not marked executable
- **THEN** a violation SHALL be reported on the process element

#### Scenario: A process id that does not match its file name
- **WHEN** the process id differs from the process id the file name claims
- **THEN** a violation SHALL be reported, naming both

#### Scenario: A file with no name to compare against
- **WHEN** the document's name does not identify a process id
- **THEN** no file-name violation SHALL be reported

### Requirement: Advisory findings are distinguished from definite ones
A rule a customer may legitimately break SHALL be reported less severely than one the engine enforces.

#### Scenario: A class outside the documented set
- **WHEN** an element names a delegate or listener class that Reltio does not ship
- **THEN** it SHALL be reported as a warning, not an error
- **AND** the message SHALL allow for the class being in a JAR the customer deployed

#### Scenario: A definition with no diagram information
- **WHEN** the file carries no diagram section
- **THEN** a single warning SHALL be reported on the process element
- **AND** no additional per-element findings SHALL be reported for the same fact

#### Scenario: Partial diagram information
- **WHEN** the file carries a diagram section that omits an element
- **THEN** a warning SHALL be reported on the omitted element

### Requirement: The user can change how loudly findings are reported, but not hide failures
A setting SHALL govern the severity of advisory findings and SHALL be able to disable checking entirely.

#### Scenario: Lowering the severity moves the advisory findings
- **WHEN** the setting is lowered
- **THEN** advisory findings SHALL be reported at the configured severity

#### Scenario: A definite failure cannot be demoted
- **WHEN** the setting is lowered
- **THEN** a violation the engine rejects outright SHALL still be reported as an error

#### Scenario: Turning checking off clears existing findings
- **WHEN** the setting is set to off
- **THEN** previously reported violations SHALL be removed, not merely left in place

### Requirement: Only editable local BPMN files are reported on
Checking SHALL apply to the files the user can fix.

#### Scenario: A remote baseline is not reported on
- **WHEN** the document is a baseline capture of a deployed definition
- **THEN** no violations SHALL be reported for it

#### Scenario: A file opened without being edited is still reported on
- **WHEN** a BPMN is made the active editor without having been changed
- **THEN** its violations SHALL be reported

#### Scenario: Closing a file removes its findings
- **WHEN** a BPMN document is closed
- **THEN** its violations SHALL be removed
- **AND** violations reported for other documents SHALL remain