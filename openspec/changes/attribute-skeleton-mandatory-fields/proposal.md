## Why

RP-189634 and RP-189645: inserting a **Nested Attribute** or **Reference Attribute** via the tree's "Insert <Kind> Attribute" commands produces a skeleton that is missing a field the Reltio platform UI treats as mandatory:

- **Nested attributes** are inserted without `dataLabelPattern`, so the attribute cannot be saved from the Reltio UI until the user manually adds it.
- **Reference attributes** are inserted without `relationshipLabelPattern`, for the same reason.

Both fields already exist in `Attribute` (`src/model/types.ts`) and `schemas/reltio-metadata.schema.json` — they're simply never written by `buildAttributeObject`. This mirrors the fix already shipped for `buildEntityTypeObject` (`dataLabelPattern`), `buildGraphTypeObject` (`graphStructure`), and `buildSourceObject` (`abbreviation`/`description`/`icon`) in the merged `skeleton-fixes-and-ux-polish` change — this change closes the same gap for the attribute skeleton builder.

## What Changes

- `buildAttributeObject` (`src/commands/elementSkeletons.ts`) includes `dataLabelPattern: ''` in the skeleton when `kind === 'Nested'`.
- `buildAttributeObject` includes `relationshipLabelPattern: ''` in the skeleton when `kind === 'Reference'`.
- `String` (simple) attribute skeletons are unchanged — the Reltio UI does not require either field for simple attributes.
- No schema or type changes needed — `dataLabelPattern` and `relationshipLabelPattern` are already declared on `Attribute` in both `src/model/types.ts` and `schemas/reltio-metadata.schema.json`; only the skeleton builder needs to populate them.

## Capabilities

### New Capabilities

- `attribute-skeleton-mandatory-fields`: rules for which mandatory-in-UI fields the "Insert <Kind> Attribute" skeleton builders must include, per attribute kind.

### Modified Capabilities

_None._ (`no-create-wizards` / `element-skeleton-insertion` covers the general "insert without wizard" behavior and default scalar type; this change only adds fields to the already-specified Nested/Reference minimal shapes, so it's additive rather than a behavior change to that capability's existing requirements.)

## Impact

- `src/commands/elementSkeletons.ts` — `buildAttributeObject`.
- New test script `scripts/test-attribute-skeleton-mandatory-fields.cjs`, registered in `scripts/run-unit-tests.cjs`.
- No changes to `src/model/types.ts` or `schemas/reltio-metadata.schema.json` (fields already present).
