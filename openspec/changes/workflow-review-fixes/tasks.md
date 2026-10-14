Tracking: RP-202975. Each task is test-first: write the failing behaviour test, then the fix. IDs map to `specs/`.

## 1. Input trust (`workflow-input-trust`)

- [ ] 1.1 `isAllowedCloneUrl`: reject userinfo passwords and a leading `-`; `git clone -- <url> <dir>`; one `redactUrl()` used by every message, tooltip and log (`gitConfigSource.ts`).
- [ ] 1.2 Escape the branch name before building the pathspec regex (`gitConfigSource.ts`).
- [ ] 1.3 Validate `WorkflowRepo.reltio.json` on read: `relativePath` (relative, no `..`, no control chars) and `repoUrl` (clone rules); invalid sidecar is reported once and ignored (`workflowRepoConfig.ts`, `workflowRepoGitignore.ts`).
- [ ] 1.4 Open external links only for `https`; scp/ssh remotes go to the clipboard (helper in `workflowRepoConfig.ts`; call site in `extension.ts`).
- [ ] 1.5 `toHttpsBase()` returns the origin and rejects userinfo/path/query; `redirect: "error"`; one body-read helper bounded by time and size; `listAvailableJars` reuses `adapterHttpError` (`reltioClient.ts`, `workflowAdapterClient.ts`).
- [ ] 1.6 Reject Windows device names as process ids; harden `rewriteProcessIdentity` (`workflowBpmnFiles.ts`, `workflowDrafts.ts`).
- [ ] 1.7 `BpmnContentProvider.store()` fires `onDidChange` for an existing URI.

## 2. Deploy integrity (`workflow-deploy-integrity`)

- [ ] 2.1 `withDiagramSection` declares missing diagram namespaces (`bpmnDiagram.ts`).
- [ ] 2.2 Deploy uses the XML's process id for confirmation, collision checks and `replacesLive` (`extension.ts`).
- [ ] 2.3 Repo-tracked rows deploy the repo file; local and repo state tracked separately (`multiTenantTreeProvider.ts`, `extension.ts`).
- [ ] 2.4 Collision checks fetch the live list when the cache is empty; Duplicate checks the full list (`extension.ts`).
- [ ] 2.5 A failed clone does not delete the generated README before the failure is known (`extension.ts`).

## 3. Tree state (`workflow-tree-state`)

- [ ] 3.1 Remove the seeded empty `definitions` / `jars` in `markWorkflowRepoSync`.
- [ ] 3.2 Per-tenant fetch generation so a combined load cannot overwrite a newer kind-specific result.
- [ ] 3.3 Repository row renders without a saved adapter URL and is populated on activation / tenant load; watcher picks up new files.
- [ ] 3.4 BPMN discovery: skip `target`, `node_modules`, `.git`, dot dirs; size and count caps; remove the dead `hasBpmnLikeExtension`.
- [ ] 3.5 `compareBpmnContent` normalizes line endings.
- [ ] 3.6 Diagram panel: register the entry only after a successful build; try/catch the debounced path.
- [ ] 3.7 Per-document diagnostics debounce; no diagnostics for closed documents.
- [ ] 3.8 `commandPalette` hides for node-only commands (`package.json`).

## 4. Diagnostics accuracy (`workflow-diagnostics-accuracy`)

- [ ] 4.1 Gateway rule: no report for joins; error for no-outgoing or pass-through.
- [ ] 4.2 Kind-aware type-listener rule; align the skills' wording with it.

## 5. Skills and delivery (`workflow-skills-delivery`)

- [ ] 5.1 Remove contradictions: silent validation walk, one question, gate reporting only on failure, process-id wording, Delete-id fallback, local-testing mentions, network wording.
- [ ] 5.2 Entity-type gate stated once as verified only by construction; remove user-facing caveats.
- [ ] 5.3 Embed `UpdateDcrReviewerListener` and `CaptureRequestor` in `java-patterns.md`; fix `setVariable` / `getVariable` guidance and the unconfirmed API claim.
- [ ] 5.4 Fix broken skeletons and snippets (accessTypes/validator, sequenceFlow ids, test snippet, `hasVariable` guard).
- [ ] 5.5 Remove internal paths from shipped skills; extend the curation guard; fix menu labels and stale section references; hedge `ROLE_WORKFLOW_MANAGER`.
- [ ] 5.6 Sync: content-gated legacy cleanup on every sync; multi-block strip without collapsing user whitespace; serialized runs; visible failures.
- [ ] 5.7 Pin the skills content hash to `skillsBundleVersion` in the test; bump to `20`.
- [ ] 5.8 Behaviour test for `syncReltioAgentAssets` using the in-memory file system.

## 6. Verification and release

- [ ] 6.1 Register new test scripts in `scripts/run-unit-tests.cjs`; `npm run compile && npm test` all green.
- [ ] 6.2 Replace source-text assertions with behaviour tests where the review named gaps (deploy and duplicate handlers, cross-kind race, repo-versus-local precedence, no-URL folder).
- [ ] 6.3 `ARCHITECTURE.md`: trust boundary and sync notes.
- [ ] 6.4 Bump extension to `1.0.28`; do not package until requested.
- [ ] 6.5 Manual QA on a real tenant: duplicate an older definition; edit a draft id to a built-in id and deploy; connect a repo on an unfetched tenant; reload the window; CRLF checkout shows `synced`; legacy cleanup on a workspace with customer-owned `.cursor/skills`.
