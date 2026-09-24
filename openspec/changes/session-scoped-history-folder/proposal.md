## Why

The History folder is meant to appear when a tenant has configuration snapshots. `configuration-history-review` added one deliberate exception: after a history fetch that legitimately returns zero rows, the folder is shown anyway, so the command does not look like it did nothing.

That exception was implemented by writing a flag to `workspaceState`, which persists. The courtesy therefore became permanent. Once history had been fetched for a tenant — even once, even returning nothing — an empty History folder reappeared on every subsequent window, and on reconnecting the same tenant in the same workspace, with nothing in it, no explanation, and no way to dismiss it. Users reported it as the History folder appearing "by default" on connect, which is exactly what it looks like from the outside.

The flag is feedback about an action. It should not outlive the session in which the action happened.

## What Changes

- **The marker moves from `workspaceState` to an in-memory `Set`.** A fetch returning zero rows still shows the folder for the rest of the session; a new window shows it only if snapshots are actually on disk.
- **Removing a tenant or an environment clears its markers**, so a re-added tenant does not inherit a decision made about its predecessor — the same reasoning that already governs the workflow cache eviction beside it.
- **`historyExposedStorageKey()` is kept** as the key builder for the set. Its output is unchanged and the existing test that pins it still passes; only where the value is stored has changed.

## Capabilities

**Code**
- **Modified files**: `src/tree/multiTenantTreeProvider.ts` (the `historyExposedThisSession` set, `markHistoryExposed`, `shouldShowHistoryFolder`, `removeTenant`, `removeEnvironment`), `scripts/test-multi-tenant-tree-view.cjs`, `ARCHITECTURE.md`

**External API**
- None.

**Tests**
- Extends `scripts/test-multi-tenant-tree-view.cjs`. The assertions read the provider's source, because storage choice is not observable through the compiled module: a `Map` and `workspaceState` satisfy every behavioural assertion identically until a window is reloaded, which a CLI test cannot do.

**Docs**
- `ARCHITECTURE.md`'s configuration-history section, which currently documents the `workspaceState` behaviour as intended.

**Not in scope (this change)**
- **Removing the zero-rows exception entirely.** Hiding the folder after a successful fetch would make the command appear to fail. The exception is right; its lifetime was wrong.
- **Clearing snapshots from disk.** A folder backed by real files is correct and stays.
