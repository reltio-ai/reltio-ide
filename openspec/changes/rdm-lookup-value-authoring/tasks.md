## 1. Batch validation, request body and reconciliation

- [x] 1.1 Create `src/rdm/lookupValueDraft.ts` with no `vscode` import: `parseLookupValuesMessage(message)` → validated values or a list of errors, accepting only `submitLookupValues` and `ready`, and rejecting unknown types, wrong field types and non-object input (design D2)
- [x] 1.2 Validate the batch per design D6: at least one code; each code required, trimmed, no `/`, not repeated in the batch; at least one mapping per code; each mapping has a source and a value; no source repeated within a code; errors name block position and code
- [x] 1.3 Add `buildLookupValuesUpdateBody(values, context)` producing one element per code in form order (design D3), with `type` from the carried lookup type URI, a blank mapping code defaulting to its block's code, mapping order preserved, and no `updatedBy` / `updateDate` / `version`
- [x] 1.4 Add `findExistingCodes(codes, lookupsResponse)` — every submitted code present in a fetched lookups response, by exact match (design D4)
- [x] 1.5 Add `reconcileSubmittedCodes(codes, lookupsResponse)` → `{ landed, notLanded }` in submission order (design D7)

## 2. API

- [x] 2.1 Add `postRdmLookupValues(serviceUri, rdmTenantId, body, token)` to `src/api/reltioClient.ts` → `POST {toHttpsBase(serviceUri)}/lookups/{encoded rdmTenantId}/_update`, JSON body, 401 → `ReltioApiError`, other failures through the existing error-body formatter (design D5)

## 3. Lookup type URI to the panel

- [x] 3.1 Carry the lookup type's `uri` on `RdmItemNode` (already shown as its description) as a typed field
- [x] 3.2 Add it to the panel context so the request's `type` is the server's own value

## 4. Panel

- [x] 4.1 Enable scripts on the lookup values panel with `localResourceRoots: []`; policy `default-src 'none'; style-src 'nonce-…'; script-src 'nonce-…'` (design D1)
- [x] 4.2 Render **Add Value**, a hidden form container, **Add Code**, Submit and Cancel; no inline handlers
- [x] 4.3 Offer source suggestions through a `<datalist>`: sources used by this lookup type plus sources in the tenant's RDM configuration on disk, free text allowed (design D6)
- [x] 4.4 Write the nonce'd script: build code blocks and mapping rows with DOM APIs from user input or from a restore message (one code path, no `innerHTML`), add and remove blocks and rows, apply row defaults, post `submitLookupValues` with the render token, disable Submit while in flight (validation stays in the extension — design D6)
- [x] 4.5 Capture `window.origin` at start and ignore messages from any other origin; post `ready` on start; handle `submitResult` (inline message, re-enable Submit) and `restoreForm` (rebuild blocks, show message, or show the added-count note and keep the form closed)
- [x] 4.6 Keep the panel's existing reuse, title, table, empty state and raw-response section unchanged

## 5. Extension wiring

- [x] 5.1 Record the render context (environment, tenant, RDM tenant, lookup type name and URI) per render, and handle panel messages against the context of the render they belong to (design D2)
- [x] 5.2 On `submitLookupValues`: validate, resolve the service URI via `resolveRdmServiceUri`, re-fetch the lookup type, refuse the batch if any code exists (naming each), then post once (design D3, D4)
- [x] 5.3 After the post, re-fetch and reconcile; re-render the panel and hold the not-landed values and message as a pending restore for that render, sent once on its `ready` (design D7)
- [x] 5.4 If the re-fetch fails, keep the form and report the unconfirmed outcome via `submitResult`; if the panel was re-rendered for something else meanwhile, report landed and not-landed codes in a notification instead
- [x] 5.5 Report pre-post refusals as `submitResult`, keeping the form open; route any 401 to `handle401`
- [x] 5.6 Confirm no new command or menu entry is contributed

## 6. Tests

- [x] 6.1 Add `scripts/test-rdm-lookup-value-authoring.cjs` with Tier A coverage of batch validation: every rejection in design D6, the same source across codes accepted, error location text, malformed messages
- [x] 6.2 Add Tier A coverage of body construction (the `PRIMARY` example minus server-managed fields; three codes in form order), of `findExistingCodes`, and of `reconcileSubmittedCodes` for all, some and none landed
- [x] 6.3 Add Tier B coverage of the rendered panel: exact policy, one nonce'd script, no `on…=` attributes, Add Value / Add Code / Submit / Cancel present, markup in data inert, origin check present, no `innerHTML` in the script
- [x] 6.4 Add Tier B coverage that `postRdmLookupValues` targets `…/lookups/{rdmTenantId}/_update` and that no command was added
- [x] 6.5 Confirm `test-rdm-lookup-values.cjs` still passes with scripts enabled
- [x] 6.6 Register the script in `scripts/run-unit-tests.cjs`; run `npm test` and confirm no new failures

## 7. Documentation

- [x] 7.1 Document the update endpoint, the Add Value form, batch reconciliation and the panel's message protocol (`ready`, `submitLookupValues`, `submitResult`, `restoreForm`) in `ARCHITECTURE.md`, and note that the panel now runs a script under the repository's webview rules

## 8. Build and verification

- [x] 8.1 `npm run compile` — no TypeScript errors
- [x] 8.2 `npm run build` — bundles succeed
- [x] 8.3 Package a `.vsix` for manual QA
- [ ] 8.4 Manual QA: add one code with two mappings and confirm the service accepts a body without `updatedBy` / `updateDate` / `version` (design D3 open question)
- [ ] 8.5 Manual QA: add three codes in one submission; confirm the table shows all three, the form closes, and Get Lookup Values shows them again later
- [ ] 8.6 Manual QA: include one existing code in a batch and confirm nothing is sent and the code is named
- [ ] 8.7 Manual QA: if the service can be made to reject one element, confirm only that block stays in the form; record whether `_update` is all-or-nothing (design open question)
- [ ] 8.8 Manual QA: submit an incomplete mapping and confirm the located inline error with the form intact
- [ ] 8.9 Manual QA: with an expired token, confirm the 401 reaches the re-login flow and the form is kept
- [ ] 8.10 Manual QA: switch the panel to another lookup type during a submission and confirm the notification
- [x] 8.11 `npx openspec validate rdm-lookup-value-authoring --strict`

## Bugfix Round 1 — values reported as "accepted but not stored"

Reported in manual QA: adding one code (`Partner`) showed "Nothing was added: the service accepted the request but did not store Partner." See design D8.

- [x] B1.1 Create codes with the create endpoint, not `_update` — root cause: `_update` is Reltio's partial-update endpoint (every mapping value needs an `operation`; it does not create codes), so a request without `operation` was accepted and nothing was applied. `postRdmLookupValues` → `POST {serviceUri}/lookups/{rdmTenantId}`, the endpoint of the team's working "Update RDM Lookup Mapping" request (no `/rdm`, no `_update`); body is a plain array of `{ tenantId, type, code, enabled, sourceMappings, startDate: 0, endDate: 0 }` without the `uri` / `value` wrapper (that is the response shape the supplied example came from) and without `updatedBy` / `updateDate` / `version` (design D3, D5, D8)
- [x] B1.2 Judge what was stored from the create response as well as the re-fetch — the documented create response returns `{ uri, value }` per stored code; a code counts as added if either lists it, and when only the response does, the message says it may take a moment to appear in the table (design D7)
- [x] B1.3 Suggest configured sources by `abbreviation` — a mapping's `source` must match the source's abbreviation, but suggestions used the trailing segment of its `uri`; fall back to the `uri` segment only when there is no abbreviation (design D6)
- [x] B1.4 Cap a submission at 100 codes — the documented per-request maximum for create; reject a larger form in validation, before any request (design D6)
- [x] B1.5 Update `spec.md` (endpoint, body, how the outcome is judged, the 100-code cap), `proposal.md`, `ARCHITECTURE.md` and `scripts/test-rdm-lookup-value-authoring.cjs`; `npm test`, `npm run compile`, `npm run build`, package a `.vsix`; `openspec validate --strict`
- [ ] B1.6 Manual QA: add `Partner` again — if the earlier attempt was stored after all, the pre-flight now names it as existing; otherwise it is added and appears in the table. Then add three codes in one submission

## Bugfix Round 2 — cannot add a source to an existing code

Reported in manual QA: adding source `DnB` to existing code `A` in `OrganizationStatuses` was refused: "Already in OrganizationStatuses: A. Nothing was sent; adding it would replace the existing mappings." See design D9.

- [x] B2.1 Append to existing codes instead of refusing them — root cause: D4 refused any existing code because the create endpoint replaces a code's whole value. Add a pure `mergeLookupValue(existing, draft)` to `src/rdm/lookupValueDraft.ts` that starts from the fetched value with every field kept, appends new sources and new codes at a source, reports already-present mappings and conflicts, and never changes or removes a stored entry (design D9)
- [x] B2.2 Keep stored flags — an appended value is canonical only if the code has no canonical value, and downstream default only if its source has none; report each flag not applied (design D9)
- [x] B2.3 Panel flow — after the fresh fetch, merge each existing code, refuse the submission when any mapping conflicts (naming code, source and both values), send nothing when everything is already present, and post merged existing values together with new codes in chunks of ≤ 100 (design D9)
- [x] B2.4 Judge stored per mapping — a code counts as stored when the response or re-fetch holds it with every requested source and code at the source; messages name codes added, codes appended to, and flags not applied (design D7, D9)
- [x] B2.5 Update `spec.md` (replace "Only new codes can be added" with the append requirement and its scenarios), `proposal.md`, `ARCHITECTURE.md` and `scripts/test-rdm-lookup-value-authoring.cjs` (merge rules, conflicts, flags, nothing removed, stored-per-mapping); `npm test`, compile, build, package; `openspec validate --strict`
- [ ] B2.6 Manual QA: add `DnB` to existing code `A` — the `Reltio` mapping is unchanged and `DnB` appears; repeat — "already present", nothing sent; give `DnB` a different value for the same code at source — refused as a conflict; record whether a stale `version` is rejected
