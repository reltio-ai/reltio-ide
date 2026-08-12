## Context

`listTenants()` in `src/api/reltioClient.ts` calls `GET https://{host}/reltio/tenants` and returns `string[]`. Three call sites depend on that shape:

| Call site | Use |
|---|---|
| `src/ux/setupWizard.ts` `stepFirstTenant()` | Builds the QuickPick from the strings |
| `src/extension.ts` `reltio.addTenant` | Passes `tenants` straight into `showQuickPick` |
| `src/extension.ts` `autoAddSsoTenant()` | `tenants.includes(ssoTenantId)` membership check |

`/reltio/tenants` is internal-only, so external users receive `HTTP 403` and the setup wizard dead-ends at tenant selection (RP-195788). The supported public endpoint is `GET /reltio/enhancedTenants`.

### Verified endpoint behavior

Probed against `na-dev-1.cloud.reltio.com` with a user Bearer token:

| Probe | Result |
|---|---|
| `GET /reltio/enhancedTenants?showAll=true` | `200`, flat JSON array, 43 records |
| Record shape | `{ "tenantName": string, "tenantId": string, "customerName": string }` |
| `POST` with empty body | `500`, `errorCode 2003`, "Request method 'POST' is not supported" |
| `showAll=false`, or the parameter omitted | `200`, 40 records, a strict subset |
| `xxx-client: true` header present vs absent | No difference, 43 records either way |
| tenantIds vs `GET /reltio/tenants` with `xxx-client: true` | Identical sets |

Two facts constrain the design. The endpoint is **GET-only**. And `showAll=true` reproduces exactly the list the extension shows today, so the tenant picker contents do not change for any existing user.

The probe also received `200` from the old `/reltio/tenants`, which at first looked like a counter-example. It is not. The token used belongs to a user in the internal `*.reltio.com` domain, and access to `/reltio/tenants` is gated on the **caller's user domain**, not on the environment. An internal user therefore cannot reproduce the 403 at all, whichever environment they point at. This is why the failure reaches only some users on an identical extension build, and it is the mechanism behind RP-195788.

## Goals / Non-Goals

**Goals:**

- Source the tenant list exclusively from `GET /reltio/enhancedTenants?showAll=true`.
- Keep the tenant list identical to today's for users who can already list tenants.
- Keep tenant IDs as the only value persisted or passed to other Reltio calls.
- Fail loudly and consistently when the response is not the expected shape.

**Non-Goals:**

- No fallback to `/reltio/tenants`. Decided: replace outright.
- No change to the `xxx-client: true` header on other endpoints. Only the tenant call drops it.
- No richer QuickPick. `tenantName` and `customerName` are discarded; the picker shows the tenant ID alone.
- No change to `auth.reltio.com` in `src/api/oauthLogin.ts`, even though it may not serve `*.cloud.reltio.com` hosts.
- No change to the 403 error message wording.

## Decisions

**D1. `listTenants()` keeps returning `string[]`.**

The function maps each record to its `tenantId` and discards `tenantName` and `customerName`. Rationale: all three call sites want tenant IDs and nothing else, and the picker was decided to show the ID alone. Keeping the signature means zero changes at the call sites, including the `tenants.includes(ssoTenantId)` check, which keeps this change small and keeps the blast radius at one file.

*Alternative considered:* return `TenantRecord[]` and map at each call site. Rejected. It spreads the shape change across three files for data that is then thrown away. If a later change wants `customerName` in the picker, introducing `listTenantsDetailed()` at that point is cheap.

**D2. Send `showAll=true`.**

Verified as the setting that reproduces today's list exactly (43 records, matching the old endpoint with its client header). Omitting it, or sending `false`, would silently drop 3 tenants for this test user and would be a regression.

*Trade-off:* `showAll=true` may include tenants the user cannot actually read, in which case the follow-on L3 fetch fails. That risk already exists today and is unchanged, so it is not this change's problem to solve.

**D3. GET, and drop the `xxx-client` header for this call.**

POST returns `500 errorCode 2003`, so GET is the only option. The header is verified to make no difference on this endpoint, and the reporter confirms it is not required. The header stays on every other call in `reltioClient.ts`, whose behavior is untested here. This means `reltioHeaders()` gains a way to omit it rather than being changed globally.

*Note:* the header **does** matter on the old endpoint (43 records with it, 40 without), which is why its comment claims it is required for the tenant list. That comment becomes wrong once the endpoint changes and must be updated.

**D4. Validate the array shape, and reject records without a usable `tenantId`.**

Today the helper rejects a response that is not a `string[]`. The new validation requires a JSON array whose every element is an object with a non-empty string `tenantId`. A malformed element throws `ReltioApiError` rather than yielding `undefined` entries in the picker.

*Alternative considered:* skip malformed records and return the rest. Rejected. A silently short tenant list is harder to diagnose than an explicit error.

**D5. Keep the existing status-code handling verbatim.**

`401` continues to throw `ReltioApiError('Unauthorized (401)', 401)` so `handle401()` and the refresh path keep working. Any other non-2xx throws with the endpoint named in the message. The 10-second `fetchWithTimeout` is unchanged.

## Risks / Trade-offs

- **`enhancedTenants` may not exist on older environments** → With no fallback (D1 scope, per decision), those environments lose tenant listing entirely. Accepted on the reporter's instruction. If it materializes, the mitigation is the previously-rejected try-new-then-old fallback.
- **No maintainer can reproduce the original 403** → Access to `/reltio/tenants` is gated on the caller's user domain, and internal `*.reltio.com` users always receive 200. Mitigation: sign-off on the fix requires an external user, so Tier C item 1 cannot be closed from an internal account.
- **`showAll=true` can list unreadable tenants** → Pre-existing behavior, unchanged. The user sees a failed L3 fetch after picking, which already has a warning path in `reltio.addTenant`.
- **Dropping `xxx-client` narrows what is exercised** → The header remains on all other calls, so this change cannot regress them. Only the tenant call's behavior changes, and it is verified.
- **Unit tests cannot hit the network** → The test harness is offline by design (`scripts/lib/`). Tests cover URL construction and response parsing against captured fixtures, not live behavior. Live verification stays manual, Tier C.

## Migration Plan

No data migration, no persisted state change. Tenant IDs remain the on-disk key, so existing `{tenantId}.reltio.tenant/` directories keep working untouched. Rollback is reverting the commit; the old endpoint is still live.

## Open Questions

- Does `enhancedTenants` exist on every environment version the extension supports, including on-prem and older SaaS releases? Unresolved. Determines whether the no-fallback decision holds.
- Does `enhancedTenants` apply the same user-domain gate as `/reltio/tenants` for external users? The probe could only exercise it from an internal account, so a 200 for an external caller is expected but not yet observed. Tier C item 1 settles it.

## Test plan

**Automated (Tier A / B)**, in `scripts/test-replace-tenants-with-enhanced-tenants.cjs`

| # | Tier | Assertion |
|---|---|---|
| 1 | A | `listTenants` requests `/reltio/enhancedTenants?showAll=true` on the resolved HTTPS base, via GET |
| 2 | A | No `xxx-client` header on the tenant call; still present on `fetchL3Configuration` |
| 3 | A | A valid array of records maps to `tenantId` strings, order preserved |
| 4 | A | A record missing `tenantId`, or with a non-string or empty one, throws `ReltioApiError` |
| 5 | A | A non-array body throws `ReltioApiError` |
| 6 | A | `401` throws `ReltioApiError` with `statusCode` 401; other non-2xx throw with the status in the message |
| 7 | B | No source file outside test fixtures still references `/reltio/tenants` |

**Manual QA (Tier C)**

| # | Check |
|---|---|
| 1 | Setup wizard on an external (non-internal) environment reaches the tenant picker and lists tenants |
| 2 | The picker's tenants match what the Reltio console shows for the same user |
| 3 | `Add Tenant` on an already-signed-in environment lists tenants |
| 4 | Post-browser-login `autoAddSsoTenant` still auto-adds the configured SSO routing tenant |
| 5 | An expired token still produces the 401 re-login prompt, not a raw error |
