## 1. Skeleton builder

- [x] 1.1 In `buildAttributeObject` (`src/commands/elementSkeletons.ts`), add `dataLabelPattern: ''` to the `Nested` branch
- [x] 1.2 Add `relationshipLabelPattern: ''` to the `Reference` branch
- [x] 1.3 Confirm the `String` (simple) branch is untouched

## 2. Tests

- [x] 2.1 Add `scripts/test-attribute-skeleton-mandatory-fields.cjs` asserting Nested includes `dataLabelPattern`, Reference includes `relationshipLabelPattern`, and Simple includes neither
- [x] 2.2 Register the new script in `scripts/run-unit-tests.cjs`
- [x] 2.3 Run `npm test` and confirm all tests pass

## 3. Build & verify

- [x] 3.1 `npm run compile` — no TypeScript errors
- [x] 3.2 `npm run package` — build a `.vsix` for manual QA
- [x] 3.3 Manual QA: install the `.vsix`, insert a Nested Attribute and a Reference Attribute, confirm the new fields appear in the inserted JSON
- [x] 3.4 `npx openspec validate attribute-skeleton-mandatory-fields --strict`
