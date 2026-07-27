## Context

**Current behavior** (`src/commands/editCommands.ts`): `addEntityType` / `addRelationType` and the `insert*` commands insert **JSON skeletons** with default names (`EntityType{n}`, …); **no** `showInputBox` / `showQuickPick` on those flows. Insertion uses `findArrayInsertionPoint`, optional root/array bootstrap, + `WorkspaceEdit.insert`.

**Target behavior:** Replace wizard prompts with **immediate insertion** of typed **JSON skeletons** with default names, then **navigate the editor** to the new fragment. **Where** each insert is allowed is defined by the **normative create-action matrix** below (Row IDs). **[proposal.md](proposal.md)** states motivation and scope summary.

**Constraints:** JSON on disk; `jsonc-parser` paths; validation via `schemas/reltio-metadata.schema.json` and `src/model/types.ts`. Skeletons stay **minimal but meaningful**.

---

## Goals / Non-Goals

**Goals**

- **No blocking dialogs** on implemented create flows—defaults in one step.
- **Default names:** `{Kind}{index}` (see **D1**).
- **Editor-first:** reveal inserted fragment (**D4**).
- **Matrix-aligned UX:** commands + `package.json` **`when`** clauses map to **Row IDs** below (`BR-xx`, `SF-*`, `ET-root`, …).
- **Context menu only:** create actions appear as separate **right‑click** entries (`view/item/context`); do **not** use menu group `inline` (that renders **+** affordances on tree rows). Each matrix action is a **distinct command** (see **D7**).

**Non-Goals**

- Replacing rename/delete confirmations.
- Shipping every matrix row in the first milestone—phase by Row ID.
- Guaranteed schema-perfect L3 on first paste.

---

## Tree visibility and bootstrap

**Observed behavior** (`getRootChildren` in `configSubtree.ts`): a **section folder** appears under the model root only when that section is **non-empty** (array length ≥ 1) or holds a non-null object. With **zero** entity types, there is **no “Entity Types”** node.

**Bootstrap rule:** Inserts targeting an **empty** section must be reachable **without** that folder—e.g. **command palette**, **editor title/context** when `L3.reltio.json` is active, or a future virtual configuration root.

---

## Normative create-action matrix

This section replaces a separate checklist file. **Implementation tasks and code comments should reference Row IDs.**

### How visibility works (current extension)

- **Section folders** (`entityTypesFolder`, `sourcesFolder`, …) appear under the model root **only if** that section already has at least one element (non-empty array) or is a non-null object — see `getRootChildren` in `configSubtree.ts`.

**Bootstrap rule (required for good UX):** Any create that targets an **empty** section must be reachable **without** that folder existing — e.g. **command palette**, **editor title context menu** when `L3.reltio.json` is active, or a **virtual “Configuration” root** row in the tree.

---

### §1 — Bootstrap: model root / L3 document (no tree folder yet)

First insert actions — they create `entityTypes[0]`, `sources[0]`, etc., and **then** the corresponding folder appears.

| Row ID | Permitted create action (product name) | Target JSON (append first element) | Notes |
|--------|----------------------------------------|-----------------------------------|-------|
| BR-01 | Insert **Entity Type** | `entityTypes[]` | After insert, **Entity Types** folder appears. |
| BR-02 | Insert **Relation Type** | `relationTypes[]` | |
| BR-03 | Insert **Grouping Type** | `groupingTypes[]` | `GroupingType` needs `members` etc. — skeleton per **D5**. |
| BR-04 | Insert **Graph Type** | `graphTypes[]` | |
| BR-05 | Insert **Source** | `sources[]` | |
| BR-06 | Insert **Hierarchy Type** | `hierarchyTypes[]` | Implemented in `insert-hierarchy-type` follow-up (RP-189635). |
| BR-07 | Insert **Interaction Type** | `interactionTypes[]` | Implemented in `insert-interaction-type` follow-up (RP-189637). |

Other top-level sections stay out until product adds a `BR-xx` row here.

---

### §2 — Section collection folders (when the folder is visible)

When `… / Entity Types (n)` exists, the folder represents **only** that collection. Typical rule: **one** action — “add another element of the same kind.”

| Row ID | Tree path (example) | `nodeType` / `viewItem` | When visible | Permitted create actions | Target array |
|--------|---------------------|-------------------------|--------------|---------------------------|--------------|
| SF-entityTypes | `… / Entity Types (n)` | `reltio.folder.entityTypesFolder` | `entityTypes.length ≥ 1` | **Insert Entity Type** (only) | `entityTypes[]` |
| SF-relationTypes | `… / Relation Types (n)` | `reltio.folder.relationTypesFolder` | `relationTypes.length ≥ 1` | *TBD* — suggest: **Insert Relation Type** only | `relationTypes[]` |
| SF-groupingTypes | `… / Grouping Types (n)` | `reltio.folder.groupingTypesFolder` | `groupingTypes.length ≥ 1` | *TBD* | `groupingTypes[]` |
| SF-graphTypes | `… / Graph Types (n)` | `reltio.folder.graphTypesFolder` | `graphTypes.length ≥ 1` | *TBD* | `graphTypes[]` |
| SF-sources | `… / Sources (n)` | `reltio.folder.sourcesFolder` | `sources.length ≥ 1` | *TBD* — suggest: **Insert Source** only | `sources[]` |
| SF-attributeTypes | `… / Attribute Types (n)` | `reltio.folder.attributeTypesFolder` | non-empty | *TBD* | `attributeTypes[]` |
| SF-interactionTypes | `… / Interaction Types (n)` | `reltio.folder.interactionTypesFolder` | non-empty | **Insert Interaction Type** (only) | `interactionTypes[]` |
| SF-groupTypes | `… / Group Types (n)` | `reltio.folder.groupTypesFolder` | non-empty | *TBD* | `groupTypes[]` |
| SF-categoryTypes | `… / Category Types (n)` | `reltio.folder.categoryTypesFolder` | non-empty | *TBD* | `categoryTypes[]` |
| SF-hierarchyTypes | `… / Hierarchy Types (n)` | `reltio.folder.hierarchyTypesFolder` | non-empty | **Insert Hierarchy Type** (only) | `hierarchyTypes[]` |
| SF-changeRequestTypes | `… / Change Request Types (n)` | `reltio.folder.changeRequestTypesFolder` | non-empty | *TBD* | `changeRequestTypes[]` |
| SF-roles | `… / Roles (n)` | `reltio.folder.rolesFolder` | non-empty | *TBD* | `roles[]` |
| SF-matchActions | `… / Match Actions (n)` | `reltio.folder.matchActionsFolder` | non-empty | *TBD* | `matchActions[]` |
| SF-survivorshipStrategies | `… / Survivorship Strategies (n)` | `reltio.folder.survivorshipStrategiesFolder` | non-empty | *TBD* | `survivorshipStrategies[]` |
| SF-ratings | `… / Ratings (n)` | `reltio.folder.ratingsFolder` | non-empty | *TBD* | `ratings[]` |

---

### §3 — Entity type instance (`… / Entity Types / <EntityTypeName>`)

On the **entity type item** node, expose creates for children even when child folders are still hidden.

| Row ID | Tree path | `nodeType` / `viewItem` | When visible | Permitted create actions | Typical target JSON |
|--------|-----------|-------------------------|--------------|---------------------------|---------------------|
| ET-root | `… / Entity Types / <Name>` | `reltio.item.entityType` | entity exists | **Insert Simple Attribute** (`type: String`) | `entityTypes[i].attributes[]` |
| ET-root | *(same)* | *(same)* | *(same)* | **Insert Nested Attribute** (`type: Nested`, `attributes: []`) | same array |
| ET-root | *(same)* | *(same)* | *(same)* | **Insert Reference Attribute** (`type: Reference`, empty URIs) | same array |
| ET-root | *(same)* | *(same)* | *(same)* | **Insert Match Group** | `entityTypes[i].matchGroups[]` |
| ET-root | *(same)* | *(same)* | *(same)* | **Insert Survivorship Group** | `entityTypes[i].survivorshipGroups[]` |
| ET-root | *(same)* | *(same)* | *(same)* | **Insert / attach Cleanse Config** | `entityTypes[i].cleanseConfig` (object — merge vs replace per **D5**) |

Today **Add Attribute** is registered on `attributesFolder`; matrix expects commands on **`reltio.item.entityType`** as well.

---

### §4 — Subfolders under an entity type (optional refinement)

| Row ID | Tree path | `nodeType` | When visible | Permitted create actions | Target |
|--------|-----------|------------|--------------|---------------------------|--------|
| ET-attrFolder | `… / <EntityName> / Attributes (n)` | `reltio.folder.attributesFolder` | `attributes.length ≥ 1` | Optional duplicates of §3 or empty | `attributes[]` |
| ET-mgFolder | `… / <EntityName> / Match Groups (n)` | `reltio.folder.matchGroupsFolder` | non-empty | *TBD* | `matchGroups[]` |
| ET-sgFolder | `… / <EntityName> / Survivorship Groups (n)` | `reltio.folder.survivorshipGroupsFolder` | non-empty | *TBD* | `survivorshipGroups[]` |

---

### §5 — Relation type instance

| Row ID | Tree path | `nodeType` | Permitted create actions | Target JSON |
|--------|-----------|------------|---------------------------|-------------|
| RT-root | `… / Relation Types / <Name>` | `reltio.item.relationType` | Insert Attribute (simple/nested only — no reference; RP-189643) | `relationTypes[i].attributes[]` |
| RT-root | *(same)* | *(same)* | Insert Survivorship Group | `relationTypes[i].survivorshipGroups[]` |
| RT-root | *(same)* | *(same)* | *(endpoints edited in place)* | `startObject` / `endObject` |

---

### §6 — Grouping type instance

`GroupingType` requires `uri`, `entityType`, and non-empty **`members`** (`GroupingMember`: `entityType`, `relationType`, `groupingRule`). Optional **`attributeMappings`**. Tree shows grouping types as **leaves**; JSON appends still apply.

| Row ID | Tree path | `nodeType` / `viewItem` | When visible | Permitted create actions | Target JSON |
|--------|-----------|-------------------------|--------------|---------------------------|-------------|
| GT-root | `… / Grouping Types / <Name>` | `reltio.item.groupingType` | item exists | **Insert Grouping Member** (placeholder strings for user to fill) | `groupingTypes[i].members[]` |
| GT-root | *(same)* | *(same)* | *(same)* | **Insert Attribute Mapping** | `groupingTypes[i].attributeMappings[]` (create array on first insert if missing) |

First grouping type: **§1** `BR-03` or **§2** `SF-groupingTypes` when folder exists.

---

### §7 — Other definition roots

| Row ID | Tree path | `nodeType` | Permitted create actions | Notes |
|--------|-----------|------------|---------------------------|-------|
| *TBD* | `… / Group Types / <Name>` | `reltio.item.groupType` | *none* | Attributes + survivorship folders |
| *TBD* | `… / Sources / <label>` | `reltio.item.source` | usually none (leaf) | |
| *TBD* | `… / Graph Types / <Name>` | `reltio.item.graphType` | *none* | |

---

### §8 — Match / survivorship internals (lower priority)

| Row ID | Tree path | `nodeType` | Permitted create actions |
|--------|-----------|------------|---------------------------|
| *TBD* | `… / Match Groups / <Name>` | `reltio.item.matchGroup` | *none* |
| *TBD* | `… / Survivorship Groups / <Name>` | `reltio.item.survivorshipGroup` | *none* |

---

### Matrix summary

| § | Topic | Row ID prefix |
|---|--------|----------------|
| §1 | Bootstrap | `BR-xx` |
| §2 | Section folders | `SF-*` |
| §3 | Entity type item | `ET-root` |
| §4 | Entity-type subfolders | `ET-*Folder` |
| §5 | Relation type item | `RT-root` |
| §6 | Grouping type item | `GT-root` |
| §7–8 | Other / internals | `TBD` |

---

## Technical decisions

### D1: Default naming and uniqueness

Base **label** and URI **final segment** on **kind + integer**. Scan sibling array in model/AST; match `^{Kind}(\d+)$`; use **max(n)+1** or `1`; resolve collisions.

### D2: No wizard inputs on scoped creates

No `showInputBox` / `showQuickPick` for flows covered by an implemented matrix row.

### D3: Default scalar attribute type

Default **`type`: `"String"`** unless the row specifies Nested/Reference skeletons.

### D4: Editor navigation after insert

After `applyEdit`: `showTextDocument`, re-parse, `findNodeAtPath` or fallback, `selection` + `revealRange(..., InCenter)`.

### D5: Skeleton shapes (minimal JSON)

URI pattern `configuration/.../{Label}`; relation types: `startObject` / `endObject` placeholders; entity types: `attributes: []` where applicable.

**Matrix-driven builders:** Each matrix row maps to a builder branch. **GroupingType:** initial insert may need minimal valid `members` entry. **Cleanse config:** prefer merge-if-absent. Field shapes follow **`src/model/types.ts`**.

### D6: Module layout

- **`editCommands.ts`** — handlers; **`elementSkeletons.ts`** — pure builders keyed by Row ID / `(kind, parentPath)`.
- **`extension.ts`** + **`package.json`** — `when` aligned with matrix `viewItem`s; palette for `BR-xx`.

### D7: Commands vs matrix rows

| Kind | Example Row IDs | Registration surface |
|------|-----------------|------------------------|
| Bootstrap | `BR-01` … `BR-05` | Palette + editor context |
| Section folder | `SF-*` | `viewItem` folder matchers |
| Parent item | `ET-root`, `RT-root`, `GT-root` | `reltio.item.*` |

Prefer **distinct command IDs** per insert type where menus would otherwise be ambiguous.

---

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Invalid JSON until edited | Schema diagnostics; sample L3 smoke tests |
| Bootstrap resolves wrong tenant | Resolve `tenantL3Uri` from editor path or selection |
| `GroupingType` needs `members` | Placeholder member in skeleton |
| Reveal fails | Re-parse; substring fallback |
| Empty attribute folders hidden | §3 commands on **entity type item** |

---

## Migration Plan

1. Ship skeleton + no prompts per phased Row IDs.
2. Keep command IDs where replacing wizard; add bootstrap commands.
3. Rollback: revert edit commands + skeleton module.

---

## Open Questions

- Setting **`reltio.defaultNewAttributeType`** vs fixed `String`.
- **Cleanse config:** merge-if-absent vs replace.
- Which **`SF-*` / §7–8** rows ship after core ET/RT/attribute/bootstrap — update **§2 / §7** tables in this file when decided.

---

## Document precedence

| Document | Role |
|----------|------|
| **[proposal.md](proposal.md)** | Motivation, scope summary, capabilities |
| **[design.md](design.md)** (this file) | **Normative matrix**, Row IDs, D1–D7, risks |
