## 1. Ancestor-aware contextValue

- [x] 1.1 Update `contextValueFor` in `src/tree/treeNodes.ts` to accept `jsonPath` and append `.relationType` for `attributesFolder` / `nestedAttribute` nodes when `jsonPath[0] === 'relationTypes'`
- [x] 1.2 Update the `ConfigTreeItem` constructor call site to pass `jsonPath` into `contextValueFor`

## 2. Context menu `when` clauses

- [x] 2.1 Remove `viewItem == reltio.item.relationType` from `reltio.insertReferenceAttribute`'s `when` clause in `package.json`
- [x] 2.2 Add `viewItem == reltio.folder.attributesFolder.relationType` and `viewItem == reltio.item.nestedAttribute.relationType` to `reltio.insertSimpleAttribute`'s `when` clause
- [x] 2.3 Add the same two clauses to `reltio.insertNestedAttribute`'s `when` clause

## 3. Tests

- [x] 3.1 Add `scripts/test-hide-reference-attribute-for-relation-types.cjs` asserting `contextValue` for entity-type vs. relation-type `attributesFolder` and `nestedAttribute` nodes
- [x] 3.2 Register the new script in `scripts/run-unit-tests.cjs`
- [x] 3.3 Run `npm test` and confirm all tests pass

## 4. Documentation

- [x] 4.1 Update `openspec/changes/no-create-wizards/design.md` RT-root row to resolve the "same split as entity?" open question
- [x] 4.2 Update `openspec/changes/no-create-wizards/element-candidates.md` RT-root row to match

## 5. Build & verify

- [x] 5.1 `npm run compile` — no TypeScript errors
- [x] 5.2 `npm run package` — build a `.vsix` for manual QA
- [x] 5.3 Manual QA: install the `.vsix`, confirm Insert Reference Attribute is hidden for relation types (item, Attributes folder, nested attribute) and still shown for entity types
- [x] 5.4 `npx openspec validate hide-reference-attribute-for-relation-types --strict`
