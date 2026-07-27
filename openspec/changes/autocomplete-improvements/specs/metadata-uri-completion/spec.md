## ADDED Requirements

### Requirement: URI completions use current L3 definitions

The extension SHALL provide completion items for `*.reltio.json` string values that are **semantic URI fields**, such that suggested insertions are **`configuration/...` paths** that exist as **definitions** in the **UriIndex** built from the **same document** (including virtual definition URIs already tracked by the index), not arbitrary substrings collected from word-based heuristics alone.

#### Scenario: Entity type field

- **WHEN** the user invokes completion inside a string value for a property classified as an **entity type URI** (e.g. `referencedEntityTypeURI` per implementation table)
- **THEN** the completion list SHALL include **only** definition URIs from the current model that match the **entity-type** scope (e.g. paths under `configuration/entityTypes/`) subject to filtering rules in design **D2**

#### Scenario: Relation type field

- **WHEN** the user invokes completion inside a string value for a property classified as a **relation type URI** (e.g. `relationshipTypeURI`)
- **THEN** the completion list SHALL include matching **`configuration/relationTypes/…`** definition URIs from the current model’s index

### Requirement: Reference-attribute related URIs

The extension SHALL support completion for **reference attribute** shapes, including:

- `referencedEntityTypeURI` — entity type definition URIs from the current model.
- `relationshipTypeURI` — relation type definition URIs consistent with the relation model.
- Elements of `referencedAttributeURIs` — attribute definition URIs appropriate to the referenced entity (or documented fallback scope when sibling context is insufficient).

#### Scenario: Referenced attribute array

- **WHEN** the user invokes completion inside a string element of **`referencedAttributeURIs`** within a reference attribute object that has a resolvable **`referencedEntityTypeURI`**
- **THEN** suggestions SHALL prioritize attribute URIs under that entity type (including indexed paths under `…/attributes/…`) before broader fallbacks if the implementation provides fallbacks

### Requirement: Integration with existing parse and index

The completion provider SHALL use the same **parsed model** and **UriIndex** as Go to Definition / diagnostics for the active document (rebuilt on the same refresh path), so a suggested URI resolves with existing navigation behavior after insertion.

#### Scenario: Consistency with navigation

- **WHEN** the user accepts a completion item that inserts a **definition** URI present in the index
- **THEN** Go to Definition on that URI SHALL resolve to the same definition as for manually typed identical URIs

### Requirement: Discoverability and ranking

Semantic URI completions SHALL be **labeled** such that users can distinguish them from unrelated text suggestions (e.g. via `CompletionItem` **kind**, **detail**, or **documentation** carrying the URI or a short description).

#### Scenario: Ctrl+Space in URI value

- **WHEN** the user triggers completion at the start of a URI string value for a classified property
- **THEN** the list SHALL include at least one semantic URI candidate when the model contains applicable definitions, and items SHALL not rely solely on **word-based** fragments for the primary URI set

### Requirement: Same-property value reuse in the file

The extension SHALL offer completion items for the **current JSON property name** that include every **non-empty string value** already assigned to a property with that **same name** anywhere else in the current `*.reltio.json` document (including each element of **array** values for that property), so authors can **reuse** values they already entered without relying on editor word heuristics.

#### Scenario: Repeat a prior entity type URI

- **WHEN** the file already contains at least one `referencedEntityTypeURI` with value `V` and the user requests completion in another `referencedEntityTypeURI` value
- **THEN** the completion list SHALL include `V` with clear labeling that it comes from the same file (not only from the global definition index)
