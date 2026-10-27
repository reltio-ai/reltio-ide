## Why

The RDM feature and the git-ready tenant folder structure (RP-200851) were built on separate branches and merged. The merge kept both working, but left RDM outside the component tree:

- RDM configurations sit at the tenant folder root as `RDM.{rdmTenantId}.reltio.json`, while the tree reserves an `RDM/` component folder for exactly this data.
- RDM baselines sit at the tenant root too — inside the Git-tracked tree — so for a Git-bound tenant they appear in `git status` and would be committed. The layout's rule is that IDE working state lives in the gitignored `.reltio-ide/`.
- RDM is fetched only by Get Configuration, whereas `BusinessConfig.json` is also fetched the moment a tenant is connected, through browser sign-in and **Add Tenant**. A freshly connected tenant therefore shows its L3 but no RDM until the user runs a second command.

## What Changes

- RDM configurations move to **`RDM/{rdmTenantId}/config.json`** inside the tenant folder, one subfolder per RDM tenant.
- RDM baselines move to **`.reltio-ide/RDM/{rdmTenantId}.baseline.json`**, out of the tracked tree.
- The RDM path names are declared in `src/workspace/tenantFolderStructure.ts`, the layout's single place for tenant paths.
- Existing RDM files at the tenant root are **relocated** on activation, after the layout migration, by an idempotent step that never overwrites.
- The RDM schema binding follows the files to `**/RDM/*/config.json`; the legacy binding stays for files that could not be relocated.
- **Connecting a tenant fetches RDM**, as it does `BusinessConfig.json`: browser sign-in auto-add and **Add Tenant** continue into the RDM chain after a successful L3 write. **BREAKING (behaviour):** reverses the earlier decision that sign-in fetches L3 alone.

## Capabilities

### New Capabilities

- `rdm-component-folder`: where RDM configurations and baselines live in the component tree, how existing root-level RDM files are relocated, and fetching RDM when a tenant is connected.

### Modified Capabilities

- `rdm-configuration-fetch`: the file-location requirements move to the component tree, and "RDM is fetched as part of Get Configuration" is widened to the connect flows — its "Login flow is unaffected" scenario is reversed.
- `rdm-json-schema`: the binding follows the files to `**/RDM/*/config.json`.

## Impact

- `src/workspace/tenantFolderStructure.ts` — RDM path constants and helpers.
- `src/workspace/environmentManager.ts` — `getRdmUri`, `getRdmBaselineUri`, `listRdmTenantIds`, `writeRdm`, `writeRdmBaseline` repathed; legacy-file detection kept for relocation.
- `src/workspace/rdmRelocation.ts` — new; idempotent move of root-level RDM files into the tree.
- `src/extension.ts` — relocation chained after the layout migration; a shared RDM-fetch helper used by Get Configuration, sign-in auto-add and Add Tenant; drift-warning labels.
- `package.json` — RDM schema binding.
- Tests: `test-rdm-component-folder.cjs` (new) and updated path expectations in the RDM suites.
- `ARCHITECTURE.md` — RDM files in the tenant tree; the "not yet reconciled" note removed.

**Unchanged:** the `RDM` component stays `managed: false` in the layout's model. See design D6.
