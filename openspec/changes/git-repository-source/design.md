## Context

The extension's only on-ramp today is connecting to a live Reltio tenant: `EnvironmentManager` scans `*.reltio.environment/*.reltio.tenant/` folders, fetches L3 via the REST API, and the tree/navigation/ontology pipeline all key off that convention. Some teams already keep their L3 metadata in a git repository instead of (or as a staging step before) a live tenant. There was no way to point the extension at that repository directly.

A separate, unrelated branch (`RP-189575-git-integration`) previously explored the *opposite* direction — after pulling config from a tenant, offer to `git init` the local folder and add a remote. That work is untouched by this change.

## Goals / Non-Goals

**Goals:**
- Let a user clone (or point at an already-cloned) git repository and have its L3 file drive the same tree/navigation/ontology experience a tenant connection provides.
- Reuse the existing tenant-mode pipeline with minimal new code — no forked tree provider, no duplicated navigation logic.
- Keep tenant and git modes mutually exclusive per workspace, with menu items scoped correctly to each.
- Delegate all git auth to the system's git installation and credential helper — no bespoke OAuth device-code flow per provider.
- Support both `L3.reltio.json` and `L3.json` as recognized filenames, and make sure *every* navigation/diagnostics/schema feature actually covers both, not just the tree.

**Non-Goals:**
- No support for switching an existing workspace between tenant mode and git mode — switching means opening a different/new folder.
- No content-sniffed discovery of arbitrarily-named config files — name-based search only (`L3.reltio.json` / `L3.json`).
- No custom OAuth device-code flow for git providers.
- No custom auto-commit/push automation — staging, commits, and pushes stay in VS Code's native Source Control panel.
- No `enablement`/Command Palette gating beyond the runtime guard in the command handler (menu-level gating plus a `workspaceSource === 'tenant'` early-return is judged sufficient; a determined Command Palette invocation against a real tenant workspace is refused, not silently hijacked).

## Decisions

### D1 — Shell out to the system `git` executable, not the `vscode.git` extension API

**Choice:** Use Node's `child_process.execFile` to run `git clone`/`git remote`, resolving the executable via the `git.path` VS Code setting (falling back to `git` on `PATH`).

**Rationale:** The brainstorming decision was "clone directly into the currently-open, empty folder." VS Code's built-in `git.clone` command (backed by the `vscode.git` extension API) always clones into a *new subfolder* named after the repo — it cannot target an already-open folder directly. Shelling out to `git clone <url> .` with `cwd` set to the open folder achieves the same auth delegation (system git + its credential helper, e.g. Git Credential Manager, handles browser-based login when credentials aren't cached) without that limitation, and avoids a dependency on the bundled git extension being enabled.

**Alternative considered:** Drive cloning through `vscode.git`'s `API.clone`/`git.clone` command — rejected because it can't target an already-open folder without creating a subfolder.

### D2 — `EnvironmentManager.setGitSource(...)` as the sole integration seam

**Choice:** Add an optional git-source override directly inside `EnvironmentManager`. Once set, `scanEnvironments()`, `getL3Uri()`, and `getLayoutUri()` describe the one discovered L3 file as a synthetic environment/tenant. Every other consumer (tree provider, navigation providers, ontology view, AST-edit commands) calls these same methods and needs zero changes.

**Rationale:** `EnvironmentManager` is already the single source of truth every other layer goes through. Redirecting it transparently is far less invasive than forking the tree provider or teaching it about two data sources.

**Trade-off accepted:** Tenant-mode-only mutators (`getRemoteBaselineUri`, `getTenantRootUri`, `getHistoryDirectoryUri`, and the create/remove/write helpers) are **not** git-mode-aware at the class level — they still compute paths under the `*.reltio.environment/*.reltio.tenant/` convention if called while git-sourced. Safety is enforced entirely by `package.json` menu gating (D4) hiding every command that would reach them, not by the class refusing to do so. This was a deliberate choice to avoid widening `EnvironmentManager`'s surface further; revisit if a new caller ever reaches those methods outside the gated menu paths.

### D3 — Sentinel token for git-mode auth-state derivation

**Choice:** When `setGitSource(...)` is called, also register a sentinel value (`tokenStore.setToken(environmentName, '__reltio-git-source__')`) for that synthetic environment name.

**Rationale:** The existing `deriveUxState`/`deriveGlobal` auth-state machine (built for live tenants) keys off `tokenStore.hasToken(env)`. Without a token, a git-sourced environment rendered a lock icon, "Sign in to continue," and a dead-end "Reltio: Sign in required" status bar item pointing at a login flow that's hidden by menu gating in git mode. Registering a sentinel token makes the existing derivation naturally reach `E_READY`/`G_READY`, with zero changes to `deriveUxState`, `EnvironmentNode`, or the status bar.

**Safety:** The sentinel is never sent as a real bearer token — every command that would use it in an HTTP call (`fetchL3`, `applyL3Configuration`, `fetchConfigurationHistory`, etc.) is hidden from the UI by the same `reltio.workspaceSource != 'git'` menu guards (D4). A Command Palette invocation of one of those against the synthetic environment name would fail on a harmless DNS/network error, not leak anything.

### D4 — `reltio.workspaceSource` context key drives menu gating; mutual exclusivity is structural, not a separate guard

**Choice:** A new, independent context key (`reltio.workspaceSource`, alongside the existing `reltio.uxState`) is published whenever the mode is determined or changes. 23 `view/item/context` / `view/title` entries for tenant-connectivity commands get `&& reltio.workspaceSource != 'git'` appended to their existing `when` clauses. AST-editing commands are left unconditional in both modes.

**Rationale:** Mutual exclusivity falls out of existing state machinery rather than a bespoke guard: the "Connect your Reltio Tenant" / "Connect your Repository" welcome-view buttons only show at the empty-tree ux state (`G_EMPTY`), so once either mode is entered, both buttons disappear together.

**Correction made during implementation:** one guarded clause (`configureOAuthClient`) had a pre-existing top-level `||` in its `when` expression. Appending `&& guard` without parenthesizing produced `A || (B && guard)` (VS Code `when`-clause `&&` binds tighter than `||`), silently bypassing the guard for the `A` branch. Fixed by parenthesizing the original expression: `(A || B) && guard`.

### D5 — L3 discovery: exact filenames, depth-limited, root-first

**Choice:** Search for files named exactly `L3.reltio.json` or `L3.json`, skipping dotfolders, to a fixed depth (3). Zero matches → file-open dialog fallback. Multiple matches → quick-pick.

**Rationale:** Matches the brainstorming decision to keep discovery name-based rather than content-sniffed. `L3.json` is one of the two explicitly-supported names, so it must get full first-class treatment everywhere the extension recognizes a config file — not just in discovery and the tree (see D7).

### D6 — Environment/tenant naming: repo folder name and L3's parent folder

**Choice:** The synthetic environment is named after the repository's own folder name (not a fixed "Reltio" label — that was tried and reverted per user feedback); the tenant id is the L3 file's parent folder name, or `"default"` if it sits at the repo root.

**Rationale:** Preserves a meaningful, per-repo distinguishing label in the tree, consistent with how real tenant-mode environments are named after their host.

### D7 — `L3.json` must be a first-class citizen everywhere, not just in discovery

**Choice:** Broadened `RELTIO_SELECTOR` (go-to-definition, find-references, URI completion, document links), `isReltioDocument` (live diagnostics, index rebuilds), the `jsonValidation` schema contribution, `onL3DocumentChanged` (tree refresh), and the internal guard inside `uriCompletionProvider.ts` to recognize `L3.json` by exact basename, alongside the existing `.reltio.json` suffix match.

**Rationale:** A final whole-feature review found several of these hardcoded to `.reltio.json` only, silently degrading the editing experience (no schema validation, no navigation) for a git-sourced repo using the `L3.json` name — an integration-level gap invisible to any single task's review.

### D8 — Don't auto-create `.reltio/reltio-agent/` before a mode is chosen

**Choice:** Defer `syncReltioAgentAssets` (which creates `.reltio/reltio-agent/` with synced Cursor Agent skills/Velocity Packs) until `reltio.workspaceSource` actually becomes `'tenant'` or `'git'`, instead of running it unconditionally on every activation.

**Rationale:** That folder was created before the user ever chose a mode, which made a freshly-opened, otherwise-empty folder look non-empty to the clone-precondition check in `reltio.fetchConfigFromGit` — a permanent deadlock, since the folder would be recreated on every reload. Root-causing this (not creating the folder prematurely) is simpler and more robust than only working around its presence.

**Defense in depth kept anyway:** `isFolderEmpty` also ignores a literal `.reltio` entry when deciding "empty enough to clone into," and the clone step itself moves `.reltio/` aside to a **same-volume sibling folder** (not the OS temp directory, which can be a different drive on Windows and would silently reintroduce the deadlock via a failed cross-device rename) before invoking `git clone`, then restores it. This stays in place as a fallback for any other reason `.reltio/` might already exist (e.g. a prior session in the same folder).

## Test Plan

**Automated** (`scripts/test-git-repository-source.cjs`, registered in `scripts/run-unit-tests.cjs`, run via `npm test`):

| Tier | Coverage |
|------|----------|
| A | `deriveTenantNaming` (repo-root vs. nested L3 → environment/tenant naming); `discoverL3Files` (depth-limit and dotfolder-skip rules, via an in-memory fake directory tree); `isFolderEmpty` (`.reltio` and OS artifacts `.DS_Store`/`Thumbs.db`/`desktop.ini` ignored, a real read error propagates rather than being treated as "empty", a missing folder is treated as empty); `isPathContainedIn` (boundary check — a sibling folder with a matching string prefix, e.g. `/repo` vs. `/repo-evil`, must not be treated as contained); `isParsableL3File` (valid JSON passes, JSONC-with-comments and garbage both fail — strict, not tolerant, since this gates *adopting* a new source); `gitSourceMarker` read/write round-trip, the `.gitignore` side effect (created once, not duplicated on a second write), and fail-closed behavior on malformed/missing marker JSON; `EnvironmentManager`'s git-source override (`scanEnvironments`/`getL3Uri`/`getLayoutUri` for a matching vs. non-matching environment/tenant pair, and `clearGitSource` reverting to the empty scan) |
| B | None specific to this change beyond the existing schema/manifest structural checks |
| C (manual) | Real `git clone`/`git remote` invocation (system git + credential helper prompt, including the 5-minute clone timeout on a genuinely stalled transfer); full Extension Development Host flow — empty folder → Connect your Repository → clone → tree populates → tenant menus hidden; already-cloned-repo skip-straight-through restore on reactivation; multiple/zero L3 candidates (quick-pick / file-dialog fallback, including picking a file outside the workspace root and confirming it's rejected); Remove Repository deletion (confirmation, OS-trash-then-permanent-delete-fallback) and welcome-screen return; the `.reltio/` move-aside/restore around a real clone on Windows (same-volume rename, not `os.tmpdir()`); real tenant workspace regression check (menus, status bar, "Connect your Reltio Tenant" all unaffected) |

`child_process.execFile`-based git invocation (`cloneRepository`, `getRemoteUrl`) and any GUI-driven flow are intentionally left to Tier C — no test script here mocks `child_process` or drives a live Extension Development Host, consistent with how `reltioClient`'s REST calls are exercised manually elsewhere in this repo.

## Risks / Trade-offs

- **Git not installed / not on `PATH`** → `cloneRepository` maps the `ENOENT` failure to a `GitNotFoundError` with an actionable "install Git" message rather than a raw error.
- **Clone into a non-empty folder** → rejected up front with a clear message asking for an empty folder; no partial/silent subfolder cloning.
- **Cross-device rename (Windows)** → the `.reltio/` move-aside target is a sibling of the workspace root (same volume), not the OS temp dir, specifically to avoid `EXDEV` rename failures.
- **Concurrent invocation of `reltio.fetchConfigFromGit`** → guarded by an in-flight boolean; a second invocation while one is running is rejected with a warning instead of racing two clones into the same directory.
- **Command Palette hijack of a real tenant workspace** → `reltio.fetchConfigFromGit` early-returns with an error if `workspaceSource === 'tenant'`, so an ungated Command Palette invocation against a workspace that already has a connected tenant cannot silently flip it into git mode.
- **Partial deletion during "Remove Repository"** → git-source state (environment, sentinel token, `workspaceSource`) is cleared in a `finally` block even if the file-deletion loop throws partway, so the tree never points at a stale git source over a half-emptied folder.
- **Cosmetic-only limitation, accepted:** the "opened at least once" bookkeeping key is built from the tenant-mode folder convention and can never match a git-sourced L3's real path. This no longer surfaces as visible text (the "Open L3 to start editing" hint was removed entirely, for both tenant and git modes), so the residual effect is limited to an internal state value with no user-visible consequence.

## Bugfix Round — CodeRabbit PR review

A CodeRabbit review of the PR raised 9 actionable findings. Resolutions:

### D9 — Clone timeout, folder-emptiness hardening, and path-escape guards

**Choice:** `cloneRepository` now passes a 5-minute `timeout`/`killSignal` to `execFile`, mapping a timeout to a clear error instead of hanging indefinitely (a stalled network transfer or a credential prompt the user will never see, e.g. in a headless remote session, previously had no way to resolve). `IGNORED_FOR_EMPTINESS` (the `.reltio`-ignoring emptiness check) now also ignores `.DS_Store`/`Thumbs.db`/`desktop.ini` — OS-generated artifacts that can appear just from viewing a brand-new folder in a file browser, not user content. `isFolderEmpty` now distinguishes "folder doesn't exist yet" (safe — git will create it) from any other read failure (permissions, I/O), which is propagated rather than silently treated as "empty" — the caller (`reltio.fetchConfigFromGit`) now surfaces that error instead of authorizing a clone into an unknown state.

**Rationale:** All three were real gaps: an unbounded clone, a stricter-than-necessary emptiness check that could confuse a user with an untouched folder, and a safety check that failed open on error — exactly the kind of "looks safe, isn't" bug this feature's own move-aside/restore logic was designed to avoid elsewhere.

### D10 — Path containment and JSON sanity checks before trusting a config source

**Choice:** A new `isPathContainedIn(root, candidate)` helper rejects any L3 path that resolves outside the workspace root — applied to the manual file-picker fallback (the one path where the user can navigate anywhere on disk, since `showOpenDialog`'s `defaultUri` only sets the *starting* location, it doesn't restrict the selection) and to `tryRestoreGitSource`'s marker-driven restore (a stale or tampered marker's `l3RelativePath` could otherwise resolve outside `workspaceRoot` after `Uri.joinPath`, which normalizes `..` segments). A new `isParsableL3File(uri)` requires the chosen/restored file to be strict, valid JSON before it's trusted as a source — deliberately **not** full schema validation (a work-in-progress L3 that doesn't yet fully conform to the schema is still legitimate to open) and deliberately **not** JSONC-tolerant (jsonc-parser's error recovery is lenient enough that it still returns a parse tree for genuinely broken content, so it isn't a useful gate; a file being *adopted* as a new source is expected to be clean output, unlike an already-open document a user might be mid-editing with comments).

**Rationale:** This closes a path-traversal gap that was identified and deliberately deferred during the original design review (see the now-resolved "Marker auto-trust + path traversal" note from that pass) — CodeRabbit's review re-surfaced it as a Security/Major finding, which was the right prompt to actually fix it rather than continue deferring.

### D11 — Recoverable deletion for Remove Repository, with a permanent-delete fallback

**Choice:** The delete loop in `reltio.removeGitSource` now tries `useTrash: true` per entry first (recoverable via the OS trash/recycle bin), and only falls back to `useTrash: false` for that specific entry if the trash attempt throws.

**Rationale:** CodeRabbit flagged the original `useTrash: false` as removing the only safety net beyond the confirmation dialog. A straight switch to `useTrash: true` was rejected on its own — `vscode.workspace.fs.delete`'s trash support is inconsistent on network drives and some remote/WSL setups, and unconditionally requiring it risked turning a working permanent-delete into a failing operation on those setups, and could be markedly slower for a git repository's file count. The per-entry try-trash-then-fall-back gets the recoverability benefit where the filesystem supports it, without regressing reliability where it doesn't.

**Also addressed:** `reltioAutoSave.ts` now recognizes exact-basename `L3.json` alongside `.reltio.json` for both blur-save and editor-switch-save (this was Open Question #2 below, now resolved); the `openspec/.../environment-management/spec.md` requirement for Remove Repository now explicitly states the confirmation and OS-trash-preference behavior the code already had, since the review correctly noted the spec text didn't say so.

## Migration Plan

No migration required — this is a purely additive on-ramp. Existing tenant-mode workspaces are unaffected; `reltio.workspaceSource` derives to `'tenant'` for them exactly as before, since the pipeline changes are all additive to `EnvironmentManager`/`uxState.ts` and guarded by `workspaceSource`.

## Open Questions

- Should `reltio.fetchConfigFromGit` and the other git-mode-only commands also get `enablement`/`commandPalette` `when` clauses, for defense-in-depth beyond the runtime guard? Deferred as a minor hardening item, not blocking.
- Should `quickSwitch.ts` be extended to cover `L3.json` the same way navigation/diagnostics/schema/auto-save were? Flagged in final review as lower-priority, not yet addressed. (`reltioAutoSave.ts` was resolved in the CodeRabbit bugfix round — see D9-D11.)
- A Markdown-lint nit (heading level, MD001) was flagged against `docs/superpowers/plans/2026-07-13-git-config-source.md` — that file is a frozen historical planning record, not living documentation, so it was intentionally left as-is rather than revised after the fact.
