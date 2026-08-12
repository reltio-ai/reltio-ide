## Why

`GET /reltio/tenants` is restricted to callers in the internal `*.reltio.com` user domain. Every user outside it receives `HTTP 403`, which blocks the setup wizard at the tenant selection step and blocks the **Add Tenant** command, so no tenant is added and no L3 configuration is ever downloaded (RP-195788). The supported public endpoint for listing the tenants a caller can see is `GET /reltio/enhancedTenants`.

## What Changes

- Replace `GET /reltio/tenants` with `GET /reltio/enhancedTenants?showAll=true` as the single source of the tenant list. The old endpoint is removed, with no fallback.
- **BREAKING** (internal API surface): `listTenants()` in `src/api/reltioClient.ts` changes shape. The endpoint returns richer tenant records rather than a bare array of tenant-ID strings, so the helper's return type and its response validation change. Every caller that treats the result as `string[]` is updated.
- Callers updated: the setup wizard tenant picker (`src/ux/setupWizard.ts`), the `reltio.addTenant` command, and the post-login `autoAddSsoTenant` membership check (both in `src/extension.ts`).
- Tenant IDs remain the value the extension persists and passes to every other Reltio call, so the on-disk `{tenantId}.reltio.tenant/` layout is unchanged.

## Capabilities

### New Capabilities

None. This changes how an existing capability talks to Reltio.

### Modified Capabilities

- `multi-tenant-tree-view`: the requirement that names `GET https://{host}/reltio/tenants` as the tenant-picker source changes to `GET https://{host}/reltio/enhancedTenants?showAll=true`.

## Impact

**Code**
- `src/api/reltioClient.ts`, `listTenants()`: URL, query string, and response parsing/validation.
- `src/ux/setupWizard.ts`: `stepFirstTenant()` builds QuickPick items from the returned records.
- `src/extension.ts`: `reltio.addTenant` command; `autoAddSsoTenant()` membership check against the returned records.

**External API**
- Removes all extension use of `/reltio/tenants`.
- Adds a dependency on `/reltio/enhancedTenants`, which must be available on every environment the extension supports. Environments that predate the endpoint would lose tenant listing, since this change keeps no fallback.

**Tests**
- `scripts/test-multi-tenant-tree-view.cjs` and `scripts/test-setup-ux-redesign.cjs` cover the affected paths and need updating.
- A new `scripts/test-replace-tenants-with-enhanced-tenants.cjs` covers URL construction and response parsing.

**Docs**
- `ARCHITECTURE.md`: the `src/api/` row and the Dependencies and Integrations section name the tenants endpoint.

**Not in scope**
- The `xxx-client: true` request header, the `auth.reltio.com` OAuth host (which may not serve non-`*.reltio.com` environments such as `na-dev-1.cloud.reltio.com`), and the unactionable wording of the 403 error message. Each is a separate concern tracked under RP-195788.
