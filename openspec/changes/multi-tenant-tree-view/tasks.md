## 1. API — token store

- [x] 1.1 Add `src/api/tokenStore.ts` with `TokenStore`: `setToken`, `getToken` (alias resolution, transitive, max depth 10, cycle-safe), `useTokenFrom`, `clearToken`, `hasToken`, `clearAll`
- [x] 1.2 Use two `Map<string, string>` instances (direct tokens and aliases); no VS Code API; never persist tokens

## 2. API — Reltio REST client

- [x] 2.1 Add `src/api/reltioClient.ts` with `validateEnvironment(baseUrl)` → `GET https://{base}/reltio/status`, true on HTTP 200, 10s timeout, no auth
- [x] 2.2 Add `listTenants(baseUrl, token)` → `GET …/reltio/tenants` with Bearer; return `string[]` on 200; throw on failure
- [x] 2.3 Add `fetchL3Configuration(baseUrl, tenantId, token)` → raw body string; throw on non-200
- [x] 2.4 Use global `fetch`; prepend `https://` when base URL has no protocol; export `ReltioApiError` with `statusCode` and `message`; 401 on unauthorized

## 3. Workspace — environment manager

- [x] 3.1 Add `src/workspace/environmentManager.ts` with `constructor(workspaceRoot: vscode.Uri)`
- [x] 3.2 Implement `scanEnvironments()` / `scanTenants(environment)` using `*.reltio.environment` and `*.reltio.tenant` naming; export `EnvironmentInfo` and `TenantInfo`
- [x] 3.3 Implement `createEnvironment`, `removeEnvironment`, `createTenant`, `removeTenant`, `writeL3`, `getL3Uri`, `getLayoutUri` via `vscode.workspace.fs`
- [x] 3.4 Recursive delete for `removeEnvironment` / `removeTenant`

## 4. Tree — multi-tenant nodes

- [x] 4.1 Add `src/tree/multiTenantNodes.ts`: `EnvironmentNode` with `environmentName`, `isAuthorized`, `contextValue` authorized/unauthorized, globe vs lock icon, expanded by default
- [x] 4.2 Add `TenantNode` with `environmentName`, `tenantId`, `hasL3`, stale/local description when unauthorized + local L3, collapsible when `hasL3`

## 5. Tree — config subtree and multi-tenant provider

- [x] 5.1 Extract config tree building into `src/tree/configSubtree.ts` (`getConfigRootChildren`, `getConfigNodeChildren`, `findConfigEntityTypeItem`, `getConfigTreeItemParent`) and remove monolithic `configTreeProvider.ts`
- [x] 5.2 Extend `ConfigTreeItem` with optional tenant scope (`tenantL3Uri`, `rebindTenant`) for stable IDs across tenants
- [x] 5.3 Add `src/tree/multiTenantTreeProvider.ts`: root `EnvironmentNode`s; children `TenantNode`s; under tenant with L3, delegate to config subtree from parsed `L3.reltio.json`
- [x] 5.4 Support `refresh` / `invalidate`, `addEnvironment` / `removeEnvironment` / `addTenant` / `removeTenant` hooks, `onL3DocumentChanged`, async `getChildren`, `getParent` for reveal
- [x] 5.5 Implement `findEntityTypeItem(shortName)` across tenants (async); `tenantLocFromL3File` helper
- [x] 5.6 Handle workspace with no folder (`EnvironmentManager | null`)

## 6. Package manifest

- [x] 6.1 Register commands: `reltio.addEnvironment`, `removeEnvironment`, `provideToken`, `useTokenFrom`, `addTenant`, `removeTenant`, `fetchL3`, `refreshEnvironment` with titles/icons
- [x] 6.2 Add `view/item/context` menu `when` clauses for environment and tenant nodes; `view/title` for Add Environment
- [x] 6.3 Set activation events per D9: `onLanguage:json`, `workspaceContains:**/*.reltio.environment`, `workspaceContains:**/*.reltio.json`, `onView:reltioConfigTree`
- [x] 6.4 Update `viewsWelcome` for multi-tenant workflow
- [x] 6.5 Preserve existing reltio edit/navigation commands and menus

## 7. Extension wiring

- [x] 7.1 Replace `ConfigTreeProvider` with `MultiTenantTreeProvider`, `TokenStore`, `EnvironmentManager` in `src/extension.ts`
- [x] 7.2 Implement `reltio.addEnvironment` (URL prompt, normalize host, validate, create dir), `removeEnvironment`, `provideToken`, `useTokenFrom`, `addTenant`, `removeTenant`, `fetchL3`, `refreshEnvironment`
- [x] 7.3 On 401: clear token, message user, refresh tree
- [x] 7.4 After fetch L3: revert open document if needed; wire `revealInTreeView` to async `findEntityTypeItem`
- [x] 7.5 Resolve L3 document for tree-driven edit/reveal when `tenantL3Uri` set; debounced `*.reltio.json` updates rebuild `UriIndex` and invalidate tree on `L3.reltio.json` edits
- [x] 7.6 Configuration tree: `resolveTreeItem` supplies primary-open command for `ConfigTreeItem`; context menus for Show in Editor / Show in Ontology (see Bugfix Round 1)

## 8. Ontology and layout

- [x] 8.1 Confirm `ontologyPanel` / `layoutPersistence` work with `…/L3.reltio.json` and `L3.reltio.layout.json` in tenant directories (no breaking API change required)

## 9. Documentation

- [x] 9.1 Update `ARCHITECTURE.md`: domain terms, diagram, `src/api/` and `src/workspace/`, data flow, activation, REST note, recipe for new API endpoint

## 10. Manual verification (run in Extension Development Host)

- [ ] 10.1 Empty folder → open Reltio view → Add Environment → validate → directory created; token → add tenant → fetch L3 → subtree expands
- [ ] 10.2 Go to Definition / Find References / diagnostics on `L3.reltio.json` under a tenant
- [ ] 10.3 Ontology preview + “Reveal in Tree” from webview to correct entity type
- [ ] 10.4 `openspec status --change multi-tenant-tree-view --json` shows expected task progress after this file format update

## Bugfix Round 1

- [x] 1.1 Auto-fetch L3 after Add Tenant — When a tenant is added successfully, automatically run the same flow as `reltio.fetchL3` (download L3, `writeL3`, refresh tree, revert open doc if needed). On failure (network, 401, etc.), keep the tenant directory and surface errors the same way as manual fetch; user can retry with Fetch Configuration.
- [x] 1.2 Configuration tree context menus — For every `reltio.item.*` and `reltio.folder.*` node under the tenant configuration tree, contribute **Show in Editor** and **Show in Ontology** in `view/item/context` when `view == reltioConfigTree`.
- [x] 1.3 Primary tree open for configuration nodes — Use `TreeDataProvider.resolveTreeItem` to attach `reltio.revealInEditor` as the item command when the user opens/activates a node (VS Code “open” gesture, typically double-click on parents); `reltio.revealInEditor` uses `workspace.openTextDocument(tenant L3 URI)` so JSON opens even when not previously in an editor. Remove single-selection auto-reveal to avoid duplicate navigation.
