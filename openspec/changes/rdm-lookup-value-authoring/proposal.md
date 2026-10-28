## Why

**Get Lookup Values** shows a lookup type's codes and how each source spells them, but adding codes still means leaving the IDE for the Reltio UI or a REST client. That is the one step missing between reading reference data and maintaining it. RDM authoring today covers the configuration document — new lookup types and sources — but not the values inside a lookup type.

Values are not stored in any local file: they live on the RDM service and are fetched on demand into the lookup values panel. The panel is therefore the natural and only place to add them. New codes usually arrive in sets — a new country's address types, a source's whole code list — so adding them one at a time would be the bottleneck.

## What Changes

- An **Add Value** button on the lookup values panel opens an inline form holding one or more new codes. Each code has its own rows of source mappings — source, code at the source, value, canonical, downstream default. **Add Code** adds another code to the form; codes and rows can be added and removed in place.
- **Submit** sends every code in the form, up to 100, in one `POST {serviceUri}/lookups/{rdmTenantId}` — the endpoint the team already uses to load lookup mappings — with a body built by the extension. (Not `…/_update`: that is Reltio's partial-update endpoint and does not create codes; see design D8.)
- After submitting, the extension compares the service's response and a re-fetch of the lookup type: the table shows what the server stored, codes that landed leave the form, and codes that did not stay in it with the reason. A partial outcome is reported as partial, never as success or failure of the whole batch.
- A code that **already exists** gets the form's mappings **appended** (design D9). Posting a code replaces its whole stored value, so the extension sends the freshly fetched value with every field and mapping as stored, plus only the mappings it lacks. Nothing stored is changed or removed. A mapping already stored is skipped. A mapping that contradicts a stored one (same source and code at the source, different value) refuses the submission, naming both values.
- The panel gains a script for the first time: nonce-gated under a `default-src 'none'` policy, with no inline handlers, no local resources, origin-checked messages from the extension, and every message from the webview validated by the extension before it is used.
- **Reverses** the non-goal "Editing lookup values" recorded in `rdm-lookup-values` and `rdm-configuration-authoring`: this adds writing new values and appending mappings to existing ones. Changing or deleting stored mappings remains out of scope.

## Capabilities

### New Capabilities

- `rdm-lookup-value-authoring`: adding one or more new lookup values from the lookup values panel — the form and its validation, the request body and endpoint, appending to existing codes without changing what is stored, reconciling what the server stored, failure handling, and the safety rules for the panel's script and messages.

### Modified Capabilities

_None._ The `rdm-lookup-values` requirements stay true as written: values are still fetched only on request, the panel still declares a `default-src 'none'` policy with nonce-gated styles and scripts, and every value is still escaped. The read-only stance this change reverses was a design non-goal, not a requirement.

## Impact

- `src/rdm/lookupValueDraft.ts` — new; pure validation of a submitted batch, construction of the request body, the existing-code check, and reconciliation against the response and a re-fetch, with no `vscode` import.
- `src/rdm/lookupValuesPanel.ts` — the Add Value form, its script, the message protocol, and restoring unsent codes after a refresh; scripts enabled with `localResourceRoots: []`.
- `src/api/reltioClient.ts` — `postRdmLookupValues(serviceUri, rdmTenantId, body, token)`.
- `src/extension.ts` — the panel's message handler: resolve the service URI, re-fetch, refuse existing codes, post, reconcile, refresh; 401 → `handle401`.
- `src/tree/multiTenantNodes.ts` / `src/tree/rdmSubtree.ts` — the lookup type's URI carried to the panel so the request's `type` is the server's own value rather than a reconstruction.
- `scripts/test-rdm-lookup-value-authoring.cjs` — new, registered in `scripts/run-unit-tests.cjs`.
- `ARCHITECTURE.md` — the endpoint, the form, and the panel's message protocol.
- No new command and no new dependency.
