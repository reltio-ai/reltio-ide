## Context

The configuration tree (`src/tree/`) builds `ConfigTreeItem` nodes with a `contextValue` derived only from `nodeType` (`src/tree/treeNodes.ts`, `contextValueFor`). `package.json` `contributes.menus["view/item/context"]` `when` clauses key off these `contextValue` strings (`reltio.item.*`, `reltio.folder.*`) to decide which "Insert …" commands appear.

Today, `attributesFolder` and `nestedAttribute` produce the **same** `contextValue` regardless of whether they live under `entityTypes[]` or `relationTypes[]`, because `jsonPath` (which does encode the ancestry — e.g. `['relationTypes', 0, 'attributes']` vs `['entityTypes', 0, 'attributes']`) is never consulted. This is why **Insert Reference Attribute** currently shows for relation types even though it shouldn't (RP-189643, confirmed by Snehil on the ticket — only Reference should be hidden, Simple/Nested stay).

## Goals / Non-Goals

**Goals:**
- Hide **Insert Reference Attribute** for any attribute container whose root array is `relationTypes[]` (the relation type item itself, its `Attributes` folder, and nested attributes at any depth inside it).
- Keep **Insert Simple Attribute** and **Insert Nested Attribute** visible for relation types, unchanged.
- Keep all entity-type, group-type, interaction-type, category-type attribute containers fully unaffected (all three commands still show, exactly as today).
- Resolve the RT-root "same split as entity?" open question in `no-create-wizards/design.md` and `element-candidates.md`.

**Non-Goals:**
- Not fixing the pre-existing `buildAttributeObject` bug where the required `name` field is omitted from inserted attribute skeletons — tracked separately, out of scope here.
- Not touching skeleton shape/content (`elementSkeletons.ts`) or the insert handler (`editCommands.ts`) — this is a menu-visibility-only change.
- Not adding a generic "ancestor-type" tagging system for every node type — only the two node types that need it (`attributesFolder`, `nestedAttribute`) get the suffix, kept minimal.

## Decisions

### D1: Encode ancestry via a `contextValue` suffix, derived from `jsonPath[0]`

`contextValueFor(nodeType, jsonPath)` becomes path-aware: for `nodeType === 'attributesFolder' | 'nestedAttribute'`, if `jsonPath[0] === 'relationTypes'`, append `.relationType` to the existing `contextValue` (e.g. `reltio.folder.attributesFolder.relationType`, `reltio.item.nestedAttribute.relationType`). All other node types and the entity-type ancestry are unaffected — `contextValue` stays exactly as it is today.

**Alternative considered — separate `ConfigNodeType` variants** (e.g. `relationAttributesFolder`, `relationNestedAttribute`): rejected. It would ripple through `configSubtree.ts` dispatch (`getNodeChildren` switch), `NODE_ICONS`, and every place that pattern-matches on `nodeType`, for a distinction that only matters to one `when` clause. A `contextValue` suffix is the smallest change that achieves the same visibility control, and `contextValue` already exists precisely to carry menu-relevant, presentation-layer distinctions that the rest of the code doesn't need to know about.

**Alternative considered — recompute ancestry by walking the model from `jsonPath` at render time**: rejected as unnecessary; `jsonPath[0]` is already the root array key and is cheaper and simpler than re-resolving the model.

### D2: `package.json` `when` clause changes

- `reltio.insertReferenceAttribute`: **remove** `viewItem == reltio.item.relationType` from its `when` clause entirely (it was already redundant — Reference attributes are inserted via the folder/nested-attribute context, not the relation type root, matching the entity-type pattern). Leave `reltio.item.entityType`, `reltio.item.nestedAttribute`, and `reltio.folder.attributesFolder` as-is; these now naturally exclude the relation-type-suffixed variants because the suffixed strings don't match the un-suffixed ones.
- `reltio.insertSimpleAttribute` / `reltio.insertNestedAttribute`: **add** `viewItem == reltio.folder.attributesFolder.relationType` and `viewItem == reltio.item.nestedAttribute.relationType` alongside the existing clauses, so relation-type attribute containers keep showing these two commands.

Style matches the existing explicit-OR pattern already used throughout `contributes.menus` (no regex/`=~` operators are used elsewhere in this file, so none are introduced here).

### D3: Test approach — Tier A only

This is pure presentation logic (`contextValueFor` → a string), fully testable without touching a real tenant. `scripts/test-hide-reference-attribute-for-relation-types.cjs` imports the compiled `dist/tree/treeNodes.js` (via `scripts/lib/import-dist.cjs`, which stubs `vscode`) and constructs `ConfigTreeItem` instances directly with representative `jsonPath` values for both ancestries, asserting `contextValue`. No Tier C (manual) beyond an install + visual context-menu check, since the logic is fully covered by Tier A.

## Risks / Trade-offs

- **[Risk]** A future node type reuses `attributesFolder`/`nestedAttribute` semantics under a third root array (e.g. a hypothetical new top-level attribute-bearing type) and silently inherits the suffix logic incorrectly → **Mitigation**: the check is an explicit `jsonPath[0] === 'relationTypes'` equality, not a blanket "not entityTypes" — it only ever adds the suffix for the one ancestry that needs it, so a new root type is unaffected by default and must opt in explicitly.
- **[Risk]** Someone edits the `insertReferenceAttribute` `when` clause later and re-adds `reltio.item.relationType` without realizing the folder/nested-attribute suffix already handles exclusion, reintroducing the bug at the type-root level → **Mitigation**: the OpenSpec spec's scenario coverage plus the unit test on `contextValueFor` guards the underlying mechanism; the `when` clause itself is declarative config, not independently unit-testable, so this is called out explicitly in the code comment kept minimal at the `contextValueFor` call site.

## Test plan

| Tier | Script / Method | What it covers |
|------|------------------|-----------------|
| A (automated) | `scripts/test-hide-reference-attribute-for-relation-types.cjs` | `contextValueFor` / `ConfigTreeItem.contextValue` returns the `.relationType`-suffixed value for `attributesFolder` and `nestedAttribute` nodes whose `jsonPath[0] === 'relationTypes'`, and the un-suffixed value for every other case (entity type ancestry, and all other node types regardless of `jsonPath`) |
| C (manual QA) | Install packaged `.vsix`; open a tenant L3 with at least one relation type and one entity type; right-click the relation type's `Attributes` folder (and a nested attribute inside it) and confirm **Insert Reference Attribute** is absent while **Insert Simple Attribute** / **Insert Nested Attribute** are present; right-click the equivalent entity-type nodes and confirm all three still show |
