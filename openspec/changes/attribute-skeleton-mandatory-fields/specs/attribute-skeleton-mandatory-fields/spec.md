## ADDED Requirements

### Requirement: Nested attribute skeletons include dataLabelPattern

When the **Insert Nested Attribute** command inserts a new attribute skeleton, the extension SHALL include a `dataLabelPattern` field (default empty string) in the inserted object, because the Reltio platform UI treats this field as mandatory for Nested attributes.

#### Scenario: Inserted nested attribute includes dataLabelPattern

- **WHEN** the user invokes **Insert Nested Attribute** from the tree
- **THEN** the inserted JSON object SHALL include `"dataLabelPattern": ""` alongside `"type": "Nested"` and `"attributes": []`

### Requirement: Reference attribute skeletons include relationshipLabelPattern

When the **Insert Reference Attribute** command inserts a new attribute skeleton, the extension SHALL include a `relationshipLabelPattern` field (default empty string) in the inserted object, because the Reltio platform UI treats this field as mandatory for Reference attributes.

#### Scenario: Inserted reference attribute includes relationshipLabelPattern

- **WHEN** the user invokes **Insert Reference Attribute** from the tree
- **THEN** the inserted JSON object SHALL include `"relationshipLabelPattern": ""` alongside `"type": "Reference"`, `"referencedEntityTypeURI": ""`, and `"relationshipTypeURI": ""`

### Requirement: Simple attribute skeletons are unaffected

**Insert Simple Attribute** SHALL continue to insert its existing minimal shape (`uri`, `label`, `type: "String"`) without `dataLabelPattern` or `relationshipLabelPattern` — neither field is mandatory in the Reltio UI for simple attributes.

#### Scenario: Inserted simple attribute has no new fields

- **WHEN** the user invokes **Insert Simple Attribute** from the tree
- **THEN** the inserted JSON object SHALL NOT include `dataLabelPattern` or `relationshipLabelPattern`
