# Writing tests for a feature

The single reference for a developer or an AI agent who is building or changing a feature and needs to ship regression tests for it. Tests land in the same branch and PR as the feature. There is no separate "tests" branch.

Read this before writing a test. Background on the gate itself is in [ARCHITECTURE.md](../ARCHITECTURE.md) "Regression gate and coverage"; the wider workflow is in [CONTRIBUTION.md](CONTRIBUTION.md).

## How the gate works

`npm run build` and `npm run package` run `npm run test:gate` first. A failing test, or a feature area below its coverage floor, stops the build.

| Command | Use |
|---|---|
| `npm run compile` | `tsc` into per-file `dist/`. Tests import from `dist/`, so run it after every `src/` change. |
| `node scripts/test-<name>.cjs` | Run one script. Needs a fresh `npm run compile`. |
| `npm test` | Compile and run every script, no coverage. |
| `npm run test:gate` | Compile, run all scripts under `c8`, then check per-area coverage floors. This is the real gate. |

A successful `npm run build` removes `dist/` (`gate:cleanup`). Compile again before running a single script.

## Where a test goes

1. **Check for an existing test first.** Search `scripts/test-*.cjs` and the `SCRIPTS` array in `scripts/run-unit-tests.cjs` for the function and file names you changed, the module you import through `importDist`, and key terms from the behavior. Classify each behavior you need to cover:
   - **Already covered:** an existing assertion checks it. Write nothing.
   - **Similar:** an existing script covers the same module or behavior in part. Extend that script in its own style.
   - **New:** nothing relevant exists. Create a new script.
2. **Extending an existing script:** add your assertions and check IDs to its docblock. Never delete, loosen or reorder existing assertions. Never change its fixtures or helpers in a way that alters what it already checks. Keep it green.
3. **New script:** `scripts/test-<topic>.cjs`, where `<topic>` is the OpenSpec change slug for a shippable change, or the source module or feature under test (`reltio-client`, `git-integration`). One topic per file. If a script would mix unrelated sources or become hard to review, split it.
4. **Register it** in `SCRIPTS` in `scripts/run-unit-tests.cjs`, alphabetical. `test-code-model-and-schema.cjs` always runs first and stays first.

## Script conventions

- Start with `#!/usr/bin/env node` and `'use strict';`, then a docblock naming the area, the behaviors covered and their check IDs, and any behavior deliberately left to manual QA (Tier C).
- Plain `node:assert`. No test framework and no new dependencies.
- Import compiled code with `importDist('<dir>/<file>')` from `scripts/lib/import-dist.cjs`. It stubs the `vscode` module.
- Use the shared fixture `samples/first-test.json` through `scripts/lib/load-canonical-fixture.cjs`.
- **Do not add oracle or expectation JSON.** Derive expected values at runtime from the parsed model, the AST and `UriIndex`, using the self-oracle helpers in `scripts/lib/`. `samples/code-model-manifest.json` is the only committed expectations file; when the fixture changes, update that and nothing else.
- Reuse the helpers in `scripts/lib/` before writing your own:

  | Helper | For |
  |---|---|
  | `import-dist.cjs` | Load compiled modules with `vscode` stubbed |
  | `vscode-stub.cjs` | The stub itself. Extend it at runtime inside your script if you need more of the API. Do not edit it. |
  | `load-canonical-fixture.cjs`, `load-sample.cjs` | Parsed fixture and sample files |
  | `memory-fs.cjs` | In-memory `vscode.workspace.fs` for code that walks directories |
  | `menu-when.cjs` | Evaluate `when` clauses from `package.json` `contributes.menus`, for menu and sub-item visibility |
  | `assert-navigation.cjs`, `assert-completion-scopes.cjs`, `assert-tree-walk.cjs`, `walk-configuration-uris.cjs` | Navigation, completion and tree self-oracles |

- **Check IDs.** Every assertion message starts with a check ID and number so a failure points at a behavior: `'GIT-001 #2: ...'`. For a new feature, pick a short upper-case topic code that is not already used in `scripts/` (grep first), and number behaviors `<CODE>-001`, `<CODE>-002`. Each behavior can hold several numbered assertions (`#1`, `#2`).
- End with `console.log('<script-name>: OK');`.
- Do not use real network, real time or the real file system outside `os.tmpdir()`. Keep any performance budget generous so a loaded CI machine does not flake.

## What to cover

Cover the behavior the feature adds or changes, not the lines it touches.

- **Happy path** of each user-visible behavior.
- **Error handling:** empty, malformed, truncated and missing input; failed network or file calls.
- **Untrusted input and security:** tokens and secrets never persisted or logged, path traversal, injection, crafted files. Treat these as the highest priority.
- **Data safety:** anything that could overwrite or delete user work.
- **Platform:** Windows paths and separators, CRLF.
- **Menus and tree items:** if you add or change a command, a tree node or a `package.json` menu entry, check which menu locations and which node types show it, using `menu-when.cjs`.
- **Reliability and scale:** idempotent repeat runs, large inputs, disposal and cancellation.
- **Not testable here:** webview rendering (`src/webview/` is not compiled by `tsc` and has no DOM tests). Pull pure logic (message handling, graph transforms) into a testable module under `src/`, test that, and leave rendering to manual QA.

## Coverage areas and floors

Every non-webview file under `src/` must belong to an area in `scripts/module-coverage.config.json`. First matching pattern wins. A new `src/` file with no area **fails the gate**, so add its path to the right area.

| Area | Covers (patterns) |
|---|---|
| Workflows | `workflow/**`, `workspace/workflow*.ts`, workflow tree nodes, BPMN content provider |
| LCA | `lca/**`, `commands/lcaActions.ts` |
| Setup & Authentication | OAuth, session and token stores, setup wizard and guide, environment manager |
| Git Integration | git config source, tenant git binding, tenant folder structure, layout migration |
| Tenant Explorer & UX | `tree/**`, quick switch, recents, status bar, UX state |
| Business Configuration | `parser/**`, `model/**`, `navigation/**`, `ontology/**`, `entityBrowser/**`, edit and reveal commands, config history, auto-save |
| Common Utils | `util/**`, `api/reltioClient.ts`, agent skill discovery and sync |
| Extension Activation | `extension.ts` |

The authoritative list is the config file. Rules:

- Floors only go up. Never lower one. After your tests land, raise the floor of every area you improved.
- Raise it by hand, or run `npm run compile && npx c8 node scripts/run-unit-tests.cjs && node scripts/check-module-coverage.cjs --write-baseline` and review the diff. `--write-baseline` sets each floor 2 points under the measured value and never lowers one.
- The 70% target is report-only (`enforceTarget` is `false`). Areas under 70 print a warning, not a failure.

## Prove each test can fail (required)

A test that has never failed proves nothing. Do this for every behavior you cover, before the PR.

**Protect your own work first.** The simulation edits `src/` and recompiles. Commit or stash your feature changes before you start, so restoring cannot discard them. Run simulations one at a time; they share `src/` and `dist/`.

1. **Baseline:** `npm run compile && node scripts/<script>` passes.
2. **Break one behavior:** make a one-line change in the source file the test covers (flip a condition, remove a guard). Working tree only. Never commit it.
3. **Recompile and run:** `npm run compile && node scripts/<script>`. It must exit non-zero with a message that starts with your check ID. If it passes, the test is too weak: strengthen it. If it fails with a different kind of error (a crash, a missing export), fix the test so it fails on the assertion.
4. **Restore:** `git checkout -- <the file you broke>`, then `npm run compile` and rerun. It must be green.
5. **Gate-level check:** temporarily set the area's `floor` to 100 in `scripts/module-coverage.config.json`, run `node scripts/check-module-coverage.cjs`, confirm it prints `FAIL <area>`, then restore the floor.
6. **PR evidence:** paste the failing output and the restored green run into the PR description.

For an extended existing script, break the behavior your new assertions cover and confirm your assertions are the ones that fail.

## Bugs found while testing

- A bug in the code you are writing in this change: fix it in the change.
- A bug in code that already existed and is outside this change's scope: **do not fix it here, and do not write a test that asserts the buggy behavior.** Skip that check, add a docblock note (`blocked by <ticket or short description>`), and continue.
- Tell the developer about the bug with the facts: feature, what the user sees, expected vs actual, repro steps, the file involved. **Raise a Jira ticket only after the developer confirms.** An agent never files one on its own.

## Do and don't

- Do commit the tests with the feature, in the same branch.
- Do keep every existing test green. Never delete, loosen or reorder an existing assertion to make room for yours.
- Don't edit `scripts/lib/` in a way that changes what other tests check. Extend the stub at runtime in your own script instead.
- Don't lower a coverage floor, set `enforceTarget` to `true` until every area is at 70, or add `--ignore-scripts` to a build, package or release step (it removes the gate).
- Don't add oracle JSON, a test framework or a dependency.
- Don't bump the `package.json` version.

## Checklist (agent or reviewer)

1. Searched existing scripts; each behavior classified as already covered, similar (extend) or new.
2. New script named `test-<topic>.cjs`, registered alphabetically in `SCRIPTS`. Or an existing script extended without touching its current assertions.
3. Docblock lists the area, behaviors, check IDs and anything left to manual QA.
4. Every assertion message starts with its check ID. Ends with `console.log('<name>: OK')`.
5. Happy path, error handling, untrusted input and platform cases covered; menu visibility checked if menus changed.
6. Any new `src/` file mapped to an area in `scripts/module-coverage.config.json`.
7. `npm run test:gate` is green.
8. Floors raised for improved areas, none lowered.
9. Failure simulation run for every behavior; failing output starts with the check ID; `src/` restored; floor-to-100 check printed `FAIL <area>` and was restored.
10. Pre-existing bugs reported to the developer, not fixed or pinned; Jira only after confirmation.
11. Evidence pasted in the PR description.
