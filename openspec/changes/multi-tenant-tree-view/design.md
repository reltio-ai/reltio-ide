## Context

The extension previously used a single-document `ConfigTreeProvider` tied to the active `*.reltio.json` editor. Reltio workflows span multiple environment hosts and many tenants per host; the tree and tooling must reflect that workspace layout while keeping JSON language features on `L3.reltio.json`.

## Goals / Non-Goals

**Goals:**
- Multi-level tree: environment → tenant → existing configuration sub-tree (entity types, relations, etc.)
- Reachable-environment validation without a token; tenant/L3 operations with Bearer token (in memory only)
- Filesystem convention at workspace root: `*.reltio.environment/` and nested `*.reltio.tenant/` with `L3.reltio.json`
- Activation that works before any environment folder exists (see D9)

**Non-Goals:**
- Persisting tokens to disk or VS Code SecretStorage
- Multi-root workspace–specific UX (first folder is used where applicable)
- Replacing JSON Schema or the core `ReltioBusinessModel` shape

## Decisions

### D1: Tree replaces current single-file mode
**Decision**: The existing `ConfigTreeProvider` (which follows the active editor and shows one `*.reltio.json`) is replaced entirely by `MultiTenantTreeProvider`. The config sub-tree logic (entity types, relation types, attributes, match groups, etc.) is extracted and reused as the deepest level of the new hierarchy.
**Rationale**: Keeping both trees would create confusion — two competing views for the same data. The new tree subsumes the old one: environment → tenant → config sub-tree.

### D2: REST client as reusable stateless component
**Decision**: `src/api/reltioClient.ts` is a standalone HTTP client with no VS Code API dependencies. Each method accepts a base URL and optional token. Uses Node.js built-in `https` module (or global `fetch` on Node 18+).
**Rationale**: Decoupling from VS Code makes the client testable and reusable in other contexts (e.g., CLI tools, future features). Statelessness means no hidden coupling to token management.

### D3: In-memory-only token storage
**Decision**: `src/api/tokenStore.ts` holds a `Map<string, string>` (environment name → Bearer token). Tokens are never written to disk, never stored in VS Code secrets API, and the map starts empty on every extension activation.
**Rationale**: User explicitly requested no token persistence for security. On restart, all environments show a lock icon and require re-authentication. Previously fetched L3 files remain usable offline.

### D4: Token sharing via aliases
**Decision**: `TokenStore` supports aliases: "environment X uses token from environment Y." Resolved transitively when `getToken(env)` is called. Aliases are also in-memory only.
**Rationale**: Reltio environments often share auth systems. Users should provide a token once and reference it from multiple environments, reducing friction.

### D5: Graceful degradation without auth
**Decision**: If an environment has no valid token but `L3.reltio.json` exists locally in the tenant directory, the tree still shows the tenant's config sub-tree parsed from the local file. The environment node shows a lock icon; tenant nodes show a "stale" indicator.
**Rationale**: The user may have fetched the config in a previous session. Losing access to that data just because the token expired would be frustrating. Read-only analysis of stale configs is still valuable.

### D6: Tenant picker uses VS Code QuickPick
**Decision**: When the user adds a tenant, the full tenant list is fetched from `GET /reltio/tenants` and presented via `vscode.window.showQuickPick`. The QuickPick provides native search-as-you-type filtering and scrolling.
**Rationale**: Tenant lists can be 100+ items. QuickPick handles this natively without custom UI. The list is fetched in full upfront (single API call) and filtered client-side.

### D7: Filesystem convention with typed directory extensions
**Decision**: Environment data stored in `{name}.reltio.environment/` directories at workspace root. Tenant data in `{tenantId}.reltio.tenant/` subdirectories. L3 config stored as `L3.reltio.json`, layout sidecar as `L3.reltio.layout.json`.
**Rationale**: The `.reltio.environment` and `.reltio.tenant` suffixes make directories self-documenting and easy to discover by scanning. Using the workspace root keeps the convention simple — no hidden directories, no configuration needed. The `L3.reltio.json` name matches the existing `*.reltio.json` pattern so all language features (validation, navigation, diagnostics) activate automatically.

### D8: Environment validation is auth-free
**Decision**: `GET /reltio/status` (no auth, check for HTTP 200) is used to validate that an environment URL is reachable before creating its directory. Tenant and L3 operations require auth.
**Rationale**: Users should be able to add environments without providing a token upfront. The token is only needed when they want to interact with tenant data.

### D9: Activation events for workspace-first UX (empty workspace safe)
**Decision**: Do not rely on `workspaceContains:**/*.reltio.environment` alone. Activation uses a union of triggers:
1. **`workspaceContains:**/*.reltio.environment`** — If the workspace already has environment directories, the extension activates when the folder opens so the tree can populate without opening JSON first.
2. **`onView:reltioConfigTree`** — When the user opens the Reltio **Configuration** view in the activity bar, the extension activates even in an empty directory. That removes the chicken-and-egg: the first environment can be created from the tree/welcome flow without any `*.reltio.environment` folder existing yet.

Optionally also keep **`onLanguage:json`** or add **`workspaceContains:**/*.reltio.json`** so users who open or create `L3.reltio.json` directly still activate the extension without expanding the tree.

**Rationale**: `workspaceContains` never fires until a matching path exists, so an empty clone cannot activate on that alone. View-based activation is intentional, matches “I am using Reltio metadata,” and is the usual VS Code pattern for sidebar-driven extensions.

## REST API Reference

| Operation | Method | URL | Auth | Response |
|-----------|--------|-----|------|----------|
| Validate environment | GET | `https://{env}/reltio/status` | None | HTTP 200 = valid |
| List tenants | GET | `https://{env}/reltio/tenants` | `Authorization: Bearer {token}` | `string[]` (tenant IDs) |
| Fetch L3 config | GET | `https://{env}/reltio/api/{tenantId}/configuration` | `Authorization: Bearer {token}` | Full JSON (Reltio Business Model) |

### D10: Auto-fetch L3 when adding a tenant (Bugfix Round 1)
**Decision**: After `createTenant` succeeds and the tenant node exists, the extension immediately calls the L3 configuration download and writes `L3.reltio.json` (same behavior as the explicit Fetch Configuration command), then refreshes the tree.
**Rationale**: Listing tenants already requires a valid token; fetching L3 right away avoids an extra manual step while the user’s context is still “I want this tenant in the workspace.”
**Failure behavior**: If the auto-fetch fails, the empty tenant folder remains; errors are shown like the manual fetch path, and the user can use Fetch Configuration to retry.

### D11: Configuration tree navigation and ontology (Bugfix Round 1)
**Decision**: All configuration sub-tree nodes (`reltio.item.*` and `reltio.folder.*`) expose **Show in Editor** and **Show in Ontology** in the view context menu. The primary “open” gesture for those nodes is wired via `resolveTreeItem` → `reltio.revealInEditor`, which always `openTextDocument` on the tenant `L3.reltio.json` URI when present so the editor opens without a prior tab.
**Rationale**: Matches Explorer-style “activate row to open” while keeping explicit menu actions for discoverability; ontology needs the same document the tree row refers to.

## Risks

- **[Large tenant lists]** Environments with 100+ tenants could make the QuickPick slow if the API response is large. → Mitigation: QuickPick is populated after the API call completes; a progress indicator is shown during the fetch.
- **[Token expiry during session]** Tokens may expire mid-session causing 401 errors. → Mitigation: On any 401, clear the token, mark the environment as unauthorized, and prompt the user to re-authenticate.
- **[Concurrent file access]** If the user has an L3 file open in the editor while a fetch overwrites it, the editor may show stale content. → Mitigation: After writing the fetched L3, the extension should trigger a document refresh if the file is currently open.
- **[Network errors]** Unreachable environments or timeouts. → Mitigation: All API calls have timeouts and show user-friendly error messages via `vscode.window.showErrorMessage`.
