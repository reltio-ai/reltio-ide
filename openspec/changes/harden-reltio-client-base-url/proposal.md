## Why

`toHttpsBase()` in `src/api/reltioClient.ts` turns an environment's stored host string into the base URL every Reltio API call is built from. It has no host allowlist, so a workspace folder named e.g. `evil.com.reltio.environment/` is trusted exactly like a real `*.reltio.com` environment: once the user authenticates, their bearer token is attached and sent to that host. Separately, the same function leaves an explicit `http://` scheme untouched instead of upgrading it to `https://`, so a misconfigured or attacker-supplied `http://` base URL would carry the bearer token and config payloads in plaintext. Both were flagged in an internal security review.

## What Changes

- `toHttpsBase()` becomes the single enforcement point for both issues, since every one of the ~10 call sites in `reltioClient.ts` already funnels through it before attaching a token:
  - An explicit `http://` scheme is rewritten to `https://` rather than preserved.
  - The resolved hostname is checked against a host allowlist. A host that does not match throws before the caller can attach an `Authorization` header.
- **New setting** `reltio.trustedHostSuffixes` (default `["reltio.com"]`) lets an admin explicitly extend the allowlist for a sanctioned non-`*.reltio.com` environment. `reltioClient.ts` stays framework-free (no `vscode` import): it exposes a plain `setTrustedHostSuffixes()` setter, and `extension.ts` reads the VS Code setting and pushes it in at activation and on change.
- Two low-severity cleanup items called out in the same ticket, resolved in place:
  - `RELTIO_CLIENT_HEADER`'s comment is corrected — `xxx-client` is a genuine Reltio balancer-routing header (UI node vs. data-load node), not placeholder naming, and is kept as-is with that explanation.
  - The 12,000-character cap on `formatPutConfigurationFailureMessage()`'s raw body is kept, pulled into a named constant with a comment explaining the reasoning.
- `package.json`'s `capabilities.untrustedWorkspaces.supported: "limited"` is kept as-is; the ticket's other acceptance option ("confirm the existing setting is intentionally sufficient") is taken, with reasoning recorded in `design.md`.

## Capabilities

### New Capabilities

- `reltio-host-allowlist`: `toHttpsBase()` enforces a host allowlist and forces HTTPS before any Reltio API call attaches credentials.

### Modified Capabilities

None. No existing tracked capability names this behavior; the network call helper had no host-trust requirement documented before this change.

## Impact

**Code**
- `src/api/reltioClient.ts`: `toHttpsBase()`, new `isTrustedHost()` / `setTrustedHostSuffixes()`, new `UntrustedHostError`, `RELTIO_CLIENT_HEADER` comment, `formatPutConfigurationFailureMessage()` truncation constant.
- `src/extension.ts`: read `reltio.trustedHostSuffixes` at activation and on `onDidChangeConfiguration`, call `setTrustedHostSuffixes()`.
- `package.json`: new `reltio.trustedHostSuffixes` setting under `contributes.configuration`.

**External API**
- None. No new outbound calls; existing calls to hosts outside the allowlist now fail client-side before the request is sent, instead of silently succeeding.

**Tests**
- New `scripts/test-harden-reltio-client-base-url.cjs` covering allowlist enforcement, HTTPS force-upgrade, and the setter's effect on every existing call helper.

**Docs**
- `ARCHITECTURE.md`: note the allowlist in the `src/api/` row and the Network section.

**Not in scope**
- `auth.reltio.com` in `src/api/oauthLogin.ts` — that host is a hardcoded literal, not derived from the untrusted folder name, so it is not exposed to this attack surface.
- Workspace-trust behavior for settings other than the three already restricted (`reltio.defaultEnvironments`, `reltio.applyDefaultsOnActivate`, `reltio.fetchL3AfterApplyDefaults`).
