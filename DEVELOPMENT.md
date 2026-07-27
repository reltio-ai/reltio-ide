# Development Guide

## Prerequisites

- Node.js >= 18
- npm

## Setup

```bash
git clone <repository-url>
cd reltio-ide
npm install
```

## Build

```bash
npm test               # compile (tsc) + OpenSpec-aligned unit tests
npm run build          # full build: extension host + webview
npm run build:ext      # extension host only
npm run build:webview  # webview only
npm run build:watch    # watch mode for extension host
npm run compile        # TypeScript emit to dist/ (used by npm test)
```

Build output:
- `dist/extension.js` — bundled extension host (VSIX)
- `dist/**/*.js` — per-file tsc output (unit tests import these)
- `dist/webview.js` — bundled webview JavaScript
- `dist/webview.css` — webview styles

Recommended release pipeline:

```bash
npm test
npm run build
npm run package
```

## Package

```bash
npm run package
```

Runs `clean` → increments patch version → `build` → `vsce package`. Output goes to `target/reltio-ide-<version>.vsix`.

## Install locally

**VS Code**
```bash
code --install-extension target/reltio-ide-<version>.vsix
```

**Cursor**
```bash
cursor --install-extension target/reltio-ide-<version>.vsix
```

Or: Extensions → `···` → Install from VSIX.

## Running in development

Press **F5** in VS Code/Cursor to launch the Extension Development Host with the extension loaded. Open any `*.reltio.json` file to activate it.

For continuous rebuilds:
```bash
npm run build:watch
```

## Project structure

```
src/
  extension.ts          Entry point
  commands/             Editor and tree commands
  model/                Reltio business model interfaces
  navigation/           Go-to-definition, references, diagnostics, URI index
  ontology/             Ontology graph model and panel management
  parser/               JSONC document parsing
  tree/                 Configuration tree view provider
  ux/                   Setup wizard and UX state
  webview/              Ontology preview webview
schemas/                JSON schema for *.reltio.json validation
resources/              Icons, agent assets, Velocity Packs
skills/                 Default Cursor Agent playbooks
```

## Feature workflow

This project uses OpenSpec spec-driven development. Changes follow an **Explore → Propose → Apply → Archive** cycle tracked under `openspec/changes/`.

Full details: [docs/CONTRIBUTION.md](docs/CONTRIBUTION.md)  
Node versions and CLI setup: [docs/INSTALLATION.md](docs/INSTALLATION.md)

## CI (Bitbucket Pipelines)

If no pipeline file exists in the repo, add a step before packaging:

```yaml
- npm ci
- npm test
- npm run package
```

`npm test` must pass on Node 18+ (Node 20 LTS recommended). Target wall time: under 60 seconds on a clean checkout.

## Agent authoring

Three OpenSpec capabilities wire up **Cursor Agent** to the editor:

| Capability | Spec | Playbooks |
|---|---|---|
| Workspace skills layout | `openspec/changes/.../reltio-workspace-skills/spec.md` | `skills/reltio-default/*/SKILL.md` |
| Guided model elements | `openspec/changes/.../guided-model-elements/spec.md` | Same playbooks + `.reltio/reltio-agent/velocity-packs/` |
| Velocity Pack reference | `openspec/changes/.../velocity-packs-reference/spec.md` | `resources/velocity-packs/manifest.json` |

Cursor discovery stubs live under `.cursor/skills/reltio-*-concepts/` and point at `skills/reltio-default/`.
