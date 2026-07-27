## ADDED Requirements

### Requirement: Insert Interaction Type command inserts a skeleton without wizard prompts

The extension SHALL provide a **reltio.insertInteractionType** command that appends a new `InteractionType` object to `interactionTypes[]` without using modal dialogs (`showInputBox`, `showQuickPick`, or equivalent) to collect the label or URI first.

#### Scenario: Insert Interaction Type does not prompt for a name

- **WHEN** the user invokes **Insert Interaction Type** from the configuration tree
- **THEN** the extension SHALL insert a new interaction type object into `interactionTypes[]` without opening an input box or quick-pick first

### Requirement: Inserted interaction type has a default, collision-safe label

The inserted object's `label` and URI final segment SHALL follow the `InteractionType{positiveInteger}` pattern, choosing an integer that does not collide with any existing sibling label already present in `interactionTypes[]`.

#### Scenario: Second interaction type gets an incremented default label

- **WHEN** the workspace already contains an interaction type labeled `InteractionType1`
- **AND** the user invokes **Insert Interaction Type** again
- **THEN** the newly inserted object SHALL use a distinct default label (e.g. `InteractionType2`)

### Requirement: Inserted interaction type includes a minimal usable shape

The inserted object SHALL include `uri`, `label`, and an `attributes` array (may be empty) so the element is immediately editable.

#### Scenario: New interaction type includes an attributes array

- **WHEN** a new interaction type is inserted
- **THEN** the inserted object SHALL include an `attributes` property whose value is an array

### Requirement: Insert Interaction Type is reachable before the section folder exists

The command SHALL be available from the tenant root (`reltio.tenant.l3`) as well as from the **Interaction Types** folder, so a tenant with zero interaction types can still bootstrap the first one.

#### Scenario: Bootstrap insert from tenant root

- **WHEN** a tenant's L3 configuration has no `interactionTypes` (or an empty array) and no **Interaction Types** folder is visible in the tree
- **AND** the user invokes **Insert Interaction Type** from the tenant root context menu
- **THEN** the extension SHALL create `interactionTypes[0]` and the **Interaction Types** folder SHALL subsequently appear in the tree

### Requirement: Editor reveals the inserted fragment

After a successful insert, the extension SHALL open `L3.reltio.json` when necessary and move the editor selection/view to the newly inserted JSON value.

#### Scenario: Selection lands on the new interaction type

- **WHEN** an Insert Interaction Type insert succeeds
- **THEN** the extension SHALL reveal the inserted region in the active editor
