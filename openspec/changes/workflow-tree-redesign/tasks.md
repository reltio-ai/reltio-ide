Each group is covered by `scripts/test-workflow-tree-redesign.cjs` unless noted. IDs map to `specs/workflow-tree-layout/`.

## 1. Layout and paths

- [x] 1.1 `Workflows` leaf replaces `Workflows/BPMN` and `Workflows/Custom Workflows`; both retired; the prune skips live paths case-insensitively (`tenantFolderStructure.ts`).
- [x] 1.2 Drafts directory `Workflows/bpmn`, repository directory `Workflows` (`environmentManager.ts`, `workflowDrafts.ts`, `workflowRepoDiscovery.ts`).

## 2. Connect adoption

- [x] 2.1 Pure `planWorkflowRepoAdoption` with atomic refusal (`workflowRepoAdoption.ts`).
- [x] 2.2 Staging clone, `adoptStagedRepository` with rollback, baseline exclude, connect dialog (`workflowRepoConnect.ts`, `extension.ts`).

## 3. Tree

- [x] 3.1 Pure `mergeProcessDefinitionRows` (`processDefinitionRows.ts`).
- [x] 3.2 Nodes, descriptions, icons, always-grouped modules (`workflowNodes.ts`, `multiTenantTreeProvider.ts`).

## 4. Menus and handlers

- [x] 4.1 `package.json` menus for the Workflows row, drafts, and differs-from-repository rows.
- [x] 4.2 Repository files get their own rows (repo icon), tagged by git origin; tenant custom rows use a cloud icon.
- [x] 4.3 Disconnect removes the repository's files (`workflowRepoCleanup.ts`), prunes empty folders, restores the tenant README.

- [x] 4.4 Custom workflows keep the class icon (the cloud icon was reverted).
- [x] 4.5 All deployed BPMNs are downloaded on list load (`workflowBulkDownload.ts`, `downloadAllBpmnCopies`); `ensureBaselineExcluded` heals existing clones.

## 5. Skills

- [x] 5.1 Connect-first rule, new paths, bundle version 23 with the pinned hash updated.

## 6. Tests and docs

- [x] 6.1 New `test-workflow-tree-redesign.cjs`, registered; existing workflow tests updated; shared `lib/menu-when.cjs`.
- [x] 6.2 `ARCHITECTURE.md` and `README.md` updated; README screenshots to be recaptured by hand.
