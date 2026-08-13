## 1. Design

- [x] 1.1 Brainstorm scope and lock decisions: clone target, mode-exclusivity scope, L3 discovery convention, git-mode tree shape, auth delegation approach, existing-repo detection, mode persistence (`docs/superpowers/specs/2026-07-13-git-config-source-design.md`)
- [x] 1.2 Write implementation plan with exact file/task breakdown (`docs/superpowers/plans/2026-07-13-git-config-source.md`)

## 2. Git CLI helper module

- [x] 2.1 Create `src/workspace/gitConfigSource.ts`: `isFolderEmpty`, `isGitRepo`, `getRemoteUrl`, `isGitRepoWithRemote`, `cloneRepository`, `GitNotFoundError` — all via `child_process.execFile` against the system `git` executable (resolved from the `git.path` VS Code setting, falling back to `git` on `PATH`)
- [x] 2.2 Map `ENOENT` from a failed clone to a friendly `GitNotFoundError` message

## 3. L3 discovery module

- [x] 3.1 Create `src/workspace/l3Discovery.ts`: `discoverL3Files` — depth-limited (3) recursive search for `L3.reltio.json` / `L3.json`, skipping dotfolders
- [x] 3.2 `deriveTenantNaming`: environment name = repo folder name, tenant id = L3's parent folder name or `"default"` at repo root
- [x] 3.3 Make `deriveTenantNaming` self-contained (pure function of its `root`/`l3Uri` arguments, no dependency on global `vscode.workspace` state) — code-quality fix

## 4. Git-source marker persistence

- [x] 4.1 Create `src/workspace/gitSourceMarker.ts`: `GitSourceMarker` interface, `readGitSourceMarker` (fail-safe, validates shape), `writeGitSourceMarker`
- [x] 4.2 `writeGitSourceMarker` also ensures `.reltio-config-source.json` is listed in the repo's `.gitignore` (creating it if missing, skipping if already present, CRLF-safe)

## 5. `EnvironmentManager` git-source override

- [x] 5.1 Add `setGitSource(...)` / `clearGitSource()` and a private `gitSource` field to `src/workspace/environmentManager.ts`
- [x] 5.2 Override `scanEnvironments()` to return a single synthetic environment/tenant when `gitSource` is set
- [x] 5.3 Override `getL3Uri()` and `getLayoutUri()` to resolve to the git-discovered file/sidecar when the environment/tenant names match

## 6. `workspaceSource` context key

- [x] 6.1 Add `WorkspaceSource` type (`'tenant' | 'git' | undefined`) and `publishWorkspaceSourceContext` to `src/ux/uxState.ts`

## 7. Welcome-view button and command declaration

- [x] 7.1 Add a second `viewsWelcome` link ("Connect your Repository") alongside "Connect your Reltio Tenant", same `G_EMPTY` gating
- [x] 7.2 Register `reltio.fetchConfigFromGit` in `package.json` `commands`

## 8. Menu gating

- [x] 8.1 Append `&& reltio.workspaceSource != 'git'` to 23 tenant-connectivity `when` clauses (login/config, token entry, add/remove environment/tenant, copy tenant id, fetch/apply/history, the setup-wizard button) across `view/item/context` and `view/title`
- [x] 8.2 Leave every AST-editing command (insert/delete/rename/reveal/ontology) unconditional in both modes
- [x] 8.3 Fix an operator-precedence bug: `configureOAuthClient`'s pre-existing `A || B` clause needed parenthesizing to `(A || B) && guard` before appending the guard, otherwise `&&` binding tighter than `||` silently bypassed the guard for the `A` branch

## 9. Activation-time mode detection

- [x] 9.1 Add `tryRestoreGitSource(...)`: validates a previously-written marker + still-a-git-repo + still-existing L3 file, then calls `setGitSource(...)`
- [x] 9.2 Add `workspaceSource` closure variable + `setWorkspaceSource()` helper; determine mode at activation (real tenant folders → `'tenant'`, else git-source restore → `'git'`, else `undefined`)
- [x] 9.3 Auto-sync `workspaceSource` to `'tenant'` from inside `refreshUxState()` (guarded against ever downgrading git mode) instead of a scattered one-off call site, so every path that creates the first tenant environment (Setup Wizard, SSO auto-add, `addEnvironment`) is covered uniformly

## 10. `reltio.fetchConfigFromGit` command

- [x] 10.1 Detect already-tracked repo (has `.git` + remote) → skip cloning; else prompt for URL, verify the folder is empty, clone via `cloneRepository`
- [x] 10.2 Discover L3 candidates: auto-select single match, quick-pick multiple matches, file-open-dialog fallback for zero matches
- [x] 10.3 Persist the git-source marker, call `setGitSource(...)`, register a sentinel token, flip `workspaceSource` to `'git'`, refresh the tree
- [x] 10.4 Guard against hijacking an existing tenant workspace: early-return with an error if `workspaceSource === 'tenant'` (closes a real gap — the command has no Command Palette `enablement`, so this is the only thing preventing a tenant workspace with a git remote from being silently flipped into git mode)
- [x] 10.5 Guard against concurrent invocation with an in-flight boolean, so a second invocation while one is running is rejected instead of racing two clones into the same directory

## 11. `L3.json` as a first-class filename

- [x] 11.1 Broaden the "opened at least once" bookkeeping check to recognize `L3.json` alongside `L3.reltio.json`
- [x] 11.2 Broaden `RELTIO_SELECTOR` to a `DocumentSelector` array covering both patterns (go-to-definition, find-references, document links, completion registration)
- [x] 11.3 Broaden `isReltioDocument` (gates live diagnostics + index rebuilds) to exact-basename-match `L3.json`
- [x] 11.4 Broaden `package.json`'s `jsonValidation.fileMatch` to `["*.reltio.json", "L3.json"]`
- [x] 11.5 Broaden `onL3DocumentChanged` (tree refresh on edit) to also match `L3.json`
- [x] 11.6 Fix the internal guard in `src/navigation/uriCompletionProvider.ts` that still hardcoded `.reltio.json` only, leaving URI completion broken for `L3.json` even though the provider's registration was already broadened

## 12. Git-mode auth UX

- [x] 12.1 Register a sentinel token (`tokenStore.setToken(environmentName, '__reltio-git-source__')`) alongside every `setGitSource(...)` call site, so the existing `deriveUxState` auth-state derivation reaches `E_READY`/`G_READY` for the synthetic environment instead of a lock icon / "Sign in required" dead end
- [x] 12.2 Verify (by tracing `deriveGlobal`) that the sentinel token is never reachable as a real bearer token — every command that would send it over HTTP is already hidden by the Task 8 menu guards

## 13. Type-check and build

- [x] 13.1 `npm run compile` clean after every task
- [x] 13.2 `npm run build` clean after the command-registration and package.json tasks
- [x] 13.3 `npm run package` produces a valid `.vsix`

## 14. Bugfix round — user testing feedback

- [x] 14.1 `.reltio-config-source.json` gitignored (folded into 4.2 above once flagged)
- [x] 14.2 Add `reltio.removeGitSource` ("Remove Repository") command: mirrors `Remove Environment` but for git-sourced workspaces — deletes every file in the workspace folder, then clears `EnvironmentManager`'s git source, the sentinel token, and `workspaceSource` even on a partial deletion failure (state-clearing happens in a `finally`, so the tree never points at a stale git source over a half-emptied folder)
- [x] 14.3 Diagnose and fix the `.reltio/reltio-agent/` clone-deadlock: root-caused by deferring `syncReltioAgentAssets` until `workspaceSource` is no longer `undefined`, instead of running it unconditionally on every activation; kept the `isFolderEmpty`-ignores-`.reltio` check and the move-aside/restore around the actual `git clone` call as a defensive fallback
- [x] 14.4 Fix a cross-device rename risk in the move-aside fallback: the temp location must be a same-volume sibling of the workspace root, not the OS temp directory (which can be a different drive on Windows and would silently fail the rename, reintroducing the exact deadlock being fixed)
- [x] 14.5 Environment naming: briefly hardcoded to a fixed `"Reltio"` label per a misread request, then reverted back to the repo folder name once clarified
- [x] 14.6 UI relabeling: welcome-view button and command title "Fetch Config from Version Control System" → "Connect your Repository"; "Remove Fetched Configuration" → "Remove Repository" (command title, confirmation dialog, and result messages)
- [x] 14.7 Remove the "Open L3 to start editing" tenant-row description entirely — first scoped to git-sourced tenants only (via a `refreshUxState` override forcing `T_READY`), then removed universally for tenant-mode workspaces too, per follow-up feedback

## 15. Documentation and automated test coverage

- [x] 15.1 Update `README.md` (feature bullet, getting-started step, git requirement), `docs/setup-guide-content.md` + `resources/setupGuide.json` (new Step 6, kept in sync since the webview reads the JSON), the `package.json` walkthrough (mirrors Step 6, `featuredFor` includes `L3.json`), and `ARCHITECTURE.md` (domain concepts, package structure, two new command rows, language-feature scope note, system-`git` dependency row)
- [x] 15.2 Add `scripts/test-git-repository-source.cjs` and register it in `scripts/run-unit-tests.cjs`, per this repo's "every new OpenSpec change gets a test script" rule — covers `deriveTenantNaming`, `discoverL3Files`, `isFolderEmpty`, `gitSourceMarker` round-trip/fail-safe/`.gitignore` side effect, and the `EnvironmentManager` git-source override at Tier A; extended `scripts/lib/vscode-stub.cjs` with a minimal `Uri.with(...)` (needed by `getLayoutUri`'s git-source branch, not previously exercised by any test)
- [x] 15.3 `npm test` passes (one pre-existing, unrelated failure in `test-skills-and-enablement-packs-library.cjs` confirmed present on the pre-change baseline too)

## 16. Bugfix round — CodeRabbit PR review (9 actionable findings)

- [x] 16.1 `gitConfigSource.ts`: add a 5-minute `timeout`/`killSignal` to the `cloneRepository` `execFile` call, mapping a timeout to a clear error instead of hanging indefinitely
- [x] 16.2 `gitConfigSource.ts`: add `.DS_Store`, `Thumbs.db`, `desktop.ini` to `IGNORED_FOR_EMPTINESS` alongside `.reltio`
- [x] 16.3 `gitConfigSource.ts`: `isFolderEmpty` now treats "folder doesn't exist yet" as empty but propagates any other read error (permissions, I/O) instead of returning `true`; `reltio.fetchConfigFromGit` catches and surfaces that error
- [x] 16.4 `gitConfigSource.ts`: add `isPathContainedIn(root, candidate)` — applied in the manual file-picker fallback (rejects a pick outside the workspace root) and in `tryRestoreGitSource` (rejects a marker whose `l3RelativePath` resolves outside `workspaceRoot`)
- [x] 16.5 `l3Discovery.ts`: add `isParsableL3File(uri)` (strict JSON, not JSONC-tolerant — see design.md D10) — applied to every path that leads to `setGitSource` (single-match, quick-pick, file-dialog, and the activation-time restore)
- [x] 16.6 `extension.ts` `reltio.removeGitSource`: delete loop tries `useTrash: true` per entry first, falls back to `useTrash: false` only for that entry if the trash attempt throws (see design.md D11 for why a straight switch to `useTrash: true` was rejected)
- [x] 16.7 `reltioAutoSave.ts`: both blur-save and editor-switch-save now recognize exact-basename `L3.json` alongside `.reltio.json`
- [x] 16.8 `openspec/.../environment-management/spec.md`: added scenarios making the existing confirmation-dialog and OS-trash-preference behavior explicit in the requirement text (the code already did this; the spec didn't say so)
- [x] 16.9 Markdown heading-level lint nit (MD001) on `docs/superpowers/plans/2026-07-13-git-config-source.md` intentionally left unfixed — that file is a frozen historical planning record, not living documentation
- [x] 16.10 Extended `scripts/test-git-repository-source.cjs`: `isFolderEmpty` OS-artifact ignoring + FileNotFound-vs-real-error propagation, `isPathContainedIn` boundary check (sibling-prefix false positive), `isParsableL3File` (valid/JSONC/garbage/missing). `npm test` passes (same one pre-existing, unrelated failure as before).
