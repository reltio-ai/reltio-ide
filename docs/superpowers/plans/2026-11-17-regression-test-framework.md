# Regression Test Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the test gate (tests run before build, red test fails the build) and per-module coverage tooling, plus a module-wise XLSX of proposed tests. No regression tests are written here.

**Architecture:** A new `test:gate` npm script compiles, runs the existing suite under `c8`, and checks per-module line coverage against floors in a config file. `prebuild` calls it, so `npm run build` and `npm run package` are gated. CI and Jenkins run the gate as an explicit step before the build. Proposed tests live as per-module JSON, assembled into one XLSX by a dev-only Python script.

**Tech Stack:** Node 22, TypeScript (existing `tsc` per-file emit with source maps), `c8` (new devDependency), `node:assert`, Python 3 + `openpyxl` (doc tooling only, not in CI or the package).

**Spec:** `docs/superpowers/specs/2026-11-17-regression-test-gate-design.md` (including its "Revisions" section)

## Global Constraints

- Branch: all work on `<TICKET>-regression-test-framework`, created from `main`. `<TICKET>` is the RP number the user supplies before Task 1 starts (repo convention `RP-<n>-<slug>`). Never commit to `main`.
- No edits under `src/`.
- No edits to existing `scripts/test-*.cjs`, `scripts/run-unit-tests.cjs`, or anything in `scripts/lib/`.
- Existing `package.json` script bodies (`compile`, `build*`, `clean`, `package`, `test`) are unchanged. Only additions: `test:gate`, `prebuild`, the `c8` devDependency.
- `package.json` `version` is never touched (release automation owns it).
- `release.yml` is not modified.
- The VSIX file list from a clean build must be identical before and after (Task 5 verifies).
- Coverage metric: lines. Target 70%. Floors are set from the measured baseline and only ever raised.
- Node 22. Plain `node:assert`, no test framework (`CLAUDE.md` convention).
- Do not commit unless the user has asked; the commit steps below apply once they have.

## Review Focus

- A test script crashes or exits non-zero: the gate must fail, and the coverage check must not mask it.
- `coverage/coverage-summary.json` missing or empty (c8 died early): the check fails closed, never passes.
- A new `src/<dir>` appears with no config entry: the check fails with a message to add a floor, so no module goes unguarded.
- Windows path separators in coverage keys (`src\api\x.ts`): normalized before module grouping.
- Stale `coverage/` from an earlier run: the gate wipes it first so old data can't satisfy the check.

---

### Task 1: Branch and baseline (no repo change)

**Files:** none modified. Notes go to the scratchpad directory.

**Interfaces:**
- Produces: branch `<TICKET>-regression-test-framework`; baseline artifacts used by Tasks 3 and 5: `baseline-vsix-files.txt` (output of `npx vsce ls` after `npm run clean && npm run build`), `baseline-test-seconds.txt`.

- [ ] **Step 1: Ask the user for `<TICKET>` and confirm `git status` shows only the spec and plan files untracked.**
- [ ] **Step 2: `git checkout -b <TICKET>-regression-test-framework`** (untracked docs carry over).
- [ ] **Step 3: Record baseline.** Run `npm ci`, `npm run clean`, `npm run build`, `npx vsce ls > baseline-vsix-files.txt`, then time `npm test` and note seconds. Expected: all 43 scripts pass ("All 43 OpenSpec test scripts passed.").
- [ ] **Step 4: If `npm test` fails on a clean checkout, stop and report. Do not fix existing tests in this plan.**

### Task 2: Coverage tooling (`c8`)

**Files:**
- Modify: `package.json` (devDependency `c8` only, via `npm i -D c8`), `package-lock.json`, `.gitignore` (add `coverage/`)
- Create: `.c8rc.json`

**Interfaces:**
- Produces: `coverage/coverage-summary.json` (c8 `json-summary` reporter; keys are absolute file paths, values `{lines:{total,covered,pct}, ...}`) after `c8 node scripts/run-unit-tests.cjs`.

- [ ] **Step 1: `npm i -D c8`** and confirm only `package.json` devDependencies and the lockfile changed.
- [ ] **Step 2: Create `.c8rc.json`:** `all: true`, `src: ["src"]`, `exclude: ["src/webview/**", "scripts/**", "dist/**"]`, `reporter: ["text-summary", "json-summary"]`, `reports-dir: "coverage"`, `clean: true`. Webview is excluded because `tsconfig` does not compile it (see spec section 3).
- [ ] **Step 3: Verify attribution.** Run `npm run compile && npx c8 node scripts/run-unit-tests.cjs`. Expected: `coverage/coverage-summary.json` exists and its file keys point at `src/**/*.ts`, not `dist/**`. If keys point at `dist/`, stop and resolve source-map handling before continuing (spec risk).
- [ ] **Step 4: Commit** `package.json package-lock.json .gitignore .c8rc.json`.

### Task 3: Module coverage check

**Files:**
- Create: `scripts/module-coverage.config.json`, `scripts/check-module-coverage.cjs`, `scripts/test-module-coverage-check.cjs`

**Interfaces:**
- Config shape: `{ "target": 70, "enforceTarget": false, "modules": { "<name>": { "floor": <0-100> } } }`. `<name>` is the first path segment under `src/`, or `"(root)"` for files directly in `src/`. `webview` is not listed (not measured).
- Produces (`check-module-coverage.cjs`, CommonJS):
  - `moduleOf(file: string): string | null` returns the module name for a path containing `src/` or `src\`, `null` for files outside `src/`.
  - `aggregate(summary: Record<string, {lines:{total:number, covered:number}}>): Record<string, number>` returns per-module line % (sum covered / sum total, 0 when total is 0; skips the `"total"` key).
  - `evaluate(pct: Record<string, number>, config): { failures: string[]; warnings: string[] }`
  - CLI: `node scripts/check-module-coverage.cjs` reads `coverage/coverage-summary.json`, prints a per-module table (module, %, floor, target), exits 1 on any failure. `--write-baseline` writes each module's floor as `max(0, floor(pct) - 2)` into the config.
- Behavior of `evaluate`: failure if `pct < floor`; failure if a measured module has no config entry; failure if a configured module was not measured; with `enforceTarget: true`, failure if `pct < target`; with it false, modules below `target` appear in `warnings` only.

- [ ] **Step 1: Write `scripts/test-module-coverage-check.cjs`** (plain `node:assert`) with these cases, each as its own labeled check:
  - `moduleOf('C:\\p\\src\\api\\x.ts') === 'api'`, `moduleOf('/p/src/extension.ts') === '(root)'`, `moduleOf('/p/scripts/a.cjs') === null`.
  - `aggregate` of two `api` files (total 10 covered 5; total 10 covered 10) equals `{ api: 75 }`.
  - `evaluate({api: 60}, {target:70, enforceTarget:false, modules:{api:{floor:55}}})` gives no failures and one warning mentioning `api`.
  - same with `floor:65` gives one failure.
  - `evaluate({api: 60, util: 90}, config with only api)` gives a failure mentioning `util`.
  - `evaluate({}, config with api)` gives a failure mentioning `api` (fail closed).
  - `enforceTarget:true` with `{api: 60}` gives a failure.
  - the CLI exits 1 when `coverage/coverage-summary.json` is missing (spawn it from a temp cwd).
- [ ] **Step 2: Run `node scripts/test-module-coverage-check.cjs`.** Expected: FAIL (module not found).
- [ ] **Step 3: Implement `check-module-coverage.cjs`** per the Interfaces block. Normalize `\` to `/` before matching.
- [ ] **Step 4: Run the test again.** Expected: all checks pass.
- [ ] **Step 5: Seed the floors.** Create `scripts/module-coverage.config.json` with `target: 70`, `enforceTarget: false`, `modules: {}`, then run `npm run compile && npx c8 node scripts/run-unit-tests.cjs && node scripts/check-module-coverage.cjs --write-baseline`. Expected: the config now lists every measured module with a floor 2 points under baseline. Re-run the checker without the flag. Expected: exit 0 and a table; modules below 70 are listed as warnings.
- [ ] **Step 6: Commit** the three new files.

### Task 4: The gate script

**Files:**
- Modify: `package.json` (add two scripts, nothing else)

**Interfaces:**
- Produces: `test:gate` = `npm run compile && c8 node scripts/run-unit-tests.cjs && node scripts/test-module-coverage-check.cjs && node scripts/check-module-coverage.cjs`; `prebuild` = `npm run test:gate`.

- [ ] **Step 1: Add the two scripts** exactly as above. Do not edit any other script.
- [ ] **Step 2: Run `npm run test:gate`.** Expected: 43 scripts pass, the coverage table prints, exit 0. Compare duration to the Task 1 baseline and record the overhead.
- [ ] **Step 3: Prove a red test fails the build.** Temporarily add `throw new Error('gate-check')` as the first line of any one `scripts/test-*.cjs`, run `npm run build`, expect non-zero exit and no new `dist/extension.js` modification time. Revert the temp edit with `git checkout -- <file>`.
- [ ] **Step 4: Prove a coverage drop fails the build.** Temporarily set one module's floor to 100, run `npm run build`, expect non-zero exit. Revert.
- [ ] **Step 5: Confirm `npm test` still behaves as before** (same output, "All 43 ..." line).
- [ ] **Step 6: Commit** `package.json`.

### Task 5: Keep the VSIX unchanged

The gate's `compile` writes per-file `tsc` output into `dist/` before `package`'s build, which `.vscodeignore` (`!dist/**`) would ship. A clean release build today does not ship it.

**Files:**
- Modify: `.vscodeignore` (additions after the `!dist/**` line only)

- [ ] **Step 1: Capture the "after" list.** Run `npm run clean && npm run build && npx vsce ls > after-vsix-files.txt`, then diff against `baseline-vsix-files.txt` from Task 1. If identical, skip to Step 4.
- [ ] **Step 2: If they differ,** add exclusions so only the esbuild bundles remain: `dist/*/**`, `dist/**/*.d.ts`, `dist/**/*.d.ts.map`, `dist/**/*.js.map`. (Release builds produce no subdirectories or maps, so this matches today's release contents.)
- [ ] **Step 3: Re-run Step 1.** Expected: `diff baseline-vsix-files.txt after-vsix-files.txt` prints nothing.
- [ ] **Step 4: Run `npm run package`** end to end and confirm it produces a `.vsix` in `target/` and `npx vsce ls` still matches the baseline.
- [ ] **Step 5: Commit** `.vscodeignore` (if changed).

### Task 6: Pipelines

**Files:**
- Modify: `.github/workflows/ci.yml`, `Jenkinsfile`
- Not modified: `.github/workflows/release.yml` (gated via the `prebuild` hook)

**Interfaces:**
- Consumes: `npm run test:gate`, `npm run build -- --ignore-scripts`.

- [ ] **Step 1: `ci.yml`:** order steps Install -> Test (`npm run test:gate`) -> Build (`npm run build -- --ignore-scripts`). Step names stay `Test` and `Build`.
- [ ] **Step 2: `Jenkinsfile`:** move the `Test` stage (command `npm run test:gate`) ahead of `Build`, and change the Build command to `npm run build -- --ignore-scripts`. Leave all other stages and settings as they are.
- [ ] **Step 3: Verify `--ignore-scripts` skips the hook.** Run `npm run build -- --ignore-scripts` and confirm the test gate output does not appear and the bundles are produced.
- [ ] **Step 4: Verify `release.yml` is untouched:** `git diff --stat main -- .github/workflows/release.yml` prints nothing.
- [ ] **Step 5: Commit** both files.

### Task 7: Docs

**Files:**
- Modify: `ARCHITECTURE.md` ("Unit tests" section), `docs/CONTRIBUTION.md`; `CLAUDE.md` only if `git ls-files CLAUDE.md` shows it is tracked (it is listed in `.gitignore`).

- [ ] **Step 1: Document** the `prebuild` gate, `test:gate`, the module floors file, how to raise a floor (re-run `--write-baseline` or edit it by hand), the 70% target and `enforceTarget`, and the warning that `--ignore-scripts` on a build or package step bypasses the gate.
- [ ] **Step 2: Commit** the docs.

### Task 8: Module-wise XLSX of proposed tests

**Files:**
- Create: `docs/test-proposals/<module>.json` (one per module), `docs/test-proposals/build-workbook.py`, `docs/test-proposals/regression-test-proposals.xlsx`, `docs/test-proposals/README.md`

**Interfaces:**
- Row schema in each JSON file (array): `id` (`<MODULE>-NNN`, unique, stable), `module`, `source` (file and function or area), `title`, `category` (`Technical` | `Functional` | `Non-functional`), `subtype` (Technical: `Unit`, `Contract`, `Integration`; Functional: `Feature`, `Workflow`, `Error handling`; Non-functional: `Performance`, `Security`, `Reliability`, `Compatibility`, `Scalability`), `scenario`, `expected`, `priority` (`P1` | `P2` | `P3`), `existing_coverage` (`None` | `Partial` | `Covered`), `target_script` (proposed `scripts/test-<name>.cjs`), `status` (always `Proposed` on creation).
- Workbook layout: sheet `README` (legend, how to edit, status meanings), sheet `Summary` (module, source files, baseline coverage %, floor, proposed counts per category), one sheet per module with the columns above plus empty `Reviewer comments` and `Dev notes`. Dropdowns on `category`, `subtype`, `priority`, `existing_coverage`, `status`; frozen header; filters on.
- Produces (`build-workbook.py`): `python docs/test-proposals/build-workbook.py` validates all JSON (required fields, enums, unique ids) and writes the XLSX; exits non-zero on any violation.

Modules and where to read (read each module's `src/<dir>` plus existing `scripts/test-*.cjs` that import it): `api`, `commands`, `entityBrowser`, `lca`, `model`, `navigation`, `ontology`, `parser`, `providers`, `tree`, `util`, `ux`, `workflow`, `workspace`, `webview` (pure logic only), and `(root)` for `src/extension.ts`.

- [ ] **Step 1: Write `build-workbook.py`** with the validator and the workbook layout above. Test it with a two-row fixture JSON placed in the scratchpad: expect a workbook with README, Summary and one module sheet, and a non-zero exit on a bad enum.
- [ ] **Step 2: For each module, draft `docs/test-proposals/<module>.json`.** Read the module's source and its existing tests. Propose tests that would catch regressions in current behavior (not new features). Each module needs at least one `Technical`, one `Functional` and one `Non-functional` row where the module has applicable behavior. Mark `existing_coverage` honestly from the existing scripts. Use the Task 3 coverage table to prioritize low-coverage modules (P1). Modules are independent, so they can be drafted in parallel.
- [ ] **Step 3: Run `python docs/test-proposals/build-workbook.py`.** Expected: exit 0, XLSX with 2 + 16 sheets.
- [ ] **Step 4: Open the workbook** (or read it back with openpyxl) and confirm every module sheet has rows, dropdowns work, and the Summary counts match the JSON.
- [ ] **Step 5: Write `README.md`** describing the schema, the stable-ID rule, and that the XLSX is for review and later conversion into tests. No test code is generated here.
- [ ] **Step 6: Commit** `docs/test-proposals/`.

### Task 9: Final verification

- [ ] **Step 1: Full gate from clean:** `npm ci && npm run clean && npm run build`. Expected: tests run first, then bundles, exit 0.
- [ ] **Step 2: Constraint checks.** `git diff --stat main -- src scripts/lib scripts/run-unit-tests.cjs .github/workflows/release.yml` prints nothing; `git diff main -- scripts/ ':!scripts/check-module-coverage.cjs' ':!scripts/test-module-coverage-check.cjs' ':!scripts/module-coverage.config.json'` prints nothing; `git diff main -- package.json` shows only the two new scripts and the `c8` devDependency.
- [ ] **Step 3: VSIX list** still matches `baseline-vsix-files.txt`.
- [ ] **Step 4: Report** gate overhead (seconds), the per-module baseline table, modules below 70%, and the proposal counts per module and category.
