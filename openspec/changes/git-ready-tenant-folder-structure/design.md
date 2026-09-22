## Context

RP-200851. Today a connected tenant produces a flat folder:

```
.reltio/{host}.reltio.environment/{tenantId}.reltio.tenant/
├── L3.reltio.json
├── L3.remote-baseline.reltio.json
├── L3.reltio.layout.json
└── history/
```

Teams want that configuration in Git, promoted through pull requests: edit against Dev, push to a `dev` branch, PR into `test`, let CI/CD deploy to the Test tenant, repeat into `prod`. The flat layout blocks this in three ways. The environment host and tenant ID are path segments, so the same logical config produces different paths per tenant and branches cannot be diffed or merged. IDE working state sits beside the config and would be committed. And there is no component structure: one file named after an internal concept rather than the product surface it configures.

Users also need several tenants on disk at once, to compare Dev against Prod.

**Current state that this design leans on:**

- Path construction is already centralized in `EnvironmentManager` (`getL3Uri`, `getRemoteBaselineUri`, `getLayoutUri`, `getHistoryDirectoryUri`, `getTenantRootUri`). Only two consumers build paths independently: `src/ux/uxState.ts:109` and `src/extension.ts:2045`.
- `collectEnvironmentDirs` already scans both the workspace root and `.reltio/`, preferring `.reltio/` when a host exists in both. Moving new environments to the root therefore needs no scanner change.
- Language features already register for `**/BusinessConfig.json` alongside `**/*.reltio.json` and `**/L3.json`, so renaming the config file costs nothing in navigation, diagnostics, completion or schema validation.
- `src/workspace/gitSourceMarker.ts` already writes a gitignored `.reltio-config-source.json` carrying `environmentName` and `tenantId`, and `ensureMarkerGitignored` already manages a `.gitignore`. The decoupling of path from identity is a generalization of existing code, not a new mechanism.
- `src/workspace/gitConfigSource.ts` already shells out to the system `git` executable with credential handling delegated to the OS credential helper.

## Goals / Non-Goals

**Goals:**

- Each tenant folder is a self-contained Git repository whose tracked paths contain no environment host or tenant ID, so branches from different tenants diff and merge cleanly.
- A fixed component tree per tenant (18 leaf component folders, 21 directories on disk), with the fetched configuration at `Business Config/BusinessConfig.json`.
- IDE working state isolated from the tracked tree and ignored by Git.
- Several tenants usable side by side, each on its own branch.
- Existing daily users land on the new layout without manual work and without losing data.
- Zero regression in navigation, diagnostics, ontology preview, fetch, apply, history, and git-sourced mode.

**Non-Goals:**

- Fetching or applying any component other than Business Config. The other 17 component folders are structural placeholders.
- The CI/CD pipeline that consumes the pushed branches.
- Commit, push, PR, merge or conflict-resolution UI inside the extension. Users use VS Code's Source Control panel.
- Multi-root workspace support.
- Changing the shape of the configuration JSON itself.

## Decisions

### D1. The tenant folder is the Git repository root

**Decision:** Put `.git` at the tenant folder. Environment and tenant folders stay on disk but sit *above* the repository root, so Git never sees them.

Git tracks paths relative to the folder containing `.git`. Placing the repository root at the tenant folder is therefore sufficient, on its own, to make every tracked path tenant-agnostic. No renaming, no flattening, no marker-based virtual filesystem.

**Alternatives considered:**

| Alternative | Why rejected |
|---|---|
| One workspace folder per tenant (multi-root) | Cleanest on disk, but requires rewriting tenant discovery around marker files, and `updateWorkspaceFolders` restarts the extension host on the first added folder. That drops in-memory tokens (`TokenStore` is memory-only by design) and forces re-authentication mid-task. |
| One clone, branch is the tenant | Matches the branch-per-tenant model most literally, but only one tenant exists on disk at a time. Comparing Dev against Prod would need a stash and a checkout, and fetching tenant B while parked on branch A writes into the wrong branch. The extension would also have to own branch state, checkout failures and detached HEAD. |
| Keep one repository at the workspace root covering all tenants | Puts env/tenant back into tracked paths. Defeats the purpose. |

### D2. New environments are created at the workspace root, not under `.reltio/`

**Decision:** `preferredEnvironmentUri` returns a workspace-root path. `.reltio/` keeps agent assets only. Discovery is unchanged and still finds both.

Repositories then sit at depth two in plain sight rather than depth three inside a hidden folder. Nested repositories under a dotfolder work, but they are hard to find in a terminal and some external tooling skips dot-prefixed directories. Because `collectEnvironmentDirs` already scans both locations and prefers an already-known location, existing `.reltio/` environments keep working untouched and are never relocated.

### D3. Branch is captured once and then owned by Git

**Decision:** `reltio.connectTenantToGit` prompts for a remote (remembered per workspace) and a branch (prompted each time), then runs `git clone --branch <branch> <remote> .` inside the still-empty tenant folder. Nothing about the branch is persisted by the extension. The tree reads `git rev-parse --abbrev-ref HEAD`.

Branch names are promotion stages (`dev`, `test`, `prod`) that vary by team, so they cannot be derived from the tenant ID. The remote is shared across every tenant in a promotion flow, so it belongs at workspace scope; the branch differs per tenant, so it does not.

Binding works in either order, because requiring connect-before-fetch turned out to be a dead end: a user who fetched first had no way forward short of deleting their configuration. Two paths:

| Tenant folder | Path |
|---|---|
| Empty | `git clone --branch <b> <remote> .` straight in |
| Already holds a configuration | `git init -b <b>`, `remote add`, `fetch`, **mixed** `reset origin/<b>`, `--set-upstream-to` |

The reset on the second path is mixed, never `--hard`. HEAD and the index move to the remote branch; the working tree is untouched, so not one byte of the user's configuration is overwritten. Their config then shows as an uncommitted change against the branch, which is precisely the diff they want to review and push. The notification says so, because an apparently large diff in Source Control is otherwise alarming.

`isTenantFolderCloneable` decides between them. It tolerates `.reltio`, `.reltio-ide`, `.DS_Store`, `Thumbs.db`, `desktop.ini` and a component tree containing only generated `README.md` files, since all of those are ours rather than the user's work. A `BusinessConfig.json`, or any file the user put in a component folder, routes to the adopt path.

Storing the branch would create a second source of truth that silently goes stale the moment a user checks out from a terminal. Reading `HEAD` cannot go stale.

### D4. Identity lives in the marker, generalized from git-source mode

**Decision:** Extend `.reltio-config-source.json` to carry native-tenant identity, and have the tree prefer the marker over the folder name, falling back to the folder name when the marker is absent.

This reuses a mechanism that already exists and is already gitignored. The fallback keeps unbound tenants and pre-existing workspaces working with no marker present.

### D5. IDE state goes to `.reltio-ide/`, ignored by the same helper that ignores the marker

**Decision:** Baseline, ontology layout and history move to `.reltio-ide/` at the tenant root. `ensureMarkerGitignored` gains `.reltio-ide/` alongside the marker entry.

Keeping them beside the config would put drift baselines and history snapshots into every pull request, which is noise at best and confusing at worst (a baseline is a *copy* of the remote config, so a reviewer sees the same content twice). A hidden sibling folder is the smallest change that keeps `git status` meaningful.

`.reltio-ide/` is chosen over reusing `.reltio/` to avoid colliding with the workspace-level agent-asset folder of the same name, which lives at the workspace root and has different semantics.

### D6. `README.md` placeholders, not `.gitkeep`

**Decision:** Every unmanaged component folder gets a generated `README.md` naming the component, listing the files expected there, and stating that the IDE does not fetch or apply them. Existing files are never overwritten.

Git does not track empty directories, so without a file the 13 unmanaged folders vanish on push and the structure the change exists to deliver is lost. `.gitkeep` would survive Git but tells a reader nothing. A README costs the same and documents the contract in the repository and in every PR that adds a tenant.

`Business Config/` gets no README because it holds a managed file.

### D7. Automatic migration, with backup, idempotency, dirty-worktree refusal and undo

**Decision:** Migrate legacy tenants on activation without prompting, but defensively.

Prompting was considered and rejected by the product decision: a prompt leaves teams running two layouts indefinitely, which is worse for a feature whose value is that every tenant looks the same. The cost is that files move under users without being asked, so the safeguards carry the risk:

| Safeguard | Purpose |
|---|---|
| Backup before the first move, to `.reltio-ide-backup/{env}/{tenant}/` at the workspace root | Recovery, and it can never be captured by a later commit. Kept inside the workspace so the user can actually find it, unlike the OS temp directory. Added to the workspace-root `.gitignore`. |
| `workspaceState` stamp per (environment, tenant) | Runs at most once; not written on partial failure, so a failed run retries |
| Refuse on a dirty Git worktree | Moving tracked files would bury the user's uncommitted work in a large rename diff |
| Non-blocking summary notification with a detail action | The user finds out what happened without being interrupted |
| `reltio.undoLayoutMigration` | An escape hatch that also clears the stamp |

Migration moves files rather than copying, so content is preserved byte-for-byte and no stale duplicate is left behind. It runs off the activation critical path so the window stays responsive, and refreshes the tree on completion.

### D8. Mode resolution stays explicit

**Decision:** Activation resolves exactly one of: git-sourced workspace, tenant-connected workspace, or empty. `reltio.connectTenantToGit` is gated off in git-sourced mode via the existing `reltio.workspaceSource` context key.

The two Git integrations now in the product answer different questions (is the *workspace* a repository, versus is this *tenant* a repository) and must not both be live. Reusing the existing context key keeps the 23 menu guards already in `package.json` coherent.

### D9. Connect offers to create a branch that does not exist on the remote

**Decision:** When `git clone --branch <branch>` fails because the branch is absent, offer to create it rather than stopping. On confirmation, clone the remote's default branch, then `git checkout -b <branch>` and `git push -u origin <branch>`.

A promotion topology has to start somewhere. Requiring the user to leave the IDE, clone by hand, create `dev`, `test` and `prod`, and come back is friction on the exact path this change exists to enable. The risk of creating a confusing empty branch is handled by making it an explicit confirmation naming the branch and the remote, never a silent fallback.

An empty remote (no default branch, nothing to clone) is the one case this cannot cover, since there is no commit to branch from. There the command reports that the repository has no commits and asks the user to push an initial commit first.

**Alternative considered:** `git checkout --orphan` to create a branch with no shared history. Rejected because branches in a promotion flow must share history for a PR between them to be meaningful. An orphan `test` branch cannot be merged into from `dev` without unrelated-history conflicts.

### D10. Component READMEs link to Reltio documentation

**Decision:** Each generated `README.md` carries a verified `docs.reltio.com` link for its component alongside the expected filenames. The URL map lives beside the tree definition in `tenantFolderStructure.ts`.

A filename list tells a reader what goes in the folder. A documentation link tells them what the component *is*, which matters more for the 13 folders the IDE does not yet manage and that a reviewer may be seeing for the first time in a pull request. The repository already links to `docs.reltio.com` from Velocity Pack READMEs and from `src/extension.ts:117`, so this matches existing practice.

URLs verified against `docs.reltio.com` at authoring time:

| Folder | Documentation |
|---|---|
| `RDM` | [RDM at a glance](https://docs.reltio.com/en/applications/rdm/rdm-at-a-glance) |
| `Workflows` | [Overview of Workflow Configuration](https://docs.reltio.com/en/objectives/manage-workflow-tasks/workflow-management-at-a-glance/workflow-management-set-up/overview-of-workflow-customizations/overview-of-workflow-configuration) |
| `Workflows/BPMN` | [Workflow Modeler at a glance](https://docs.reltio.com/en/applications/console/configuration-applications/workflow-modeler-at-a-glance) |
| `Workflows/Custom Workflows` | [Configure custom workflows](https://docs.reltio.com/en/objectives/manage-workflow-tasks/workflow-management-at-a-glance/workflow-management-set-up/overview-of-workflow-customizations/overview-of-workflow-configuration/configure-custom-workflows) |
| `Data Validation Functions` | [Define Data Validation Functions](https://docs.reltio.com/en/objectives/cleanse-and-verify-data/data-cleansing-at-a-glance/data-cleansing-operation/define-data-validation-functions) |
| `Metadata Permissions` | [Metadata Security](https://docs.reltio.com/en/developer-resources/system-administration-apis/system-administration-apis-at-a-glance/configuration-api/role-based-security/metadata-security) |
| `User Management` | [Managing User Accounts](https://docs.reltio.com/en/applications/console/security-applications/user-management-at-a-glance/managing-user-accounts) |
| `User Management/Users` | [Managing User Accounts](https://docs.reltio.com/en/applications/console/security-applications/user-management-at-a-glance/managing-user-accounts) |
| `User Management/Roles` | [Custom roles](https://docs.reltio.com/en/objectives/administer-system/system-administration-at-a-glance/access-management-at-a-glance/access-management-reference/authorization/custom-roles) |
| `User Management/Groups` | [Authorization](https://docs.reltio.com/en/objectives/administer-system/system-administration-at-a-glance/access-management-at-a-glance/access-management-reference/authorization) |
| `Data Loader` | [Get started with Data Loader](https://docs.reltio.com/en/applications/console/tenant-management-applications/data-loader-at-a-glance/get-started-with-data-loader) |
| `Reltio Integration Hub` | [Integration Hub at a glance](https://docs.reltio.com/en/applications/integration-hub/integration-hub-at-a-glance) |
| `LifeCycle Actions` | [LCA Configuration](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/customize-data-tasks-with-lcas/lca-configuration) |
| `DTSS` | [Reltio DTSS at a glance](https://docs.reltio.com/en/applications/data-integrations/data-enrichment-integrations-at-a-glance/reltio-data-tenant-subscription-service-dtss-at-a-glance) |
| `Connectors` | [Reltio Connector](https://docs.reltio.com/en/objectives/integrate-data/data-integration-at-a-glance/reltio-connector) |
| `User Interface` | [UI configuration at a glance](https://docs.reltio.com/en/objectives/configure-the-reltio-ui/ui-configuration-at-a-glance) |
| `Custom Code/Custom Cleansers` | [Out-of-the-box Cleanse Functions](https://docs.reltio.com/en/objectives/cleanse-and-verify-data/data-cleansing-at-a-glance/data-cleansing-reference/out-of-the-box-cleanse-functions) |
| `Custom Code/Utilities` | [Developer resources at a glance](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance) |
| `Physical Configuration` | [Tenant Configuration Parameters Reference](https://docs.reltio.com/en/developer-resources/about-developer-resources/developer-resources-at-a-glance/tenant-configuration-parameters-reference) |

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Auto-migration moves a daily user's files without asking, and something goes wrong | Backup before the first move; stamp not written on partial failure so the run retries; `Undo Layout Migration`; refusal on a dirty worktree. Tier C manual QA explicitly covers interrupted migration. |
| A path is missed and still points at `L3.reltio.json` | Enforced centralization: after the change, `grep -rn "L3\.reltio\.json" src/` must return only `EnvironmentManager` constants. The two known strays (`uxState.ts:109`, `extension.ts:2045`) are called out as explicit tasks, and a unit test asserts the grep invariant. |
| Existing workspaces have environments under `.reltio/` while new ones land at the root, so a team ends up with both | Both are discovered and both work. Environments are never relocated, only newly created ones use the root. Documented in ARCHITECTURE.md. |
| Nested repositories inside the workspace confuse external tooling | Cosmetic and bounded: VS Code's Source Control panel handles nested repositories. Choosing the workspace root over `.reltio/` (D2) reduces the depth and takes them out of a hidden folder. |
| `git clone --branch` fails because the branch does not exist yet on a new remote | Offer to create it from the remote's default branch (D9), behind an explicit confirmation naming the branch and remote. On decline or failure the tenant folder is left empty rather than half-cloned. |
| Branch creation pushes to a remote the user may not have write access to | The `git push -u` failure is surfaced verbatim, the local branch is left in place, and the user is told the branch exists locally but was not published. No silent partial success. |
| Documentation URLs in generated READMEs rot as the docs site is restructured | The URL map is a single table in `tenantFolderStructure.ts`, so a link fix is one edit and no migration. A unit test asserts every unmanaged folder has a non-empty URL, catching an omission but deliberately not making the network a test dependency. |
| Folder names contain spaces (`Business Config`, `Custom Code`) | All path handling goes through `vscode.Uri.joinPath`, which encodes correctly. Git handles spaces in tracked paths. Any shell-out uses `execFile` with an argument array, never string interpolation, which the existing `gitConfigSource.ts` already does. |
| `history/` relocation breaks the History tree node and its `workspaceState` keys | The exposure key `reltio.history.exposed::<env>::<tenant>` is keyed on environment and tenant, not on a path, so it survives. Covered by Tier A and Tier C. |
| A user commits `.reltio-ide/` before the `.gitignore` is generated | The `.gitignore` is written at bind time, before the first fetch can produce any IDE state. Migration also writes it for migrated tenants. |
| Case-insensitive filesystems treat `BusinessConfig.json` and existing discovery inconsistently | `isBusinessConfigFile` is already case-insensitive. The component-tree resolver matches it. |

## Migration Plan

**Deploy:** Ships in a normal release. No server-side change, no new dependency.

**On first activation after upgrade, per tenant folder:**

1. Detect the legacy layout (an `L3.reltio.json` at the tenant root).
2. Skip if the folder is a Git repository with a dirty worktree, and report it.
3. Back up the legacy files outside the tenant folder.
4. Materialize the component tree with placeholders.
5. Move `L3.reltio.json` to `Business Config/BusinessConfig.json`, and baseline, layout and `history/` into `.reltio-ide/`.
6. Write the `.gitignore` entries.
7. Write the `workspaceState` stamp.
8. Refresh the tree, then show one non-blocking summary for the whole workspace.

**Rollback for a user:** `reltio.undoLayoutMigration` restores from the backup and clears the stamp.

**Rollback for the product:** an older extension build reads the legacy layout only. A user who downgrades after migrating runs `Undo Layout Migration` first, or restores from the backup manually. This is called out in the release note.

## Test plan

| Tier | Script / Method | What it covers |
|------|------------------|-----------------|
| A (automated) | `scripts/test-git-ready-tenant-folder-structure.cjs` | Component-tree definition materializes the exact 21 directories (18 declared leaf paths plus the implied `Workflows`, `User Management` and `Custom Code` parents); `README.md` written to every unmanaged folder and not to `Business Config/`; an existing `README.md` is not overwritten; re-materializing is non-destructive; every unmanaged folder has a non-empty `docs.reltio.com` URL in the map and the generated README contains it (map asserted offline, no network dependency). All five `EnvironmentManager` accessors resolve to the component-tree paths; `preferredEnvironmentUri` resolves to the workspace root; an environment already known under `.reltio/` keeps its location. Marker round-trip carries environment and tenant, and the tree label prefers the marker with folder-name fallback. `.gitignore` generation adds `.reltio-ide/` and the marker, preserves unrelated entries, and never duplicates. Migration plan computation maps each legacy file to its new path, omits absent files, is a no-op on an already-migrated folder, and is refused on a dirty worktree. Backup path resolves to `.reltio-ide-backup/{env}/{tenant}/` and the workspace-root `.gitignore` gains the entry without duplication. Stamp is not written on a simulated partial failure. Branch-creation flow builds the argument sequence clone-default, `checkout -b`, `push -u` and never `--orphan`; a declined confirmation issues no Git invocation. Grep invariant: no `L3.reltio.json` literal outside `EnvironmentManager`. |
| B (automated, fixture-derived) | same script, via `scripts/lib/load-canonical-fixture.cjs` and the self-oracle helpers | Parsing, `UriIndex` build, and tree-section derivation produce identical results whether the canonical fixture is loaded from a legacy path or from `Business Config/BusinessConfig.json`, proving the rename is inert for navigation, diagnostics and the config subtree. |
| C (manual QA) | Install the packaged `.vsix` | **New tenant:** add an environment (confirm it lands at the workspace root), add a tenant, confirm the full tree with READMEs. **Bind:** run **Connect Tenant to Git**, supply a remote and branch `dev`, confirm the clone and the branch badge in the tree. **Fetch:** confirm `Business Config/BusinessConfig.json` and that `git status` shows only that file. **Round trip:** commit, push, confirm the remote tree has no env/tenant in any path. **Second tenant:** bind to the same remote on `prod`, confirm the remote prompt is pre-filled and the branch prompt is not, confirm both tenants are visible at once and their tracked paths are identical. **Features:** Go-to-Definition, Find All References, diagnostics, completion, ontology preview and layout persistence, Fetch history, Compare with current, Apply Configuration to Tenant. **Branch creation:** connect a tenant to a branch that does not exist on the remote, confirm the creation prompt names the branch and remote, accept it, and confirm the branch is pushed and shares history with the default branch (a PR from it is possible). Decline the prompt on another tenant and confirm the folder is left empty. Point at a remote with no commits and confirm the empty-repository message. **README links:** open three generated READMEs and confirm each documentation link resolves on `docs.reltio.com`. **Migration:** open a pre-upgrade workspace with two legacy tenants, confirm automatic migration, the summary notification, the backup at `.reltio-ide-backup/{env}/{tenant}/`, that the workspace-root `.gitignore` excludes it, and that reopening does not re-migrate. **Migration refusal:** dirty the worktree of a legacy bound tenant, confirm it is skipped with a message and migrates on the next activation once clean. **Undo:** run **Undo Layout Migration**, confirm the legacy layout is restored. **Coexistence:** open a git-sourced workspace, confirm **Connect Tenant to Git** is absent and git mode is unchanged. **Detached HEAD:** check out a commit directly, confirm the tree renders without a branch and raises no error. |

## Open Questions

All three questions raised during design review are now resolved and folded into the decisions above:

- **Backup location** is `.reltio-ide-backup/{env}/{tenant}/` at the workspace root, gitignored. See D7.
- **Branch creation** is offered when the branch is absent on the remote, from the default branch rather than as an orphan, behind an explicit confirmation. See D9.
- **README documentation links** are included, sourced from a verified URL map in `tenantFolderStructure.ts`. See D10.

Remaining:

- Whether the backup should be pruned automatically after some period, or left for the user to delete. Current behaviour is to leave it, on the grounds that silently deleting a recovery artifact is worse than leaving a folder behind. Revisit if it proves to be clutter.
