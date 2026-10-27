## Why

`rdm-tree-view` shows which lookup *types* a tenant defines, but a lookup type is only a name and a URI — the reference data that matters is the codes underneath it and how each source spells them. Answering "what values does `AddressTypes` allow, and what does Salesforce call them?" currently means leaving the IDE for the Reltio UI or a REST client.

Those values are deliberately **not** in the RDM configuration file: `GET {serviceUri}/configuration/{rdmTenantId}` returns type definitions only. The values come from a separate endpoint, one lookup type at a time — which is also why fetching them eagerly for every type would be wrong. A tenant with dozens of lookup types would pay dozens of round trips on every configuration fetch to populate data the user may never open.

## What Changes

- New command **Get Lookup Values**, offered on right-click of a lookup type row in the RDM sub-tree, and nowhere else.
- New API function `fetchRdmLookupValues(serviceUri, rdmTenantId, lookupTypeName)` → `GET {serviceUri}/lookups/{rdmTenantId}/{lookupTypeName}`, reusing the existing client conventions and the same environment bearer token.
- New webview panel rendering the response as a table of **Code**, **Source**, and **Value at Source**, following the nonce-CSP and `escapeHtml` pattern already established by `entityDetailPanel`.
- The RDM service URI, currently discovered and discarded during fetch, becomes reachable at command time: cached in memory per tenant when a fetch discovers it, and re-discovered from the tenant physical configuration when the cache is cold.
- Values are fetched **on demand only** — no eager loading, no change to what Get Configuration does.

## Capabilities

### New Capabilities

- `rdm-lookup-values`: the on-demand lookup-value fetch — command placement and scoping, the endpoint and how its URL is built, resolution of the service URI at command time, the flattening of the nested response into table rows, panel presentation and reuse, and behaviour for empty, partial and failed responses.

### Modified Capabilities

- `rdm-configuration-fetch`: the requirement that the tenant physical configuration is consumed in memory and never persisted is extended to state that the **service URI alone** may be retained in memory for the session, so a later lookup-value fetch need not rediscover it. Nothing else from that response may be retained, and nothing is written to disk.

## Impact

- `src/api/reltioClient.ts` — `fetchRdmLookupValues()`; the `RdmLookupValue` response shape.
- `src/model/types.ts` — `RdmLookupValue`, `RdmSourceMapping`, `RdmSourceValue`, and the flattened `RdmLookupValueRow`.
- `src/rdm/lookupValuesPanel.ts` — new; renders the table, mirroring `entityDetailPanel`'s CSP, escaping and panel-reuse structure.
- `src/rdm/rdmServiceCache.ts` — new; in-memory service-URI cache keyed by environment and tenant.
- `src/extension.ts` — registers `reltio.getRdmLookupValues`; resolves the service URI (cache, then physical configuration); 401 routed to the existing `handle401`.
- `src/tree/multiTenantNodes.ts` — the lookup-type row carries the lookup type name so the command need not re-derive it from the URI.
- `package.json` — one command and one `view/item/context` entry scoped to `reltio.rdm.item.lookupTypes`.
- `samples/rdm-lookup-values.sample.json` — sanitized fixture from the supplied response.
- `scripts/test-rdm-lookup-values.cjs` — new, registered in `scripts/run-unit-tests.cjs`.
- `ARCHITECTURE.md` — the new endpoint, the panel, and the service-URI cache.
- No new dependencies. No change to fetch, write, baselines, or the RDM schema.

**Explicitly unchanged:** sources rows get no command — the endpoint is per lookup type. The RDM sub-tree stays read-only; this adds a read, not an edit.
