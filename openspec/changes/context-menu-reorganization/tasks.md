## 1. Title renames

- [x] 1.1 `reltio.fetchL3`: "Fetch Configuration" → "Get Configuration"
- [x] 1.2 `reltio.fetchConfigurationHistory`: "Fetch Configuration History" → "View Configuration History"
- [x] 1.3 All "Insert X" command titles → "Add a new X" (`addEntityType`, `addRelationType` → "Add a new Relationship Type", and every `insert*` command)

## 2. Tenant node menu reorder

- [x] 2.1 Regroup `fetchL3` / `fetchConfigurationHistory` into `3_getconfig@01` / `3_getconfig@02`
- [x] 2.2 Regroup `applyL3Configuration` into its own `4_apply` group
- [x] 2.3 Regroup and reorder the 7 top-level insert commands into `5_insert@01..07` in the ticket's order (Entity, Relationship, Interaction, Hierarchy, Graph, Grouping, Source)
- [x] 2.4 Regroup `copyTenantId` into `8_tenantid`
- [x] 2.5 Confirm `removeTenant`'s `9_delete` group is unchanged (already last)

## 3. Tests

- [x] 3.1 Add `scripts/test-context-menu-reorganization.cjs` asserting renamed titles and tenant-node group ordering
- [x] 3.2 Register the new script in `scripts/run-unit-tests.cjs`
- [x] 3.3 Run `npm test` and confirm all tests pass

## 4. Build & verify

- [x] 4.1 `npm run compile` — no TypeScript errors
- [x] 4.2 `npm run package` — build a `.vsix` for manual QA
- [x] 4.3 Manual QA: install the `.vsix`, right-click a tenant with L3 fetched, confirm the 4-section layout and renamed titles
- [x] 4.4 `npx openspec validate context-menu-reorganization --strict`
