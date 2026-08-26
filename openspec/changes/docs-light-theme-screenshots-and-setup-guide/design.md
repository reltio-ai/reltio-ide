## Context

`git-repository-source` task 15.1 already required Setup Guide Step 6 and a Walkthrough mirror, but the in-product JSON and walkthrough on `main` stayed tenant-only (five steps). README Git copy on `main` is closer to the product, yet screenshots were dark-theme and a few dialog/command titles lagged `context-menu-reorganization` (`Get Configuration`, `View Configuration History`) and the apply/fetch strings in `src/extension.ts`.

PR #8 (`fix-vsix-readme-image-urls`) already rewrites relative README images to `raw.githubusercontent.com/.../main/...`. New PNGs must therefore exist at those paths on `main` after this change merges, or Details-page images stay dark or 404.

## Decision

Keep this a docs-only change. Source of truth for **command titles** is `package.json` `contributes.commands`. Source of truth for **dialog buttons** is the string literals in `src/extension.ts` (`Yes` / `View changes` / `Don't apply`; `Review changes` / `Fetch anyway`; `Fetch and overwrite` / `Apply my changes instead`). Customer docs quote those strings exactly.

The three Git onboarding surfaces stay in lockstep:

| Surface | File | Git step id |
|---|---|---|
| In-product Setup Guide | `resources/setupGuide.json` | `connectGit` (number 6) |
| Markdown twin | `docs/setup-guide-content.md` | Step 6 |
| VS Code Walkthrough | `package.json` `contributes.walkthroughs` | `connectGit` |

Discovery copy matches `l3Discovery.ts`: `BusinessConfig.json` (case-insensitive), `MAX_DEPTH = 10`. **Add Config** remains the path for other filenames and is gated by `isBusinessConfigFile`.

**Alternatives considered:**

- **Fold this into the existing `git-repository-source` change.** Rejected: that change is already implemented and mixed with runtime work. A new spec-driven change keeps this PR reviewable as docs.
- **Leave QUICKSTART on the old titles.** Rejected: it is linked from README and still teaches Fetch Configuration / Fetch More.

## Risks / Trade-offs

- Light-theme PNGs are larger in some cases (entity-type shot). Acceptable for README fidelity.
- Cursor and VS Code install screenshots are the same file after the staging swap. Captioned separately so a later recapture can split them without rewriting the steps.
- Details-page images resolve against `main` (vsce limitation, already documented in `fix-vsix-readme-image-urls`). Merging this branch is what makes the new figures live.

## Migration Plan

None. Rollback is reverting the docs commit.

## Open Questions

None.
