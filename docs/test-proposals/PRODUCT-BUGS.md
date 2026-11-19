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

### BUG-008: "Configure OAuth Client" environment menu entry is not gated off in git workspaces

- **Status:** Confirmed
- **Found:** 2026-11-19 by RP-208563 while writing TREE-007
- **Area / file:** Tenant Explorer & UX, `package.json` `contributes.menus` `view/item/context`, the `reltio.configureOAuthClient` entry (group `1_auth@0`)
- **Expected:** Like every other tenant-connectivity entry on environment rows, it is hidden when `reltio.workspaceSource == 'git'`.
- **Actual:** The clause is `viewItem == reltio.environment.unauthorized.oauthBlocked || viewItem =~ /^reltio\.environment\.authorized(\.noTenants)?$/ && reltio.workspaceSource != 'git'`. `&&` binds tighter than `||`, so the git gate applies only to the second disjunct; an `unauthorized.oauthBlocked` environment row shows Configure OAuth Client in a git workspace.
- **Repro:** evaluate the clause with `viewItem = reltio.environment.unauthorized.oauthBlocked` and `reltio.workspaceSource = 'git'`: true. Fix is likely parentheses around the two `viewItem` terms.
- **Impact:** Low. Git-sourced environments normally carry the `GIT_SOURCE_TOKEN` sentinel and render as `authorized`, so the row is reached only if that token is missing; the user would then be offered OAuth setup for a repository that needs no authentication.
- **Test pointer:** TREE-007 #1 in `scripts/test-tenant-explorer-ux.cjs` (`reltio.configureOAuthClient` excluded from the git-workspace check, "blocked by BUG-008")

### BUG-009: Recents push throws on non-array stored data

- **Status:** Confirmed
- **Found:** 2026-11-19 by RP-208563 while writing TREE-012
- **Area / file:** Tenant Explorer & UX, `src/ux/recents.ts`:`pushRecentHost` and `pushRecentTenant`
- **Expected:** A malformed `reltio.recentHosts` / `reltio.recentTenants` value in globalState is ignored or replaced, and the push succeeds.
- **Actual:** `pushRecentTenant` throws `TypeError: (map[host] ?? []).filter is not a function` when the stored value for that host is not an array; `pushRecentHost` throws `TypeError: loadRecentHosts(...).filter is not a function` when the stored hosts value is not an array.
- **Repro:** `pushRecentTenant(memento seeded with { 'reltio.recentTenants': { h: 'x' } }, 'h', 't')`, or `pushRecentHost(memento seeded with { 'reltio.recentHosts': 'x' }, 'h')`.
- **Impact:** Low. Only reachable after globalState is corrupted or written by another version; the setup flow that records recents would then fail with an exception.
- **Test pointer:** none yet (TREE-012 #1 covers the empty store, copy-on-write and pushing next to a non-array key, which pass; pushing to the non-array key itself is not in the row's `expected`)

### BUG-010: BPMN parsing takes seconds on unterminated comments or an unclosed `<process`

- **Status:** Confirmed
- **Found:** 2026-11-19 by RP-208563 while writing WF-009
- **Area / file:** Workflows, `src/workflow/bpmnModel.ts`:`blankIgnoredRegions` (the global `<!--[\s\S]*?-->` replace, about line 194) and `extractProcessModel` (the `PROCESS_TAG` regex `<(?:[\w.-]+:)?process\b([^>]*)>`, lines 130 and 207); `analyseBpmn` in `src/workflow/bpmnDiagnostics.ts` inherits both through `extractProcessModel`
- **Expected:** `extractProcessModel`, `findXmlProblem` and `analyseBpmn` return within a generous budget (2 s each) on hostile 2 MB-class inputs (WF-009 #3).
- **Actual:** Both regexes rescan to the end of the text from every failed start position, so the cost is quadratic. 100,000 unterminated `<!--` (400 KB): `extractProcessModel` about 8.7 s, `analyseBpmn` about 8.5 s. `<definitions>` plus 100,000 `<process ` with no `>` (900 KB): about 32.7 s each. `findXmlProblem` returns in about 1 ms on both. A 1 MB attribute value, 50,000-deep nesting and a DOCTYPE with entities are fine.
- **Repro:** `extractProcessModel('<definitions><process id="p">' + '<!--'.repeat(100000))` or `extractProcessModel('<definitions>' + '<process '.repeat(100000))` against `dist/`.
- **Impact:** Opening, previewing or linting a crafted or badly truncated `.bpmn20.xml` (for example from a connected repository) blocks the extension host for seconds to a minute. Medium.
- **Test pointer:** WF-009 #3 in `scripts/test-workflow-input-trust.cjs` (these two inputs skipped, "blocked by BUG-010")

### BUG-011: A process id ending in a dot is accepted

- **Status:** Confirmed
- **Found:** 2026-11-19 by RP-208563 while writing WF-009
- **Area / file:** Workflows, `src/workspace/workflowBpmnFiles.ts`:`PROCESS_ID_PATTERN` / `isValidProcessId` / `processIdValidationMessage` (lines 61-85)
- **Expected:** An id with a trailing dot is rejected with a validation message, `processIdFromBpmnFileName` returns undefined for it, and `planBulkDownload` marks it unusable (WF-009 #2).
- **Actual:** `/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/` allows a final `.`, so `isValidProcessId('abc.')` is true and `processIdValidationMessage('abc.')` is undefined.
- **Repro:** `isValidProcessId('abc.')` against `dist/`: `true`.
- **Impact:** Low. The file name becomes `abc..bpmn20.xml`, which Windows accepts, so no write escapes the folder; it is a gap against the stated validation rule only, and whether a trailing dot should be refused is unknown.
- **Test pointer:** WF-009 #2 in `scripts/test-workflow-input-trust.cjs` (trailing-dot id left out, "blocked by BUG-011")

### BUG-012: Delete and Rename on "Browse Entities" act on the whole entity type

- **Status:** Confirmed
- **Found:** 2026-11-19 by RP-208563 while writing TREE-013
- **Area / file:** Tenant Explorer & UX, `package.json` `contributes.menus` `view/item/context`, the `reltio.deleteNode` and `reltio.renameNode` entries (group `7_modification`); the row comes from `src/tree/configSubtree.ts`:`getEntityTypeChildren` (`new ConfigTreeItem('Browse Entities', 'entityBrowser', path, ...)`, about line 229)
- **Expected:** Browse Entities is a virtual row (it opens the entity browser, not a JSON node), so Delete and Rename are not offered on it, the same way `reltio.item.lifecycleActions` is excluded.
- **Actual:** Both clauses are `viewItem =~ /^reltio\.item\./ && viewItem != reltio.item.lifecycleActions`, which matches `reltio.item.entityBrowser`. The Browse Entities item carries the entity type's own `jsonPath`, so Delete removes the entire entity type from the L3 (after a modal "Delete "Browse Entities"?") and Rename rewrites the entity type's `label` and the last segment of its `uri`.
- **Repro:** evaluate the `reltio.deleteNode` clause with `viewItem = reltio.item.entityBrowser`: true. In the IDE, right-click Browse Entities under an entity type, Delete, confirm: the entity type disappears.
- **Impact:** Medium. A destructive action on a row that reads as a viewer; the confirmation names "Browse Entities", not the entity type that is actually deleted. Undo in the editor recovers it.
- **Test pointer:** TREE-013 #8 in `scripts/test-tenant-explorer-ux.cjs` (`reltio.item.entityBrowser` left out of the deleteNode / renameNode comparison, "BUG-012")

### BUG-013: "Reset OAuth Client" is missing on a signed-in browser-login environment with no tenants

- **Status:** Confirmed
- **Found:** 2026-11-19 by RP-208563 while writing TREE-013
- **Area / file:** Tenant Explorer & UX, `package.json` `contributes.menus` `view/item/context`, the `reltio.resetOAuthClient` entry (group `1_auth@0`); the suffix is added in `src/tree/multiTenantNodes.ts`:`EnvironmentNode` (`.noTenants`, about line 30)
- **Expected:** Every environment row with a configured OAuth client (`.oauthReady`) offers Reset OAuth Client. The `EnvironmentNode` comment says the `.noTenants` suffix is additive so that existing clauses keep matching.
- **Actual:** The clause is `viewItem =~ /^reltio\.environment\..*\.oauthReady$/ && ...`; the `$` anchor rejects `reltio.environment.authorized.oauthReady.noTenants`. Configure OAuth Client does not match that value either (`authorized(\.noTenants)?$`), so the row has no OAuth client action at all. `reltio.reLoginWithBrowser` handles the suffix with `(\.noTenants)?`.
- **Repro:** evaluate the clause with `viewItem = reltio.environment.authorized.oauthReady.noTenants`: false.
- **Impact:** Low. A user signed in through the browser whose environment has no tenants yet cannot reset a wrong OAuth client from the row until a tenant is added or they sign out.
- **Test pointer:** TREE-013 #8 in `scripts/test-tenant-explorer-ux.cjs` (`reltio.environment.authorized.oauthReady.noTenants` left out of the resetOAuthClient comparison, "BUG-013")
