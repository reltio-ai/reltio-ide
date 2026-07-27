## ADDED Requirements

### Requirement: Copy tenant ID from tree context menu

The extension SHALL provide a way to copy the Reltio **tenant ID** of a tenant row in the Reltio configuration tree to the system clipboard from the item’s context (right-click) menu.

#### Scenario: Tenant without L3

- **WHEN** the user opens the context menu on a tenant tree item whose context is `reltio.tenant` (tenant present under an environment, L3 not loaded or not expanded as L3 root)
- **THEN** a menu action labeled in the spirit of **Copy Tenant ID** SHALL be visible
- **WHEN** the user chooses that action
- **THEN** the extension SHALL write exactly that tenant’s ID string to the clipboard and SHALL give non-modal confirmation that the copy succeeded

#### Scenario: Tenant with L3

- **WHEN** the user opens the context menu on a tenant tree item whose context is `reltio.tenant.l3`
- **THEN** the same **Copy Tenant ID** action SHALL be available
- **WHEN** the user chooses that action
- **THEN** the extension SHALL write the same tenant ID string to the clipboard as for the `reltio.tenant` case and SHALL give non-modal confirmation

#### Scenario: Non-tenant tree items

- **WHEN** the context menu is opened on a tree item that is not a tenant row (for example an environment, history folder, or configuration JSON node)
- **THEN** the **Copy Tenant ID** action SHALL NOT be offered for that item
