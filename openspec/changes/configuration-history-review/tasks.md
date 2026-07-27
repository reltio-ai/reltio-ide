## 1. API layer

- [x] 1.1 Add `fetchConfigurationHistory(baseUrl, tenantId, token, offset, max)` in `src/api/reltioClient.ts` (or `src/api/configurationHistory.ts` re-exported from client barrel) using the same HTTPS + Bearer + timeout + `ReltioApiError` patterns as `fetchL3Configuration`.
- [x] 1.2 Define a small `ConfigurationHistoryEntry` type (`updatedBy`, `timestamp`, `configuration: unknown`) and validate response shape (array; per-item object with required keys) before returning.

## 2. Filesystem and persistence

- [x] 2.1 Add helpers on the workspace side to resolve `{tenantUri}/history/`, ensure directory exists, and build filename `L3-<sanitizedUpdatedBy>---<timestamp>.reltio.json` per design D1.
- [x] 2.2 Implement `writeHistorySnapshot(entry)` that JSON-stringifies **only** `configuration` with stable formatting and writes the file idempotently (skip or overwrite if same name—pick one and document in code comment).
- [x] 2.3 Implement `listLocalHistorySnapshots(tenantFolder)` returning sorted metadata (path, timestamp, updatedBy) for tree population, newest first.

## 3. Tree UI

- [x] 3.1 Extend tenant / tree node model with a **History** folder node and snapshot leaf nodes (`treeNodes.ts` / `multiTenantNodes.ts`); assign distinct `viewItem` context values for context menus.
- [x] 3.2 Update `multiTenantTreeProvider.ts` to lazy-load History children from disk; wire primary open for snapshot files to open the document.
- [x] 3.3 Label formatter: `DD-MM-YYYY HH:MM (updatedBy)` from parsed `timestamp` (ms) in local time.

## 4. Commands and context menus

- [x] 4.1 Register **Fetch configuration history** (`max=10`, `offset=0`), **Fetch more configuration history** (offset = snapshot count, same `max`), with progress notifications and tree refresh on success.
- [x] 4.2 Register **Compare with current** on snapshot nodes using `vscode.diff` against the tenant’s `L3.reltio.json` URI.
- [x] 4.3 Register **Select for compare** and **Compare selected** using `workspaceState` (or equivalent) to store first URI and open diff when second is chosen; guard missing first selection with a user-visible message.
- [x] 4.4 Add `package.json` `commands` + `menus` (`view/item/context`) entries; ensure commands only appear when `viewItem` matches tenant/history/snapshot contexts per spec.
- [x] 4.5 Implement **Compare with previous snapshot** (design D5): from a history snapshot node, list `history/` via `listLocalHistorySnapshots` (newest first), locate the selected file, and if a **chronologically older** neighbor exists (next entry in that sorted list), open `vscode.diff` with **older on the left** and **selected on the right** (or match existing compare conventions); use a clear diff title. If the selected file is the **oldest** on disk, show an informational message and do not open a diff.
- [x] 4.6 Register the new command in `package.json` (`commands` + `view/item/context`). Either expose the menu only when an older neighbor exists (e.g. set a distinct `contextValue` in `MultiTenantTreeProvider.resolveTreeItem` after resolving the neighbor) or keep the entry on all snapshots and rely on the message from 4.5—pick one and align with design D5.
- [x] 4.7 Extend `ARCHITECTURE.md` commands table (and **Manual verification** if present) to describe **Compare with previous snapshot** and how neighbor selection works.

## 5. Documentation and polish

- [x] 5.1 Update `ARCHITECTURE.md` with the `history/` snapshot convention and new commands (if structural per project rules).
- [x] 5.2 Manual test matrix: first fetch, reopen workspace (History visible from disk), fetch more, open snapshot, compare with current, two-snapshot compare, 401 handling. (Steps documented under **Manual verification** in `ARCHITECTURE.md`.)
- [x] 5.3 Manual checks for **Compare with previous snapshot**: at least two snapshots on disk — run on the newest (diff vs older), run on the oldest (expect info message), optional menu visibility if 4.6 uses `contextValue`. (Documented under **Manual verification** in `ARCHITECTURE.md`.)
