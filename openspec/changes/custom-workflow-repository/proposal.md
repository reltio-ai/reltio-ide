## Why

`workflow-authoring`'s own proposal explicitly deferred three things to this change: "Connecting the Bitbucket repository, registering JARs, checking for new builds." Of those three, JAR registration and new-build discovery are, in practice, already shipped (`listAvailableJars()`, `registerJarDeployment()`, the Unregistered subfolder — landed inside `7124df3` with no dedicated proposal, a documentation gap rather than a code gap). What remains is the first: a customer's Java-backed custom workflow code lives in a Reltio-provisioned Bitbucket repository, PR-reviewed by Reltio, built by CI — and today that repository has no presence in the IDE at all. A customer edits it with a bare `git clone` in a terminal, has no visibility into whether a given BPMN in that repo matches what is actually deployed on the tenant, and cannot deploy from it directly.

This change connects that repository into the workspace, makes its BPMN files visible and comparable against the deployed tenant state, and lets a file in it deploy straight to the tenant — closing the loop the Feature Enablement Guide already promises ("register it on the tenant in one click") without building any new git, diff, or PR tooling of our own.

It also lands on top of `RP-200851-git-ready-tenant-folder-structure` (Snehil's tenant-folder restructure, merged/mergeable separately): the target folder this change discovers and deploys from, `Workflows/Custom Workflows/`, is a placeholder his change already reserves for exactly this purpose.

## What Changes

- **A new "Custom Workflow Repository" row** appears under a tenant's `Workflows` folder, showing "Not connected" until the customer supplies the Bitbucket URL Reltio gave them.
- **Connecting clones the repository into `Workflows/Custom Workflows/`**, reusing `cloneRepository()` / `isFolderEmpty()` / `isGitRepoWithRemote()` from `gitConfigSource.ts` verbatim — no new clone or auth code. The repository's URL and relative path are recorded in a new sidecar, `WorkflowRepo.reltio.json`, at the tenant root — tracked and committed, the same convention as the existing `WorkflowAdapter.reltio.json`.
- **This is confirmed to be a second, distinct git remote** from whatever a customer might separately bind via `reltio.connectTenantToGit` for Business Config promotion — not the same repository. When both are connected on one tenant, `Workflows/Custom Workflows/` becomes a repository nested inside the tenant's own repository. A small, order-independent reconciliation check (running on activation and tree refresh, not coupled to Snehil's binding code) keeps that nested folder out of the outer repository's tracking, silently — the mirror image of the "repository above the tenants" hazard Snehil's own design already defuses.
- **BPMN files in the connected repository are discovered by content, not filename** (`discoverBpmnFiles()`, modeled on `l3Discovery.ts`): any file that parses to a non-empty `<process id>` via the existing `extractProcessModel()`. A customer's own naming convention inside that repository is not ours to assume.
- **A sync badge on each Process Definition** compares a discovered repo file against the deployed XML and marks it `clean` or `changed`, reusing `ProcessDefinitionNode.localState` — no new visual language. The comparison is byte-exact, confirmed empirically against a live tenant (deploy → refetch produced identical SHA-256 hashes), recomputed on demand and after Fetch/Deploy, not on every file save.
- **A BPMN file in the connected repository deploys directly to the tenant** — no promote-to-Draft copy. `reltio.deployWorkflow` resolves context from the repository path when the existing Drafts-path resolution doesn't match. The deployed result surfaces as an ordinary Process Definition; the source file stays exactly where it is.
- **Self-service BPMN Drafts (Part 2) move from `{tenant}/workflows/` to `Workflows/BPMN/`** — Snehil's other placeholder folder, matching the product's own self-service-vs-Java-backed split. No migration mechanism: Part 2 has not shipped to any customer, so there is no on-disk data at the old path to preserve. This is a path-construction change in `workflowDrafts.ts` / `resolveDraftContext()`, not a migration feature.
- **No new repo browser, no new diff viewer, no PR automation.** VS Code's own Explorer and Source Control already show the cloned folder as a nested repository; a `changed` badge opens VS Code's built-in diff editor against the two in-memory strings. A convenience "Open repository in browser" link is the only nice-to-have, cut first if anything needs trimming.
- **No changes to JAR registration** — `registerJarDeployment()` / `listAvailableJars()` / the Unregistered subfolder are already correct and shipped. The only addition is a one-time nudge toward Refresh JARs after a first successful repository connection.

## Capabilities

### New Capabilities
- `custom-workflow-repository`: connecting a tenant's Reltio-provisioned Custom Workflow Repository, content-driven BPMN discovery inside it, the sync badge against deployed state, direct deploy from a repository file, and the nested-repository safeguard.

### Modified Capabilities
- `workflow-authoring`: Drafts move from `{tenant}/workflows/` to `Workflows/BPMN/`, matching Snehil's component tree. `resolveDraftContext()`'s path-matching rule changes accordingly; no other authoring behavior changes.
- `workflow-inspector`: `ProcessDefinitionNode.localState` gains a second source of truth — a matching file in the connected Custom Workflow Repository, in addition to the existing downloaded-copy comparison.
- `environment-management`: `EnvironmentManager` gains `getWorkflowRepoConfigUri()`, following the shape of the existing `getWorkflowAdapterConfigUri()`.

## Impact

- **New files**: `src/workspace/workflowRepoConfig.ts` (sidecar persistence, mirrors `workflowAdapterConfig.ts`), `src/workspace/workflowRepoDiscovery.ts` (`discoverBpmnFiles()`, `resolveRepoBpmnContext()`), `src/workspace/workflowRepoGitignore.ts` (the D10 reconciliation check), `scripts/test-custom-workflow-repository.cjs`.
- **Modified files**: `src/workspace/environmentManager.ts` (one new URI accessor), `src/workspace/workflowDrafts.ts` and its path constants (`Workflows/BPMN/` instead of `workflows/`), `src/tree/workflowNodes.ts` (new repository row + context values), `src/tree/multiTenantTreeProvider.ts` (repository row, sync-badge wiring), `src/extension.ts` (three new commands, deploy-context fallback), `package.json`, `ARCHITECTURE.md`.
- **No new outbound API calls** beyond what `workflow-authoring` already added (`deployProcessDefinition`, `getProcessDefinitionXml`, both reused unchanged for the sync comparison and direct deploy).
- **Dependencies**: `git-repository-source` (clone mechanics reused), `git-ready-tenant-folder-structure` (Snehil's `Workflows/BPMN/` and `Workflows/Custom Workflows/` placeholders, and `tenantGitBinding.ts`'s `isGitRepoWithRemote()`), `workflow-authoring` (Drafts path, `extractProcessModel()`, `deployProcessDefinition`), `workflow-inspector` (`ProcessDefinitionNode.localState`).
- **Prerequisite, not a dependency of the design itself**: `feature/workflow-authoring` and `RP-200851-git-ready-tenant-folder-structure` independently modify the same five files off a shared, unmerged `main`. That rebase has to land before this change's implementation starts, since the component-tree folders this change builds on don't exist until it does.
- **Tests**: new `scripts/test-custom-workflow-repository.cjs`, registered in `scripts/run-unit-tests.cjs`.

## Not in scope (this change)

- The Bitbucket pull request itself, Reltio's review, Reltio's CI building the JAR — all outside the IDE, unchanged, same as `git-repository-source`'s existing non-goals for git in general.
- In-IDE pull request creation, CI status polling, any Bitbucket API integration.
- A custom repo browser or custom diff view beyond the sync badge and VS Code's built-in diff command.
- A retroactive `openspec/changes/` write-up for the already-shipped JAR registration work — worth doing, tracked separately, not blocking.
