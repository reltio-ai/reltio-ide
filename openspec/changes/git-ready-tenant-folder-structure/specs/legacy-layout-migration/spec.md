## ADDED Requirements

### Requirement: Legacy tenant folders are migrated automatically on activation
On activation, the extension SHALL detect tenant folders using the legacy flat layout and migrate them to the component tree without prompting. Migration SHALL move files rather than copy them, preserving content byte-for-byte.

| From (tenant folder root) | To (tenant folder root) |
|---|---|
| `L3.reltio.json` | `Business Config/BusinessConfig.json` |
| `L3.remote-baseline.reltio.json` | `.reltio-ide/BusinessConfig.baseline.json` |
| `L3.reltio.layout.json` | `.reltio-ide/BusinessConfig.layout.json` |
| `history/` | `.reltio-ide/history/` |

#### Scenario: A legacy tenant is migrated on first activation after upgrade
- **WHEN** a workspace containing a legacy tenant folder is opened with the updated extension
- **THEN** each legacy file is moved to its new path
- **AND** the full component tree with `README.md` placeholders is materialized
- **AND** file contents are unchanged

#### Scenario: A partially populated tenant migrates what exists
- **WHEN** a legacy tenant has `L3.reltio.json` but no baseline, layout, or history
- **THEN** only the configuration file is moved
- **AND** the absence of the other files is not treated as an error

#### Scenario: An already-migrated tenant is left alone
- **WHEN** a tenant folder already uses the component tree
- **THEN** no files are moved and no backup is taken

#### Scenario: Migration does not block activation
- **WHEN** migration is running
- **THEN** activation completes and the extension remains responsive
- **AND** the tree refreshes once migration finishes

### Requirement: Migration takes a backup before moving anything
Before the first file is moved in a tenant folder, the extension SHALL create a backup of that folder's legacy files at `.reltio-ide-backup/{environment}/{tenantId}/` relative to the workspace root. The location is outside the tenant folder so it is never captured by a subsequent commit, and inside the workspace so the user can find it. The extension SHALL add `.reltio-ide-backup/` to the workspace-root `.gitignore`, and SHALL report the backup location to the user.

#### Scenario: A backup exists before any move
- **WHEN** migration begins for a tenant
- **THEN** a backup of the legacy files is written to `.reltio-ide-backup/{environment}/{tenantId}/` before the first move
- **AND** the backup is outside the tenant folder

#### Scenario: The backup directory is ignored at the workspace root
- **WHEN** a backup is written
- **THEN** `.reltio-ide-backup/` is present in the workspace-root `.gitignore`
- **AND** unrelated entries in that file are preserved

#### Scenario: The backup is retained after migration
- **WHEN** migration completes successfully
- **THEN** the backup is left on disk rather than deleted
- **AND** its location is included in the summary reported to the user

#### Scenario: A failed backup aborts the migration
- **WHEN** the backup cannot be written
- **THEN** no file is moved for that tenant
- **AND** the failure is reported with the reason

### Requirement: Migration runs at most once per tenant
Migration SHALL be guarded by a stamp in `workspaceState` keyed per environment and tenant. A tenant that has been migrated, or explicitly skipped, SHALL NOT be reconsidered on later activations.

#### Scenario: Reopening the workspace does not re-run migration
- **WHEN** a migrated workspace is closed and reopened
- **THEN** no migration is attempted and no backup is taken

#### Scenario: Migration is interrupted partway
- **WHEN** migration fails after moving some but not all files
- **THEN** the stamp is not written for that tenant
- **AND** the next activation retries the migration for that tenant

### Requirement: Migration refuses to run on a dirty Git worktree
A tenant folder that is a Git repository with uncommitted changes SHALL NOT be migrated, because moving tracked files would produce a large unintended diff on top of the user's work.

#### Scenario: Uncommitted changes block migration
- **WHEN** a legacy tenant folder is a Git repository with a dirty worktree
- **THEN** migration is skipped for that tenant
- **AND** the user is told which tenant was skipped and why
- **AND** no stamp is written, so migration is retried once the worktree is clean

#### Scenario: A clean worktree migrates normally
- **WHEN** a legacy tenant folder is a Git repository with no uncommitted changes
- **THEN** migration proceeds

### Requirement: Migration reports what it did
After migration completes, the extension SHALL show a non-blocking notification summarizing how many tenants were migrated, how many were skipped, and where the backup is. The notification SHALL offer an action to view the detail.

#### Scenario: A summary is shown after migration
- **WHEN** migration completes for one or more tenants
- **THEN** a non-modal notification states the number migrated and skipped
- **AND** it offers an action that reveals the per-file detail

#### Scenario: Nothing to do means no notification
- **WHEN** no tenant required migration
- **THEN** no notification is shown

### Requirement: Migration can be undone
A `reltio.undoLayoutMigration` command SHALL restore the legacy layout for tenants migrated in this workspace, using the backup taken at migration time. The command SHALL clear the migration stamp so the tenant is reconsidered on the next activation.

#### Scenario: Undo restores the legacy layout
- **WHEN** the user runs **Undo Layout Migration** after a migration
- **THEN** the legacy files are restored to their original paths
- **AND** the migration stamp is cleared

#### Scenario: Undo requires confirmation
- **WHEN** the user runs **Undo Layout Migration**
- **THEN** a confirmation stating which tenants will be reverted is shown first
- **AND** nothing is changed unless the user confirms

#### Scenario: Undo with no backup is refused
- **WHEN** no backup exists for this workspace
- **THEN** the command reports that there is nothing to undo
- **AND** no files are modified
