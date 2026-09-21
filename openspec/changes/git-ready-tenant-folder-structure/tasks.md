## 1. Component tree foundation

- [x] 1.1 Create `src/workspace/tenantFolderStructure.ts` exporting the component-tree definition: an ordered list of the 18 leaf component paths from the `tenant-folder-structure` spec (which imply 21 directories on disk once the 3 container parents are included), each flagged managed or unmanaged, with the expected filenames for the unmanaged ones
- [x] 1.2 Export path constants for the managed locations (`Business Config/BusinessConfig.json`, `.reltio-ide/BusinessConfig.baseline.json`, `.reltio-ide/BusinessConfig.layout.json`, `.reltio-ide/history/`) so nothing else hardcodes them
- [x] 1.3 Implement `materializeTenantTree(tenantUri)`: create every missing directory, leave existing ones untouched, never delete
- [x] 1.4 Add the verified `docs.reltio.com` URL map from `design.md` D10 as a single table beside the tree definition, one entry per unmanaged folder
- [x] 1.5 Implement README generation: write `README.md` into each unmanaged folder naming the component, listing expected files, linking to its documentation URL, and stating the IDE does not fetch or apply them; skip `Business Config/`; never overwrite an existing file
- [x] 1.6 Implement `isComponentTree(uri)` returning true when a folder already carries the tree, for use by migration detection and git-source recognition

## 2. Repath EnvironmentManager

- [x] 2.1 Point `getL3Uri` at `Business Config/BusinessConfig.json`, leaving the git-source branch of the method unchanged
- [x] 2.2 Point `getRemoteBaselineUri` at `.reltio-ide/BusinessConfig.baseline.json` and retire the `REMOTE_BASELINE_FILENAME` constant's flat-root usage
- [x] 2.3 Point `getLayoutUri` at `.reltio-ide/BusinessConfig.layout.json` for the native path, leaving the git-source sidecar-beside-source behaviour unchanged
- [x] 2.4 Point `getHistoryDirectoryUri` at `.reltio-ide/history/`
- [x] 2.5 Change `preferredEnvironmentUri` to resolve to the workspace root instead of `.reltio/`; confirm `collectEnvironmentDirs` still scans both and that an environment already known under `.reltio/` keeps its location
- [x] 2.6 Make `createTenant` call `materializeTenantTree` after creating the directory
- [x] 2.7 Confirm `scanTenants` still reports `hasL3` correctly now that the config sits one level deeper

## 3. Eliminate stray path construction

- [x] 3.1 Replace the hardcoded logical key in `src/ux/uxState.ts:109` (`l3FileUri`) with the component-tree path, keeping it a logical key rather than a filesystem path
- [x] 3.2 Replace `endsWith('/L3.reltio.json')` in `src/extension.ts:2045` with a check against the component-tree config path
- [x] 3.3 Update the "Save L3.reltio.json before applying" message in `src/extension.ts:1185` to name the new file
- [x] 3.4 Grep `src/` for remaining `L3.reltio.json`, `L3.remote-baseline`, `L3.reltio.layout` and `'history'` literals; move any survivor behind `EnvironmentManager` or `tenantFolderStructure`

## 4. Marker-sourced tenant identity

- [x] 4.1 Extend the marker type in `src/workspace/gitSourceMarker.ts` to carry native-tenant identity alongside the existing git-source shape, keeping both legacy formats readable
- [x] 4.2 Add `.reltio-ide/` to `ensureMarkerGitignored`, preserving unrelated entries and never duplicating
- [ ] 4.3 Write the marker when a tenant is bound to Git; do not write one for unbound tenants
- [ ] 4.4 Make the tree prefer marker-sourced environment and tenant labels, falling back to folder names when no marker is present

## 5. Per-tenant Git binding

- [ ] 5.1 Add a branch argument and an explicit target directory to `cloneRepository` in `src/workspace/gitConfigSource.ts`, passing `--branch` via the existing `execFile` argument array
- [ ] 5.2 Create `src/workspace/tenantGitBinding.ts` with `bindTenantToGit`, `getCurrentBranch` (via `git rev-parse --abbrev-ref HEAD`), and a tenant-folder emptiness check that tolerates a tree of generated READMEs
- [ ] 5.3 Implement the `reltio.connectTenantToGit` command: prompt for the remote (pre-filled from workspace state after first use), prompt for the branch (never pre-filled), clone, materialize any missing tree, write the marker and `.gitignore`
- [ ] 5.4 Implement branch creation for an absent branch: confirmation naming branch and remote, clone the remote default branch, `git checkout -b <branch>`, `git push -u origin <branch>`; never an orphan branch, so history is shared
- [ ] 5.5 Handle the remaining failure cases: non-empty tenant folder, declined branch creation, failed publish (report that the branch exists locally but was not pushed), empty remote with no default branch, `GitNotFoundError`, clone timeout. Leave the folder empty rather than partially cloned
- [ ] 5.6 Register the command and its tree context menu entry in `package.json`, gated off when `reltio.workspaceSource` is `git`

## 6. Branch display in the tree

- [ ] 6.1 Add branch resolution to the tenant node in `src/tree/multiTenantNodes.ts`, rendering the branch as a description suffix
- [ ] 6.2 Render nothing (no error, no placeholder) for an unbound tenant or a detached HEAD
- [ ] 6.3 Refresh branch state on tree refresh so an external checkout is picked up

## 7. Legacy layout migration

- [ ] 7.1 Create `src/workspace/layoutMigration.ts` with `detectLegacyTenants(environmentManager)` returning the tenants that still use the flat layout
- [ ] 7.2 Implement `planMigration(tenantUri)` producing the from/to file map, omitting files that are absent
- [ ] 7.3 Implement the dirty-worktree check: skip a tenant that is a Git repository with uncommitted changes, and record the reason
- [ ] 7.4 Implement the backup into `.reltio-ide-backup/{env}/{tenant}/` at the workspace root before the first move; add `.reltio-ide-backup/` to the workspace-root `.gitignore`; abort that tenant if the backup fails; retain the backup after success
- [ ] 7.5 Implement `migrateTenant`: materialize the tree, move each file, write the `.gitignore` entries, then write the `workspaceState` stamp only on full success
- [ ] 7.6 Implement `undoMigration` restoring from the backup and clearing the stamp, with a confirmation listing the affected tenants and a clear refusal when no backup exists
- [ ] 7.7 Register the `reltio.undoLayoutMigration` command in `package.json` and wire it in `extension.ts`
- [ ] 7.8 Hook migration into activation off the critical path, refresh the tree when it finishes, and show one non-blocking summary notification for the whole workspace with a detail action
- [ ] 7.9 Suppress the notification entirely when nothing needed migrating

## 8. Coexistence with git-sourced mode

- [ ] 8.1 Confirm activation resolves exactly one mode and that `reltio.workspaceSource` reflects it
- [ ] 8.2 Make `l3Discovery` recognize a cloned repository carrying the component tree and resolve `Business Config/BusinessConfig.json` without prompting
- [ ] 8.3 Confirm arbitrary repositories still fall through to the existing depth-limited discovery, and multi-config repositories still produce one row each
- [ ] 8.4 Confirm no migration is attempted in git-sourced mode

## 9. Tests

- [ ] 9.1 Create `scripts/test-git-ready-tenant-folder-structure.cjs` and register it in the explicit array in `scripts/run-unit-tests.cjs`
- [ ] 9.2 Tier A: component tree materializes the exact 21 directories (18 leaf paths plus the 3 container parents); READMEs written to unmanaged folders only; existing README not overwritten; re-materializing is non-destructive; every unmanaged folder has a non-empty `docs.reltio.com` URL and the generated README contains it (assert the map, do not hit the network)
- [ ] 9.3 Tier A: all five `EnvironmentManager` accessors resolve to component-tree paths; `preferredEnvironmentUri` resolves to the workspace root; a known `.reltio/` environment keeps its location
- [ ] 9.4 Tier A: marker round-trip carries environment and tenant; tree label prefers the marker and falls back to the folder name
- [ ] 9.5 Tier A: `.gitignore` generation adds `.reltio-ide/` and the marker, preserves unrelated entries, never duplicates
- [ ] 9.6 Tier A: migration plan maps each legacy file correctly, omits absent files, no-ops on an already-migrated folder, is refused on a dirty worktree, and does not write the stamp on a simulated partial failure; backup path resolves to `.reltio-ide-backup/{env}/{tenant}/` and the workspace-root `.gitignore` gains the entry without duplication
- [ ] 9.7 Tier A: branch-creation flow builds the correct Git argument sequence (clone default, `checkout -b`, `push -u`) and never `--orphan`; a declined confirmation produces no Git invocation
- [ ] 9.8 Tier A: grep invariant asserting no `L3.reltio.json` literal survives outside `EnvironmentManager` / `tenantFolderStructure`
- [ ] 9.9 Tier B: load the canonical fixture from both a legacy path and `Business Config/BusinessConfig.json`, and assert the parsed model, `UriIndex` and derived tree sections are identical
- [ ] 9.10 Run `npm test` and confirm the whole suite passes, including `test-code-model-and-schema.cjs` running first

## 10. Documentation

- [ ] 10.1 Update `ARCHITECTURE.md`: the domain glossary entries for Environment and Tenant, the tenant folder files section, the configuration history section, and the data-flow diagram
- [ ] 10.2 Document the two new commands in the `ARCHITECTURE.md` command table
- [ ] 10.3 Document the new layout, the `.reltio-ide/` sidecar location, and the workspace-root default in the settings and file-system sections
- [ ] 10.4 Add a release note covering the automatic migration, the backup location, the undo command, and the downgrade caveat

## 11. Manual QA

- [ ] 11.1 Run the full Tier C pass from `design.md`, including the migration, migration-refusal, undo, coexistence and detached-HEAD cases
- [ ] 11.2 Verify the end-to-end promotion scenario: two tenants bound to one remote on `dev` and `prod`, push both, confirm the branches diff cleanly with no path differences
