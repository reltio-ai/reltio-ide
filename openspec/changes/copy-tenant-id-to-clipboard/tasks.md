## 1. Command and contribution metadata

- [x] 1.1 In `package.json`, add a command `reltio.copyTenantId` with title **Copy Tenant ID** (and optional category if other Reltio commands use one — match existing entries).
- [x] 1.2 In `package.json` → `menus` → `view/item/context`, add an entry for `reltio.copyTenantId` with `when: view == reltioConfigTree && viewItem =~ /^reltio\\.tenant/` and an appropriate `group` (non-destructive; align with design).

## 2. Extension handler

- [x] 2.1 In `src/extension.ts`, import or ensure `TenantNode` is in scope (same pattern as `reltio.removeTenant`).
- [x] 2.2 Register `reltio.copyTenantId`: accept optional tree argument; if missing or not a `TenantNode`, return without side effects.
- [x] 2.3 Implement `await vscode.env.clipboard.writeText(node.tenantId)` inside try/catch; on success call `vscode.window.setStatusBarMessage` (short duration) per design; on failure `showErrorMessage`.

## 3. Verification

- [x] 3.1 Manual: right-click tenant **without** L3 — menu shows **Copy Tenant ID**, clipboard matches label / `tenantId`.
- [x] 3.2 Manual: right-click tenant **with** L3 (`reltio.tenant.l3`) — same behavior.
- [x] 3.3 Manual: right-click environment or a config JSON node — **Copy Tenant ID** is absent.
- [x] 3.4 Run `npm run compile` (or project’s usual typecheck) and fix any issues.
