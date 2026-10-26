## ADDED Requirements

### Requirement: Workflows shows two default folders
The Workflows row SHALL show Process Definitions and JAR Deployments. There SHALL be no Drafts folder and no repository row.

#### Scenario: No repository connected
- **WHEN** a tenant has no connected repository
- **THEN** the Workflows row shows no Java Classes or Java Tests folder

#### Scenario: Repository connected
- **WHEN** a repository is connected
- **THEN** Java Classes and Java Tests appear after the two default folders, even when they hold nothing, and group their files by module even for a single module

### Requirement: The Workflows row carries the repository's actions
Connect SHALL be offered on a Workflows row with no repository. Disconnect, refresh status, open folder and open in browser SHALL be offered on one with a repository, and its description SHALL say the repository is connected.

#### Scenario: Connected, no adapter URL
- **WHEN** a repository is connected and no Adapter URL is saved
- **THEN** the row is expandable and its description reads "Adapter URL not set • repository connected"

### Requirement: Process Definitions is one merged list
The list SHALL contain one row per process id, deduplicated across deployed definitions, local files and repository files, in one of six states.

#### Scenario: Precedence
- **WHEN** a deployed custom workflow has local edits and its repository file also differs
- **THEN** the row shows "local changes", and Deploy ships the local file

#### Scenario: Not tracked
- **WHEN** a repository is connected and holds no file for a deployed custom workflow
- **THEN** the row shows "not tracked in repository" in the warning colour

#### Scenario: OOTB is never untracked
- **WHEN** a deployed workflow is OOTB
- **THEN** it is never marked "not tracked in repository"

#### Scenario: Not yet scanned
- **WHEN** the repository has not been scanned
- **THEN** no row is marked "not tracked in repository"

#### Scenario: Content id wins
- **WHEN** one file is seen by both scans with different ids
- **THEN** the repository's content id is the one listed

### Requirement: Drafts live in the repository's own bpmn folder
Drafts SHALL be stored in `Workflows/bpmn/`, and a connected repository SHALL be cloned directly into `Workflows/`.

#### Scenario: Connect with existing drafts
- **WHEN** `Workflows/bpmn/` holds drafts when a repository is connected
- **THEN** the drafts stay where they are, the repository's `bpmn/` files are merged in, the generated README is replaced, and a modal lists the drafts and says they are now part of the working tree

#### Scenario: Clash
- **WHEN** any adopted path already exists, other than the generated README and the `bpmn/` folder itself
- **THEN** nothing is changed and the message lists every clashing file

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
