# Tasks: replace-tenants-with-enhanced-tenants

## 1. Client change (`src/api/reltioClient.ts`)

- [x] 1.1 Give `reltioHeaders()` a way to build headers without `xxx-client`, leaving every existing caller's behavior unchanged (see design D3).
- [x] 1.2 Correct the `RELTIO_CLIENT_HEADER` comment. It currently claims the header is required for the tenant list, which the probe disproves for the new endpoint.
- [x] 1.3 Add an exported `TenantRecord` interface: `tenantId: string`, `tenantName: string`, `customerName: string`.
- [x] 1.4 Repoint `listTenants()` to `GET {base}/reltio/enhancedTenants?showAll=true`, building the query with `URLSearchParams`, method GET, no request body, no `xxx-client` header.
- [x] 1.5 Keep the `401` branch throwing `ReltioApiError('Unauthorized (401)', 401)` verbatim so `handle401()` and the token-refresh path still fire.
- [x] 1.6 Update the non-2xx branch message to name the new endpoint.
- [x] 1.7 Replace the response validation: require a JSON array; require every element to be a non-null object with a non-empty string `tenantId`; throw `ReltioApiError` otherwise (design D4).
- [x] 1.8 Map records to `tenantId`, preserving response order, and keep the `Promise<string[]>` return type (design D1).
- [x] 1.9 Leave the 10-second `fetchWithTimeout` and every other helper in the file untouched.

## 2. Call sites

- [x] 2.1 Confirm `src/ux/setupWizard.ts` `stepFirstTenant()` needs no change, since `listTenants` still returns `string[]`. Do not alter the existing 1.5-second silent retry or the Retry / Skip handling.
- [x] 2.2 Confirm the `reltio.addTenant` command in `src/extension.ts` needs no change.
- [x] 2.3 Confirm `autoAddSsoTenant()` in `src/extension.ts` needs no change, in particular `tenants.includes(ssoTenantId)`.
- [x] 2.4 Grep the whole of `src/` for `reltio/tenants` and confirm zero remaining references.

## 3. Tests

- [x] 3.1 Create `scripts/test-replace-tenants-with-enhanced-tenants.cjs` covering Tier A/B rows 1–7 of the design Test plan. Stub `fetch` to assert the outgoing URL, method, and headers, and to feed canned response bodies. No network access.
- [x] 3.2 Capture a redacted `enhancedTenants` response fixture for the parsing assertions, using synthetic tenant IDs. No real customer names, no tokens.
- [x] 3.3 Register the new script in the `SCRIPTS` array in `scripts/run-unit-tests.cjs`, alphabetically.
- [x] 3.4 Update `scripts/test-multi-tenant-tree-view.cjs` and `scripts/test-setup-ux-redesign.cjs` for anything that asserts the old endpoint or the `string[]` response body.
- [x] 3.5 Run `npm test` and confirm every script passes.

## 4. Docs

- [x] 4.1 Update the `src/api/` row in the `ARCHITECTURE.md` Package Structure table to name the new endpoint.
- [x] 4.2 Update the `ARCHITECTURE.md` Dependencies and Integrations section where `/reltio/tenants` is listed.
- [x] 4.3 Check `README.md`, `QUICKSTART.md`, and `docs/` for references to the tenants endpoint and update any found.

## 5. Verification

- [x] 5.1 `npm run compile` clean.
- [x] 5.2 `npm test` green.
- [x] 5.3 `npm run build` clean (extension host and webview bundles).
- [ ] 5.4 Work the Tier C manual QA table in `design.md`. Item 1 must be run by a user outside the internal `*.reltio.com` domain. Internal accounts always receive 200 from the old endpoint, so they cannot confirm the fix.
- [x] 5.5 `npm run openspec -- validate --changes` clean.

## 6. Pull request

- [x] 6.1 Commit on `RP-195788-replace-tenants-with-enhanced-tenants`. Verify no access token appears in any diff, fixture, or commit message.
- [x] 6.2 Open a PR naming RP-195788 and this OpenSpec change, and record that sign-off needs an external (non-`*.reltio.com`) user because internal accounts cannot reproduce the 403.
