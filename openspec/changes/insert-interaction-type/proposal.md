## Why

Interaction types (`interactionTypes[]`) have no create action in the configuration tree — the `no-create-wizards` matrix (`design.md` §2, row `SF-interactionTypes`) already scoped this as planned follow-up work, but it was never implemented. RP-189637 asks for the same wizard-free, editor-first insertion experience that entity types, relation types, grouping types, graph types, sources, and hierarchy types already have.

## What Changes

- Add an **Insert Interaction Type** command that appends a minimal-but-usable `InteractionType` skeleton (`uri`, `label`, `attributes: []`) to `interactionTypes[]`, following the exact pattern used for `HierarchyType`/`GraphType`/`Source` in `src/commands/elementSkeletons.ts` and `src/commands/editCommands.ts`.
- Register the command in `package.json` (`contributes.commands` + a `view/item/context` menu entry scoped to the `interactionTypesFolder` or tenant root, matching `reltio.folder.hierarchyTypesFolder`'s `when` clause shape) and wire it in `src/extension.ts`.
- Make the insert reachable as a **bootstrap** action too (works from the tenant root before the section exists), same as hierarchy types.
- Add a dedicated CLI unit test script (`scripts/test-insert-interaction-type.cjs`) asserting the new builder's shape, registered in `scripts/run-unit-tests.cjs`, per the OpenSpec-aligned unit-test rule in `ARCHITECTURE.md`.
- Update `ARCHITECTURE.md`'s commands table and the `no-create-wizards` matrix docs (`design.md` §2, `element-candidates.md`) to mark `SF-interactionTypes` implemented — these are documentation-only edits to the existing matrix, not a reopening of that change's own scope.

## Capabilities

### New Capabilities

- `interaction-type-insertion`: Configuration-tree and bootstrap creation path that inserts a typed `InteractionType` JSON skeleton with a defaulted, collision-safe label, reveals the inserted fragment in the editor, and avoids modal wizards — same behavioral contract as the existing `element-skeleton-insertion` capability (`no-create-wizards`), scoped specifically to this one element kind.

### Modified Capabilities

- _(none — `element-skeleton-insertion` is not promoted to `openspec/specs/` yet, so it cannot be modified via a delta spec; this change adds its own capability instead and cross-references the shared matrix for consistency.)_

## Impact

- **`src/commands/elementSkeletons.ts`**: new `buildInteractionTypeObject` + `labelsFromInteractionTypes` pure builders.
- **`src/commands/editCommands.ts`**: new `addInteractionType` handler; add `'interactionTypes'` to `BOOTSTRAP_ROOT_ARRAY_KEYS`.
- **`package.json`**: new `reltio.insertInteractionType` command + `view/item/context` menu entry.
- **`src/extension.ts`**: register the new command.
- **`scripts/test-insert-interaction-type.cjs`** (new) + **`scripts/run-unit-tests.cjs`** (registration).
- **`ARCHITECTURE.md`**, **`openspec/changes/no-create-wizards/design.md`**, **`openspec/changes/no-create-wizards/element-candidates.md`**: documentation updates marking `SF-interactionTypes` implemented.
