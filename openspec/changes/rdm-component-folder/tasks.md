## 1. RDM paths in the layout module

- [x] 1.1 Declare `RDM_DIR`, `RDM_CONFIG_FILENAME` and the RDM baseline directory in `src/workspace/tenantFolderStructure.ts`, beside `BUSINESS_CONFIG_FILE` and `BASELINE_FILE`
- [x] 1.2 Add pure helpers `rdmConfigPath(rdmTenantId)` → `RDM/{id}/config.json` and `rdmBaselinePath(rdmTenantId)` → `.reltio-ide/RDM/{id}.baseline.json`
- [x] 1.3 Leave the `RDM` entry in `COMPONENT_FOLDERS` as `managed: false` (design D6)

## 2. EnvironmentManager

- [x] 2.1 Repath `getRdmUri` and `getRdmBaselineUri` to the new helpers, still resolved through `tenantUri()`
- [x] 2.2 Rewrite `listRdmTenantIds` to enumerate `RDM/` subfolders that contain `config.json` (design D3)
- [x] 2.3 Make `writeRdm` and `writeRdmBaseline` create their parent directories before writing
- [x] 2.4 Keep the legacy filename helpers (`isRdmConfigurationFileName`, `rdmTenantIdFromFileName`, `rdmBaselineFileName`) for relocation, and add an accessor for the legacy root-level URIs
- [x] 2.5 Change `rdmFileName` to return the display path `RDM/{id}/config.json` so drift warnings name the real file

## 3. Relocation

- [x] 3.1 Create `src/workspace/rdmRelocation.ts` with `relocateLegacyRdmFiles(environmentManager)`: for each tenant, move root-level RDM config and baseline to their new paths, only when the destination does not exist (design D4)
- [x] 3.2 Return a summary of moves and conflicts; never overwrite, never delete a file whose destination was occupied
- [x] 3.3 Chain it after `runLayoutMigration` in the activation path, and refresh the tree when anything moved
- [x] 3.4 Report conflicts with a non-blocking notification naming the affected files

## 4. Fetch on connect

- [x] 4.1 Extract `fetchRdmForTenant(environmentName, tenantId, token)` in `src/extension.ts`: progress, `writeRdmFromApi`, 401 → `handle401` (design D5)
- [x] 4.2 Use it in Get Configuration in place of the inline continuation
- [x] 4.3 Call it from the sign-in auto-add flow after the Business Config is written and opened, only when the L3 write returned `'written'`
- [x] 4.4 Call it from **Add Tenant** after `writeL3FromApi` returns `'written'`

## 5. Schema binding

- [x] 5.1 Bind `**/RDM/*/config.json` to `schemas/reltio-rdm.schema.json` in `package.json`, keeping the legacy `RDM.*.reltio.json` binding and its L3 exclusion (design D7)

## 6. Tests

- [x] 6.1 Add `scripts/test-rdm-component-folder.cjs` covering the path helpers, and that the baseline path is under `.reltio-ide/`
- [x] 6.2 Cover relocation over a stubbed filesystem: move, idempotent repeat, destination-occupied conflict, and non-RDM files left alone
- [x] 6.3 Cover enumeration: `README.md` and subfolders without `config.json` are not RDM tenants
- [x] 6.4 Cover the manifest: new binding present, legacy binding and exclusion kept, `managed` model unchanged
- [x] 6.5 Update path expectations in `test-rdm-configuration-fetch.cjs` and any other RDM suite that pinned root-level names
- [x] 6.6 Register the new script in `scripts/run-unit-tests.cjs`
- [x] 6.7 Run `npm test` and confirm no new failures, including the layout's own suite

## 7. Documentation

- [x] 7.1 Update `ARCHITECTURE.md`: RDM files in the component tree, baselines in `.reltio-ide/`, relocation, fetch on connect; remove the "not yet reconciled" note
- [x] 7.2 Add RDM to the layout's tree diagram

## 8. Build and verification

- [x] 8.1 `npm run compile` — no TypeScript errors
- [x] 8.2 `npm run build` — bundles succeed
- [x] 8.3 `npm run package` — build a `.vsix` for manual QA
- [ ] 8.4 Manual QA: sign in so a tenant is auto-added and confirm `RDM/{id}/config.json` appears without running Get Configuration
- [ ] 8.5 Manual QA: **Add Tenant** and confirm the same
- [ ] 8.6 Manual QA: on a Git-bound tenant confirm the baseline is under `.reltio-ide/RDM/` and not listed by `git status`
- [ ] 8.7 Manual QA: open a workspace with root-level RDM files and confirm they are relocated and still shown in the tree
- [ ] 8.8 Manual QA: confirm the RDM schema validates `config.json`, and an unrelated `config.json` is unaffected
- [ ] 8.9 Manual QA: confirm lookup values, Add a new Lookup Type / Source, and Apply RDM Configuration still work
- [x] 8.10 `npx openspec validate rdm-component-folder --strict`

## Bugfix Round 1 — RDM not fetched when a tenant is first connected

Reported: connecting a tenant fetched its Business Config but not its RDM; only Get Configuration fetched RDM. Cause: the Setup Wizard (`src/ux/setupWizard.ts`) and Apply default environments (`src/workspace/applyDefaultEnvironments.ts`) receive `writeL3FromApi` as a dependency and call it themselves, so the per-call-site continuation added in group 4 never reached them.

- [x] B1.1 Add `connectTenantConfiguration` in `src/extension.ts`: write the Business Config, start the RDM fetch on `'written'`, return the Business Config result unchanged
- [x] B1.2 Hand it to the Setup Wizard and Apply default environments in place of the bare `writeL3FromApi`
- [x] B1.3 Route sign-in auto-add and Add Tenant through it too, replacing their hand-rolled continuations so there is one mechanism
- [x] B1.4 Confirm every `createTenant` caller now reaches RDM, and that the only direct Business Config write is inside `writeL3FromApi`
- [x] B1.5 Replace the connect assertions in `test-rdm-component-folder.cjs` with a guard on the hand-off itself: no dependency object may receive the bare writer
- [x] B1.6 Prove the guard fails when the original wizard bug is reintroduced, then restore
- [x] B1.7 Update design D5, the two spec requirements, and `ARCHITECTURE.md` for the four connect flows
- [ ] B1.8 Manual QA: connect a tenant through the Setup Wizard and confirm `RDM/{id}/config.json` appears without running Get Configuration
- [ ] B1.9 Manual QA: repeat through **Add Tenant**, and through browser sign-in auto-add
