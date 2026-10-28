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

### Requirement: The CSV names the lookup type and describes its values

A CSV SHALL be named after the lookup type it loads, with the `.csv` extension. Its first line SHALL be a header. The columns `Code`, `Source` and `Value at Source` SHALL be required, and `Code at Source`, `Canonical` and `Downstream Default` optional; columns SHALL be matched by name, ignoring case and surrounding spaces, in any order. Rows sharing a `Code` SHALL form one lookup value, in order of first appearance, with one source mapping per row in row order. `Value at Source` SHALL set both the mapping's `value` and its `code`, unless a non-empty `Code at Source` sets the code. A blank or absent `Canonical` SHALL mean canonical for the first row of each code only, and a blank or absent `Downstream Default` SHALL mean true. Parsing SHALL follow RFC 4180, accept CRLF or LF line endings, drop a UTF-8 byte-order mark and ignore blank lines.

#### Scenario: The supplied sample

- **WHEN** `MaritalStatuses.csv` holds the rows `Single,Reltio,S`, `Single,BvD,Unmarried` and `Single,ReltioCleanser,Never married`
- **THEN** it SHALL produce one value for lookup type `MaritalStatuses` with code `Single`
- **AND** three mappings in that order, the BvD mapping having code `Unmarried` and value `Unmarried`
- **AND** only the `Reltio` mapping SHALL be canonical, and all three downstream default

#### Scenario: Code at Source differs from the value

- **WHEN** a row has `Code` `Single`, `Source` `SAP`, `Value at Source` `Single person` and `Code at Source` `S1`
- **THEN** the SAP mapping SHALL have code `S1` and value `Single person`

#### Scenario: Quoted fields

- **WHEN** a field is `"Married, filing jointly"` or contains `""`
- **THEN** the comma SHALL stay inside the value and `""` SHALL become one `"`

#### Scenario: Canonical column overrides the default

- **WHEN** the `Canonical` column marks the second row of a code `yes` and the first `no`
- **THEN** only the second mapping SHALL be canonical

### Requirement: CSV problems are reported with line numbers, and errors stop a load

Every finding SHALL name its CSV line, the header being line 1. Errors SHALL be: a missing required column; an empty `Code`, `Source` or `Value at Source`; a `Code` containing `/`; the same `Code` and `Source` on two rows; a `Canonical` or `Downstream Default` value other than true/false, yes/no, 1/0 or blank; unbalanced quotes; no data rows; more than 10,000 data rows or more than 2 MB. Warnings SHALL be: a source neither declared in the RDM configuration (by abbreviation) nor already used by the lookup type; a column that is ignored; a code with no canonical mapping; a row whose source and code at the source are already stored with a different value (a conflict; the row is skipped and the stored value kept); and a canonical or downstream-default flag the stored value already gives to another mapping (the row is added without it). Nothing SHALL be sent while any error remains; warnings SHALL NOT block a load.

#### Scenario: Duplicate source for a code

- **WHEN** lines 3 and 7 both have `Code` `Single` and `Source` `BvD`
- **THEN** the plan SHALL report an error naming lines 3 and 7
- **AND** a load of that file SHALL fail without showing a dialog or sending anything

#### Scenario: Unknown source

- **WHEN** a row's source is `BVD` and the configuration declares only `BvD`
- **THEN** the plan SHALL report a warning naming that line and source
- **AND** a load SHALL still be possible

#### Scenario: Missing column

- **WHEN** the header has no `Value at Source` column
- **THEN** the plan SHALL report an error on line 1 naming the missing column

### Requirement: The bridge takes identity from workspace files only

The extension SHALL answer requests written to `.reltio/reltio-agent/rdm-lookup-load/request.json` by writing `result.json` in the same folder with the same `requestId`. A request SHALL name `mode` (`plan` or `load`), `csvFile` and `rdmConfigFile`, both relative to the workspace; any other field SHALL be ignored. The environment and tenant SHALL come from the workspace's own tenant markers for `rdmConfigFile`, which SHALL be a tenant's `RDM/<rdmTenantId>/config.json`; the RDM tenant SHALL be that folder's name. The lookup type SHALL be the CSV's base name, which SHALL equal the trailing segment of a lookup type URI in that configuration exactly, and its URI SHALL be taken from the configuration. Paths that resolve outside the workspace SHALL be refused.

#### Scenario: Request tries to name a tenant

- **WHEN** a request carries `tenantId`, `rdmTenantId` or `lookupType` fields
- **THEN** the extension SHALL ignore them and use only what `rdmConfigFile` and `csvFile` resolve to

#### Scenario: File name matches only ignoring case

- **WHEN** the CSV is `maritalstatuses.csv` and the configuration declares `MaritalStatuses`
- **THEN** the request SHALL fail with kind `unknown-lookup-type`
- **AND** the message SHALL name `MaritalStatuses` as the lookup type it resembles

#### Scenario: Path escapes the workspace

- **WHEN** `csvFile` is `../other/MaritalStatuses.csv`
- **THEN** the request SHALL fail with kind `invalid-request` and nothing SHALL be read or sent

### Requirement: A plan is read-only

A `plan` request SHALL parse and check the CSV, fetch the lookup type's current values, and classify each code by exact match as `new` (not in the lookup type), `append` (exists, and at least one row adds a mapping) or `unchanged` (exists, and every row is already stored or conflicts). It SHALL NOT show a dialog and SHALL NOT send any write request. Its result SHALL list each code with its classification and CSV lines, and every error and warning.

#### Scenario: Plan of the sample against a tenant that has Single

- **WHEN** the tenant already holds `Single` and the CSV holds `Single`, `Married` and `Divorced`
- **THEN** the result SHALL have status `planned`, with `Single` classified `append` or `unchanged` according to its stored mappings, and `Married` and `Divorced` `new`
- **AND** no write request SHALL have been sent

### Requirement: A load is approved by the user in the IDE

A `load` request SHALL repeat every step of a plan against a freshly fetched list of values, and SHALL then show a modal dialog naming the environment, tenant, RDM tenant, lookup type, CSV file, the number of new codes, the number of mappings to be appended and of existing codes they go to, the number of codes already stored, and the number of warnings. Only the dialog's **Load** action SHALL allow anything to be sent; any other response SHALL produce status `cancelled` with nothing sent. When every code is `unchanged`, no dialog SHALL be shown and the result SHALL report every code as `unchanged`.

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

A load SHALL create codes absent from the fresh fetch and SHALL append to existing codes, never replacing or removing anything stored. For an existing code it SHALL send the fetched value with every field and every stored mapping exactly as fetched, plus the CSV's mappings that the code lacks; conflicting rows SHALL NOT be applied. An appended value SHALL be canonical only when the code has no canonical value yet, and downstream default only when its source has none for the code. Codes with nothing to append SHALL NOT be sent. Values SHALL be sent with `POST {serviceUri}/lookups/{rdmTenantId}`, in CSV order, in requests of at most 100 values, one at a time; a new code SHALL use the same request body as Add Value. A request answered with 401 SHALL be retried once after the session is refreshed. The first request that still fails SHALL stop the load, and later codes SHALL be reported as `not-sent`.

#### Scenario: New source for existing codes

- **WHEN** `Single` is stored with only a canonical `Reltio` mapping and the CSV adds `BvD` and `ReltioCleanser` rows for `Single`
- **THEN** `Single` SHALL be sent with its `Reltio` mapping and every other stored field unchanged, plus the two new mappings, both non-canonical

#### Scenario: Conflicting row

- **WHEN** a row maps `Reltio` code `S` to `Solo` while `Reltio` / `S` is stored as `S`
- **THEN** the stored value SHALL be kept, the row SHALL be reported as a warning with its line, and the rest of the file SHALL still load

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

After sending, the extension SHALL fetch the lookup type again and report one outcome per code. A sent code SHALL count as stored when the create response or the re-fetch holds it with every mapping it asked to add, matched by source and code at the source. Outcomes: `added` (a new code, stored); `appended` (an existing code, stored with its appended mappings); `unchanged` (nothing to append, not sent); `not-stored` (sent, not stored); `not-sent`; or `unconfirmed` (sent, the response does not show it, and the re-fetch failed). The result SHALL carry counts per outcome and a message the agent can show as is.

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
