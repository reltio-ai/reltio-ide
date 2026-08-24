## Context

Both webview panels set a per-render CSP nonce so their inline `<script>`/`<style>` tags are allowed to run under a strict `default-src 'none'` policy, while anything an attacker manages to inject is not (it won't carry the matching `nonce-...` value). That guarantee only holds if the nonce is unpredictable ahead of time. `Math.random()` is a fast, non-cryptographic PRNG — not seeded from an entropy source suitable for security purposes, and its internal state is small enough that, in the worst case, a sequence of outputs can narrow down or reconstruct that state. Whether or not a practical exploit exists against a single per-render nonce viewed once, using a non-CSPRNG here is a needless weakening of a control whose entire job is to resist prediction, and it's inconsistent with `src/api/oauthLogin.ts`, which already generates its OAuth `state` value with `crypto.randomBytes` for exactly this reason.

## Decision

Replace both `getNonce()` bodies with `crypto.randomBytes(16).toString('hex')`:

- **Same call, same shape, in both files** — mirrors `oauthLogin.ts`'s existing `crypto.randomBytes(16).toString('hex')` call exactly, rather than introducing a new pattern. `16` bytes → 32 hex characters, matching the previous implementation's 32-character output length, so nothing downstream (CSP header length, HTML attribute) needs to change.
- **`hex`, not the original mixed-case alphanumeric charset.** The nonce is never parsed or compared against a fixed charset anywhere in the codebase (checked: both files' only other reference is string-interpolating the same `nonce` value into the CSP header and the `nonce="..."` attribute) — the CSP `nonce-` directive and the HTML attribute both accept any string. Hex was chosen for consistency with the existing `oauthLogin.ts` call rather than introducing a different encoding.

**Alternatives considered:**

- **`crypto.randomBytes(24).toString('base64')`** — also cryptographically sound and closer to some published VS Code sample nonce generators, but introduces `+`, `/`, `=` characters that need HTML-attribute-safety consideration (though CSP nonces are typically not base64 in practice, they can contain these) and doesn't match any existing call site in this codebase. Rejected in favor of matching `oauthLogin.ts`.
- **A shared `getNonce()` helper in a common module** — would remove the duplication between the two files, but that's a larger refactor than this ticket's one-line-per-file acceptance criteria calls for, and `entityDetailPanel.ts` is normally owned by a different engineer; keeping the diff minimal and localized to each file avoids introducing a new shared dependency between two otherwise-independent panels as a side effect of a security fix.

## Risks / Trade-offs

- None identified. The change is a drop-in replacement with an equal-length, differently-sourced random string; no caller inspects the nonce's charset or parses it.

## Migration Plan

None — purely internal to HTML generation at render time, no persisted state, no wire format change. Rollback is reverting the two one-line changes.

## Open Questions

None.
