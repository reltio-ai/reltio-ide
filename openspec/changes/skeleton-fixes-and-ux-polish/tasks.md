## 1. Element skeleton completeness

- [x] 1.1 Add `dataLabelPattern: ''` to `buildEntityTypeObject` in `src/commands/elementSkeletons.ts`
- [x] 1.2 Add `graphStructure: ''` to `buildGraphTypeObject` in `src/commands/elementSkeletons.ts`
- [x] 1.3 Add `abbreviation`, `description`, and `icon` fields to `buildSourceObject` in `src/commands/elementSkeletons.ts`
- [x] 1.4 Update `schemas/reltio-metadata.schema.json` — extend `Source.required` to `["uri", "label", "abbreviation"]`

## 2. Apply-to-tenant source validation

- [x] 2.1 In `src/extension.ts`, add a pre-push validation block inside `applyL3ConfigurationToTenant` that filters sources missing `uri`, `label`, or `abbreviation` and shows a `showErrorMessage` naming the offenders, then returns early without pushing

## 3. Ontology context menu scoping

- [x] 3.1 In `package.json`, update the `showOntologyFromTree` command's `when` clause from `view == reltioConfigTree && viewItem =~ /^reltio\\.(item|folder)\\./` to `view == reltioConfigTree && (viewItem == reltio.folder.entityTypesFolder || viewItem == reltio.folder.relationTypesFolder)`

## 4. Build and verify

- [ ] 4.1 Run `npm run compile` and confirm zero TypeScript errors
- [ ] 4.2 Manually verify: insert a new entity type — confirm `dataLabelPattern` is present in the inserted JSON
- [ ] 4.3 Manually verify: insert a new graph type — confirm `graphStructure` is present
- [ ] 4.4 Manually verify: insert a new source — confirm all five fields (`uri`, `label`, `abbreviation`, `description`, `icon`) are present
- [ ] 4.5 Manually verify: attempt Apply Configuration with a source missing `label` — confirm push is blocked with a descriptive error
- [ ] 4.6 Manually verify: right-click the Entity Types folder — "Show Ontology" is visible; right-click an individual entity type item — "Show Ontology" is NOT visible
