# Tasks: git-source-nested-config-tree

## 1. Naming

- [x] 1.1 Add `TenantNaming` (`environmentName`, `tenantId`, `folders`) to `l3Discovery.ts`.
- [x] 1.2 Extract `relativeParts(root, uri)` with the existing Windows case-insensitive handling.
- [x] 1.3 Add `deriveTenantNamings(root, allL3Uris)`: folder collapses onto its single config, a shared folder keeps its row with filename leaves, repository root uses the filename (see Bugfix Round 1).
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

## Bugfix Round 1: root config borrowed the repository name

Reported against `snehilkamal/reltio-config`: the lone root `BusinessConfig.json` rendered as
`reltio-config`, duplicating the environment row above it, then renamed itself to
`BusinessConfig.json` as soon as root `L3.json` was adopted through Add Config.

- [x] B1.1 Name a root config after its file in `deriveTenantNamings`, merging the root case into the shared-folder case.
- [x] B1.2 Update the root assertion in `scripts/test-git-repository-source.cjs` and add a guard that adopting a root sibling does not rename the first config.
- [x] B1.3 Update the repository-root scenario in `specs/git-repository-source/spec.md` and add a scenario for adopting a second root config.
- [x] B1.4 `npm run compile` and `npm test` green (apart from the pre-existing velocity-packs failure).
- [ ] B1.5 Tier C: confirm the tree in a repository with a root config, before and after adopting a second one.

## Bugfix Round 2: the collision qualifier leaked into row labels

Reported against `snehilkamal/reltio-config`: adopting `Account360/L3.json` made the rows read
`BusinessConfig.json (Account360)` and `L3.json (Account360)`, because their filenames now clashed
with the two root configs. The bracketed path was pure noise, the rows already sit under the
`Account360` folder row.

- [x] B2.1 Split display from identity: add `label` to `TenantNaming`, left unqualified while `tenantId` still gains the qualifier.
- [x] B2.2 Add optional `label` to `GitSource` and optional `displayLabel` to `TenantNode`, defaulting to `tenantId` so tenant mode is untouched.
- [x] B2.3 Pass the label from `gitChildren` and both `getParent` paths in `MultiTenantTreeProvider`; sort git rows by label.
- [x] B2.4 Extend `scripts/test-git-repository-source.cjs`: labels never carry the qualifier, ids stay unique, the rendered `TenantNode` shows the label while `id` and tooltip keep the qualified id, and tenant mode still labels by `tenantId`.
- [x] B2.5 Add the display scenario to `specs/git-repository-source/spec.md`.
- [ ] B2.6 Tier C: with root and `Account360` both holding `BusinessConfig.json` and `L3.json`, confirm four plain labels, and that opening each row lands on the right file.

## 6. Add Config accepts only a business configuration

Requested after Bugfix Round 2: Add Config accepted any parsable JSON, so `Permissions.json`
(a top-level array) and `Lookups.json` (`{}`) could be adopted and produced unusable rows.

- [x] 6.1 Add `isBusinessConfigFile(uri)` to `l3Discovery.ts`: valid JSON, top-level object, `uri === 'configuration'`, and both `sources` and `entityTypes` present as arrays.
- [x] 6.2 Show one flat error, `"<path>" is not a valid Reltio business configuration`, with no per-failure reason. Requested by the reporter after a first pass that spelled out what was wrong.
- [x] 6.3 Call it from `reltio.addFileAsTenant` in place of the `isParsableL3File` check; leave discovery, restore, and the connect-time picker on the lenient check as scoped by the requester.
- [x] 6.4 Cover it in `scripts/test-git-repository-source.cjs`, including the two real-world rejects, wrong-typed sections, unreadable files, and a guard that `isParsableL3File` still accepts `{}`.
- [x] 6.5 Add the requirement and its two scenarios to `specs/git-repository-source/spec.md`.
- [ ] 6.6 Tier C: in `reltio-config`, confirm Add Config refuses `Account360/Permissions.json` and `Identity360/Lookups.json` with a readable error, and still accepts `Retail/L3.json` and `Banking/TenantConfig.json` if they are real configurations.

## Bugfix Round 3: Remove Config collapsed the whole tree

Reported against `snehilkamal/reltio-config`: adopting root `L3.json` and then removing it flattened every
row, brought back the `(local)` suffixes and the collision-qualified labels, and made the environment ask
the user to sign in. `reltio.removeGitTenant` called `tokenStore.clearToken(node.environmentName)` even
when configurations remained, and every configuration in a repository shares that one environment name, so
the git-mode sentinel was revoked for all of them.

- [x] B3.1 Export `GIT_SOURCE_TOKEN` from `api/tokenStore.ts` and replace all five copies of the literal, so the sentinel cannot drift between the writers and the two readers that switch on it.
- [x] B3.2 Re-assert the sentinel in `reltio.removeGitTenant` when sources remain, instead of clearing it. The last-config branch still clears it, which is correct: no source is left.
- [x] B3.3 Name the removed configuration by `displayLabel` in the confirmation prompt and the result message, so a collision qualifier the user never saw is not echoed back.
- [x] B3.4 Cover it in `scripts/test-git-repository-source.cjs`: drive `MultiTenantTreeProvider` through a two-source repository, remove one, and assert the folder row, the authorized state and the absent `(local)` suffix survive. Also assert what clearing the token does, so the regression path itself is pinned.
- [x] B3.5 Add the removal requirement and its three scenarios to `specs/git-repository-source/spec.md`, and move the two tree-placement scenarios that had been filed under the Add Config requirement back where they belong.
- [x] B3.6 `npm run compile`, `npm test` and `npm run build` clean (apart from the pre-existing velocity-packs failure).
- [ ] B3.7 Tier C: in `reltio-config`, adopt root `L3.json`, remove it, and confirm the tree keeps its folder rows, its plain labels and its authorized state. Then remove the last configuration and confirm the repository does leave git mode.
