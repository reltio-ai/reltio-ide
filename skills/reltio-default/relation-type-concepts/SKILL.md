---
name: reltio-relation-type-concepts
description: Plan Reltio relation types with valid endpoints and consistent naming.
---

# Relation type concepts

Normative product context: `openspec/changes/skills-and-enablement-packs-library/design.md` (D2, D5).

## When to use

The user needs a **new relation type**, or to adjust **start/end** entity constraints, cardinality language, or labels.

## Inputs

1. **`L3.reltio.json`** — current `relationTypes[]` and `entityTypes[]`.
2. Velocity packs under **`.reltio/reltio-agent/velocity-packs/`** for domain relation idioms.
3. Optional **`skills/workspace/relation-type-concepts/SKILL.md`**.

## Procedure

1. **Inventory relations** — URIs, `label`, `startObject` / `endObject` (or equivalent start/end entity type URIs per schema), direction semantics used in the tenant.
2. **Reuse check** — Before adding, search for an existing relation that already links the same pair of entity types with acceptable semantics.
3. **Endpoints** — Ensure start/end URIs reference **existing** `configuration/entityTypes/...` entries. Never leave placeholder URIs that fail Go to Definition.
4. **Naming** — Align verb/noun phrasing with pack examples in the same `vertical` (manifest).
5. **Apply** — Use **Insert Relation Type** (`reltio.addRelationType`) or equivalent structured edit; run validation and fix unresolved URIs reported by the extension.

## Outputs

- Table of proposed relation URI, label, start entity URI, end entity URI.
- Note on bidirectional UI labels if the product uses inverse wording.
