## Why

The extension currently operates on a single `*.reltio.json` file at a time — the tree view follows the active editor and shows one configuration. In practice, Reltio users work with multiple environments (e.g., `361.reltio.com`, `prod-usg.reltio.com`, `test.reltio.com`) each hosting many tenants. There is no way to browse, fetch, or compare tenant configurations across environments without manually downloading files and opening them one by one.

## What Changes

- Replace the single-document tree view with a multi-environment, multi-tenant hierarchy: environments at the top level, tenants as children, and the parsed L3 configuration (entity types, relation types, etc.) as the deepest level
- Add a reusable REST client component (`src/api/`) for communicating with Reltio environments — validate environments, list tenants, fetch L3 metadata configurations
- Add in-memory-only auth token management — tokens are never persisted to disk, forgotten on restart, with support for sharing a token across environments
- Introduce a workspace filesystem convention: `*.reltio.environment/` directories at workspace root, each containing `*.reltio.tenant/` subdirectories with the fetched `L3.reltio.json` and layout sidecar
- All existing features (JSON validation, navigation, diagnostics, ontology preview, editing commands) continue to work on the L3 files inside tenant directories

## Capabilities

### New Capabilities
- `environment-management`: Add/remove Reltio environments to the tree view, validated via `GET /reltio/status`
- `tenant-management`: Add/remove tenants within an environment, selected from a searchable list fetched via `GET /reltio/tenants`
- `l3-fetch`: Fetch tenant L3 metadata configuration via `GET /reltio/api/{tenantId}/configuration` and store locally
- `token-management`: Provide Bearer tokens per environment, share tokens across environments ("use token from X"), automatic unauthorized state detection with lock icon
- `rest-client`: Stateless `reltioClient` helpers (`validateEnvironment`, `listTenants`, `fetchL3Configuration`) for Reltio REST API communication
- `offline-mode`: Previously fetched L3 configurations remain usable when unauthorized — tree shows stale config from local files

### Modified Capabilities
- `config-tree-view`: Replaced from single-document to multi-environment/tenant hierarchy; config sub-tree (entity types, relation types, etc.) is now nested under tenant nodes
- `ontology-preview`: Adapted to work with L3 files in tenant directories
- `editor-navigation`: Navigation providers continue to work on L3 files in their new locations

## Impact

- **New files**: `src/api/reltioClient.ts`, `src/api/tokenStore.ts`, `src/workspace/environmentManager.ts`, `src/tree/multiTenantTreeProvider.ts`, `src/tree/multiTenantNodes.ts`, `src/tree/configSubtree.ts`
- **Modified files**: `src/extension.ts`, `package.json`, `src/tree/treeNodes.ts`, `tsconfig.json`, `ARCHITECTURE.md`
- **Removed files**: `src/tree/configTreeProvider.ts` (logic lives in `configSubtree.ts` + `multiTenantTreeProvider.ts`)
- **New directories**: `src/api/`, `src/workspace/`
- **Filesystem convention**: `*.reltio.environment/` and `*.reltio.tenant/` directories in workspace root
