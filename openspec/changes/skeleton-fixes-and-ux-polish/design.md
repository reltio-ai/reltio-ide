## Context

The `no-create-wizards` change introduced skeleton builder functions in `src/commands/elementSkeletons.ts`. Those skeletons were written to be minimal; subsequent testing against the live Reltio UI revealed that several mandatory fields were omitted, causing validation failures on push. Separately, the `showOntologyFromTree` command's `when` clause was too broad, causing the context menu entry to appear on every tree item and folder rather than only on the two folder types that make semantic sense for opening the ontology graph.

All fixes are localized — no new dependencies, no architectural changes.

## Goals / Non-Goals

**Goals:**
- Skeleton builders produce objects that pass Reltio UI mandatory-field validation without extra manual edits.
- `showOntologyFromTree` context menu is visible only where it is semantically useful.
- Push-to-tenant is guarded against malformed source objects.

**Non-Goals:**
- Changing the insertion flow or naming strategy introduced by `no-create-wizards`.
- Adding validation guards for entity types, relation types, or other object types beyond sources.
- Updating any walkthroughs or docs beyond `ARCHITECTURE.md`.

## Decisions

**D1 — Add fields to skeletons as empty strings, not nulls or omissions**

Reltio's API rejects missing mandatory fields with a validation error. Setting them to `''` satisfies the schema presence check while clearly signalling to the modeler that the field needs a real value. This is consistent with existing skeleton conventions (`relationshipTypeURIs: []`, `attributes: []`).

**D2 — Validate sources in `applyL3ConfigurationToTenant`, not in the skeleton builder**

Source validation on push catches cases where a source was added manually or edited outside the IDE to remove required fields. The skeleton builder alone cannot protect against post-insertion edits. The guard checks `uri`, `label`, and `abbreviation` — the three fields `Source.required` in the schema.

**D3 — Narrow the `when` clause using explicit folder `viewItem` values**

Using `viewItem == reltio.folder.entityTypesFolder || viewItem == reltio.folder.relationTypesFolder` is more precise than the prior regex `reltio\.(item|folder)\.` and removes the need for runtime filtering. The exact `viewItem` values are already defined by the tree provider and used in other `when` clauses in `package.json`.

## Risks / Trade-offs

- **Empty-string defaults may look odd to experienced users** who expect `null` or absent keys. Mitigation: this is the established pattern for the extension; schema validation will highlight the field immediately.
- **Source validation on apply is a new hard block.** A tenant L3 with pre-existing malformed sources will now be blocked from push. Mitigation: the error message names the offending sources, making the fix actionable.

## Open Questions

_(None — all decisions are resolved.)_
