## 1. Harness and shared infrastructure

- [x] 1.1 Add `scripts/lib/import-dist.cjs` — resolve and dynamic-import compiled modules from `dist/` after `tsc`
- [x] 1.2 Add `scripts/lib/load-sample.cjs` — read `samples/*.reltio.json` and tenant L3 sample paths
- [x] 1.3 Extract `scripts/lib/validate-velocity-packs.cjs` from `velocity-packs-validate-manifest.cjs` (export `validateVelocityPacks()` returning error count)
- [x] 1.4 Add `scripts/run-unit-tests.cjs` — explicit `SCRIPTS` registry, run each script in order, fail fast on non-zero exit
- [x] 1.5 Add `"test": "npm run compile && node scripts/run-unit-tests.cjs"` to `package.json`
- [x] 1.6 Make `velocity-packs-validate-manifest.cjs` a thin wrapper calling `validate-velocity-packs.cjs` (optional backward compatibility)

## 2. Pure helper extractions (enable Tier A tests)

- [x] 2.1 Move `tenantIdFromTreeContext` from `src/extension.ts` to `src/util/tenantIdFromTreeContext.ts` and re-export usage in extension
- [x] 2.2 Extract `shouldWarnBeforeFetch(localText, baselineText)` (or equivalent) to `src/util/fetchConfigurationGuard.ts` using `jsonDeepEqual`
- [x] 2.3 Add `pathTenantLocFromL3Path(fsPath: string)` helper if needed to test `tenantLocFromL3File` without VS Code URI in CLI tests

## 3. Documentation and process rules

- [x] 3.1 Add **Unit tests (OpenSpec-aligned)** section to `ARCHITECTURE.md` — rule for new changes, Tier A/B/C, `npm test`, dual build path (`tsc` vs esbuild)
- [x] 3.2 Update `DEVELOPMENT.md` — pipeline order `npm test` → `npm run build` → `npm run package`
- [x] 3.3 Add **Test plan** subsection to this change's `design.md` cross-reference in ARCHITECTURE (already in design.md per-change tables)

## 4. Per-change test scripts — foundation changes

- [x] 4.1 `test-code-model-and-schema.cjs` — parse samples, path helpers (see design §1)
- [x] 4.2 `test-editor-navigation.cjs` — UriIndex definitions, refs, unresolved, virtual defs, `findStringNodeAtOffset` (see design §2)
- [x] 4.3 `test-config-tree-view.cjs` — `getConfigRootChildren`, `findConfigEntityTypeItem`, `getConfigTreeItemParent` (see design §3)
- [x] 4.4 `test-ontology-view.cjs` — `buildGraphModel`, `applyLayout`; optional `computeLayout` smoke (see design §4)

## 5. Per-change test scripts — workspace and API changes

- [x] 5.1 `test-multi-tenant-tree-view.cjs` — path keys, `jsonDeepEqual`, fetch guard, `tenantIdFromTreeContext` (see design §5)
- [x] 5.2 `test-configuration-history-review.cjs` — filename round-trip, labels, `immediateOlderSnapshot` (see design §6)
- [x] 5.3 `test-apply-tenant-configuration-action.cjs` — `jsonDeepEqual`, drift predicates (see design §12)
- [x] 5.4 `test-copy-tenant-id-to-clipboard.cjs` — `tenantIdFromTreeContext` cases (see design §13)

## 6. Per-change test scripts — auth, UX, and assets

- [x] 6.1 `test-browser-oauth-login.cjs` — credential resolve matrix, `buildAuthorizationUrl`, `TokenStore` aliases (see design §14)
- [x] 6.2 `test-setup-ux-redesign.cjs` — `deriveUxState` scenario table, `l3FileUri` (see design §15)
- [x] 6.3 `test-autocomplete-improvements.cjs` — `getUriCompletionScope`, `collectStringValuesForPropertyName` (see design §8)
- [x] 6.4 `test-skills-and-enablement-packs-library.cjs` — velocity manifest + agent assets JSON (see design §9)

## 7. Per-change test scripts — schema, packaging, inserts

- [x] 7.1 `test-schema-alignment-with-live-l3.cjs` — schema JSON valid, sample structure smoke (see design §7)
- [x] 7.2 `test-extension-packaging.cjs` — `package.json` / `.vscodeignore` smoke checks (see design §10)
- [x] 7.3 Migrate `test-element-naming.cjs` → `test-no-create-wizards.cjs` — naming + skeleton object shapes (see design §11); delete or redirect old file

## 8. Registry and verification

- [x] 8.1 Register all fifteen scripts in `scripts/run-unit-tests.cjs` in stable order (alphabetical by change name)
- [x] 8.2 Run `npm test` locally — all Tier A/B pass on Node 18+ / 20+
- [x] 8.3 Run `npm run package` after `npm test` — confirm VSIX still builds
- [x] 8.4 Document Tier C manual QA pointers in each script header (copy summaries from design.md per-change tables)

## 9. CI readiness (optional follow-up in same PR if pipeline exists)

- [x] 9.1 Add `npm test` step to Bitbucket Pipelines (or document snippet in DEVELOPMENT.md if pipeline file not in repo)
- [x] 9.2 Confirm `npm test` runs in under 60s on clean checkout

## Bugfix Round 2 — Canonical fixture + model-derived tests

Replaces Bugfix Round 1 (velocity packs / expectation files). See updated [design.md](design.md) D3–D7.

- [x] 2.1 Populate [`samples/first-test.json`](samples/first-test.json) — full production L3 export (~39k lines; 9 entity types, 27 relation types, 21 sources)
- [x] 2.2 **Product bug:** fix cleanse `outputMappingRef` resolution in [`src/navigation/uriIndex.ts`](src/navigation/uriIndex.ts) — `configuration/entityTypes/Location/cleanse/mappings/address/outputMapping` must resolve to inline `outputMapping` array on mapping object (see design.md **Known product bug** section); verify `getAllUnresolved().length === 0` on canonical fixture
- [x] 2.3 Add [`samples/code-model-manifest.json`](samples/code-model-manifest.json) — registered JSON paths + `expect` counts/keys (e.g. `entityTypeCount: 9`, `relationTypeCount: 27`, `sourceCount: 21`, `unresolvedUriCount: 0` after 2.2); document maintainer procedure in design D5
- [x] 2.4 Add `scripts/lib/load-canonical-fixture.cjs`, `walk-configuration-uris.cjs`, `assert-navigation.cjs`, `assert-tree-walk.cjs`, `assert-completion-scopes.cjs`
- [x] 2.5 Extract `filterDefinitionUris` to `src/navigation/uriCompletionFilter.ts`; fix `getJsonPathAtOffset(text, ast, offset)` in configParser
- [x] 2.6 Rewrite `test-code-model-and-schema.cjs` — manifest-driven expectations only; edit-range helpers stay inline in script
- [x] 2.7 Rewrite `test-editor-navigation.cjs` — self-oracle on canonical fixture (reference → definition `uri` node; zero unresolved — blocked until 2.2)
- [x] 2.8 Rewrite `test-config-tree-view.cjs` — full tree walk + jsonPath/reveal alignment on canonical model
- [x] 2.9 Rewrite `test-autocomplete-improvements.cjs` — walk scoped nodes; assert filter rules (no hardcoded URI lists)
- [x] 2.10 Rewrite `test-ontology-view.cjs` — graph invariants on canonical model
- [x] 2.11 Rewrite `test-schema-alignment-with-live-l3.cjs` — canonical model keys vs schema properties
- [x] 2.12 Rewrite `test-apply-tenant-configuration-action.cjs` — temp copy of canonical text; mutations in test code only
- [x] 2.13 Update `run-unit-tests.cjs` — run `test-code-model-and-schema.cjs` **first**, then alphabetical
- [x] 2.14 Update **ARCHITECTURE.md** — canonical fixture, code-model-only expectations, **forbid expectation files** for other tests, D5 procedure
- [x] 2.15 Remove/cancel Bugfix Round 1 tasks (superseded); verify no `scripts/test-fixtures/` oracle files added
