# Product bug log

Running log of product bugs found while writing or running regression tests. Append new entries at the bottom; never delete or rewrite old ones. Change only the **Status** line as a bug moves along.

The test author does not fix bugs here (no edits under `src/`) and does not write a test that asserts the buggy behavior. Log it, then continue with the other rows.

## How to add an entry

Copy the template, use the next free `BUG-NNN`, and fill every field. Write "unknown" rather than guessing.

```
### BUG-NNN: <short title>

- **Status:** Suspected | Confirmed | Ticketed (RP-xxxxxx) | Fixed (<commit or PR>) | Won't fix
- **Found:** <YYYY-MM-DD> by <name or ticket> while writing <row ID, e.g. GIT-003>
- **Area / file:** <feature area>, `src/<path>`:<line or function>
- **Expected:** <what should happen>
- **Actual:** <what happens, with exact error text if any>
- **Repro:** <minimal steps or a failing snippet>
- **Impact:** <who is affected and how badly>
- **Test pointer:** <row ID or script that will cover it once fixed, or "none yet">
```

## Log

### BUG-001: `rebuildUriIndex` debounce timer is not disposed

- **Status:** Suspected (flagged during framework review, not yet reproduced)
- **Found:** 2026-11-18 by RP-208282 review
- **Area / file:** Navigation, the `rebuildUriIndex` debounce in the extension wiring
- **Expected:** The pending timer is cleared when the extension deactivates or the document closes.
- **Actual:** The timer appears to stay scheduled after disposal.
- **Repro:** unknown; confirm by reading the dispose path and checking for a leaked timer.
- **Impact:** A late callback may run against a disposed index. Likely low.
- **Test pointer:** none yet

### BUG-002: `isReltioDocument` may mishandle backslash paths

- **Status:** Suspected (flagged during framework review, not yet reproduced)
- **Found:** 2026-11-18 by RP-208282 review
- **Area / file:** Common Utils, `isReltioDocument`
- **Expected:** A `*.reltio.json` path is recognized on Windows (backslash) and POSIX (slash) alike.
- **Actual:** Backslash separators may not be handled.
- **Repro:** unknown; call it with a `C:\...\x.reltio.json` style path.
- **Impact:** The extension might not activate on some Windows paths. Unverified.
- **Test pointer:** none yet

### BUG-003: `reltio.revealInTreeView` is registered but not declared

- **Status:** Suspected (flagged during framework review, not yet reproduced)
- **Found:** 2026-11-18 by RP-208282 review
- **Area / file:** Extension activation, command registration vs `package.json` `contributes.commands`
- **Expected:** Every registered command is declared in `package.json`.
- **Actual:** `reltio.revealInTreeView` is registered in code but has no declaration.
- **Repro:** compare the registered command ids with `contributes.commands`.
- **Impact:** The command is not discoverable from the palette or menus. Likely low.
- **Test pointer:** none yet

### BUG-004: A check in `test-ontology-view.cjs` may be vacuous

- **Status:** Suspected (flagged during framework review, not yet reproduced)
- **Found:** 2026-11-18 by RP-208282 review
- **Area / file:** `scripts/test-ontology-view.cjs` (test code, not product code)
- **Expected:** Every assertion can fail when the behavior breaks.
- **Actual:** One check may pass whatever the input.
- **Repro:** break the behavior it claims to cover and see whether the script still passes.
- **Impact:** A regression in the ontology view could go unnoticed.
- **Test pointer:** none yet

### BUG-005: `UriIndex.build` throws on an empty or whitespace-only document

- **Status:** Confirmed
- **Found:** 2026-11-19 by RP-208563 while writing BIZCFG-001
- **Area / file:** Business Configuration, `src/parser/configParser.ts`:`parseDocument` (returns `ast` undefined for empty input) and `src/navigation/uriIndex.ts`:`UriIndex.build` / `walkAst` (dereferences it)
- **Expected:** `parseDocument('')` and `parseDocument('   ')` give `model` `{}` and `UriIndex.build(model, ast)` runs without an exception (BIZCFG-001 #2).
- **Actual:** `parseDocument` returns `model` `{}` but `ast` `undefined` (`parseTree` returns undefined for empty text), and `UriIndex.build` throws `TypeError: Cannot read properties of undefined (reading 'type')` in `walkAst`.
- **Repro:** `const { model, ast } = parseDocument(''); new UriIndex().build(model, ast);` against `dist/` (or open an empty `*.reltio.json`, which runs `rebuildUriIndex` in `src/extension.ts` with no guard).
- **Impact:** Opening or clearing a `*.reltio.json` to empty makes `rebuildUriIndex` throw, so navigation providers and diagnostics are not refreshed for that document. Low to medium.
- **Test pointer:** BIZCFG-001 #2 in `scripts/test-business-configuration.cjs` (assertion skipped, "blocked by BUG-005")
