## ADDED Requirements

### Requirement: The lookup values panel offers Add Value for one or more codes

The lookup values panel SHALL show an **Add Value** button. Activating it SHALL reveal, in the same panel, a form holding one block per new code. Each block SHALL hold the code and a table of source mappings in which each row holds a source, the code at that source, the value, and the canonical and downstream-default flags. Before submitting, the user SHALL be able to add and remove blocks, and add and remove rows within a block. Source fields SHALL suggest the sources this lookup type already maps and the sources in the tenant's RDM configuration, the latter by their `abbreviation` (falling back to the last segment of their `uri` when they have none), and SHALL accept any other text.

#### Scenario: Form opens in the panel

- **WHEN** the user activates **Add Value** on the panel for a lookup type
- **THEN** a form with one empty code block SHALL appear in the same panel, above the existing values

#### Scenario: Several codes in one form

- **WHEN** the user activates **Add Code** twice
- **THEN** the form SHALL hold three code blocks, each with its own mapping rows

#### Scenario: Blocks and rows can be removed

- **WHEN** the user removes a code block, or a mapping row within a block
- **THEN** the form SHALL hold exactly the remaining blocks and rows, in their on-screen order

#### Scenario: New rows get sensible defaults

- **WHEN** a mapping row is added
- **THEN** it SHALL start marked downstream default
- **AND** only the first row of each new block SHALL start marked canonical

#### Scenario: Configured sources suggested by abbreviation

- **WHEN** the RDM configuration declares a source with `uri` `rdm/sources/DunAndBradstreet` and `abbreviation` `DnB`
- **THEN** the source fields SHALL suggest `DnB`, because a mapping's source must match the source's abbreviation

#### Scenario: Cancel discards the draft

- **WHEN** the user cancels the form
- **THEN** no request SHALL be sent and the panel SHALL show the values as before

### Requirement: A submission is validated before any request

The extension SHALL validate every submission itself before sending anything, and SHALL NOT rely on the form having validated it. A submission SHALL be rejected as a whole when it has no code; when it has more than 100 codes, the per-request maximum of the RDM service; when any code is empty or contains `/`; when the same code appears twice; when a code has no mapping; when a mapping lacks a source or a value; when the same source appears twice within one code; or when any field has the wrong type. The same source under different codes SHALL be accepted. Each error SHALL identify the block it belongs to by position and code.

#### Scenario: Missing value rejected and located

- **WHEN** the second code block, `HOME`, has a mapping with no value
- **THEN** no request SHALL be sent
- **AND** the panel SHALL say that mapping 1 of code 2 (`HOME`) has no value, keeping everything the user entered

#### Scenario: Code containing a slash rejected

- **WHEN** a code contains `/`
- **THEN** no request SHALL be sent, because the code becomes the last segment of the value's URI

#### Scenario: More than 100 codes rejected

- **WHEN** a submission holds 101 codes
- **THEN** no request SHALL be sent
- **AND** the panel SHALL say that at most 100 codes can be added at once

#### Scenario: Same code twice rejected

- **WHEN** two blocks in one submission hold the same code
- **THEN** no request SHALL be sent

#### Scenario: Duplicate source within a code rejected

- **WHEN** two mappings in one block name the same source
- **THEN** no request SHALL be sent

#### Scenario: Same source across codes accepted

- **WHEN** two blocks each have a mapping for source `DnB`
- **THEN** the submission SHALL pass validation

#### Scenario: Malformed message ignored

- **WHEN** the extension receives a panel message of an unknown type or with fields of the wrong type
- **THEN** it SHALL send no request and change nothing

### Requirement: Existing codes get the new mappings appended, and nothing stored changes

For a submitted code that already exists in the lookup type, the extension SHALL append the form's mappings to the code's stored value instead of refusing or replacing it. Existence and the stored value SHALL be taken from the lookup type's values fetched immediately before submitting, by exact code match. Because posting a code replaces its whole value, the extension SHALL send the fetched value with every field and every stored mapping exactly as fetched, plus the mappings it lacks. It SHALL NOT change or remove any stored mapping or field.

A mapping whose source and code at the source are already stored with the same value SHALL be treated as already present, and nothing SHALL be added for it. A mapping whose source and code at the source are stored with a **different** value is a conflict: the submission SHALL be refused, nothing SHALL be sent, and the panel SHALL name the code, the source and both values. An appended value SHALL be canonical only when the code has no canonical value yet, and downstream default only when its source has none for the code; otherwise it SHALL be added without the flag, and the panel SHALL say so. A submission where every mapping is already present SHALL send nothing and SHALL say so.

#### Scenario: Add a source to an existing code

- **WHEN** code `A` is stored with a canonical `Reltio` mapping `A` / `Acquired`, and the user adds `DnB` / `Acquired` to `A`
- **THEN** the request SHALL carry `A` with its `Reltio` mapping and every other stored field unchanged, plus a `DnB` mapping
- **AND** the `DnB` value SHALL be non-canonical, and the panel SHALL say it was added as non-canonical because `A` already has a canonical value

#### Scenario: Mapping already stored

- **WHEN** the user submits `A` with `Reltio` / `A` / `Acquired`, which is already stored
- **THEN** no request SHALL be sent, and the panel SHALL say every mapping is already stored

#### Scenario: Conflicting value refused

- **WHEN** the user submits `A` with `Reltio` / `A` / `Active`, while `Reltio` / `A` is stored as `Acquired`
- **THEN** no request SHALL be sent
- **AND** the panel SHALL name `A`, `Reltio`, `Acquired` and `Active`, keeping the form

#### Scenario: Code added elsewhere since the panel opened

- **WHEN** a code was not in the table when the panel opened but was added on the server since
- **THEN** the form's mappings SHALL be appended to it as stored now, because the merge uses a fresh fetch

### Requirement: All codes are sent in one request to the RDM lookups endpoint

The extension SHALL send `POST {serviceUri}/lookups/{rdmTenantId}` once per submission, with the environment bearer token. It SHALL NOT use `…/lookups/{rdmTenantId}/_update`, which is a partial-update endpoint that does not create codes. The body SHALL be an array of plain lookup objects — not wrapped in `{ uri, value }` — one per code with something to send, in form order. An existing code SHALL be sent as its merged stored value (previous requirement). A new code SHALL be shaped:

```json
{ "tenantId": "{rdmTenantId}", "type": "{lookupTypeUri}", "code": "{code}", "enabled": true,
  "sourceMappings": [ { "source": "…", "values": [ { "code": "…", "value": "…", "enabled": true,
                        "canonicalValue": …, "downStreamDefaultValue": … } ] } ],
  "startDate": 0, "endDate": 0 }
```

The RDM tenant and lookup type URI SHALL come from the context the extension recorded when it rendered the panel, never from the panel's message. For a new code, `updatedBy`, `updateDate` and `version` SHALL NOT be sent: they describe a prior revision, which a new value does not have, and the extension SHALL NOT invent the user's identity or a timestamp. An existing code carries them back exactly as fetched. A mapping whose code was left blank SHALL use its block's code.

#### Scenario: Request for the supplied example

- **WHEN** the user adds code `PRIMARY` to `AddressTypes` with mappings `ReltioCleanser` → `PRIMARY` / `Primary` (canonical) and `DnB` → `PRIM` / `Prim`
- **THEN** the request SHALL target `{serviceUri}/lookups/{rdmTenantId}`
- **AND** its body SHALL be a one-element array whose element has `tenantId` `{rdmTenantId}`, `code` `PRIMARY`, `type` equal to the lookup type's own URI, and the two mappings in that order

#### Scenario: Several codes in one request

- **WHEN** the user submits three valid new codes
- **THEN** exactly one request SHALL be sent
- **AND** its body SHALL hold three elements, in the order the blocks appear in the form

#### Scenario: The panel cannot redirect the write

- **WHEN** a panel message carries any field naming a tenant, RDM tenant or lookup type
- **THEN** the extension SHALL ignore that field and use the context of the render the form belongs to

#### Scenario: Untrusted service host refused

- **WHEN** the RDM service URI resolves to a host outside the trusted-host allowlist
- **THEN** no request SHALL be sent and the refusal SHALL be reported in the panel

### Requirement: The panel shows what the server stored

After the request, the extension SHALL re-fetch the lookup type's values and treat a submitted code as stored when the re-fetch, or the response (one `{ uri, value }` per stored code), holds the code with **every** mapping the submission asked to add, matched by source and code at the source; anything else in the response SHALL be ignored. The same rule SHALL apply to new codes and to existing codes that were appended to. A code the response lists but the re-fetch does not yet show SHALL be reported as added, with a note that it may take a moment to appear in the table. When the re-fetch succeeds, the panel SHALL be re-rendered from it; codes that were added SHALL leave the form, and codes that were not SHALL remain in it as the user entered them, with the reason. When every code was added, the form SHALL close and the panel SHALL say how many values were added. While a submission is in flight, the form SHALL NOT allow a second submission.

#### Scenario: All codes added

- **WHEN** the request succeeds and the re-fetch contains every submitted code
- **THEN** the panel SHALL show the re-fetched values, including the new codes
- **AND** the form SHALL be closed, with a note of how many values were added

#### Scenario: Stored but not yet visible

- **WHEN** the response lists `MAILING` as stored but the re-fetch does not contain it yet
- **THEN** `MAILING` SHALL be reported as added and SHALL NOT stay in the form
- **AND** the panel SHALL say it may take a moment to appear in the table

#### Scenario: Accepted but not stored

- **WHEN** the request succeeds but neither the response nor the re-fetch lists `Partner`
- **THEN** the form SHALL keep the `Partner` block, and the panel SHALL say the service accepted the request but did not store it

#### Scenario: Some codes not stored

- **WHEN** the re-fetch after the request contains `HOME` and `WORK` but not `MAILING`
- **THEN** the table SHALL show `HOME` and `WORK`
- **AND** the form SHALL hold only the `MAILING` block, as entered, with the service's error detail or a note that the service did not store it

#### Scenario: Service error with nothing stored

- **WHEN** the service rejects the request with an error body and the re-fetch contains none of the submitted codes
- **THEN** the panel SHALL show the service's error detail
- **AND** the form SHALL still hold every block the user entered

#### Scenario: Outcome cannot be confirmed

- **WHEN** the re-fetch after the request fails
- **THEN** the panel SHALL NOT be re-rendered
- **AND** the form SHALL keep every block, and the panel SHALL say that what was stored could not be confirmed

#### Scenario: Panel moved on during submission

- **WHEN** Get Lookup Values replaced the panel's content while a submission was in flight
- **THEN** the extension SHALL NOT re-render the panel for the earlier lookup type
- **AND** it SHALL report in a notification which codes were added and which were not

#### Scenario: Double submission prevented

- **WHEN** the user activates Submit twice in quick succession
- **THEN** exactly one request SHALL be sent

#### Scenario: Session expired

- **WHEN** any request made for the submission returns HTTP 401
- **THEN** the extension SHALL invoke the same session-expiry handling used by other unauthorized Reltio responses for that environment
- **AND** the form SHALL keep every block

### Requirement: The panel's script is held to the repository's webview rules

The lookup values panel SHALL run at most one script, carrying a per-render nonce, under a policy that allows nothing but nonce-gated styles and scripts. It SHALL load no local resources and SHALL contain no inline event handlers. The script SHALL accept messages from the extension only from the origin it observed when it started. Every lookup value, code and source — in the table, in the form's suggestions, and in blocks restored after a refresh — SHALL be rendered as inert text.

#### Scenario: Policy permits only nonce-gated styles and scripts

- **WHEN** the panel HTML is produced
- **THEN** its content security policy SHALL be `default-src 'none'` with only a nonce-gated `style-src` and a nonce-gated `script-src`
- **AND** every `<style>` and `<script>` element SHALL carry the matching nonce

#### Scenario: No inline handlers

- **WHEN** the panel HTML is produced
- **THEN** no element SHALL carry an `on…` event attribute

#### Scenario: Markup in lookup data stays inert

- **WHEN** a code, source or value contains markup such as `<img src=x onerror=alert(1)>`
- **THEN** it SHALL appear as visible text and SHALL NOT be interpreted as markup, in the table, in the form's suggestions, or in a restored block

#### Scenario: Messages from another origin ignored

- **WHEN** the panel's script receives a message whose origin differs from the one it observed at start
- **THEN** it SHALL ignore the message
