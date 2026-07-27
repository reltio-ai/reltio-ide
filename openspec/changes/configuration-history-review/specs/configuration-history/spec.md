## ADDED Requirements

### Requirement: History API client

The extension SHALL provide an authenticated HTTP GET to `{environment}/reltio/api/{tenantId}/configuration/_history` with query parameters `offset` and `max`, returning parsed history entries containing at least `updatedBy`, `timestamp`, and the full `configuration` object per row.

#### Scenario: Unauthorized response surfaces error

- **WHEN** the API returns HTTP 401
- **THEN** the client SHALL surface an error consistent with existing `fetchL3Configuration` unauthorized handling so the tree can show locked/unauthorized state

#### Scenario: Successful page returns typed rows

- **WHEN** the API returns HTTP 200 with a JSON array of history objects
- **THEN** each object SHALL be parsed into a structure usable for persistence and tree labeling

### Requirement: Persist configuration snapshots on disk

For each fetched history entry, the extension SHALL write one file under `{tenantFolder}/history/` named `L3-<sanitizedUpdatedBy>---<timestamp>.reltio.json` where the file content is the `configuration` JSON document (formatted). Filenames MUST be stable for the same `updatedBy` + `timestamp` pair.

#### Scenario: Sanitized username in filename

- **WHEN** `updatedBy` contains characters unsafe for file names
- **THEN** the persisted filename SHALL use a sanitized form without altering the in-file configuration payload

### Requirement: Tree integration for configuration history

The multi-tenant tree SHALL expose a **History** subtree under a tenant when either (a) the tenant’s `history/` directory contains at least one matching snapshot file, or (b) the user has successfully completed **Fetch configuration history** in the current session and snapshots were written. Each snapshot file SHALL appear as a child node with label `DD-MM-YYYY HH:MM (updatedBy)` using local timezone.

#### Scenario: Open snapshot from tree

- **WHEN** the user activates a snapshot node (e.g., primary open)
- **THEN** the extension SHALL open that snapshot file in the editor

#### Scenario: Context actions on tenant when history exists

- **WHEN** at least one snapshot file exists for the tenant
- **THEN** the tenant (or History folder) SHALL offer **Fetch more configuration history** using the paging rules from design

### Requirement: Fetch initial and additional history pages

The extension SHALL register a command **Fetch configuration history** that requests the latest entries with `max=10` and `offset=0`, writes snapshot files, and refreshes the tree. It SHALL register **Fetch more configuration history** that requests the next page using `offset` equal to the number of snapshots already stored and the same `max`, appending new files without overwriting prior distinct snapshots.

#### Scenario: First fetch pulls ten or fewer rows

- **WHEN** the user runs **Fetch configuration history** and the API returns N≤10 entries
- **THEN** N snapshot files SHALL be created and the tree SHALL list N snapshot nodes

### Requirement: Compare snapshot with current L3

The extension SHALL provide **Compare with current** on a snapshot node that opens the built-in diff editor between the snapshot file and the tenant’s current `L3.reltio.json`.

#### Scenario: Diff title identifies sides

- **WHEN** the diff opens
- **THEN** the editor tab titles or diff title SHALL make clear which side is history and which is current

### Requirement: Two-step compare between history entries

The extension SHALL provide **Select for compare** on a snapshot (or current L3 if in scope) and **Compare selected** on a second URI, opening a diff between the two selections following the same mental model as VS Code’s file explorer.

#### Scenario: Compare selected without prior selection

- **WHEN** the user runs **Compare selected** with no prior **Select for compare**
- **THEN** the extension SHALL show a clear warning or information message and SHALL NOT open a blank diff

### Requirement: Command registration and discoverability

New commands SHALL be declared in `package.json` with titles and SHALL be reachable from the tree context menu on the appropriate nodes (tenant, history folder, snapshot).

#### Scenario: Commands appear only when relevant

- **WHEN** history has not yet been fetched for a tenant and no `history/` files exist
- **THEN** **Fetch configuration history** SHALL be available and **Fetch more configuration history** SHALL NOT be offered
