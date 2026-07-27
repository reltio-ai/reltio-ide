## Implementation Tasks

- [x] 1. Create `.vscodeignore` — exclude `src/`, `samples/`, `examples/`, `openspec/`, `.cursor/`, `.claude/`, `.vscode/`, `node_modules/`, `tsconfig.json`, `*.ts`, `*.map`, layout files; include `dist/`, `schemas/`, `resources/`, `package.json`, `README.md`, `LICENSE`
- [x] 2. Add `@vscode/vsce` dev dependency — install via npm
- [x] 3. Add npm scripts to `package.json` — `clean` (rm -rf dist target), `package` (clean + build + mkdir target + vsce package --out target/)
- [x] 4. Add `target/` to `.gitignore`
- [x] 5. Write `README.md` — project overview, directory structure table, prerequisites (Node.js >=18, npm), build instructions (`npm install && npm run build`), package instructions (`npm run package`), install instructions for VS Code (`code --install-extension target/*.vsix`) and Cursor (`cursor --install-extension target/*.vsix` or Extensions UI), development setup (clone, npm install, F5 to debug), brief feature list
- [x] 6. Build and verify — run `npm run package`, confirm `.vsix` is in `target/`, verify size is reasonable (<5MB), test install in VS Code or Cursor
