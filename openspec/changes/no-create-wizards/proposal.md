## Why

Tree-driven “add” actions today use **wizards** (`showInputBox`, `showQuickPick`) to collect a name and (for attributes) a type. Reltio configuration is deep and relationship-heavy: almost every object needs a **URI**, **label**, and type-specific fields. Prompts hide the real JSON shape and break flow for modelers who think in **L3**. **Inline skeleton insertion**—paste a **meaningful default object** into `*.reltio.json`, then edit in place with schema validation—is the natural authoring model.

## What Changes

- **No wizards for scoped creates:** Remove blocking dialogs for flows we implement; use **default names** `{Kind}{index}` (e.g. `EntityType1`, `Attribute2`) with collision-safe allocation among siblings.
- **Editor-first:** After insert, focus the tenant L3 document and **reveal/select** the new JSON fragment.
- **Normative create-action matrix** (tree context → allowed inserts → JSON targets → **Row IDs**) lives in **[design.md](design.md)** so implementation, `package.json` **`when`** clauses, and tasks reference one source—no separate checklist file.
- **Tree visibility:** Section folders (Entity Types, Sources, …) appear only when a section is **non-empty** (`getRootChildren`). First insert into an empty section requires **bootstrap** entry points (command palette, editor context on `L3.reltio.json`, optional future virtual root)—not a right-click on a folder that does not exist yet.
- **Product scope (initial):**
  - **Bootstrap** (`BR-01` … `BR-05`): Insert Entity Type, Relation Type, Grouping Type, Graph Type, Source at top level when arrays are empty.
  - **Section folders** (`SF-*`): Typically “insert one more” sibling when the folder is visible (e.g. Entity Types folder → Insert Entity Type only).
  - **Entity type item** (`ET-root`): Insert Simple / Nested / Reference attribute, Match Group, Survivorship Group, attach Cleanse Config—on the **entity type row**, so users are not blocked when Attributes/Match Groups folders are still hidden.
  - **Relation type item** (`RT-root`): Attributes (same shape split as entity), Survivorship Group; endpoints edited in place.
  - **Grouping type item** (`GT-root`): Insert Grouping Member, Insert Attribute Mapping (`GroupingType` remains a leaf in the tree but JSON has `members` / `attributeMappings`).
  - **Later:** Other roots (`groupType`, `graphType` item-level creates, match internals) per **design.md** §7–8; phased after core skeleton + bootstrap land.

## Capabilities

### New Capabilities

- `element-skeleton-insertion`: Configuration-tree and bootstrap creation paths insert typed JSON skeletons with defaulted names, navigate the editor to the new fragment, and avoid modal wizards for mandatory fields on those actions. Behavior is governed by the **normative matrix** in **design.md**.

### Modified Capabilities

- _(None under `openspec/specs/` today; change-local spec only.)_

## Impact

- **`src/commands/editCommands.ts`**, new **`src/commands/elementSkeletons.ts`** (or similar): skeleton builders, naming helpers, no prompts on implemented flows, reveal helper.
- **`src/parser/configParser.ts`** (or adjacent): locate inserted range for `revealRange`.
- **`src/extension.ts`**: Register existing command IDs with new behavior; add **bootstrap** commands for `BR-xx` (palette + editor); optional split commands for ET-root (simple vs nested vs ref attribute, …).
- **`package.json`**: Context menus and **`when`** clauses aligned with matrix Row IDs (`reltio.item.entityType`, `reltio.folder.entityTypesFolder`, …).
- **[design.md](design.md)**: Normative matrix + technical decisions (single product/engineering reference).
- **`ARCHITECTURE.md`**: After implementation, document skeleton creation and bootstrap pattern.
