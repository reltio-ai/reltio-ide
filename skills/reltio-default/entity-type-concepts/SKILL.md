---
name: reltio-entity-type-concepts
description: Plan and add Reltio entity types using current L3, inheritance, and Velocity Pack idioms.
---

# Entity type concepts

Normative product context: `openspec/changes/skills-and-enablement-packs-library/design.md` (D2, D5).

## When to use

The user wants a **new entity type**, to **extend** an existing abstract type, or to **rename / consolidate** URI and label choices.

## Inputs

1. Active tenant **`L3.reltio.json`** (or whichever `*.reltio.json` is the business configuration).
2. After extension sync: **`.reltio/reltio-agent/velocity-packs/manifest.json`** and pack JSON under `.reltio/reltio-agent/velocity-packs/` (search by vertical / entity naming patterns).
3. Optional team overrides: **`skills/workspace/entity-type-concepts/SKILL.md`**.

## Procedure

1. **Inventory** — List `entityTypes[]` with `uri`, `label`, `abstract`, `extendsTypeURI` / `extendsFrom` (whichever the file uses). Note consolidated vs source-specific patterns.
2. **Intent** — Classify: net-new type vs subtype of an existing abstract vs split/merge. Prefer **reuse** of existing abstract parents before inventing a parallel hierarchy.
3. **URI and label** — Propose `configuration/entityTypes/<Name>` style URIs consistent with the tenant. Check **collisions** with `UriIndex` mentally: no duplicate URIs; labels unique enough for authors.
4. **Ground in packs** — For the same industry (see manifest `vertical`), grep pack `BusinessConfig.json` for similar entities (e.g. Individual, Organization). Mirror **attribute grouping** and **match/survivorship** presence, not necessarily full copy-paste.
5. **Apply** — Use the editor / tree command **Insert Entity Type** (`reltio.addEntityType`) or a structured `WorkspaceEdit` so inserted JSON matches project conventions. Reveal the insertion and confirm schema validation passes.
6. **Ontology** — If relationships will change, open **Reltio: Show Ontology Preview** to sanity-check graph impact after edits.

## Outputs

- Short plan: proposed URIs, parent type, key attributes to add next (pointer to `attributes-from-concept`).
- Patches or command sequence the user can approve.
