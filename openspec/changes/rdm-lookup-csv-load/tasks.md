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
