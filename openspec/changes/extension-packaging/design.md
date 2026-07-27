## Key Decisions

### D1: Output directory is `target/`, not project root
**Decision**: The `.vsix` file is produced in `./target/` rather than the project root.
**Rationale**: Keeps the root clean, mirrors Maven/Gradle convention. The `target/` directory is gitignored and treated as ephemeral build output.

### D2: esbuild bundles all runtime dependencies
**Decision**: No `node_modules/` shipped in the `.vsix`. esbuild bundles `jsonc-parser` and `elkjs` into `dist/extension.js`.
**Rationale**: The extension already uses esbuild with `--bundle`. The resulting `dist/extension.js` (~3.3MB) is self-contained. Shipping `node_modules/` would add 200MB+ for zero benefit.

### D3: `.vscodeignore` whitelist approach
**Decision**: The `.vscodeignore` uses an exclude-everything-then-include pattern to ensure only runtime artifacts are packaged.
**Rationale**: A whitelist approach is safer than a blacklist — new files added to the project won't accidentally end up in the package.

### D4: Single `npm run package` command for full build + package
**Decision**: `npm run package` runs `clean`, `build`, then `vsce package --out target/`.
**Rationale**: One command produces the distributable. No risk of stale build artifacts. Works identically when run by a human or an AI agent.

### D5: README structure prioritizes getting started
**Decision**: README sections ordered as: Overview → Quick Start → Project Structure → Build → Package → Install → Development.
**Rationale**: A new user or AI agent reading top-to-bottom gets the most actionable information first.

## Risks

- **[elkjs worker file]** elkjs may use a web worker (`elk-worker.min.js`). esbuild bundles the main module but may not capture the worker. → Mitigation: The current build already works — `elkjs` is loaded synchronously via its main entry. Verify during packaging that the ontology view still functions.
- **[vsce version pinning]** `@vscode/vsce` is a dev dependency but versions can break. → Mitigation: Pin to a specific version range in `package.json`.
