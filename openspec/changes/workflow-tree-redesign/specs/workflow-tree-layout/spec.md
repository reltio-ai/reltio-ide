## ADDED Requirements

### Requirement: Workflows shows two default folders
The Workflows row SHALL show Process Definitions and JAR Deployments. There SHALL be no Drafts folder and no repository row.

#### Scenario: No repository connected
- **WHEN** a tenant has no connected repository
- **THEN** the Workflows row shows no Java Classes or Java Tests folder

#### Scenario: Repository connected
- **WHEN** a repository is connected
- **THEN** Java Classes and Java Tests appear after the two default folders, even when they hold nothing, and group their files by module even for a single module

### Requirement: Connect is offered as a row while no repository is connected
The Workflows row SHALL list a "Connect Custom Workflow Repository…" row after the default folders while no repository is connected, and SHALL NOT once one is.

#### Scenario: Not connected
- **WHEN** the Workflows row is expanded with no repository connected
- **THEN** its last child is the connect row, and clicking it runs the connect command

### Requirement: Baseline snapshots are never committed
Baseline snapshots (`*.bpmn20.baseline.xml`) SHALL be ignored by the tenant and workspace `.gitignore` and by the connected repository's `.git/info/exclude`.

#### Scenario: Tenant git
- **WHEN** a tenant folder is bound to git and a workflow has been downloaded
- **THEN** its baseline snapshot does not appear in `git status`

### Requirement: The diagram preview says why it cannot draw
When a BPMN is not well-formed XML the preview SHALL show the first problem and its line number instead of a blank canvas.

#### Scenario: Unclosed element
- **WHEN** a `<task>` is never closed
- **THEN** the panel reads "This BPMN is not valid XML, so it cannot be drawn. Line N: …"

### Requirement: The Workflows row carries the repository's actions
Connect SHALL be offered on a Workflows row with no repository. Disconnect, refresh status, open folder and open in browser SHALL be offered on one with a repository, and its description SHALL say the repository is connected.

#### Scenario: Connected, no adapter URL
- **WHEN** a repository is connected and no Adapter URL is saved
- **THEN** the row is expandable and its description reads "Adapter URL not set • repository connected"

### Requirement: Process Definitions is one merged list
The list SHALL show deployed rows (OOTB with a method icon, custom with a cloud icon), draft rows (pencil) and repository rows (repo icon). A repository file SHALL always have its own row and SHALL NOT be merged into a deployed or draft row, even with the same process id. A downloaded copy of a tenant workflow (one with a baseline) SHALL belong to its tenant row.

#### Scenario: Same id on tenant and repository
- **WHEN** a tenant workflow and a repository file share a process id
- **THEN** the list shows two rows, and the repository row says "same as tenant" or "differs from tenant"

#### Scenario: Not yet fetched
- **WHEN** the tenant's definitions could not be fetched
- **THEN** repository rows show no comparison

#### Scenario: Origin comes from git
- **WHEN** a BPMN in `Workflows/bpmn/` is not tracked by git
- **THEN** it is the user's draft; a tracked file, or any file outside `bpmn/`, is the repository's

### Requirement: Every deployed BPMN is downloaded when the list loads
When the Process Definitions list loads, the extension SHALL download, in the background, every deployed definition that has no local `{id}.bpmn20.xml`, together with its baseline. It SHALL NOT overwrite an existing file, SHALL skip ids that are not valid file names, and SHALL keep baselines out of a connected repository's commits.

#### Scenario: Nothing on disk
- **WHEN** the list loads for a tenant with 15 definitions and no local copies
- **THEN** 15 BPMN files and 15 baselines are written and the list is shown without waiting for them

#### Scenario: Existing files are protected
- **WHEN** `bpmn/` already holds a draft or a repository file named for a deployed id
- **THEN** it is not replaced

#### Scenario: One failure
- **WHEN** some downloads fail
- **THEN** the rest still complete and one warning reports the count; each row still opens on demand

#### Scenario: Dead token
- **WHEN** five downloads in a row fail
- **THEN** the run stops and the warning says so

#### Scenario: Baselines are not committed
- **WHEN** a repository is connected
- **THEN** `Workflows/.git/info/exclude` ignores `*.bpmn20.baseline.xml`, added to an older clone on the next download, and never creating `.git` in a folder that is not a repository

### Requirement: Disconnect removes the repository's files
Disconnecting SHALL plan nothing unless `Workflows/` is itself the git top level. It SHALL move to the trash the repository's tracked files that have no uncommitted change and are in no commit that a remote lacks, and its ignored files under `target/`; remove folders left empty except `bpmn/`; and delete `.git` when present. Files with uncommitted or unpushed changes, untracked files, and ignored files outside `target/` SHALL be kept. The files SHALL be planned again after the user confirms. The confirmation SHALL list the files, state the counts, and warn about commits on any branch that no remote has and about stashes.

#### Scenario: Reconnect after disconnect
- **WHEN** a repository is disconnected and another is connected
- **THEN** adoption finds no clashing repository files and succeeds

#### Scenario: Work in progress survives
- **WHEN** a draft, a new Java file or an edited tracked file exists at disconnect
- **THEN** it is kept

### Requirement: Drafts live in the repository's own bpmn folder
Drafts SHALL be stored in `Workflows/bpmn/`, and a connected repository SHALL be cloned directly into `Workflows/`.

#### Scenario: Connect with existing drafts
- **WHEN** `Workflows/bpmn/` holds drafts when a repository is connected
- **THEN** the drafts stay where they are, the repository's `bpmn/` files are merged in, the generated README is replaced, and a modal lists the drafts and says they are now part of the working tree

#### Scenario: Clash
- **WHEN** any adopted path already exists, other than the generated README and files inside `bpmn/`
- **THEN** nothing is changed and the message lists every clashing file

#### Scenario: Same BPMN in both places
- **WHEN** a BPMN in `Workflows/bpmn/` has the same name as one the repository tracks
- **THEN** connecting proceeds, the local copy is kept, and the modal says git will show it as modified against the repository

### Requirement: Retired folders are pruned conservatively
`Workflows/BPMN` and `Workflows/Custom Workflows` SHALL be removed only when they hold nothing but generated READMEs, and the live `Workflows` folder and `Workflows/bpmn` SHALL never be removed, whatever the filesystem's case rules.

#### Scenario: Live folders survive
- **WHEN** the prune runs on a tenant whose `Workflows/bpmn` is empty
- **THEN** `Workflows` and `Workflows/bpmn` are still there afterwards

### Requirement: Java needs a connected repository
When a use case needs Java and no repository is connected, the shipped skills SHALL tell the user to connect and SHALL NOT write Java or offer to.

#### Scenario: User overrides unprompted
- **WHEN** the user says to proceed without a repository
- **THEN** the Java appears in chat only and no file is written

#### Scenario: BPMN only
- **WHEN** the use case needs no Java
- **THEN** a draft is written whether or not a repository is connected
