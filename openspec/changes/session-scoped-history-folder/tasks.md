## 1. Scope the marker to the session

- [x] 1.1 Add a private `historyExposedThisSession = new Set<string>()` to `MultiTenantTreeProvider`, documenting why it is not persisted (D1).
- [x] 1.2 Point `markHistoryExposed` at the set instead of `workspaceState.update`.
- [x] 1.3 Point `shouldShowHistoryFolder`'s fallback at the set instead of `workspaceState.get`. The on-disk snapshot check ahead of it is unchanged.
- [x] 1.4 Extract `HISTORY_EXPOSED_PREFIX` and keep `historyExposedStorageKey` exported with identical output (D3).

## 2. Clear on removal

- [x] 2.1 Delete the tenant's key in `removeTenant`, beside the existing `clearWorkflowCache` call (D2).
- [x] 2.2 Sweep every key under the environment in `removeEnvironment`, matching the workflow-cache eviction directly above it.

## 3. Tests

- [x] 3.1 Extend `scripts/test-multi-tenant-tree-view.cjs` with Tier A items 2–5 in design.md's test plan, reading the provider source (D4).
- [x] 3.2 Add a `methodBody()` helper so the removal assertions are bounded to the right methods rather than matching anywhere in the file.
- [x] 3.3 Keep the existing `historyExposedStorageKey` assertion untouched.

## 4. Docs

- [x] 4.1 Correct `ARCHITECTURE.md`'s configuration-history section, which documents the `workspaceState` behaviour as intended.
- [x] 4.2 `npm run compile` and `npm test` green.

## 5. Verify against the reported symptom

- [ ] 5.1 Tier C manual QA per design.md's test plan — M1 and M3 are the reported bug.
