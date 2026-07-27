## Why

Reltio exposes configuration history via `GET …/reltio/api/{tenant}/configuration/_history?offset=&max=`, but each entry embeds the **full** tenant configuration. That payload is heavy to transfer repeatedly and awkward to inspect in raw JSON. Editors need a **lightweight list** of who changed what and when, optional **local caching** of snapshots to avoid refetching, and **diff workflows** against the current `L3.reltio.json`—without leaving the multi-tenant tree workflow.

## What Changes

- Add a **Configuration history** subtree under each **tenant** node in the Reltio tree: hidden until the user runs **Fetch configuration history** (first fetch pulls **10** recent entries by default).
- Call the **history API** with `offset` / `max`, parse `updatedBy`, `timestamp`, and `configuration`, and persist each snapshot under the tenant folder as `history/L3-<sanitizedUpdatedBy>---<timestamp>.reltio.json` (JSON body = the `configuration` object only, formatted for readability).
- Tree labels for each snapshot: **`DD-MM-YYYY HH:MM (username)`** (local time from epoch `timestamp` string/number as returned by API).
- **Open** a snapshot in the editor from the tree; **Compare with current** opens a VS Code diff between the snapshot and the tenant’s current `L3.reltio.json`.
- Support **Select for compare** / **Compare with selected** (two-step compare pattern familiar from the file explorer) between two history snapshots and/or current L3 where applicable.
- When at least one history file exists for the tenant, offer **Fetch more configuration history**: increase `offset` by the number already fetched (or next page semantics) and append older snapshots without deleting existing files unless explicitly decided in design.

## Capabilities

### New Capabilities

- `configuration-history`: Browse, fetch, persist, open, and diff tenant configuration history from Reltio’s `_history` API; integrate with the multi-tenant tree and local `history/` snapshot files.

### Modified Capabilities

- _(None at `openspec/specs/` — project uses change-local specs only today.)_

## Impact

- **`src/api/reltioClient.ts`** (or adjacent module): new `fetchConfigurationHistory` helper with `offset` / `max`, typed response parsing, same auth/error patterns as `fetchL3Configuration`.
- **`src/tree/multiTenantTreeProvider.ts`**, **`src/tree/multiTenantNodes.ts`**, **`src/tree/treeNodes.ts`**: new node types (`history` folder, snapshot items), context menu commands, lazy visibility rules.
- **`src/extension.ts`**: register commands (**Fetch configuration history**, **Fetch more…**, **Compare with current**, **Select for compare**, **Compare selected**), wire progress and errors.
- **`src/workspace/environmentManager.ts`** (or tenant path helpers): resolve `history/` under `{tenant}.reltio.tenant/`, write snapshot files, list existing snapshots for tree rebuild.
- **`package.json`**: new `contributes.commands` and `view/item/context` entries.
- **Filesystem**: new optional directory per tenant: `history/` alongside `L3.reltio.json` (not committed if under gitignored examples; convention documented in design).
