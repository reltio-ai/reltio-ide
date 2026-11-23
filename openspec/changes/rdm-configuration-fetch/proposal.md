## Why

L3 configurations reference RDM lookup types through `lookupCode` values of the form `rdm/lookupTypes/<Name>`, but the IDE has no way to see the RDM side of that reference. `lookupCode` is just an untyped string in `src/model/types.ts` and `schemas/reltio-metadata.schema.json`, so a typo in a lookup code is indistinguishable from a valid one until the Reltio platform rejects it. How many lookup codes a given L3 uses, and which lookup types a given RDM tenant defines, vary per tenant — the sample configurations in this repository each contain dozens of such references, but no particular count should be inferred for any other tenant.

The blocker until now was discovery: `ReltioBusinessModel.rdmTenantId` exists in the model but is not populated in the L3 payloads observed so far, so it cannot be relied on for discovery, and the RDM service can be hosted separately from the MDM environment. The tenant physical configuration (`GET /reltio/tenants/{tenantId}`) resolves both — it carries an `rdmConfig` block with `serviceUri` and `rdmTenants[].rdmTenantId` — which makes a reliable two-step fetch possible for the first time.

## What Changes

- New API function `fetchTenantPhysicalConfiguration(baseUrl, tenantId, token)` → `GET https://{env}/reltio/tenants/{tenantId}`, a sibling of the existing `listTenants` (`GET /reltio/tenants`).
- New pure extractor `extractRdmConfig(json)` → `{ serviceUri, rdmTenantIds[] }`, tolerant of a missing or empty `rdmConfig`.
- New API function `fetchRdmConfiguration(serviceUri, rdmTenantId, token)` → `GET {serviceUri}/configuration/{rdmTenantId}`, reusing the existing `toHttpsBase` / `fetchWithTimeout` / `reltioHeaders` / `ReltioApiError` conventions and the same environment bearer token.
- The existing **Get Configuration** command (`reltio.fetchL3`) continues into the RDM chain after L3 is written, so one action yields the tenant's full configuration. No new command and no new menu entry.
- The chain is added to the **command handler**, not to `writeL3FromApi` — that function is also called by the post-SSO auto-add and apply-defaults paths, which must keep their current behavior.
- Each fetched RDM configuration gets a baseline twin, and the command's existing pre-fetch drift warning is extended to cover RDM files so local edits are never overwritten silently.
- New `RdmConfiguration` / `RdmLookupType` model interfaces and a dedicated `schemas/reltio-rdm.schema.json`.
- **BREAKING (editor validation scope only):** the `contributes.jsonValidation` entry for `*.reltio.json` is narrowed so RDM files are not validated against the L3 metadata schema. No runtime or API behavior changes; no existing L3 file changes validation outcome.
- The tenant physical configuration is **never written to disk** — it is fetched transiently and only `rdmConfig` is retained.

## Capabilities

### New Capabilities

- `rdm-configuration-fetch`: the two-step discovery-then-fetch chain (physical config → `rdmConfig` extraction → RDM configuration), its attachment to the existing Get Configuration command, the on-disk file layout for RDM configurations and their baselines, multi-RDM-tenant handling, failure isolation from the L3 fetch, quiet handling of tenants without RDM, and the rule that the physical configuration is never persisted.
- `rdm-json-schema`: the RDM JSON Schema file, the properties it recognizes and type-checks (`tenantId`, `label`, `trackTranscodeErrors`, `lookupTypes`, `sources`, `updatedBy`, `updateDate`, `version` — the keys observed in a fetched configuration), its deliberate tolerance of tenant-specific properties beyond that set, and its editor validation binding.

### Modified Capabilities

- `metadata-json-schema`: the requirement that files matching `*.reltio.json` receive `schemas/reltio-metadata.schema.json` is narrowed to exclude RDM configuration files, whose top-level shape the L3 schema cannot accept and which get their own schema.
- `tenant-configuration-apply`: the "Baseline capture on fetch" requirement is extended — a successful Get Configuration now also persists a baseline for each RDM configuration it writes, alongside the existing L3 baseline. Apply remains L3-only and never consults or pushes RDM.

## Impact

- `src/api/reltioClient.ts` — two new fetch functions plus the pure `extractRdmConfig` extractor.
- `src/model/types.ts` — `RdmConfiguration`, `RdmLookupType`, `TenantPhysicalConfiguration` (narrow, `rdmConfig`-only shape).
- `schemas/reltio-rdm.schema.json` — new file.
- `src/workspace/environmentManager.ts` — `getRdmUri()` / `writeRdm()`, `getRdmBaselineUri()` / `writeRdmBaseline()`, and enumeration of existing RDM files for the drift check.
- `src/extension.ts` — `writeRdmFromApi()` orchestrator called from the `reltio.fetchL3` handler after a successful L3 write; the pre-fetch drift guard extended to cover RDM files; 401 routed to the existing `handle401`. `writeL3FromApi` itself is unchanged, so the post-SSO and apply-defaults paths keep their current behavior.
- `package.json` — the narrowed plus added `jsonValidation` entries only. No new command or menu contribution.
- `scripts/test-rdm-configuration-fetch.cjs` — new, registered in `scripts/run-unit-tests.cjs`.
- `samples/` — sanitized physical-config and RDM-config fixtures (the working copies currently sit untracked at the repository root and must not be committed as-is: the physical config contains a messaging `provider` credential string, Spanner service-account identifiers, and internal Elasticsearch hostnames).
- `ARCHITECTURE.md` — new endpoint entry and the tenant-folder file layout.
- No new dependencies. No change to token acquisition or storage — the existing per-environment bearer token is accepted by the RDM service.
