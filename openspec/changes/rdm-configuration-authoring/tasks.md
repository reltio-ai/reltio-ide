## 1. Make the L3 insertion machinery reusable

- [x] 1.1 Export `insertIntoArray` from `src/commands/editCommands.ts` and add a parameter for the creatable-root-array allowlist, replacing the hard-coded `BOOTSTRAP_ROOT_ARRAY_KEYS` lookup (design D1)
- [x] 1.2 Pass the existing `BOOTSTRAP_ROOT_ARRAY_KEYS` from every current L3 caller so their behaviour is unchanged
- [x] 1.3 Export `revealInsertionInEditor` if it is not already reachable from outside the module
- [x] 1.4 Run the L3 insert tests (`no-create-wizards`, `insert-interaction-type`, `attribute-skeleton-mandatory-fields`, `skeleton-fixes-and-ux-polish`) and confirm they still pass

## 2. RDM skeletons

- [x] 2.1 Create `src/rdm/rdmSkeletons.ts` with pure `buildRdmLookupTypeObject(label)` returning `{ uri, label, enabled: true, startDate: 0, endDate: 0 }` with `uri` = `rdm/lookupTypes/{label}`
- [x] 2.2 Add pure `buildRdmSourceObject(label)` returning `{ uri, label, abbreviation, canonicalValueProvider: false }` with `uri` = `rdm/sources/{label}`
- [x] 2.3 Add `labelsFromRdmLookupTypes(model)` and `labelsFromRdmSources(model)`, tolerating absent, empty and malformed sections
- [x] 2.4 Reuse `nextDefaultLabel` from `elementSkeletons` for `LookupType{n}` / `Source{n}` so RDM numbers the same way L3 does

## 3. RDM insert commands

- [x] 3.1 Create `src/rdm/rdmEditCommands.ts` with `addRdmLookupType(rdmFileUri)` and `addRdmSource(rdmFileUri)`: read the document, parse with `parseRdmDocument`, pick the default label, build the skeleton, insert via `insertIntoArray` with an allowlist of exactly `lookupTypes` and `sources`
- [x] 3.2 Reveal the inserted block via `revealInsertionInEditor` on success
- [x] 3.3 Confirm an absent target array is created, and that a key outside the passed allowlist is refused
- [x] 3.4 Refresh the tree after a successful insert so a newly created section appears

## 4. PUT endpoint

- [x] 4.1 Add `putRdmConfiguration(serviceUri, rdmTenantId, body, token)` to `src/api/reltioClient.ts` → `PUT {toHttpsBase(serviceUri)}/configuration/{encoded rdmTenantId}` with `Content-Type: application/json`
- [x] 4.2 Map 401 to `ReltioApiError` with status 401; on other failures reuse `formatPutConfigurationFailureMessage` against the response body (design D6)

## 5. Apply command

- [x] 5.1 Add `applyRdmConfiguration(node)` in `src/extension.ts`: save the document if dirty, then require an RDM baseline — report that a fetch is needed first when absent, and send nothing
- [x] 5.2 Resolve the service URI through the existing `resolveRdmServiceUri` helper, routing `'401'` to `handle401`
- [x] 5.3 Re-fetch the remote RDM configuration and compare it against the baseline with `remoteMatchesBaseline`
- [x] 5.4 When the server matches the baseline, confirm with a **View changes** option that opens a remote-versus-local diff
- [x] 5.5 When the server has drifted, require review of the diff before an explicit confirmation (design D4)
- [x] 5.6 PUT the document text as saved, not a re-serialization (design D7)
- [x] 5.7 On success write the pushed content to the RDM baseline and leave the configuration file untouched
- [x] 5.8 On failure modify nothing and surface the service's error detail

## 6. Command registration and menus

- [x] 6.1 Register `reltio.addRdmLookupType`, `reltio.addRdmSource` and `reltio.applyRdmConfiguration` in `src/extension.ts`, each guarding on a missing environment token first
- [x] 6.2 Declare the three commands in `package.json` titled **Add a new Lookup Type**, **Add a new Source** and **Apply RDM Configuration**
- [x] 6.3 Scope the Add entries to `reltio.rdm.folder.lookupTypes` / `reltio.rdm.folder.sources` respectively, and both additionally to `reltio.rdm.root`
- [x] 6.4 Scope Apply to `reltio.rdm.root` only
- [x] 6.5 Confirm none of the three is offered on an entry, the `RDM` group row, or any L3 node

## 7. Tests

- [x] 7.1 Add `scripts/test-rdm-configuration-authoring.cjs` with Tier A coverage of both skeleton builders against the exact shapes in the spec, including `uri` derivation from the label
- [x] 7.2 Add Tier A coverage of default naming: first label, increment past an existing one, and label collection over absent, empty and malformed sections
- [x] 7.3 Add Tier A coverage of `insertIntoArray` with an explicit allowlist: insert into an existing array, create an absent one, refuse a key outside the allowlist
- [x] 7.4 Add Tier B coverage asserting the three commands are declared and scoped exactly as specified, and that none matches an L3 context value
- [x] 7.5 Confirm the `rdm-tree-view` guard that no RDM context value matches `/^reltio\.item\./` still passes unchanged (design D5)
- [x] 7.6 Register the script in `scripts/run-unit-tests.cjs` (alphabetical position)
- [x] 7.7 Run `npm test` and confirm no new failures

## 8. Documentation

- [x] 8.1 Document the RDM PUT endpoint in `ARCHITECTURE.md` beside the other RDM endpoints
- [x] 8.2 Update the RDM sub-tree note: it is no longer read-only, and record why the `reltio.rdm.*` namespace matters more now
- [x] 8.3 Note that RDM baselines are now the drift oracle for Apply RDM Configuration

## 9. Build and verification

- [x] 9.1 `npm run compile` — no TypeScript errors
- [x] 9.2 `npm run build` — bundles succeed
- [x] 9.3 `npm run package` — build a `.vsix` for manual QA
- [ ] 9.4 Manual QA: add a lookup type from the Lookup Types folder; confirm the block appears in the RDM file, is revealed, validates against the RDM schema, and a second insert yields `LookupType2`
- [ ] 9.5 Manual QA: add a source from the `{rdmTenantId}` row on a configuration with no `sources` key, and confirm the array is created
- [ ] 9.6 Manual QA: edit the new entry's label, run **Apply RDM Configuration**, confirm the pre-flight appears and the PUT succeeds
- [ ] 9.7 Manual QA: re-fetch and confirm the server now returns the added entry
- [ ] 9.8 Manual QA: delete the baseline, run Apply, and confirm it asks for a fetch first and sends nothing
- [ ] 9.9 Manual QA: change the RDM tenant from another client, then Apply, and confirm the drift warning and diff
- [ ] 9.10 Manual QA: confirm no Delete or Rename appears on any RDM node, and that L3 Apply is unaffected
- [ ] 9.11 Manual QA: with an expired token, confirm the 401 reaches the existing re-login flow
- [x] 9.12 `npx openspec validate rdm-configuration-authoring --strict`
