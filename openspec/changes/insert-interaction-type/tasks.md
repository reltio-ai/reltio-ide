## 1. Skeleton builder

- [x] 1.1 Add `labelsFromInteractionTypes(items)` and `buildInteractionTypeObject(label)` to `src/commands/elementSkeletons.ts`, placed near `labelsFromHierarchyTypes`/`buildHierarchyTypeObject`. Skeleton: `{ uri: 'configuration/interactionTypes/{label}', label, attributes: [] }` (see design.md D1).

## 2. Edit command handler

- [x] 2.1 Add `addInteractionType(documentUri, ast)` to `src/commands/editCommands.ts`, mirroring `addHierarchyType` exactly (see design.md D2).
- [x] 2.2 Add `'interactionTypes'` to `BOOTSTRAP_ROOT_ARRAY_KEYS`.

## 3. Command registration

- [x] 3.1 Add `reltio.insertInteractionType` to `contributes.commands` in `package.json` (title "Insert Interaction Type").
- [x] 3.2 Add a `view/item/context` menu entry with `group: "3_insert@07"` and `when: "view == reltioConfigTree && (viewItem == reltio.folder.interactionTypesFolder || viewItem == reltio.tenant.l3)"` (see design.md D3).
- [x] 3.3 Register `reltio.insertInteractionType` in `src/extension.ts`, copying the `reltio.insertHierarchyType` registration shape exactly.

## 4. Tests

- [x] 4.1 Add `scripts/test-insert-interaction-type.cjs` asserting `buildInteractionTypeObject` shape and `labelsFromInteractionTypes` behavior (empty array, populated array, missing label falls back to URI tail) — Tier A, no VS Code dependency (see design.md D4).
- [x] 4.2 Register the new script in `scripts/run-unit-tests.cjs`.
- [x] 4.3 Run `npm test` — confirm the new script passes and no existing script regresses. _(Passed; the only failure is the pre-existing, unrelated `test-skills-and-enablement-packs-library.cjs` velocity-pack manifest byte-count mismatch present on a clean `develop` pull before this change.)_

## 5. Documentation

- [x] 5.1 Update `ARCHITECTURE.md`'s commands table row for the insert-element commands to include `insertInteractionType`.
- [x] 5.2 Update `openspec/changes/no-create-wizards/element-candidates.md` — flip `SF-interactionTypes` from planned to implemented; add the corresponding `BR-xx` bootstrap row.
- [x] 5.3 Update `openspec/changes/no-create-wizards/design.md` §2 — flip `SF-interactionTypes` from `*TBD*` to the concrete action, matching `element-candidates.md`. Also backfill `SF-hierarchyTypes` in this same file (missed during RP-189635 — only `element-candidates.md` was updated then).

## 6. Verification

- [x] 6.1 `npm run compile` — must be clean.
- [ ] 6.2 Package (`npm run package`) and install the `.vsix` locally; confirm: right-click **Interaction Types** folder / tenant root → **Insert Interaction Type** → skeleton inserted with next default label → editor reveals it → tree refreshes. _(vsix built at `target/reltio-ide-1.0.8.vsix`; manual install/QA pending — Tier C, user to confirm.)_
- [ ] 6.3 Confirm no regression on existing insert commands (entity/relation/grouping/graph/source/hierarchy type). _(pending manual QA alongside 6.2.)_
- [x] 6.4 `openspec validate insert-interaction-type` passes.
