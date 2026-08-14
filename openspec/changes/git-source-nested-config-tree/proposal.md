## Why

A git-sourced repository whose configs sit in nested folders renders each one as a single flat row with a dotted name, for example `DP.dp_lif`. The dots stand in for a directory structure the user already knows, and long paths become unreadable as nesting deepens. The tree should mirror the repository layout instead: `repo_name` → `DP` → `dp_lif`.

## What Changes

- The git-sourced tree grows folder rows between the environment row and the config rows, one per directory level, mirroring the repository layout.
- Config rows are named after their own folder rather than the full dotted path. A config at the repository root keeps the repository name.
- A folder holding several configs keeps its own row and gains one child row per filename, replacing today's `name (filename)` parenthetical.
- **BREAKING** (persisted state): `tenantId` changes from the dotted path to the leaf name. It is the key in `.reltio-config-source.json` and in `EnvironmentManager` lookups, so ids in existing marker files no longer match. Markers are re-derived from their stored `l3RelativePath` on load, so previously connected repositories keep working without user action.
- Leaf names that would collide across different folders are qualified with their folder path, since `tenantId` must stay unique for lookups to resolve.
- Folder rows are inert: no commands, no context-menu actions.

## Capabilities

### New Capabilities

None. This changes how an existing capability presents itself.

### Modified Capabilities

- `git-repository-source`: the requirement covering how discovered configs are named and placed in the tree.

## Impact

**Code**
- `src/workspace/l3Discovery.ts` — `deriveTenantNamings` (new, whole-repository) computes folders, leaf names, and uniqueness; `deriveTenantNaming` delegates to it.
- `src/workspace/environmentManager.ts` — `GitSource` gains `folders`; new `getGitSources()` accessor for the tree.
- `src/tree/multiTenantNodes.ts` — new `GitFolderNode`.
- `src/tree/multiTenantTreeProvider.ts` — nested children for git mode, and `getParent` for reveal.
- `src/extension.ts` — a single `buildGitSources` helper replaces four separate naming sites.

**Not in scope**
- Tenant-mode trees, which have no nesting.
- Folder-level actions such as removing every config beneath a folder.
