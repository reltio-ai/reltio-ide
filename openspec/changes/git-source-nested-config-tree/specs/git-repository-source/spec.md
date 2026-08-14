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
- **AND** it SHALL take the repository folder's name

#### Scenario: Several configurations in one folder
- **WHEN** a folder holds more than one configuration file
- **THEN** that folder SHALL keep its own row
- **AND** each configuration SHALL appear as a child row named after its filename

#### Scenario: Identifiers that would collide
- **WHEN** two configurations in different folders would otherwise receive the same identifier
- **THEN** the extension SHALL qualify each of them with its folder path so the identifiers differ
- **AND** configurations whose identifiers do not collide SHALL keep the unqualified name

#### Scenario: Folder rows carry no actions
- **WHEN** the user opens the context menu on a folder row
- **THEN** no configuration action SHALL be offered for it

#### Scenario: Repository connected by an earlier version
- **WHEN** a marker file records identifiers in the previous dotted form
- **THEN** the extension SHALL re-derive naming from each recorded file path on load
- **AND** the repository SHALL restore without the user reconnecting it
