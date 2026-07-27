## ADDED Requirements

Normative **agents** below mean **Cursor Agent** or any external agent that reads the same workspace skills and applies edits out-of-process (**not** the VS Code extension runtime invoking an LLM).

### Requirement: Guided workflows analyze current L3 before proposing new elements

The guided-configuration capability SHALL require agents to treat the **active tenant configuration** (`L3.reltio.json` or equivalent workspace selection) as **primary context**: existing entity types, relation types, URIs, `extendsTypeURI` where present, and notable attributes MUST be summarized before proposing additions.

#### Scenario: Author describes a new concept with existing model present

- **WHEN** the user asks to introduce a new business concept while an `L3.reltio.json` is available  
- **THEN** the agent SHALL derive proposals that explicitly reference **existing URIs and labels** where relationships or inheritance apply.

### Requirement: Proposals address inheritance and relationships explicitly

For guided introductions of **entity types** or **relation types**, the capability SHALL produce structured guidance that answers: whether the new element **extends** an existing type (`extendsTypeURI` or consolidation patterns per project conventions), and how it **connects** via **relation types** (start/end object URIs, reuse vs net-new relation).

#### Scenario: User asks for hierarchy linked to an existing type

- **WHEN** the user requests a subtype or related type connected to an existing entity type already declared in L3  
- **THEN** the proposal SHALL state inheritance or relation linkage choices using **`configuration/...` URIs** consistent with the current file.

### Requirement: Attribute suggestions align with concept semantics and existing naming

When suggesting attributes for a described concept (e.g., “Person”), the capability SHALL combine **(a)** typical attribute patterns justified by the concept name and **(b)** consistency with **existing attribute naming and typing** in the current model **and** grounded excerpts from the Velocity Pack reference (`velocity-packs-reference`) when available.

#### Scenario: Person-like entity request

- **WHEN** the user describes a Person-like entity and packs contain Individual-like patterns  
- **THEN** suggested attributes SHALL include rationale tying fields to **pack-grounded** idioms and SHALL avoid conflicting names already taken in the target scope.

### Requirement: Match group guidance ties back to entity semantics

Guidance for **match groups** SHALL connect proposed rules to **entity semantics** (scopes, attributes referenced by rules) and SHALL flag when referenced URIs are absent from the current model.

#### Scenario: Match group proposal consistency check

- **WHEN** the agent proposes a new match group referencing attributes  
- **THEN** it SHALL verify referenced attribute URIs exist or explicitly schedule their introduction.
