## ADDED Requirements

### Requirement: User can connect a git repository as a config source
The extension SHALL provide a **Connect your Repository** action on the welcome screen, shown only when the tree is empty (alongside **Connect your Reltio Tenant**), which invokes `reltio.fetchConfigFromGit`.

#### Scenario: Welcome screen shows both connection options
- **WHEN** a workspace folder is open and no environment or git source exists yet
- **THEN** the tree view welcome content shows both **Connect your Reltio Tenant** and **Connect your Repository**

### Requirement: Cloning targets the currently open folder
When the open workspace folder is not already a git repository with a remote, invoking **Connect your Repository** SHALL prompt for a git remote URL and clone it directly into that folder using the system `git` executable, without creating a nested subfolder.

#### Scenario: Clone into an empty open folder
- **WHEN** the user invokes **Connect your Repository** in an empty, non-git folder
- **AND** enters a valid git remote URL
- **THEN** the extension clones the repository directly into the open folder (not a subfolder)
- **AND** authentication is delegated entirely to the system git installation and its credential helper — no custom login UI is shown by the extension

#### Scenario: Clone rejected when the folder is not empty
- **WHEN** the user invokes **Connect your Repository** in a folder that contains user files and is not already a git repository
- **THEN** the extension shows an error asking for an empty folder and does not attempt to clone

#### Scenario: Git executable not found
- **WHEN** the user invokes **Connect your Repository** and no `git` executable can be resolved (via the `git.path` setting or `PATH`)
- **THEN** the extension shows an actionable error message pointing at Git installation instructions
- **AND** no partial clone is left behind

### Requirement: An already-cloned repository is detected without re-cloning
When the open workspace folder already has a `.git` directory with an `origin` remote configured, invoking **Connect your Repository** SHALL skip the clone step entirely and proceed directly to L3 discovery.

#### Scenario: Re-running the command on an already-cloned repo
- **WHEN** the open folder is already a git repository with a configured remote
- **AND** the user invokes **Connect your Repository**
- **THEN** no URL prompt or clone is triggered
- **AND** the extension proceeds directly to discovering the L3 file

### Requirement: L3 file discovery within the repository
The extension SHALL search the repository for a file named `L3.reltio.json` or `L3.json`, starting at the repository root and descending into subfolders up to a fixed depth, skipping dotfolders.

#### Scenario: Single L3 file found
- **WHEN** exactly one `L3.reltio.json` or `L3.json` file is found in the repository
- **THEN** that file is automatically selected as the config source, with no further prompt

#### Scenario: Multiple L3 files found
- **WHEN** more than one matching file is found
- **THEN** the extension shows a quick-pick listing each candidate's repository-relative path
- **AND** the user's selection becomes the config source

#### Scenario: No L3 file found
- **WHEN** no file named `L3.reltio.json` or `L3.json` is found anywhere in the repository
- **THEN** the extension shows a file-open dialog scoped to the repository so the user can manually locate the config file

### Requirement: Discovered L3 file is treated as a synthetic tenant
Once an L3 file is chosen, the extension SHALL synthesize an environment and tenant entry — named after the repository folder and the L3 file's parent folder (or `"default"` at repo root) — so the existing environment/tenant tree, navigation, and ontology preview work on it exactly as they would for a fetched tenant L3, with no code path forking on where the data came from.

#### Scenario: Tree populates after a successful connect
- **WHEN** an L3 file is chosen (via auto-selection, quick-pick, or the file dialog)
- **THEN** the tree view shows one environment node and one tenant node wrapping the discovered L3
- **AND** expanding the tenant node shows the same entity/relation-type navigation available for a tenant-fetched L3
- **AND** the environment node does not show a "sign in required" state or a lock icon

### Requirement: Git-sourced and tenant-connected workspaces are mutually exclusive
A workspace SHALL be in exactly one of: no source connected, tenant-connected, or git-sourced. Once a workspace is git-sourced, tenant-connectivity actions (login, configure OAuth, provide token, add/remove environment or tenant, fetch/apply configuration, fetch configuration history) SHALL NOT be shown in the tree's context menus. Once a workspace has a connected tenant, **Connect your Repository** SHALL NOT be reachable via the welcome screen, and invoking it via the Command Palette SHALL be refused with an explanatory error rather than silently changing the workspace's mode.

#### Scenario: Tenant-only actions hidden in git mode
- **WHEN** a workspace is git-sourced
- **THEN** right-clicking the environment or tenant node does not show Login, Configure OAuth Client, Provide Token, Add Tenant, Remove Tenant, Copy Tenant ID, Refresh Environment, Fetch Configuration, Apply Configuration, or Fetch Configuration History
- **AND** entity/relation/attribute insert, delete, and rename actions remain available

#### Scenario: Command Palette cannot hijack a connected tenant workspace
- **WHEN** a workspace already has a connected Reltio tenant
- **AND** the user invokes `reltio.fetchConfigFromGit` directly (e.g. via the Command Palette)
- **THEN** the extension shows an error explaining the workspace already has a connected tenant
- **AND** the workspace's mode and tree are unchanged

### Requirement: Git mode restores automatically on later activations
The extension SHALL persist the discovered L3's location in a small marker file at the repository root, gitignored, so that on a later activation of the same folder it can restore git mode without re-prompting — provided the folder is still a git repository and the recorded L3 file still exists.

#### Scenario: Reopening a git-sourced workspace
- **WHEN** a workspace was previously connected via **Connect your Repository**
- **AND** the same folder is reopened in a fresh VS Code session
- **THEN** the tree populates in git mode automatically, with no prompts
- **AND** the marker file itself is excluded from the repository's version control via `.gitignore`

#### Scenario: Restore fails safely when the recorded L3 is missing
- **WHEN** a workspace has a git-source marker but the recorded L3 file no longer exists, or the folder is no longer a git repository
- **THEN** the extension does not restore git mode
- **AND** the welcome screen is shown instead

### Requirement: A git-sourced repository can be removed
The extension SHALL provide a **Remove Repository** action on the environment node, shown only in git mode, that deletes all files in the workspace folder and unlinks the git source, returning the workspace to the welcome screen.

#### Scenario: Removing a connected repository
- **WHEN** the user right-clicks the environment node in a git-sourced workspace and selects **Remove Repository**
- **AND** confirms the warning prompt
- **THEN** every file in the workspace folder is deleted
- **AND** the workspace's git source, sentinel authentication state, and mode are cleared
- **AND** the tree reverts to the welcome screen

#### Scenario: Partial deletion still clears git-source state
- **WHEN** **Remove Repository** is confirmed but some files fail to delete (e.g. a locked file)
- **THEN** the extension still clears the git-source state, sentinel token, and workspace mode
- **AND** shows an error naming which part of the operation failed, so the tree does not keep pointing at a git source over a partially-emptied folder

### Requirement: `L3.json` is a fully-supported config filename
Wherever the extension recognizes `*.reltio.json` for navigation, diagnostics, schema validation, or tree refresh, it SHALL also recognize a file named exactly `L3.json`.

#### Scenario: Navigation and diagnostics work on L3.json
- **WHEN** a git-sourced workspace's config file is named `L3.json`
- **THEN** go-to-definition, find-references, URI auto-completion, document links, live diagnostics, and JSON schema validation all work on it exactly as they would for `*.reltio.json`
