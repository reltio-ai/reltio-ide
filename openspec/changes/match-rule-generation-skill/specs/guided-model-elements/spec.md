## ADDED Requirements

### Requirement: Match groups are generated, checked and tested before insertion
The match-group skill SHALL direct the agent to resolve the entity type and every attribute URI from the user's configuration file, build the match group from the bundled reference, check it against the schema, and test it with at least three record pairs (exact, near, different) through the verification bridge before inserting it. It SHALL NOT insert a rule after a `failed` verification, SHALL label results produced without the tenant as not verified against a tenant, and SHALL leave deployment to **Apply Configuration to Tenant**.

#### Scenario: Live verification succeeds
- **WHEN** the user asks for a match rule in a signed-in tenant workspace
- **THEN** the agent inserts the group after a `verified` result and reports each pair's expected and actual outcome as verified against that tenant

#### Scenario: Verification fails
- **WHEN** the bridge returns `failed` and retrying does not fix it
- **THEN** the agent does not insert the rule and reports the error kind, HTTP status and server message

### Requirement: The match-rule reference is grounded in shipped files
Every match token, comparator and cleanser class the skill names SHALL be used by a shipped Velocity Pack configuration or be documented in Reltio's match-rule documentation, and every complete worked example SHALL validate against the schema's `MatchGroup` definition and write `useOvOnly` as a boolean. Shipped guidance SHALL NOT contain hosted dictionary URLs or customer names.

#### Scenario: Content drifts
- **WHEN** a class neither used by a shipped configuration nor documented by Reltio is added to the reference
- **THEN** the unit tests fail

### Requirement: Underspecified requests are clarified, not defaulted
When a request leaves out the entity type, whether an attribute matches exactly or fuzzily, which attributes a broad term means, or the intended outcome, the skill SHALL direct the agent to ask before building. A request that speaks of match scores SHALL produce a `relevance_based` rule.

#### Scenario: "Match based on Email"
- **WHEN** the user asks only to "match based on Email"
- **THEN** the agent asks whether the match is exact or fuzzy and which entity type it is for

### Requirement: `useOvOnly` accepts a boolean
The schema SHALL accept `useOvOnly` as a boolean or a string, and the skill SHALL write it as a boolean.

#### Scenario: Existing configuration
- **WHEN** a configuration carries `"useOvOnly": "true"`
- **THEN** it raises no schema error

### Requirement: The skill carries its own schema and reports full test records
The skill folder SHALL include `match-group.schema.json`, the match-group part of the IDE's schema, generated from it and kept identical by a unit test, and the skill SHALL check rules against that file rather than a path that exists only in the extension's source. Test results SHALL show, per pair, both records with every attribute in one cell each, the expected and actual outcome, and SHALL include per-attribute scores only when the user asks.

#### Scenario: Schema check in a user workspace
- **WHEN** the agent checks a candidate rule in a workspace that does not contain the extension's source
- **THEN** it validates against `match-group.schema.json` in the skill folder

#### Scenario: Test results
- **WHEN** the agent reports verification results
- **THEN** each row shows Record 1 and Record 2 with all their attributes, the expected outcome and the actual outcome
