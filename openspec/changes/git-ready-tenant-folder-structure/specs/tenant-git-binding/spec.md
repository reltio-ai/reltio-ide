## ADDED Requirements

### Requirement: A tenant folder is itself the Git repository root
When a tenant is bound to Git, the `.git` directory SHALL live at the tenant folder root. The environment folder and the workspace root SHALL remain outside the repository. This guarantees that no tracked path contains an environment host or tenant ID.

#### Scenario: Tracked paths carry no tenant identity
- **WHEN** a bound tenant's configuration is committed
- **THEN** the tracked path is `Business Config/BusinessConfig.json`
- **AND** no tracked path contains the environment host or the tenant ID

#### Scenario: Two tenants of one remote produce identical paths
- **WHEN** a Dev tenant and a Prod tenant are bound to the same remote on branches `dev` and `prod`
- **THEN** the set of tracked paths in each is identical
- **AND** a diff between the two branches shows only content differences, never path differences

#### Scenario: Tenants are independent repositories
- **WHEN** one tenant folder is bound to Git
- **THEN** other tenant folders in the same workspace are unaffected and may be unbound or bound to a different branch

### Requirement: User can connect a tenant folder to a Git remote and branch
A `reltio.connectTenantToGit` command, titled **Connect to Git**, SHALL be available on a tenant node. It SHALL prompt for a remote URL, then for a branch, then bind the tenant folder to that branch. The remote URL SHALL be remembered per workspace and offered as the default on subsequent invocations, because every tenant in a promotion flow shares one remote. The branch SHALL be asked for every time, because it differs per tenant.

#### Scenario: Connecting clones the chosen branch
- **WHEN** the user runs **Connect to Git**, supplies a remote URL and the branch `dev`
- **THEN** that branch is cloned into the tenant folder
- **AND** the tenant folder contains a `.git` directory

#### Scenario: The remote is remembered, the branch is not
- **WHEN** the user connects a second tenant in the same workspace
- **THEN** the remote URL prompt is pre-filled with the previously used remote
- **AND** the branch is asked for afresh

### Requirement: The branch is chosen from the remote's existing branches
The command SHALL list the remote's branches and offer them for selection, with an explicit option to create a new one by typing its name. Listing SHALL NOT require cloning, so that abandoning the command at this point leaves the tenant folder untouched.

#### Scenario: Existing branches are offered
- **WHEN** the remote has branches `dev`, `test` and `prod`
- **THEN** all three are offered for selection
- **AND** an option to create a new branch is offered alongside them

#### Scenario: Nothing is written while choosing
- **WHEN** the user dismisses the branch selection
- **THEN** the tenant folder is exactly as it was before the command ran

#### Scenario: A remote with no branches goes straight to free text
- **WHEN** the remote has no branches yet
- **THEN** the user is asked to type a branch name instead of being shown an empty list

#### Scenario: A remote that cannot be listed goes straight to free text
- **WHEN** the branch listing fails, for example because the remote is unreachable
- **THEN** the user is asked to type a branch name
- **AND** the command proceeds, so the bind itself reports the underlying failure

#### Scenario: An invalid branch name is rejected before binding
- **WHEN** the user types a name containing characters Git rejects
- **THEN** the input is refused with an explanation and nothing is written

#### Scenario: A tenant that has already fetched is adopted, not refused
- **WHEN** the tenant folder already contains a fetched configuration
- **THEN** the repository is created in place and the remote branch's history is adopted underneath the existing files
- **AND** every file already on disk is byte-identical afterwards
- **AND** the configuration is reported as an uncommitted change against that branch

#### Scenario: Adoption never overwrites local work
- **WHEN** the remote branch holds a different version of `Business Config/BusinessConfig.json`
- **THEN** the local file is left exactly as it was and the difference appears as a modification
- **AND** no `--hard` reset, checkout or merge touches the working tree

#### Scenario: Declining branch creation during adoption leaves no trace
- **WHEN** the branch is absent on the remote and the user declines to create it
- **THEN** the repository initialized for the attempt is removed
- **AND** the tenant folder is left exactly as it was found

#### Scenario: The component tree is materialized after cloning
- **WHEN** the clone completes and the cloned branch does not already contain the component tree
- **THEN** any missing component folders and their `README.md` placeholders are created

#### Scenario: Git is not installed
- **WHEN** the system `git` executable cannot be found
- **THEN** the existing `GitNotFoundError` guidance is shown, directing the user to install Git

### Requirement: A branch absent from the remote can be created on request
When the requested branch does not exist on the remote, the command SHALL offer to create it rather than failing outright. On confirmation it SHALL clone the remote's default branch, create the requested branch from it, and publish it with an upstream tracking reference. The new branch SHALL share history with the default branch, so a pull request between promotion branches is meaningful.

#### Scenario: Creating a missing branch is offered, not assumed
- **WHEN** the requested branch does not exist on the remote
- **THEN** a confirmation naming the branch and the remote is shown
- **AND** nothing is created unless the user confirms

#### Scenario: Confirming creates and publishes the branch
- **WHEN** the user confirms creation
- **THEN** the remote's default branch is cloned into the tenant folder
- **AND** the requested branch is created from it and pushed with an upstream tracking reference
- **AND** the new branch shares history with the default branch

#### Scenario: Declining leaves the folder untouched
- **WHEN** the user declines creation
- **THEN** the tenant folder is left empty rather than partially cloned
- **AND** the original "branch not found" reason is reported

#### Scenario: A failed publish is reported without a silent partial success
- **WHEN** the branch is created locally but the push fails, for example for lack of write access
- **THEN** the underlying Git failure is surfaced
- **AND** the user is told the branch exists locally but was not published

#### Scenario: An empty remote cannot be branched from
- **WHEN** the remote has no commits and therefore no default branch
- **THEN** the command reports that the repository is empty and asks the user to push an initial commit first
- **AND** no branch is created

### Requirement: A generated `.gitignore` keeps IDE state out of the repository
On binding a tenant to Git, the extension SHALL ensure the tenant folder's `.gitignore` excludes `.reltio-ide/` and the `.reltio-config-source.json` marker. Existing `.gitignore` content SHALL be preserved and entries SHALL NOT be duplicated.

#### Scenario: A clean tenant shows only configuration
- **WHEN** a tenant has been bound, fetched, and had its ontology laid out
- **AND** the user runs `git status`
- **THEN** only files under the component tree appear
- **AND** `.reltio-ide/` and the marker file do not appear

#### Scenario: Existing ignore rules are preserved
- **WHEN** the tenant folder already has a `.gitignore` with unrelated entries
- **THEN** those entries remain
- **AND** the required entries are appended only if absent

### Requirement: Tenant identity is read from the marker, not the path
The environment name and tenant ID SHALL be persisted in the gitignored `.reltio-config-source.json` marker inside the tenant folder. The tree view SHALL source its environment and tenant labels from the marker when present, falling back to the folder name when it is absent.

#### Scenario: Labels survive a tenant-agnostic checkout
- **WHEN** a tenant folder is bound to Git and the marker is present
- **THEN** the tree view shows the environment host and tenant ID from the marker

#### Scenario: Unbound tenants still resolve
- **WHEN** a tenant folder has no marker file
- **THEN** the environment and tenant ID are derived from the folder names as before

#### Scenario: The marker is never committed
- **WHEN** a bound tenant is committed
- **THEN** `.reltio-config-source.json` is not part of the commit

### Requirement: The tree view displays each bound tenant's current branch
For a tenant folder that is a Git repository, the tree SHALL display the current branch, read from Git rather than stored in extension state. Branch information SHALL be omitted, not faked, when it cannot be determined.

#### Scenario: The branch is shown alongside the tenant
- **WHEN** a tenant is bound and checked out on `dev`
- **THEN** the tenant row shows `dev`

#### Scenario: Branch changes made outside the extension are reflected
- **WHEN** the user checks out a different branch from a terminal and the tree refreshes
- **THEN** the tree shows the new branch

#### Scenario: Unbound tenants show no branch
- **WHEN** a tenant folder is not a Git repository
- **THEN** no branch is shown and no error is raised

#### Scenario: Detached HEAD does not break the tree
- **WHEN** the tenant repository is in a detached HEAD state
- **THEN** the tree renders without a branch name and logs no user-facing error

### Requirement: A Git repository above the tenant folders is defused and reported
The extension SHALL ensure that a Git repository at or above the workspace root cannot commit extension-managed state, SHALL detect such a repository, and SHALL report it with a way forward. It SHALL NOT attempt to prevent one being created: `git init` and the built-in Source Control **Initialize Repository** are outside its control.

#### Scenario: Extension state is excluded wherever the repository root is
- **WHEN** the extension activates in a tenant-connected workspace
- **THEN** the workspace-root `.gitignore` excludes `.reltio/`, `.reltio-ide/`, `.reltio-ide-backup/` and both marker filenames
- **AND** unrelated entries in that file are preserved and nothing is duplicated

#### Scenario: Environment folders are not ignored by default
- **WHEN** the workspace-root `.gitignore` is written
- **THEN** the environment folders are not excluded, because one repository for the whole workspace is a choice the team may legitimately make

#### Scenario: An enclosing repository is detected
- **WHEN** a repository exists at the workspace root, or at any folder above it
- **THEN** the nearest one is identified, including one at the workspace root itself

#### Scenario: The user is warned once per workspace
- **WHEN** an enclosing repository is detected on activation
- **THEN** a warning explains the consequence and offers to ignore the tenant folders, to show details, or to stop asking
- **AND** dismissing it permanently suppresses the warning for that workspace

#### Scenario: Ignoring tenant folders keeps the outer repository usable
- **WHEN** the user chooses to ignore the tenant folders
- **THEN** each environment folder is added to the enclosing repository's `.gitignore`
- **AND** the user is told that files it already tracks stay tracked until untracked explicitly

#### Scenario: Binding inside another repository is confirmed first
- **WHEN** the user runs **Connect to Git** on a tenant inside an enclosing repository
- **THEN** a modal warning names that repository and explains the tenant would be stored as a pointer rather than its files
- **AND** nothing is written unless the user confirms
