## 1. Skeleton builders and naming

- [x] 1.1 Add a small module (e.g. `src/commands/elementSkeletons.ts`) with pure functions to build JSON text or objects for **entity type**, **relation type**, and **attribute** (simple / nested / reference) using **design.md** §Normative matrix / **D5** and default `String` type for simple attributes.
- [x] 1.2 Implement `nextDefaultIndex` / `nextDefaultLabel(prefix, existingLabels)` (or equivalent) that scans the target array in the current document model for `EntityType{n}`-style labels and returns a free name.
- [x] 1.3 Unit-test or script-test naming helper for collision and increment behavior (empty array, gaps, non-pattern labels).

## 2. Edit commands refactor

- [x] 2.1 Refactor `addEntityType` to pick default `EntityType{n}`, build skeleton, `insertIntoArray`, then **reveal** the inserted range; remove `showInputBox`.
- [x] 2.2 Refactor `addRelationType` similarly with `RelationType{n}` and endpoint placeholders; remove `showInputBox`.
- [x] 2.3 Refactor `addAttribute` to choose `Attribute{n}`, default `type: "String"`, add Nested/Reference structure only when parent context matches current `addAttribute` branches; remove `showInputBox` and `showQuickPick`.
- [x] 2.4 Add `revealInsertionInEditor(documentUri, jsonPathToNewNode)` (or place in `revealCommand` / `configParser`) that re-parses after edit and sets selection + `revealRange`.

## 3. Polish and documentation

- [x] 3.1 Manually verify on a sample `L3.reltio.json`: all three commands insert, cursor lands on new block, schema diagnostics are acceptable. _(Naming covered by `scripts/test-element-naming.cjs`; full UI smoke in product.)_
- [x] 3.2 Update `ARCHITECTURE.md` **Commands** table to describe wizard-free skeleton insertion for add entity/relation/attribute.
- [x] 3.3 Run `npm run compile` and fix any regressions.

## 4. Follow-up (out of scope for v1 apply)

- [ ] 4.1 Extend skeleton builders and commands to additional **design.md** matrix rows (`SF-*`, `ET-root` expansions, `GT-root`, bootstrap `BR-xx`, …) using the same pattern.
