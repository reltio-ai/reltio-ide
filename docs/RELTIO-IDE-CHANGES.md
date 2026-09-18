# Workflow Inspector — What We Changed vs. the GitHub Baseline

This document records exactly what the repo looked like when cloned from
`https://github.com/reltio-ai/reltio-ide` (commit `1f96fff`, v1.0.17) and every
change made to implement the Workflow Inspector feature.

---

## What Was Already There (the Baseline)

### Tree shape before our changes
When you expanded a tenant in the sidebar, you saw this **flat** list directly
under the tenant node:

```
TenantId
├─ History          (only if history had been fetched before)
├─ Entity Types
├─ Relation Types
├─ Sources
└─ ...other L3 sections
```

Tenants without an L3 file had `CollapsibleState.None` — they couldn't be
expanded at all.

### What the codebase had
- `src/api/reltioClient.ts` — all Reltio platform API calls. `toHttpsBase()` and
  `fetchWithTimeout()` existed but were **module-private** (no `export`).
- `src/tree/multiTenantNodes.ts` — `EnvironmentNode`, `TenantNode`, `GitFolderNode`,
  `HistoryFolderNode`, `HistorySnapshotNode`. No `BusinessConfigFolderNode`.
- `src/tree/multiTenantTreeProvider.ts` — `getChildren(TenantNode)` returned
  History + config root children directly. `getParent` returned `TenantNode` for
  `HistoryFolderNode` and top-level `ConfigTreeItem`.
- `src/workspace/environmentManager.ts` — had `getLayoutUri()`,
  `getHistoryDirectoryUri()`, etc. No `getWorkflowAdapterConfigUri()`.
- No workflow-related files of any kind.
- `scripts/run-unit-tests.cjs` — 38 test scripts registered, no workflow test.

---

## Files We Created (brand new, didn't exist before)

### `src/api/workflowAdapterClient.ts`
The entire Workflow Adapter API client. Three read-only GET functions:
- `listJarDeployments(adapterUrl, tenantId, environmentUrl, token)` → `JarDeployment[]`
- `listProcessDefinitions(adapterUrl, tenantId, environmentUrl, token)` → `ProcessDefinition[]`
- `getProcessDefinitionXml(adapterUrl, tenantId, environmentUrl, token, processType)` → raw XML string

Key design details:
- Calls `toHttpsBase(adapterUrl)` before attaching any token — same host-allowlist
  enforcement as every other Reltio API call.
- Sends `EnvironmentURL: https://demo-01.reltio.com` as a **header** (not a query
  param). Missing this header returns `"Missing mandatory Parameter(s): [EnvironmentURL]"`.
- The `EnvironmentURL` value is built from `toHttpsBase(environmentName)` — important
  because `environmentName` is stored as a bare hostname (`demo-01.reltio.com`) and
  the Adapter needs the full `https://` URL to look up the tenant.
- Does NOT send the `xxx-client` header (that's a Reltio platform routing signal,
  meaningless to the Workflow Adapter).
- New error class `WorkflowConnectionError` wraps network-level failures so the UI
  can distinguish "wrong URL / DNS failure" from "wrong credentials (401/403)" and
  offer the right recovery action.
- List endpoints return `{ status, data: [...], total }` — we unwrap `data` and
  treat missing/non-array `data` as an empty list (no throw on empty tenant).
- BPMN endpoint: real Adapters return raw XML; local/dev Adapters may wrap it in
  JSON. We try `JSON.parse` first; if it yields an object with a string field, use
  that; otherwise use the raw text. XML is never parsed (no XML parser = no XXE).

---

### `src/workspace/workflowAdapterConfig.ts`
Sidecar persistence for the Workflow Adapter URL.

On-disk location: `{tenantId}.reltio.tenant/WorkflowAdapter.reltio.json`

On-disk format:
```json
{ "version": 1, "workflowAdapterUrl": "https://demo-01-workflow.reltio.com" }
```

Two exported functions:
- `loadWorkflowAdapterUrl(configUri)` → `string | undefined` — returns `undefined` on
  any error (missing file, bad JSON, wrong version). Never throws.
- `saveWorkflowAdapterUrl(configUri, url)` — writes the validated URL.

Stores a URL only. No token, no credential, ever written to disk. Mirrors the same
`version + try/catch → undefined` pattern as `src/ontology/layoutPersistence.ts`.

---

### `src/tree/workflowNodes.ts`
All tree node classes for the Workflows sub-tree. Kept separate from
`multiTenantNodes.ts` so the `ConfigNodeType` union in `treeNodes.ts` is not widened.

Node classes created:
| Class | Shown when | Click action |
|---|---|---|
| `WorkflowsFolderNode` | Always (every tenant) | If no URL saved: opens fetch prompt |
| `WorkflowFetchActionNode` | URL saved but not loaded this session | Triggers fetch |
| `ProcessDefinitionsFolderNode` | After fetch | — |
| `JarDeploymentsFolderNode` | After fetch | — |
| `ProcessDefinitionNode` | After fetch, one per BPMN | Opens BPMN XML viewer |
| `JarDeploymentNode` | After fetch, one per JAR | Read-only info node |

Icon logic on `ProcessDefinitionNode`:
- `generic: false` (custom workflow) → `symbol-class` → **orange**
- `generic: true` (Reltio OOTB workflow) → `symbol-method` → **purple**

---

### `src/providers/bpmnContentProvider.ts`
A `vscode.TextDocumentContentProvider` on scheme `reltio-workflow-bpmn://`.

URI shape: `reltio-workflow-bpmn://{environmentName}/{tenantId}/{processType}`

Chosen over `openTextDocument({ content })` specifically so the document has no
dirty flag and no "Save As" prompt — genuinely read-only from VS Code's perspective.
Content is cached in memory before the document is opened; the provider serves it
synchronously. No XML parsing happens (no XXE surface).

---

### `scripts/test-workflow-inspector.cjs`
12 automated tests covering:
1. URL/path shape — every path has `/workflow-adapter/workflow/` segment
2. `EnvironmentURL` header present; `xxx-client` header absent
3. Envelope unwrapping — `{ data: [...] }` → array
4. Empty/missing `data` → empty array, no throw
5. Raw XML returned as-is
6. JSON-wrapped XML → first string field extracted
7. Untrusted host → `UntrustedHostError` before fetch is called
8. HTTP 4xx → `ReltioApiError` with correct status code
9. Network error → `WorkflowConnectionError`
10. `toHttpsBase()` is exported from `reltioClient`
11. All 4 commands declared in `package.json`
12. Context-menu entries present for workflow commands

---

### `docs/RELTIO-IDE-OVERVIEW.md`
User-facing guide: what the extension does, how the tree looks, step-by-step
instructions for every workflow including the new Workflow Inspector.

### `docs/RELTIO-IDE-CODE-GUIDE.md`
Developer guide: every file in `src/` explained, the full tree hierarchy, an
end-to-end command flow trace, how to add new features, key design decisions.

### `docs/RELTIO-IDE-CHANGES.md` (this file)
This document.

### `openspec/changes/workflow-inspector/`
OpenSpec design artifacts (not shipped in the VSIX, design history only):
- `.openspec.yaml` — change metadata
- `proposal.md` — problem statement and high-level approach
- `design.md` — decisions D1–D9, REST API reference, risks, test plan
- `tasks.md` — 12 implementation task sections
- `specs/workflow-adapter-inspector/spec.md` — ADDED capability spec
- `specs/config-tree-view/spec.md` — MODIFIED capability spec (Business Config regroup)

---

## Files We Modified (existed before, we changed them)

### `src/api/reltioClient.ts`
**What changed:** Added `export` keyword to two previously private functions.

```
Before:  function toHttpsBase(baseUrl: string): string { ... }
After:   export function toHttpsBase(baseUrl: string): string { ... }

Before:  async function fetchWithTimeout(...): Promise<Response> { ... }
After:   export async function fetchWithTimeout(...): Promise<Response> { ... }
```

No behaviour change whatsoever. The allowlist logic, the URL normalization, the
timeout/abort logic — all identical. Exporting them lets `workflowAdapterClient.ts`
reuse the same security enforcement without duplicating it.

---

### `src/tree/multiTenantNodes.ts`
Two changes:

**1. `TenantNode` collapsible state**
```
Before: hasL3 ? Collapsed/Expanded : None
After:  always Collapsed/Expanded (never None)
```
Every tenant now has at least the Workflows folder, so every tenant must be
expandable regardless of whether L3 has been fetched.

**2. New `BusinessConfigFolderNode` class added**
```typescript
export class BusinessConfigFolderNode extends vscode.TreeItem {
    constructor(readonly environmentName: string, readonly tenantId: string) {
        super('Business Config', vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'reltio.businessConfig.folder';
        this.iconPath = new vscode.ThemeIcon('settings');
        this.id = `businessConfig:${environmentName}/${tenantId}`;
    }
}
```

---

### `src/workspace/environmentManager.ts`
One new method added to the `EnvironmentManager` class:

```typescript
getWorkflowAdapterConfigUri(environment: string, tenantId: string): vscode.Uri {
    return vscode.Uri.joinPath(
        this.tenantUri(environment, tenantId),
        'WorkflowAdapter.reltio.json'
    );
}
```

Placed alongside the existing `getHistoryDirectoryUri()` method.

---

### `src/tree/multiTenantTreeProvider.ts`
The largest change. Six areas touched:

**1. Imports — added:**
- `BusinessConfigFolderNode` from `multiTenantNodes`
- `WorkflowsFolderNode`, `WorkflowFetchActionNode`, `ProcessDefinitionsFolderNode`,
  `JarDeploymentsFolderNode`, `ProcessDefinitionNode`, `JarDeploymentNode`
  from `workflowNodes`
- `loadWorkflowAdapterUrl` from `workflowAdapterConfig`

**2. `MultiTenantTreeElement` union — widened:**
```
Before: EnvironmentNode | TenantNode | GitFolderNode | HistoryFolderNode
      | HistorySnapshotNode | ConfigTreeItem

After:  + BusinessConfigFolderNode | WorkflowsFolderNode | WorkflowFetchActionNode
        | ProcessDefinitionsFolderNode | JarDeploymentsFolderNode
        | ProcessDefinitionNode | JarDeploymentNode
```

**3. New `workflowCache` field:**
```typescript
private readonly workflowCache = new Map<
    string,  // "environmentName/tenantId"
    { definitions: ProcessDefinition[]; jars: JarDeployment[] }
>();
```
In-memory store — populated by `markWorkflowsLoaded()`, read by
`getChildren(WorkflowsFolderNode)`.

**4. New public methods:**
- `markWorkflowsLoaded(env, tenantId, definitions, jars)` — stores results and
  triggers a tree refresh. Called by `extension.ts` after a successful fetch.
- `clearWorkflowCache(env, tenantId)` — clears one tenant's cached data.

**5. `getChildren(TenantNode)` — completely replaced:**
```
Before: returned [HistoryFolderNode?, ...ConfigTreeItem[]] (all flat under tenant)

After:  returns [BusinessConfigFolderNode?, WorkflowsFolderNode]
        (two folder nodes; Business Config only when hasL3)

New branch getChildren(BusinessConfigFolderNode):
        returns what getChildren(TenantNode) used to return — History + config items

New branch getChildren(WorkflowsFolderNode):
        if no cache: [WorkflowFetchActionNode]
        if cache: [ProcessDefinitionsFolderNode, JarDeploymentsFolderNode]

New branch getChildren(ProcessDefinitionsFolderNode):
        returns ProcessDefinitionNode[] from definitions in the folder node

New branch getChildren(JarDeploymentsFolderNode):
        returns JarDeploymentNode[] from deployments in the folder node
```

**6. `getParent()` — three changes:**
```
Before: HistoryFolderNode → TenantNode
After:  HistoryFolderNode → BusinessConfigFolderNode

Before: top-level ConfigTreeItem → TenantNode (via getParentForConfigItem)
After:  top-level ConfigTreeItem → BusinessConfigFolderNode

New:    WorkflowsFolderNode → TenantNode
New:    BusinessConfigFolderNode → TenantNode
```
This is critical — `treeView.reveal()` uses `getParent()` to navigate up the tree.
If `getParent` returned the wrong level, clicking "Show in Editor" or revealing a
config node from a command would silently fail.

---

### `src/extension.ts`
Four areas changed:

**1. New imports added:**
```typescript
import { WorkflowsFolderNode, WorkflowFetchActionNode } from './tree/workflowNodes';
import { listJarDeployments, listProcessDefinitions, getProcessDefinitionXml,
         WorkflowConnectionError } from './api/workflowAdapterClient';
import { loadWorkflowAdapterUrl, saveWorkflowAdapterUrl }
         from './workspace/workflowAdapterConfig';
import { BpmnContentProvider, BPMN_SCHEME } from './providers/bpmnContentProvider';
// UntrustedHostError and toHttpsBase folded into the existing reltioClient import
```

**2. `BpmnContentProvider` registered:**
```typescript
const bpmnProvider = new BpmnContentProvider();
context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(BPMN_SCHEME, bpmnProvider)
);
```

**3. Two shared helper functions added** (inside `activate()`):
- `doFetchWorkflows(environmentName, tenantId, adapterUrl)` — fetches both lists
  in parallel inside `withProgress`, handles 401/403/WorkflowConnectionError/
  UntrustedHostError differently, stores results via `treeProvider.markWorkflowsLoaded()`.
- `promptAndSaveAdapterUrl(environmentName, tenantId, currentValue?)` — shows
  `showInputBox` with inline validation via `toHttpsBase()` (rejects untrusted/malformed
  hosts before any request is made), saves to sidecar.

**4. Four new commands registered:**

| Command | Trigger | What it does |
|---|---|---|
| `reltio.fetchWorkflows` | Click Workflows folder (no URL) or Fetch action row | Prompts for URL if not saved → fetches both lists |
| `reltio.refreshWorkflows` | Context menu on Workflows folder | Re-fetches using saved URL |
| `reltio.editWorkflowAdapterUrl` | Context menu / error recovery | Re-prompts pre-filled with current URL, then re-fetches |
| `reltio.openWorkflowBpmn` | Click a ProcessDefinitionNode | Fetches XML, stores in bpmnProvider, opens read-only tab |

**Bug fixed during testing:**
`environmentName` is stored as a bare hostname (`demo-01.reltio.com`). The Workflow
Adapter's `EnvironmentURL` header needs the full URL with scheme
(`https://demo-01.reltio.com`). Original code passed `environmentName` directly,
causing 400 `"Tenant [AcmeTenant] is not registered."`. Fixed by calling
`toHttpsBase(environmentName)` before passing it as the header value.

---

### `package.json`
Two additions:

**1. Four new command declarations:**
```json
{ "command": "reltio.fetchWorkflows",        "title": "Fetch Workflows",           "icon": "$(cloud-download)" },
{ "command": "reltio.refreshWorkflows",      "title": "Refresh Workflows",         "icon": "$(refresh)" },
{ "command": "reltio.editWorkflowAdapterUrl","title": "Edit Workflow Adapter URL",  "icon": "$(edit)" },
{ "command": "reltio.openWorkflowBpmn",      "title": "Open BPMN",                 "icon": "$(open-preview)" }
```

**2. Three context-menu entries in `view/item/context`:**
```json
{ "command": "reltio.fetchWorkflows",        "when": "view == reltioConfigTree && viewItem =~ /^reltio\\.workflows\\.folder/", "group": "inline@1" },
{ "command": "reltio.refreshWorkflows",      "when": "view == reltioConfigTree && viewItem == reltio.workflows.folder",        "group": "1_refresh" },
{ "command": "reltio.editWorkflowAdapterUrl","when": "view == reltioConfigTree && viewItem =~ /^reltio\\.workflows\\.folder/", "group": "2_config" }
```

---

### `scripts/run-unit-tests.cjs`
One line added — `'test-workflow-inspector.cjs'` appended to the `SCRIPTS` array
(alphabetically last, after `test-terms-of-use-gate.cjs`).

---

### `ARCHITECTURE.md`
Two sections updated:
- **"Add a new tree section"** — expanded to cover both config-model sections (existing
  pattern) and service-level sections (new Workflow Inspector pattern, separate node file,
  in-memory cache, sidecar).
- **"Add a new Reltio API endpoint"** — expanded to cover separate service APIs with
  the `toHttpsBase` + `WorkflowConnectionError` pattern.
- **Data Architecture section** — updated to list both sidecar file types
  (`*.reltio.layout.json` and `WorkflowAdapter.reltio.json`) with the shared pattern.

---

## Summary: Line Count Impact

| Area | Before | After |
|---|---|---|
| New files | — | 7 files, ~700 lines |
| `extension.ts` | ~2,200 lines | ~2,500 lines (+288) |
| `multiTenantTreeProvider.ts` | ~500 lines | ~650 lines (+157) |
| `multiTenantNodes.ts` | ~175 lines | ~200 lines (+24) |
| Other modified files | — | ~50 lines total |
| **Total new code** | | **~1,200 lines** |
