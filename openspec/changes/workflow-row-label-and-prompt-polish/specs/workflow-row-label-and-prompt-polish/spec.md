## ADDED Requirements

### Requirement: The workflow identity field is labelled consistently
Every surface that shows a workflow's identifier SHALL use one label for it.

#### Scenario: A deployed definition's hover names the field
- **WHEN** the user hovers a process definition in the Workflows tree
- **THEN** the identifier line SHALL be labelled `ID`
- **AND** SHALL NOT be labelled `Process ID`

#### Scenario: A draft's hover uses the same label
- **WHEN** the user hovers a local draft in the Workflows tree
- **THEN** the identifier line SHALL be labelled `ID`

### Requirement: No context-menu entry duplicates a plain row click
An action the tree already performs on click SHALL NOT also occupy a slot in that row's right-click menu.

#### Scenario: Opening the BPMN is offered once, not twice
- **WHEN** the user right-clicks a process definition
- **THEN** the menu SHALL NOT offer an entry that opens the BPMN file
- **AND** the row SHALL still open the BPMN file when clicked

#### Scenario: The command remains resolvable
- **WHEN** the extension activates
- **THEN** the command bound to the row SHALL be both declared and registered, so the click does not fail with "command not found"

#### Scenario: The remaining action leads the menu
- **WHEN** the user right-clicks a process definition
- **THEN** showing the diagram SHALL be the first entry in the navigation group

### Requirement: Consecutive prompts state what distinguishes them
When creating a draft asks for two values in sequence, each prompt SHALL say what its value is used for.

#### Scenario: The identifier prompt names its consumer
- **WHEN** the user is asked for the new workflow's identifier
- **THEN** the prompt SHALL lead with `ID`
- **AND** SHALL state that it is the technical identifier, used as the file name and as the workflow's identity on the tenant

#### Scenario: The name prompt names its audience and contrasts itself
- **WHEN** the user is asked for the new workflow's display name
- **THEN** the prompt SHALL describe it as the business-friendly name shown to reviewers
- **AND** SHALL state that it is not the technical identifier

#### Scenario: Validation under the prompt uses the prompt's own label
- **WHEN** the entered identifier is already taken by an existing draft
- **THEN** the validation message SHALL refer to it as an `ID`
