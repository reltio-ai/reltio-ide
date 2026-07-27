## ADDED Requirements

### Requirement: Tree create actions insert skeletons without wizard prompts

For **Add Entity Type**, **Add Relation Type**, and **Add Attribute** commands driven from the configuration tree, the extension SHALL **not** use modal dialogs (`showInputBox`, `showQuickPick`, or equivalent) to collect mandatory identity fields before insertion. The extension SHALL compute default names and insert JSON in one step.

#### Scenario: Add entity type does not prompt for name

- **WHEN** the user invokes **Add Entity Type** from the tree (same command id as today)
- **THEN** the extension SHALL insert a new entity type object without opening an input box for the name first

#### Scenario: Add relation type does not prompt for name

- **WHEN** the user invokes **Add Relation Type** from the tree
- **THEN** the extension SHALL insert a new relation type object without opening an input box for the name first

#### Scenario: Add attribute does not prompt for name or type

- **WHEN** the user invokes **Add Attribute** from the tree
- **THEN** the extension SHALL insert a new attribute object without opening an input box or quick-pick for name or attribute type first

### Requirement: Default names use kind prefix and unique index

Default **`label`** and URI **final segment** for inserted objects SHALL follow `{Kind}{positiveInteger}` patterns as specified in design (e.g. `EntityType1`, `RelationType1`, `Attribute1`). The integer SHALL be chosen so the label does not collide with an existing sibling in the **target array** after insertion.

#### Scenario: Second entity type gets incremented index

- **WHEN** the workspace already contains an entity type labeled `EntityType1` under `entityTypes`
- **AND** the user adds another entity type via the tree command
- **THEN** the new object SHALL use a distinct default label (e.g. `EntityType2`) consistent with uniqueness rules

### Requirement: Inserted JSON includes meaningful minimal structure

Inserted objects SHALL include the **minimal nested shape** defined in design for that creation context: entity types SHALL include an `attributes` array (may be empty); relation types SHALL include `startObject` and `endObject` placeholders; attributes SHALL include `type` and additional keys required for Nested or Reference shapes when those insertion modes are supported.

#### Scenario: New entity type includes attributes array

- **WHEN** a new entity type is inserted under `entityTypes`
- **THEN** the inserted object SHALL include an `attributes` property whose value is an array

#### Scenario: New relation type includes endpoints

- **WHEN** a new relation type is inserted under `relationTypes`
- **THEN** the inserted object SHALL include `startObject` and `endObject` objects suitable for later editing

### Requirement: Editor reveals inserted fragment

After a successful insert, the extension SHALL open the document when necessary and SHALL move the editor view and selection to the newly inserted JSON value so the user can edit immediately.

#### Scenario: Selection lands on new content

- **WHEN** insertion succeeds for any of the three create commands
- **THEN** the extension SHALL reveal the inserted region in the active editor (same behavior family as **Show in Editor** navigation)

### Requirement: Default attribute scalar type

Unless inserting a Nested or Reference skeleton explicitly, new attributes inserted via **Add Attribute** SHALL default **`type`** to **`String`**.

#### Scenario: Simple attribute defaults to String

- **WHEN** **Add Attribute** inserts a non-nested attribute skeleton
- **THEN** the inserted object SHALL include `"type": "String"` (or equivalent JSON string value)
