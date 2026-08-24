# Design Amendment: Multi-Tenant Git Repository Support

**Date:** 2026-07-24  
**Related to:** `git-repository-source` change  
**Status:** Implemented

## Context

The initial `git-repository-source` implementation supported only a **single L3 file per repository**, creating one environment node with one tenant. User feedback and real-world usage (e.g., `reltio-product-editions` with 38+ BusinessConfig files) revealed the need for **multi-tenant repository support** — one repository containing many config files, all appearing under a single root node.

## Changes from Original Design

### 1. Filename: `BusinessConfig.json` replaces `L3.reltio.json`/`L3.json`

**Change:** Default discovered filename is now `BusinessConfig.json` (case-insensitive). Removed `L3.reltio.json` and `L3.json` from auto-discovery.

**Rationale:** Aligns with Reltio's standard naming convention for configuration files in version-controlled repositories.

**Impact:**
- `src/workspace/l3Discovery.ts`: Search pattern updated to `businessconfig.json` (case-insensitive)
- `package.json`: Updated `RELTIO_SELECTOR` and `jsonValidation` to include `BusinessConfig.json`
- All document change listeners updated to recognize the new filename

### 2. Increased Search Depth: 3 → 10 levels

**Change:** `MAX_DEPTH` increased from 3 to 10 in `l3Discovery.ts`.

**Rationale:** Real repositories have deeper nesting (e.g., `BusinessDomain/Material/BusinessConfig.json`). Depth 3 was too restrictive.

**Safety:** Still skips dotfolders (`.git/`), preventing runaway traversal.

### 3. Single Environment, Multiple Tenants

**Original Design:**
```
Tenant1 (Environment)
└─ Tenant1 (Tenant)

Tenant2 (Environment)
└─ Tenant2.Account360 (Tenant)
```

**New Design:**
```
reltio-product-editions (Environment - repo name)
├─ reltio-product-editions (Tenant - if L3 at root)
├─ Account360 (Tenant)
├─ Consumer360 (Tenant)
├─ BusinessDomain.Material (Tenant)
└─ ... (all configs as siblings)
```

**Changes:**
- `EnvironmentManager.setGitSources(Array<...>)` replaces `setGitSource(single)`
- `scanEnvironments()` groups all tenants under one environment (repo name)
- Token set once per environment, not per tenant
- Tree structure: single Level 1 (always expanded), all configs as Level 2

### 4. Tenant Naming with Conflict Resolution

**Original:** Sequential numbering (`Tenant1`, `Tenant2`, ...) with dot-notation for nested paths (`Tenant1.Prod.v1`).

**New:** Path-based naming with filename disambiguation on conflicts.

**Rules:**
1. **Single file at root:** Tenant name = repo name (e.g., `reltio-product-editions`)
2. **Single file in folder:** Tenant name = folder path with dots (e.g., `Account360`, `BusinessDomain.Material`)
3. **Multiple files in same folder:** Append filename in parentheses:
   - `Account360 (BusinessConfig.json)`
   - `Account360 (config-v2.json)`

**Implementation:**
- `deriveTenantNaming(root, l3Uri, allL3Uris)` — requires full list to detect conflicts
- Conflict detection: compares folder paths, adds `(filename)` suffix when multiple files share a folder

### 5. Auto-Expand Tree Nodes

**Change:** Git-sourced nodes auto-expand on connection.

**Implementation:**
- `TenantNode` constructor: new `autoExpand` parameter
- `MultiTenantTreeProvider`: detects git source via `tokenStore.getToken(env) === '__reltio-git-source__'`
- Sets `TreeItemCollapsibleState.Expanded` for git tenants, `Collapsed` for live tenants

### 6. "Add Config" Command (Manual Addition)

**New Feature:** Right-click any `.json` file in Explorer → "Add Config"

**Behavior:**
- Validates file is within workspace
- Checks for duplicates
- Re-derives naming for **all** configs (to handle new conflicts)
- Updates marker file and tree

**Use Case:** Add non-standard filenames (e.g., `config-v2.json`, `test.json`) that aren't auto-discovered.

### 7. "Remove Tenant" vs "Remove Repository"

**Menu Restructure:**

| Location | Command | Action |
|----------|---------|--------|
| Level 1 (Environment) context menu | Remove Repository | Deletes all workspace files, disconnects repo |
| Level 1 (View title icon) | Remove Repository | Same as above |
| Level 2 (Tenant) context menu | Remove Tenant | Removes only that tenant from tree |

**Implementation:**
- `removeGitTenant`: Filters by `tenantId` (not `environmentName` — critical fix!)
- `removeGitSource`: Clears all sources, deletes workspace files

### 8. Git-Ignored Assets

**Change:** Auto-add `.reltio/` to `.gitignore` when connecting to a git repo.

**Rationale:** `.reltio/reltio-agent/` contains auto-synced Cursor Agent skills/Velocity Packs that shouldn't be committed to the repo.

**Implementation:**
- `ensureMarkerGitignored()` in `gitSourceMarker.ts` now adds both:
  - `.reltio-config-source.json` (marker file)
  - `.reltio/` (agent assets)

### 9. UX State for Git Sources

**Problem:** Root node showed "Sign in to continue" despite being local files.

**Fix:** `deriveUxState()` detects `__reltio-git-source__` token and sets `eState = 'E_READY'` immediately (no auth needed for local files).

**Changes:**
- `UxStateInputs` interface: Added optional `getToken` method
- `deriveUxState()`: Checks `isGitSource = inputs.getToken?.(env.name) === '__reltio-git-source__'`
- Git sources skip all auth-related states

## Updated Data Structures

### Marker File Format (`.reltio-config-source.json`)

**Original (single source):**
```json
{
  "l3RelativePath": "L3.reltio.json",
  "environmentName": "Tenant1",
  "tenantId": "Tenant1"
}
```

**New (multi-source, backward compatible):**
```json
{
  "sources": [
    {
      "l3RelativePath": "BusinessConfig.json",
      "environmentName": "reltio-product-editions",
      "tenantId": "reltio-product-editions"
    },
    {
      "l3RelativePath": "Account360/BusinessConfig.json",
      "environmentName": "reltio-product-editions",
      "tenantId": "Account360"
    }
  ]
}
```

**Backward Compatibility:** `readMultiGitSourceMarker()` accepts both formats.

## Test Plan Additions

**Automated (to be added):**
- Conflict detection in `deriveTenantNaming` (same folder, multiple files)
- Multi-source marker read/write
- Remove tenant (not all tenants)
- Add config with conflict resolution

**Manual:**
- `reltio-product-editions` (38 configs) → verify all appear under one root
- Add duplicate filename → verify both show `(filename)` suffix
- Remove one tenant → verify others remain
- Auto-expand on connection

## Risks / Trade-offs

1. **38+ tenants in one tree** → could be slow, but testing shows acceptable performance
2. **Filename conflicts** → parentheses in names might look odd, but unambiguous
3. **No multi-repo support** → deliberate (user can open multiple VS Code windows)
4. **Marker file format change** → backward compatible, but old extension versions won't read new format

## Migration Path

**Existing single-source repos:** Automatically upgraded on next connection (marker rewritten to multi-source format).

**No user action required.**
