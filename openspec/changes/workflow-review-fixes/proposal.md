## Why

A three-way review of the Reltio Workflow feature (network and git boundary; tree, commands and diagnostics; shipped skills and their delivery) found no token leak and no remote-code path, but did find real defects: a draft can silently replace a built-in workflow because the deployed id comes from the XML while the confirmation shows the filename; clone URLs may carry credentials that are persisted into a committed sidecar and echoed in errors; a committed sidecar is trusted without validation; several tree states are wrong (fake empty folders, a cross-kind fetch race, a repo row that never renders or stays empty after reload); two diagnostics rules give false results; the shipped skills contradict each other in places that defeat the agent's reply contract; and the legacy cleanup can delete files the extension did not write. Tracking: RP-202975.

## What Changes

- **Input trust.** Clone URLs are validated (no credentials in the URL, no leading `-`, `--` before the URL, redacted in every message). The committed `WorkflowRepo.reltio.json` is validated on read (`relativePath`, `repoUrl`). External links open only for `https`. Network calls cannot follow redirects, `toHttpsBase()` returns the origin only, and response bodies are bounded in time and size.
- **Deploy integrity.** The process id used for confirmation, collision checks and "replaces live" is the id inside the XML. Duplicate output is always well-formed XML. Repo-tracked definitions deploy the repo file, not a stale download.
- **Tree state.** No fake empty folders, no cross-kind fetch race, the repository row renders without a saved adapter URL and is populated after a window reload, discovery skips build output and is bounded, sync comparison ignores line-ending differences, the diagram panel cannot wedge, diagnostics are debounced per document.
- **Diagnostics accuracy.** Merge gateways are not flagged; the type-listener rule matches the process kind (DCR vs potential match).
- **Skills and delivery.** Contradictions removed (silent validation, one question, gate reporting, process-id wording), the entity-type gate is stated as verified only by construction, the full sources of the two helper classes the send-back loop needs are embedded, internal paths are removed from shipped skills, menu labels match the product, and the sync's legacy cleanup deletes only files carrying the extension's own marker.
- **Tests.** Source-text assertions are replaced by behaviour tests where the review found gaps (deploy and duplicate handlers, cross-kind race, repo-versus-local precedence, no-URL folder, `syncReltioAgentAssets`), and a skills content hash is pinned to the bundle version.

## Capabilities

### New Capabilities

- `workflow-input-trust`: everything the workflow feature reads from outside the process (clone URLs, the committed sidecar, adapter responses) is validated before it reaches git, the file system, a browser or an HTTP request.
- `workflow-deploy-integrity`: what the user is told they are deploying is what the engine receives.
- `workflow-tree-state`: the workflow tree reflects real state and survives reloads, races and Windows line endings.
- `workflow-diagnostics-accuracy`: BPMN diagnostics do not report errors for valid Reltio workflows.
- `workflow-skills-delivery`: shipped skills are internally consistent and are synced, versioned and cleaned up safely.

### Modified Capabilities

None. These behaviours were not specified before.

## Impact

**Code** — `src/api/reltioClient.ts`, `src/api/workflowAdapterClient.ts`, `src/workspace/gitConfigSource.ts`, `workflowRepoConfig.ts`, `workflowRepoGitignore.ts`, `workflowDrafts.ts`, `workflowBpmnFiles.ts`, `workflowRepoDiscovery.ts`, `workflowRepoSync.ts`, `reltioAgentSync.ts`, `src/providers/bpmnContentProvider.ts`, `src/tree/multiTenantTreeProvider.ts`, `src/tree/workflowNodes.ts`, `src/workflow/bpmnDiagram.ts`, `bpmnDiagnostics.ts`, `bpmnPanel.ts`, `src/extension.ts`, `package.json` (palette hides).
**Skills** — `skills/reltio-default/workflow-*/**`.
**Tests** — new behaviour tests registered in `scripts/run-unit-tests.cjs`.
**Docs** — `ARCHITECTURE.md` (trust boundary, sync).
**Release** — extension `1.0.28`, `skillsBundleVersion` `20`.
