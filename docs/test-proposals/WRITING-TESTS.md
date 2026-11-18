# Writing regression tests from the proposals

How to turn rows of the proposals workbook into real tests, with a standard prompt and a standard failure simulation. Use these as written so every test follows the same structure.

## Standard prompt

Copy the block below, fill in `<area>` and the row IDs, and give it to your AI assistant.

```
Implement the regression tests for these rows of docs/test-proposals/<area>.json:
<ID-001, ID-004, ...>

Rules (do not deviate):
1. Read first: docs/test-proposals/README.md, ARCHITECTURE.md "Regression gate and
   coverage", and two existing scripts in scripts/ for style. Each row's `source`,
   `scenario` and `expected` fields are the spec; do not invent extra checks.
2. Only add or change files in scripts/ (the new test script, its registration in
   scripts/run-unit-tests.cjs) and the row `status` in the area JSON. Never edit src/,
   existing test scripts, scripts/lib/, package.json, workflows or .vscodeignore.
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
6. Set the rows' status to Implemented in the JSON and regenerate the workbook with
   python docs/test-proposals/build-workbook.py.
7. Then run the failure simulation below for each row and show me the output.
```

## Naming and file layout

- A regression script is named `scripts/test-<topic>-regression.cjs`. `<topic>` is the source module or feature under test (`reltio-client`, `agent-skills`, `git-integration`), not necessarily the whole area. An area with several distinct topics has several scripts.
- The row's `target_script` in the area JSON is authoritative. Rows that name an existing script (a `test-<openspec-change>.cjs`) extend that script instead of creating a new one. Rows marked `manual (Tier C)` get no script.
- Several rows may share one script. Keep one topic per file: if a script would mix unrelated sources or grow hard to review, split it and update the `target_script` of the affected rows in the JSON, then regenerate the workbook.
- Every script is registered in `SCRIPTS` in `scripts/run-unit-tests.cjs`, alphabetical.

## Standard failure simulation

A test that has never failed proves nothing. Run this for every row you implement.

1. **Baseline:** `npm run compile && node scripts/<target_script>` passes.
2. **Break one behavior:** make a one-line change in the file named in the row's `source` (flip a condition, remove a guard). Working tree only; never commit it.
3. **Recompile and run:** `npm run compile && node scripts/<target_script>`. It must exit non-zero with a message that starts with the row ID. If it passes, the test is too weak: strengthen it.
4. **Restore:** `git checkout -- src/` and `npm run compile`, then rerun the script and confirm it is green.
5. **Gate-level check:** temporarily set the area's floor to 100 in `scripts/module-coverage.config.json` and run `node scripts/check-module-coverage.cjs`. It must print `FAIL <area>`. Restore the floor afterwards.
6. **PR evidence:** paste the failing output and the restored green run into the PR description.

## Related

- `docs/test-proposals/README.md`: row schema, priority rubric, how to regenerate the workbook.
- `ARCHITECTURE.md` "Regression gate and coverage": how the gate, floors and areas work.
