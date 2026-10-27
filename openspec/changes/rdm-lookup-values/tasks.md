## 1. Fixture

- [x] 1.1 Sanitize the supplied `getLookupResponse.json` into `samples/rdm-lookup-values.sample.json`, replacing the real tenant id with the synthetic one already used by the other RDM fixtures and keeping the full nested shape
- [x] 1.2 Add `/getLookupResponse.json` to `.gitignore` alongside the other raw API responses pulled from live tenants

## 2. Model types

- [x] 2.1 Add `RdmSourceValue` (`code`, `value`, `enabled`, `canonicalValue`, `downStreamDefaultValue`) to `src/model/types.ts`, all optional except none, with an index signature for tenant-specific extras
- [x] 2.2 Add `RdmSourceMapping` (`source`, `values`)
- [x] 2.3 Add `RdmLookupValue` (`tenantId`, `type`, `code`, `enabled`, `sourceMappings`, `startDate`, `endDate`, `updatedBy`, `updateDate`, `version`) under the same tolerance rule
- [x] 2.4 Add the flattened `RdmLookupValueRow` (`code`, `source`, `valueAtSource`)

## 3. API layer

- [x] 3.1 Add `fetchRdmLookupValues(serviceUri, rdmTenantId, lookupTypeName, token)` to `src/api/reltioClient.ts` → `GET {toHttpsBase(serviceUri)}/lookups/{encoded rdmTenantId}/{encoded lookupTypeName}`, reusing `fetchWithTimeout`, `reltioHeaders` and the 401 → `ReltioApiError` pattern
- [x] 3.2 Return the parsed JSON; document that `toHttpsBase` applies the trusted-host allowlist because the service URI came from a server response
- [x] 3.3 Add the pure `flattenRdmLookupValues(response)` → `RdmLookupValueRow[]`, total over malformed input, with no `vscode` import (design D2)
- [x] 3.4 Cover the degenerate cases in the flattener: several values per source, empty `values`, absent `sourceMappings`, non-array response, non-object entries

## 4. Service URI cache

- [x] 4.1 Create `src/rdm/rdmServiceCache.ts` with get/set keyed by `{environmentName}::{tenantId}`, in memory only
- [x] 4.2 Populate it from `writeRdmFromApi` whenever `extractRdmConfig` yields a service URI
- [x] 4.3 Add a resolver used by the command: cache hit, else fetch the tenant physical configuration and populate, else report that lookup values are unavailable (design D1)
- [x] 4.4 Confirm nothing writes the service URI to disk

## 5. Panel

- [x] 5.1 Create `src/rdm/lookupValuesPanel.ts` following `entityDetailPanel`: single reusable panel, `getNonce()`, `default-src 'none'` CSP with nonce-gated `<style>`/`<script>`, `escapeHtml` on every interpolation
- [x] 5.2 Render the Code / Source / Value at Source table in response order, styled with VS Code theme variables
- [x] 5.3 Set the panel title to the lookup type name and retitle on reuse (design D4)
- [x] 5.4 Render an explicit empty-state message when there are no rows, distinct from a failure
- [x] 5.5 Include the unmodified response pretty-printed in a collapsed `<details>` (design D5)

## 6. Command and wiring

- [x] 6.1 Carry the lookup type name on `RdmItemNode` at construction so the command need not re-derive it from the URI (design D3)
- [x] 6.2 Register `reltio.getRdmLookupValues` in `src/extension.ts`: resolve the service URI, fetch, flatten, show the panel; guard on a missing environment token first
- [x] 6.3 Route a 401 from either the rediscovery or the lookups request to the existing `handle401`
- [x] 6.4 On failure, report the error and leave any open panel untouched — never render an empty table (design D6)
- [x] 6.5 Declare the command in `package.json` `contributes.commands` titled **Get Lookup Values**
- [x] 6.6 Add the `view/item/context` entry scoped to `viewItem == reltio.rdm.item.lookupTypes` only
- [x] 6.7 Verify the command does not appear on sources, RDM tenant rows, the RDM group, or L3 nodes

## 7. Tests

- [x] 7.1 Add `scripts/test-rdm-lookup-values.cjs` with Tier A coverage of `flattenRdmLookupValues` over the sanitized fixture: row count and contents derived from the fixture rather than hard-coded, response order preserved
- [x] 7.2 Add Tier A coverage of the degenerate cases from task 3.4, using constructed inputs so the tests do not encode the sample's one-value-per-source regularity
- [x] 7.3 Add Tier A coverage of URL construction, including encoding of both path segments and a scheme-less service URI
- [x] 7.4 Add Tier B coverage asserting the rendered HTML carries a `default-src 'none'` CSP with matching nonces, and that a value containing `<script>` and quotes is escaped
- [x] 7.5 Add Tier B coverage asserting `package.json` declares `reltio.getRdmLookupValues` with a menu entry scoped to `reltio.rdm.item.lookupTypes` and to nothing else
- [x] 7.6 Register `test-rdm-lookup-values.cjs` in the `SCRIPTS` registry in `scripts/run-unit-tests.cjs` (alphabetical position)
- [x] 7.7 Run `npm test` and confirm no new failures

## 8. Documentation

- [x] 8.1 Document the lookups endpoint in `ARCHITECTURE.md` beside the other RDM endpoints, including that it is on-demand only
- [x] 8.2 Note the in-memory service-URI cache and that nothing from the physical configuration reaches disk
- [x] 8.3 Add `src/rdm/` to the package structure table

## 9. Build and verification

- [x] 9.1 `npm run compile` — no TypeScript errors
- [x] 9.2 `npm run build` — bundles succeed
- [x] 9.3 `npm run package` — build a `.vsix` for manual QA
- [ ] 9.4 Manual QA: right-click a lookup type → **Get Lookup Values** opens a panel titled for it, showing Code / Source / Value at Source
- [ ] 9.5 Manual QA: confirm the command is absent on a source row, an RDM tenant row, the RDM group row, and an L3 node
- [ ] 9.6 Manual QA: open a second lookup type and confirm the same panel is retitled and repopulated
- [ ] 9.7 Manual QA: confirm a lookup type with no values shows the empty-state message rather than a blank table
- [ ] 9.8 Manual QA: with an expired token, confirm the 401 reaches the existing re-login flow
- [ ] 9.9 Manual QA: reload the window, then run the command without fetching first, and confirm rediscovery works
- [ ] 9.10 Manual QA: confirm Get Configuration still issues no lookups request
- [x] 9.11 `npx openspec validate rdm-lookup-values --strict`
