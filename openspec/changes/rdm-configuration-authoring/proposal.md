## Why

The RDM sub-tree is currently a viewer: `rdm-configuration-fetch` brings a tenant's reference data down, `rdm-tree-view` makes it browsable, and `rdm-lookup-values` reads a lookup type's values on demand. Adding a lookup type or a source still means leaving the IDE for the Reltio UI, even though the file is already on disk, already schema-validated, and already has a baseline recording what the server last returned.

This closes the loop: author a new lookup type or source in the local file, then push the whole configuration back. It is a deliberate change of premise — the RDM sub-tree stops being read-only — so the requirements that were justified by "nothing is ever PUT to the RDM service" are revisited here rather than quietly contradicted.

## What Changes

- New commands **Add a new Lookup Type** and **Add a new Source**, inserting a minimal skeleton into `RDM.{rdmTenantId}.reltio.json` with a default unique label, following the no-wizard pattern the L3 insert commands already use.
- Offered on the matching section folder, and both offered on the `{rdmTenantId}` row — a section the configuration does not yet declare has no folder to right-click, so the tenant row is the only place a first lookup type or source can be created. The insert creates the missing array when needed.
- New command **Apply RDM Configuration** on the `{rdmTenantId}` row, which PUTs the local file to `{serviceUri}/configuration/{rdmTenantId}`.
- Apply performs the same pre-flight as L3: re-fetch the remote configuration, compare it against the RDM baseline, and if the server changed since the last fetch, warn and offer a diff before overwriting. The baseline is refreshed on success.
- Edits go through the `jsonc-parser` AST and a `WorkspaceEdit`, never string manipulation, as the repository requires for every JSON edit.
- **BREAKING (internal):** `insertIntoArray` and its supporting helpers in `src/commands/editCommands.ts` become exported and take their bootstrap-key allowlist as a parameter, so RDM can reuse the insertion machinery without inheriting L3's key set.

## Capabilities

### New Capabilities

- `rdm-configuration-authoring`: the two insert commands — placement, scoping, skeleton shape, default naming, creation of an absent section — and **Apply RDM Configuration**: its pre-flight drift check, the PUT, baseline refresh, and the failure and unauthorized paths.

### Modified Capabilities

- `rdm-tree-view`: the requirement that RDM nodes carry a read-only context namespace is narrowed. The namespace still exists, and still exists to keep the L3 `reltio.deleteNode` / `reltio.renameNode` commands — which edit whichever document `tenantL3Uri` names — from ever attaching to an RDM node. What changes is the blanket claim that no RDM node offers an "Add a new …" command: RDM now has its own, scoped to `reltio.rdm.*` and editing the RDM file.
- `rdm-configuration-fetch`: the requirement that re-fetch overwrites without a drift check, and the statement that RDM baselines exist only to warn before overwrite, are updated — the baseline is now also the oracle for Apply, which is what it was recorded for.
- `tenant-configuration-apply`: the scenario asserting that Apply never reads an RDM file or pushes RDM content described **Apply Configuration to Tenant**, the L3 command. That remains true of it, and is restated so it is clearly about the L3 command rather than about the extension as a whole.

## Impact

- `src/rdm/rdmSkeletons.ts` — new; pure `buildRdmLookupTypeObject(label)` and `buildRdmSourceObject(label)`, plus label collection for default naming.
- `src/rdm/rdmEditCommands.ts` — new; AST-based insertion into the RDM document and reveal of the inserted block.
- `src/commands/editCommands.ts` — `insertIntoArray`, `findArrayInsertionPoint` and the missing-root-array bootstrap become reusable, with the allowlist passed in rather than hard-coded.
- `src/api/reltioClient.ts` — `putRdmConfiguration(serviceUri, rdmTenantId, body, token)`, reusing the existing Reltio error-body formatter.
- `src/extension.ts` — registers `reltio.addRdmLookupType`, `reltio.addRdmSource`, `reltio.applyRdmConfiguration`; the Apply pre-flight; 401 routed to the existing `handle401`.
- `package.json` — three commands and their `view/item/context` entries, scoped to `reltio.rdm.folder.lookupTypes`, `reltio.rdm.folder.sources` and `reltio.rdm.root`.
- `scripts/test-rdm-configuration-authoring.cjs` — new, registered in `scripts/run-unit-tests.cjs`.
- `ARCHITECTURE.md` — the PUT endpoint, the authoring commands, and the revised read-only note.

**Explicitly unchanged:** no delete or rename for RDM entries — this adds authoring of new blocks, not full editing. Lookup *values* remain read-only; only the configuration document is writable.
