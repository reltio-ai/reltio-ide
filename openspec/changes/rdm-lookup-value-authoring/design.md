## Context

`rdm-lookup-values` added **Get Lookup Values**: `GET {serviceUri}/lookups/{rdmTenantId}/{lookupTypeName}` flattened into a Code / Source / Value at Source table in a reusable webview panel. That panel was built with `enableScripts: false` and a policy of `default-src 'none'; style-src 'nonce-…'`, because a static table needed no script.

The RDM service accepts new and changed values at `POST …/lookups/{rdmTenantId}/_update`. The body is an array; the supplied example holds one element, for address type `PRIMARY`:

```json
[{
  "uri": "<RDM_TENANT_ID>/AddressTypes/PRIMARY",
  "value": {
    "tenantId": "FDETeamRDM",
    "type": "rdm/lookupTypes/AddressTypes",
    "code": "PRIMARY",
    "enabled": true,
    "sourceMappings": [
      { "source": "ReltioCleanser", "values": [ { "code": "PRIMARY", "value": "Primary", "enabled": true, "canonicalValue": true,  "downStreamDefaultValue": true } ] },
      { "source": "DnB",            "values": [ { "code": "PRIM",    "value": "Prim",    "enabled": true, "canonicalValue": false, "downStreamDefaultValue": true } ] }
    ],
    "startDate": 0, "endDate": 0,
    "updatedBy": "rudranath.banerjee@reltio.com", "updateDate": 1793091612507, "version": 2
  }
}]
```

Constraints from the codebase:

- `main` hardened its webviews (`harden-ontology-webview-messaging`, `csp-nonce-hardening`): nonce-only scripts, a narrow `localResourceRoots`, the webview checking the origin of messages it receives (`isTrustedMessageOrigin`), and the extension validating each message's `type` and field types before acting.
- The service URI is resolved through `resolveRdmServiceUri` (in-memory cache, else rediscovery) and every base URL passes through `toHttpsBase()`'s trusted-host allowlist.
- The lookup values panel is a single reused panel: running Get Lookup Values on another lookup type replaces its content.

## Goals / Non-Goals

**Goals:**

- Add several new codes, each with any number of source mappings, from the panel that already shows the lookup type, in one screen and one submission.
- Never overwrite an existing value by accident.
- Report exactly which codes the server stored, including when only some of them were stored.
- Keep the panel as safe with a script as it was without one.

**Non-Goals:**

- **Editing or deleting existing values.** The same endpoint could do it, but changing a live code's mappings is a different and riskier operation; it deserves its own change and its own safeguards.
- **Adding a source mapping to an existing code.** The endpoint replaces the whole value, so this is an edit of an existing value — see above.
- **Importing codes from a file or a pasted spreadsheet.** The form takes several codes, but each is entered by hand. Import needs its own column mapping and error reporting, and can build on this change's validation and request path.
- **Persisting values locally.** The layout's RDM README anticipates a `LookupMappings.json`; values remain server-owned and fetched on demand.

## Decisions

### D1: An inline form of code blocks, with the panel's script enabled deliberately

The **Add Value** button reveals a form above the table. The form holds one **block per new code**: the code, then a mapping table with one row per source mapping and controls to add and remove rows. **Add Code** appends another block, and each block has its own remove control. Submit and Cancel sit at the foot of the form and act on all blocks together.

This needs the panel to run a script, reversing `rdm-lookup-values`' `enableScripts: false`. The script is held to the repository's existing webview rules:

- one `<script>` element carrying the per-render nonce, and a policy of `default-src 'none'; style-src 'nonce-…'; script-src 'nonce-…'` — nothing else is allowed to load;
- `localResourceRoots: []`, since the panel loads no files;
- no inline event handlers (the policy would block them anyway); blocks and rows are built with DOM APIs, and every value is set as text or as an input's value, never as markup;
- messages from the extension accepted only from the origin captured when the script starts, as `isTrustedMessageOrigin` prescribes.

**Alternative considered — one flat grid**, a row per mapping with rows that share a code merged into one value. It is compact and mirrors the read table, but the grouping is implicit: a typo in a code silently splits one value into two, and "the first row is canonical" becomes a rule about row order. Blocks make each value's boundary explicit.

**Alternative considered — an untitled JSON editor holding the request body, submitted from the editor title bar:** follows the repository's `no-create-wizards` editor-first rule and shows the real JSON. Chosen against, as a product decision, for a single-screen flow. `no-create-wizards` is about configuration files the user owns; lookup values have no local file, so the panel is their only representation.

### D2: The extension owns every identifier; the webview sends only the values

The webview posts `{ type: 'submitLookupValues', render, values: [{ code, mappings: [{ source, code, value, canonicalValue, downStreamDefaultValue }] }] }`, plus `{ type: 'ready', render }` when its script starts (D7). Nothing else is accepted.

The environment, tenant, RDM tenant, lookup type name and lookup type URI come from the context the extension recorded when it rendered the panel. A stale or tampered message can therefore never redirect a write to another tenant or lookup type. The context is captured per render, and a submission uses the context of the render its form belongs to.

`render` is a random token generated for each render and placed on the page. Because the panel is reused, a message posted by a page just before it was replaced can arrive after the replacement; the extension honours a message only when its token is the current render's, so such a message is dropped rather than applied to the lookup type now on screen. The token selects nothing — it can only match the current render or be ignored.

Every inbound message is validated by a pure function before anything else happens. An unknown `type`, a missing field, or a field of the wrong type is rejected and never reaches the network.

### D3: One request for the whole batch, built by the extension, with server-managed fields omitted

> **Revised in Bugfix Round 1** — the body below is the *create* body (D8). The first version sent the supplied example's `[{ "uri", "value": {…} }]` wrapper to `_update`; that wrapper is the shape the service *returns*, and `_update` does not create codes.

For a valid submission the extension sends a single request whose body has one element per code, in form order:

```json
[{ "tenantId": "{rdmTenantId}", "type": "{lookupTypeUri}", "code": "{code}", "enabled": true,
   "sourceMappings": [ { "source": "…", "values": [ { "code": "…", "value": "…", "enabled": true,
                         "canonicalValue": …, "downStreamDefaultValue": … } ] } ],
   "startDate": 0, "endDate": 0 },
 …]
```

`type` is the lookup type's own `uri` from the RDM configuration, carried from the tree node, rather than one rebuilt from its name.

`updatedBy`, `updateDate` and `version` are **omitted**. In the example they record who last changed an existing value and which revision it was; for a new value there is no prior revision, and the extension would have to invent the user's identity and a timestamp. They are left to the server; the documented create body (D8) does not include them either.

**Alternative considered — one request per code:** each code's outcome would be unambiguous, but N round trips leave the same partial states to handle, and the endpoint already takes an array. D7's reconciliation gives a per-code outcome from a single request.

### D4: Only new codes, checked against the server immediately before posting

`_update` replaces a value. Submitting a code that already exists would therefore discard its current source mappings and keep only those in the form. The extension refuses this.

The check is made against a **fresh** fetch taken just before the post, not against the table on screen, which may be minutes old. This mirrors the pre-flight that Apply uses for configuration. A code is treated as existing on an exact match, because the RDM service, not the IDE, decides whether codes are case-sensitive.

If **any** code in the batch exists, **nothing** is sent, and the refusal names every existing code. Sending only the new ones would leave the user to work out which part of their batch went through; refusing the whole batch keeps the outcome simple, and removing the named blocks is one click each.

If `_update` turns out to merge rather than replace, this refusal is merely conservative. It never risks data either way.

### D5: Endpoint `POST {serviceUri}/lookups/{rdmTenantId}`

> **Revised in Bugfix Round 1** — was `…/_update` (D8). The reasoning below about the base URL still holds, and is now confirmed: the team's working request posts to `{{rdmURL}}/lookups/{{rdmTenant}}/`, where `{{rdmURL}}` is the service URI with no `/rdm` segment.

The original inference, kept for the base-URL reasoning, was drawn from two observations. The working read is `{serviceUri}/lookups/{rdmTenantId}/{lookupTypeName}`. The supplied write example is `https://<env>-rdm.reltio.com/rdm/lookups/<Tenant>/_update`, which has the same `…/lookups/{tenant}/` suffix, so `_update` is a sibling of the read.

The service URI comes from `resolveRdmServiceUri` and passes through `toHttpsBase()`, so the trusted-host allowlist applies to this write as it does to every read. `toHttpsBase()` accepts only a bare host and returns its origin, so the write uses exactly the base the reads use. The physical configuration observed carries a bare host (`https://rdm.reltio.com`), and the configuration read was confirmed against it as `{serviceUri}/configuration/{rdmTenantId}`. The `/rdm` segment in the supplied example is therefore not added: it is taken to belong to a different way of reaching the service, and QA confirms the write against the tenant's own service URI.

A tenant whose physical configuration carried a service URI with a path would have every RDM call refused by `toHttpsBase()` — reads included. That is a property of the existing allowlist, not of this change, and is not worked around here.

### D6: Form defaults and validation

- **Code**: required and trimmed. It must not contain `/`, because it becomes the last segment of `uri`.
- **The same code twice in one batch** is rejected (exact match): two elements for one `uri` in one request have no defined order of effect.
- **At least one code**, and **at least one mapping per code**. Each mapping needs a **source** and a **value**. A mapping's code defaults to its block's code when left blank, which is the common case in the example.
- **The same source twice within one code** is rejected, as it would produce two mappings for one source. The same source across different codes is normal.
- **Defaults** for a new row: `canonicalValue` true on the first row of each block and false on the others, `downStreamDefaultValue` true. Every value and mapping is sent with `enabled` true.
- **Sources** are offered as suggestions, not a closed list: the sources this lookup type already uses, plus the sources declared in the tenant's RDM configuration on disk. Free text is accepted, because sources vary per tenant and the configuration file may be out of date. A configured source is suggested by its **`abbreviation`**, which is what a mapping's `source` must match; the trailing segment of its `uri` is used only when it has no abbreviation (*Bugfix Round 1* — the first version used the `uri` segment, which differs from the abbreviation whenever a source's URI and abbreviation differ).
- **At most 100 codes per submission** (*Bugfix Round 1*): the documented per-request maximum of the create endpoint. A larger form is rejected with a message before any request, rather than sent for the service to refuse.
- How many mappings are canonical is **not** constrained. The service owns that rule; the IDE should not invent a stricter one.

Every error names the block it belongs to by position and code (for example "Code 2 (HOME): mapping 1 has no value"), so a long form can be fixed without hunting. Validation runs only in the extension, and before any network call, so the form gets its answer as quickly as a local check would give it — and there is one rule set rather than two that can drift. Text fields are trimmed before they are checked or sent.

### D7: Outcome is reconciled against the server, and unsent codes stay in the form

Whether an array request is applied all-or-nothing is not known. After the post, the extension **re-fetches the lookup type** and compares: a submitted code that is now on the server **landed**; any other did not.

*Bugfix Round 1:* the create endpoint documents its response as one `{ uri, value }` per stored code. A code also counts as landed when that response lists it, so a re-fetch that lags the write cannot report a stored code as missing. When a code is in the response but not yet in the re-fetch, the message says it may take a moment to appear in the table. Anything in the response that is not in that shape is ignored, and the re-fetch alone decides.

- **Before posting** — a validation error or existing codes (D4): nothing is sent; the reason appears inline; the form is untouched and Submit is enabled again.
- **After posting, re-fetch succeeded**: the panel is re-rendered from the fresh fetch, so the table shows the values exactly as the server stored them. Blocks for codes that landed are gone; blocks for codes that did not are restored as the user entered them, with the reason — the service's error detail, or "not stored by the service" when it answered success but the code is absent. When every code landed, the form is closed and the panel says how many values were added.
- **After posting, re-fetch failed**: the panel is not re-rendered. The form keeps every block, and the panel shows the post's outcome and that what was stored could not be confirmed. Submitting again is safe, because D4's pre-flight refuses any code that did land.
- **401** on any request: routed to `handle401`, like every other RDM call; the form keeps every block.
- **While a submission is in flight**, Submit is disabled, so a double click cannot post twice.

Re-rendering replaces the page, and with it the form. Restoring is a handshake: the new page's script posts `ready`, and the extension answers with `restoreForm { values, message }` for that render only. The script rebuilds the blocks with the same DOM code that builds them from user input, so restored text is never parsed as markup. A pending restore is discarded once the panel has been re-rendered for anything else.

**The panel moved on during submission.** If Get Lookup Values replaced the panel's content while a submission was in flight, the extension does not re-render it back. The outcome is reported in a notification instead, naming the codes that landed and those that did not.

### D8: Codes are created with the create endpoint, not `_update` (Bugfix Round 1)

**Observed:** adding one code (`Partner`) reported "the service accepted the request but did not store Partner" — `_update` answered success, and the re-fetch did not contain the code.

**Root cause:** Reltio documents `POST {rdm}/lookups/{tenant}/_update` as a **partial update** of existing lookups: every source-mapping value carries an `operation` (`INSERT`, `UPDATE` or `DELETE`), and nothing documents it creating a code. The request carried no `operation`, so there was nothing for the service to apply. Creating codes is a separate, documented operation: `POST {rdm}/lookups/{tenant}/{type}` (or `POST {rdm}/lookups/{tenant}` for mixed types), at most 100 per request, with a plain array of lookup objects as the body and one `{ uri, value }` per stored code as the response. That response shape — `uri`, and `value` with `updatedBy`, `updateDate` and `version` — is exactly the supplied example, which was therefore a response, not a request.

**Confirmed by a working request:** the team's Bruno collection carries "Update RDM Lookup Mapping" — `POST {{rdmURL}}/lookups/{{rdmTenant}}/` with a bearer token and a plain JSON array of lookup objects (`tenantId`, `type`, `code`, `enabled`, `sourceMappings[].values[]` with `code`, `value`, `enabled`, `canonicalValue`, `downStreamDefaultValue`, optionally `description`; `startDate` / `endDate` 0), mixing several lookup types in one array. Its elements carry whole values that already exist (with `version` 1 and 2), and the request is named an *update*: posting a code that exists **replaces** its stored value, mappings included. This answers the open question about existing codes, and makes D4's refusal essential rather than conservative.

**Decision:** post to `POST {serviceUri}/lookups/{rdmTenantId}` — the endpoint of that working request and the documented "create codes of different types" form — with the D3 body. `startDate` / `endDate` are sent as 0, as in the working request, which is how stored values report "no bound". `updatedBy` / `updateDate` / `version` are not sent: in that request they are carried over from an export, and the server owns them. D4's pre-flight stays and now guards against a known replace.

The per-type form `POST {serviceUri}/lookups/{rdmTenantId}/{lookupTypeName}` was considered first. It is documented too, but the tenant-level form is the one proven against the team's tenants.

The working request ends the path with `/`; the documented form does not. The extension uses the documented form, and QA confirms it.

**Alternative considered — keep `_update` and add `"operation": "INSERT"` to each value:** undocumented for a code that does not exist yet, and it would make a create depend on partial-update semantics. Rejected.

References: [RDM Lookups API](https://docs.reltio.com/developer-resources/reference-data-management-apis/reference-data-management-apis-at-a-glance/rdm-api/rdm-lookups-api), [Partial update in RDM lookups](https://docs.reltio.com/developer-resources/reference-data-management-apis/reference-data-management-apis-at-a-glance/rdm-api/partial-update-in-rdm-lookups).

## Risks / Trade-offs

- **[Risk]** The service may require `updatedBy` / `updateDate` / `version` even for a new value (D3) → **Mitigation**: the first manual QA step. If it does, the error detail surfaces in the panel with every code kept, and the body builder is the single place to change.
- **[Risk]** The endpoint path is inferred (D5) → **Mitigation**: it follows from the working read path and the supplied example; QA confirms it on a live tenant.
- **[Risk]** A batch may be applied partly → **Mitigation**: reconciliation against a fresh fetch (D7) reports per code whatever the service did, and leaves only the codes that did not land in the form.
- **[Risk]** Enabling a script widens the panel's attack surface → **Mitigation**: nonce-only policy, no local resources, no inline handlers, origin-checked inbound messages, extension-side validation of every outbound field, and Tier B tests that pin the policy and assert lookup data is rendered inert.
- **[Risk]** Two users add the same code at the same moment → **Mitigation**: the fresh pre-post fetch narrows the window to the request itself; the service is the final arbiter.
- **[Trade-off]** Refusing the whole batch when one code exists (D4) costs a resubmission → accepted for a simple, unambiguous outcome.
- **[Trade-off]** A one-screen form is less transparent than editing the raw JSON (D1). Accepted as a product decision; the raw response stays available in the panel's collapsed section.

## Migration Plan

Additive. No stored state, file format or command changes. Rollback is a revert: the button disappears and the panel returns to read-only.

## Open Questions

- ~~Does `_update` accept a new value without `updatedBy`, `updateDate` and `version`?~~ Superseded by D8: codes are created with the create endpoint, whose documented body has no server-managed fields.
- Does the create endpoint apply an array all-or-nothing, and how does it report a rejected element? (D7 does not depend on the answer; QA records it.)
- ~~Does the create endpoint reject or replace a code that already exists?~~ It replaces: the team's working "Update RDM Lookup Mapping" request uses it to update existing values (D8). D4 refuses existing codes before posting.

## Test plan

| Tier | Script / Method | What it covers |
|------|------------------|-----------------|
| A (automated) | `scripts/test-rdm-lookup-value-authoring.cjs` | Batch validation: accepts a valid batch of one and of several codes; rejects no codes, missing code, `/` in code, the same code twice, a code without mappings, a mapping without source or value, the same source twice within a code, wrong field types, unknown message types, non-object input; accepts the same source across codes; errors name block position and code. Body construction: one element per code in form order; the `PRIMARY` example matches the D3 shape minus server-managed fields; uses the carried lookup type URI; a blank mapping code defaults to its block's code. Existing-code check returns every existing code by exact match. Reconciliation splits submitted codes into landed and not landed against a fetched response |
| B (automated) | same script | Rendered panel: one nonce'd `<script>`; policy is exactly `default-src 'none'`, nonce'd `style-src` and `script-src`, nothing else; no `on…=` attributes anywhere; Add Value, Add Code, Submit and Cancel present; a lookup value containing markup or quotes is rendered inert; the script checks message origin and builds rows without `innerHTML`. `postRdmLookupValues` builds `{serviceUri}/lookups/{rdmTenantId}/_update`. No new command is contributed |
| C (manual QA) | Extension Development Host against a live tenant | Add one code with two source mappings; confirm the service accepts the body without server-managed fields. Add three codes in one submission; confirm the table shows all three and the form closes. Include one existing code; confirm nothing is sent and it is named. Force a partial outcome if the service allows (e.g. a code it rejects) and confirm only that block stays. Break a field and confirm the inline error with the form intact. Expire the token and confirm the re-login flow. Switch the panel to another lookup type mid-submission and confirm the notification |
