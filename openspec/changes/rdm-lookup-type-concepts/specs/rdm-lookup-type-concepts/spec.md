## ADDED Requirements

### Requirement: A bundled skill adds RDM lookup types from a request

The extension SHALL bundle an agent skill named `reltio-rdm-lookup-type-concepts`, installed through the existing agent-asset sync, whose description names requests such as "Add lookup type OrganizationStatuses". Raising the skills bundle version SHALL accompany it, so existing workspaces receive it.

#### Scenario: Installed with the other Reltio skills

- **WHEN** the agent-asset sync runs with skill installation on
- **THEN** `reltio-rdm-lookup-type-concepts` SHALL be installed and listed in the always-on skills guide

### Requirement: The skill writes the entry Add a new Lookup Type writes

For each new lookup type the skill SHALL append to the RDM configuration's `lookupTypes` list, creating the list when absent, an entry with `uri` `rdm/lookupTypes/<Name>`, `label` `<Name>` (or a display label the user gives), `enabled` true, and `startDate` and `endDate` 0 — the entry the IDE's **Add a new Lookup Type** writes. It SHALL NOT change anything else in the file.

#### Scenario: Add one lookup type

- **WHEN** the user asks "Add lookup type OrganizationStatuses" and the RDM configuration has no such lookup type
- **THEN** the skill SHALL append `{ "uri": "rdm/lookupTypes/OrganizationStatuses", "label": "OrganizationStatuses", "enabled": true, "startDate": 0, "endDate": 0 }` to `lookupTypes`
- **AND** the RDM configuration SHALL still validate against the RDM schema

#### Scenario: Several in one request

- **WHEN** the user asks for `AddressTypes` and `PhoneTypes`
- **THEN** both SHALL be appended, in that order

### Requirement: The skill never adds a second spelling of a lookup type

A name SHALL be letters and digits only, starting with a letter; a name with other characters SHALL be cleaned and confirmed with the user before anything is written. The skill SHALL compare each name with the URIs and labels already in the file, ignoring case. An exact URI match SHALL add nothing; a match in another case or by label SHALL be named to the user and SHALL add nothing until the user decides.

#### Scenario: Already there

- **WHEN** `rdm/lookupTypes/OrganizationStatuses` is already in the file
- **THEN** nothing SHALL be added, and the skill SHALL say so

#### Scenario: Another spelling

- **WHEN** the file has `rdm/lookupTypes/organizationStatuses` and the user asks for `OrganizationStatuses`
- **THEN** the skill SHALL name the existing lookup type and ask before adding anything

#### Scenario: A name with spaces

- **WHEN** the user asks for "Organization Statuses"
- **THEN** the skill SHALL propose `OrganizationStatuses` and write nothing until the user confirms

### Requirement: Pushing to the tenant stays with the user

The skill SHALL only edit the local RDM configuration. It SHALL NOT apply the configuration, call the RDM API, or ask for, read or pass on a token. It SHALL tell the user to run **Apply RDM Configuration** on the RDM tenant row, and SHALL point to loading values with `reltio-rdm-lookup-values-from-csv` and to an L3 attribute's `lookupCode` as next steps.

#### Scenario: After adding

- **WHEN** the skill has added a lookup type
- **THEN** its report SHALL say the lookup type exists only locally until **Apply RDM Configuration** is run
