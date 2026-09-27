## ADDED Requirements

### Requirement: A tenant's Custom Workflow Repository connects into `Workflows/Custom Workflows/`
The extension SHALL allow a customer to connect their tenant's Reltio-provisioned Custom Workflow Repository by supplying its remote URL, cloning it into the tenant's `Workflows/Custom Workflows/` folder. This repository SHALL be treated as a second, distinct remote from any repository a tenant is separately bound to via `reltio.connectTenantToGit`.

#### Scenario: Connecting clones into the reserved placeholder folder
- **WHEN** the user runs Connect Custom Workflow Repository and supplies a remote URL
- **THEN** that remote is cloned into `Workflows/Custom Workflows/` inside the tenant folder
- **AND** the repository's URL and relative path are recorded in a new tracked sidecar, `WorkflowRepo.reltio.json`, at the tenant root

#### Scenario: Disconnecting removes only the binding
- **WHEN** the user disconnects the Custom Workflow Repository
- **THEN** only `.git` and the sidecar are removed
- **AND** every file remains on disk

### Requirement: A repository nested inside a bound tenant is kept out of the outer repository's tracking
When a tenant folder is both bound to Git (via `reltio.connectTenantToGit`) and has a connected Custom Workflow Repository, the extension SHALL ensure the outer repository's `.gitignore` excludes `Workflows/Custom Workflows/`, regardless of which binding happened first, and SHALL NOT surface a notification when it does so.

#### Scenario: Workflow repository connected before the tenant is bound to Git
- **WHEN** a tenant already has a connected Custom Workflow Repository and is subsequently bound to Git
- **THEN** the outer repository's `.gitignore` excludes `Workflows/Custom Workflows/` after the next activation or tree refresh
- **AND** no notification is shown

#### Scenario: Tenant bound to Git before the workflow repository is connected
- **WHEN** a tenant is already bound to Git and the Custom Workflow Repository is connected afterward
- **THEN** the outer repository's `.gitignore` excludes `Workflows/Custom Workflows/` immediately
- **AND** no notification is shown

#### Scenario: The safeguard never overwrites unrelated `.gitignore` content
- **WHEN** the outer repository's `.gitignore` already has unrelated entries
- **THEN** those entries remain
- **AND** the new entry is appended only if absent

### Requirement: BPMN files in the connected repository are discovered by content, not filename
The extension SHALL discover BPMN files anywhere under the connected repository by parsing each candidate file's `<process id>`, and SHALL NOT rely on filename to determine identity.

#### Scenario: A file is recognized regardless of its name
- **WHEN** a file with any name parses to a non-empty process id via the existing BPMN model extraction
- **THEN** it is included in discovery

#### Scenario: Discovery is depth-limited and skips dotfolders
- **WHEN** the repository contains deeply nested or dotfolder-prefixed paths
- **THEN** discovery stops at the same depth limit used elsewhere in this codebase for file discovery
- **AND** dotfolders are skipped

### Requirement: A Process Definition shows a sync badge against its matching repository file
For a deployed Process Definition whose type matches a discovered repository file's process id, the extension SHALL compare that file's content against the deployed XML and mark the definition `clean` or `changed`, reusing the existing local-state indicator.

#### Scenario: A byte-identical repository file is clean
- **WHEN** a discovered repository file's content is byte-identical to the deployed XML for the matching process id
- **THEN** the Process Definition is marked `clean`

#### Scenario: A differing repository file is changed
- **WHEN** a discovered repository file's content differs from the deployed XML for the matching process id
- **THEN** the Process Definition is marked `changed`

#### Scenario: The badge recomputes on demand and after relevant actions
- **WHEN** the user runs Refresh Sync, or completes Fetch Workflows or a deploy for that tenant
- **THEN** sync state is recomputed
- **AND** no filesystem watcher is used to trigger recomputation on every save

### Requirement: A BPMN file in the connected repository can be deployed directly
The extension SHALL allow deploying a BPMN file that lives in the connected Custom Workflow Repository directly to the tenant, without first copying it into the Drafts folder.

#### Scenario: Deploy resolves context from the repository when Drafts' resolution does not match
- **WHEN** the user deploys a file that is not a recognized Draft but lives under a connected repository
- **THEN** the extension resolves the tenant and process id from the file's location and content
- **AND** deploys its saved contents directly

#### Scenario: A direct deploy leaves the source file untouched
- **WHEN** a direct deploy from the repository succeeds
- **THEN** the repository file is not moved, copied, or modified
- **AND** the deployed process appears as an ordinary Process Definition
