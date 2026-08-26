## Why

Customer-facing docs still read as tenant-only in the in-product Setup Guide and Walkthrough, and README screenshots were captured in dark theme. Staging docs for Git already use light-theme figures. After PR #8 merged, `vsce` rewrites README image URLs against `main`, so those figures need to land on `main` for the Extension Details page. Command titles in README / QUICKSTART also drifted from `package.json` and the live dialogs (`Get Configuration`, **View changes**, **Review changes** / **Fetch anyway**, **Fetch More Configuration History**).

## What Changes

- Replace README screenshots with the light-theme figures from docs staging; add the missing apply, history, and AI-authoring shots.
- Document Git as Setup Guide / Walkthrough **Step 6**, kept in sync across `resources/setupGuide.json`, `docs/setup-guide-content.md`, and `package.json` `contributes.walkthroughs`.
- Align customer-facing command titles and dialog buttons with the titles in `package.json` and the strings in `src/extension.ts`.
- Pin the above with a unit test so a later title rename cannot silently stale the README again.

## Capabilities

### New Capabilities

- `customer-facing-git-docs`: README, QUICKSTART, Setup Guide, and Walkthrough describe Git-repository mode with the same command titles and discovery rules the extension ships.

### Modified Capabilities

- `git-repository-source`: customer docs now match current discovery (`BusinessConfig.json`, depth 10), **Add Config** / **Remove Config** / **Remove Repository**, and tenant-menu hiding.
- `packaging`: README image files on `main` are the light-theme set `vsce` rewrites onto the Extension Details page (rewrite itself landed in `fix-vsix-readme-image-urls` / PR #8).

## Impact

**Docs**
- `README.md`, `QUICKSTART.md`, `docs/setup-guide-content.md`, `resources/setupGuide.json`, `docs/images/*`, `package.json` walkthrough, `ARCHITECTURE.md` (Setup Guide command + walkthrough step 6).

**Code**
- None. No runtime behavior change.

**Tests**
- New `scripts/test-docs-light-theme-screenshots-and-setup-guide.cjs`: README image paths exist on disk; Setup Guide / Walkthrough have the Git step; customer docs use the live command titles from `package.json`.

**Not in scope**
- Changing discovery, menus, or apply/fetch dialogs.
- Re-capturing Cursor vs VS Code install shots as distinct images (staging reused one Command Palette figure).
