## 1. Fixtures

- [x] 1.1 Sanitize the working physical-config sample into `samples/tenant-physical-config.sample.json`: keep `rdmConfig`, `tenantId` and enough surrounding structure to be representative; redact the messaging `provider` credential string, Spanner service-account identifiers and `databaseId`, and internal Elasticsearch hostnames
- [x] 1.2 Sanitize the working RDM sample into `samples/rdm-config.sample.json`, preserving all 8 top-level keys and a representative slice of `lookupTypes` and `sources`
- [x] 1.3 Confirm neither root working copy (`GetTenantPhysicalConfig.json`, `RDM_Config.json`) is staged for commit, and add both to `.gitignore` if they are expected to stay in the working tree

## 2. Model types

- [x] 2.1 Add `RdmLookupType` (`uri`, `label`, `enabled`, `startDate`, `endDate`) to `src/model/types.ts`, with every property optional except `uri` and an index signature or equivalent tolerance for tenant-specific extras
- [x] 2.2 Add `RdmSource` (`uri`, `label`, `abbreviation`, `canonicalValueProvider`) under the same tolerance rule
- [x] 2.3 Add `RdmConfiguration` with the recognized top-level properties, all optional, so a tenant whose configuration omits or adds keys still parses
- [x] 2.4 Add a narrow `TenantPhysicalConfiguration` shape covering only `rdmConfig` (`serviceUri`, `rdmTenants[].rdmTenantId`) — deliberately not `oauthInstance` or the other `rdmConfig` flags, per design D5

## 3. API layer

- [x] 3.1 Add `fetchTenantPhysicalConfiguration(baseUrl, tenantId, token)` to `src/api/reltioClient.ts` → `GET {root}/reltio/tenants/{encoded tenantId}`, reusing `toHttpsBase`, `fetchWithTimeout`, `reltioHeaders`, and the 401 → `ReltioApiError` pattern; return parsed JSON
- [x] 3.2 Add the pure `extractRdmConfig(json)` → `{ serviceUri?: string; rdmTenantIds: string[] }`, total over malformed input, with no `vscode` import and no network access
- [x] 3.3 Add `fetchRdmConfiguration(serviceUri, rdmTenantId, token)` → `GET {toHttpsBase(serviceUri)}/configuration/{encoded rdmTenantId}`, returning `res.text()` to mirror `fetchL3Configuration`
- [x] 3.4 Verify both new functions map 401 to `ReltioApiError` with status 401 so the existing session-expiry path can recognize them

## 4. RDM JSON Schema

- [x] 4.1 Create `schemas/reltio-rdm.schema.json` type-checking the recognized top-level properties, `lookupTypes` items (requiring `uri`), and `sources` items (requiring `uri`) — with **no** `additionalProperties: false` at any level and no array length constraints, per design D11, since RDM configurations vary per tenant and the schema is derived from a limited sample
- [x] 4.2 Add the `jsonValidation` entry binding `RDM.*.reltio.json` → `schemas/reltio-rdm.schema.json` in `package.json`
- [x] 4.3 Narrow the existing L3 entry to `"fileMatch": ["*.reltio.json", "!RDM.*.reltio.json"]`
- [x] 4.4 Validate the sanitized RDM fixture against the new schema and confirm it passes with no errors
- [x] 4.5 Validate a constructed configuration carrying an unrecognized top-level property and an unrecognized property on a `lookupTypes` item, and confirm both are tolerated

## 5. Workspace layer

- [x] 5.1 Add `getRdmUri(environment, tenantId, rdmTenantId)` to `EnvironmentManager` resolving `RDM.{rdmTenantId}.reltio.json` inside the tenant folder
- [x] 5.2 Add `writeRdm(environment, tenantId, rdmTenantId, content)` following the `writeL3` pattern
- [x] 5.3 Add `getRdmBaselineUri()` and `writeRdmBaseline()` resolving and writing `RDM.{rdmTenantId}.remote-baseline.reltio.json`, mirroring `getRemoteBaselineUri` / `writeRemoteBaseline`
- [x] 5.4 Add `listRdmConfigurationFiles(environment, tenantId)` returning the existing `RDM.*.reltio.json` files in the tenant folder, excluding `*.remote-baseline.reltio.json`, so the drift guard can enumerate them
- [x] 5.5 Add `hasRdm` to `TenantInfo` and populate it in `scanTenants` from that enumeration

## 6. Orchestration and wiring

- [x] 6.1 Add `writeRdmFromApi(environmentName, tenantId, token)` to `src/extension.ts` returning `'written' | 'none' | '401' | 'error'`, chaining physical-config fetch → `extractRdmConfig` → per-RDM-tenant fetch → `prettyPrintJsonIfPossible` → `writeRdm` + `writeRdmBaseline`
- [x] 6.2 Return `'none'` and stay completely silent when the tenant has no usable `rdmConfig`, per design D3 — no modal, no notification, no file
- [x] 6.3 Loop over every id in `rdmTenantIds`, writing a configuration and baseline for each; a failure on one id must not abort the others
- [x] 6.4 Revert any already-open target document, then call `treeProvider.refresh()` and `uxBus.fire()`
- [x] 6.5 Call `writeRdmFromApi` from the **`reltio.fetchL3` command handler** after `writeL3FromApi` returns `'written'` — explicitly **not** from inside `writeL3FromApi`, so the post-SSO auto-add and apply-defaults paths are untouched (design D1)
- [x] 6.6 Report an RDM failure on its own without discarding the successful L3 result, and skip the RDM chain entirely when the L3 fetch did not succeed (design D2)
- [x] 6.7 Route a `'401'` result from either request to the existing `handle401(environmentName)`
- [x] 6.8 Extend the pre-fetch drift guard in the `reltio.fetchL3` handler to enumerate existing RDM files and compare each against its baseline, treating a missing baseline as drifted
- [x] 6.9 Present a single combined warning naming every drifted file (L3 and RDM), rather than one prompt per file (design D9); declining writes nothing at all
- [x] 6.10 Skip the RDM chain when the user picks "Apply my changes instead" from the review path, since that pushes L3 rather than fetching
- [x] 6.11 Verify no new command or menu entry is added to `package.json` — this change contributes only `jsonValidation` entries

## 7. Tests

- [x] 7.1 Add `scripts/test-rdm-configuration-fetch.cjs` with Tier A coverage of `extractRdmConfig`: happy path from the sanitized fixture, plus absent `rdmConfig`, absent/empty `serviceUri`, missing/empty `rdmTenants`, entries missing `rdmTenantId`, and a constructed multi-entry input returning all ids in order. Derive assertions from each input — do not hard-code the sample tenant's identifiers or any lookup type or source count
- [x] 7.2 Add Tier A coverage asserting the sanitized RDM fixture validates against the RDM schema, and that a configuration with unrecognized top-level and item-level properties also validates while a `lookupTypes` item without `uri` does not
- [x] 7.3 Add Tier B coverage asserting `package.json` binds `RDM.*.reltio.json` to the RDM schema and excludes that pattern from the L3 entry, and that **no** RDM-specific command or menu entry was introduced
- [x] 7.4 Add Tier A coverage of the drift-guard predicate over a constructed tenant folder: clean files produce no warning; a drifted RDM file and a missing baseline each do; the result names every affected file
- [x] 7.5 Add Tier B coverage asserting `schemas/reltio-rdm.schema.json` is valid JSON and is included in packaging
- [x] 7.6 Register `test-rdm-configuration-fetch.cjs` in the `SCRIPTS` registry in `scripts/run-unit-tests.cjs` (alphabetical position)
- [x] 7.7 Run `npm test` and confirm all scripts pass

## 8. Documentation

- [x] 8.1 Update `ARCHITECTURE.md` with the two new endpoints under the Reltio API integration notes, including that the physical configuration is fetched transiently and never persisted
- [x] 8.2 Update the tenant-folder file layout in `ARCHITECTURE.md` to include `RDM.{rdmTenantId}.reltio.json` and `RDM.{rdmTenantId}.remote-baseline.reltio.json`
- [x] 8.3 Note in `ARCHITECTURE.md` that Get Configuration now fetches RDM as a continuation, and that `writeL3FromApi` is deliberately not the attachment point

## 9. Build and verification

- [x] 9.1 `npm run compile` — no TypeScript errors
- [x] 9.2 `npm run build` — extension host and webview bundles succeed
- [x] 9.3 `npm run package` — build a `.vsix` for manual QA
- [ ] 9.4 Manual QA: run **Get Configuration** on a tenant with RDM; confirm `L3.reltio.json`, `RDM.{rdmTenantId}.reltio.json` and both baselines appear pretty-printed in the tenant folder, and the RDM file opens with no schema errors
- [ ] 9.5 Manual QA: confirm the `fileMatch` exclusion actually takes effect in the Extension Development Host — the RDM file shows no L3 errors and `L3.reltio.json` in the same folder still validates against the L3 schema. If the exclusion is not honored, fall back to design D6's alternative filename and update the spec delta
- [ ] 9.6 Manual QA: run Get Configuration on a tenant without RDM and confirm no RDM file and **no notification of any kind** about RDM
- [ ] 9.7 Manual QA: confirm no physical-configuration file is left anywhere in the workspace after a fetch
- [ ] 9.8 Manual QA: with an expired token, confirm a 401 from either request reaches the existing re-login flow
- [ ] 9.9 Manual QA: edit an RDM file locally, re-run Get Configuration, and confirm a single warning naming that file appears; decline and confirm nothing was overwritten; accept and confirm the file and baseline are refreshed
- [ ] 9.10 Manual QA: sign in so a tenant is auto-added post-SSO, and confirm the login flow fetches L3 only, with no RDM request
- [ ] 9.11 Manual QA: confirm Apply still works on a tenant that has RDM files present, and does not read or push them
- [x] 9.12 `npx openspec validate rdm-configuration-fetch --strict`
