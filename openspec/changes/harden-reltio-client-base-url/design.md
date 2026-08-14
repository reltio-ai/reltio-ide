## Context

`toHttpsBase(baseUrl: string): string` in `src/api/reltioClient.ts`:

```ts
function toHttpsBase(baseUrl: string): string {
	const trimmed = baseUrl.trim().replace(/^\/+/, '');
	if (/^https?:\/\//i.test(trimmed)) {
		return trimmed.replace(/\/+$/, '');
	}
	return `https://${trimmed.replace(/\/+$/, '')}`;
}
```

Every exported call in the file (`validateEnvironment`, `listTenants`, `fetchL3Configuration`, `putL3Configuration`, `fetchConfigurationHistory`, `searchEntities`, `countEntities`, and others) resolves `root = toHttpsBase(baseUrl)` first and attaches the bearer token immediately after. `baseUrl` ultimately comes from an environment name, which `src/workspace/environmentManager.ts` discovers by scanning the workspace for any folder ending in `.reltio.environment` (`collectEnvironmentDirs`) — it does not check whether the extension created that folder itself. A workspace opened from an untrusted source (a shared repo, a zip from email, a cloned fork) can therefore contain `evil.com.reltio.environment/`, and once the user authenticates against *some* environment in the same workspace and later targets this one, the token is sent to `evil.com` exactly as it would be to a real tenant. Today `toHttpsBase` has no opinion on that; it only strips slashes and defaults to `https://`. Separately, if the string already starts with `http://`, that scheme survives unchanged, so a bad or attacker-controlled `http://` base URL would carry the token in plaintext.

`reltioClient.ts` has zero imports today (not even `vscode`) — every helper in it is tested by feeding a stubbed `fetch` (see `scripts/test-replace-tenants-with-enhanced-tenants.cjs`). The fix has to preserve that: it cannot read `vscode.workspace.getConfiguration()` from inside this file.

## Goals / Non-Goals

**Goals:**
- Reject, before any `Authorization` header is attached, any resolved host that is not `reltio.com` or a subdomain of it — unless the workspace has explicitly extended the allowlist.
- Force an explicit `http://` scheme to `https://` rather than rejecting it outright, since the value being protected (no plaintext token transmission) is fully achieved by upgrading, and rejecting would break any environment string a user typed with a leading `http://` by habit.
- Keep `reltioClient.ts` free of a `vscode` import.
- Resolve the two low-severity items (`RELTIO_CLIENT_HEADER` naming, 12,000-char truncation) without changing observed behavior, since neither is a vulnerability and no reporter has asked for a behavior change.

**Non-Goals:**
- No change to `src/workspace/environmentManager.ts`'s folder discovery. It is reasonable for the extension to treat any `*.reltio.environment` folder as a candidate environment; the fix is to stop trusting the *host derived from it* rather than to stop discovering the folder.
- No change to `auth.reltio.com` in `oauthLogin.ts` — it is a hardcoded literal already, not derived from the folder name.
- No interactive "trust this host once" prompt. `showAll`-style one-off overrides are harder to test and audit than a persisted setting; `reltio.trustedHostSuffixes` already covers the legitimate case (a sanctioned non-`reltio.com` environment) without a per-call dialog.
- No change to `capabilities.untrustedWorkspaces.supported`. See Decision D4.

## Decisions

**D1. Enforce the allowlist inside `toHttpsBase()` itself, not at each call site.**

`toHttpsBase()` is already the one function every caller in the file passes through. Adding the check anywhere else (e.g., a separate `assertTrustedHost()` that callers must remember to invoke) reintroduces exactly the fragility the ticket is about — a future call site could forget it. Putting the check inside `toHttpsBase()` means every current and future caller gets it for free, and it satisfies the ticket's own framing ("`toHttpsBase()` rejects... hosts not matching... allowlist").

**D2. Use `new URL()` to extract the hostname, not a regex.**

Hand-rolled regexes for host extraction are exactly the kind of thing that grows a bypass later (e.g., `evil.com#.reltio.com`, credentials-in-URL tricks, or a trailing dot). `new URL(candidate).hostname` is the platform's own parser and already normalizes case and strips brackets/ports correctly. If the string does not parse as a URL at all, that is itself treated as an untrusted/invalid base URL.

**D3. Allowlist matching is suffix-based on the whole `reltio.com` domain, extensible via a plain setter — not a `vscode` import in this file.**

```ts
let trustedHostSuffixes: string[] = ['reltio.com'];
export function setTrustedHostSuffixes(suffixes: readonly string[]): void { ... }
function isTrustedHost(hostname: string): boolean { ... }
```

`extension.ts` reads the new `reltio.trustedHostSuffixes` setting (default `["reltio.com"]`) at activation and on `onDidChangeConfiguration`, and calls `setTrustedHostSuffixes()`. This keeps `reltioClient.ts` importing nothing beyond the platform `fetch`/`URL` globals, so the existing offline test harness (stub `fetch`, `importDist`) still works unchanged; tests call `setTrustedHostSuffixes()` directly instead of faking `vscode`.

A suffix match (`hostname === suffix || hostname.endsWith('.' + suffix)`) against `reltio.com` alone already covers every real host referenced anywhere in this codebase or its docs: `test.reltio.com`, `na-dev-1.cloud.reltio.com` (a subdomain chain still ending in `.reltio.com`), and `auth.reltio.com`. It rejects `evil.com`, and it rejects lookalikes like `notreltio.com` or `reltio.com.evil.com` because the match requires a literal `.` immediately before the suffix.

*Alternative considered:* a hardcoded allowlist with no setting. Rejected — the ticket's acceptance criteria explicitly allow "requires explicit override," and a fixed list with no escape hatch would break any legitimate on-prem or differently-branded environment we don't know about today, with no way for an admin to fix it short of a new extension release.

**D4. Force-upgrade `http://` to `https://`; do not reject it.**

Rewriting the scheme achieves the actual security property (no plaintext token transmission) without breaking any user who typed `http://myenv.reltio.com` out of habit. Rejecting would be a harder failure for zero extra safety, since the upgraded request still goes through the same allowlist check.

**D5. Keep `capabilities.untrustedWorkspaces.supported: "limited"` as-is.**

The ticket's acceptance criteria offer either `false` or confirming `"limited"` is intentional. The RP-195041 attack (a maliciously-named `*.reltio.environment` folder exfiltrating a token) is closed by D1–D3 regardless of workspace trust state — `toHttpsBase()` now rejects `evil.com` whether or not the workspace is trusted. Setting `supported: false` would make the whole extension inert until the workspace is trusted, which is a much bigger behavior change than this ticket's scope and would affect users who open any repo containing a legitimate `*.reltio.environment` folder before granting trust. `"limited"` remains the right scope: it specifically gates the three settings that read local token files or call a configured host *without* an explicit per-session user action (`reltio.defaultEnvironments`, `reltio.applyDefaultsOnActivate`, `reltio.fetchL3AfterApplyDefaults`), which is a materially different risk than "any command a user explicitly runs."

**D6. `RELTIO_CLIENT_HEADER` — keep the wire value, fix the comment.**

`xxx-client` is a real Reltio platform header, not placeholder naming: Reltio's own RDM documentation describes `xxx-client: true` vs `false` as routing a request to the UI node vs. the data-load node in the balancer, and this was independently confirmed empirically against a live tenant (same bearer token, same endpoint: `xxx-client: true` returned a materially larger, different result set than omitting it or sending `false`). The `replace-tenants-with-enhanced-tenants` change already proved the same thing for the old `/reltio/tenants` endpoint (43 records with it vs. 40 without). Renaming the *wire* string would silently change routing behavior for every remaining call site that still sends it, which is out of scope here and already covered by that change's own decision (D3) to leave it alone everywhere except the tenant call. The fix is limited to correcting the comment so it no longer reads as an unexplained placeholder.

**D7. Keep the 12,000-character truncation, name the constant.**

12,000 characters is comfortably larger than any real XSD/validation error body observed, while still bounding a pathological or malicious server response from flooding a VS Code error dialog. No behavior change; `12000` becomes `MAX_ERROR_BODY_CHARS` with a one-line comment.

**D8. `reltio.trustedHostSuffixes` is `"scope": "application"` — User settings only.**

Caught on review, not in the original acceptance criteria: a plain workspace-scoped setting is readable from that workspace's own `.vscode/settings.json` by default, trusted or not, unless the extension either lists it in `capabilities.untrustedWorkspaces.restrictedConfigurations` (gated by trust) or declares a narrower `scope`. A setting that *extends the allowlist a bearer token can be sent to* is a materially different kind of thing than the three existing restricted settings (which gate an *action*, not a trust boundary) — being trust-gated still means a workspace whose folder the user has trusted (for running tasks/extensions) could add itself to the allowlist via its own settings file, which is a strictly worse guarantee than "only a person editing their own User settings can do this." `scope: "application"` makes the setting unreadable from any workspace/folder settings file, trusted or not; only User or Machine settings apply. This closes what would otherwise have been a straightforward bypass of the whole fix (ship `evil.com.reltio.environment/` alongside a `.vscode/settings.json` that whitelists `evil.com`).

**D9. `validateEnvironment()` keeps its "never throws" contract; the allowlist check still applies.**

Also caught on review: `toHttpsBase()` was called *outside* `validateEnvironment()`'s own try/catch, so an untrusted host would reject the returned promise instead of resolving to `false`. Both callers (`setupWizard.ts`'s `stepHost`, `extension.ts`'s `reltio.addEnvironment`) assume this function never throws — one sets `qp.busy = true` before the call and `qp.busy = false` immediately after with no surrounding try/catch, so an unhandled rejection would leave the setup wizard's QuickPick stuck in its spinner state indefinitely, with no error shown. The fix moves `toHttpsBase()` inside the same try block; an untrusted or malformed host now resolves to `false`, the same outcome the caller already handles for "host unreachable." This does mean the user sees a generic "could not reach" message rather than a specific "untrusted host" one for this one entry point — an acceptable trade-off since `validateEnvironment()` is only used to probe a host before any credential exists for it, so nothing is actually being protected by a more specific message there.

## Risks / Trade-offs

- **A legitimate non-`reltio.com` environment breaks after this ships** → Mitigated by `reltio.trustedHostSuffixes`; documented in the setting's description and in the release notes. Since the setting is now `application`-scoped (D8), extending it requires editing User settings directly (or a Settings Sync / managed-settings push), not a workspace file — worth calling out in rollout comms so admins know where to make the change.
- **`new URL()` throws on a malformed `baseUrl`** → Caught and re-thrown as the same `UntrustedHostError`, so callers that already catch `Error` and show its message (every call site in `extension.ts`) need no new branching. `validateEnvironment()` is the one exception (D9): it catches this itself and returns `false`.
- **Existing users with a working non-`reltio.com` environment upgrade silently and lose access** → Same mitigation; this is the intended, minimal-surprise failure mode (a clear error naming the setting to fix it), not a silent drop.
- **A trailing-dot FQDN (`test.reltio.com.`) would fail the suffix check** → `hostname.endsWith('.reltio.com')` is false for a hostname ending in `.reltio.com.`. Not fixed — no evidence anyone types a trailing dot into the setup wizard, and `new URL()` does not add one on its own. Noted here in case a future report traces back to this.

## Migration Plan

No persisted state changes. Existing `{tenantId}.reltio.tenant/` and `{env}.reltio.environment/` directories are untouched. Any environment whose host is not `reltio.com`/`*.reltio.com` starts failing on the next API call with an error that names `reltio.trustedHostSuffixes`; rollback is reverting the commit.

## Open Questions

- Are there sanctioned Reltio environments in production today that do **not** resolve under `*.reltio.com`? Not found in this codebase, its docs, or prior OpenSpec changes. If one exists, its owner adds it via the new setting; no code change needed.

## Test plan

**Automated (Tier A / B)**, in `scripts/test-harden-reltio-client-base-url.cjs`

| # | Tier | Assertion |
|---|---|---|
| 1 | A | A `reltio.com` host and a multi-label subdomain of it (e.g. `na-dev-1.cloud.reltio.com`) are accepted |
| 2 | A | A non-`reltio.com` host (`evil.com`) is rejected before `fetch` is ever called, for every exported call helper |
| 3 | A | Lookalike hosts (`notreltio.com`, `reltio.com.evil.com`) are rejected |
| 4 | A | An explicit `http://reltio-host` is upgraded to `https://` and the request is actually sent over the upgraded URL |
| 5 | A | `setTrustedHostSuffixes(['example.internal'])` allows that suffix and its subdomains, and a subsequent call with the default restores rejection |
| 6 | A | A malformed `baseUrl` (not URL-parseable) is rejected with a clear error, not an unhandled exception |
| 7 | B | `formatPutConfigurationFailureMessage` still truncates at 12,000 characters (behavior-preserving regression check) |

**Manual QA (Tier C)**

| # | Check |
|---|---|
| 1 | Create a folder named `evil.com.reltio.environment` in an open workspace; confirm the extension does not treat it as usable and any action against it surfaces the new error instead of a network call |
| 2 | Confirm every existing real environment (e.g. a `*.reltio.com` tenant) still authenticates and lists tenants/fetches L3 with no behavior change |
| 3 | Set `reltio.trustedHostSuffixes` to include a test-only non-`reltio.com` host and confirm it becomes reachable |
