# Tasks: docs-light-theme-screenshots-and-setup-guide

## 1. Screenshots

- [x] 1.1 Replace README PNGs with light-theme staging figures; add `ai-assisted-authoring.png`, `apply-configuration.png`, `apply-configuration-confirm.png`, `configuration-history.png`.

## 2. Git in Setup Guide and Walkthrough

- [x] 2.1 Add Step 6 (`connectGit`) to `resources/setupGuide.json` and keep `docs/setup-guide-content.md` in sync.
- [x] 2.2 Add the matching Walkthrough step and `featuredFor` entries (`BusinessConfig.json`, `L3.json`) in `package.json`.
- [x] 2.3 Point tenant Setup Guide steps 1 / 4 / 5 at the Git alternative where it matters.

## 3. Command titles vs code

- [x] 3.1 README: discovery depth 10, title-bar **Remove Repository**, tenant-only context menu, apply buttons **Yes** / **View changes** / **Don't apply**, Get Configuration **Review changes** / **Fetch anyway** (not Keep File / Undo File).
- [x] 3.2 QUICKSTART: **Get Configuration**, **View Configuration History**, **Fetch More Configuration History**, **Compare with Current L3**, apply **View changes**.
- [x] 3.3 `ARCHITECTURE.md`: document `reltio.openSetupGuide` and Walkthrough step 6.

## 4. Tests

- [x] 4.1 Add `scripts/test-docs-light-theme-screenshots-and-setup-guide.cjs` and register it in `scripts/run-unit-tests.cjs`.
- [x] 4.2 `node scripts/test-docs-light-theme-screenshots-and-setup-guide.cjs` passes.
- [x] 4.3 `npx @fission-ai/openspec@1.3.0 validate docs-light-theme-screenshots-and-setup-guide --strict` clean.

## 5. Pull request

- [x] 5.1 Commit on `docs/light-theme-screenshots-and-setup-guide`.
- [ ] 5.2 Open a PR after review (do not push until asked).
