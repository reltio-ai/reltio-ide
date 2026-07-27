# Developer installation

This guide covers what you need on your machine to **build and work on** the Reltio Metadata Editor extension, with emphasis on **Node.js** and **OpenSpec** (spec-driven change proposals in this repo).

For day-to-day build commands and packaging, see the root [README](../README.md).

---

## 1. Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Node.js** | **18.x or newer** (LTS recommended). The project uses modern `fetch`, `esbuild`, and TypeScript 5.x. **20.x LTS** matches `@types/node` in `package.json` and is a safe default. |
| **npm** | Comes with Node. Use the npm bundled with your Node install. |
| **Git** | To clone and branch. |
| **VS Code or Cursor** | For editing and **F5** Extension Development Host debugging (see [README](../README.md#development)). |

Optional but common:

- **`@vscode/vsce`** — Already a **devDependency**; `npm run package` uses the local `vsce` from `node_modules`. You do **not** need a global `vsce` unless you prefer it.
- **Global OpenSpec CLI** — **Not required.** Use `npm run openspec` (see below) so the version matches `@fission-ai/openspec` in this repo.

---

## 2. Install Node.js

Pick one approach and stay consistent across the team.

### Option A — Official installer

Download an LTS build from [https://nodejs.org/](https://nodejs.org/) and install. Confirm:

```bash
node -v   # e.g. v20.x.x or v22.x.x
npm -v
```

### Option B — Version manager (recommended for multiple projects)

Use **nvm**, **fnm**, or **asdf** so you can pin Node per repo without touching system directories.

Example (nvm):

```bash
nvm install 20
nvm use 20
```

If you ever see **`EACCES`** when running `npm install -g ...`, avoid installing global tools into a root-owned prefix; prefer a version manager or configure npm’s prefix to a directory you own (see [npm docs on permissions](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally)).

---

## 3. Clone and install dependencies

```bash
git clone <your-bitbucket-url>
cd metadata-editor   # or your checkout folder name
npm install
```

`npm install` pulls runtime dependencies (`elkjs`, `jsonc-parser`) and **devDependencies**, including:

- **TypeScript**, **esbuild** — compile and bundle
- **@vscode/vsce** — `.vsix` packaging
- **@fission-ai/openspec** — OpenSpec CLI (local, via `npm run openspec`)

---

## 4. Verify the toolchain

From the repository root:

```bash
npm run compile   # TypeScript check (tsc)
npm run build     # extension + webview bundles
```

Both should exit with code **0**. If `compile` fails, fix TypeScript errors before opening PRs.

Other useful scripts (see `package.json`):

| Script | Purpose |
|--------|---------|
| `npm run build:watch` | Rebuild extension host on file changes (pair with F5 debugging) |
| `npm run package` | Clean, build, produce `target/*.vsix` |
| `npm run bench:format-json` | Local JSON formatting benchmark (optional) |

---

## 5. OpenSpec (spec-driven development)

OpenSpec is how this repository tracks **change proposals**, **design notes**, **tasks**, and **spec deltas** under `openspec/`. It is a **dev-time** tool; the shipped VSIX does not include OpenSpec.

### 5.1 Configuration in this repo

- **`openspec/config.yaml`** — Project OpenSpec config (e.g. workflow schema: `spec-driven`).
- **`openspec/changes/<change-id>/`** — Per-change folders: `proposal.md`, `design.md`, `tasks.md`, optional `specs/`, and `.openspec.yaml` where used.

Always run OpenSpec **from the repository root** (or pass an explicit path if the CLI supports it).

### 5.2 Running the CLI (use the local dependency)

Do **not** rely on a random global `openspec` unless you know it matches `@fission-ai/openspec` in `package.json`. Prefer:

```bash
npm run openspec -- --help
```

The `--` passes arguments to the underlying `openspec` binary. Examples:

```bash
npm run openspec -- list
npm run openspec -- list --specs
npm run openspec -- validate --all
npm run openspec -- show multi-tenant-tree-view
npm run openspec -- status --change multi-tenant-tree-view
```

Other useful top-level commands (see `npm run openspec -- --help`):

- **`view`** — Interactive dashboard of specs and changes
- **`change`** — Manage change proposals
- **`spec`** — Manage or inspect specifications
- **`archive`** — Archive a completed change and update main specs (use when your workflow calls for it)

### 5.3 Typical developer workflow

1. **`npm run openspec -- list`** — See active changes and task progress.
2. Work in `openspec/changes/<your-change>/` (Markdown and spec deltas) alongside code.
3. **`npm run openspec -- validate --changes`** (or **`--all`**, **`--specs`**) — Validate before review; see `npm run openspec -- validate --help`.
4. Implement code; keep `tasks.md` in sync with your team’s process.

Project-specific automation may also live in **Cursor/Claude skills** under `.claude/skills/openspec-*` (e.g. propose, apply, archive, bugfix). Those skills are optional helpers; the **CLI above is the canonical command surface**.

### 5.4 Global install (optional)

Only if you want `openspec` on your `PATH` without `npm run`:

```bash
npm install -g @fission-ai/openspec
```

Pin or update the global package when the repo bumps `@fission-ai/openspec` so behavior stays aligned.

---

## 6. Editor debugging (reminder)

1. Open this folder in VS Code or Cursor.
2. **F5** — Launch **Extension Development Host** with this extension loaded.
3. In the host window, open a workspace that contains `*.reltio.json` or use the Reltio tree as documented in the README.

Use **`npm run build:watch`** in a terminal while iterating so `dist/extension.js` stays fresh.

---

## 7. Troubleshooting

| Issue | What to try |
|-------|-------------|
| `node: bad option` / very old Node | Upgrade to Node **18+**. |
| `npm run compile` fails | Read `tsc` errors; ensure you are at repo root and `npm install` completed. |
| `openspec` command not found when typing `openspec` alone | Use `npm run openspec -- ...` or install globally as in §5.4. |
| `vsce` not found | Use `npm run package` (uses local `vsce`); or `npx vsce` from repo root. |

For packaging details and installing the `.vsix` locally, see [README — Package / Install](../README.md#package).
