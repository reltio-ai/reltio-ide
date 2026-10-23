## 1. Workspace — draft files on disk

- [x] 1.1 Add `src/workspace/workflowDrafts.ts` with `DRAFT_SUFFIX = '.bpmn20.xml'`, `isValidProcessId(id)` (`^[A-Za-z_][A-Za-z0-9_.-]{0,63}$`), `draftFileName(processId)` and `processIdFromDraftFileName(fileName)` — a strict round trip (D1).
- [x] 1.2 Add `buildBpmnSkeleton(processId, displayName)`: a minimal deployable BPMN — start event → one `userTask` → end event, `isExecutable="true"`. Every interpolated value XML-escaped (`&`, `<`, `>`, `"`). Pure function, no `vscode` import.
- [x] 1.3 Add `rewriteProcessIdentity(xml, newId, newName)`: namespace-aware regex over the **first** `<process>` element only, rewriting `id` and `name` (D9). No XML parser.
- [x] 1.4 Add `resolveDraftContext(uriPath)` → `{ environmentName, tenantId, processId } | undefined`, parsing the `*.reltio.environment/*.reltio.tenant/workflows/*.bpmn20.xml` shape. Pure string logic, modelled on `src/util/pathTenantLoc.ts` (D4).
- [x] 1.5 Add `listWorkflowDrafts(dirUri)` and `writeWorkflowDraft(dirUri, fileName, xml)` — the only two functions in the file that touch `vscode.workspace.fs`. No logic beyond the I/O.
- [x] 1.6 Add `EnvironmentManager.getWorkflowDraftsDirectoryUri(environment, tenantId)` → `{tenant}/workflows`, and `getWorkflowDraftUri(environment, tenantId, fileName)`. Mirror `getHistoryDirectoryUri` exactly; format logic stays in `workflowDrafts.ts`.

## 2. API — deploy a BPMN

- [x] 2.1 In `src/api/workflowAdapterClient.ts`, extract `workflowServiceBase(adapterBase)` out of the existing `workflowBase()` — deploy has **no** tenant path segment, so it needs the prefix without the tenant.
- [x] 2.2 Add `multipartContentType(boundary)` and `buildMultipartBody(part, boundary)` returning a `Uint8Array`, assembled byte by byte (D3). UTF-8 byte length, not string length.
- [x] 2.3 Add `generateBoundary(payload)` — regenerates if the candidate appears in the payload.
- [x] 2.4 Add `deployProcessDefinition(adapterUrl, tenantId, environmentUrl, token, deploymentName, fileName, xml)` taking **XML as a string** (D4). `toHttpsBase()` first, then `workflowHeaders()` spread with the multipart `Content-Type`. Reuse `adapterHttpError()` for non-ok responses. Dedicated `WORKFLOW_DEPLOY_TIMEOUT_MS = 30_000`.
- [x] 2.5 Hold the part field name in one constant (`DEPLOY_PART_FIELD`) so the unverified contract is a one-line correction — see design.md Open Questions.

## 3. Tree — Drafts branch

- [x] 3.1 Add `WorkflowDraftsFolderNode` (`contextValue` `reltio.workflows.drafts.folder`) and `WorkflowDraftNode` (`reltio.workflows.draft`) to `src/tree/workflowNodes.ts`. The draft node sets `resourceUri` and `command: vscode.open`, following `HistorySnapshotNode`.
- [x] 3.2 Widen `MultiTenantTreeElement` and add a Drafts branch to `getChildren(WorkflowsFolderNode)`, shown only when at least one draft exists — gate exactly like `shouldShowHistoryFolder` (D5).
- [x] 3.3 Add `getChildren(WorkflowDraftsFolderNode)` listing one `WorkflowDraftNode` per file, sorted by name.
- [x] 3.4 Add a public `notifyWorkflowDraftsChanged()` calling the private `scheduleTreeRefresh()` — **not** `invalidate()`, which triggers a full environment rescan.
- [x] 3.5 Complete `getParent()` for the whole Workflows sub-tree (D10): `ProcessDefinitionsFolderNode`, `JarDeploymentsFolderNode`, `WorkflowFetchActionNode`, `WorkflowDraftsFolderNode` → `WorkflowsFolderNode`; `ProcessDefinitionNode`, `JarDeploymentNode`, `WorkflowDraftNode` → their folders.

## 4. Commands

- [x] 4.1 `reltio.newWorkflowDraft` — prompt for process id (validated, collision-checked against existing drafts and deployed definitions), prompt for display name, write the skeleton, open it, reveal it.
- [x] 4.2 `reltio.duplicateWorkflowDraft` — fetch the source XML via `getProcessDefinitionXml`, default the new id to `{type}Copy`, warn on collision with a `generic: true` definition (D2), rewrite identity, write, open, reveal.
- [x] 4.3 `reltio.deployWorkflowDraft` — accepts `WorkflowDraftNode | Uri | undefined`; the Uri and palette paths resolve context via `resolveDraftContext()`. Saves a dirty editor first, uploads, then re-runs `doFetchWorkflows` (D8).
- [x] 4.4 `reltio.deleteWorkflowDraft` — modal confirmation, then delete, then `notifyWorkflowDraftsChanged()`.
- [x] 4.5 Rename `ensureL3DocumentSaved` → `ensureDocumentSaved` (the body is already URI-generic) and call it before deploy.
- [x] 4.6 Extract `reportWorkflowError(e, { environmentName, tenantId, operation })` and call it from `doFetchWorkflows`, `openWorkflowBpmn` and deploy. 403 names `ROLE_WORKFLOW_MANAGER` on deploy (D7); 404 on deploy offers Edit Adapter URL.
- [x] 4.7 Declare all four commands in `package.json` with icons and `when` clauses — **every tree `when` prefixed `view == reltioConfigTree &&`**, matching the existing workflow entries. Deploy also gets an `editor/title` entry on `resourceFilename =~ /\.bpmn20\.xml$/`.

## 5. Tests

- [x] 5.1 Add `scripts/test-workflow-authoring.cjs` covering Tier A items 1–11 in design.md's test plan.
- [x] 5.2 Extend the `withFetch` helper pattern to capture `init.method` and `init.body` (the existing one in `test-workflow-inspector.cjs` captures only url and headers).
- [x] 5.3 Add the Tier B structural checks (items 12–13).
- [x] 5.4 **Register the script in the hardcoded `SCRIPTS` array in `scripts/run-unit-tests.cjs`**, alphabetically. It is not a glob — an unregistered test silently never runs.
- [x] 5.5 Mutation-check the two assertions guarding non-obvious behaviour (multipart byte layout, process-id validation): break the implementation, confirm the test fails, restore.

## 6. Docs

- [x] 6.1 Update `ARCHITECTURE.md`: the drafts directory in the tenant-folder table, the multipart pattern, and a recipe note for adding a mutating call to a separate service.
- [x] 6.2 `npm run compile` and `npm test` green (allowing for the pre-existing velocity-packs failure); `npx openspec validate --changes` clean for this change.

## 7. Blocked on live-tenant verification

- [ ] 7.1 Run the two `curl` probes in design.md's Open Questions against a real tenant; fixture the raw responses into the test script and correct `DEPLOY_PART_FIELD` / the URL builder if the assumption was wrong.
- [ ] 7.2 Tier C manual QA per design.md's test plan.
