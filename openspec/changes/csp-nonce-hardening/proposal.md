## Why

`src/ontology/ontologyPanel.ts` and `src/entityBrowser/entityDetailPanel.ts` each define their own `getNonce()`, generating the CSP nonce for their webview's `<script nonce="...">`/`<style nonce="...">` tags by picking characters with `Math.random()`. `Math.random()` is not a cryptographically secure PRNG — it's seeded and reproducible, and its output has been shown to be predictable in modern V8. A nonce whose value can be predicted or brute-forced defeats the purpose of the CSP's `script-src 'nonce-...'` directive: it exists specifically so only the extension's own injected `<script>`/`<style>` tags execute, not anything an attacker manages to get into the page. This is inconsistent with the rest of the codebase, which already generates the OAuth `state` parameter (`src/api/oauthLogin.ts`) via `crypto.randomBytes` — a real CSPRNG.

## What Changes

- Both `getNonce()` implementations now return `crypto.randomBytes(16).toString('hex')` — a 32-character lowercase-hex string, the same length as the previous `Math.random()`-based output, but drawn from Node's CSPRNG instead.
- No change to how the nonce is used (still interpolated into the CSP header and the `nonce` HTML attribute) or to any webview message/HTML-building logic.

## Capabilities

### New Capabilities

- `csp-nonce-generation`: both webview panels (`Ontology Preview`, `Entity Detail`) generate their per-render CSP nonce via a cryptographically secure random source.

### Modified Capabilities

- None. No existing tracked capability names this behavior; nonce generation had no documented security requirement before this change.

## Impact

**Code**
- `src/ontology/ontologyPanel.ts`: `getNonce()`, new `crypto` import.
- `src/entityBrowser/entityDetailPanel.ts`: `getNonce()`, new `crypto` import.

**External API**
- None. Purely internal to how each panel's HTML is rendered.

**Tests**
- New `scripts/test-csp-nonce-hardening.cjs`: asserts neither source file references `Math.random`, both import `crypto` and call `crypto.randomBytes(16).toString('hex')`, and that the resulting value shape (32-char lowercase hex, non-colliding across calls) is safe to interpolate into both a CSP header and an HTML attribute unescaped.

**Not in scope**
- The ontology webview's `postMessage` origin validation and HTML-escaping (a separate, already-filed change).
