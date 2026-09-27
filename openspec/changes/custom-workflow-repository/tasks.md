## 0. Prerequisite — rebase

- [x] 0.1 Rebase `feature/workflow-authoring` onto `main` after `RP-200851-git-ready-tenant-folder-structure` merges (or onto that branch directly first, as a dry run). Expect conflicts in `src/extension.ts`, `src/workspace/environmentManager.ts`, `src/tree/multiTenantTreeProvider.ts`, `src/tree/multiTenantNodes.ts`, `ARCHITECTURE.md`, `package.json`. Nothing in this change's own tasks can start until `Workflows/BPMN/` and `Workflows/Custom Workflows/` exist on disk.
  - Done as a dry run onto `rp-200851-review` (Snehil's branch not yet merged to `main`). All 11 commits replayed cleanly; the only real conflicts were the two imports in `environmentManager.ts`, three re-merges of the same two `ARCHITECTURE.md` sections, and an indentation-only `package.json` conflict (real diff was 60/7 lines once whitespace was ignored).
  - `npm run compile` and `npm test` both passed after the rebase, but only after fixing a silent runtime break the rebase itself didn't surface as a conflict: `resolveDraftContext()` in `workflowDrafts.ts` still parsed the old `{env}.reltio.environment/{tenant}.reltio.tenant/` suffix scheme, which RP-200851 replaced with bare folder names plus `EnvironmentManager.locFromPath()`'s scan-built index. Fixed to try `locFromPath()` first and fall back to the suffix parse only for a pre-rename workspace — same pattern already used by `pathTenantLocFromL3Path()` / `tenantLocFromL3File()`. All 33 test scripts pass.

## 1. Sidecar — `WorkflowRepo.reltio.json`

- [ ] 1.1 Add `src/workspace/workflowRepoConfig.ts`, mirroring `workflowAdapterConfig.ts`: `{ version: 1, repoUrl: string, relativePath: string }`, `loadWorkflowRepoConfig()` / `saveWorkflowRepoConfig()`, tolerant read (missing/corrupt/wrong-version → `undefined`).
- [ ] 1.2 Add `EnvironmentManager.getWorkflowRepoConfigUri(environment, tenantId)` → `{tenant}/WorkflowRepo.reltio.json` (D3). Tracked, not gitignored — do not add it to any `.gitignore` helper.

## 2. Connect / disconnect

- [ ] 2.1 `reltio.connectWorkflowRepository` — prompt for the Bitbucket URL (D2: reuse `cloneRepository()`, `isFolderEmpty()`, `isGitRepoWithRemote()`, `GitNotFoundError` unchanged), clone into `Workflows/Custom Workflows/` (D1), write the sidecar (1.1/1.2).
- [ ] 2.2 `reltio.disconnectWorkflowRepository` — modal confirmation naming the loss of local history/unpushed commits (mirrors Snehil's tenant-disconnect wording), remove only `.git` and the sidecar; files stay.
- [ ] 2.3 Implement the D10 reconciliation check (`src/workspace/workflowRepoGitignore.ts`): on activation and on tree refresh, if the tenant folder has an outer `.git` **and** the sidecar exists, ensure `Workflows/Custom Workflows/` is in that outer `.gitignore`. Idempotent, order-independent — do not hook into `tenantGitBinding.ts`.
- [ ] 2.4 D11: the check in 2.3 is silent. No notification on either side of the fix.
- [ ] 2.5 D9: one repository per tenant — no multi-source marker complexity; `saveWorkflowRepoConfig()` always overwrites, never appends.

## 3. Discovery

- [ ] 3.1 Add `discoverBpmnFiles(root)` in `src/workspace/workflowRepoDiscovery.ts`: depth-limited walk (`MAX_DEPTH = 10`, reused from `l3Discovery.ts`), skips dotfolders, collects files whose extension is `.xml`/`.bpmn20.xml` **and** which parse via `extractProcessModel()` to a non-empty `processId` (D4). Filename is never trusted.
- [ ] 3.2 Add `resolveRepoBpmnContext(fsPath)`: walk upward for the nearest `{tenant}` / `{environment}` ancestor pair matching D1's clone location, read the process id from the file's own content via `extractProcessModel()` (D6).

## 4. Sync badge

- [ ] 4.1 Add `compareBpmnContent(repoXml, deployedXml): 'clean' | 'changed'` as its own function — byte-exact per D5's live-tenant result, isolated so a future dialect that reformats is a one-function change.
- [ ] 4.2 Wire `ProcessDefinitionNode.localState` to 4.1's result when a discovered repo file's process id matches the definition's `type`; reuse the existing icon/color (`gitDecoration.modifiedResourceForeground`) and `buildTooltip()` — no new visual language.
- [ ] 4.3 Recompute on `reltio.refreshWorkflowRepoSync` (new command) and automatically after Fetch Workflows / Deploy for that tenant. No filesystem watcher on the repo folder.

## 5. Deploy from the repository

- [ ] 5.1 Extend `reltio.deployWorkflow`'s handler: try `resolveDraftContext()` first (unchanged, cheapest), fall back to `resolveRepoBpmnContext()` (3.2) for a file under a connected repository (D6). Direct deploy — no promote-to-Draft copy.
- [ ] 5.2 Confirm the deployed result needs no new tree node: it appears as a normal `ProcessDefinitionNode` after the existing post-deploy refetch (`workflow-authoring`'s existing behavior, unchanged).

## 6. Drafts move to `Workflows/BPMN/`

- [ ] 6.1 Change `workflowDrafts.ts`'s path construction from `{tenant}/workflows/{processId}.bpmn20.xml` to `{tenant}/Workflows/BPMN/{processId}.bpmn20.xml`.
- [ ] 6.2 Update `resolveDraftContext()`'s path-matching rule to the new shape.
- [ ] 6.3 No migration step, no `layoutMigration.ts` involvement — confirm via a code comment why, so a future reader doesn't assume one was forgotten.

## 7. Tree / commands

- [ ] 7.1 Add a `Custom Workflow Repository` row under `WorkflowsFolderNode`: "Not connected" / "Connected — {N} BPMN files tracked", new `contextValue`s `reltio.workflows.customRepo.notConnected` / `reltio.workflows.customRepo.connected`.
- [ ] 7.2 Declare `reltio.connectWorkflowRepository`, `reltio.disconnectWorkflowRepository`, `reltio.refreshWorkflowRepoSync` in `package.json` with `when` clauses matching the existing `view == reltioConfigTree && viewItem == reltio.workflows.*` style.
- [ ] 7.3 `Open Repository Folder` and (D7, nice-to-have, cut first if trimming) `Open repository in browser` using the stored `repoUrl`.
- [ ] 7.4 D8: after a successful first connect, surface a one-time informational nudge pointing at Refresh JARs. No code changes to `registerJarDeployment`/`listAvailableJars`.
- [ ] 7.5 Complete `getParent()` for the new row.

## 8. Tests

- [ ] 8.1 `scripts/test-custom-workflow-repository.cjs`: `discoverBpmnFiles()` depth-limit/dotfolder-skip; `resolveRepoBpmnContext()` path round trip; `compareBpmnContent()` both states; sidecar read/write round trip and tolerant-failure cases; D10's reconciliation check in both connection orders; D9's single-source overwrite behavior.
- [ ] 8.2 Structural: new commands declared in `package.json` with correct `when` clauses.
- [ ] 8.3 Register the script in `scripts/run-unit-tests.cjs`.
- [ ] 8.4 Mutation-check the D10 reconciliation guard specifically — it is the one new invariant with real consequences (a missed case silently loses the customer's workflow code on the next outer-repo clone).

## 9. Docs

- [ ] 9.1 `ARCHITECTURE.md`: the new sidecar, the nested-repository safeguard and why it's silent (D11), the `Workflows/BPMN/` move for Drafts.
- [ ] 9.2 `npm run compile` and `npm test` green (allowing the pre-existing CRLF/velocity-packs failure); `npx openspec validate --changes` clean for this change.

## 10. Manual QA (Tier C)

- [ ] 10.1 Connect a repository to an unbound tenant; confirm clone, sidecar, discovery, sync badges against a real Adapter.
- [ ] 10.2 Connect a repository, then separately bind the same tenant via `reltio.connectTenantToGit`; confirm the outer `.gitignore` picks up `Workflows/Custom Workflows/` on next activation/refresh (Order 1 from D10) with no notification.
- [ ] 10.3 Reverse the order (bind first, connect repository second); confirm the same outcome (Order 2).
- [ ] 10.4 Deploy directly from a repository file; confirm it appears as a Process Definition and the sync badge goes `clean`; edit the repo file and confirm it goes `changed`.
- [ ] 10.5 Disconnect; confirm only `.git` and the sidecar are removed, files remain.
- [ ] 10.6 Create a new Draft and confirm it lands in `Workflows/BPMN/`, not the old `workflows/` path.
