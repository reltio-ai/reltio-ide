## ADDED Requirements

### Requirement: A bundled skill loads lookup values from CSV for Claude Code and Cursor

The extension SHALL bundle an agent skill named `reltio-rdm-lookup-values-from-csv` and install it through the existing agent-asset sync, so that Claude Code and Cursor discover it. The skill SHALL describe the CSV format, the plan-then-load procedure and the bridge protocol. The feature SHALL NOT contribute a command, menu entry or palette entry. Raising the skills bundle version SHALL accompany the skill, so that existing workspaces receive it.

#### Scenario: Installed with the other Reltio skills

- **WHEN** the agent-asset sync runs in a workspace in Cursor with skill installation on
- **THEN** `reltio-rdm-lookup-values-from-csv` SHALL be installed under `.claude/skills/` and `.cursor/skills/`
- **AND** the always-on skills guide SHALL list it

#### Scenario: Existing workspace receives the skill

- **WHEN** a workspace last synced with the previous skills bundle version opens with this extension
- **THEN** the sync SHALL install the new skill

#### Scenario: Agent-only

- **WHEN** the extension's contributions are inspected
- **THEN** no command, menu entry or palette entry SHALL exist for loading lookup values from CSV

### Requirement: The CSV is RDM's export format and may hold several lookup types

A CSV SHALL be in the format RDM exports (usually named `<rdmTenantId>_lookups_<timestamp>.csv`), with the `.csv` extension; its name SHALL decide nothing. Its first line SHALL be a header. The columns `code`, `type`, `sourceMappings.source`, `sourceMappings.code` and `sourceMappings.value` SHALL be required; `enabled`, `startDate`, `endDate`, `parents`, `sourceMappings.enabled`, `sourceMappings.canonicalValue`, `sourceMappings.downStreamDefaultValue`, `localizations.languageCode`, `localizations.value`, `attributes.name` and `attributes.value` SHALL be optional; columns SHALL be matched by name, ignoring case and surrounding spaces, in any order. Each row SHALL name a `code` and its `type`, as `rdm/lookupTypes/<name>` or a bare name. Rows sharing a `type` SHALL form one lookup type, and rows sharing a `type` and `code` one lookup value, both in order of first appearance. A row setting `enabled`, `startDate` or `endDate` SHALL set the code's own fields; a row setting any `sourceMappings.*` column SHALL add one source mapping, in row order. A blank `sourceMappings.code` SHALL take the mapping's value, and a blank `sourceMappings.value` its code. A blank `sourceMappings.canonicalValue` SHALL mean canonical for the code's first mapping only; a blank `enabled`, `sourceMappings.enabled` or `sourceMappings.downStreamDefaultValue` SHALL mean true; a blank `startDate` or `endDate` SHALL mean 0, no bound. A new code SHALL be created with those fields, and the mappings of one source SHALL become one source mapping with several values. Parents, localizations and attributes SHALL NOT be loaded. Parsing SHALL follow RFC 4180, accept CRLF or LF line endings, drop a UTF-8 byte-order mark and ignore blank lines.

#### Scenario: The supplied export

- **WHEN** a CSV holds a code row for `B` of `rdm/lookupTypes/OrganizationStatuses` and the mapping rows `BvD`, `B`, `Business` (canonical) and `SAP`, `B`, `Business` (not canonical)
- **THEN** it SHALL produce one value for lookup type `OrganizationStatuses` with code `B`, enabled, with start and end dates 0
- **AND** two mappings in that order, only the BvD mapping canonical

#### Scenario: Code at the source differs from the value

- **WHEN** a mapping row has `sourceMappings.code` `COMPANY` and `sourceMappings.value` `Company`
- **THEN** the mapping SHALL have code `COMPANY` and value `Company`

#### Scenario: A code with no mappings

- **WHEN** a code has only a code row
- **THEN** it SHALL still be a lookup value, and a new one SHALL be created with no source mappings

#### Scenario: Several lookup types in one file

- **WHEN** a CSV holds rows for `OrganizationStatuses` and `AddressTypes`, with code `A` in both
- **THEN** it SHALL produce both lookup types, in order of first appearance, each with its own value `A`

#### Scenario: Quoted fields

- **WHEN** a field is `"Married, filing jointly"` or contains `""`
- **THEN** the comma SHALL stay inside the value and `""` SHALL become one `"`

#### Scenario: Parents, localizations and attributes

- **WHEN** a row sets `localizations.languageCode` and `localizations.value`
- **THEN** the plan SHALL report a warning naming that line
- **AND** no localization SHALL be sent

#### Scenario: The earlier layout

- **WHEN** the header has `Code`, `Source` and `Value at Source` columns and no `sourceMappings.source`
- **THEN** the plan SHALL report an error on line 1 naming the columns of RDM's export

### Requirement: CSV problems are reported with line numbers, and errors stop a load

Every finding SHALL name its CSV line, the header being line 1. Errors SHALL be: a missing required column, or the earlier `Code` / `Source` / `Value at Source` layout; an empty `code` or `type`; a `code` containing `/`; a `type` that does not name a lookup type; an `enabled`, `sourceMappings.enabled`, `sourceMappings.canonicalValue` or `sourceMappings.downStreamDefaultValue` value other than true/false, yes/no, 1/0 or blank; a `startDate` or `endDate` that is neither a whole number nor blank; a mapping row with an empty `sourceMappings.source`, or with both `sourceMappings.code` and `sourceMappings.value` empty; a code's own fields on two rows; the same source and code at the source twice for one code; unbalanced quotes; no data rows; more than 10,000 data rows or more than 2 MB. Warnings SHALL be: a source neither declared in the RDM configuration (by abbreviation) nor already used by the lookup type; a column that is ignored; a parent, localization or attribute, which is not loaded; a new code with mappings but none canonical; a CSV named as an export of another RDM tenant; a row whose source and code at the source are already stored with a different value (a conflict; the row is skipped and the stored value kept); a canonical or downstream-default flag the stored value already gives to another mapping (the row is added without it); and an existing code whose `enabled`, `startDate` or `endDate` differs from the CSV (the stored one is kept). Nothing SHALL be sent while any error remains; warnings SHALL NOT block a load.

#### Scenario: Duplicate mapping for a code

- **WHEN** lines 3 and 7 both map `BvD` code `B` for code `B` of the same lookup type
- **THEN** the plan SHALL report an error naming lines 3 and 7
- **AND** a load of that file SHALL fail without showing a dialog or sending anything

#### Scenario: Unknown source

- **WHEN** a row's source is `BVD` and the configuration declares only `BvD`
- **THEN** the plan SHALL report a warning naming that line and source
- **AND** a load SHALL still be possible

#### Scenario: Missing column

- **WHEN** the header has no `sourceMappings.value` column
- **THEN** the plan SHALL report an error on line 1 naming the missing column

### Requirement: The bridge takes identity from workspace files only

The extension SHALL answer requests written to `.reltio/reltio-agent/rdm-lookup-load/request.json` by writing `result.json` in the same folder with the same `requestId`. A request SHALL name `mode` (`plan` or `load`), `csvFile` and `rdmConfigFile`, both relative to the workspace; any other field SHALL be ignored. The environment and tenant SHALL come from the workspace's own tenant markers for `rdmConfigFile`, which SHALL be a tenant's `RDM/<rdmTenantId>/config.json`; the RDM tenant SHALL be that folder's name. The lookup types SHALL come from the CSV's `type` column; each SHALL equal the trailing segment of a lookup type URI in that configuration exactly, and its URI SHALL be taken from the configuration. The CSV's name SHALL decide nothing, except that a name of the form `<rdmTenantId>_lookups_<timestamp>.csv` naming another RDM tenant SHALL be reported as a warning. Paths that resolve outside the workspace SHALL be refused.

#### Scenario: Request tries to name a tenant

- **WHEN** a request carries `tenantId`, `rdmTenantId` or `lookupType` fields
- **THEN** the extension SHALL ignore them and use only what `rdmConfigFile` and `csvFile` resolve to

#### Scenario: Type matches only ignoring case

- **WHEN** the `type` column names `rdm/lookupTypes/organizationstatuses` and the configuration declares `OrganizationStatuses`
- **THEN** the request SHALL fail with kind `unknown-lookup-type`, and nothing SHALL be fetched
- **AND** the message SHALL name `OrganizationStatuses` as the lookup type it resembles, with the CSV lines in `errors`

#### Scenario: Export from another RDM tenant

- **WHEN** the CSV is `Dev1_lookups_1793868681973.csv` and `rdmConfigFile` is a tenant's `RDM/Prod1/config.json`
- **THEN** the plan SHALL warn that the file was exported from `Dev1` and loads into `Prod1`
- **AND** a load SHALL still be possible

#### Scenario: Path escapes the workspace

- **WHEN** `csvFile` is `../other/statuses.csv`
- **THEN** the request SHALL fail with kind `invalid-request` and nothing SHALL be read or sent

### Requirement: A plan is read-only

A `plan` request SHALL parse and check the CSV, fetch each lookup type's current values, and classify each code by exact match as `new` (not in the lookup type), `append` (exists, and at least one row adds a mapping) or `unchanged` (exists, and every row is already stored or conflicts). It SHALL NOT show a dialog and SHALL NOT send any write request. Its result SHALL list the CSV's lookup types, each code with its lookup type, classification and CSV lines, and every error and warning.

#### Scenario: Plan of the export against a tenant that has B

- **WHEN** the tenant already holds `B` and the CSV holds `A`, `B`, `Bankrupt` and `C`
- **THEN** the result SHALL have status `planned`, with `B` classified `append` or `unchanged` according to its stored mappings, and `A`, `Bankrupt` and `C` `new`
- **AND** no write request SHALL have been sent

### Requirement: A load is approved by the user in the IDE

A `load` request SHALL repeat every step of a plan against a freshly fetched list of values, and SHALL then show a modal dialog naming the environment, tenant, RDM tenant, the lookup types it writes to, the CSV file, the number of new codes, the number of mappings to be appended and of existing codes they go to, the number of codes already stored, and the number of warnings. Only the dialog's **Load** action SHALL allow anything to be sent; any other response SHALL produce status `cancelled` with nothing sent. When every code is `unchanged`, no dialog SHALL be shown and the result SHALL report every code as `unchanged`.

#### Scenario: User clicks Load

- **WHEN** a load finds two new codes and the user clicks **Load**
- **THEN** the two codes SHALL be sent

#### Scenario: User cancels

- **WHEN** the user dismisses the dialog
- **THEN** the result SHALL have status `cancelled` and no write request SHALL have been sent

#### Scenario: Load without a prior plan

- **WHEN** an agent writes a `load` request without having run a plan
- **THEN** the extension SHALL still check the CSV, fetch current values and show the dialog before sending anything

### Requirement: New codes are created and existing codes appended to, in chunks of at most 100

A load SHALL create codes absent from the fresh fetch and SHALL append to existing codes, never replacing or removing anything stored. For an existing code it SHALL send the fetched value with every field and every stored mapping exactly as fetched, plus the CSV's mappings that the code lacks; conflicting rows SHALL NOT be applied. An appended value SHALL be canonical only when the code has no canonical value yet, and downstream default only when its source has none for the code. Codes with nothing to append SHALL NOT be sent. An existing code's `enabled`, `startDate` and `endDate` SHALL be kept as stored. Values SHALL be sent with `POST {serviceUri}/lookups/{rdmTenantId}`, one lookup type at a time, in CSV order, in requests of at most 100 values of one lookup type, one request at a time; a new code SHALL use the same request body as Add Value, with the CSV's `enabled`, `startDate` and `endDate`. A request answered with 401 SHALL be retried once after the session is refreshed. The first request that still fails SHALL stop the load, and later codes, later lookup types included, SHALL be reported as `not-sent`.

#### Scenario: New source for existing codes

- **WHEN** `B` is stored with only a canonical `BvD` mapping and the CSV adds a `SAP` row for `B`
- **THEN** `B` SHALL be sent with its `BvD` mapping and every other stored field unchanged, plus the `SAP` mapping, non-canonical

#### Scenario: Conflicting row

- **WHEN** a row maps `BvD` code `B` to `Biz` while `BvD` / `B` is stored as `Business`
- **THEN** the stored value SHALL be kept, the row SHALL be reported as a warning with its line, and the rest of the file SHALL still load

#### Scenario: An existing code's fields differ

- **WHEN** the CSV sets `enabled` false for `B`, which is stored enabled
- **THEN** `B` SHALL stay enabled, and the plan SHALL report a warning naming the line

#### Scenario: Several lookup types

- **WHEN** a load sends codes of `OrganizationStatuses` and `AddressTypes`
- **THEN** each lookup type's codes SHALL be sent in requests of their own

#### Scenario: 250 new codes

- **WHEN** a load sends 250 new codes
- **THEN** three requests of 100, 100 and 50 codes SHALL be sent, in CSV order

#### Scenario: Second chunk fails

- **WHEN** the second of three requests fails with HTTP 400
- **THEN** the third SHALL NOT be sent
- **AND** its codes SHALL be reported as `not-sent`, with the service's error detail in the result

#### Scenario: Rerun after a load

- **WHEN** the same file is loaded again after it was loaded
- **THEN** every code SHALL be `unchanged`, no dialog SHALL be shown and nothing SHALL be sent

### Requirement: Each code's outcome is reported

After sending, the extension SHALL fetch each lookup type it sent to again and report one outcome per code, with its lookup type. Outcomes SHALL be judged per lookup type, so the same code in two lookup types never confirms the other. A sent code SHALL count as stored when the create response or the re-fetch holds it with every mapping it asked to add, matched by source and code at the source. Outcomes: `added` (a new code, stored); `appended` (an existing code, stored with its appended mappings); `unchanged` (nothing to append, not sent); `not-stored` (sent, not stored); `not-sent`; or `unconfirmed` (sent, the response does not show it, and the re-fetch failed). The result SHALL carry counts per outcome and a message the agent can show as is.

#### Scenario: All added

- **WHEN** every sent code is in the re-fetch with its requested mappings
- **THEN** the result SHALL have status `loaded`, with every sent new code `added` and every sent existing code `appended`

#### Scenario: Present without the appended mapping

- **WHEN** an existing code was sent with an appended `BvD` mapping, and the re-fetch shows the code without it
- **THEN** its outcome SHALL be `not-stored`

#### Scenario: Re-fetch fails

- **WHEN** the posts succeed but the re-fetch fails, and the response lists only some codes
- **THEN** the codes it lists SHALL be `added` or `appended`, and the other sent codes `unconfirmed`

### Requirement: The bridge reports when it cannot act, and never exposes the session

The bridge SHALL answer `not-run` with reason `disabled` when `reltio.enableRdmLookupLoad` is off, `repository-mode` in a workspace opened from a repository, `no-tenant` when `rdmConfigFile` belongs to no connected tenant, `signed-out` when the environment has no session, and `no-rdm-service` when the tenant has no RDM service. It SHALL answer `failed` with kind `invalid-request`, `invalid-csv`, `unknown-lookup-type`, `api-error` (with the HTTP status and response body), `untrusted-host` or `network` when the request or the service fails before anything is posted. No result and no log line SHALL contain the session token.

#### Scenario: Setting off

- **WHEN** `reltio.enableRdmLookupLoad` is false and a request arrives
- **THEN** the result SHALL have status `not-run` and reason `disabled`, and nothing SHALL be fetched or sent

#### Scenario: Malformed request

- **WHEN** `request.json` is not valid JSON, or lacks `mode`, `csvFile` or `rdmConfigFile`
- **THEN** the result SHALL have status `failed` and kind `invalid-request`

#### Scenario: Token never written

- **WHEN** any request is answered
- **THEN** neither `result.json` nor the output channel SHALL contain the session token
