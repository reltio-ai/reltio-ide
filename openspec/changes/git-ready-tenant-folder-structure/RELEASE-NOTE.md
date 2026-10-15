# Release note — Git-ready tenant folder structure (RP-200851)

## What changes for you

Tenant configuration is now laid out so it can be pushed straight to Git and promoted through pull requests.

Each tenant folder becomes a **self-contained Git repository**, and nothing Git tracks contains the environment host or the tenant ID. That means a Dev tenant and a Prod tenant cloned from the same repository on different branches produce **identical paths**, so the branches diff and merge cleanly:

```
dev/                               <- environment (was dev.reltio.com.reltio.environment)
└── GrmSwAZFRAeVy1K/               <- tenant, and the git root
    ├── Business Config/
    │   └── BusinessConfig.json    <- your tenant metadata (was L3.reltio.json)
    ├── RDM/README.md
    └── Workflows/
        ├── BPMN/README.md
        └── Custom Workflows/README.md
```

Folder names are now plain: the environment is the first part of its host (`dev.reltio.com` becomes
`dev`) and the tenant is just its ID. The host is still what the extension talks to; it is recorded
in a hidden `.reltio-environment.json` rather than in the folder name.

`RDM` and the two `Workflows` folders are placeholders for components the IDE does not manage yet. Each has a `README.md` naming the expected files and linking to the Reltio docs, because Git does not track empty directories and the structure would otherwise disappear on push.

If you used an earlier build, it created fourteen further component folders (`DTSS`, `Connectors`, `User Management`, and so on). Those are removed automatically, but **only** when a folder contains nothing except the README we generated. Anything you put in one, or a README you rewrote, keeps the folder exactly as it is.

## Your existing tenants migrate automatically

The first time you open an existing workspace after updating, tenants on the old flat layout are moved to the new one. You do not need to do anything.

| Before | After |
|---|---|
| `L3.reltio.json` | `Business Config/BusinessConfig.json` |
| `L3.remote-baseline.reltio.json` | `.reltio-ide/BusinessConfig.baseline.json` |
| `L3.reltio.layout.json` | `.reltio-ide/BusinessConfig.layout.json` |
| `history/` | `.reltio-ide/history/` |
| `dev.reltio.com.reltio.environment/` | `dev/` |
| `GrmSwAZFRAeVy1K.reltio.tenant/` | `GrmSwAZFRAeVy1K/` |

Safeguards:

- **A backup is taken first**, at `.reltio-ide-backup/{environment}/{tenant}/` in your workspace root. It is gitignored and kept after migration.
- **A tenant with uncommitted Git changes is skipped**, so migration never buries your work in a rename diff. It migrates on a later activation once the worktree is clean, and you are told which tenants were skipped.
- **Run `Reltio: Undo Layout Migration`** from the Command Palette to put everything back.

A notification afterwards summarizes what moved, with a **Show details** action listing every file.

## Connecting a tenant to Git

Run **Connect to Git** from a tenant's context menu, in whatever order suits you: before the first fetch, or after. You are asked for:

- a **remote URL**, remembered per workspace (every tenant in a promotion flow shares one repository)
- a **branch**, picked from the remote's existing branches, with **Create a new branch…** if you need one

Reading the branch list needs no clone, so backing out at that point leaves the folder untouched.

If you create a branch that does not exist on the remote, it forks from the default branch and is pushed. It shares history rather than being an orphan, so a pull request from `dev` into `test` works. The configuration inherited from the branch you forked is dropped, so a second tenant never shows the first tenant's data: **Fetch Configuration** writes yours into a clean folder.

If the tenant already has a configuration when you connect, the repository is created in place and the branch is adopted underneath your files. Nothing is overwritten; your configuration appears as an uncommitted change against the branch, ready to review and push.

The tenant's current branch is shown in the tree.

## IDE state stays out of your repository

The drift baseline, ontology layout and history snapshots now live in a gitignored `.reltio-ide/` folder inside the tenant. A clean tenant shows only configuration files in `git status`, so these never appear in a pull request.

## Two smaller changes

- **New environments are created at the workspace root** rather than inside the hidden `.reltio/` folder, so repositories are easy to find. Environments already under `.reltio/` keep working and are never moved.
- `.reltio/` now holds only the extension's agent assets.

## Do not put a Git repository at the workspace root

Each tenant folder is its own repository. That is what keeps the environment and tenant names out of every tracked path, so a Dev branch and a Prod branch can be compared.

Running **Initialize Repository** on the workspace root instead breaks that: either every path becomes `dev/<tenantId>/Business Config/...`, or, if a tenant is already connected, the outer repository stores that tenant as a pointer rather than its files, and cloning it gives you an empty folder.

The extension cannot prevent this, so it does three things instead:

- keeps its own state out of any such repository, via a workspace-root `.gitignore`
- warns you once per workspace, with **Ignore Tenant Folders**, **Show Details** and **Don't Show Again**
- warns before connecting a tenant that sits inside another repository

## If you downgrade

An older build reads the legacy layout only. Run **Undo Layout Migration** before downgrading, or restore from `.reltio-ide-backup/` by hand.
