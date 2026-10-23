## MODIFIED Requirements

### Requirement: The History folder reflects what exists, not what once happened
The History folder SHALL be shown when a tenant has configuration snapshots on disk, or when a history fetch during the current session returned none. It SHALL NOT persist that second condition beyond the session.

#### Scenario: A newly connected tenant shows no History folder
- **WHEN** a tenant is added and its configuration is fetched
- **AND** no configuration history has been fetched for it
- **THEN** no History folder SHALL appear under it

#### Scenario: An empty fetch still confirms itself
- **WHEN** the user fetches configuration history and the service returns no snapshots
- **THEN** the History folder SHALL appear, empty
- **AND** the command SHALL NOT appear to have done nothing

#### Scenario: That confirmation does not outlive the session
- **WHEN** the window is reloaded after a history fetch that returned no snapshots
- **THEN** no History folder SHALL appear for that tenant
- **AND** the user SHALL NOT be shown an empty folder they cannot dismiss or explain

#### Scenario: Real snapshots survive a reload
- **WHEN** the window is reloaded after a history fetch that wrote snapshot files
- **THEN** the History folder SHALL appear with those snapshots

#### Scenario: A removed tenant leaves no residue
- **WHEN** a tenant is removed and re-added within the same session
- **AND** a history fetch had previously returned no snapshots for it
- **THEN** no History folder SHALL appear on the re-added tenant

#### Scenario: A removed environment leaves no residue
- **WHEN** an environment is removed
- **THEN** the session markers for all of its tenants SHALL be cleared
