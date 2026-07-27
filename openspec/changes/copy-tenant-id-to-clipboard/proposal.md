## Why

Users often need the Reltio tenant ID when calling APIs, sharing with teammates, or pasting into scripts. Today the ID is visible as the tree label but must be selected manually; a one-click copy from the same place they manage tenants reduces friction and mistakes.

## What Changes

- Add a **Copy Tenant ID** action on the Reltio configuration tree context menu for tenant rows under an environment (both `reltio.tenant` and `reltio.tenant.l3` context values).
- Implement an extension command that writes the selected tenant’s ID to the system clipboard and gives brief confirmation (e.g. `vscode.window.setStatusBarMessage` or an information toast, consistent with existing extension patterns).
- Register the command in `package.json` (`commands` + `menus.view/item/context` with `when` clauses scoped to `reltioConfigTree` and tenant `viewItem`s).

## Capabilities

### New Capabilities

- `copy-tenant-id`: User-visible behavior for copying a tenant’s ID from the multi-tenant tree into the clipboard, including menu placement and feedback.

### Modified Capabilities

- _(none — no existing `openspec/specs/` capability specs in this repository.)_

## Impact

- **`package.json`**: new command contribution and `view/item/context` menu entry with `when` matching tenant tree items.
- **`src/extension.ts`** (or a small dedicated module if the project already splits tree commands): register command handler; resolve `TenantNode` from `TreeView.selection` / command arguments per existing tree command patterns.
- **`src/tree/multiTenantNodes.ts`**: no structural change required unless we add tooltip/context metadata; tenant ID is already `TenantNode.tenantId`.
- **VS Code API**: `vscode.env.clipboard.writeText`.
