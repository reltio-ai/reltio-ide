## ADDED Requirements

### Requirement: Gateway rules follow what Activiti rejects
A gateway SHALL be reported as an error only when it has no outgoing flow, or when it is a pass-through (one incoming and one outgoing flow). A join (several incoming, one outgoing) SHALL NOT be reported, and an exclusive join SHALL NOT receive the missing-default warning.

#### Scenario: Merge gateway
- **WHEN** an exclusive gateway has two incoming flows and one outgoing flow
- **THEN** no diagnostic is reported for it

#### Scenario: Dead-end gateway
- **WHEN** a gateway has no outgoing flow
- **THEN** an error is reported

### Requirement: The type-listener rule matches the process kind
A `userTask` in `dataChangeRequestReview` SHALL require `DCRTypeTaskListener`; in `potentialMatchReview` it SHALL require `EntityTypeTaskListener`; in any other process it SHALL require one of `DCRTypeTaskListener`, `EntityTypeTaskListener` or `RelationTypeTaskListener`.

#### Scenario: Potential match task with the entity listener
- **WHEN** a `potentialMatchReview` task has `EntityTypeTaskListener` and no `DCRTypeTaskListener`
- **THEN** no listener diagnostic is reported

#### Scenario: DCR task with no type listener
- **WHEN** a `dataChangeRequestReview` task has neither listener
- **THEN** the missing-listener error is reported

### Requirement: Diagram insertion keeps namespaces consistent
Inserting a diagram section SHALL declare the diagram namespaces (see `workflow-deploy-integrity`).

#### Scenario: Round trip
- **WHEN** a definition is parsed, a diagram section is inserted and the result is parsed again
- **THEN** no unbound prefix remains
