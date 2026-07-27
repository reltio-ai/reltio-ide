## Why

RP-189643: **Insert Reference Attribute** currently shows on the context menu for relation-type attribute containers (the relation type item itself, its `Attributes` folder, and any nested attribute inside it), but Reference attributes reference an entity/relation type from a **relation type's own attribute tree** and are not a supported combination in practice. Snehil confirmed on the ticket that only **Insert Reference Attribute** should be hidden for relation types — **Insert Simple Attribute** and **Insert Nested Attribute** must stay visible. This also resolves the open "same split as entity?" question left in `openspec/changes/no-create-wizards/design.md` (RT-root row) and `element-candidates.md` (RT-root row).

## What Changes

- `reltio.insertReferenceAttribute` no longer appears in the context menu when the target attribute container (relation type item, its `Attributes` folder, or a nested attribute) descends from `relationTypes[]`.
- `reltio.insertSimpleAttribute` and `reltio.insertNestedAttribute` continue to appear for both entity types and relation types — no behavior change for these two commands.
- `ConfigTreeItem`'s `contextValue` becomes ancestor-aware for `attributesFolder` and `nestedAttribute` node types: when the node's `jsonPath` root key is `relationTypes`, the extension appends a `.relationType` suffix so `package.json` `when` clauses can distinguish the two ancestries without changing any other node's `contextValue`.
- No JSON schema, skeleton-builder, or command-handler changes — this is purely a context-menu visibility fix.

## Capabilities

### New Capabilities

- `attribute-menu-visibility`: rules for which "Insert <Kind> Attribute" commands appear on the configuration tree context menu depending on the ancestor container (entity type vs. relation type).

### Modified Capabilities

_None._ (`no-create-wizards` / `element-skeleton-insertion` covers skeleton shape, not menu visibility, and is not being changed.)

## Impact

- `src/tree/treeNodes.ts` — `contextValueFor` becomes path-aware.
- `package.json` — `when` clauses for `reltio.insertSimpleAttribute`, `reltio.insertNestedAttribute`, `reltio.insertReferenceAttribute`.
- `openspec/changes/no-create-wizards/design.md` and `element-candidates.md` — resolve the RT-root "same split as entity?" open question.
- `ARCHITECTURE.md` — no new command, so only the existing context-menu convention note needs a one-line cross-reference (if any).
- New test script `scripts/test-hide-reference-attribute-for-relation-types.cjs`, registered in `scripts/run-unit-tests.cjs`.
