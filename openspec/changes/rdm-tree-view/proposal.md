## Why

`rdm-configuration-fetch` brings each tenant's RDM configuration to disk as `RDM.{rdmTenantId}.reltio.json`, but nothing surfaces it. A user who runs Get Configuration sees the L3 sub-tree rebuild while the RDM file they just downloaded is reachable only by opening it from the file explorer and reading raw JSON — which is precisely the experience the configuration tree exists to replace for L3.

Reference data is also the part of a tenant's model most often browsed rather than edited: "which lookup types exist" and "what sources feed them" are read-only questions, and a tree answers them far better than a JSON document with dozens of array entries.

A secondary reason: `TenantInfo.hasRdm` was added by `rdm-configuration-fetch` and is currently consumed by nothing. This change is what gives it a purpose.

## What Changes

- Each `RDM.{rdmTenantId}.reltio.json` in a tenant folder contributes a collapsible root node labelled `RDM_{rdmTenantId}`, shown under the tenant node after the L3 sections.
- Under that root, each array-valued section of the RDM configuration becomes a folder with a count — **Lookup Types** and **Sources** — matching how L3 sections render.
- Each lookup type and source is a leaf node labelled by `label` (falling back to the trailing segment of `uri`), with its `uri` as the grey description.
- A new node family — `RdmRootNode`, `RdmFolderNode`, `RdmItemNode` — carrying context values in a dedicated `reltio.rdm.*` namespace, rather than reusing `ConfigTreeItem`.
- **Show in Editor** is contributed for RDM nodes, resolving against the RDM file rather than `L3.reltio.json`.
- `revealInEditor` is widened from `ConfigTreeItem` to the minimal shape it actually uses (`{ jsonPath }`), so RDM nodes reuse it unchanged.
- `TenantInfo.hasRdm` becomes load-bearing: it gates whether the provider enumerates RDM files for a tenant.
- **No** Delete, Rename, Add-a-new-*, or Show in Ontology on RDM nodes — see the namespace decision below.

## Capabilities

### New Capabilities

- `rdm-tree-view`: the RDM sub-tree — root node naming and placement, which sections appear, item labelling, the read-only context-value namespace, Show in Editor behaviour against the RDM file, and how multiple RDM tenants and absent/unparsable files are handled.

### Modified Capabilities

- `multi-tenant-tree-view`: the "Multi-level configuration tree" requirement currently describes a tenant's children as the L3 sub-tree alone. It is extended to include one RDM root per RDM configuration file present in the tenant folder.

## Impact

- `src/tree/multiTenantNodes.ts` — three new node classes alongside the existing `HistoryFolderNode` / `HistorySnapshotNode`.
- `src/tree/rdmSubtree.ts` — new; builds root → section → item children, mirroring the role `configSubtree.ts` plays for L3.
- `src/tree/multiTenantTreeProvider.ts` — `getChildren` gains RDM branches under `TenantNode` and under the new node types; `getParent` gains the reverse mapping; `MultiTenantTreeElement` widens.
- `src/parser/configParser.ts` — an RDM-typed parse returning model plus jsonc AST, so reveal has ranges to jump to.
- `src/commands/revealCommand.ts` — parameter type widened; no behavioural change.
- `package.json` — one `view/item/context` entry for Show in Editor scoped to `reltio.rdm.*`. No new commands.
- `scripts/test-rdm-tree-view.cjs` — new, registered in `scripts/run-unit-tests.cjs`.
- `ARCHITECTURE.md` — tree structure and the new module.
- No new dependencies. No change to fetching, writing, or the RDM schema.

**Deliberately untouched:** `ConfigTreeItem`, `configSubtree.ts`, and the L3 sections' behaviour. The existing `reltio.deleteNode` / `reltio.renameNode` `when` clauses are left exactly as they are.
