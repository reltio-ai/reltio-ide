## 1. Settings contribution

- [x] 1.1 In `package.json` → `contributes.configuration.properties`, add `reltio.defaultEnvironments` as an array of objects with required `host` and `tenantId`, optional `tokenFile` (string). Description MUST state that tokens/secrets must not be placed in settings — only a path to a local token file.
- [x] 1.2 Add `reltio.applyDefaultsOnActivate` (boolean, default `false`).
- [x] 1.3 Add `reltio.fetchL3AfterApplyDefaults` (boolean, default `false`) — if true, after successful apply, fetch L3 for each seeded tenant that has a token (reuse existing fetch path).

## 2. Apply implementation

- [x] 2.1 Add a small module (e.g. `src/workspace/applyDefaultEnvironments.ts`) that: reads settings; normalizes host; `createEnvironment` / `createTenant` if missing; resolves `tokenFile` under workspace; parses JSON; requires `access_token`; `tokenStore.setToken(host, access_token)`.
- [x] 2.2 Reject or ignore any future/illicit inline token fields if present in settings objects (do not load secrets from settings values).
- [x] 2.3 On partial failure (one bad token file), continue other entries and report a **single summary notification that lists every failed path**.
- [x] 2.4 After mutations, refresh the multi-tenant tree / UX state the same way **Provide Token** and **Add Tenant** do today.

## 3. Command + activation

- [x] 3.1 Register `reltio.applyDefaultEnvironments` (**Reltio: Apply default environments**) in `package.json` and `src/extension.ts`.
- [x] 3.2 If `reltio.applyDefaultsOnActivate` is true and a workspace folder exists, invoke apply once at end of `activate()` (fire-and-forget with error surfacing).

## 4. Docs

- [x] 4.1 `QUICKSTART.md` — section “Seed from workspace settings (token file)” with Forge-oriented example using `tokenFile` only.
- [x] 4.2 `ARCHITECTURE.md` — note the setting, security rule (no secrets in settings), and command.
- [ ] 4.3 Optionally add `.vscode/settings.json.example` snippet in docs (not a committed secret-bearing file).

## 5. Verification

- [ ] 5.1 Manual: settings with host + tenantId only → folders appear; tree shows env/tenant; no token until Provide Token or tokenFile.
- [ ] 5.2 Manual: valid `tokenFile` with `access_token` → env authorized; Fetch L3 works.
- [ ] 5.3 Manual: missing/invalid token file → error message; no crash; other entries still applied.
- [ ] 5.4 Manual: confirm settings schema / docs never show an inline token property.
- [ ] 5.5 `npm run compile` (and project build) passes.
