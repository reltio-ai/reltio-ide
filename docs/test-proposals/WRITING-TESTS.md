# Writing regression tests from the proposals

How to turn proposals into real tests, with a standard prompt and a standard failure simulation. Use these as written so every test follows the same structure.

## Before you start: ticket and branch

Tests are never written on `main` or on the framework branch. Each piece of test work gets its own feature branch.

- **Branch name:** `<TICKET>-<short-slug>`, for example `RP-123456-git-integration-tests`. The ticket prefix is required (repo convention `RP-<n>-<slug>`).
- **Ticket:** provide the ticket number yourself, or ask the assistant to create one on your behalf. If you ask for a ticket, say which epic it belongs under; the assistant creates it in the Reltio Platform (RP) project and uses the new key as the prefix.
- **Base:** create the branch from the latest `main`. If the regression framework has not merged yet, branch from the framework branch instead and say so in the PR.
- The assistant must stop and ask if no ticket is given and no ticket creation is requested. It must not invent a ticket number.

## What you can ask for

Point the assistant at a proposals JSON (a Drive link or the repo path, for example `docs/test-proposals/git-integration.json`) and choose a scope:

- **A particular test case:** give one or more row IDs, for example `GIT-002`.
- **The entire feature:** ask for the whole JSON; every row in it is in scope except rows marked `manual (Tier C)`, which get no script.

If you give a Drive link, the assistant reads that file and compares it with the matching JSON in the repo. If the two differ, the assistant stops and reports the difference instead of choosing one. The repo copy on your feature branch is the source of truth.

## Standard prompt

Copy the block below, fill in the three fields, and give it to your AI assistant.

```
Ticket: <RP-123456 | "create a ticket for me, epic RP-xxxxxx">
Source: <Drive link or repo path of the area JSON, e.g. docs/test-proposals/git-integration.json>
Scope: <"entire feature" | row IDs such as GIT-001, GIT-004>

Implement the regression tests for the rows in scope.

Rules (do not deviate):
0. Create a new feature branch named <TICKET>-<short-slug> from the latest main (or the
   framework branch if it has not merged). If I gave no ticket and did not ask you to
   create one, stop and ask. Never work on main or on the framework branch.
1. Read first: docs/test-proposals/README.md, ARCHITECTURE.md "Regression gate and
   coverage", and two existing scripts in scripts/ for style. Each row's `source`,
   `scenario` and `expected` fields are the spec; do not invent extra checks. If the
   Source is a Drive link, check it against the repo JSON first and stop if they differ.
2. Only add or change files in scripts/ (the new test script, its registration in
   scripts/run-unit-tests.cjs). Never edit src/, existing test scripts, scripts/lib/,
   package.json, workflows, .vscodeignore, the area JSON files or the workbook.
   If a row exposes a product bug, pin nothing silently: stop and report it.
3. Use the row's `target_script` name. Follow the existing structure: shebang,
   'use strict', docblock naming the row IDs, plain node:assert, importDist from
   scripts/lib/import-dist.cjs, existing helpers in scripts/lib, the shared fixture
   samples/first-test.json, no new dependencies, no new oracle JSON, and a final
   console.log('<script-name>: OK').
4. Every assertion message starts with the row ID, e.g. 'GIT-001 #2: ...', so a failure
   traces to a row and check number.
5. Register the script in SCRIPTS (alphabetical), run npm run test:gate, then raise the
   area floor in scripts/module-coverage.config.json only if coverage went up
   (never lower it). If you add a src/ file, map it to an area.
6. Run the failure simulation below for each row and show me the output.
7. Tell me which rows you implemented and which script covers each. I update the
   proposals JSON, the workbook and the Drive copy myself.
```

## Naming and file layout

- A regression script is named `scripts/test-<topic>.cjs`. `<topic>` is the source module or feature under test (`reltio-client`, `agent-skills`, `git-integration`), not necessarily the whole area. An area with several distinct topics has several scripts.
- The row's `target_script` in the area JSON is authoritative. Rows that name an existing script (a `test-<openspec-change>.cjs`) extend that script instead of creating a new one. Rows marked `manual (Tier C)` get no script.
- Several rows may share one script. Keep one topic per file: if a script would mix unrelated sources or grow hard to review, split it and tell the developer which rows now map to which script, so they can update `target_script` in the JSON.
- Every script is registered in `SCRIPTS` in `scripts/run-unit-tests.cjs`, alphabetical.

## Standard failure simulation

A test that has never failed proves nothing. Run this for every row you implement.

1. **Baseline:** `npm run compile && node scripts/<target_script>` passes.
2. **Break one behavior:** make a one-line change in the file named in the row's `source` (flip a condition, remove a guard). Working tree only; never commit it.
3. **Recompile and run:** `npm run compile && node scripts/<target_script>`. It must exit non-zero with a message that starts with the row ID. If it passes, the test is too weak: strengthen it.
4. **Restore:** `git checkout -- src/` and `npm run compile`, then rerun the script and confirm it is green.
5. **Gate-level check:** temporarily set the area's floor to 100 in `scripts/module-coverage.config.json` and run `node scripts/check-module-coverage.cjs`. It must print `FAIL <area>`. Restore the floor afterwards.
6. **PR evidence:** paste the failing output and the restored green run into the PR description.

## Proposals JSON, workbook and Drive are maintained by the developer

The assistant writes tests only. It does not edit the area JSON files or the workbook, and it does not sync anything to Drive. After the tests land, the developer:

- sets the implemented rows' `status` to `Implemented` and corrects any `target_script` that changed, in the area JSON;
- regenerates the workbook with `python docs/test-proposals/build-workbook.py`;
- updates the shared Drive copy.

## Related

- `docs/test-proposals/README.md`: row schema, priority rubric, how to regenerate the workbook.
- `ARCHITECTURE.md` "Regression gate and coverage": how the gate, floors and areas work.
