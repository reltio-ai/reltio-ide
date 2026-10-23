## ADDED Requirements

### Requirement: The deployed process id is the id inside the XML
For every deploy entry point the extension SHALL derive the process id from the XML being uploaded, and SHALL use that id for the confirmation text, the built-in and live collision checks, and `replacesLive`.

#### Scenario: Draft edited to a built-in id
- **WHEN** `foo.bpmn20.xml` is edited so `<process id="dataChangeRequestReview">`
- **THEN** the confirmation names `dataChangeRequestReview`, states it replaces the tenant's built-in flow for every entity type, and shows that the filename is `foo`

#### Scenario: Id and filename agree
- **WHEN** the XML id equals the filename
- **THEN** the confirmation is unchanged from today

### Requirement: Duplicate and new-draft output is well-formed XML
Any operation that inserts diagram elements SHALL ensure the `bpmndi`, `omgdc` and `omgdi` namespaces are declared on the root, adding them when absent.

#### Scenario: Older skeleton with four namespaces
- **WHEN** a definition with no diagram section and only four namespace declarations is duplicated
- **THEN** the result declares the three diagram namespaces and parses as XML

### Requirement: Deploy acts on the file the row represents
A repo-tracked definition SHALL deploy the repository file. A downloaded draft SHALL deploy the draft. Local and repo states SHALL be tracked independently.

#### Scenario: Repo differs, nothing downloaded
- **WHEN** the repo BPMN differs from the tenant and no draft was downloaded
- **THEN** Deploy uses the repo file, not a "has not been downloaded" error

#### Scenario: Repo clean, local edits
- **WHEN** the repo file is in sync but the downloaded draft has local edits
- **THEN** the row still offers Deploy and Compare for the draft

### Requirement: Collision checks never assume an empty tenant
When the definition cache for a tenant is empty or stale, new-draft, duplicate and deploy SHALL fetch the live list before deciding whether an id collides, and Duplicate SHALL check against the full list, not only the source.

#### Scenario: Unfetched cache
- **WHEN** the user creates a draft whose id exists live and the tree has never been fetched
- **THEN** the collision warning is shown
