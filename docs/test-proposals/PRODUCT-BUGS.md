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

- **Status:** Confirmed (2026-11-19, RP-208563 ACT-011 #1: a Reltio edit followed by disposing every `context.subscriptions` entry still rebuilds once 300 ms later; assertion skipped in `scripts/test-extension-activation.cjs`)
- **Found:** 2026-11-18 by RP-208282 review
- **Area / file:** Navigation, the `rebuildUriIndex` debounce in the extension wiring
- **Expected:** The pending timer is cleared when the extension deactivates or the document closes.
- **Actual:** The timer appears to stay scheduled after disposal.
- **Repro:** unknown; confirm by reading the dispose path and checking for a leaked timer.
- **Impact:** A late callback may run against a disposed index. Likely low.
- **Test pointer:** none yet

### BUG-002: `isReltioDocument` may mishandle backslash paths

- **Status:** Suspected (2026-11-19, RP-208563 ACT-011 #2: not reproduced for `*.reltio.json`, which matches with backslashes; the confirmed backslash defect is the `L3.json` / `BusinessConfig.json` basename match, logged as BUG-007)
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

### BUG-006: Walkthrough is not suppressed for a user with OAuth credentials but no environment in the workspace

- **Status:** Confirmed
- **Found:** 2026-11-19 by RP-208563 while writing ACT-008
- **Area / file:** Extension Activation, `src/extension.ts`:`activate` walkthrough suppression block (`reltio.walkthroughSeen`, about line 5260)
- **Expected:** With empty globalState, a workspace with no environment but with OAuth client credentials in SecretStorage sets `reltio.walkthroughSeen` to true (ACT-008 #2(b)).
- **Actual:** The flag stays unset. `hasAnyOAuth` is computed only by calling `oauthCredentialsStore.hasClientCredentials(e.name)` for each scanned environment, so with zero environments the loop never runs, and with one or more environments `envs.length > 0` already sets the flag. The credential check can never change the outcome.
- **Repro:** activate with an empty folder, empty globalState and SecretStorage holding `reltio.oauth.dev.reltio.com.clientId` / `clientSecret`; read `globalState.get('reltio.walkthroughSeen')`: `undefined`.
- **Impact:** An upgrade user who opens a new, empty folder sees the first-run walkthrough again. Low.
- **Test pointer:** ACT-008 #2(b) in `scripts/test-extension-activation.cjs` (assertion skipped, "blocked by BUG-006")

### BUG-007: `L3.json` and `BusinessConfig.json` are not recognized on backslash (Windows) paths

- **Status:** Confirmed
- **Found:** 2026-11-19 by RP-208563 while writing ACT-011
- **Area / file:** Extension Activation, `src/extension.ts`:`isReltioDocument` (about line 268)
- **Expected:** `C:\ws\env\tenant\L3.json` and `C:\ws\env\tenant\BusinessConfig.json` count as Reltio documents, as their forward-slash forms do.
- **Actual:** The basename is taken with `doc.fileName.split(/[\/]/)`, whose character class holds only `/`, so a backslash path yields the whole path as the "basename" and never equals `l3.json` / `businessconfig.json`. No UriIndex rebuild, navigation refresh or diagnostics run for those documents. `*.reltio.json` is unaffected (it uses `endsWith`).
- **Repro:** fire the active-editor listener with a document whose `fileName` is `C:\ws\env\tenant\L3.json`: zero rebuilds (forward-slash form: one).
- **Impact:** On Windows, where `TextDocument.fileName` uses backslashes, an opened `L3.json` / `BusinessConfig.json` gets no navigation index or unresolved-URI diagnostics until another trigger. Medium for Windows users.
- **Test pointer:** ACT-011 #2 in `scripts/test-extension-activation.cjs` (assertion skipped, "blocked by BUG-007")
