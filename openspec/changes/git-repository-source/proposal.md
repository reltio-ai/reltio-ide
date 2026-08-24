## Why

Connecting to a live Reltio tenant is not the only way teams manage L3 metadata — some already keep it in a git repository (GitHub, Bitbucket, GitLab, Azure DevOps, or self-hosted). Today the extension has no way to browse or edit that config without a live tenant connection: there's no way to clone/detect a repo, discover its L3 file, and get the same tree/navigation/ontology experience the tenant flow provides. This change adds that second on-ramp (RP-189575), with git-native change tracking (VS Code's native Source Control panel) instead of tenant push/pull.

## What Changes

- Add a second welcome-view button, **"Connect your Repository"**, alongside the existing **"Connect your Reltio Tenant"**, shown only when the tree is empty.
- New `reltio.fetchConfigFromGit` command: detects an already-cloned repo (has `.git` + an `origin` remote) and skips straight through, or prompts for a remote URL and clones it directly into the open (empty) workspace folder via the system `git` executable — auth is entirely delegated to system git + the OS credential helper (e.g. Git Credential Manager), no custom OAuth flow.
- Discovers `L3.reltio.json` / `L3.json` in the repo (root first, then subfolders, depth-limited), auto-picking a single match, prompting via quick-pick for multiple matches, or falling back to a file-open dialog if none are found.
- `EnvironmentManager.setGitSource(...)` makes the existing tenant-mode tree/navigation/ontology pipeline treat the discovered L3 file as a synthetic environment/tenant — zero changes needed to the tree provider or navigation code.
- A new `reltio.workspaceSource` context key (`'tenant' | 'git' | undefined`) hides tenant-connectivity menu items (login, fetch/apply/history, add/remove tenant, etc.) once the workspace is git-sourced, while every local AST-editing command (insert/delete/rename types and attributes) stays available in both modes. Tenant and git modes are mutually exclusive per workspace.
- New **"Remove Repository"** command (`reltio.removeGitSource`), mirroring **"Remove Environment"**, shown only in git mode: deletes all files in the workspace folder and unlinks the git source, returning to the welcome screen.
- A small `.reltio-config-source.json` marker (gitignored) persists the discovered L3's location so later activations restore git mode without re-prompting.
- Deferred the extension's automatic `.reltio/reltio-agent/` asset sync until a mode (tenant or git) is actually chosen, so a freshly opened folder stays genuinely empty until the user decides — this was the root cause of a clone-into-nonempty-folder deadlock, since that folder was otherwise created on every activation regardless of workspace state.

## Capabilities

### New Capabilities
- `git-repository-source`: Clone-or-detect a git repository as an alternative L3 config source to a live Reltio tenant, with automatic L3 discovery, a synthetic tree environment/tenant, git-mode-aware menu gating, and a symmetric removal command.

### Modified Capabilities
- `environment-management`: An environment/tenant pair can now originate from a git repository instead of a live Reltio tenant connection. The two sources are mutually exclusive per workspace, and removal (`Remove Repository`) mirrors `Remove Environment` but deletes the folder's contents rather than just the tenant's local files.

## Impact

- **New files**: `src/workspace/gitConfigSource.ts` (system-git shell-out: detect/clone), `src/workspace/l3Discovery.ts` (L3 file search + naming), `src/workspace/gitSourceMarker.ts` (marker persistence + `.gitignore` entry)
- **Modified files**: `src/workspace/environmentManager.ts` (`setGitSource`/`clearGitSource` override on `scanEnvironments`/`getL3Uri`/`getLayoutUri`), `src/ux/uxState.ts` (`WorkspaceSource` type + `publishWorkspaceSourceContext`), `src/tree/multiTenantNodes.ts` (removed a stale "Open L3 to start editing" hint that never cleared correctly), `src/extension.ts` (activation-time mode detection/restore, the `reltio.fetchConfigFromGit` and `reltio.removeGitSource` commands, deferred agent-asset sync, sentinel-token auth-UX fix), `src/navigation/uriCompletionProvider.ts` (recognize `L3.json`), `package.json` (welcome-view button, two new commands, 23 menu `when`-clause guards, `jsonValidation` for `L3.json`)
- **Dependencies**: None new — uses the system `git` executable via Node's `child_process`, no `vscode.git` extension API dependency and no bundled git library.
- **Depends on**: `multi-tenant-tree-view` (the `EnvironmentManager`/tree pipeline this reuses)
