## Context

The configuration tree is assembled in `MultiTenantTreeProvider.getChildren`. Today a `TenantNode`'s children are an optional `HistoryFolderNode` plus `getConfigRootChildren(model, l3Uri)` — the L3 sections, spread **directly** under the tenant with no intervening "L3" root. Everything below that is a `ConfigTreeItem`, whose `jsonPath` addresses a location in the L3 document and whose `tenantL3Uri` tells the provider which file to re-parse.

Two existing mechanisms constrain how RDM can join that tree.

**Context values drive the menus, and the edit menus match broadly.** `ConfigTreeItem` derives its `contextValue` from `contextValueFor()`, which mints `reltio.item.<type>` for every non-folder node. The manifest then attaches commands by regex:

```
reltio.deleteNode   →  viewItem =~ /^reltio\.item\./
reltio.renameNode   →  viewItem =~ /^reltio\.item\./
reltio.revealInEditor → viewItem =~ /^reltio\.(item|folder)\./
```

Any node minted through `ConfigTreeItem` therefore inherits Delete and Rename automatically.

**`tenantL3Uri` means L3 specifically.** `loadParsedFromItem`, `browseEntitiesFromTree`, the ontology commands and the edit commands all read it as "the L3 document backing this node". It is not a generic "source file" field.

RDM data is read-only in the IDE: `rdm-configuration-fetch` writes RDM files but never PUTs them, so no edit of an RDM node could ever reach the server.

## Goals / Non-Goals

**Goals:**

- Each fetched RDM configuration appears as a browsable sub-tree rooted at `RDM_{rdmTenantId}`, in the same visual language as the L3 sections.
- Show in Editor works on RDM nodes and lands in the RDM file.
- Destructive and L3-specific commands are structurally unable to appear on RDM nodes.
- A tenant with no RDM file, several RDM files, or an unparsable one all behave sensibly.
- The L3 sub-tree renders exactly as it does today.

**Non-Goals:**

- **Editing RDM from the tree.** No add, rename, delete, or any write path. The IDE cannot push RDM changes, so offering edits would produce local-only divergence that a re-fetch silently discards.
- **Lookup values.** The configuration payload lists lookup *type definitions*; the code-to-value mappings come from a different RDM endpoint. The tree therefore stops at three levels, and adding values means a new fetch, not a new tree level.
- **Show in Ontology for RDM.** The ontology renders entity and relation types from an L3 model; RDM has no graph to draw.
- **Cross-linking `lookupCode` to RDM lookup types.** Navigating from an L3 attribute to its lookup type is the `rdm-lookup-code-navigation` capability, still unproposed.
- **Surfacing RDM scalars** (`version`, `updateDate`, `trackTranscodeErrors`, `label`, `updatedBy`) as tree nodes — L3 shows only sections, not top-level metadata, and RDM follows that.

## Decisions

### D1: A separate node family, not new `ConfigNodeType` values

RDM nodes are three new classes — `RdmRootNode`, `RdmFolderNode`, `RdmItemNode` — in `multiTenantNodes.ts`, with context values `reltio.rdm.root`, `reltio.rdm.folder.<section>`, `reltio.rdm.item.<section>`.

**Alternative considered — extend `ConfigNodeType` and reuse `ConfigTreeItem`:** rejected, and this is the decision the rest of the design hangs on. It looks cheaper (free icons, free id scheme, free reveal) but `contextValueFor()` would emit `reltio.item.rdmLookupType`, which matches `/^reltio\.item\./` — so **Delete and Rename would appear on every RDM node on day one**. Those commands edit the document named by `tenantL3Uri`, so invoking one would either corrupt the RDM file or edit the wrong file entirely. The mitigation would be tightening two regexes in the manifest to exclude RDM, which works until someone adds a third command with the same broad pattern and silently reintroduces the bug.

A separate namespace makes the failure impossible rather than merely absent: no RDM context value can match `reltio.item.*`, whatever menu entries are added later. There is precedent — `HistoryFolderNode` and `HistorySnapshotNode` already sit outside `ConfigTreeItem` for the same reason, and the manifest scopes their menus by their own context values.

The cost is real and accepted: the three classes re-declare their own icons and id scheme rather than inheriting `ConfigTreeItem`'s, and Show in Editor must be wired explicitly (D5).

### D2: `RDM_{rdmTenantId}` — the RDM tenant id, not the MDM one

The root label is `RDM_` followed by the **RDM** tenant id, which is both the id in the file name and the value of the RDM configuration's own `tenantId` field.

A tenant may declare several RDM tenants, so labelling roots with the MDM tenant id would produce indistinguishable siblings. Using the RDM id also means the label matches the file name a user sees on disk, so "which node came from which file" needs no explanation.

The id comes from the **file name**, not from the parsed `tenantId` field, so a root still renders with the right label when the file is unparsable (D6) — and the two agree in practice because the fetch writes the file using the id it fetched.

### D3: RDM roots come after the L3 sections

Order under a tenant: History folder (when shown) → L3 sections → RDM roots, sorted by RDM tenant id.

L3 is what users open the IDE for and what the tenant node has always expanded into; pushing those sections down to make room for reference data would be a regression in the common case. Sorting the roots keeps ordering stable across fetches rather than following directory-read order.

RDM roots are gated on their own files, not on L3. Two ripples follow, both small but easy to miss:

- `getChildren` currently does all its work inside `if (element.hasL3)`. RDM enumeration moves outside that guard.
- `TenantNode` sets its collapsible state to `hasL3 ? Collapsed : None`, so a tenant holding RDM files but no readable L3 would render as a leaf and never reveal them. The constructor takes `hasRdm` and the state becomes `hasL3 || hasRdm ? Collapsed : None`.

This is what makes `TenantInfo.hasRdm` — added but unused by `rdm-configuration-fetch` — load-bearing. In practice the case is rare, since the fetch chain only writes RDM after L3 succeeds, but it arises as soon as someone deletes `L3.reltio.json` and keeps the folder.

### D4: Sections are derived from array-valued keys

`rdmSubtree.ts` declares a section table — `lookupTypes` → "Lookup Types", `sources` → "Sources" — mirroring the `SECTIONS` table in `configSubtree.ts`, including the `(count)` suffix and the omit-when-empty behaviour of `getRootChildren`.

Items are leaves: every field of a lookup type and a source is a scalar, so there is nothing to expand into. Label is `label` falling back to the trailing segment of `uri`; description is the full `uri`, which is the value an L3 `lookupCode` actually references and therefore the thing a user is most likely to want to read or copy.

**Alternative considered — reflecting over whatever arrays the payload contains:** rejected. RDM configurations vary per tenant, so a future array key would render as an unlabelled folder of unlabelled objects. An explicit table degrades by omission — an unknown section simply does not appear — which is the safer failure for a read-only view. A tenant needing a new section gets one line added here.

### D5: Reveal is reused by widening its parameter type

`revealInEditor(item, ast, documentUri)` is typed to `ConfigTreeItem` but only ever reads `item.jsonPath`. Widening the parameter to `{ jsonPath: (string | number)[] }` lets RDM nodes reuse it with no behavioural change and no duplicated reveal logic.

The manifest gains one `view/item/context` entry for `reltio.revealInEditor` scoped to `viewItem =~ /^reltio\.rdm\./`, and the command handler resolves the document from the node's own RDM file URI rather than the tenant's L3.

This is the one place the separate namespace costs something, and it costs one manifest entry and one type widening.

### D6: An unparsable or unreadable RDM file still shows its root

A file that fails to parse yields a root node with no children and a description marking it unreadable, rather than vanishing from the tree.

Silently omitting it would be the worst outcome: the user ran Get Configuration, the fetch reported success, and the data simply is not there with no indication why. A visible empty root points at the file, which they can then open — and Show in Editor still works, since it needs only the URI.

### D7: RDM parsing goes through a typed sibling of `parseDocument`

`parseDocument` returns `{ model, ast, errors }` with `model` cast to `ReltioBusinessModel`. RDM gets a sibling returning the same triple with `model` typed as `RdmConfiguration`, sharing the same `jsonc-parser` calls.

Casting an RDM payload to `ReltioBusinessModel` and reusing `parseDocument` would nominally work — and would even half-render, since `sources` is a top-level key in *both* models — but that coincidence is a trap: RDM sources and L3 sources have different shapes, so the L3 section renderer would produce wrong descriptions from an RDM file. A typed parse keeps the two models from being interchangeable by accident.

The AST is required, not optional: it is what gives Show in Editor a range to jump to.

## Risks / Trade-offs

- **[Risk]** A future contributor adds a tree command with a broad `when` clause such as `/^reltio\./` and catches RDM nodes in it → **Mitigation**: the Tier B test asserts that no RDM context value matches the Delete or Rename patterns, so the regression fails the build rather than shipping. The test encodes the intent, not just the current manifest.
- **[Risk]** `MultiTenantTreeElement` is a union type; widening it means every `instanceof` chain in the provider must handle the new members, and a missed branch silently returns no children → **Mitigation**: the union is exhaustive by construction in TypeScript for `getParent`'s return, and the Tier A subtree tests walk root → section → item so a missing branch shows up as an empty child list.
- **[Risk]** Re-parsing every RDM file on each `TenantNode` expansion adds file reads to an interaction that is currently one L3 read → **Mitigation**: RDM configurations are far smaller than L3, reads happen only on expansion of a node the user chose to open, and the provider already re-parses L3 on the same path. Revisit only if it shows up in practice.
- **[Trade-off]** The three node classes duplicate icon and id-scheme wiring that `ConfigTreeItem` already has (D1). Accepted as the price of making the Delete/Rename bug structurally impossible.
- **[Trade-off]** An explicit section table (D4) means a tenant with an RDM section this repository has never seen shows nothing for it. Accepted: silent omission is safer than rendering unlabelled nodes, and it mirrors how `configSubtree.ts` already works.

## Migration Plan

Purely additive to the tree. No file formats, commands, settings, or stored state change, and tenants with no RDM files render exactly as before. Rollback is a plain revert — RDM files stay on disk and simply stop appearing in the tree.

## Open Questions

None blocking. One to confirm during QA: whether `RDM_{rdmTenantId}` reads well in the tree against a real tenant whose RDM ids are opaque 15-character strings, or whether the RDM configuration's `label` would make a better primary label with the id as description. The label is trivially swappable and does not affect any other decision here.

## Test plan

| Tier | Script / Method | What it covers |
|------|------------------|-----------------|
| A (automated) | `scripts/test-rdm-tree-view.cjs` | Root children of the sanitized RDM fixture are exactly the non-empty array sections, each labelled with its count; items carry `label` (or the uri tail when `label` is absent) and the full `uri` as description; a configuration with empty `lookupTypes`/`sources` yields no folders; assertions derive from the fixture rather than hard-coded counts |
| A (automated) | same script | Every node's `jsonPath` resolves in the parsed model, so Show in Editor has a real range to target; root → section → item parent resolution round-trips |
| B (automated) | same script | No RDM context value matches `/^reltio\.item\./` or `/^reltio\.folder\./`, so Delete, Rename and the L3 reveal entry cannot attach; the manifest contributes exactly one RDM-scoped menu entry and no new commands |
| C (manual QA) | Extension Development Host against a live tenant | After Get Configuration, `RDM_{rdmTenantId}` appears under the tenant below the L3 sections and expands to Lookup Types and Sources with correct counts; a lookup type's Show in Editor opens the RDM file at that entry, not L3; right-clicking any RDM node offers **no** Delete/Rename/Add/Show in Ontology; a tenant with two RDM tenants shows two roots; a tenant with none shows no RDM root and an unchanged L3 sub-tree; corrupting an RDM file leaves a visible empty root rather than removing it |
