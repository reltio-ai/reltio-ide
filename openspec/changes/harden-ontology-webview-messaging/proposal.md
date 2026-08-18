## Why

`src/webview/ontologyView.ts`'s `window.addEventListener('message', ...)` handler trusts any incoming `message` event without checking `e.origin`, and two of the values it then acts on — HTML built for the inspector popup, and a node ID used as a dynamic object key — are shaped like classic web-security bug patterns (reflected XSS, prototype-pollution-via-dynamic-key). All three were flagged in an internal security review.

## What Changes

- **Origin check.** The webview captures its own origin (`window.origin`) at bootstrap and rejects any `message` event whose `e.origin` doesn't match it, before touching `e.data` at all.
- **HTML-escaping, made verifiable.** The pure, DOM-free HTML-string-building functions (`escapeHtml`, `renderAttrTree`, `renderRelTypeTree`, and the string-building halves of `showEntityInspector`/`showConnectionInspector`) move out of `src/webview/ontologyView.ts` into a new `src/ontology/inspectorHtml.ts` — a normal `tsc`-compiled module the existing test harness (`importDist`) can exercise directly. A regression test now feeds a deliberately hostile `.reltio.json` fixture (entity/attribute names containing `<script>`, `"`, `onerror=`, etc.) through the real graph-building + inspector-HTML pipeline and asserts the output never contains an unescaped tag or attribute. `escapeHtml()` also now escapes `'`, matching a normal production `escapeHtml` implementation.
- **Safe dynamic keys.** `onPointerUp()`'s `positions[n.id] = {...}` — where `n.id` is a short name derived directly from a URI in the user's own `.reltio.json` — now builds `positions` via a small `createKeyedMap()` helper (`Object.create(null)`) instead of `{}`, so a node named `__proto__` (or `constructor`/`prototype`) is stored as an ordinary entry instead of rewriting the object's own prototype.
- **Type de-duplication, as a side effect.** `ontologyView.ts` now imports `AttrInfo`/`GraphNode`/`RelTypeInfo`/`GraphEdge`/`GraphModel` from `src/ontology/modelToGraph.ts` instead of redeclaring them locally — this was already called out as a drift risk in `ARCHITECTURE.md`'s Architectural Opportunities, and moving the HTML builders forced the same import anyway.

## Capabilities

### New Capabilities

- `ontology-webview-message-hardening`: the ontology webview validates the origin of every incoming `message` event, and never lets untrusted data reach the DOM unescaped or become a raw dynamic object key.

### Modified Capabilities

None. No existing tracked capability names this behavior; the webview's message handling had no documented trust boundary before this change.

## Impact

**Code**
- `src/webview/ontologyView.ts`: origin check on the `message` listener, `positions` built via `createKeyedMap()`, local type/HTML-builder duplication removed in favor of shared imports.
- `src/ontology/inspectorHtml.ts` (new): `escapeHtml`, `shortUri`, `renderAttrTree`, `renderRelTypeTree`, `buildEntityInspectorHtml`, `buildConnectionInspectorHtml`.
- `src/ontology/webviewMessageSafety.ts` (new): `isTrustedMessageOrigin`, `createKeyedMap`.

**External API**
- None. No new outbound calls or message types; the webview now silently drops a `message` event from an unexpected origin instead of acting on it.

**Tests**
- New `scripts/test-ontology-webview-hardening.cjs` covering the origin check, the safe-key map, `escapeHtml`, and an end-to-end hostile-fixture escaping check through the graph + inspector-HTML pipeline.

**Docs**
- `ARCHITECTURE.md`: resolve the "Webview type sharing" Architectural Opportunity (types are no longer duplicated); note the origin check in the Concurrency Model / Key Design Patterns sections.

**Not in scope**
- `getNonce()`'s use of `Math.random()` in `src/ontology/ontologyPanel.ts` and `src/entityBrowser/entityDetailPanel.ts` — tracked separately. Noted in `design.md` as a related, complementary fix.
