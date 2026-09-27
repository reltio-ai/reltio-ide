# Design (DRAFT — iterating) — custom-workflow-repository

> Status: **draft for discussion**, not yet a committed proposal. No `proposal.md`/`tasks.md` yet — those get written once the decisions below are actually decided rather than proposed. This file exists to converge on the user flow, the UX, and the implementation shape before any code is touched.

## 0.1 — UPDATE: Snehil's branch is now reachable and changes D1/D3/D4/D6 below

`origin/RP-200851-git-ready-tenant-folder-structure` (based on `main`, 15 commits, its own full openspec change `git-ready-tenant-folder-structure`) is pushed and reviewed in full. Summary of what it actually does, and exactly how it lands on this change:

- Every tenant folder now materializes a **fixed component tree** on creation: `Business Config/`, `RDM/`, `Workflows/BPMN/`, `Workflows/Custom Workflows/` — five directories, three of them (`RDM`, `Workflows/BPMN`, `Workflows/Custom Workflows`) shipped as **empty placeholders with a generated `README.md`**, explicitly because "The IDE does not currently fetch or apply them" — i.e. **`Workflows/Custom Workflows/` is a folder Snehil deliberately reserved for this change**, not a coincidence.
- `L3.reltio.json` is renamed to `Business Config/BusinessConfig.json`. IDE-owned working state (baseline, ontology layout, history) moves to a sibling `.reltio-ide/` folder, out of the tracked tree.
- **The tenant folder itself becomes the Git repository root** (not a nested subfolder). A new command, `reltio.connectTenantToGit`, prompts for a remote URL (remembered per workspace) and a branch (asked every time, picked from the remote's existing branches or created fresh), then either clones straight in (empty tenant folder) or adopts a branch under an already-fetched tenant's files via a **mixed** `reset` that never touches the working tree.
- Identity (environment name, tenant id) moves into the already-existing `.reltio-config-source.json` marker (generalized from the git-config-source marker), read by the tree with folder-name fallback. `EnvironmentManager`'s five path accessors (`getL3Uri`, `getRemoteBaselineUri`, `getLayoutUri`, `getHistoryDirectoryUri`, `getTenantRootUri`) all move to component-tree paths.
- Existing tenants migrate automatically on activation (backed up, guarded by a dirty-worktree check, undoable).

**What this means for this change, concretely:**

- **D1 (where the repo clones to) is superseded, not just provisional.** There's no need for a bespoke `workflow-repo/` subfolder, a bespoke clone command, or a bespoke `WorkflowRepo.reltio.json` marker (D2/D3 below) — `reltio.connectTenantToGit` already does exactly the clone/bind/marker/`.gitignore` mechanics this change was about to reinvent. Reuse it.
- **D4 (BPMN discovery) gets simpler, not harder.** Instead of an arbitrary depth-10 scan of a customer-structured repo, the search root is now a fixed, known path: `Workflows/Custom Workflows/` (and, separately, `Workflows/BPMN/` — see the open question below) relative to the tenant folder. Content-driven identification (`<process id>` via `extractProcessModel()`, not filename) still stands — a customer's own file-naming inside that folder is still not ours to control.
- **D6 (deploy-from-repo context resolution) gets simpler too.** "Walk up to the nearest `{tenant}.reltio.tenant` ancestor" is still the right idea, but the target is now a well-known subpath under that ancestor, not an arbitrary nested clone location.
- **Part 2 (already-shipped, on `feature/workflow-authoring`) has a real, unplanned collision.** Drafts currently write to `{tenantId}.reltio.tenant/workflows/{processId}.bpmn20.xml` — a path Snehil's branch has never heard of and doesn't create. His new `Workflows/BPMN/` placeholder folder is suspiciously exactly where Drafts *should* live post-rebase (the product's own framing already splits "self-service BPMN, no Java" from "Java-backed, needs the repo," which maps cleanly onto `BPMN/` vs. `Custom Workflows/`). **This needs confirming, not assuming** — see open question #1 below.
- **Rebase risk is real and large, not hypothetical.** Both branches independently touch `src/extension.ts` (1949 insertions on `feature/workflow-authoring` vs. 502 on his), `src/workspace/environmentManager.ts` (the exact same five accessors, on both sides), `src/tree/multiTenantTreeProvider.ts`, `src/tree/multiTenantNodes.ts`, and `package.json`. Neither branch is aware of the other. This is a substantial, hands-on rebase, not a fast-forward.
- **RESOLVED (2026-09-27): it is a second, distinct remote.** Confirmed directly, not inferred. The Reltio-provisioned Bitbucket repository for custom workflows is a separate repository from whatever a customer binds via `reltio.connectTenantToGit` for Business Config promotion. This revives D3 (a marker sidecar is needed after all — there is a second binding Snehil's own marker knows nothing about) and adds a new hazard that D1 has to account for: **a repository nested inside a repository**, the mirror image of the "repository above the tenants" case Snehil's own design already treats as something to defuse, not build on. See the rewritten D1/D3 below, and the new D10.

The rest of this file (§1–§6 below) is the **pre-discovery draft**, kept for its user-flow/UX/JAR-registration reasoning, which mostly still holds — D1–D6, D10 and D11 below are the current, decided versions; §4's open questions are now resolved and kept only as a record of how each was closed.

## 0. What this change actually is — scoped precisely, not guessed

Two earlier changes already shipped and are sitting on the local `feature/workflow-authoring` branch (11 commits, unpushed, no PR yet):

| Already shipped | Where |
|---|---|
| Read-only Workflow Inspector — list Process Definitions + JAR Deployments, view BPMN XML | `workflow-inspector` |
| BPMN authoring — create/duplicate/edit/deploy **drafts** to a tenant, visual diagram + diagnostics | `workflow-authoring` |
| **JAR discovery + registration** — `listAvailableJars()`, `registerJarDeployment()` (`POST /{tenantId}/jarDeployments`), the **Unregistered** subfolder, `reltio.refreshJarDeployments` / `reltio.registerJarDeployment` / `reltio.copyJarModulePath` | Landed inside the `workflow-adapter-url-registry` commit (`7124df3`), with **no dedicated openspec proposal** — flagged below as a documentation gap, not a code gap |

`workflow-authoring`'s own proposal explicitly deferred three things to *this* change: **"Connecting the Bitbucket repository, registering JARs, checking for new builds."** Of those three, JAR registration and "checking for new builds" (the Unregistered-JAR discovery) are, in practice, **already done** by the table above. Verified by `grep -r Bitbucket src/` → zero results, and no `openspec/changes/custom-workflow-repository/` folder existed before this file.

**So the actual remaining scope of this change is narrower than the original framing:**

1. Connect the tenant's Bitbucket workflow repository to the workspace (clone it in).
2. Make its BPMN files visible/browsable, and make it obvious whether a given BPMN in the repo agrees with what's deployed on the tenant (the "sync badge" promised in the Feature Enablement Guide).
3. Let a BPMN file that lives in the connected repo be deployed straight to the tenant, not only files under the existing Drafts convention.
4. Wire steps 5–6 of the already-written `workflow-repo-contribution` skill (PR → CI → JAR on S3 → Refresh JARs → Register JAR) to something real instead of a manual `curl`/console round trip — mostly already true once (1) exists, since Refresh/Register JAR are already built.

Everything else — the Bitbucket PR itself, Reltio's review, Reltio's CI building the JAR — happens **outside** this extension and is explicitly out of scope, same as it already is for `git-repository-source`.

---

## 1. User flow (end to end)

Precondition: **Tenant mode only.** The repository is tenant-scoped (Reltio provisions one Bitbucket repository per tenant — confirmed by the existing `workflow-repo-contribution` skill's wording, "the tenant's Bitbucket repository", singular). Git mode has no tenant id and no Workflow Adapter URL to call, so this whole feature is inert there — consistent with the mode-separation diagram already in the Feature Enablement Guide.

1. Customer has a tenant connected and has run **Fetch Workflows** at least once (existing `workflow-inspector` flow) — Workflows folder shows Process Definitions / JAR Deployments.
2. A new row, **Custom Workflow Repository**, appears under the tenant's `Workflows` folder, showing **"Not connected."**
3. Right-click it (or use the row's own click target, matching how `WorkflowsFolderNode` itself behaves before its first fetch) → **Connect Custom Workflow Repository…** → paste the Bitbucket URL Reltio gave the customer.
4. The IDE clones it (reusing `cloneRepository()` from `gitConfigSource.ts` verbatim) into a folder **nested inside that tenant's own `{tenantId}.reltio.tenant/` directory** — see D1 for exactly where and why this needs to be confirmed against whatever Snehil's folder-structure branch turns out to change.
5. A marker file, `WorkflowRepo.reltio.json`, is written next to `L3.reltio.json` (same sidecar convention as `WorkflowAdapter.reltio.json`), recording the repo URL and its relative path.
6. VS Code's native Explorer and Source Control panel pick the cloned folder up automatically — nested `.git` repos are something VS Code's built-in Git extension already discovers on its own. **Reltio IDE does not build a second file browser or a second diff view for the repo's own contents** — see D7.
7. The extension scans the repo for BPMN files (new `discoverBpmnFiles()`, modeled directly on `l3Discovery.ts`'s `discoverL3Files()`) and, for each one, reads out its `<process id>` (reusing `extractProcessModel()` from `bpmnModel.ts` — no new XML parsing code). Every `ProcessDefinitionNode` whose `type` matches a discovered file's process id gets a **sync badge**: `clean` (repo file matches the deployed XML) or `changed` (differs) — reusing the `localState` field `ProcessDefinitionNode` already has, just fed from a second source (see D5).
8. Customer edits BPMN/Java in the repo using ordinary VS Code editing. A BPMN file that lives inside the connected repo gets a **Deploy to Tenant** action too (not just Drafts) — see D4/D6 for exactly how tenant/process-id context is resolved for a file whose location and name aren't under this extension's control.
9. Customer commits and pushes with native Source Control — no custom git automation is added (matches the non-goal already stated in `git-repository-source`).
10. Customer opens a PR on Bitbucket (a convenience "Open repository" link is offered, nothing more — see Non-Goals).
11. Reltio reviews, CI builds the JAR, publishes to S3 (all outside the IDE, unchanged).
12. Customer runs **Refresh JARs** (already shipped) → the new JAR shows under **Unregistered** → **Register JAR** (already shipped) → live. Nothing new needed here; this is purely picking up work that's already done.
13. Sync badges on Process Definitions update automatically the next time the repo/tenant state is recomputed (see D5 for when that recompute runs).

---

## 2. UX / tree design

```
Workflows
├─ Process Definitions (N)         [existing — badges gain a 3rd state, see D5]
├─ JAR Deployments (N)
│   └─ Unregistered (N)            [existing, already shipped]
├─ Drafts (N)                      [existing — shown only when non-empty]
└─ Custom Workflow Repository      [NEW]
      "Not connected"  → click/right-click → Connect Custom Workflow Repository…
      once connected:
      "Connected — {N} BPMN files tracked"
      right-click → Disconnect Repository…  |  Open Repository Folder  |  Refresh Sync
```

**New commands** (naming follows the existing `reltio.<verb><Noun>` convention):

| Command | Trigger | Notes |
|---|---|---|
| `reltio.connectWorkflowRepository` | Click/right-click the new row while disconnected | Mirrors `reltio.fetchConfigFromGit`'s clone flow, minus the L3-discovery/multi-tenant-marker parts, which don't apply here |
| `reltio.disconnectWorkflowRepository` | Right-click, confirmed | Mirrors `reltio.removeGitSource`'s trash-first-then-permanent-delete pattern |
| `reltio.refreshWorkflowRepoSync` | Right-click, or automatic (see D5) | Re-scans the repo and recomputes sync badges without re-cloning |
| `reltio.deployWorkflow` *(existing command, extended)* | Right-click / editor title on a BPMN file that resolves to a repo context instead of a draft context | See D6 |

New `contextValue`s, following the existing `reltio.workflows.*` naming: `reltio.workflows.customRepo.notConnected`, `reltio.workflows.customRepo.connected`.

New icon: `ThemeIcon('repo')` for the connected state (visually distinct from `WorkflowsFolderNode`'s `git-branch` and `WorkflowDraftsFolderNode`'s `edit`), `ThemeIcon('repo-forked')` or a greyed variant for "not connected" — needs a quick visual check, not a hard decision.

---

## 3. Decisions

### D1 — Where the repo clones to (RESOLVED)

**Decision:** `Workflows/Custom Workflows/` — Snehil's own reserved, currently-empty placeholder folder inside the tenant's component tree. Not a bespoke `workflow-repo/` folder.

**Why this folder specifically:** it already exists, is already named for exactly this purpose ("Custom Workflows," Java-backed, as opposed to `Workflows/BPMN/`'s self-service split), and reusing it means zero new top-level convention and zero multi-root workspace management (`vscode.workspace.updateWorkspaceFolders` would add real edge cases — the user closing/moving that root independently, `.code-workspace` implications — for no benefit over a folder, which VS Code's Git extension already handles fine as a nested repo).

**The real problem this introduces, and its fix:** since Q1 is resolved as *a second, distinct remote* (see §0.1), cloning it into `Workflows/Custom Workflows/` means that folder becomes a **second git repository nested inside the tenant's own repository**, whenever the tenant is also bound via `reltio.connectTenantToGit`. Without a fix, the outer repo's `git add` records the inner `.git` as a **gitlink** (mode `160000`, a commit pointer, not the files) — the exact failure mode Snehil measured for the inverse case ("a repository above the tenants"), just one level down: cloning the outer tenant repo elsewhere produces an **empty `Custom Workflows` folder**.

**Fix:** before cloning into `Workflows/Custom Workflows/`, check whether the tenant folder is itself a git repo (`isGitRepoWithRemote()`, reused per D2). If so, add `Workflows/Custom Workflows/` to that tenant's `.gitignore` first — the same pattern Snehil uses for `.reltio-ide/`, pointed one level deeper. This is not a one-time check: see **D10** for why it has to run independently of connection order.

**Non-goal, explicit:** the extension does not attempt to prevent an outer-repo binding from happening after the workflow repo is already connected, or vice versa — same philosophy as Snehil's own D13, defused rather than blocked.

### D2 — Reuse `gitConfigSource.ts` as-is; no new clone/auth code

**Decision:** `cloneRepository()`, `isFolderEmpty()`, `isGitRepoWithRemote()`, `GitNotFoundError`, `isPathContainedIn()` are all already provider-agnostic (nothing in them is L3-specific) and get imported directly, unchanged. "Bitbucket" is branding on the customer's side, not a distinct code path — same assumption `git-repository-source` already makes for git in general (no Bitbucket API integration exists there either, and none is being proposed here).

**One real gap to close:** `isFolderEmpty()`'s emptiness check exists because `git clone` needs a literally-empty target. That's still true for a *nested* target folder, so `reltio.connectWorkflowRepository` needs the same "is this subfolder empty" check before cloning — trivial reuse, not new logic.

### D3 — New sidecar: `WorkflowRepo.reltio.json` (RESOLVED — revived by Q1's answer)

**Decision:** One new `EnvironmentManager` method, `getWorkflowRepoConfigUri(environment, tenantId)`, following the exact shape of `getWorkflowAdapterConfigUri()`. Contents: `{ "repoUrl": string, "relativePath": string }`. `relativePath` is recorded (rather than assumed to always be `Workflows/Custom Workflows/`) so D1's exact folder can change later without a marker-format migration.

**Location, verified against the codebase, not assumed:** tenant root, sibling to `Business Config/` — **tracked and committed**, not gitignored. Verified two ways: (1) `WorkflowAdapter.reltio.json` — the closest existing analog, same non-secret/team-shared category (a URL, no token) — lives at `{tenant}/WorkflowAdapter.reltio.json` today with no `.gitignore` entry anywhere in the codebase excluding it; (2) Snehil's `layoutMigration.ts` move-list only relocates the four legacy files it knows about (`L3.reltio.json`, baseline, layout, `history/`) — `WorkflowAdapter.reltio.json` isn't on that list and is left untouched by his migration, staying at tenant root, now sibling to `Business Config/`. `WorkflowRepo.reltio.json` follows the same convention: a repo URL is exactly this category of thing (not a secret, not identity that would break tenant-agnostic paths), so committing it means every teammate who clones the promotion repo gets the correct Custom Workflow Repository URL automatically, with nothing to retype. `.reltio-ide/` (Snehil's IDE-state sidecar) is the wrong home — that folder is reserved for state that must never be committed, which this isn't.

**Why not reuse `GitSourceMarker`/`.reltio-config-source.json`:** that marker's whole job is describing a config-source override to `EnvironmentManager.setGitSources()` — it's about *replacing* the tenant's L3 source. This is additive to a tenant that already has a live L3 source; conflating the two would mean teaching `EnvironmentManager`'s git-source machinery about a case it was never meant to model. A separate, purpose-built sidecar (same pattern as `WorkflowAdapter.reltio.json`) keeps the two concerns apart.

### D4 — Discovering BPMN files in the repo: content-driven, not filename-driven

**Decision:** `discoverBpmnFiles(root)` walks the repo (depth-limited like `discoverL3Files`, skipping dotfolders — same `MAX_DEPTH = 10` constant, reused not reinvented) collecting any file whose extension is `.xml` or `.bpmn20.xml` **and** which parses via `extractProcessModel()` to a non-empty `processId`. Filename is not trusted as an identity signal (unlike Drafts, where the extension *writes* the filename itself and can guarantee `{processId}.bpmn20.xml`) — a customer's repo can name files however its own convention dictates.

**Rationale:** Drafts get to assume their own naming convention because this extension is the sole writer. A cloned repo's contents are written by the customer (and by whatever their own tooling does), so the one thing that's actually authoritative is the same thing the Adapter itself keys on — the `<process id>` inside the file.

### D5 — Sync badge: reuse `ProcessDefinitionNode.localState`, don't invent a second visual language

**Decision:** `ProcessDefinitionNode.localState` (`'none' | 'clean' | 'changed'`) already exists for comparing a *downloaded* copy against the deployed baseline. Extend its source of truth: for a given process id, if a repo file with a matching `<process id>` exists, compare **that file's raw content** against the deployed XML (`fetchProcessDefinitionXml()`, already called by the existing "Open BPMN" flow) and set `localState` from the result — same two states, same icon/color (`gitDecoration.modifiedResourceForeground` for `changed`), same tooltip mechanism (`buildTooltip()`).

**RESOLVED (2026-09-27), empirically, against a real tenant — not a guess.** Tested end-to-end against `tst-01`/`SunilTst`: fetched the live XML for the existing `minimalTestProcess` test definition (2284 bytes), deployed that exact content straight back (new deployment, same process — `72119261`), then refetched it. Byte length identical (2284/2284) and SHA-256 identical (`24082BD0…4638` both sides). The Workflow Adapter round-trips BPMN XML byte-for-byte, at least for this tenant's Activiti dialect. **Byte-exact comparison is the decision.** Kept behind one function (`compareBpmnContent(repoXml, deployedXml)`) regardless, so a dialect that does reformat is a one-function change, not a redesign.

**When is this recomputed:** on `reltio.refreshWorkflowRepoSync` (manual) and after every **Fetch Workflows** / **Deploy** for that tenant (automatic) — not on every file save, which would mean a filesystem watcher on the repo folder for marginal benefit.

### D6 — Deploying a BPMN that lives in the connected repo

**Decision:** `resolveDraftContext()` (in `workflowDrafts.ts`) infers environment/tenant/process-id purely from a fixed path shape: `.../{env}.reltio.environment/{tenant}.reltio.tenant/workflows/{processId}.bpmn20.xml`. A repo-tracked file cannot rely on that: its parent folder isn't `workflows/`, and per D4 its filename doesn't reliably encode the process id.

**Proposed:** a sibling function, `resolveRepoBpmnContext(fsPath)`, that (a) walks the path upward looking for the nearest `{tenant}.reltio.tenant` / `{env}.reltio.environment` ancestor pair — matching D1's nested-clone location, not a specific immediate parent name — and (b) reads the process id from the file's own content via `extractProcessModel()`, exactly like D4's discovery does. `reltio.deployWorkflow`'s handler tries `resolveDraftContext()` first (unchanged, cheapest, no file read needed), then falls back to `resolveRepoBpmnContext()` for anything under a connected repo.

**RESOLVED (2026-09-27): direct deploy.** No promote-to-Draft copy. `reltio.deployWorkflow`'s handler tries `resolveDraftContext()` first (unchanged, cheapest), then `resolveRepoBpmnContext()` for a file under a connected repo, and deploys straight from that file's saved contents — matching the Feature Enablement Guide's "register it on the tenant in one click." The repo file stays exactly where it is (`Workflows/Custom Workflows/`); the deployed result simply becomes a normal deployed Process Definition — same tree location as any other deployment — linked back to its source file only via D5's sync badge, not by moving anything.

### D7 — No custom repo browser, no custom diff view, no PR automation

**Non-goals, explicit:**
- No tree-mirroring UI for the repo's own file layout (unlike `git-repository-source`'s config tree) — VS Code's Explorer already shows it since it's a real folder in the workspace.
- No custom diff viewer for "repo file vs. deployed XML" beyond the sync badge's clean/changed signal — clicking a `changed` Process Definition can open VS Code's built-in diff editor (`vscode.diff` command) against the two in-memory strings; that's a reuse of an existing VS Code API, not new UI to build.
- No in-IDE pull request creation, no CI status polling, no Bitbucket API calls of any kind. A convenience "Open repository in browser" action (using the stored `repoUrl`) is the only nice-to-have on this front, and it's cut first if anything needs trimming.

### D8 — JAR registration needs no code changes, only a UX nudge

**Decision:** No changes to `registerJarDeployment()`/`listAvailableJars()`/the Unregistered subfolder — all already correct and shipped. The only addition here is sequencing: after a successful **Connect Custom Workflow Repository**, surface a one-time informational nudge pointing at **Refresh JARs**, since a customer who just connected the repo for the first time is the same customer who's about to go looking for "where does my built JAR show up."

### D9 — One repository per tenant, not multi-tenant-per-repo

**Decision:** Unlike `git-repository-source` (which had to grow multi-tenant-per-repo support after real-world use — see its `design-amendment-multi-tenant.md`), this is a **1:1 tenant↔repository** relationship: Reltio provisions one Bitbucket repo per tenant, confirmed by the existing `workflow-repo-contribution` skill's own wording. No naming-collision/multi-source marker complexity is needed here — `WorkflowRepo.reltio.json` (D3) only ever describes one repo for one tenant.

### D10 — The nested-repo safeguard runs order-independently, not coupled to Snehil's code

**Decision:** the `.gitignore` fix from D1 has to be correct in **both** connection orders, and it has to get there without either extension knowing about the other's command:

| Order | What happens without a fix |
|---|---|
| Workflow repo connected first, tenant bound to Git second | Snehil's `reltio.connectTenantToGit` writes its own `.gitignore` entries (`.reltio-ide/`, his marker) — it has no idea `Workflows/Custom Workflows/` exists, so it won't exclude it |
| Tenant bound first, workflow repo connected second | We control the moment; trivial to gitignore it ourselves at connect time |

Order 1 is the one that actually needs solving. The fix is a small reconciliation check run on **activation and on tree refresh**, independent of either connect flow:
```
if (tenant folder has an outer .git)  AND  (WorkflowRepo.reltio.json marker exists):
    ensure "Workflows/Custom Workflows/" is in that outer .gitignore
```
Idempotent and re-run-safe, the same shape Snehil already uses for his own marker/`.gitignore` writes. This deliberately does **not** touch `src/workspace/tenantGitBinding.ts` — the two features stay decoupled, each independently correct, reconciled from our side only.

### D11 — Silent fix, no warning notification

**Decision:** when the reconciliation check in D10 adds the `.gitignore` entry, it does so silently. No notification, no modal — unlike Snehil's own pattern for the mirror-image hazard (an explicit warning before a repo lands above the tenants). The difference: his warning fires *before* an action that could still go wrong and needs the user's input to proceed; D10's fix has already fully resolved the hazard by the time it runs, so there is nothing left to decide or confirm. A notification here would just be noise for the near-totality of customers who will never open that `.gitignore` file.

---

## 4. Open questions — resolved (2026-09-27)

Kept as a record of how each was closed, not as outstanding work.

1. **Is the Reltio-provisioned Custom Workflow Repository the same remote as the generic per-tenant Git binding, or a second one?** **Resolved: a second, distinct remote.** See §0.1, D1, D3, D10.
2. **Does `Workflows/BPMN/` replace Drafts' current location?** **Resolved: yes.** `workflowDrafts.ts` and `resolveDraftContext()` change to write/read `Workflows/BPMN/{processId}.bpmn20.xml` going forward. **No migration mechanism needed** — Part 2 has not shipped to any customer (still local, unpushed, no PR), so there is no on-disk data at the old path to preserve. This is a plain path-construction change, not a migration feature.
3. **D5:** byte-exact vs. normalized comparison. **Resolved: byte-exact**, confirmed empirically against a live tenant (`tst-01`/`SunilTst`) — see D5 above.
4. **D6:** direct-deploy-from-repo vs. promote-to-draft-then-deploy. **Resolved: direct deploy.** See D6 above.
5. **JAR-registration documentation debt (§0):** deferred, not blocking. Can happen anytime as a small separate cleanup.
6. Icon choice for the connected/disconnected repo row (§2) — cosmetic, decide during implementation.

## 5. Coordination flag — no remaining product blockers; the rebase is the only prerequisite

Snehil's branch (`RP-200851-git-ready-tenant-folder-structure`) is pushed to `origin` and fully reviewed — see §0.1. Every decision this change depended on (D1, D3, D5, D6, D10, D11, and both items in §4) is now resolved. Nothing here is waiting on a person anymore.

**The one remaining prerequisite is mechanical, not a decision:** both `feature/workflow-authoring` (11 commits, unpushed) and `RP-200851-git-ready-tenant-folder-structure` (16 commits, pushed) independently modify `src/extension.ts`, `src/workspace/environmentManager.ts` (the same five path accessors on both sides), `src/tree/multiTenantTreeProvider.ts`, `src/tree/multiTenantNodes.ts`, and `package.json`, off a shared `main` neither has merged into yet. This rebase needs to happen before `custom-workflow-repository` implementation starts, since `Workflows/Custom Workflows/`, `Workflows/BPMN/`, and the whole component-tree convention this change builds on only exist once it (or Snehil's merge to `main`) lands.

## 6. Test plan (sketch — to firm up once decisions above land)

- **Tier A (pure logic):** `discoverBpmnFiles()` depth-limit/dotfolder-skip (mirrors the existing `l3Discovery` test fixture pattern); `resolveRepoBpmnContext()` path round-trip; sync-state comparison function once D5 is answered.
- **Tier B (structural):** new commands declared in `package.json` with correct `when` clauses (`view == reltioConfigTree && viewItem == reltio.workflows.customRepo.*`, matching the existing style at `package.json:758` etc.).
- **Tier C (manual):** real clone into a nested tenant folder; disconnect/reconnect; sync badge correctness against a real tenant + real repo; deploy-from-repo end to end; Refresh Jars → Register JAR nudge appears once.
