## Why

The project builds and runs via `npm run build` and F5 debug, but there is no way to produce a distributable package or for a new contributor to understand the project structure. Without a `.vscodeignore`, a `.vsix` package would include `node_modules/`, `src/`, samples, and OpenSpec artifacts — bloating the file from ~500KB to 200MB+. Without a README, onboarding requires reading `package.json` scripts and guessing the project layout.

## What Changes

- Add `.vscodeignore` — excludes source code, samples, dev tooling, and everything not needed at runtime from the `.vsix` package
- Add `vsce` as a dev dependency for reproducible packaging
- Add `package` and `clean` npm scripts — `npm run package` produces a `.vsix` in `./target/`
- Add `README.md` — project overview, directory structure, build/package/install instructions for both humans and AI agents, development setup for Cursor and VS Code

## Capabilities

### New Capabilities
- `packaging`: `npm run package` produces `target/reltio-metadata-editor-<version>.vsix` ready for distribution
- `clean-build`: `npm run clean` removes `dist/` and `target/` for fresh builds
- `documentation`: README.md documents project structure, build pipeline, packaging, installation (VS Code and Cursor), and development workflow

### Modified Capabilities
- None — this change is purely additive tooling/documentation

## Impact

- **New files**: `.vscodeignore`, `README.md`
- **Modified files**: `package.json` (add `package`, `clean` scripts; add `@vscode/vsce` to devDependencies)
- **New directories**: `target/` (build output, gitignored)
- **New dev dependency**: `@vscode/vsce`
