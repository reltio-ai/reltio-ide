# Regression test gate: design

Date: 2026-11-17
Status: draft, awaiting review

## Goal

Catch regressions in every module when new features land. Tests run before the build, and a failing test fails the build, locally and in CI/release.

## Decisions (agreed)

- Gate scope: local and CI, including the release workflow.
- Module coverage: per-module regression tests plus a coverage floor that fails the run when it drops.
- Framework: stay on plain `node:assert` per `CLAUDE.md`. The only new dev dependency is `c8` (coverage reporting).

## Revisions (2026-11-17, owner feedback)

1. Framework only. This work builds the gate and coverage tooling. It does not write the regression tests.
2. Test content is delivered as a module-wise XLSX of proposed tests for developers to review and edit; it is later used to add tests to the framework. See `docs/superpowers/plans/2026-11-17-regression-test-framework.md`, Task 8.
3. All changes land on a separate feature branch named `<TICKET>-regression-test-framework` (repo convention `RP-<n>-<slug>`).
4. Coverage target is 70% lines per module. Because no tests are added here, the target is recorded and reported, and enforcement is a per-module floor set from the measured baseline. A module's floor is raised to 70 as its tests land. Enforcing 70% on day one would fail the build for any module currently below it.
5. Proposed tests cover technical, functional and non-functional categories.
6. No existing functionality changes. No edits under `src/`, no edits to existing test scripts or `scripts/lib/`, no change to existing script bodies in `package.json`, and no change to the VSIX file list. The `prebuild` hook is the one requested build-behavior change, and `release.yml` stays untouched.
7. Revision (2026-11-18): AI Agent & Skills was folded into Common Utils (source files) and into Workflows, LCA, Business Configuration and Common Utils (proposals) at the owner's request; 8 areas remain.

## Current state (verified from repo)

- 43 `scripts/test-*.cjs` files (one per OpenSpec change), registered in `scripts/run-unit-tests.cjs`. `npm test` = `tsc` compile + runner. Runner exits 1 on any failure.
- `ci.yml` (every PR, push to `main`): `npm ci` -> `build` -> `test`. No VSIX.
- `Jenkinsfile`: install -> build -> test -> Sonar. No VSIX. Trigger lives in Jenkins job config (not verified).
- `release.yml` (manual `workflow_dispatch`): bump version -> `npm run build` -> `npm run package` -> release with VSIX. Skips tests and relies on PR checks (branch protection not verified).
- `npm run build` and `npm run package` are not gated on tests.
- No coverage measurement. `src/webview/` is excluded from `tsc`; no direct webview tests.

## Design

### 1. Gate

- `package.json`: add `"prebuild": "npm test"`. `npm run build` and `npm run package` (which calls `build`) run tests first. `build:ext`, `build:watch` and the other `build:*` scripts stay ungated so watch mode stays fast.
- `ci.yml` and `Jenkinsfile`: order becomes Install -> Test -> Build. The build step is `npm run build --ignore-scripts` (skips the `prebuild` hook) so tests do not run twice. Test remains its own step for clear failure attribution.
- `release.yml`: no change (constraint from the owner). It is gated through the `prebuild` hook: the existing `npm run build` step runs the tests first, so a red test fails `Build extension` before packaging. Nothing is published, because the release commit, tag and GitHub Release happen in later steps. Tests run twice per release (the `Build extension` step, then `package`'s inner `npm run build`). A test failure appears in the `Build extension` step log rather than a dedicated Test step. The gate relies on npm lifecycle hooks, so adding `--ignore-scripts` to those steps would silently remove it; document this in `CONTRIBUTING`. The comment "Tests are not repeated here" becomes stale but is left as is.
- Failure path: red test -> non-zero exit -> no `dist/` bundles, no VSIX, no release commit or tag. In `release.yml` the test step runs before the version bump is pushed, so nothing is published.

### 2. Module coverage

- Measure baseline first (read-only): run the suite under `c8` and record per-module line coverage for each `src/<dir>`.
- Source maps: tests import per-file `tsc` output from `dist/`. Verify `c8` attributes coverage to `src/` (enable `sourceMap` in `tsconfig`, or report on `dist/` and map by directory). Resolve this before setting thresholds.
- `scripts/module-coverage.json` maps each `src/<dir>` to a minimum line-coverage floor. Floors start a few points under baseline and are only ever raised.
- `npm test` runs the runner under `c8` and a small `scripts/check-module-coverage.cjs` compares per-module results to the floors. A drop fails the run.
- Gap-filling: for each module below the agreed bar, add `scripts/test-<module>-regression.cjs`, register it in `run-unit-tests.cjs`, and follow existing conventions (`scripts/lib/import-dist.cjs`, shared fixture `samples/first-test.json`, self-oracle helpers, no new oracle JSON).
- Coverage bar: not yet agreed. Proposed: decide per module after the baseline; target 70% lines for logic-heavy modules (`api`, `workspace`, `workflow`, `lca`, `navigation`, `parser`, `model`, `util`). Confirm after seeing baseline numbers.

Modules in scope (16): `api`, `commands`, `entityBrowser`, `lca`, `model`, `navigation`, `ontology`, `parser`, `providers`, `tree`, `util`, `ux`, `webview`, `workflow`, `workspace`, plus root `src/extension.ts`.

### 3. Webview

- No DOM testing. Extract pure logic (message handling, graph transforms) from `ontologyView.ts` and `bpmnView.ts` into testable modules where needed, keeping the existing CSP and message-hardening tests.
- Rendering stays covered by manual QA (Tier C).

### 4. Docs

Update `CLAUDE.md` (Commands, Test conventions), `ARCHITECTURE.md` "Unit tests", and `docs/CONTRIBUTION.md`: the gate, the coverage floor, and how to raise it.

## Sequencing (each step shippable)

1. Baseline coverage report (no repo behavior change).
2. Gate: `prebuild` hook, `ci.yml`, `Jenkinsfile`, `release.yml`.
3. Coverage tooling and floors.
4. Gap-filling regression tests, one module per change.
5. Docs.

## Risks

- Test time added to every `npm run build`. Measure in the baseline step.
- Floors too tight cause flaky failures. Start below baseline.
- `c8` source-map attribution (see section 2).
- Double test runs if `--ignore-scripts` is mis-applied in `ci.yml` and `Jenkinsfile`. Verify each pipeline's step order in a dry run.
- Two test runs per release because `release.yml` is not edited. Mitigation if release time matters: make the `prebuild` hook skip when an env var such as `SKIP_PREBUILD_TESTS=1` is set, which needs a `release.yml` edit and so a separate approval.
- Hook bypass: `--ignore-scripts` on any build or package step removes the gate in that pipeline.
- Branch protection and the Jenkins trigger are unverified. Confirm with whoever owns the repo settings.

## Out of scope

Adopting a test framework, DOM-level webview tests, changing the OpenSpec workflow, and bumping `package.json` version (release automation owns it).
