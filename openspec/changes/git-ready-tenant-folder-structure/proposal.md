## Why

Teams want tenant configuration under source control, promoted through pull requests: edit against Dev, push to a `dev` branch, raise a PR to `test`, let CI/CD deploy to the Test tenant, repeat for `prod`. Today's layout blocks that. A connected tenant produces a single `L3.reltio.json` inside `{host}.reltio.environment/{tenantId}.reltio.tenant/`, so the environment host and tenant ID are path segments. The same logical configuration pushed from a Dev tenant and a Prod tenant lands at two different paths, which means the branches cannot be diffed or merged. IDE working state (drift baseline, ontology layout, history snapshots) sits beside the config and would be committed alongside it. There is also no component structure: one file named after an internal concept (L3) rather than the product surface it configures.

This change (RP-200851) makes each tenant folder a self-contained, tenant-agnostic Git repository with a standard component tree, so the promotion flow above works with no per-tenant path rewriting.

## What Changes

- **BREAKING (on-disk layout).** A tenant folder gains a fixed 15-folder component tree. `L3.reltio.json` becomes `Business Config/BusinessConfig.json`. The 14 folders for components the IDE does not yet manage (`RDM`, `Workflows`, `Data Validation Functions`, `Metadata Permissions`, `User Management`, `Data Loader`, `Reltio Integration Hub`, `LifeCycle Actions`, `DTSS`, `Connectors`, `User Interface`, `Custom Code`, `Physical Configuration`, plus their subfolders) are created with a `README.md` placeholder each, because Git does not track empty directories.
- **BREAKING (on-disk layout).** IDE working state moves out of the tracked tree into `.reltio-ide/` at the tenant root: `BusinessConfig.baseline.json`, `BusinessConfig.layout.json`, and `history/`.
- New tenant folders are created at the **workspace root** (`{host}.reltio.environment/{tenantId}.reltio.tenant/`) rather than under `.reltio/`, so repositories sit at depth 2 in plain sight. Both locations are already scanned by `collectEnvironmentDirs`, so this needs no scanner change. `.reltio/` keeps holding agent assets only.
- New `reltio.connectTenantToGit` command: prompts for a remote URL (remembered per workspace after first entry) and a branch name, then clones that branch into the still-empty tenant folder via `git clone --branch`. The tenant folder becomes the Git repository root, so no tracked path contains an environment host or tenant ID.
- The tenant's environment and tenant ID move into the gitignored `.reltio-config-source.json` marker, generalizing the existing `gitSourceMarker.ts` mechanism. The Reltio tree view keeps showing environment and tenant names by reading the marker rather than the path.
- The tree view shows each tenant's current branch, read from `git rev-parse --abbrev-ref HEAD`. Branch state is owned by Git and never duplicated in extension state.
- A generated `.gitignore` per tenant excludes `.reltio-ide/` and the marker file, reusing `ensureMarkerGitignored`. A clean tenant shows only configuration files in `git status`.
- Automatic one-shot migration of existing tenants on activation, moving legacy files to the new paths. Guarded by a `workspaceState` stamp so it runs at most once, preceded by a backup of the tenant folder, skipped with a clear message when the tenant folder has uncommitted Git changes, reported afterwards by a non-blocking summary notification, and reversible via a new `reltio.undoLayoutMigration` command.
- No new capability for any component other than Business Config. The other 14 folders are structural placeholders only.

## Capabilities

### New Capabilities
- `tenant-folder-structure`: The fixed component tree a tenant folder materializes, the location of `BusinessConfig.json`, the `README.md` placeholder contract for unmanaged components, and the isolation of IDE working state into `.reltio-ide/`.
- `tenant-git-binding`: Binding a tenant folder to a Git remote and branch so the folder is itself the repository root, including the connect command, the generated `.gitignore`, branch display in the tree, and the guarantee that tracked paths are tenant-agnostic.
- `legacy-layout-migration`: One-shot automatic migration from the legacy flat layout to the component tree, with backup, idempotency, dirty-worktree refusal, post-migration reporting, and undo.

### Modified Capabilities
- `environment-management`: `EnvironmentManager` resolves the configuration file, drift baseline, ontology layout and history directory to component-tree paths rather than flat tenant-root paths, and new tenant folders are created at the workspace root rather than under `.reltio/`. Tenant identity is read from the marker file instead of being inferred solely from the folder name.
- `git-repository-source`: Git-sourced mode and the new native per-tenant Git binding must coexist without conflict. A repository discovered through `fetchConfigFromGit` that already carries the component tree is recognized as such rather than treated as an arbitrary layout.

## Impact

- **New files**: `src/workspace/tenantFolderStructure.ts` (component-tree definition, folder creation, README generation), `src/workspace/layoutMigration.ts` (detect, back up, migrate, undo), `src/workspace/tenantGitBinding.ts` (clone-with-branch, current-branch read, per-tenant `.gitignore`).
- **Modified files**: `src/workspace/environmentManager.ts` (all five path accessors: `getL3Uri`, `getRemoteBaselineUri`, `getLayoutUri`, `getHistoryDirectoryUri`, `getTenantRootUri`; `preferredEnvironmentUri` moves to the workspace root; `createTenant` materializes the tree), `src/workspace/gitSourceMarker.ts` (marker carries native-tenant identity; `.gitignore` helper gains `.reltio-ide/`), `src/workspace/gitConfigSource.ts` (`cloneRepository` gains a branch argument and a target directory), `src/workspace/configurationHistory.ts` (history directory moves), `src/ux/uxState.ts` (hardcoded logical L3 key at line 109), `src/extension.ts` (activation-time migration hook, `endsWith('/L3.reltio.json')` first-open tracking at line 2045, two new commands, save-before-apply message text), `src/tree/multiTenantNodes.ts` and `src/tree/multiTenantTreeProvider.ts` (branch badge, marker-sourced labels), `package.json` (two new commands and their menu entries), `ARCHITECTURE.md`.
- **No change needed**: language feature registration already covers `**/BusinessConfig.json` for navigation, diagnostics, completion and schema validation, so the renamed file is handled as-is.
- **Dependencies**: None new. Branch selection uses the system `git` executable already shelled out to by `gitConfigSource.ts`.
- **Depends on**: `multi-tenant-tree-view` (the `EnvironmentManager` and tree pipeline being repathed), `git-repository-source` (the marker and clone mechanisms being generalized), `configuration-history-review` (the history directory being relocated), `apply-tenant-configuration-action` (the drift baseline being relocated).
- **Tests**: New `scripts/test-git-ready-tenant-folder-structure.cjs`, registered in `scripts/run-unit-tests.cjs`.
