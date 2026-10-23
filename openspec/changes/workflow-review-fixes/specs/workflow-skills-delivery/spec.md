## ADDED Requirements

### Requirement: Shipped skills do not contradict each other
`workflow-assistant` SHALL own the reply shape. No other shipped skill SHALL instruct the agent to recite validation or gate results to the user, to ask more than the one PR question, to suggest local testing as the user's next step, or to ask the user which process id to use.

#### Scenario: Validation walk
- **WHEN** no editor diagnostics are available
- **THEN** every skill that mentions the walk tells the agent to do it silently and report only an unresolved problem

#### Scenario: Gate reporting
- **WHEN** the Java skill describes the review gate
- **THEN** it says the results are reported to the user only on failure

### Requirement: Skills make only claims they support
A statement SHALL be marked confirmed only when a cited real source supports it. The entity-type gate SHALL be described once, in the reference file, as verified only by construction, and SHALL NOT appear as a caveat in the user-facing reply or as an instruction for the user. The `ROLE_WORKFLOW_MANAGER` requirement for JAR registration SHALL be described as inferred, not confirmed.

#### Scenario: Reference wording
- **WHEN** `java-patterns.md` introduces `ResolveEntityType`
- **THEN** it states it is built from confirmed pieces and has not been run against a tenant

### Requirement: The helper classes the send-back loop needs are in the skills
`java-patterns.md` SHALL contain the full source of `UpdateDcrReviewerListener` and `CaptureRequestor`, and every reference to them SHALL point at that content.

#### Scenario: Reference resolution
- **WHEN** `bpmn-rules.md` says the source is in `java-patterns.md`
- **THEN** it is there

### Requirement: Shipped skills contain no internal references
Shipped skill files SHALL NOT reference `openspec/`, `src/`, `docs/` or other paths that are not shipped, and menu labels and command ids SHALL match `package.json`. The curation test SHALL fail on these.

#### Scenario: Curation guard
- **WHEN** a skill file mentions `openspec/changes/...`
- **THEN** `test-workflow-skills-library` fails

#### Scenario: Menu label
- **WHEN** a skill names the action that opens the repository folder
- **THEN** it says "Open Repository Folder"

### Requirement: Legacy cleanup deletes only what the extension wrote
The cleanup of files written by extension 1.0.24–1.0.26 SHALL delete `.cursor/rules/reltio-workflows.mdc` and `.cursor/skills/reltio-*/SKILL.md` only when the file contains the exact marker text the extension wrote, and SHALL remove the managed block from `AGENTS.md` and `CLAUDE.md` by markers (all blocks, without altering other content). It SHALL run on every sync.

#### Scenario: Customer-owned skill
- **WHEN** `.cursor/skills/reltio-entity-type-concepts/` was copied there by the customer
- **THEN** it is left untouched

#### Scenario: Already-synced workspace
- **WHEN** the stamp already equals the bundled version
- **THEN** legacy files are still removed

#### Scenario: Two blocks and code fences
- **WHEN** a user file holds two managed blocks and a code fence with three blank lines
- **THEN** both blocks are removed and the fence is unchanged

### Requirement: Sync is serialized and its failures are visible
Concurrent sync requests SHALL share one in-flight run. A failure SHALL be reported to the user for an explicit resync and logged for startup.

#### Scenario: Forced resync during startup sync
- **WHEN** a forced resync is requested while the startup sync is running
- **THEN** the second waits for the first, then runs

### Requirement: Content changes require a version bump
The skills tree content hash SHALL be recorded beside `skillsBundleVersion` in the test; the test SHALL fail when the hash changes and the version does not.

#### Scenario: Edited skill, same version
- **WHEN** a skill file changes and `skillsBundleVersion` is unchanged
- **THEN** the test fails with the instruction to bump the version
