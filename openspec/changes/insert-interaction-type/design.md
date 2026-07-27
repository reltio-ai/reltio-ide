## Context

`interactionTypes[]` is a top-level L3 array (`src/model/types.ts` `InteractionType`: `uri`, `label?`, `attributes?`, `memberTypes?`, `groupKeyAttributeUris?`, `extendsTypeURI?`, `ignoreUniqueness?`, `hasMembers?`, `lifecycleActions?`, `dataPipelineConfig?` — only `uri` is schema-required). The `no-create-wizards` change already established the wizard-free, editor-first insertion pattern and its normative matrix (`openspec/changes/no-create-wizards/design.md` §2, row `SF-interactionTypes`), currently marked `*TBD*`. Six sibling element kinds already ship this pattern: `EntityType`, `RelationType`, `Attribute` (original v1 scope), plus `GroupingType`, `GraphType`, `Source` (RP-188087-era follow-up), plus `HierarchyType` (RP-189635). This change is the next follow-up row, `SF-interactionTypes`, implemented as its own OpenSpec change per the project's one-change-per-unit-of-work convention rather than reopening `no-create-wizards`.

## Goals / Non-Goals

**Goals:**
- Insert Interaction Type command with the exact same UX contract as Insert Hierarchy Type / Insert Graph Type / Insert Source: no `showInputBox`/`showQuickPick`, default label `InteractionType{n}`, editor reveals the inserted fragment.
- Reachable both from the `interactionTypesFolder` (when it exists) and from the tenant root / `L3.reltio.json` (bootstrap, before the folder exists) — matching hierarchy type's `BOOTSTRAP_ROOT_ARRAY_KEYS` treatment.
- Keep the sibling `no-create-wizards` matrix docs truthful: flip `SF-interactionTypes` from `*TBD*`/planned to implemented in both `design.md` and `element-candidates.md`.
- Add automated (Tier A) test coverage for the new pure builder, per `ARCHITECTURE.md`'s OpenSpec-aligned unit test rule.

**Non-Goals:**
- `memberTypes`, `groupKeyAttributeUris`, `dataPipelineConfig`, or any other optional `InteractionType` field beyond a minimal usable skeleton — those stay for the user to fill in, same as `allowedEntityTypes: []` was left empty on `HierarchyType`.
- Reworking `no-create-wizards` itself (no code/task changes in that change's own scope — only the shared matrix doc rows it documents get corrected for accuracy).
- VS Code integration/E2E testing — deferred to manual QA per the Tier C convention (right-click, confirm insert, confirm reveal, confirm tree refresh).

## Decisions

**D1 — Skeleton shape:** `{ uri: 'configuration/interactionTypes/{label}', label, attributes: [] }`. `attributes: []` (not `allowedEntityTypes` or another field) because `InteractionType.attributes` is the direct analog of `EntityType.attributes` — the field a user immediately needs to make the new interaction type meaningful — and mirrors the existing `attributes: []` choice already made for `EntityType`/`RelationType` skeletons.

**D2 — Module placement:** `buildInteractionTypeObject`/`labelsFromInteractionTypes` in `elementSkeletons.ts`, `addInteractionType` in `editCommands.ts`, following the identical shape/order used for `HierarchyType` (`buildHierarchyTypeObject` → `addHierarchyType`) — copy-pattern, no new abstraction introduced.

**D3 — Command registration surface:** `package.json` `contributes.commands` entry + one `view/item/context` menu entry with `group: "3_insert@07"` (next unused slot after hierarchy type's `@06`), `when` clause `view == reltioConfigTree && (viewItem == reltio.folder.interactionTypesFolder || viewItem == reltio.tenant.l3)`.

**D4 — Test strategy:** New, dedicated `scripts/test-insert-interaction-type.cjs` (Tier A: pure builder assertions, no VS Code/fixture dependency) rather than extending `scripts/test-no-create-wizards.cjs`, since this is its own OpenSpec change and the project convention is one test script per change.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Matrix doc drift (two files — `design.md` and `element-candidates.md` — describe the same row) | Update both in the same commit; this change's own tasks.md includes an explicit task for each file |
| `interactionTypesFolder` `viewItem` value doesn't exist in `treeNodes.ts`/`configSubtree.ts` | Verified during implementation before writing the `when` clause (same check performed for hierarchy types) |
| Bootstrap insert targets wrong array if `BOOTSTRAP_ROOT_ARRAY_KEYS` entry is misspelled | Reuse the literal model field name `interactionTypes` from `src/model/types.ts`, same as done for `hierarchyTypes` |

## Test plan

| Tier | Coverage | Location |
|------|----------|----------|
| A (automated, must pass) | `buildInteractionTypeObject` shape (`uri`, `label`, `attributes: []`); `labelsFromInteractionTypes` label/URI-tail extraction and empty-array handling | `scripts/test-insert-interaction-type.cjs` |
| C (manual QA, documented only) | Right-click **Interaction Types** folder → **Insert Interaction Type** → skeleton appears, editor reveals it, tree refreshes; right-click tenant root with zero interaction types → same command bootstraps the section; no regression on existing insert commands | `openspec/changes/insert-interaction-type/tasks.md` + this file |
