# Design — session-scoped-history-folder

A corrective change to `configuration-history-review`. The visibility rule is unchanged in intent; only the lifetime of one flag moves.

---

## D1. Session scope, not persistence

**Decision.** The "history has been fetched for this tenant" marker lives in an in-memory `Set` on `MultiTenantTreeProvider`, not in `workspaceState`.

**Rationale.** The marker answers a question about something that just happened: *did the user run a fetch that came back empty?* If so, showing the folder confirms the command ran. That confirmation is worth exactly as long as the user's memory of clicking the button.

Persisting it answers a different, unasked question — *has a fetch ever come back empty for this tenant, at any point in this workspace's history?* — and answers it with a permanently empty folder the user cannot dismiss and has no context for. The reported symptom was the folder appearing "by default" on connecting a tenant, which is what a flag set weeks earlier looks like from the outside.

The general rule this follows: UI state that exists to report on an action should not outlive the session containing the action. Snapshot files on disk are the durable signal and are unaffected.

## D2. Clear on removal, like the workflow cache

**Decision.** `removeTenant` deletes the tenant's key; `removeEnvironment` sweeps every key under that environment.

**Rationale.** Without this, remove-and-re-add resurrects the marker within a session, and the user sees an empty History folder on a tenant they have never fetched history for in its current incarnation. The workflow cache two lines above does exactly this eviction for exactly this reason; matching it keeps one rule in the file instead of two.

`removeEnvironment` needs a prefix sweep rather than a single delete because keys are flat `env::tenant` strings and the environment's tenants are not enumerable at that point. `HISTORY_EXPOSED_PREFIX` is shared between the key builder and the sweep so the two cannot drift.

## D3. Keep the exported key builder

**Decision.** `historyExposedStorageKey()` stays exported with the same output, now keying the set.

**Rationale.** It is pinned by an existing assertion in `test-multi-tenant-tree-view.cjs`. Removing it to signal "this is no longer storage" would break that test for a naming reason, and the function's actual job — producing one stable key per tenant — is unchanged. A doc comment carries the distinction instead.

## D4. Assertions read the source

**Decision.** The new tests read `src/tree/multiTenantTreeProvider.ts` as text and assert on the storage mechanism.

**Rationale.** Unusual for this suite, which prefers behavioural assertions, and justified by what is being pinned. The bug is invisible until a window reload: within a single process, a `Set` and a `workspaceState` entry behave identically, and the CLI harness cannot reload a window. There is no behavioural assertion available that distinguishes the fixed code from the broken code.

The assertions are therefore written to be specific about the mechanism — that the set exists, and that `historyExposedStorageKey` is never passed to `workspaceState.update` or `.get` — rather than vaguely pattern-matching the file. A `methodBody()` helper bounds the removal checks to the right methods, since a file-wide substring search would pass on a mention anywhere.

## Test plan

**Automated (Tier A — extends `scripts/test-multi-tenant-tree-view.cjs`)**

| # | Assertion |
|---|---|
| 1 | `historyExposedStorageKey` output is unchanged (existing assertion, kept) |
| 2 | The marker is held in an in-memory `Set` |
| 3 | The key is never written to or read from `workspaceState` |
| 4 | `removeTenant`'s body clears the marker |
| 5 | `removeEnvironment`'s body clears the markers |

**Manual QA (Tier C)**

| # | Step | Expected |
|---|---|---|
| M1 | Connect a new tenant and fetch L3 | No History folder |
| M2 | Fetch configuration history on a tenant with no history | History appears, empty |
| M3 | Reload the window after M2 | History is gone |
| M4 | Fetch history on a tenant that has some, then reload | History is still there, with its snapshots |
| M5 | Remove and re-add a tenant after M2, in the same session | No History folder on the re-added tenant |
