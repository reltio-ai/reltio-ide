---
name: reltio-attributes-from-concept
description: Suggest attributes from a business concept and existing L3 + Velocity Pack patterns.
---

# Attributes from concept

Normative product context: `openspec/changes/skills-and-enablement-packs-library/design.md` (D5) and capability **`guided-model-elements`**.

## When to use

The user names a concept (e.g. “Policy holder”, “HCP”, “Product SKU”) and wants **simple**, **nested**, or **reference** attributes that fit the tenant.

## Inputs

1. Target **entity or relation type** URI in `L3.reltio.json`.
2. Pack JSON for the industry — **`.reltio/reltio-agent/velocity-packs/<pack>/BusinessConfig.json`** (use manifest `vertical` / `id` to pick).
3. Optional **`skills/workspace/attributes-from-concept/SKILL.md`**.

## Procedure

1. **List existing attributes** on the target type — avoid **name / URI collisions**. Prefer the same casing and abbreviation style as sibling attributes.
2. **Classify each suggestion** — `String`, `Nested`, `Reference` (reference → must point to a real entity type URI).
3. **Pack grounding** — For each high-value attribute, cite a similar attribute or subtree from the chosen pack (path + fragment description). If no pack fit, state “tenant-only convention”.
4. **Reference integrity** — Reference attributes must use `refEntityType` (or tenant’s equivalent) that resolves in the same file.
5. **Apply** — Use tree commands **Insert Simple / Nested / Reference Attribute** (`reltio.insertSimpleAttribute`, etc.) starting from the entity or relation node.

## Outputs

- Table: attribute name, type (simple/nested/ref), rationale, pack reference (if any).
- Ordered apply list respecting dependencies (nested parents before children).
