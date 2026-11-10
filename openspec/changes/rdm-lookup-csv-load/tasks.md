## 1. CSV parsing and conversion (pure)

- [x] 1.1 Create `src/rdm/lookupCsv.ts` with no `vscode` import: an RFC 4180 parser returning rows with line numbers — quotes, `""`, commas and line breaks in quotes, CRLF/LF, BOM dropped, blank lines ignored, unbalanced quotes reported (design D4)
- [x] 1.2 Match header columns by name (case and spaces ignored, any order); required `Code`, `Source`, `Value at Source`; optional `Code at Source`, `Canonical`, `Downstream Default`; other columns ignored with a warning
- [x] 1.3 Convert rows to `LookupValueDraft[]`: group by code in first-appearance order; Value at Source as code and value; `Code at Source` override; boolean spellings; canonical and downstream defaults (design D4)
- [x] 1.4 Checks with line numbers: every error and warning in design D5, including the 2 MB and 10,000-row limits; reuse `validateLookupValues` rules
- [x] 1.5 Lookup type from the file name: exact match against the configuration's lookup type URIs, and a near-miss message for a match ignoring case (design D3)
- [x] 1.6 Plan classification against a fetched lookups response (`findExistingCodes`), chunking at `MAX_LOOKUP_VALUES_PER_REQUEST`, and per-code outcomes for every row of the design D9 table

## 2. Bridge

- [x] 2.1 Create `src/rdm/lookupLoadBridge.ts`: watcher on `.reltio/reltio-agent/rdm-lookup-load/request.json`, 300 ms debounce, one retry on a partial write, one request at a time, `result.json` with the same `requestId` (design D2)
- [x] 2.2 Parse the request: `mode`, `csvFile`, `rdmConfigFile` only; resolve both paths inside the workspace; refuse escapes (design D3)
- [x] 2.3 Resolve identity: rescan, `locFromPath` for environment and tenant, RDM tenant from the folder name, lookup type and its URI from the configuration (design D3)
- [x] 2.4 `not-run` reasons and `failed` kinds exactly as design D10; `requestId` echoed; no token anywhere
- [x] 2.5 Plan: read and check the CSV, resolve the service URI, fetch values, classify; never post, never prompt (design D6)
- [x] 2.6 Load: re-plan against a fresh fetch; refuse on errors; no dialog when nothing is new; modal approval naming environment, tenant, RDM tenant, lookup type, file and counts; `cancelled` otherwise (design D7)
- [x] 2.7 Post new codes in chunks of ≤ 100 with `buildLookupValuesCreateBody` and `postRdmLookupValues`; 401 → `tryRefresh` and one retry; stop at the first failure; re-fetch and report each code's outcome (design D8, D9)
- [x] 2.8 Output channel "Reltio RDM Lookup Load": request, counts, each chunk's outcome — never the token (design D11)

## 3. Extension wiring

- [x] 3.1 Register the bridge in `src/extension.ts` with the workspace root, the setting, repository-mode check, tenant resolution, token, `tryRefresh`, `resolveRdmServiceUri` and a modal approval function
- [x] 3.2 Contribute `reltio.enableRdmLookupLoad` (boolean, default true) in `package.json`; no command or menu

## 4. Skill

- [x] 4.1 Write `skills/reltio-default/rdm-lookup-values-from-csv/SKILL.md` (`name: reltio-rdm-lookup-values-from-csv`) in house style: when to use, where the files are, the CSV format, the procedure (find the CSV and the RDM configuration, plan, show the plan, ask, load, tell the user to approve in the IDE, report), every `status`, reason, kind and outcome with what to do, and the report shape
- [x] 4.2 Keep internal-only references out of the skill (no `openspec/`, `docs/` or `src/` paths)
- [x] 4.3 Add the contributor pointer `.cursor/skills/reltio-rdm-lookup-values-from-csv/SKILL.md` naming the canonical and materialized paths
- [x] 4.4 Raise `skillsBundleVersion` to `23` in `resources/reltio-agent-assets.json`; update `PINNED_SKILLS_BUNDLE_VERSION` and `PINNED_SKILLS_HASH` in `scripts/test-workflow-skills-library.cjs`

## 5. Tests

- [x] 5.1 Add `scripts/test-rdm-lookup-csv-load.cjs` with the Tier A coverage in the design's test plan, including a synthetic `MaritalStatuses.csv`
- [x] 5.2 Add the Tier B bridge coverage with injected dependencies: identity, path escapes, plan never posts or prompts, approval gate, cancel, no dialog when nothing is new, chunking, stop on failure, 401 retry, `not-run` and `failed` results, no token in results
- [x] 5.3 Add Tier B coverage of the bundle and manifest: skill name and description valid, no internal references, bundle version raised, pointer present, setting contributed, no command
- [x] 5.4 Register the script in `scripts/run-unit-tests.cjs`; run `npm test` and confirm no new failures

## 6. Documentation

- [x] 6.1 Document the bridge, its request and result protocol, the approval dialog and the skill in `ARCHITECTURE.md`, beside the match verification bridge

## 7. Build and verification

- [x] 7.1 `npm run compile` — no TypeScript errors
- [x] 7.2 `npm run build` — bundles succeed
- [x] 7.3 Package a `.vsix` for manual QA
- [ ] 7.4 Manual QA: in Claude Code and in Cursor, ask the agent to load `MaritalStatuses.csv`; confirm the plan, the dialog's tenant and lookup type, and the values in Get Lookup Values
- [ ] 7.5 Manual QA: rerun the same file — everything skipped, no dialog
- [ ] 7.6 Manual QA: cancel the dialog — nothing written
- [ ] 7.7 Manual QA: a file with an error and a misnamed file — line-numbered errors, near-miss message, no dialog
- [ ] 7.8 Manual QA: signed out — `not-run` / `signed-out`; record whether undeclared sources are accepted (design open questions)
- [x] 7.9 `npx openspec validate rdm-lookup-csv-load --strict`

## Bugfix Round 1 — a CSV must append to existing codes, never replace

Reported: loading a CSV into a lookup type that already has values should add the CSV's mappings to them, never replace or delete what is stored. The first version skipped every existing code. See design D12.

- [x] B1.1 Append to existing codes instead of skipping them — root cause: design D8 sent only absent codes. Merge each existing code with its CSV rows through the shared `mergeLookupValue` (Add Value design D9), post merged values together with new codes, and never change or remove a stored entry (design D12)
- [x] B1.2 Conflicting rows (same source and code at the source, different value) and flags not applied (canonical, downstream default) become line-numbered warnings; a conflict never stops the file (design D12)
- [x] B1.3 Plan classification `new` / `append` / `unchanged`; outcomes `added` / `appended` / `unchanged` / `not-stored` / `not-sent` / `unconfirmed`, judged per requested mapping; remove `skipped-existing` (design D12)
- [x] B1.4 Approval dialog states new codes and appended mappings separately; no dialog when every code is `unchanged` (design D7, D12)
- [x] B1.5 Skill: describe appending (never replacing), the new classifications and outcomes, and conflicts; raise `skillsBundleVersion` to `24` and update the pinned version and hash
- [x] B1.6 Update `spec.md`, `proposal.md`, `ARCHITECTURE.md` and `scripts/test-rdm-lookup-csv-load.cjs`; `npm test`, compile, build, package; `openspec validate --strict`
- [ ] B1.7 Manual QA: a CSV adding a new source to existing codes — appended, stored mappings unchanged; rerun — everything `unchanged`, no dialog; a conflicting row — warning, stored value kept

## Change Round 2 — RDM's export format, several lookup types per file

Requested: load the CSV that RDM exports (`<rdmTenantId>_lookups_<timestamp>.csv`, columns `code`, `type`, `enabled`, `startDate`, `endDate`, `parents`, `sourceMappings.*`, `localizations.*`, `attributes.*`) instead of the Code / Source / Value at Source layout. Decided with the requester: several lookup types per file; parents, localizations and attributes reported, not loaded. See design D13.

- [x] C2.1 `readLookupCsv` reads the export: required `code`, `type`, `sourceMappings.{source,code,value}`; rows grouped by lookup type, then code; code rows set `enabled` / dates; mapping rows add a mapping, a blank code or value taking the other; the earlier layout refused with a message naming the new columns (design D13)
- [x] C2.2 Line-numbered errors for the new columns (type, booleans, dates, empty mapping fields, a code's fields twice, a mapping twice) and warnings for parents, localizations and attributes, which are not loaded
- [x] C2.3 `resolveLookupTypes` replaces the file-name rule: every `type` must be in the configuration exactly, a near match named; a name exporting from another RDM tenant is a warning
- [x] C2.4 Bridge plans, approves, posts and re-fetches per lookup type; outcomes judged per type; `lookupTypes` on every result and the approval, `lookupType` on every code
- [x] C2.5 New codes get the CSV's `enabled` and dates; existing codes keep theirs, with a warning when the CSV differs; one source with several codes becomes one source mapping with several values; the no-canonical warning moves to new codes only
- [x] C2.6 Skill rewritten for the export format; `skillsBundleVersion` raised to `29` with the pinned version and hash updated; setting description updated
- [x] C2.7 Update `spec.md`, `proposal.md`, `design.md`, `ARCHITECTURE.md` and `scripts/test-rdm-lookup-csv-load.cjs`; `npm test`, compile
- [ ] C2.8 Manual QA: load an export of one lookup type into a tenant that has some of its codes — new codes added, existing ones appended to, stored fields unchanged; rerun — everything `unchanged`
- [ ] C2.9 Manual QA: an export holding two lookup types; an export from another RDM tenant (warning); a row with a localization (warning, not sent)
