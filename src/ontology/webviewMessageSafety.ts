/**
 * Dependency-free helpers shared between the ontology webview (bundled separately by esbuild,
 * browser-only) and the extension host's `tsc`-compiled tree — kept outside `src/webview/` so
 * the `importDist()` test harness can exercise them directly.
 */

/**
 * VS Code assigns each webview panel instance a random `vscode-webview://<uuid>` origin —
 * there is no fixed value to hardcode, and it changes per panel instance/session. The
 * webview's own script observes its true origin via `window.origin` the moment it starts
 * running, before any `message` event could plausibly have arrived; that captured value is
 * `expectedOrigin` here. Every incoming `message` event's origin must be checked against it
 * before its data is trusted.
 */
export function isTrustedMessageOrigin(candidateOrigin: string, expectedOrigin: string): boolean {
	return candidateOrigin === expectedOrigin;
}

/**
 * A dictionary object with no inherited prototype (`Object.create(null)`), so a dynamic key
 * equal to a "magic" JS property name (`__proto__`, `constructor`, `prototype`, ...) is stored
 * as an ordinary own property instead of reaching into the object's internal prototype wiring.
 *
 * `positions[node.id] = value` in the ontology webview's `onPointerUp()` uses a node ID as a
 * dynamic key, and that ID is not arbitrary —
 * it's a short name derived directly from an entity/relation type URI in the user's own
 * `.reltio.json` (`uriToShortName()` in `modelToGraph.ts`). An entity type named `__proto__`
 * reaches this assignment through ordinary use (open the file, drag a node) with no
 * `postMessage` spoofing required. On a plain `{}`, `positions['__proto__'] = value` is
 * equivalent to `positions.__proto__ = value` — a special accessor inherited from
 * `Object.prototype` that reassigns the object's own prototype — not an ordinary property
 * write. `Object.create(null)` removes that accessor entirely, so the key behaves like any
 * other string.
 */
export function createKeyedMap<T>(): Record<string, T> {
	return Object.create(null) as Record<string, T>;
}
