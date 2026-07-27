# Tree create-action matrix (product + implementation spec)

This document is **not** an XSD inventory. It defines **where** in the configuration tree each **create** action is allowed, so you can:

1. Decide **per tree context** which inserts exist (edit the **Permitted create actions** column).
2. Align implementation: commands + `when` clauses + skeleton builders map to these rows.

---

## How visibility works (current extension)

- **Section folders** (`entityTypesFolder`, `sourcesFolder`, …) appear under the model root **only if** that section already has at least one element (non-empty array) or is a non-null object — see `getRootChildren` in `configSubtree.ts`. So **there is no “Entity Types” node when there are zero entity types.**

**Bootstrap rule (required for good UX):** Any create that targets an **empty** section must be reachable **without** that folder existing — e.g. **command palette**, **editor title context menu** when `L3.reltio.json` is active, or a **virtual “Configuration” root** row in the tree. Implementation belongs in `no-create-wizards` / follow-up tasks; this file only records **which** sections get bootstrap entries.

---

## 1 — Bootstrap: model root / L3 document (no tree folder yet)

Use this subsection to list **first insert** actions — they create `entityTypes[0]`, `sources[0]`, etc., and **then** the corresponding folder appears.

**Your stated subset at true model level:**


| Row ID | Permitted create action (product name) | Target JSON (append first element) | Notes                                                           |
| ------ | -------------------------------------- | ---------------------------------- | --------------------------------------------------------------- |
| BR-01  | Insert **Entity Type**                 | `entityTypes[]`                    | After insert, **Entity Types** folder appears.                  |
| BR-02  | Insert **Relation Type**               | `relationTypes[]`                  |                                                                 |
| BR-03  | Insert **Grouping Type**               | `groupingTypes[]`                  | `GroupingType` needs `members` etc. — skeleton design separate. |
| BR-04  | Insert **Graph Type**                  | `graphTypes[]`                     |                                                                 |
| BR-05  | Insert **Source**                      | `sources[]`                        |                                                                 |
| BR-06  | Insert **Hierarchy Type**              | `hierarchyTypes[]`                 |                                                                 |
| BR-07  | Insert **Interaction Type**            | `interactionTypes[]`               |                                                                 |


*Add or remove rows here.* Other top-level sections (attribute types, roles, …) are **intentionally omitted** until you add a BR-xx row.

---

## 2 — Section collection folders (when the folder is visible)

When `… / Entity Types (n)` exists, the folder represents **only** that collection. Typical rule: **one** action — “add another element of the same kind.”


| Row ID                    | Tree path (example)               | `nodeType` / `viewItem`                      | When visible               | Permitted create actions       | Target array               |
| ------------------------- | --------------------------------- | -------------------------------------------- | -------------------------- | ------------------------------ | -------------------------- |
| SF-entityTypes            | `… / Entity Types (n)`            | `reltio.folder.entityTypesFolder`            | `entityTypes.length ≥ 1`   | **Insert Entity Type** (only)  | `entityTypes[]`            |
| SF-relationTypes          | `… / Relation Types (n)`          | `reltio.folder.relationTypesFolder`          | `relationTypes.length ≥ 1` | **Insert Relation Type** only  | `relationTypes[]`          |
| SF-groupingTypes          | `… / Grouping Types (n)`          | `reltio.folder.groupingTypesFolder`          | `groupingTypes.length ≥ 1` | *Insert grouping type only*    | `groupingTypes[]`          |
| SF-graphTypes             | `… / Graph Types (n)`             | `reltio.folder.graphTypesFolder`             | `graphTypes.length ≥ 1`    | *nonr*                         | `graphTypes[]`             |
| SF-sources                | `… / Sources (n)`                 | `reltio.folder.sourcesFolder`                | `sources.length ≥ 1`       | **Insert Source**              | `sources[]`                |
| SF-attributeTypes         | `… / Attribute Types (n)`         | `reltio.folder.attributeTypesFolder`         | non-empty                  | *none*                         | `attributeTypes[]`         |
| SF-interactionTypes       | `… / Interaction Types (n)`       | `reltio.folder.interactionTypesFolder`       | non-empty                  | **Insert Interaction Type** (only) | `interactionTypes[]`       |
| SF-groupTypes             | `… / Group Types (n)`             | `reltio.folder.groupTypesFolder`             | non-empty                  | *none*                         | `groupTypes[]`             |
| SF-categoryTypes          | `… / Category Types (n)`          | `reltio.folder.categoryTypesFolder`          | non-empty                  | *none*                         | `categoryTypes[]`          |
| SF-hierarchyTypes         | `… / Hierarchy Types (n)`         | `reltio.folder.hierarchyTypesFolder`         | non-empty                  | **Insert Hierarchy Type** (only) | `hierarchyTypes[]`         |
| SF-changeRequestTypes     | `… / Change Request Types (n)`    | `reltio.folder.changeRequestTypesFolder`     | non-empty                  | *none*                         | `changeRequestTypes[]`     |
| SF-roles                  | `… / Roles (n)`                   | `reltio.folder.rolesFolder`                  | non-empty                  | *none*                         | `roles[]`                  |
| SF-matchActions           | `… / Match Actions (n)`           | `reltio.folder.matchActionsFolder`           | non-empty                  | *none*                         | `matchActions[]`           |
| SF-survivorshipStrategies | `… / Survivorship Strategies (n)` | `reltio.folder.survivorshipStrategiesFolder` | non-empty                  | *none*                         | `survivorshipStrategies[]` |
| SF-ratings                | `… / Ratings (n)`                 | `reltio.folder.ratingsFolder`                | non-empty                  | *none*                         | `ratings[]`                |


---

## 3 — Entity type instance (`… / Entity Types / <EntityTypeName>`)

**Your rule:** On the **entity type item** node (not only under subfolders), expose creates for children that make sense before those child folders exist.


| Row ID  | Tree path                   | `nodeType` / `viewItem`  | When visible  | Permitted create actions                                                         | Typical target JSON                                                                           |
| ------- | --------------------------- | ------------------------ | ------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| ET-root | `… / Entity Types / <Name>` | `reltio.item.entityType` | entity exists | **Insert Simple Attribute** → `attributes[]` (`type: String`)                    | `entityTypes[i].attributes[]`                                                                 |
| ET-root | *(same row)*                | *(same)*                 | *(same)*      | **Insert Nested Attribute** → nested shell (`type: Nested`, `attributes: []`)    | same array                                                                                    |
| ET-root | *(same row)*                | *(same)*                 | *(same)*      | **Insert Reference Attribute** → reference shell (`type: Reference`, empty URIs) | same array                                                                                    |
| ET-root | *(same row)*                | *(same)*                 | *(same)*      | **Insert Match Group**                                                           | `entityTypes[i].matchGroups[]`                                                                |
| ET-root | *(same row)*                | *(same)*                 | *(same)*      | **Insert Survivorship Group**                                                    | `entityTypes[i].survivorshipGroups[]`                                                         |
| ET-root | *(same row)*                | *(same)*                 | *(same)*      | **Insert / attach Cleanse Config**                                               | `entityTypes[i].cleanseConfig` (object, not array — **replace or merge** semantics in design) |


Implementation note: Today **Add Attribute** is registered on `attributesFolder` and entity type items may not expose all actions; moving commands to `**entityType`** context matches this table.

---

## 4 — Subfolders under an entity type (optional refinement)

If you still want actions **only** when the user expands **Attributes (n)** etc., add rows here. Otherwise leave empty and use **§3** only.


| Row ID        | Tree path                                    | `nodeType`                               | When visible            | Permitted create actions                   | Target                 |
| ------------- | -------------------------------------------- | ---------------------------------------- | ----------------------- | ------------------------------------------ | ---------------------- |
| ET-attrFolder | `… / <EntityName> / Attributes (n)`          | `reltio.folder.attributesFolder`         | `attributes.length ≥ 1` | *optional duplicates of §3 or leave empty* | `attributes[]`         |
| ET-mgFolder   | `… / <EntityName> / Match Groups (n)`        | `reltio.folder.matchGroupsFolder`        | non-empty               | *Insert match group only*                  | `matchGroups[]`        |
| ET-sgFolder   | `… / <EntityName> / Survivorship Groups (n)` | `reltio.folder.survivorshipGroupsFolder` | non-empty               | *insert survivorship group only*           | `survivorshipGroups[]` |
| …             | …                                            | …                                        | …                       | …                                          | …                      |


---

## 5 — Relation type instance


| Row ID  | Tree path                     | `nodeType`                 | Permitted create actions (draft — edit)                            | Target JSON                             |
| ------- | ----------------------------- | -------------------------- | ------------------------------------------------------------------ | --------------------------------------- |
| RT-root | `… / Relation Types / <Name>` | `reltio.item.relationType` | Insert Attribute (simple/nested only — no reference; RP-189643) | `relationTypes[i].attributes[]`         |
| RT-root | *(same)*                      | *(same)*                   | Insert Survivorship Group                                          | `relationTypes[i].survivorshipGroups[]` |
| RT-root | *(same)*                      | *(same)*                   | *(endpoints are edited in place, not “insert” rows)*               | `startObject` / `endObject`             |


---

## 6 — Grouping type instance

`GroupingType` (`src/model/types.ts`) requires `uri`, `entityType`, and a non-empty `**members`** array (`GroupingMember`: `entityType`, `relationType`, `groupingRule` strings). Optional `**attributeMappings**` lists `GroupingAttributeMapping` entries. The tree today shows grouping types as **leaves** under `… / Grouping Types` (no subfolders in `configSubtree`); create actions on the item still **append** into child arrays in JSON.


| Row ID  | Tree path                     | `nodeType` / `viewItem`    | When visible | Permitted create actions (edit)                                                                                            | Target JSON                                                                      |
| ------- | ----------------------------- | -------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| GT-root | `… / Grouping Types / <Name>` | `reltio.item.groupingType` | item exists  | **Insert Grouping Member** (skeleton with empty/placeholder `entityType`, `relationType`, `groupingRule` for user to fill) | `groupingTypes[i].members[]`                                                     |
| GT-root | *(same)*                      | *(same)*                   | *(same)*     | **Insert Attribute Mapping**                                                                                               | `groupingTypes[i].attributeMappings[]` (create array on first insert if missing) |


**Bootstrap** for the first grouping type is **§1** `BR-03` (or duplicate insert from **§2** `SF-groupingTypes` when the folder is already visible).

---

## 7 — Other definition roots (fill as needed)

Use the same columns: **path pattern**, `**nodeType`**, **Permitted create actions**, **target**.

Examples to complete later: **group type**, **interaction type**, **category type**, **graph type**, **source** item nodes.


| Row ID | Tree path                  | `nodeType`              | Permitted create actions | Notes                                 |
| ------ | -------------------------- | ----------------------- | ------------------------ | ------------------------------------- |
| *TBD*  | `… / Group Types / <Name>` | `reltio.item.groupType` | *none*                   | Has attributes + survivorship folders |
| *TBD*  | `… / Sources / <label>`    | `reltio.item.source`    | usually none (leaf)      |                                       |
| *TBD*  | `… / Graph Types / <Name>` | `reltio.item.graphType` | *none*                   |                                       |


---

## 8 — Match / survivorship internals (usually lower priority)

Only list if you want **tree-driven insert** on `matchGroup`, `survivorshipGroup`, `matchRule`, etc.


| Row ID | Tree path                          | `nodeType`                      | Permitted create actions |
| ------ | ---------------------------------- | ------------------------------- | ------------------------ |
| *TBD*  | `… / Match Groups / <Name>`        | `reltio.item.matchGroup`        | *no actions*             |
| *TBD*  | `… / Survivorship Groups / <Name>` | `reltio.item.survivorshipGroup` | *no actions*             |


---

## Summary

- **§1** = what can be created **before** any section folder exists (bootstrap).
- **§2** = what each **visible section folder** may do (usually **only** “add one more” of that section’s element type).
- **§3** = your **entity type instance** creates (simple/nested/ref attribute, match group, survivorship group, cleanse config).
- **§4** = optional entity-type **subfolders** only.
- **§5** = **relation type** instance.
- **§6** = **grouping type** instance (`members`, `attributeMappings`).
- **§7–8** = other definition roots and match/survivorship internals — extend the same pattern.

Edit markdown tables directly in this file; implementation tasks should reference **Row IDs** (e.g. `BR-01`, `ET-root`, `SF-entityTypes`).