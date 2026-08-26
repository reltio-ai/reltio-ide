## Context

`src/webview/ontologyView.ts` runs inside the ontology preview's webview (browser JS, no Node/VS Code API access). It receives graph data from the extension host (`src/ontology/ontologyPanel.ts`) over `postMessage`:

```ts
window.addEventListener('message', (e: MessageEvent) => {
	const msg = e.data;
	if (msg.type === 'setGraph') {
		graph = msg.graph;
		...
```

`e.origin` is never checked. Three automated-scanner findings trace through this file, all reachable from (or adjacent to) this handler:

1. **81219 / 81173** — missing origin validation on the `message` listener.
2. **81218** — `msg.graph` → `node` → string fields → `html +=` → `bodyHtml` → `div.innerHTML = ...` (`createInspector()`), a reflected-XSS *shape*.
3. **81220** — `msg.graph` → `node.id`, used as a dynamic property key (`positions[n.id] = ...` in `onPointerUp()`).

Manual tracing (not just the scanner) found:

- Every actual `bodyHtml`-building function (`renderAttrTree`, `renderRelTypeTree`, `showEntityInspector`, `showConnectionInspector`) already calls `escapeHtml()` on every string field. The only unescaped interpolations are `number` values, which cannot contain HTML metacharacters. `createInspector()`'s own `${escapeHtml(title)}` is likewise already escaped — only `${bodyHtml}` itself is inserted raw, by design, since it's pre-built HTML.
- `node.id` is not abstract "message data" — it's `uriToShortName(et.uri)` in `src/ontology/modelToGraph.ts`, derived directly from `entityTypes[].uri`/`relationTypes[].uri` in the user's own `.reltio.json`. A config file with an entity type URI ending in `/__proto__` reaches `positions[n.id] = {...}` in `onPointerUp()` through totally ordinary use (open the file, drag a node) — no `postMessage` spoofing required for this specific finding.
- `positions[n.id] = {...}` where `positions` starts as `{}` and `n.id === '__proto__'` reassigns `positions`'s own `[[Prototype]]` to the assigned `{x, y}` object (bracket assignment with a computed key equal to `__proto__` behaves exactly like `obj.__proto__ = value` — it is a special accessor inherited from `Object.prototype`, not an ordinary property write). This corrupts only that one local `positions` object, not `Object.prototype` globally (no `Object.assign`/spread of untrusted data onto a shared object exists in this file).

Also relevant: the webview's CSP (`src/ontology/ontologyPanel.ts`) is `default-src 'none'; script-src 'nonce-${nonce}'`, no `'unsafe-inline'`. This means even a real HTML-injection bug here cannot execute a `<script>` tag or an inline event-handler attribute today — *unless* the nonce itself is predictable, which is `getNonce()`'s use of `Math.random()`, tracked separately.

## Goals / Non-Goals

**Goals:**
- Reject any `message` event whose `e.origin` doesn't match the webview's own origin, before touching `e.data`.
- Make the "every field reaching `innerHTML` is escaped" property independently testable (not just eyeballed), by moving the pure HTML-building functions into a `tsc`-compiled module the existing `importDist`-based test harness can import, and adding a regression test that runs a hostile fixture through the real pipeline.
- Stop `onPointerUp()`'s dynamic-key assignment from being able to rewrite an object's prototype, regardless of what `n.id` is.

**Non-Goals:**
- `getNonce()` / `Math.random()` — separate, already-tracked ticket. Called out here because Issue 2's real-world severity depends on it (see Context), but not fixed in this change.
- No change to `src/ontology/ontologyPanel.ts` (extension-host side) — it already builds `graph` from the user's own parsed document and does not itself trust any webview-supplied structural data beyond `positions`/`nodeId`/`uri` strings already covered by `saveLayout()`'s own JSON round-trip (a `JSON.parse()`-produced `__proto__` key is an ordinary own property, not a prototype rewrite — the vulnerable pattern is specific to the webview's own bracket-assignment-into-`{}`, not to `ontologyPanel.ts`).
- No change to the webview's message *types* or wire shape (`setGraph`, `setPositions`, `savePositions`, `revealInEditor`, etc.) — only how the handler validates the sender and how existing data is used afterward.
- Not attempting a general prototype-pollution audit of the whole codebase — scoped to the one dynamic-key assignment this ticket's finding traces to.

## Decisions

**D1. Origin check compares `e.origin` to `window.origin`, captured once at webview bootstrap — not a hardcoded string.**

VS Code assigns each webview panel instance a random `vscode-webview://<uuid>` origin; there is no fixed value to hardcode, and it changes per panel instance/session. The webview's own script runs at exactly that origin, so it can observe its true value via `window.origin` the moment it starts executing — before any message could plausibly have arrived yet. This is the pattern the VS Code community/maintainers recommend for exactly this situation (as opposed to matching against a `vscode-webview:` string prefix, which is only needed for extensions that must also run in vscode.dev/web, or trusting a `parentOrigin` query parameter, which was the root cause of a real historical VS Code CVE — see Risks below).

```ts
const trustedOrigin = window.origin;
...
window.addEventListener('message', (e: MessageEvent) => {
	if (!isTrustedMessageOrigin(e.origin, trustedOrigin)) return;
	const msg = e.data;
	...
```

`isTrustedMessageOrigin()` is a one-line pure function (strict equality) — deliberately trivial, but named and exported so the intent is documented and it's independently testable rather than an inline `if`.

*Alternative considered:* checking `e.origin.startsWith('vscode-webview:')`. Rejected — this extension is a desktop-only extension (no `extensionKind: ["workspace"]`/web-extension support declared), so there's no vscode.dev scenario to accommodate, and a prefix check is strictly weaker than an exact match against the webview's own captured origin.

**D2. Move the pure HTML-building functions to a new `src/ontology/inspectorHtml.ts`, not just add a test that pokes at webview internals.**

`src/webview/ontologyView.ts` is excluded from `tsc` (`tsconfig.json` excludes `src/webview`) and bundled separately via esbuild in IIFE/browser format — it calls `init()` unconditionally at module load, which touches `document` and would throw immediately under plain Node. There is no existing harness that loads this file directly (`test-ontology-view.cjs` only imports `src/ontology/modelToGraph.ts` and `src/ontology/layoutPersistence.ts`, both `tsc`-compiled).

`escapeHtml`, `shortUri`, `renderAttrTree`, `renderRelTypeTree`, and the HTML-string-building bodies of `showEntityInspector`/`showConnectionInspector` have zero DOM dependency — they only ever build and return strings. Moving them into `src/ontology/inspectorHtml.ts` (inside `tsc`'s compiled tree) makes them importable via the existing `importDist()` helper, so a regression test can call them directly with hostile input and assert on the returned string, instead of only reading the source and reasoning about it by eye. `esbuild --bundle` for `dist/webview.js` follows the import unchanged — the browser bundle doesn't care that a leaf module also happens to be independently compiled by `tsc` in parallel.

This also resolves the "Webview type sharing" item already logged in `ARCHITECTURE.md`'s Architectural Opportunities: `AttrInfo`/`GraphNode`/`RelTypeInfo`/`GraphEdge`/`GraphModel` were redeclared verbatim in `ontologyView.ts`; `inspectorHtml.ts` imports them from `src/ontology/modelToGraph.ts` instead, and `ontologyView.ts` now imports the same types rather than keeping its own copy.

*Alternative considered:* leave the functions in `ontologyView.ts` and add a manual QA checklist item only (Tier C). Rejected — this is exactly the kind of security-relevant invariant ("everything reaching `innerHTML` is escaped") that regresses silently under future edits without an automated check; the ticket's own acceptance criteria ask for a trace/test, not a one-time read-through.

**D3. `escapeHtml()` also escapes `'` (single quote).**

No current interpolation site in this file uses single-quoted HTML attributes, so this isn't closing an active gap — but a production `escapeHtml` conventionally escapes `&`, `<`, `>`, `"`, and `'`, and it costs nothing to match that now rather than leave a narrower function that a future single-quoted attribute could slip past.

**D4. Fix `onPointerUp()`'s dynamic-key assignment with `Object.create(null)` (via a `createKeyedMap()` helper), not a key-name blocklist.**

```ts
const positions = createKeyedMap<{ x: number; y: number }>();
for (const n of graph.nodes) positions[n.id] = { x: n.x, y: n.y };
```

`createKeyedMap()` returns `Object.create(null)` — an object with no inherited prototype at all, so `__proto__` (and `constructor`, `prototype`, or anything else) is just an ordinary string key with no special accessor behavior. This is more robust than checking `n.id` against an explicit list of dangerous names before the assignment, since it doesn't depend on the list staying complete, and it has no behavioral effect on any legitimate node ID. `Record<string, T>` (the existing TypeScript type for `positions`) is unaffected — TypeScript doesn't distinguish a null-prototype object from a plain one at the type level, only at runtime, which is exactly the property being fixed.

The receiving side (`setPositions`'s `msg.positions[node.id]`, and `layoutPersistence.ts`'s `applyLayout()`) is unaffected by this change: those are reads using an already-trusted `graph`'s own node IDs (not a write with an attacker-influenced key onto a shared object), and — separately — anything crossing the `postMessage`/JSON boundary is reconstructed as a normal `Object.prototype`-having object on the other side regardless of the sender's prototype (structured-clone/`JSON.parse` both produce an ordinary own property for a `"__proto__"` key; they do not trigger the special assignment-time accessor). No change needed on that side for this finding.

*Alternative considered:* `if (n.id === '__proto__' || n.id === 'constructor' || n.id === 'prototype') continue;` before the assignment. Rejected as the primary fix — it's easy to reason about but relies on remembering every dangerous key name; `Object.create(null)` removes the entire class of magic-name accessors in one line, so a future addition to that finite (but not always obvious) set of names can't be missed.

## Risks / Trade-offs

- **Origin check breaks legitimate messages in some VS Code hosting mode this extension doesn't currently target** → The extension is desktop-only (no web-extension support declared in `package.json`), and `window.origin` is read from inside the same webview content the extension host posts to — the standard, community-recommended pattern for this exact scenario. If web/vscode.dev support is ever added, this is the first place to revisit.
- **A real historical VS Code core CVE (CVE-2021-43908) involved a webview's own `postMessage` origin check** → That CVE was in a different, insecure pattern: trusting an attacker-suppliable `parentOrigin` query-string parameter instead of the page's own observed origin, and it was a bug in VS Code core's webview host infrastructure (since patched), not an extension-authored message handler. This design's `window.origin`-based check is the pattern VS Code's own current webview host code uses internally (`_webviewContentOrigin` comparison in `webviewElement.ts`) and does not reproduce that pattern.
- **Moving functions to `src/ontology/inspectorHtml.ts` could regress the webview bundle if esbuild fails to resolve the new relative import** → Mitigated by running `npm run build` (both bundles) as part of verification before committing.
- **`escapeHtml()` now also escapes `'`, changing output for any existing test/fixture asserting exact HTML strings** → Checked: no existing test asserts exact `bodyHtml`/inspector HTML output; `test-ontology-view.cjs` only checks graph/layout structure, not rendered HTML.

## Migration Plan

No persisted state changes, no message-type/wire-shape changes. Purely internal: an untrusted-origin `message` event that was previously acted upon is now silently ignored (there is no legitimate sender today whose messages would be dropped by this check). Rollback is reverting the commit.

## Open Questions

- None. All three findings from the security review are addressed within this change's scope; the one related-but-out-of-scope item (nonce hardening) is called out explicitly above.

## Test plan

**Automated (Tier A)**, in `scripts/test-ontology-webview-hardening.cjs`

| # | Assertion |
|---|---|
| 1 | `isTrustedMessageOrigin()` returns `true` only for an exact string match; returns `false` for a different origin, an empty string, and `"null"` (the literal string browsers report for a sandboxed/opaque origin) |
| 2 | `escapeHtml()` escapes `&`, `<`, `>`, `"`, and `'`, individually and combined in one string |
| 3 | `createKeyedMap()` returns an object with `Object.getPrototypeOf(map) === null`; assigning `map['__proto__'] = value` does not change that, and the value is retrievable via `map['__proto__']` as an ordinary entry |
| 4 | `createKeyedMap()` behaves identically for `'constructor'` and `'prototype'` keys |
| 5 | End-to-end: build a `GraphModel` (via `buildGraphModel()`) from a fixture with a hostile attribute name (e.g. `"><img src=x onerror=alert(1)>`) and a hostile relation-type label; run the result through `renderAttrTree()` / `buildEntityInspectorHtml()` / `buildConnectionInspectorHtml()`; assert the returned HTML string contains no raw `<img`, `<script`, or unescaped `onerror=` — only their escaped (`&lt;`/`&quot;`) forms |
| 6 | `buildEntityInspectorHtml()` output for a node with `matchGroupCount` renders the count without escaping artifacts (regression check: numeric interpolations stay raw, since they cannot carry HTML metacharacters) |

**Manual QA (Tier C)**

| # | Check |
|---|---|
| 1 | Open the ontology preview for a `.reltio.json` with an entity type or attribute name containing `<`, `"`, or `onerror=`; confirm it renders as literal text in the diagram and in the double-click inspector popup, not as markup |
| 2 | Confirm the ontology preview's normal flows (open, pan/zoom, drag a node, double-click for inspector, right-click context menu, `Show in Editor`/`Show in Tree View`) still work with no visible change for ordinary (non-hostile) configuration files |
| 3 | With the browser DevTools open on the webview (`Developer: Open Webview Developer Tools`), drag a node and confirm no console error appears from the `positions` map change |
