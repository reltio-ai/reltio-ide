## ADDED Requirements

### Requirement: An environment/tenant pair may originate from a git repository instead of a live tenant connection
The environment-management capability SHALL support a synthetic environment/tenant pair backed by a git-discovered L3 file, in addition to the existing live-tenant-backed kind. A workspace SHALL have at most one active source (live tenant connection, or git repository) at a time.

#### Scenario: Only one source is active per workspace
- **WHEN** a workspace already has a connected Reltio tenant
- **THEN** it cannot also become git-sourced without opening a different folder
- **AND** the reverse also holds: a git-sourced workspace cannot also connect a live tenant in the same folder

### Requirement: Removing a git-sourced environment deletes the folder's contents, not just tenant-local files
Unlike removing a live-tenant environment (which deletes only that environment's local tenant directories), removing a git-sourced environment SHALL delete every file in the workspace folder, since the git-sourced "environment" is the entire cloned repository rather than a `*.reltio.environment` subdirectory. This is destructive and irreversible at the application level, so it SHALL require explicit confirmation before proceeding, and SHALL prefer a recoverable deletion (OS trash) where the filesystem supports it.

#### Scenario: Remove Repository requires confirmation
- **WHEN** the user selects **Remove Repository**
- **THEN** a modal warning is shown stating that all files in the folder will be deleted and this cannot be undone
- **AND** no file is deleted unless the user explicitly confirms

#### Scenario: Remove Repository clears the whole folder
- **WHEN** the user confirms **Remove Repository**
- **THEN** every top-level file and folder inside the workspace root is deleted — tracked and untracked/dirty files alike, since there is no tenant to preserve state on
- **AND** the workspace folder itself is not deleted, remaining open and empty

#### Scenario: Deletion prefers the OS trash, with a permanent-delete fallback
- **WHEN** an entry can be moved to the OS trash
- **THEN** it is moved to the trash rather than permanently deleted
- **WHEN** the OS trash is unavailable for a given entry (e.g. a network drive or remote/WSL filesystem without trash support)
- **THEN** that entry is permanently deleted instead, so the overall removal does not fail solely because trash isn't supported
