---
name: reltio-match-groups-from-concept
description: Draft match group ideas aligned with entity semantics and tenant match style.
---

# Match groups from concept

Normative product context: `openspec/changes/skills-and-enablement-packs-library/design.md` (D2, D5).

## When to use

The user wants **match / survivorship** behavior for an entity type (new or evolving).

## Inputs

1. Target **entity type** and its attributes (especially identifiers used in match rules).
2. Existing **`matchGroups`** on that type and pack examples under **`.reltio/reltio-agent/velocity-packs/`**.
3. Optional **`skills/workspace/match-groups-from-concept/SKILL.md`**.

## Procedure

1. **Survey current rules** — Do not duplicate URI of an existing `matchGroups` entry; extend or replace deliberately.
2. **Attribute URI check** — Every comparator must reference **real** `configuration/entityTypes/.../attributes/...` paths present on the type (or inherited per tenant rules).
3. **Placeholders** — Start from small rule sets (e.g. email + name) and iterate; call out **false-positive** risks for the domain.
4. **Apply** — Use **Insert Match Group** (`reltio.insertMatchGroup`) from the entity type row in the Configuration tree, then refine JSON.
5. **Link survivorship** — If match changes consolidation, point the user to survivorship inserts (`reltio.insertSurvivorshipGroup`) as a follow-up.

## Outputs

- Proposed `matchGroups` URI(s), comparator list, and which attributes must exist first.
