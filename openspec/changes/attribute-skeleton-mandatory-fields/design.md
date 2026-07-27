## Context

`buildAttributeObject` (`src/commands/elementSkeletons.ts`) is the single pure builder behind all three "Insert <Kind> Attribute" tree commands (Simple, Nested, Reference — see `editCommands.ts` → `insertAttribute`). Today it produces:

```ts
export function buildAttributeObject(
	parentUriPrefix: string,
	label: string,
	kind: AttributeSkeletonKind,
): Record<string, unknown> {
	const uri = `${parentUriPrefix}/attributes/${label}`;
	const base: Record<string, unknown> = { uri, label, type: kind };
	if (kind === 'Nested') {
		base.attributes = [];
	} else if (kind === 'Reference') {
		base.referencedEntityTypeURI = '';
		base.relationshipTypeURI = '';
	}
	return base;
}
```

Per RP-189634 and RP-189645, the Reltio platform UI requires `dataLabelPattern` on Nested attributes and `relationshipLabelPattern` on Reference attributes before the object can be saved from the UI. Both fields are already declared on `Attribute` in `src/model/types.ts` (lines 413-414) and in the `Attribute` `$defs` entry of `schemas/reltio-metadata.schema.json` (lines 517-518) — the builder just never populates them.

This is the same class of fix as the already-merged `skeleton-fixes-and-ux-polish` change (added `dataLabelPattern` to `buildEntityTypeObject`, `graphStructure` to `buildGraphTypeObject`, `abbreviation`/`description`/`icon` to `buildSourceObject`), applied here to the attribute builder.

## Goals / Non-Goals

**Goals:**
- Nested attribute skeletons include `dataLabelPattern: ''`.
- Reference attribute skeletons include `relationshipLabelPattern: ''`.
- Simple (String) attribute skeletons are unchanged.
- Field insertion order matches the order shown in the Jira ticket examples (after the kind-specific fields already present, i.e. `attributes` for Nested; after `referencedEntityTypeURI`/`relationshipTypeURI` for Reference) so the generated JSON reads naturally top-to-bottom.

**Non-Goals:**
- Not fixing the pre-existing bug where `buildAttributeObject` omits the schema-required `name` field for any attribute kind — tracked separately, explicitly deferred by the user in an earlier session.
- Not marking `dataLabelPattern` / `relationshipLabelPattern` as `required` in `schemas/reltio-metadata.schema.json`'s `Attribute` definition — consistent with how `skeleton-fixes-and-ux-polish` handled the analogous `EntityType.dataLabelPattern` (added to the skeleton, not added to that type's `required` array). The field is UI-mandatory on the Reltio platform, not IDE-schema-mandatory.
- Not touching `insertAttribute` in `editCommands.ts` or the command registration/menu wiring — this is a pure skeleton-content change.

## Decisions

### D1: Add fields directly in the existing `kind` branches

Extend the existing `if (kind === 'Nested') { ... } else if (kind === 'Reference') { ... }` branches in `buildAttributeObject` rather than introducing a new field-composition abstraction.

**Alternative considered — a shared "mandatory fields by kind" lookup table**: rejected as over-engineering for two fields on two branches that already exist; would add a layer of indirection without a second caller to justify it.

### D2: No schema `required` change

Matches precedent from `skeleton-fixes-and-ux-polish`: `EntityType.dataLabelPattern`, `GraphType.graphStructure` were added to skeletons without being added to those types' `required` arrays in the schema, because "required in the Reltio UI" and "required by the IDE's own JSON-schema validation" are different concerns — the IDE schema is deliberately permissive so users can still hand-edit partial configs without red squiggles blocking them. The same logic applies to `Attribute.dataLabelPattern` / `relationshipLabelPattern`.

### D3: Test approach — Tier A only

Pure function output — `buildAttributeObject('...', 'Attribute1', 'Nested')` and `buildAttributeObject('...', 'Attribute1', 'Reference')` are asserted directly with `node:assert`, no `vscode` stub needed (this module has no `vscode` import). `scripts/test-attribute-skeleton-mandatory-fields.cjs` covers all three kinds (Simple/Nested/Reference) to also lock in that Simple stays unchanged.

## Risks / Trade-offs

- **[Risk]** A future Reltio UI change adds more mandatory fields for other attribute kinds → **Mitigation**: none needed proactively; this is a narrowly-scoped, easily-extended pair of one-line additions inside existing branches, not a design that resists follow-up fixes.
- **[Risk]** Existing tenants already have Nested/Reference attributes saved without these fields (via the old buggy skeleton) → **Mitigation**: out of scope — this change only affects newly-inserted skeletons, not existing configuration; no migration needed since the field is optional in the schema.

## Test plan

| Tier | Script / Method | What it covers |
|------|------------------|-----------------|
| A (automated) | `scripts/test-attribute-skeleton-mandatory-fields.cjs` | `buildAttributeObject(..., 'Nested')` includes `dataLabelPattern: ''`; `buildAttributeObject(..., 'Reference')` includes `relationshipLabelPattern: ''`; `buildAttributeObject(..., 'String')` is unchanged (no `dataLabelPattern`/`relationshipLabelPattern`) |
| C (manual QA) | Install packaged `.vsix`; insert a Nested Attribute and a Reference Attribute via the tree context menu; confirm the inserted JSON includes `dataLabelPattern` (Nested) or `relationshipLabelPattern` (Reference); open the tenant in the Reltio platform UI (or inspect against the schema) to confirm the field is recognized |
