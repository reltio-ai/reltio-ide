## ADDED Requirements

### Requirement: CLI unit test harness

The project SHALL provide a single npm script `test` that compiles TypeScript (`npm run compile`) and runs all registered OpenSpec-aligned unit test scripts via `scripts/run-unit-tests.cjs` using Node.js built-in `assert` without adding Jest, Vitest, Mocha, or other test frameworks as dependencies.

#### Scenario: Developer runs tests locally

- **WHEN** the developer runs `npm test` from the repository root
- **THEN** `tsc` emits compiled modules under `dist/`
- **AND** `run-unit-tests.cjs` executes every script in its explicit registry
- **AND** the command exits with code 0 only if all Tier A and Tier B checks pass

#### Scenario: Code-model runs first

- **WHEN** `run-unit-tests.cjs` executes the test suite
- **THEN** `test-code-model-and-schema.cjs` SHALL run before any other test script
- **AND** subsequent scripts MAY assume the canonical fixture parses successfully if code-model passed

### Requirement: Canonical L3 fixture

All model-dependent test scripts (navigation, config tree, ontology, autocomplete, schema alignment on L3, apply mutations) SHALL use [`samples/first-test.json`](samples/first-test.json) as the single shared L3 input loaded via a shared helper (`load-canonical-fixture.cjs`).

#### Scenario: Navigation test uses canonical fixture

- **WHEN** `test-editor-navigation.cjs` runs
- **THEN** it loads `samples/first-test.json` through the shared helper
- **AND** does not read velocity packs or other sample files as primary L3 input

### Requirement: Code-model-only hardcoded expectations

Only `test-code-model-and-schema.cjs` and [`samples/code-model-manifest.json`](samples/code-model-manifest.json) SHALL contain hardcoded expected values (counts, keys, parse-error expectations) for test JSON files. All other test scripts SHALL derive assertions at runtime from the parsed model and AST.

#### Scenario: Manifest drives code-model expectations

- **WHEN** a maintainer adds a new sample JSON for parser testing
- **THEN** they add an entry to `code-model-manifest.json` with updated `expect` fields
- **AND** they do not add expectation files for navigation, autocomplete, or tree tests

#### Scenario: Fixture change updates code-model only

- **WHEN** `first-test.json` structure changes (new entity type, new URIs)
- **THEN** the maintainer updates `code-model-manifest.json` expectations
- **AND** model-derived tests (navigation, tree, etc.) require no expectation file updates

### Requirement: No expectation files for non-code-model tests

Test scripts other than `test-code-model-and-schema` SHALL NOT use committed oracle or spot JSON files (including under `scripts/test-fixtures/`) and SHALL NOT hardcode lists of expected URIs, jsonPaths, or completion candidates. Assertions SHALL be computed by walking the canonical fixture (self-oracle).

#### Scenario: Navigation uses self-oracle

- **WHEN** `test-editor-navigation.cjs` validates Go-to-Definition semantics
- **THEN** it walks all `configuration/…` reference sites in the canonical AST
- **AND** asserts each resolves to the definition object's `uri` value node without a committed expectation file

#### Scenario: Autocomplete uses scope rules on walked nodes

- **WHEN** `test-autocomplete-improvements.cjs` validates entity vs attribute URI separation
- **THEN** it applies `filterDefinitionUris` / scope rules to nodes discovered in the canonical AST
- **AND** does not load a committed list of expected completion URIs

### Requirement: Assume fixture correctness in derived tests

Non-code-model test scripts SHALL assume `samples/first-test.json` is fully correct: parse succeeds, all in-file URI references resolve, and tree jsonPaths are consistent with the model. They SHALL NOT re-assert parse validity except by relying on code-model running first.

#### Scenario: Tree walk assumes valid model

- **WHEN** `test-config-tree-view.cjs` walks configuration tree items
- **THEN** it assumes zero unresolved URIs in the canonical fixture
- **AND** fails if self-oracle checks (jsonPath resolution, reveal alignment) fail — not if a hardcoded expected count mismatches

#### Scenario: Cleanse outputMappingRef resolves

- **WHEN** the canonical fixture contains `outputMappingRef` pointing at `{mappingUri}/outputMapping`
- **THEN** `UriIndex` resolves the ref to the inline `outputMapping` array on the mapping object with `uri` equal to `{mappingUri}`
- **AND** `getAllUnresolved()` returns zero for the canonical fixture

### Requirement: One test script per OpenSpec change

For every shippable OpenSpec change under `openspec/changes/<name>/` (except the umbrella `reltio-metadata-editor`), the repository SHALL include `scripts/test-<name>.cjs` registered in `scripts/run-unit-tests.cjs`.

### Requirement: ARCHITECTURE rule for future OpenSpec changes

`ARCHITECTURE.md` SHALL document: canonical fixture path; code-model-first run order; code-model manifest as the only hardcoded expectations; **prohibition** of expectation files for other tests; maintainer procedure for adding sample JSONs to the code-model manifest.

#### Scenario: ARCHITECTURE documents prohibition

- **WHEN** a reader opens `ARCHITECTURE.md` Unit tests section
- **THEN** they find that expectation/oracle JSON is forbidden outside code-model manifest
- **AND** they find the procedure for updating `code-model-manifest.json`

### Requirement: Shared test helpers

The project SHALL provide `scripts/lib/load-canonical-fixture.cjs` and shared walk/assert helpers for model-derived tests.

### Requirement: Manual QA documentation

Each per-change test script SHALL list Tier C (manual) scenarios in its header comment.

### Requirement: DEVELOPMENT.md pipeline documentation

`DEVELOPMENT.md` SHALL document `npm test` → `npm run build` → `npm run package`.
