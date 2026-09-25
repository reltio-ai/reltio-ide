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
- [x] 4.3 Write the marker when a tenant is bound to Git; do not write one for unbound tenants
- [x] 4.4 Make the tree prefer marker-sourced environment and tenant labels, falling back to folder names when no marker is present

## 5. Per-tenant Git binding

- [x] 5.1 Add a branch argument and an explicit target directory to `cloneRepository` in `src/workspace/gitConfigSource.ts`, passing `--branch` via the existing `execFile` argument array
- [x] 5.2 Create `src/workspace/tenantGitBinding.ts` with `bindTenantToGit`, `getCurrentBranch` (via `git rev-parse --abbrev-ref HEAD`), and a tenant-folder emptiness check that tolerates a tree of generated READMEs
- [x] 5.3 Implement the `reltio.connectTenantToGit` command: prompt for the remote (pre-filled from workspace state after first use), prompt for the branch (never pre-filled), clone, materialize any missing tree, write the marker and `.gitignore`
- [x] 5.4 Implement branch creation for an absent branch: confirmation naming branch and remote, clone the remote default branch, `git checkout -b <branch>`, `git push -u origin <branch>`; never an orphan branch, so history is shared
- [x] 5.5 Handle the remaining failure cases: non-empty tenant folder, declined branch creation, failed publish (report that the branch exists locally but was not pushed), empty remote with no default branch, `GitNotFoundError`, clone timeout. Leave the folder empty rather than partially cloned
- [x] 5.6 Register the command and its tree context menu entry in `package.json`, gated off when `reltio.workspaceSource` is `git`

## 6. Branch display in the tree

- [x] 6.1 Add branch resolution to the tenant node in `src/tree/multiTenantNodes.ts`, rendering the branch as a description suffix
- [x] 6.2 Render nothing (no error, no placeholder) for an unbound tenant or a detached HEAD
- [x] 6.3 Refresh branch state on tree refresh so an external checkout is picked up

## 7. Legacy layout migration

- [x] 7.1 Create `src/workspace/layoutMigration.ts` with `detectLegacyTenants(environmentManager)` returning the tenants that still use the flat layout
- [x] 7.2 Implement `planMigration(tenantUri)` producing the from/to file map, omitting files that are absent
- [x] 7.3 Implement the dirty-worktree check: skip a tenant that is a Git repository with uncommitted changes, and record the reason
- [x] 7.4 Implement the backup into `.reltio-ide-backup/{env}/{tenant}/` at the workspace root before the first move; add `.reltio-ide-backup/` to the workspace-root `.gitignore`; abort that tenant if the backup fails; retain the backup after success
- [x] 7.5 Implement `migrateTenant`: materialize the tree, move each file, write the `.gitignore` entries, then write the `workspaceState` stamp only on full success
- [x] 7.6 Implement `undoMigration` restoring from the backup and clearing the stamp, with a confirmation listing the affected tenants and a clear refusal when no backup exists
- [x] 7.7 Register the `reltio.undoLayoutMigration` command in `package.json` and wire it in `extension.ts`
- [x] 7.8 Hook migration into activation off the critical path, refresh the tree when it finishes, and show one non-blocking summary notification for the whole workspace with a detail action
- [x] 7.9 Suppress the notification entirely when nothing needed migrating

## 8. Coexistence with git-sourced mode

- [x] 8.1 Confirm activation resolves exactly one mode and that `reltio.workspaceSource` reflects it
- [x] 8.2 Make `l3Discovery` recognize a cloned repository carrying the component tree and resolve `Business Config/BusinessConfig.json` without prompting
- [x] 8.3 Confirm arbitrary repositories still fall through to the existing depth-limited discovery, and multi-config repositories still produce one row each
- [x] 8.4 Confirm no migration is attempted in git-sourced mode

## 9. Tests

- [x] 9.1 Create `scripts/test-git-ready-tenant-folder-structure.cjs` and register it in the explicit array in `scripts/run-unit-tests.cjs`
- [x] 9.2 Tier A: component tree materializes the exact 21 directories (18 leaf paths plus the 3 container parents); READMEs written to unmanaged folders only; existing README not overwritten; re-materializing is non-destructive; every unmanaged folder has a non-empty `docs.reltio.com` URL and the generated README contains it (assert the map, do not hit the network)
- [x] 9.3 Tier A: all five `EnvironmentManager` accessors resolve to component-tree paths; `preferredEnvironmentUri` resolves to the workspace root; a known `.reltio/` environment keeps its location
- [x] 9.4 Tier A: marker round-trip carries environment and tenant; tree label prefers the marker and falls back to the folder name
- [x] 9.5 Tier A: `.gitignore` generation adds `.reltio-ide/` and the marker, preserves unrelated entries, never duplicates
- [x] 9.6 Tier A: migration plan maps each legacy file correctly, omits absent files, no-ops on an already-migrated folder, is refused on a dirty worktree, and does not write the stamp on a simulated partial failure; backup path resolves to `.reltio-ide-backup/{env}/{tenant}/` and the workspace-root `.gitignore` gains the entry without duplication
- [x] 9.7 Tier A: branch-creation flow builds the correct Git argument sequence (clone default, `checkout -b`, `push -u`) and never `--orphan`; a declined confirmation produces no Git invocation
- [x] 9.8 Tier A: grep invariant asserting no `L3.reltio.json` literal survives outside `EnvironmentManager` / `tenantFolderStructure`
- [x] 9.9 Tier B: load the canonical fixture from both a legacy path and `Business Config/BusinessConfig.json`, and assert the parsed model, `UriIndex` and derived tree sections are identical
- [x] 9.10 Run `npm test` and confirm the whole suite passes, including `test-code-model-and-schema.cjs` running first

## 10. Documentation

- [x] 10.1 Update `ARCHITECTURE.md`: the domain glossary entries for Environment and Tenant, the tenant folder files section, the configuration history section, and the data-flow diagram
- [x] 10.2 Document the two new commands in the `ARCHITECTURE.md` command table
- [x] 10.3 Document the new layout, the `.reltio-ide/` sidecar location, and the workspace-root default in the settings and file-system sections
- [x] 10.4 Add a release note covering the automatic migration, the backup location, the undo command, and the downgrade caveat

## 11. Manual QA

- [ ] 11.1 Run the full Tier C pass from `design.md`, including the migration, migration-refusal, undo, coexistence and detached-HEAD cases
- [ ] 11.2 Verify the end-to-end promotion scenario: two tenants bound to one remote on `dev` and `prod`, push both, confirm the branches diff cleanly with no path differences

## 12. Round 2: plain folder names (from live testing)

Dropping `.reltio.environment` / `.reltio.tenant` from folder names. Internal identity stays the
host (`dev.reltio.com`), which every API call needs; only the directory name changes.

- [x] 12.1 Fix: `createTenant` must write the tenant `.gitignore`, not only migration and git-bind, so `.reltio-ide/` is ignored even when the user runs **Initialize Repository** from the SCM panel
- [x] 12.2 Add an environment marker (`.reltio-environment.json`, `{kind, host}`) written on `createEnvironment`; it sits above the tenant git root so it is never committed
- [x] 12.3 Always write the tenant identity marker at `createTenant` time, not only on git-bind: with suffixes gone it is the only thing identifying the folder
- [x] 12.4 `environmentDirName` returns the first DNS label (`dev.reltio.com` -> `dev`), falling back to the full host when another environment already holds that label
- [x] 12.5 `tenantDirName` returns the bare tenant ID
- [x] 12.6 `collectEnvironmentDirs` finds environments by marker, still accepting legacy `*.reltio.environment` dirs
- [x] 12.7 `scanTenants` finds tenants by marker, still accepting legacy `*.reltio.tenant` dirs
- [x] 12.8 Replace suffix parsing in `pathTenantLocFromL3Path` with a reverse index built during `scanEnvironments`, keeping the lookup synchronous for `getParent` and first-open tracking; legacy suffixed paths still parse
- [x] 12.9 Extend the activation migration to rename suffixed folders to plain names, reusing the existing backup, stamp and dirty-worktree refusal
- [x] 12.10 Tests: short-label derivation and collision fallback, marker-based discovery, legacy suffixed discovery still works, reverse-index lookup, folder-rename migration
- [x] 12.11 Update `ARCHITECTURE.md`, the specs and the release note for the new naming

## 13. Round 3: bind a tenant that has already fetched

Connect-before-fetch was an unnecessary ordering constraint, and it dead-ended a user who had
already fetched: the command refused and there was no way forward short of deleting the config.

- [x] 13.1 Drop the refusal in `reltio.connectTenantToGit`; a populated tenant folder is a normal case, not an error
- [x] 13.2 Add an adopt-in-place path: `git init -b <branch>`, `remote add`, `fetch`, **mixed** `reset origin/<branch>`, `--set-upstream-to`. Never `--hard`, so no user file is touched
- [x] 13.3 Handle an absent branch on the adopt path by basing on the remote default branch and publishing, same as the clone path; undo the `git init` when the user declines
- [x] 13.4 Report the `adopted` outcome distinctly, saying the existing config is now staged as changes against the branch
- [x] 13.5 Tests for the cloneable/adopt classification, including that `.reltio-ide/` alone does not force adoption
- [x] 13.6 End-to-end check of the adopt sequence against real git: file byte-identical, branch tracking, config shown as a modification
- [x] 13.7 Update `design.md` D3 and the `tenant-git-binding` spec for the two binding paths

## 14. Round 4: empty remote is a normal state, not a failure

- [x] 14.1 Add an `initialized-empty-remote` outcome; an unborn branch cannot be pushed, so reporting a failed push was wrong on both the clone and adopt paths
- [x] 14.2 Replace the thrown `EmptyRemoteError` on the clone path with the same outcome, so an empty remote never surfaces as an error
- [x] 14.3 Reword the notification as the next step (commit and push from Source Control) rather than as something going wrong
- [x] 14.4 End-to-end check against a real empty bare remote: branch set, origin set, config preserved, first commit pushes cleanly with no env/tenant in the tracked path

## 15. Round 5: a new branch must not inherit another tenant's configuration

Reported from testing: connecting a second tenant to a new branch left the first tenant's
config in the second tenant's folder, because the branch forks from the remote default.

- [x] 15.1 After forking a new branch from the default, drop the inherited `Business Config/BusinessConfig.json` from the index and working tree
- [x] 15.2 Keep shared history rather than using `--orphan`: the user confirmed they raise dev -> test -> prod pull requests, which unrelated histories break
- [x] 15.3 Leave component folders and generated READMEs alone; they are identical per tenant, and anything hand-placed is the user's content
- [x] 15.4 Stage the deletion but do not commit it; the extension makes no commits on the user's behalf
- [x] 15.5 End-to-end: two tenants, one remote, branches dev and test. Tenant B never sees tenant A's config, READMEs survive, history is shared, and merging dev into test produces a normal content conflict rather than 'unrelated histories'

## 16. Round 6: a Git repository above the tenant folders

A repository at the workspace root either pulls environment and tenant names back into every
tracked path, or swallows a bound tenant as a gitlink whose contents it does not store. The
extension cannot prevent `git init` (it belongs to the built-in git extension), so the goal is
to make it harmless and to say so clearly.

- [x] 16.1 `ensureWorkspaceGitignored` writes a workspace-root `.gitignore` covering `.reltio/`, `.reltio-ide/`, `.reltio-ide-backup/` and both marker filenames, so no repository rooted above a tenant can commit extension state
- [x] 16.2 Do not ignore the environment folders by default: one repository for the whole workspace is a legitimate choice, just not the default
- [x] 16.3 `findEnclosingGitRepository` walks up from a path to the filesystem root and reports the nearest repository, including one at the start directory itself
- [x] 16.4 Activation warns when a repository encloses the workspace, offering **Ignore Tenant Folders**, **Show Details** and **Don't Show Again** (the dismissal is per workspace)
- [x] 16.5 **Show Details** opens a markdown explainer covering both failure shapes and the two ways out
- [x] 16.6 **Connect Tenant to Git** warns modally before creating a repository inside another one
- [x] 16.7 Tests for the workspace ignore list, its idempotency, that environment folders stay un-ignored, and enclosing-repository detection at the start directory and above
- [ ] 16.8 Update `ARCHITECTURE.md` and the release note
