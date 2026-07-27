## Why

Several element skeletons inserted by the extension were missing mandatory fields required by the Reltio UI (causing validation errors on push), and the "Show Ontology" context menu item was appearing on all tree nodes instead of only the relevant folder types. These small gaps cause friction for modelers creating new configuration objects.

## What Changes

- **Entity type skeleton** gains `dataLabelPattern: ''` — this field is mandatory in the Reltio UI when creating a new entity type (RP-189572).
- **Graph type skeleton** gains `graphStructure: ''` — mandatory in the UI when creating a new graph type (RP-189638).
- **Source skeleton** gains `abbreviation`, `description`, and `icon` fields; `label` and `abbreviation` are now marked required in the JSON schema, and `applyL3ConfigurationToTenant` blocks push if any source is missing `uri`, `label`, or `abbreviation` (RP-188095).
- **"Show Ontology" context menu** is scoped to `entityTypesFolder` and `relationTypesFolder` nodes only, removing the spurious entry on all other tree items and folders (RP-188091).

## Capabilities

### New Capabilities

- `element-skeleton-completeness`: Element skeleton builders (`buildEntityTypeObject`, `buildGraphTypeObject`, `buildSourceObject`) produce objects that satisfy the Reltio UI's mandatory-field expectations, and the apply-to-tenant flow validates sources before pushing.
- `ontology-menu-scoping`: The "Show Ontology" tree context menu action is visible only on the Entity Types and Relation Types folder nodes.

### Modified Capabilities

_(None — no existing spec-level requirements are changing.)_

## Impact

- `src/commands/elementSkeletons.ts` — three skeleton builder functions updated
- `src/extension.ts` — source validation guard added before `pushLocalToTenant`
- `schemas/reltio-metadata.schema.json` — `Source` required fields extended to `["uri", "label", "abbreviation"]`
- `package.json` — `showOntologyFromTree` `when` clause narrowed
