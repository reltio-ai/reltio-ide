## MODIFIED Requirements

### Requirement: Naming and tree placement of git-sourced configurations
The extension SHALL present configurations discovered in a git-sourced repository as a tree that mirrors the repository's directory layout, and SHALL give each configuration an identifier that is unique within the repository.

#### Scenario: Configuration nested in folders
- **WHEN** a repository holds a configuration at `DP/dp_lif/BusinessConfig.json`
- **THEN** the tree SHALL show a row for the repository, a row for `DP` beneath it, and a row for `dp_lif` beneath that
- **AND** the configuration's identifier SHALL be `dp_lif`
- **AND** the dotted form `DP.dp_lif` SHALL NOT be shown

#### Scenario: Configuration at the repository root
- **WHEN** a configuration sits at the repository root
- **THEN** it SHALL appear directly beneath the repository row, with no folder rows in between
- **AND** it SHALL be named after its file
- **AND** it SHALL NOT take the repository folder's name, which the repository row already carries

#### Scenario: A second configuration is adopted at the repository root
- **WHEN** a repository already shows one configuration at its root and the user adopts a second one there
- **THEN** the first configuration SHALL keep the identifier it already had
- **AND** both SHALL be named after their files

#### Scenario: Several configurations in one folder
- **WHEN** a folder holds more than one configuration file
- **THEN** that folder SHALL keep its own row
- **AND** each configuration SHALL appear as a child row named after its filename

#### Scenario: Identifiers that would collide
- **WHEN** two configurations in different folders would otherwise receive the same identifier
- **THEN** the extension SHALL qualify each of them with its folder path so the identifiers differ
- **AND** configurations whose identifiers do not collide SHALL keep the unqualified name

#### Scenario: A collision-qualified configuration is displayed
- **WHEN** a configuration's identifier has been qualified with its folder path
- **THEN** its tree row SHALL still be labelled with the plain leaf name, since the folder rows above it already show the path
- **AND** the qualified identifier SHALL remain available on hover and SHALL continue to key lookups and reveal

## ADDED Requirements

### Requirement: Only a business configuration may be adopted through Add Config
When the user adopts a file by hand, the extension SHALL verify that the file looks like a Reltio business configuration and SHALL refuse it with an explanatory error otherwise. This check SHALL apply to the Add Config action only, leaving automatic discovery and connection restore unchanged.

#### Scenario: A valid business configuration is adopted
- **WHEN** the selected file is a JSON object whose top-level `uri` is `configuration` and which has both a `sources` and an `entityTypes` section
- **THEN** the extension SHALL adopt it as a configuration source

#### Scenario: The selected file is not a business configuration
- **WHEN** the selected file is not valid JSON, or is not a JSON object, or its top-level `uri` is not `configuration`, or it lacks a `sources` or `entityTypes` section
- **THEN** the extension SHALL NOT adopt it
- **AND** it SHALL show the error `"<path>" is not a valid Reltio business configuration`

#### Scenario: Folder rows carry no actions
- **WHEN** the user opens the context menu on a folder row
- **THEN** no configuration action SHALL be offered for it

#### Scenario: Repository connected by an earlier version
- **WHEN** a marker file records identifiers in the previous dotted form
- **THEN** the extension SHALL re-derive naming from each recorded file path on load
- **AND** the repository SHALL restore without the user reconnecting it

### Requirement: Removing one configuration leaves the rest of the repository intact
All configurations in a repository share one environment row, so removing one SHALL affect only that configuration. The repository SHALL remain in git mode for as long as at least one configuration source remains.

#### Scenario: One configuration is removed while others remain
- **WHEN** the user removes one configuration from a repository that holds more than one
- **THEN** the remaining configurations SHALL keep their folder rows and their place in the tree
- **AND** the repository SHALL stay in git mode, without asking the user to sign in
- **AND** no remaining row SHALL be marked as a stale local copy

#### Scenario: The last configuration is removed
- **WHEN** the user removes the only configuration a repository holds
- **THEN** the repository SHALL leave git mode, since no configuration source remains

#### Scenario: Removing a collision-qualified configuration
- **WHEN** the user removes a configuration whose identifier carries a folder qualifier
- **THEN** the confirmation prompt and the result message SHALL name it by the label shown in the tree, not by the qualified identifier
