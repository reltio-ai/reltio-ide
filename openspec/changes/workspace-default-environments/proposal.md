## Why

Internal tooling such as **Reltio Forge** already authenticates engineers to Reltio-on-Reltio (Platform MCP) and writes a local bearer file (`skills/mcp-reltio/token.json`) plus environment/tenant defaults (`RELTIO_MCP_ENVIRONMENT`, `RELTIO_MCP_TENANT_ID`). After Forge bootstrap installs this extension, users still must hand-run **Add Environment → Provide Token (paste) → Add Tenant → Fetch**. That duplicate setup is the main friction for the common “edit RoR L3 in Cursor” path.

Putting **tokens or client secrets in git-tracked settings is unacceptable**. What *is* safe and useful is workspace configuration that stores only **host**, **tenant ID**, and a **relative path to a local token file** (gitignored), then has the extension scaffold folders and load the bearer into the existing in-memory `TokenStore`.

## What Changes

- Add a workspace setting `reltio.defaultEnvironments` — an array of `{ host, tenantId, tokenFile? }` objects. **No token strings, no client secrets, no refresh tokens in settings.**
- Via command **Reltio: Apply default environments** (`reltio.applyDefaultEnvironments`), and optionally on activation when `reltio.applyDefaultsOnActivate` is explicitly `true` (default **false**):
  - Ensure `{host}.reltio.environment/{tenantId}.reltio.tenant/` directories exist (same layout as today).
  - If `tokenFile` is set, resolve it relative to the workspace folder, read JSON, require `access_token`, and call the same path as **Provide Token** (`TokenStore.setToken`).
  - Optionally prompt (or setting-gated) to **Fetch Configuration** for each seeded tenant — default **off** or confirm-first so activation never surprises with network writes.
- Activation does **not** apply environments unless `reltio.applyDefaultsOnActivate` is enabled; the command remains available independently.
- Document the Forge / token-file pattern in `QUICKSTART.md` and `ARCHITECTURE.md`.
- Explicit non-goal: never write tokens into `settings.json`, never commit token files, never auto-**Apply Configuration to Tenant**.

## Capabilities

### New Capabilities

- `workspace-default-environments`: Seed environments/tenants from workspace settings and optionally authenticate by reading a workspace-relative token **file path** (not inline secrets).

### Modified Capabilities

- _(none required in existing capability specs; reuses Provide Token / environment folder semantics.)_

## Impact

- **`package.json`** — new `reltio.defaultEnvironments` (and optional `reltio.applyDefaultsOnActivate` / `reltio.fetchL3AfterApplyDefaults`) configuration properties; new command `reltio.applyDefaultEnvironments`.
- **`src/`** — small module to parse settings, resolve/read token files, scaffold via `EnvironmentManager`, load `TokenStore`; wire from `activate()` and command registration in `extension.ts`.
- **`QUICKSTART.md` / `ARCHITECTURE.md`** — document settings shape, security rules, Forge example.
- **Dependencies** — none.
- **Consumers** — Reltio Forge can add a gitignored or user-local settings overlay pointing at `skills/mcp-reltio/token.json`; Forge bootstrap remains install-only until this ships.
