## ADDED Requirements

### Requirement: The connected repository's Java sources are listed in the tree
The extension SHALL list the connected Custom Workflow Repository's Java sources under the repository row as two flat groups, `Java Classes` for main sources and `Java Tests` for test sources, each labelled with its count. Each row SHALL open the file in the editor when selected. The extension SHALL NOT reproduce the repository's directory structure in the tree.

#### Scenario: A connected repository with no BPMN still shows its contents
- **WHEN** a connected repository contains Java sources and no BPMN files
- **THEN** the repository row expands to a `Java Classes` group listing those sources
- **AND** the row is expandable even though the BPMN count is zero

#### Scenario: Main and test sources are separate groups
- **WHEN** the repository contains sources under both `src/main/java` and `src/test/java`
- **THEN** main sources appear under `Java Classes` and test sources under `Java Tests`
- **AND** each group's label states its own count

#### Scenario: A Java row is labelled by class and described by package
- **WHEN** a Java source is listed
- **THEN** its label is the class's simple name
- **AND** its description is the class's package
- **AND** its tooltip names the owning Maven module and the repository-relative path

#### Scenario: Selecting a Java row opens the file for editing
- **WHEN** the user selects a Java row
- **THEN** the file opens in the ordinary editor
- **AND** the file can be edited and saved through normal editor behaviour

#### Scenario: The listing offers no mutating action
- **WHEN** a Java row's context menu is shown
- **THEN** it offers no command that writes, moves, renames, or deletes the file

### Requirement: Java discovery excludes build output by construction
The extension SHALL discover Java sources by the Maven source-root convention, matching only paths beneath a `src/main/java` or `src/test/java` root within the repository, honouring the same depth limit and dotfolder skipping as BPMN discovery.

#### Scenario: Generated build output never appears
- **WHEN** the repository has been built and contains `target/` directories with generated `.java`, `.class`, and `.jar` files
- **THEN** no file beneath any `target/` directory appears in either group

#### Scenario: A Java file outside a source root is ignored
- **WHEN** a `.java` file exists in the repository but not beneath a `src/main/java` or `src/test/java` root
- **THEN** it does not appear in either group

#### Scenario: Class identity is derived from the path
- **WHEN** a source is discovered at a nested package path
- **THEN** its fully-qualified name is derived from the path segments below the source root
- **AND** the file's contents are not parsed to determine its identity

### Requirement: A Java row does not assert which BPMN files reference it
The extension SHALL NOT label or annotate a Java source with the BPMN files that reference it, and SHALL NOT mark a Java source as unreferenced.

#### Scenario: A shared helper class carries no reference claim
- **WHEN** a Java class is named by no BPMN file's `activiti:class` but is used from other Java
- **THEN** the tree makes no statement about whether it is referenced

### Requirement: Editing a repository BPMN invalidates its sync badge
The extension SHALL detect changes to BPMN files inside the connected Custom Workflow Repository and invalidate the cached sync state for that tenant, so that no stale `clean` or `changed` state is displayed against content that has since changed.

#### Scenario: A repository edit clears a previously clean badge
- **WHEN** a discovered repository BPMN file was marked `clean` and is then edited on disk
- **THEN** the displayed sync state is cleared for that file
- **AND** it is not reported as `clean` until sync state is recomputed

#### Scenario: Invalidation does not trigger a deployed-state fetch
- **WHEN** a repository BPMN file changes on disk
- **THEN** the extension does not fetch deployed XML in response to the change
- **AND** recomputation still happens only on demand or after Fetch or Deploy

### Requirement: The repository commands are callable without a tree node
The extension SHALL accept a plain argument object, in addition to a tree node, for connecting, disconnecting, revealing, opening in a browser, and refreshing sync on a tenant's Custom Workflow Repository, narrowing the union through the same helper used by the workflow authoring commands. A call with missing arguments SHALL be completed interactively rather than ignored.

#### Scenario: An agent-supplied argument object is honoured
- **WHEN** one of these commands is invoked with an argument object identifying the environment and tenant rather than a tree node
- **THEN** the command acts on that tenant
- **AND** it does not return silently without effect

#### Scenario: A call with no arguments prompts instead of doing nothing
- **WHEN** one of these commands is invoked with no argument at all
- **THEN** the extension resolves the tenant interactively, without prompting when only one tenant is connected

#### Scenario: Irreversible steps keep their confirmation
- **WHEN** connect or disconnect is invoked through an argument object
- **THEN** the existing confirmation for that command is still shown
