## 1. API — export the host allowlist for reuse

- [ ] 1.1 In `src/api/reltioClient.ts`, change `toHttpsBase` from module-private to `export function toHttpsBase(...)`. No internal behavior change — same allowlist, same HTTPS force-upgrade, same `UntrustedHostError`.
- [ ] 1.2 Confirm `scripts/test-harden-reltio-client-base-url.cjs` still passes unmodified (proves the export didn't change behavior for existing callers).

## 2. API — Workflow Adapter client

- [ ] 2.1 Add `src/api/workflowAdapterClient.ts`: `listProcessDefinitions(workflowAdapterUrl, environmentUrl, tenantId, token)`, `listJarDeployments(...)` (same signature), `fetchProcessDefinitionXml(workflowAdapterUrl, environmentUrl, tenantId, token, processType)`.
- [ ] 2.2 Every function calls the exported `toHttpsBase(workflowAdapterUrl)` from `reltioClient.ts` first; sends `Authorization: Bearer {token}` and `EnvironmentURL: {environmentUrl}` headers; uses `fetchWithTimeout`-equivalent (reuse or mirror the existing timeout helper).
- [ ] 2.3 Define `ProcessDefinitionSummary`, `JarDeploymentSummary` types matching the response shapes documented in `design.md`'s REST API Reference.
- [ ] 2.4 Add `WorkflowApiError` (statusCode + message), mirroring `ReltioApiError`; non-2xx responses throw it with the response body captured (same truncation constant pattern as `formatPutConfigurationFailureMessage`).
- [ ] 2.5 No `vscode` import in this file — same testability constraint as `reltioClient.ts` (stub `fetch` in tests).

## 3. Workspace — Workflow Adapter URL sidecar

- [ ] 3.1 Add `src/workspace/workflowAdapterConfig.ts`: `readWorkflowAdapterUrl(uri)` / `writeWorkflowAdapterUrl(uri, url)` using `vscode.workspace.fs`, same read/write pattern as `layoutPersistence.ts` uses for `L3.reltio.layout.json`.
- [ ] 3.2 Add `EnvironmentManager.getWorkflowAdapterConfigUri(environment, tenantId)` → `{tenantId}.reltio.tenant/WorkflowAdapter.reltio.json`, following the exact shape of `getLayoutUri()`.
- [ ] 3.3 Sidecar file is `{ "workflowAdapterUrl": string }`; no other fields for V1.

## 4. Tree — new node types

- [ ] 4.1 Add `src/tree/workflowNodes.ts`: `BusinessConfigFolderNode` (wraps existing tenant children, collapsible/expanded default), `WorkflowsFolderNode` (tracks fetched/unfetched state + the resolved Workflow Adapter URL once known), `ProcessDefinitionsFolderNode`, `JarDeploymentsFolderNode`, `ProcessDefinitionNode` (label = `displayName`, description = `type`), `JarDeploymentNode` (label = `name`, description = `module`).
- [ ] 4.2 Icons: reuse an existing `vscode.ThemeIcon` per node (no new icon assets) — e.g. `list-tree` for Workflows folder, `type-hierarchy` for Process Definitions, `file-binary` for Custom JARs / individual JAR rows, `symbol-method` for individual process-definition rows. Confirm no collision with `NODE_ICONS` in `treeNodes.ts` (separate map, separate file, per D9).
- [ ] 4.3 `contextValue`s: `reltio.businessConfigFolder`, `reltio.workflowsFolder` / `reltio.workflowsFolder.unfetched`, `reltio.workflowsFolder.fetched` (for menu `when` targeting of **Fetch Workflows** vs **Edit Workflow Adapter URL** vs **Refresh Workflows**), `reltio.processDefinitionsFolder`, `reltio.jarDeploymentsFolder`, `reltio.processDefinition`, `reltio.jarDeployment`.

## 5. Tree — provider wiring

- [ ] 5.1 In `src/tree/multiTenantTreeProvider.ts`, change `getChildren(TenantNode)` to return `[new BusinessConfigFolderNode(...), new WorkflowsFolderNode(...)]` instead of the current flat array.
- [ ] 5.2 `getChildren(BusinessConfigFolderNode)` returns exactly what `getChildren(TenantNode)` returns today (History folder if applicable + `getConfigRootChildren()`) — no change to that logic itself, only where it's called from.
- [ ] 5.3 `getChildren(WorkflowsFolderNode)`: if unfetched, return `[]` (the row itself shows the "click to fetch" description, same UX pattern as `T_NO_L3` on `TenantNode`); if fetched, return `[ProcessDefinitionsFolderNode, JarDeploymentsFolderNode]`.
- [ ] 5.4 `getChildren(ProcessDefinitionsFolderNode | JarDeploymentsFolderNode)`: return the cached list of `ProcessDefinitionNode` / `JarDeploymentNode` held on the parent `WorkflowsFolderNode` (fetched once per **Fetch Workflows** / **Refresh Workflows** run, not per tree expand).
- [ ] 5.5 `getParent()`: extend for the four new node types, following the existing pattern for `HistoryFolderNode`/`ConfigTreeItem` parent resolution.
- [ ] 5.6 `invalidate()`/`scheduleTreeRefresh()`: no change needed — new nodes participate in the existing refresh mechanism since they're returned from `getChildren`.

## 6. Commands

- [ ] 6.1 `reltio.fetchWorkflows` (tree context + inline icon on `WorkflowsFolderNode`, unfetched state): read sidecar via `workflowAdapterConfig.ts`; if absent, prompt `vscode.window.showInputBox` for the Workflow Adapter URL (validate via `toHttpsBase` before accepting, show inline validation error on reject); write sidecar; call `listProcessDefinitions` + `listJarDeployments`; populate node state; refresh tree.
- [ ] 6.2 `reltio.editWorkflowAdapterUrl` (tree context on `WorkflowsFolderNode`, fetched state — D4): same input box, pre-filled with current value; on confirm, overwrite sidecar and re-run the two list calls.
- [ ] 6.3 `reltio.refreshWorkflows` (tree context + inline icon on `WorkflowsFolderNode`, fetched state): re-run the two list calls with the already-known URL, no prompt.
- [ ] 6.4 `reltio.viewProcessDefinitionXml` (tree context + primary click on `ProcessDefinitionNode`): call `fetchProcessDefinitionXml`; open via the new content provider (task 7).
- [ ] 6.5 Error handling for 6.1–6.3: on `WorkflowApiError` with a network/DNS-level cause (not an HTTP status), show the error with an **Edit URL** action wired to 6.2 (D4); on an HTTP error (401/403/etc.), show the message only — no URL-edit suggestion.

## 7. Read-only BPMN XML viewer

- [ ] 7.1 Add a `vscode.TextDocumentContentProvider` registered on scheme `reltio-workflow-bpmn` in `src/extension.ts` (or a small new `src/ontology`-sibling module if it grows) — `provideTextDocumentContent(uri)` returns the already-fetched XML string keyed by a URI encoding tenant + process type.
- [ ] 7.2 `reltio.viewProcessDefinitionXml` builds the `reltio-workflow-bpmn:` URI, calls `vscode.workspace.openTextDocument(uri)`, then `vscode.window.showTextDocument(doc, { preview: true })`; set the document's language to `xml` via `vscode.languages.setTextDocumentLanguage` if not inferred from the URI path.

## 8. Package manifest

- [ ] 8.1 Register commands from task 6 with titles/icons in `contributes.commands`.
- [ ] 8.2 Add `view/item/context` menu `when` clauses keyed on the `contextValue`s from task 4.3 (Fetch Workflows only on unfetched; Edit URL + Refresh only on fetched).
- [ ] 8.3 No new `contributes.configuration` setting — confirm nothing needs adding here per D2/D3 (URL is sidecar-persisted, not a setting).

## 9. Extension wiring

- [ ] 9.1 Instantiate/wire the new command handlers in `src/extension.ts`'s `activate()`, following the existing registration block style.
- [ ] 9.2 Pass `EnvironmentManager` (already available) into the new command handlers so they can resolve the sidecar URI and the tenant's platform `environmentUrl` for the `EnvironmentURL` header (D6).
- [ ] 9.3 Reuse `TokenStore.getToken(environmentName)` for the Bearer token — no new token storage.

## 10. Documentation

- [ ] 10.1 Update `ARCHITECTURE.md`: add `Workflow Adapter`, `Process Definition`, `JAR Deployment` to the Domain Concepts table; add `src/api/workflowAdapterClient.ts` and `src/workspace/workflowAdapterConfig.ts` rows to Package Structure; note the tenant-children regroup (D1) in the tree provider description; add a short recipe entry ("Add a new Workflow Adapter operation") mirroring "Add a new Reltio API endpoint."
- [ ] 10.2 Note the confirmed-with-user assumptions (token reuse, no local-adapter support, no auto-derived URL) inline in `design.md` Context — already done as part of this proposal.

## 11. Tests

- [ ] 11.1 Add `scripts/test-workflow-inspector.cjs` per `design.md`'s Test plan (Tier A items 1–4, Tier B items 5–6).
- [ ] 11.2 Register it in `scripts/run-unit-tests.cjs` (alphabetical, per existing convention).

## 12. Manual verification (run in Extension Development Host)

- [ ] 12.1 Run through all 7 manual QA checks listed in `design.md`'s Test plan against a real tenant with a real Workflow Adapter.
- [ ] 12.2 Confirm `npm run compile` and `npm test` are green.
- [ ] 12.3 Confirm zero behavior change for any existing platform-API call (Business Config fetch/apply/history) — the regroup (D1) must not alter what data appears, only where it's nested.
