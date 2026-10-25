## Why

Reltio IDE today shows only a tenant's **business configuration** (`L3.reltio.json` — entity types, relation types, attributes, etc.). It has no visibility into **Reltio Workflow** — the separate Activiti/BPMN-based engine (the "Workflow Adapter") that runs DCR/PMR/Delete-review approvals and any custom process a tenant has deployed. A user who wants to know "what workflows and custom JARs exist on this tenant" has to leave the IDE and hand-craft `curl` calls against a different base URL with a different header shape (see `LEARN_WORKFLOW_APIS.md`, Part 2). There is currently zero code path, tree node, or API client anywhere in this extension that talks to the Workflow Adapter.

## What Changes

- **New read-only Workflow Adapter client** (`src/api/workflowAdapterClient.ts`): three GETs — list process definitions, list JAR deployments, fetch one process definition's BPMN XML — reusing the existing Bearer token already in `TokenStore` for that environment. No write operations (deploy/register/redeploy) are in scope.
- **New tree structure under each tenant**: the existing config sub-tree (History, Entity Types, Relation Types, …) is regrouped under a new **Business Config** folder; a new sibling **Workflows** folder is added alongside it. Workflows starts collapsed/unfetched (`Fetch Workflows` prompt) — it never calls the adapter automatically, since there is no reliable way to derive its base URL from the environment URL (confirmed: naming convention is not guaranteed across tenants).
- **One new piece of user input, asked once and remembered per tenant**: the Workflow Adapter base URL, persisted as a sidecar file next to the tenant's `L3.reltio.json` (same pattern as the existing `L3.reltio.layout.json` sidecar) — never a new setting, never in `L3.reltio.json` itself.
- **Workflows folder contents**: two child folders, `Process Definitions (N)` and `Custom JARs (N)`. Clicking a process definition opens its BPMN XML as a read-only virtual document.
- **Security**: the user-entered Workflow Adapter URL is resolved through the exact same `reltio.trustedHostSuffixes` host allowlist that already guards every other outbound call carrying this token (`toHttpsBase()` / `UntrustedHostError` in `reltioClient.ts`) — exported for reuse rather than duplicated.

## Capabilities

### New Capabilities
- `workflow-adapter-inspector`: read-only listing of deployed process definitions and registered custom JARs for a tenant, plus fetching one process definition's raw BPMN XML, all against a user-supplied, per-tenant-persisted Workflow Adapter URL, reusing the tenant's existing session token.

### Modified Capabilities
- `config-tree-view`: tenant children are regrouped from a flat list of config-section folders into two named siblings — `Business Config` (unchanged content, one level deeper) and `Workflows` (new).

## Impact

**Code**
- **New files**: `src/api/workflowAdapterClient.ts`, `src/workspace/workflowAdapterConfig.ts` (sidecar read/write), `src/tree/workflowNodes.ts` (`BusinessConfigFolderNode`, `WorkflowsFolderNode`, `ProcessDefinitionsFolderNode`, `JarDeploymentsFolderNode`, `ProcessDefinitionNode`, `JarDeploymentNode`)
- **Modified files**: `src/tree/multiTenantTreeProvider.ts` (`getChildren(TenantNode)` regroup), `src/tree/multiTenantNodes.ts` (icons/context values as needed), `src/api/reltioClient.ts` (export the existing private `toHttpsBase`/allowlist check for reuse — no behavior change to any existing call), `src/extension.ts` (register new commands, wire sidecar prompt), `package.json` (commands, menus, icons), `ARCHITECTURE.md`
- **New directory**: none beyond existing `src/api/`, `src/tree/`, `src/workspace/`

**External API**
- Three new outbound GETs, only ever made after the user explicitly runs **Fetch Workflows** and supplies a URL that passes the host allowlist: `GET {workflowAdapterUrl}/workflow-adapter/workflow/{tenantId}/processDefinitions`, `GET .../jarDeployments`, `GET .../processDefinitions/{type}`. All three send `EnvironmentURL: {the tenant's already-known platform URL}` and the existing `Authorization: Bearer {token}` — no new credential type.

**Tests**
- New `scripts/test-workflow-inspector.cjs` (Tier A: client parsing + allowlist enforcement; Tier B: tree regroup structural check).

**Docs**
- `ARCHITECTURE.md`: new domain terms (Workflow Adapter, Process Definition, JAR Deployment), package-structure row, recipe cross-reference.

**Not in scope (this change)**
- Deploying/redeploying a BPMN file, registering/removing a JAR, starting/acting on a process instance, or any other state-changing Workflow Adapter call.
- Pointing the Workflows folder at a local dev adapter (`localhost:8080`) — production/staging tenants only.
- Rendering the BPMN XML as a visual diagram (the existing Ontology Viewer pattern is *not* reused here — raw XML only, per confirmed V1 scope).
- Auto-deriving the Workflow Adapter URL from the platform environment URL — confirmed not reliable enough to assume by default.
