## ADDED Requirements

### Requirement: Workflow skills state on-disk paths that match the shipped folder structure
Every workflow skill SHALL describe local file locations using the shipped tenant folder structure, with bare environment and tenant folder names and BPMN drafts under `Workflows/BPMN/`.

#### Scenario: No skill references the retired folder suffixes
- **WHEN** a workflow skill states a path inside a tenant folder
- **THEN** it does not use the `.reltio.environment` or `.reltio.tenant` folder suffixes

#### Scenario: The drafts path is current
- **WHEN** a workflow skill states where a BPMN draft is written
- **THEN** it names `Workflows/BPMN/` and not a lowercase `workflows/` folder

### Requirement: The repository contribution skill documents the in-IDE path
`workflow-repo-contribution` SHALL present the in-IDE route — connecting the Custom Workflow Repository, browsing its BPMN and Java contents, checking sync state, and deploying a BPMN from it — as its primary procedure, naming the commands that perform each step. The manual clone-and-pull-request route SHALL be retained as a documented fallback.

#### Scenario: The skill names the repository commands
- **WHEN** an agent reads the skill to connect a tenant's Custom Workflow Repository
- **THEN** the skill names the command that connects it
- **AND** the skill names the commands for revealing the repository, refreshing sync state, and deploying a BPMN from it

#### Scenario: The Java editing loop is covered
- **WHEN** an agent is asked to change custom workflow Java
- **THEN** the skill states where the Java sources appear in the tree and that they are edited in place
- **AND** it states that the change still reaches the tenant only through Reltio's review and JAR registration

#### Scenario: The manual route remains available
- **WHEN** a tenant has no connected repository
- **THEN** the skill still describes the manual clone and pull request path

### Requirement: Workflow skills end a turn by naming the next step
Each workflow skill SHALL instruct the agent to end its turn by stating the next action available to the user, including the case where the next action is a step the user must perform outside the IDE.

#### Scenario: A completed step is followed by a stated next step
- **WHEN** an agent completes a step described by a workflow skill
- **THEN** it states what the user's next action is

#### Scenario: An externally blocked step is named as such
- **WHEN** the next step is Reltio's review or JAR publication rather than an IDE action
- **THEN** the agent says so instead of offering an IDE command that cannot advance the work
