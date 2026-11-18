# Writing regression tests from the proposals

Copy the prompt in the first section below and paste it into your AI assistant. Nothing else on this page needs to be pasted; the sections after it are background.

## Standard prompt

Paste the whole block below as is. There is nothing to fill in: the assistant asks you for the variables first and waits for your answers.

```
You are going to write regression tests for the Reltio IDE extension from the proposals
in docs/test-proposals/. Follow these instructions exactly.

STEP 1: Ask me for these variables in a single message, then wait. Do not guess any of
them and do not start work until I have answered all three.
  1. Source: the proposals JSON for the feature. A Drive link or a repo path such as
     docs/test-proposals/git-integration.json.
  2. Scope: either "entire feature" (every row in that JSON except rows whose
     target_script is "manual (Tier C)"), or specific test case IDs such as GIT-001, GIT-004.
  3. Ticket: the Jira ticket number I want as the branch prefix (for example RP-123456),
     or "create one for me". If I ask you to create one, create it in the RP project with
     parent epic RP-189333 (do not ask me for the epic) before continuing.

STEP 2: Prepare.
  a. If Source is a Drive link, read it and compare it with the matching JSON in the repo.
     If they differ, stop and show me the difference. The repo copy is the source of truth.
  b. Check for existing tests before writing anything. For every row in scope, search
     scripts/ (all test-*.cjs and the SCRIPTS registry) for a test that already covers the
     same or similar behavior: grep for the function and file names in the row's `source`,
     for the module it imports through importDist, and for key terms from its title and
     scenario. Also read the row's `existing_coverage` and `target_script` as hints, but
     verify against the actual scripts. Classify each row as:
       - SAME: an existing assertion already checks it. Write nothing for it.
       - SIMILAR: an existing script covers the same module or behavior in part. Plan to
         modify that script instead of creating a new one.
       - NEW: nothing relevant exists. Plan a new script named by target_script.
  c. Show me a table of row ID, classification, the existing script and lines found (if
     any), and the script you will change or create. Wait for my "go".
  d. Create a new feature branch named <TICKET>-<short-slug> from the latest main (from
     the regression-framework branch if it has not merged yet). Never work on main or on
     the framework branch.

STEP 3: Write the tests. Rules (do not deviate):
  1. Read first: docs/test-proposals/README.md, ARCHITECTURE.md "Regression gate and
     coverage", and two existing scripts in scripts/ for style. Each row's `source`,
     `scenario` and `expected` fields are the spec; do not invent extra checks.
  2. Only add or change files in scripts/: new test scripts, their registration in
     scripts/run-unit-tests.cjs, and existing test scripts only for rows classified
     SIMILAR. Never edit src/, scripts/lib/, package.json, workflows, .vscodeignore, the
     area JSON files or the workbook. If a row exposes a product bug, pin nothing
     silently: stop and report it.
  2a. When modifying an existing script (SIMILAR rows): extend it in its own style. Add
     the new assertions and the row IDs to its docblock. Never delete, loosen or reorder
     existing assertions, never change its fixtures or helpers in a way that alters what
     it checks, and keep it green. Do not create a second script for behavior an
     existing script already covers. If you are unsure whether to extend or create, ask me.
  3. Use the row's target_script name. Follow the existing structure: shebang,
     'use strict', docblock naming the row IDs, plain node:assert, importDist from
     scripts/lib/import-dist.cjs, existing helpers in scripts/lib, the shared fixture
     samples/first-test.json, no new dependencies, no new oracle JSON, and a final
     console.log('<script-name>: OK').
  4. Every assertion message starts with the row ID, for example 'GIT-001 #2: ...', so a
     failure traces to a row and check number.
  5. Register the script in SCRIPTS (alphabetical), run npm run test:gate, then raise the
     area floor in scripts/module-coverage.config.json only if coverage went up (never
     lower it). If you add a src/ file, map it to an area.

STEP 4: Prove each test can fail. For every row implemented:
  1. npm run compile && node scripts/<target_script> passes.
  2. Make a one-line breaking change in the file named in the row's `source` (working
     tree only, never committed), recompile, rerun the script. It must exit non-zero with
     a message that starts with the row ID. If it passes, strengthen the test.
  3. git checkout -- src/, recompile, rerun: green again.
  4. Set the area floor to 100 temporarily, run node scripts/check-module-coverage.cjs,
     confirm it prints FAIL <area>, then restore the floor.
  For a modified existing script, break the behavior your new assertions cover and
  confirm that your new assertions are the ones that fail. Show me the failing and the
  restored output for each row.

STEP 5: Report. List the rows implemented and the script covering each, which rows were
SAME (nothing written), which scripts were modified instead of created, the branch name,
and anything you could not do. I update the proposals JSON, the workbook and the Drive
copy myself, so do not touch them.
```

## Before you start: ticket and branch

The prompt above asks you for the ticket. Tests are never written on `main` or on the framework branch. Each piece of test work gets its own feature branch.

- **Branch name:** `<TICKET>-<short-slug>`, for example `RP-123456-git-integration-tests`. The ticket prefix is required (repo convention `RP-<n>-<slug>`).
- **Ticket:** provide the ticket number yourself, or ask the assistant to create one on your behalf. If you ask for a ticket, the assistant creates it in the Reltio Platform (RP) project under the parent epic RP-189333 and uses the new key as the prefix.
- **Base:** create the branch from the latest `main`. If the regression framework has not merged yet, branch from the framework branch instead and say so in the PR.
- The assistant must stop and ask if no ticket is given and no ticket creation is requested. It must not invent a ticket number.

## What you can ask for

The assistant asks for these when you paste the prompt. Give it a proposals JSON (a Drive link or the repo path, for example `docs/test-proposals/git-integration.json`) and choose a scope:

- **A particular test case:** give one or more row IDs, for example `GIT-002`.
- **The entire feature:** ask for the whole JSON; every row in it is in scope except rows marked `manual (Tier C)`, which get no script.

If you give a Drive link, the assistant reads that file and compares it with the matching JSON in the repo. If the two differ, the assistant stops and reports the difference instead of choosing one. The repo copy on your feature branch is the source of truth.

## Naming and file layout

- A regression script is named `scripts/test-<topic>.cjs`. `<topic>` is the source module or feature under test (`reltio-client`, `agent-skills`, `git-integration`), not necessarily the whole area. An area with several distinct topics has several scripts.
- The row's `target_script` in the area JSON is authoritative. Rows that name an existing script (a `test-<openspec-change>.cjs`) extend that script instead of creating a new one. Rows marked `manual (Tier C)` get no script.
- Before creating a script, check for an existing one that covers the same or similar behavior. If one does, extend it instead of creating a new script (the prompt makes the assistant do this check and show the result before writing anything).
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
