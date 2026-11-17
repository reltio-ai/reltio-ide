## Context

The extension fetches L3 through a single call: `reltio.fetchL3` → `writeL3FromApi` (`src/extension.ts`) → `fetchL3Configuration` (`src/api/reltioClient.ts`) → `GET https://{env}/reltio/api/{tenantId}/configuration`, then `prettyPrintJsonIfPossible` and two disk writes (`L3.reltio.json` plus the `L3.remote-baseline.reltio.json` drift oracle).

RDM cannot follow that single-call shape, because neither the RDM service host nor the RDM tenant id can be assumed from the MDM environment and tenant id:

- The RDM service **may be on a different host** from the MDM environment — in the observed tenant, `https://rdm.reltio.com` versus `https://test-usg.reltio.com`. The host must be read from the response, never constructed from the environment name.
- The RDM tenant id **must not be assumed equal** to the MDM tenant id — in the observed tenant they differ (`JpfbluZcdHoQows` versus `71YnsNpkMRLfyRh`).
- `ReltioBusinessModel.rdmTenantId` exists in `src/model/types.ts` but is not populated in the L3 payloads observed so far, so L3 cannot be used for discovery.

Everything about RDM is therefore **per tenant**: the service URI, the number of RDM tenants, which lookup types and sources exist, and how many of them there are. Nothing in this design may hard-code or assume any of those values.

Both facts live in the tenant physical configuration (`GET /reltio/tenants/{tenantId}`) under `rdmConfig`:

```json
"rdmConfig": {
    "serviceUri": "https://rdm.reltio.com",
    "oauthInstance": "https://auth.reltio.com/oauth/token",
    "rdmTenants": [ { "rdmTenantId": "JpfbluZcdHoQows" } ]
}
```

So RDM fetch is a **two-step chain**: discover, then fetch. The environment bearer token is accepted by the RDM service, which keeps authentication entirely out of scope.

Constraint from `docs/CONTRIBUTION.md`: no secrets in specs or commits. This matters here because the physical configuration response carries a messaging `provider` credential string, Spanner service-account identifiers, and internal Elasticsearch hostnames.

## Goals / Non-Goals

**Goals:**

- The existing Get Configuration command also brings down the tenant's RDM configuration, discovering the service URI and RDM tenant ids automatically, without the user learning that a second service exists.
- Local edits to an RDM file are never overwritten without warning, matching the protection L3 already has.
- Reuse the existing client conventions exactly: `toHttpsBase`, `fetchWithTimeout`, `reltioHeaders`, `ReltioApiError`, and 401 → `handle401`.
- RDM files get schema validation appropriate to their own shape, and never inherit the L3 schema.
- The discovery payload never reaches disk.
- The discovery-to-`rdmConfig` step is a pure function, unit-testable without a `vscode` stub.

**Non-Goals:**

- **Lookup-code navigation.** Wiring `lookupCode` into `UriIndex`, diagnostics, go-to-definition, and completion is the payoff this change enables, but it is a separate capability touching `src/navigation/` — proposed separately as `rdm-lookup-code-navigation`.
- **RDM write-back.** Nothing is PUT to the RDM service. Baselines are written (D8) but serve only the pre-fetch warning; Apply stays L3-only.
- **Per-file review of RDM drift.** The warning names drifted RDM files; diffing them individually is out of scope (D9).
- **Lookup values.** The RDM configuration lists lookup *type definitions* (`lookupTypes[]`); the code-to-value mappings are a different RDM endpoint and are not fetched.
- **Other `rdmConfig` flags.** `includeDisabledLookups`, `multiParentTranscoding`, `transcodeByEndDatedCrosswalks` and similar are read past, not modelled.
- **Persisting or surfacing the physical configuration** for any other purpose (analytics config, storage config, matching config), despite the payload containing all of it.

## Decisions

### D1: The chain hangs off the Get Configuration command handler, not `writeL3FromApi`

RDM is fetched as a continuation of the existing **Get Configuration** command (`reltio.fetchL3`), so one user action produces the tenant's full configuration. There is no separate RDM command and no new menu entry.

The attachment point matters. `writeL3FromApi` has three callers besides the command: the post-SSO auto-add path, the apply-defaults flow, and the fetch-review path. Putting the RDM chain inside `writeL3FromApi` would therefore pull RDM into login, which must stay unchanged. The chain is instead invoked from the `reltio.fetchL3` **command handler**, after `writeL3FromApi` returns `'written'`.

**Alternative considered — a separate `reltio.fetchRdm` command:** rejected as a product decision; it makes the user perform and remember a second action to get a complete picture of a tenant.

**Alternative considered — inside `writeL3FromApi`:** rejected because it silently changes the post-SSO and apply-defaults flows, adding two HTTP calls to login.

### D2: RDM failure never fails the L3 fetch

The two fetches are sequential but independently reported. If the L3 write fails, the RDM chain is not attempted. If the L3 write succeeds and any part of the RDM chain fails, L3 stays written and the RDM failure is surfaced on its own, without rolling anything back or presenting the whole command as failed.

This follows from D1: because RDM now rides on an existing command, a transient RDM-service problem must not take away a working L3 fetch that the user relies on.

### D3: Tenants without RDM produce no notification

Since the chain now runs on **every** Get Configuration, the no-RDM outcome is the normal case for a large share of tenants. An informational popup there would be recurring noise on an action users perform often. A tenant with no `rdmConfig`, no `serviceUri`, or an empty `rdmTenants` array is therefore handled silently — no modal, no notification, no file.

**Alternative considered — an informational message:** correct for a user-invoked RDM command, wrong for an automatic step; it would train users to dismiss messages from this command.

### D4: Two-step chain, with the physical configuration never persisted

`writeRdmFromApi` fetches the physical configuration, extracts `rdmConfig`, discards the rest, then fetches and writes the RDM configuration. Only the RDM payload reaches disk.

**Alternative considered — write `PhysicalConfig.reltio.json` beside `L3.reltio.json`:** rejected. The response contains a messaging `provider` credential string, Spanner service-account identifiers, and internal cluster hostnames. A file in the user's workspace gets committed, attached to bug reports, and shared in screenshots. `docs/CONTRIBUTION.md` forbids secrets in commits, and no consumer in this change needs the payload beyond `rdmConfig`.

### D5: Same bearer token across both hosts; no new authentication path

`tokenStore.getToken(environmentName)` is read once and passed to both calls, even though the second targets a different host. Confirmed: the environment token is accepted by the RDM service.

**Alternative considered — a separate token acquisition against `rdmConfig.oauthInstance`:** rejected as unnecessary work. `oauthInstance` is therefore deliberately **not** modelled or used, so that a future need for it is a visible addition rather than dead code silently going stale.

### D6: `RDM.{rdmTenantId}.reltio.json`, with the L3 schema binding narrowed

RDM files land in the tenant folder beside `L3.reltio.json`, keeping the `.reltio.json` convention that drives `workspaceContains` activation and the tenant-folder scan.

This creates a collision that must be handled in the same change: `contributes.jsonValidation` currently maps `*.reltio.json` to `schemas/reltio-metadata.schema.json`, whose top-level object rejects unknown properties. The two shapes are **partially overlapping but incompatible** — `label`, `sources` and `updatedBy` are top-level properties of both, but `tenantId`, `trackTranscodeErrors`, `lookupTypes`, `updateDate` and `version` are unknown to the L3 schema, and RDM's `sources` items carry a different shape (`canonicalValueProvider`) from L3's. So an unscoped binding would mark every RDM file as invalid on open.

The binding becomes:

```json
{ "fileMatch": ["*.reltio.json", "!RDM.*.reltio.json"], "url": "./schemas/reltio-metadata.schema.json" },
{ "fileMatch": "RDM.*.reltio.json", "url": "./schemas/reltio-rdm.schema.json" }
```

**Alternative considered — a suffix outside the convention (`RDM.{id}.rdm.json`):** avoids the collision with no exclusion pattern, but breaks the visual symmetry of the tenant folder and requires a new `workspaceContains` activation glob. Held as the fallback if this decision's exclusion pattern proves unreliable (see Risks).

**Alternative considered — let both schemas apply:** rejected. VS Code unions matching schemas, so each file would report the violations of whichever schema it does not match.

Baselines follow the same naming, as `RDM.{rdmTenantId}.remote-baseline.reltio.json`. That name matches the `RDM.*.reltio.json` glob, so a baseline is validated by the RDM schema and excluded from the L3 one — the same relationship `L3.remote-baseline.reltio.json` already has with the L3 schema today, and correct in both cases since a baseline is a verbatim copy of the configuration it shadows.

### D7: One file per RDM tenant; fetch all of them

`rdmTenants` is an array. Every entry is fetched and written to its own `RDM.{rdmTenantId}.reltio.json`.

**Alternative considered — take the first entry:** rejected as silent data loss on multi-RDM-tenant setups. **Alternative considered — QuickPick when more than one:** rejected; it adds a prompt for a choice the user has no reason to make when they want the tenant's RDM configuration, and fetching all is cheap and idempotent. The number of RDM tenants is a per-tenant property, so the implementation must handle zero, one, and many without treating any count as the expected case.

A missing `rdmConfig`, a missing `serviceUri`, or an empty `rdmTenants` array is a normal outcome for tenants without RDM, handled silently per D3.

### D8: Each RDM configuration gets a baseline, used to warn before overwriting local edits

Every successful RDM write is accompanied by a `RDM.{rdmTenantId}.remote-baseline.reltio.json` twin holding identical content, exactly as `writeL3FromApi` does for L3.

In this change the baseline serves one purpose: the pre-fetch guard. Get Configuration already refuses to silently clobber a locally-edited `L3.reltio.json` by comparing it against its baseline (`hasUnpublishedLocalChanges` in `src/util/fetchConfigurationGuard.ts`) and warning first. Because RDM now rides on that same command, RDM files need the same protection or the command would protect one artifact and quietly destroy edits to another.

**Alternative considered — no baseline, since nothing PUTs to RDM:** this was the original decision, on the reasoning that baselines exist to give Apply a drift oracle. Rejected: the baseline's *other* use — detecting unapplied local edits before a re-fetch overwrites them — is valuable independently of whether Apply exists, and the asymmetry of warning for L3 but not RDM within a single command is exactly the kind of surprise a user would only discover by losing work.

The baseline is deliberately **not** wired into Apply. Apply continues to PUT L3 only, and never reads or writes an RDM baseline. Should RDM write-back ever be scoped, the oracle it needs is already on disk.

### D9: One combined drift warning, not one per file

The guard runs before anything is fetched. It enumerates the tenant folder's existing `L3.reltio.json` and `RDM.*.reltio.json` files, compares each against its baseline, and if any differ shows a **single** modal naming them.

**Alternative considered — a separate prompt per drifted file:** rejected. A tenant with several RDM tenants could produce a chain of modals for one click, which users dismiss reflexively — defeating the warning's purpose.

"Review changes" keeps its current behavior of diffing L3 against the remote copy. Per-file diffs for RDM are a **non-goal** here: the warning names the affected RDM files so nothing is lost silently, and adding a multi-file review flow would expand this change well past its purpose. If the user chooses "Apply my changes instead" from the review path, they are pushing L3 rather than fetching, so the RDM chain is skipped entirely.

### D10: Mirror the L3 write shape exactly

`writeRdmFromApi(environmentName, tenantId, token)` returns the same `'written' | '401' | 'error'` union as `writeL3FromApi`, extended with `'none'` for the no-RDM outcome so the caller can stay silent per D3. It performs the same post-write steps: `prettyPrintJsonIfPossible`, write configuration and baseline, revert the document if open, `treeProvider.refresh()`, `uxBus.fire()`. A 401 from **either** call in the chain routes to `handle401(environmentName)` — the RDM service shares the environment token, so a 401 there means the same expired session.

### D11: The RDM schema is permissive about properties it has not seen

`schemas/reltio-rdm.schema.json` is derived from **one** tenant's RDM configuration. RDM configurations vary per tenant, so the observed key set is a lower bound on what exists in the field, not a specification of it. The schema therefore:

- type-checks and documents the properties it knows about,
- requires only `uri` on `lookupTypes` and `sources` items, since that URI is the identity L3 `lookupCode` values reference,
- and **does not** set `additionalProperties: false` at any level, so a property this repository has never seen is not reported as an error.

**Alternative considered — `additionalProperties: false`, mirroring the L3 schema:** rejected. The L3 schema can afford strictness because it was derived from the platform XSD and then corrected against a corpus of live configurations — and even so, `schema-alignment-with-live-l3` exists as a whole change dedicated to fixing the cases where strictness rejected valid live payloads. Repeating that pattern from a sample size of one would produce false errors on the first tenant whose configuration includes a key we have not seen, and those errors would appear on a file the user cannot edit into compliance because the server produced it.

The trade-off is losing typo detection on hand-edited RDM files. That is the right way round: this capability is read-only, so the file's normal provenance is the server, and a schema that flags valid server output is worse than one that misses a hand-introduced typo. Strictness can be tightened later once a corpus of RDM configurations from several tenants exists.

### D12: Pure extractor as the unit-test seam

`extractRdmConfig(json)` takes already-parsed JSON and returns `{ serviceUri, rdmTenantIds[] }`. It has no `vscode` import and no network access, so Tier A tests assert it directly against the sanitized fixture — including the degenerate cases (absent `rdmConfig`, absent `serviceUri`, empty `rdmTenants`, entries missing `rdmTenantId`).

Consistent with the rest of the harness (`ARCHITECTURE.md`, "Unit tests"), no unit test performs network I/O; the HTTP functions are covered by Tier C manual QA against a live tenant. URL construction is kept in one-line template expressions so that reading the function is sufficient to verify the path.

## Risks / Trade-offs

- **[Risk]** VS Code may not honor the `!` exclusion pattern in `contributes.jsonValidation.fileMatch`, leaving RDM files validated against the L3 schema → **Mitigation**: verified explicitly in the Extension Development Host as a Tier C step before the change is considered done; documented fallback is D6's alternative (a filename outside the `*.reltio.json` glob). The Tier B test asserts the manifest wiring, which catches regression but not VS Code's interpretation of it.
- **[Risk]** `DEFAULT_TIMEOUT_MS` is a shared 10s constant, and the discovered RDM service may be a different, potentially cross-region host from the MDM environment → **Mitigation**: keep the shared constant rather than pre-emptively adding a knob; if RDM fetches time out in practice, a per-call timeout override is a small follow-up. Noted here so the cause is obvious if it happens.
- **[Risk]** The physical configuration is a large payload (~420 lines in the sample) fetched for one nested block → **Mitigation**: accepted. It is on-demand from an explicit command, never on activation, and the alternative (caching it) would mean persisting or holding a secret-bearing payload.
- **[Risk]** The working fixtures currently sit untracked at the repository root (`GetTenantPhysicalConfig.json`, `RDM_Config.json`) and contain real tenant identifiers and a credential-shaped `provider` string → **Mitigation**: a dedicated task sanitizes them into `samples/` before any commit; the root copies are not added to version control.
- **[Risk]** Attaching RDM to Get Configuration means two extra HTTP calls on every invocation, including on tenants that have no RDM and will never have one → **Mitigation**: accepted as the cost of the chosen trigger. The calls are sequential after L3 is already written, so they delay only the tail of an action the user initiated, and a failure there cannot cost them the L3 fetch (D2). If it becomes a problem, caching the physical config per session is a contained follow-up.
- **[Trade-off]** The drift warning names drifted RDM files but does not diff them (D9). Accepted: the protection the user asked for is not losing edits silently, which naming achieves; a multi-file review flow would expand this change well past its purpose.
- **[Trade-off]** Fetching every RDM tenant (D7) writes as many files as the tenant declares, rather than asking which one the user wanted. Accepted over a prompt, since the write is idempotent and cheap.
- **[Risk]** The RDM schema and the `RdmConfiguration` type are both derived from a single tenant's configuration, and RDM configurations vary per tenant → **Mitigation**: the schema is permissive about unrecognized properties (D11), and the model interface declares every property optional except what the extension actually reads, so a tenant with a different key set neither fails validation nor breaks parsing. The observed key set is treated throughout as a lower bound on what exists, not a specification.
- **[Risk]** Unit tests assert against fixtures from one tenant, which can encode that tenant's shape as if it were the contract → **Mitigation**: the Tier A cases assert the extractor's *behavior* over constructed inputs (absent, empty, partial, multiple) rather than only replaying the fixture, so the tests do not depend on that tenant's particular lookup types, source list, or counts.

## Migration Plan

Additive; no data migration. The only change to existing behavior is narrowing the L3 `jsonValidation` glob, which excludes a filename pattern (`RDM.*.reltio.json`) that does not exist in any workspace today — so no currently-valid L3 file changes its validation outcome.

Rollback is a plain revert: the new command disappears, the schema binding returns to `*.reltio.json`, and any `RDM.*.reltio.json` files already on disk become plain untyped JSON rather than broken.

## Open Questions

None blocking. Two items to resolve during apply, both with documented fallbacks above: whether the `fileMatch` exclusion pattern behaves as expected in the dev host (D6 / Risks), and whether the shared 10s timeout is sufficient for the RDM host (Risks).

## Test plan

| Tier | Script / Method | What it covers |
|------|------------------|-----------------|
| A (automated) | `scripts/test-rdm-configuration-fetch.cjs` | `extractRdmConfig` returns `serviceUri` and all `rdmTenantIds` from the sanitized physical-config fixture; returns empty results for absent `rdmConfig`, absent `serviceUri`, empty `rdmTenants`, and entries missing `rdmTenantId`; returns **all** ids, order preserved, for a constructed multi-entry input. Assertions are derived from each input rather than from hard-coded counts or the sample tenant's identifiers |
| A (automated) | same script | The sanitized RDM fixture validates against `schemas/reltio-rdm.schema.json`; a constructed configuration carrying an **extra, unrecognized** top-level property and an extra property on a `lookupTypes` item also validates, locking in the permissiveness decided in D11; a `lookupTypes` item with no `uri` fails |
| A (automated) | same script | The drift-guard predicate over a constructed tenant folder: clean files warn about nothing; a drifted RDM file warns; a missing baseline counts as drifted; the result names every affected file |
| B (automated) | same script | `jsonValidation` binds `RDM.*.reltio.json` to `schemas/reltio-rdm.schema.json` and excludes that pattern from the L3 entry; `schemas/reltio-rdm.schema.json` is valid JSON and is listed in `.vscodeignore`-safe packaging inputs; **no** RDM-specific command or menu entry exists in `contributes` |
| C (manual QA) | Extension Development Host against a live tenant | Run **Get Configuration** on a tenant with RDM: L3, each `RDM.{rdmTenantId}.reltio.json` and both baselines appear pretty-printed, and the RDM file opens with **no schema errors** in the Problems panel while `L3.reltio.json` still validates against the L3 schema. Run it on a tenant without RDM and confirm **no** RDM notification of any kind. Edit an RDM file, re-run, and confirm one warning naming it — declining changes nothing, accepting refreshes file and baseline. Sign in so a tenant is auto-added and confirm login fetches L3 only. Confirm Apply still works and ignores RDM. Expire the token and confirm the 401 path reaches the existing re-login flow. Confirm no physical-configuration file is left in the workspace |
