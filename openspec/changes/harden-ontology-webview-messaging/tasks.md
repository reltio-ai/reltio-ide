# Tasks: harden-ontology-webview-messaging

## 1. New shared modules

- [x] 1.1 Create `src/ontology/webviewMessageSafety.ts`: `export function isTrustedMessageOrigin(candidateOrigin: string, expectedOrigin: string): boolean` and `export function createKeyedMap<T>(): Record<string, T>` (`Object.create(null)`), each with a comment explaining the specific issue it closes (design D1, D4).
- [x] 1.2 Create `src/ontology/inspectorHtml.ts`: move `escapeHtml`, `shortUri`, `renderAttrTree`, `renderRelTypeTree` here verbatim (plus `'` escaping in `escapeHtml`, design D3); import `AttrInfo`/`GraphNode`/`RelTypeInfo`/`GraphEdge` types from `./modelToGraph` instead of redeclaring them (design D2).
- [x] 1.3 In `inspectorHtml.ts`, add `buildEntityInspectorHtml(node: GraphNode, connectedEdges: GraphEdge[]): string` and `buildConnectionInspectorHtml(edge: GraphEdge): string` — the pure, HTML-string-building halves of `showEntityInspector`/`showConnectionInspector` (everything up to the `createInspector(...)` call).

## 2. Webview change (`src/webview/ontologyView.ts`)

- [x] 2.1 Remove the local `AttrInfo`/`GraphNode`/`RelTypeInfo`/`GraphEdge`/`GraphModel` interface declarations; import them from `../ontology/modelToGraph` instead.
- [x] 2.2 Remove the local `escapeHtml`, `shortUri`, `renderAttrTree`, `renderRelTypeTree` definitions; import them (plus `buildEntityInspectorHtml`, `buildConnectionInspectorHtml`) from `../ontology/inspectorHtml`.
- [x] 2.3 Rewrite `showEntityInspector`/`showConnectionInspector` to call the new `build*Html()` functions and pass the result straight to `createInspector(...)`.
- [x] 2.4 Add `const trustedOrigin = window.origin;` near the top-level webview state; import `isTrustedMessageOrigin` from `../ontology/webviewMessageSafety`.
- [x] 2.5 In the `window.addEventListener('message', ...)` handler, reject (return early from) any event where `!isTrustedMessageOrigin(e.origin, trustedOrigin)`, before reading `e.data` (design D1).
- [x] 2.6 In `onPointerUp()`, build `positions` via `createKeyedMap<{ x: number; y: number }>()` instead of a `{}` object literal (design D4).

## 3. Tests

- [x] 3.1 Create `scripts/test-ontology-webview-hardening.cjs` covering Test plan rows 1–6 (design.md), using `importDist()` for `inspectorHtml`, `webviewMessageSafety`, and `modelToGraph`, following the pattern in `scripts/test-ontology-view.cjs`.
- [x] 3.2 Register the new script in the `SCRIPTS` array in `scripts/run-unit-tests.cjs`, alphabetically.
- [x] 3.3 Run `npm test` and confirm every script passes, including pre-existing ones (no regression in `test-ontology-view.cjs` from the type-import change). Note: `test-skills-and-enablement-packs-library.cjs` fails on this checkout with a velocity-packs manifest byte-count mismatch; confirmed pre-existing on `main` (same failure noted in the `harden-reltio-client-base-url` change) and unrelated to this change.

## 4. Docs

- [x] 4.1 `ARCHITECTURE.md`: remove the now-resolved "Webview type sharing" entry from Architectural Opportunities (types are imported, not duplicated).
- [x] 4.2 `ARCHITECTURE.md`: note the `message` origin check in the Concurrency Model and/or Key Design Patterns section.

## 5. Verification

- [x] 5.1 `npm run compile` clean.
- [x] 5.2 `npm test` green.
- [x] 5.3 `npm run build` clean (extension host and webview bundles both build; confirms the new cross-module imports resolve for esbuild).
- [ ] 5.4 Work the Tier C manual QA table in `design.md`. Needs a live ontology preview session; not runnable from this environment.
- [x] 5.5 `npm run openspec -- validate --changes` clean for this change.

## 6. Pull request

- [x] 6.1 Commit on `RP-195043-ontology-webview-message-hardening`.
- [ ] 6.2 Open a PR referencing this OpenSpec change.
