# Tasks: git-source-nested-config-tree

## 1. Naming

- [x] 1.1 Add `TenantNaming` (`environmentName`, `tenantId`, `folders`) to `l3Discovery.ts`.
- [x] 1.2 Extract `relativeParts(root, uri)` with the existing Windows case-insensitive handling.
- [x] 1.3 Add `deriveTenantNamings(root, allL3Uris)`: folder collapses onto its single config, repository root takes the repository name, a shared folder keeps its row with filename leaves.
- [x] 1.4 Qualify only colliding `tenantId`s with their folder path.
- [x] 1.5 Keep `deriveTenantNaming` for single-file callers, delegating to the batch function.

## 2. Sources

- [x] 2.1 Add `folders` to `GitSource` and a `getGitSources()` accessor on `EnvironmentManager`.
- [x] 2.2 Add one `buildGitSources(root, l3Uris)` helper in `extension.ts`.
- [x] 2.3 Route connect, restore, add, and remove through it so naming cannot drift between flows.
- [x] 2.4 Re-derive naming on restore instead of trusting marker-stored ids.

## 3. Tree

- [x] 3.1 Add `GitFolderNode` (folder icon, inert `contextValue`, full path as tooltip).
- [x] 3.2 Add it to `MultiTenantTreeElement`.
- [x] 3.3 Build nested children for git mode: folder rows first, then configs at that level, each sorted.
- [x] 3.4 Return the folder row from `getParent` for nested configs so `reveal` resolves.
- [x] 3.5 Expand every level on connect, matching current git-mode behaviour.

## 4. Tests and docs

- [x] 4.1 Extend `scripts/test-git-repository-source.cjs` with Tier A rows 1-5 from the design Test plan.
- [x] 4.2 Update `ARCHITECTURE.md` for the new tree shape and identity rule.
- [x] 4.3 Update the README git section to describe the nested tree.

## 5. Verification

- [x] 5.1 `npm run compile` clean.
- [x] 5.2 `npm test` green (apart from the pre-existing velocity-packs failure).
- [x] 5.3 `npm run build` clean.
- [x] 5.4 `npm run openspec -- validate --changes` clean.
- [ ] 5.5 Tier C manual QA from `design.md`, including restoring a repository connected with the previous build.
