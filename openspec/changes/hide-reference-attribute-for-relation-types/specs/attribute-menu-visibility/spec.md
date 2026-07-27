## ADDED Requirements

### Requirement: Insert Reference Attribute is hidden for relation-type attribute containers

For any configuration tree node whose attribute container descends from `relationTypes[]` — the relation type item, its `Attributes` folder, or a nested attribute at any depth inside it — the extension SHALL **not** show **Insert Reference Attribute** in the context menu.

#### Scenario: Reference Attribute absent on a relation type's Attributes folder

- **WHEN** the user right-clicks the `Attributes` folder under a relation type in the configuration tree
- **THEN** the context menu SHALL **not** include **Insert Reference Attribute**

#### Scenario: Reference Attribute absent on a nested attribute inside a relation type

- **WHEN** the user right-clicks a nested attribute that is itself nested inside a relation type's attribute tree
- **THEN** the context menu SHALL **not** include **Insert Reference Attribute**

### Requirement: Insert Simple Attribute and Insert Nested Attribute remain visible for relation types

For the same relation-type attribute containers described above, the extension SHALL continue to show **Insert Simple Attribute** and **Insert Nested Attribute** in the context menu, unchanged from current behavior.

#### Scenario: Simple and Nested Attribute still offered on a relation type's Attributes folder

- **WHEN** the user right-clicks the `Attributes` folder under a relation type in the configuration tree
- **THEN** the context menu SHALL include both **Insert Simple Attribute** and **Insert Nested Attribute**

### Requirement: Entity-type attribute containers are unaffected

For entity-type attribute containers — the entity type item, its `Attributes` folder, or any nested attribute inside it — all three commands (**Insert Simple Attribute**, **Insert Nested Attribute**, **Insert Reference Attribute**) SHALL continue to appear in the context menu, exactly as before this change.

#### Scenario: All three attribute commands still offered on an entity type's Attributes folder

- **WHEN** the user right-clicks the `Attributes` folder under an entity type in the configuration tree
- **THEN** the context menu SHALL include **Insert Simple Attribute**, **Insert Nested Attribute**, and **Insert Reference Attribute**
