## Context

The Reltio extension’s **multi-tenant tree** (`MultiTenantTreeProvider`, `reltioConfigTree`) lists environments and, under each authorized environment, **tenant nodes** (`TenantNode` in `src/tree/multiTenantNodes.ts`). Each node already carries `tenantId` as the tree label and a readonly field. Other tenant-scoped commands (`reltio.removeTenant`, `reltio.fetchL3`, etc.) are registered in `src/extension.ts` and receive the clicked `TenantNode` as the command argument from VS Code’s tree context menu.

There is no clipboard usage in the codebase today; the Clipboard API is available as `vscode.env.clipboard`.

## Goals / Non-Goals

**Goals:**

- One command + context menu entry to copy the **tenant ID string** (not host, not URI) for the right-clicked tenant row.
- Work for both tenant presentation modes: `reltio.tenant` (no L3 yet) and `reltio.tenant.l3` (L3 loaded), matching `TenantNode` `contextValue`s.
- User feedback after a successful copy without adding new configuration settings.

**Non-Goals:**

- Copying environment hostname, full API base URL, or bearer token.
- A command-palette-only flow without tree selection (optional follow-up).
- Changing tree labels, IDs, or workspace folder naming.

## Decisions

1. **Command id and title** — Use `reltio.copyTenantId` with title **Copy Tenant ID** (consistent `reltio.*` prefix and existing command naming).
2. **Menu placement** — Add under `view/item/context` with `when: view == reltioConfigTree && viewItem =~ /^reltio\\.tenant/` so both `reltio.tenant` and `reltio.tenant.l3` match, without affecting configuration subtree items (`reltio.item.*`, `reltio.folder.*`). Use a small group such as `2_workspace` or `navigation` adjacent to other non-destructive tenant actions; avoid `9_delete`.
3. **Implementation location** — Register next to other tenant commands in `src/extension.ts`, following the same `(node?: TenantNode) => { if (!node) return; … }` pattern as `reltio.removeTenant` / `reltio.fetchL3`.
4. **Clipboard + feedback** — `await vscode.env.clipboard.writeText(node.tenantId)` then `vscode.window.setStatusBarMessage(\`Copied tenant ID\`, 3000)` (or include the id in the message for clarity). On failure, `showErrorMessage` with the error text. **Rationale:** avoids modal noise; aligns with common VS Code copy UX.
5. **No `TreeView.selection` fallback** — Rely on the context-menu/injected tree item argument like other tree commands. **Rationale:** consistent with existing code; avoids extra complexity.

**Alternatives considered**

- **`showInformationMessage` only** — More visible but interrupts flow; status bar is enough for copy confirmation.
- **Separate menu entries for `reltio.tenant` vs `reltio.tenant.l3`** — Duplication; regex `when` is simpler and stays correct if context values evolve.

## Risks / Trade-offs

- **[Risk] Command invoked with wrong element type** — Mitigation: `instanceof TenantNode` check or narrow typing; early return if not a tenant node.
- **[Risk] Clipboard API restricted in remote/SSH** — Mitigation: catch errors and surface `showErrorMessage`; document as environment limitation if observed in the wild.

## Migration Plan

Not applicable: pure client-side extension behavior, no data migration. Ship in next VSIX; no rollback beyond reverting the command registration.

## Open Questions

None blocking implementation; optional later enhancement: keybinding when tree has focus.
