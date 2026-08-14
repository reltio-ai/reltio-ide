## Context

Git-sourced configs are discovered by `discoverL3Files` and named by `deriveTenantNaming`, which returned `{ environmentName, tenantId }` with `tenantId` set to the dotted folder path (`folders.join('.')`). `MultiTenantTreeProvider` rendered one `TenantNode` per config directly under the environment row, so the dots were the only hint of hierarchy.

`tenantId` is not just a label. It is the key in `.reltio-config-source.json` and the lookup key in `EnvironmentManager.findGitSource`, which backs `getL3Uri` and `getLayoutUri`.

## Goals / Non-Goals

**Goals:**

- The tree mirrors the repository's directory layout.
- Config rows carry short, local names.
- Lookups stay unambiguous, so no two configs share a `tenantId`.
- Previously connected repositories keep working without user action.

**Non-Goals:**

- Folder-level actions. Folder rows only expand and collapse.
- Any change to tenant-mode trees.
- Preserving the dotted ids in existing marker files.

## Decisions

**D1. `tenantId` becomes the leaf name, qualified only on collision.**

Chosen by the requester over display-only nesting. A folder holding one config lends its name to that config's row; a config at the repository root takes the repository name.

The risk this carries is real: leaf names are not naturally unique. Two folders named `shared` under different parents both yield `shared`, and in the multi-file case several folders each yield `BusinessConfig.json`. Because `findGitSource` matches on `tenantId` and returns the first hit, a duplicate would open the wrong file. So duplicates, and only duplicates, are qualified with their folder path: `shared (DP/shared)`. Unique names stay short, which is the point of the change.

*Alternative considered:* display-only nesting, keeping the dotted `tenantId` as a hidden identity. Rejected by the requester. It would have avoided the uniqueness problem entirely.

**D2. Name the whole repository in one pass.**

Uniqueness cannot be judged one file at a time, so `deriveTenantNamings(root, allL3Uris)` computes every naming together. `deriveTenantNaming` remains for single-file callers and delegates. In `extension.ts` a single `buildGitSources` helper replaces the four sites that each derived names separately, so connect, restore, add, and remove cannot drift apart.

**D3. Re-derive names on restore instead of trusting the marker.**

`tryRestoreGitSource` recomputes naming from each entry's `l3RelativePath` and ignores the stored `tenantId`. This handles markers written by earlier builds (which hold dotted ids) and also self-corrects after a config is added or removed, since either can change which names need qualifying.

**D4. Folder rows are a distinct node type.**

`GitFolderNode` carries the path from the environment down to itself, uses the themed folder icon, and sets `contextValue: 'reltio.gitFolder'`, which matches no menu `when` clause. `getParent` returns the folder row for a nested config so `TreeView.reveal` still resolves.

**D5. A folder with several configs keeps its own row.**

Its children are named by filename. This replaces the `name (filename)` parenthetical, which mixed folder and file naming on one row.

## Risks / Trade-offs

- **Qualified names are less pretty than dotted paths** → Only collisions are affected. `shared (DP/shared)` is longer than `DP.shared`, but it is rare and stays unambiguous.
- **Marker ids written by this build differ from older ones** → Restore re-derives from paths, so the stored ids are advisory. No migration step and no user action.
- **Deep repositories add rows** → Every level auto-expands, per the requester's choice, matching today's behaviour where git tenants expand on connect.
- **Tree building is O(configs x depth) per expansion** → Repositories hold tens of configs, so this is immaterial.

## Migration Plan

None required. Marker files are re-derived on load. Rollback is reverting the commit; markers written by this build still restore correctly on the older code, which reads `l3RelativePath` and its own stored ids.

## Open Questions

- Should a folder whose only child is another folder collapse into one row (`DP/dp_lif`)? Today each level gets a row, matching the requested `repo → DP → dp_lif` shape.

## Test plan

**Automated (Tier A)** — extends `scripts/test-git-repository-source.cjs`

| # | Assertion |
|---|---|
| 1 | A config at the repository root takes the repository name and has no folder rows |
| 2 | `DP/dp_lif/BusinessConfig.json` yields `tenantId` `dp_lif` with folders `['DP']` |
| 3 | Deeper nesting keeps every intermediate folder |
| 4 | Two configs in one folder keep the folder row and are named by filename |
| 5 | Colliding leaf names are qualified by folder path; non-colliding names stay short; all ids unique |

**Manual QA (Tier C)**

| # | Check |
|---|---|
| 1 | A repository with nested configs renders as `repo → DP → dp_lif`, fully expanded |
| 2 | Opening a nested config opens the right file |
| 3 | Remove Config on a nested row removes only that config, and the remaining rows keep sensible names |
| 4 | Add Config on a file in a new folder places it at the right depth |
| 5 | A repository connected with the previous build still restores after upgrading |
| 6 | Folder rows offer no context-menu actions |
