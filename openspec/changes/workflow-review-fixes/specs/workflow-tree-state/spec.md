## ADDED Requirements

### Requirement: "Not fetched" and "fetched, empty" are different states
Connecting, disconnecting or refreshing a repository's sync state SHALL NOT create an empty definitions or JAR list for a tenant that has never been fetched.

#### Scenario: Connect before fetching
- **WHEN** a repository is connected on a tenant whose workflows were never fetched
- **THEN** Process Definitions and JAR Deployments still show the "Fetch Workflows…" row and no "(0)" counts

### Requirement: Fetches cannot overwrite newer results of another kind
A combined workflow load SHALL NOT overwrite definitions or JARs that a newer kind-specific fetch already stored.

#### Scenario: Slow refresh then deploy
- **WHEN** a slow Refresh Workflows is in flight, a Deploy's re-fetch completes first, and the slow result lands last
- **THEN** the newly deployed definition remains in the tree and in the collision check

### Requirement: The Custom Workflow Repository row renders and is populated
The row SHALL be visible when a repository is connected even if no adapter URL is saved, and SHALL be populated on activation and on tenant load without a manual refresh. New BPMN and Java files created after load SHALL appear.

#### Scenario: Window reload
- **WHEN** the window is reloaded with a connected repository
- **THEN** the row lists its BPMN and Java files without Fetch or Refresh Sync

#### Scenario: New file
- **WHEN** a new `.bpmn20.xml` is created in the repository
- **THEN** it appears within the watcher's debounce

### Requirement: Discovery ignores build output and is bounded
BPMN discovery SHALL skip dot directories and build output (`target`, `node_modules`, `.git`), SHALL skip files over a size limit, and SHALL stop after a file-count limit with a visible note.

#### Scenario: Copied BPMN under target/classes
- **WHEN** `target/classes/x.bpmn20.xml` exists beside `src/main/resources/x.bpmn20.xml`
- **THEN** only the source file is listed and it is the one deployed

### Requirement: Sync comparison ignores line endings
Content comparison SHALL normalize CRLF and LF before comparing.

#### Scenario: Windows checkout
- **WHEN** a repo file differs from the tenant copy only by CRLF
- **THEN** its sync state is `synced`

### Requirement: The diagram panel cannot wedge
A failure while building or re-rendering a diagram SHALL dispose the panel entry and show an error; the next open SHALL succeed.

#### Scenario: Layout throws
- **WHEN** layout throws for a malformed definition
- **THEN** the user sees one error and the next Show BPMN Diagram opens normally

### Requirement: Diagnostics are debounced per document
Pending diagnostics updates SHALL be keyed by document URI, and a closed document SHALL NOT receive diagnostics.

#### Scenario: Two files change together
- **WHEN** two BPMN files change within the debounce window
- **THEN** both receive their diagnostics

### Requirement: Node-only commands are hidden from the palette
Commands that require a tree node SHALL have a `commandPalette` entry that hides them.

#### Scenario: Palette
- **WHEN** the user opens the Command Palette
- **THEN** compare, discard, delete draft, copy JAR module path and the refresh and fetch node commands are not listed
