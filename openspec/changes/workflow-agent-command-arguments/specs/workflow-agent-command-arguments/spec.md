## ADDED Requirements

### Requirement: Workflow authoring is drivable by an agent, and deploying always asks
The workflow commands SHALL be invocable with plain arguments as well as from the tree, and deploying a process definition SHALL require explicit confirmation on every invocation.

#### Scenario: A workflow command is invoked without a tree selection
- **WHEN** a caller invokes a workflow command with an argument object naming the tenant and the process
- **THEN** the command SHALL run as though the equivalent tree row had been used
- **AND** SHALL NOT require a tree item

#### Scenario: A partially specified invocation is completed, not refused
- **WHEN** a workflow command is invoked with some required values absent
- **THEN** the extension SHALL prompt for the missing values using the same prompts and the same validation as its interactive path
- **AND** SHALL NOT infer a process id that the user did not supply

#### Scenario: The only connected tenant is not asked about
- **WHEN** a workflow command is invoked with no tenant, and exactly one tenant is connected
- **THEN** the extension SHALL use that tenant
- **AND** SHALL name it in the confirmation that follows

#### Scenario: An ambiguous tenant is asked about
- **WHEN** a workflow command is invoked with no tenant, and more than one tenant is connected
- **THEN** the extension SHALL ask which tenant to use

#### Scenario: Every deploy is confirmed
- **WHEN** a deploy is initiated, from the tree, the editor, the palette or an argument object
- **THEN** the extension SHALL require explicit confirmation before uploading
- **AND** the confirmation SHALL name the process id and the target tenant
- **AND** dismissing it SHALL upload nothing

#### Scenario: Replacing a running workflow says so
- **WHEN** the process id being deployed already exists on the target tenant
- **THEN** the confirmation SHALL state that this uploads a new version that new process instances will use
- **AND** SHALL be distinguishable from the confirmation shown for a process id that is not yet deployed

#### Scenario: Creating a draft is not confirmed
- **WHEN** a draft is created or duplicated
- **THEN** the extension SHALL write and open it without a confirmation prompt

#### Scenario: Existing invocation paths are unaffected
- **WHEN** a workflow command is invoked from a tree row, an editor, or the command palette with no arguments
- **THEN** its behaviour SHALL be unchanged, apart from the deploy confirmation

### Requirement: The authoring playbook gathers its inputs before writing
The BPMN authoring skill SHALL direct the agent to resolve its unknowns before producing XML, in a single exchange.

#### Scenario: Unknowns are gathered in one turn
- **WHEN** the agent is asked to create or copy a workflow without enough detail
- **THEN** it SHALL ask for the target tenant, whether this is new or a copy, which workflow is being copied, the process id, the display name, and whether to deploy
- **AND** SHALL ask them together rather than one per turn
- **AND** SHALL state a default for each so a partial answer is enough to proceed

#### Scenario: An approximate reference is clarified, not guessed
- **WHEN** the user names a source workflow approximately and more than one deployed definition matches
- **THEN** the agent SHALL ask which one
- **AND** SHALL NOT choose between them

#### Scenario: Two checks cannot be skipped
- **WHEN** the agent has gathered its inputs
- **THEN** it SHALL re-validate the process id against the tenant's deployed definitions before writing
- **AND** SHALL NOT treat the user's earlier agreement as the deploy confirmation
