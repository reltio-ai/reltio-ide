## Context

The git-ready layout (RP-200851) makes each tenant folder a Git repository with a fixed component tree: `Business Config/`, `RDM/`, `Workflows/…`. Configuration is tracked; IDE working state — baselines, layout, history — lives in the gitignored `.reltio-ide/`. `src/workspace/tenantFolderStructure.ts` is declared the single place tenant paths are named, and a suite test enforces it for the legacy L3 names.

The RDM feature predates that layout. After the merge, RDM files sit at the tenant root, and RDM is fetched only by Get Configuration. `BusinessConfig.json` is fetched in three places: sign-in auto-add, **Add Tenant**, and Get Configuration.

Two existing mechanisms constrain the move:

- **The layout migration stamps each tenant once.** A workspace that has already migrated will never rerun it. Extending its move map would miss exactly the workspaces where RDM files are already stranded.
- **The layout requires every component folder in the pushed tree.** Unmanaged folders carry a generated `README.md` for this, because Git does not track empty directories.

## Goals / Non-Goals

**Goals:**

- RDM configurations live under `RDM/`; RDM baselines live under `.reltio-ide/`, out of the tracked tree.
- Existing workspaces get their RDM files moved without re-fetching and without risk of overwrite.
- A connected tenant shows its RDM straight away, like its Business Config.
- Every existing RDM behaviour — tree, drift guard, lookup values, authoring, Apply — keeps working against the new paths.

**Non-Goals:**

- **Tenant-agnostic RDM paths.** The RDM tenant ID is part of the path (D2).
- **Changing the layout's `managed` model or README system** (D6).
- **Persisting lookup values** as `LookupMappings.json`, which the layout's RDM README anticipates. Lookup values stay on-demand.

## Decisions

### D1: `RDM/{rdmTenantId}/config.json`, baseline in `.reltio-ide/RDM/{rdmTenantId}.baseline.json`

The configuration takes the name `config.json` that the layout's RDM README already lists as expected, one subfolder per RDM tenant. The baseline goes under `.reltio-ide/RDM/`, so it is covered by the gitignore the layout already writes for `.reltio-ide/`. No new ignore rule is needed.

The path pieces are declared in `tenantFolderStructure.ts` beside `BUSINESS_CONFIG_FILE` and `BASELINE_FILE`, honouring that module's role as the single place tenant paths are named.

### D2: One subfolder per RDM tenant — a deliberate trade-off

An MDM tenant may declare several RDM tenants (`rdmConfig.rdmTenants` is an array), and the existing design fetches every one. Per-RDM-tenant subfolders preserve that.

The cost is recorded rather than hidden. The layout's purpose is that the same logical configuration lands at the same path on every branch, so Dev and Prod can be diffed and merged. Dev and Prod point at different RDM tenants, so their RDM files land at different paths — RDM will not diff across environments the way `BusinessConfig.json` does.

**Alternative considered — a single tenant-agnostic `RDM/config.json`:** honours the layout fully, but supports one RDM tenant per MDM tenant. Chosen against, as a product decision, to keep multi-RDM-tenant support.

### D3: RDM tenants are enumerated from subfolders that contain a `config.json`

`listRdmTenantIds` lists the subdirectories of `RDM/` and keeps those holding a `config.json`. The directory name is the RDM tenant ID. This is what the tree, the drift guard and Apply already consume, so they need no change of their own.

Files directly under `RDM/`, including the layout's generated `README.md`, are never RDM tenants. A subfolder without `config.json` is ignored rather than shown as an empty tenant.

### D4: Relocation is its own idempotent step, not part of the stamped migration

A new step moves `{tenantRoot}/RDM.{id}.reltio.json` → `RDM/{id}/config.json` and `{tenantRoot}/RDM.{id}.remote-baseline.reltio.json` → `.reltio-ide/RDM/{id}.baseline.json`. It runs on every activation, chained after the layout migration so it sees the renamed tenant folders.

It is safe to repeat because each move happens only when the legacy file exists **and** the destination does not. Once a workspace is relocated it is a no-op costing one directory read per tenant. A destination that already exists is never overwritten: the legacy file stays where it is and is reported, so a conflict can never cost the user data.

**Alternative considered — adding RDM entries to the layout migration's move map:** rejected. That migration stamps each tenant once, so every workspace that has already migrated — precisely the ones with stranded RDM files — would never be reached.

**No backup is taken**, unlike the layout migration. That migration backs up because it moves several files as a batch and can fail midway. Each RDM move is a single rename that refuses to overwrite, so there is nothing a backup would protect.

### D5: Connecting a tenant fetches RDM, through one shared helper

The RDM continuation moves into a helper, `fetchRdmForTenant(environmentName, tenantId, token)`, which shows progress, runs `writeRdmFromApi`, and routes a 401 to `handle401`.

Every **connect** flow then goes through one wrapper, `connectTenantConfiguration`, which runs `writeL3FromApi` and, on `'written'`, starts `fetchRdmForTenant`. There are four: sign-in auto-add, **Add Tenant**, the **Setup Wizard**, and **Apply default environments**. Get Configuration calls the two steps separately, because its drift guard sits between them.

*Revised in Bugfix Round 1.* The first cut instead added an RDM continuation at each call site of `writeL3FromApi`. That missed the Setup Wizard and Apply default environments, which are not call sites in `extension.ts`: they are handed `writeL3FromApi` as a dependency and call it inside their own modules. A wizard-connected tenant therefore arrived with its Business Config and no RDM. A wrapper handed to every connect flow makes the behaviour part of what those flows receive, rather than something each call site must remember, and the test suite now asserts that no dependency object hands over the bare writer.

The existing RDM guarantees carry over unchanged. An L3 failure skips RDM. An RDM failure is reported on its own and never undoes the connect. A tenant with no RDM stays silent, which matters more now that sign-in is a caller.

This reverses `rdm-configuration-fetch` D1, which kept RDM out of sign-in on the original instruction that login stay unchanged. It is now a product decision to fetch RDM on connect. The helper is still called beside `writeL3FromApi` rather than inside it: the Get Configuration drift guard and its "Apply my changes instead" path must still decide whether a fetch happens at all.

The wrapper starts the RDM fetch without awaiting it, so in every connect flow the user lands in their Business Config without waiting on two further requests; `fetchRdmForTenant` reports its own outcome. It returns the Business Config result unchanged, so each flow's existing L3 success and failure handling is untouched.

### D6: The `RDM` component stays `managed: false`

The layout defines `managed` as "the IDE fetches or applies content here", which now describes RDM. But `managed` also decides whether a folder gets the `README.md` placeholder, and the layout requires every component folder to be present in the pushed tree. Business Config can drop its README because `BusinessConfig.json` is always there. RDM cannot: a tenant with no RDM configured would have an empty `RDM/`, which Git would drop from every clone.

So the flag and the layout's suite are left as they are, and the placeholder keeps `RDM/` in the tree. The known cost: the generated README still says the IDE does not fetch this component. Correcting that needs the layout's README model to distinguish "managed" from "always holds a file", which belongs to that capability rather than to this move.

### D7: The schema binding follows the files, and keeps the legacy glob for the transition

`RDM` schema binds `**/RDM/*/config.json`. `config.json` is a common filename, so the glob is scoped to a directory under an `RDM/` folder. The legacy `RDM.*.reltio.json` binding stays, with its exclusion from the L3 binding, for files the relocation reported as conflicting.

## Risks / Trade-offs

- **[Risk]** A `**/RDM/*/config.json` glob in `jsonValidation` could match an unrelated `config.json` in a user folder named `RDM` → **Mitigation**: the pattern requires the `RDM/<id>/config.json` depth. Only the Extension Development Host shows how VS Code applies it, so it is a manual QA step.
- **[Risk]** Relocation moves files inside a Git-bound tenant, which shows up as a change in `git status` → **Mitigation**: accepted. The files were never meant to be at the root, and the move is exactly the change the user asked for. The layout migration also refuses dirty worktrees; this step does not need to, because it never overwrites and never touches tracked config other than the RDM files themselves.
- **[Risk]** Sign-in now issues two more requests → **Mitigation**: they run after L3 is written and opened, so the user is not waiting on them, and a tenant without RDM costs one request and no notification.
- **[Trade-off]** RDM paths are not tenant-agnostic (D2).
- **[Trade-off]** The RDM README's wording is stale (D6).

## Migration Plan

Automatic, via D4, on the first activation after upgrade. It runs after the layout migration and is safe to repeat. Rollback is a revert: RDM files stay in the tree, the old code no longer finds them, and a Get Configuration fetches them afresh at the old root location.

## Open Questions

None blocking. Whether `**/RDM/*/config.json` binds as intended can only be confirmed in the Extension Development Host (Risks).

## Test plan

| Tier | Script / Method | What it covers |
|------|------------------|-----------------|
| A (automated) | `scripts/test-rdm-component-folder.cjs` | Path helpers resolve to `RDM/{id}/config.json` and `.reltio-ide/RDM/{id}.baseline.json`; the baseline is under `.reltio-ide/`, which the layout's gitignore already covers; relocation over a constructed tenant folder moves legacy config and baseline, is a no-op when repeated, never overwrites an existing destination, and ignores files that are not RDM; enumeration keeps only `RDM/` subfolders containing `config.json` and never counts `README.md` |
| B (automated) | same script | The RDM schema binds `**/RDM/*/config.json`; the legacy binding and its L3 exclusion remain; the RDM path pieces are declared in `tenantFolderStructure.ts`; the layout's `managed` model is unchanged |
| C (manual QA) | Extension Development Host against a live tenant | Sign in so a tenant is auto-added and confirm `RDM/{id}/config.json` appears without running Get Configuration; the same for **Add Tenant**; confirm the baseline is under `.reltio-ide/RDM/` and absent from `git status` on a Git-bound tenant; open a workspace with root-level RDM files and confirm they are relocated on activation and the tree still shows them; confirm the RDM schema validates `config.json`; confirm lookup values, Add, and Apply still work |
