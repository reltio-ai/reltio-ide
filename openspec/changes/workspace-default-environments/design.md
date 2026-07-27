## Context

Environments and tenants are **filesystem-discovered** (`EnvironmentManager.scanEnvironments`):

```text
.reltio/{host}.reltio.environment/{tenantId}.reltio.tenant/L3.reltio.json
# legacy also scanned: {host}.reltio.environment/… at workspace root
```

Auth today is per host via **Provide Token** (in-memory access token only) or **Browser Sign-In** (OAuth client + refresh in `SecretStorage`). Contributed settings are UX-only (`reltio.unresolvedUriSeverity`, autosave, `uxMode`, etc.) — there is no seed for host/tenant/auth.

**Reltio Forge** (separate repo) already has:

| Artifact | Role |
|----------|------|
| `skills/mcp-reltio/token.json` | Browser OAuth output: `access_token`, optional `refresh_token`, `expires_in` (gitignored) |
| `RELTIO_MCP_ENVIRONMENT` / `RELTIO_MCP_TENANT_ID` | RoR defaults (e.g. `prod-usg` / `16KZuUKjWAraGx5`) |
| Bootstrap step `16-reltio-ide` | Installs this VSIX into Cursor only |

Forge cannot populate `TokenStore` or `SecretStorage` from a shell script. The missing surface is an extension-owned reader of **safe workspace settings + a local token file**.

## Goals / Non-Goals

**Goals:**

- Declarative workspace seed: host + tenantId + optional `tokenFile` path.
- Load bearer from file into existing `TokenStore` (same semantics as Provide Token for MVP).
- One command to apply; optional apply-on-activate behind a setting (default **false** or conservative).
- Clear errors when token file missing, invalid JSON, or missing `access_token`.
- Docs that state: **tokens never belong in settings or git**.

**Non-Goals (MVP):**

- Embedding tokens, refresh tokens, or OAuth client secrets in `settings.json`.
- Auto-import of Forge `.env` / Keychain secrets into the extension.
- Importing `refresh_token` into `SecretStorage` / full OAuth session restore (follow-up; needs OAuth client credentials anyway).
- Auto-resolve customer tenants via Platform MCP.
- Auto **Apply Configuration to Tenant** (live PUT).
- Changing Browser Sign-In.

## Decisions

1. **Setting shape** — `reltio.defaultEnvironments: Array<{ host: string; tenantId: string; tokenFile?: string }>`.
   - `host` and `tenantId` become filesystem path segments. A single canonical validator (`isSafePathSegment`) **MUST** reject empty values, path separators, `..`, and traversal before directory creation. Host uses the same normalization as `reltio.addEnvironment`, then the segment check.
   - `tokenFile` is **workspace-relative only**. Absolute paths and paths that escape the workspace root are **rejected** (fail closed). No warning-only escape.

2. **Command** — `reltio.applyDefaultEnvironments` titled **Reltio: Apply default environments**. Idempotent: create missing folders; if `tokenFile` present, overwrite in-memory token for that host (same as re-running Provide Token).
   - **Same-host conflict:** `TokenStore` is keyed by host. If multiple entries for one host specify **different** `tokenFile` paths, apply **MUST** report a conflict error and **MUST NOT** load any token for that host. Identical `tokenFile` values across tenants on the same host are allowed.

3. **Activation behavior** — Prefer **opt-in** via `reltio.applyDefaultsOnActivate` (boolean, default `false`) so opening a random folder with example settings does not silently hit the network or assume a token file exists. Forge can set it `true` in a **user/local** settings overlay.
   - Apply-on-activate and the apply command **MUST** require **Workspace Trust** (`vscode.workspace.isTrusted`). Settings are listed under `capabilities.untrustedWorkspaces.restrictedConfigurations`.

4. **Fetch L3** — Do **not** fetch on apply by default. Optional `reltio.fetchL3AfterApplyDefaults` (boolean, default `false`) or a post-apply QuickPick “Fetch now?”. **Rationale:** fetch is network + disk write; keep apply-defaults focused on scaffold + auth.

5. **Token file format** — Require JSON object with string `access_token`. Ignore other fields in MVP (`refresh_token`, `expires_in`). If file unreadable → include the path in the **single summary** notification; continue other entries when possible.
   - **Shared file:** Multiple hosts MAY reference the **same** `tokenFile`. Index by canonical path — **one** FileSystemWatcher and **one** read per file change, then fan out the bearer to every host in that binding. On API 401 without an OAuth refresh session, re-read that shared file once (same fan-out) before failing.
   - **Startup load:** Watchers do not fire for an already-present file. Activation (and re-setup after settings change) **MUST** read each unique `tokenFile` once into `TokenStore` for all hosts in that binding, even when `applyDefaultsOnActivate` is false. Apply-on-activate remains responsible for scaffolding folders / optional Fetch L3.

6. **Security** — Document and enforce in review:
   - Settings MUST NOT accept an inline `token` / `accessToken` property (reject unknown or explicitly forbid in schema description).
   - Example snippets in docs use `tokenFile` only.
   - Do not log token contents.
   - Do not commit `applyDefaultsOnActivate` / `fetchL3AfterApplyDefaults` together with host/tokenFile into shared/untrusted workspace settings.

7. **Host from Forge env slug** — Out of scope for the extension to read `RELTIO_MCP_*`. Forge (or the user) maps `prod-usg` → `prod-usg.reltio.com` (Foxtrot `*.cloud.reltio.com` remains a user/Forge concern).

**Alternatives considered**

- **Option A (token-file command only, no settings)** — Good for one-shot, weaker for “open Forge repo and already know RoR target.” Settings + command covers both; command can still run without waiting for activate.
- **Option C (import OAuth client into SecretStorage)** — Better long-term session survival, but moves secrets and needs more UX; defer.
- **Inline token in settings** — Rejected: lands in git, sync, screenshots, and backup.

## Risks / Trade-offs

- **[Risk] Stale access token in file** — Same as Provide Token today; surface 401 with guidance to re-auth (Forge: `manager.py auth`). Mitigation: optional follow-up to honor `refresh_token` + user OAuth client.
- **[Risk] `tokenFile` path committed by mistake pointing outside workspace** — Fail closed: reject absolute and escaping paths.
- **[Risk] Apply-on-activate surprises** — Default off; Workspace Trust gate; document clearly.
- **[Risk] Multi-root workspaces** — Resolve `tokenFile` against the folder that owns the settings or the first workspace folder; document limitation in MVP.

## Migration Plan

No migration of existing workspaces. Pure additive settings/command. Rollback = remove setting + command; existing Provide Token / Browser Sign-In unchanged.

## Open Questions

1. Should apply-on-activate default to `true` when `defaultEnvironments` is non-empty and every `tokenFile` exists? (**Proposal: no** — keep explicit opt-in.)
2. After successful token load, should the tree’s “Sign in” hints clear immediately via existing UX bus / refresh? (**Yes** — fire the same refresh path Provide Token uses.)
