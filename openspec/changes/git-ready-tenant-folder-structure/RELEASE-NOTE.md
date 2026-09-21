# Release note — Git-ready tenant folder structure (RP-200851)

## What changes for you

Tenant configuration is now laid out so it can be pushed straight to Git and promoted through pull requests.

Each tenant folder becomes a **self-contained Git repository**, and nothing Git tracks contains the environment host or the tenant ID. That means a Dev tenant and a Prod tenant cloned from the same repository on different branches produce **identical paths**, so the branches diff and merge cleanly:

```
{tenantId}.reltio.tenant/          <- git root
├── Business Config/
│   └── BusinessConfig.json        <- your tenant metadata (was L3.reltio.json)
├── RDM/README.md
├── Workflows/{BPMN,Custom Workflows}/README.md
└── ... 13 more component folders
```

The 17 folders for components the IDE does not manage yet are placeholders, each with a `README.md` naming the expected files and linking to the Reltio docs. Git does not track empty directories, so without those files the structure would disappear on push.

## Your existing tenants migrate automatically

The first time you open an existing workspace after updating, tenants on the old flat layout are moved to the new one. You do not need to do anything.

| Before | After |
|---|---|
| `L3.reltio.json` | `Business Config/BusinessConfig.json` |
| `L3.remote-baseline.reltio.json` | `.reltio-ide/BusinessConfig.baseline.json` |
| `L3.reltio.layout.json` | `.reltio-ide/BusinessConfig.layout.json` |
| `history/` | `.reltio-ide/history/` |

Safeguards:

- **A backup is taken first**, at `.reltio-ide-backup/{environment}/{tenant}/` in your workspace root. It is gitignored and kept after migration.
- **A tenant with uncommitted Git changes is skipped**, so migration never buries your work in a rename diff. It migrates on a later activation once the worktree is clean, and you are told which tenants were skipped.
- **Run `Reltio: Undo Layout Migration`** from the Command Palette to put everything back.

A notification afterwards summarizes what moved, with a **Show details** action listing every file.

## Connecting a tenant to Git

Run **Connect Tenant to Git** from a tenant's context menu, **before** the first fetch while the folder is still empty. You are asked for:

- a **remote URL**, remembered per workspace (every tenant in a promotion flow shares one repository)
- a **branch**, asked each time (this is the promotion stage, and differs per tenant)

If the branch does not exist on the remote, you are offered the option to create it from the default branch and push it. It is created as a normal branch sharing history, not an orphan, so a pull request from `dev` into `test` works.

The tenant's current branch is shown in the tree.

## IDE state stays out of your repository

The drift baseline, ontology layout and history snapshots now live in a gitignored `.reltio-ide/` folder inside the tenant. A clean tenant shows only configuration files in `git status`, so these never appear in a pull request.

## Two smaller changes

- **New environments are created at the workspace root** rather than inside the hidden `.reltio/` folder, so repositories are easy to find. Environments already under `.reltio/` keep working and are never moved.
- `.reltio/` now holds only the extension's agent assets.

## If you downgrade

An older build reads the legacy layout only. Run **Undo Layout Migration** before downgrading, or restore from `.reltio-ide-backup/` by hand.
