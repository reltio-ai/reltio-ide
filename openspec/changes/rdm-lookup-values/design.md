## Context

After `rdm-configuration-fetch` and `rdm-tree-view`, a tenant's RDM configuration is on disk and browsable as `RDM → {rdmTenantId} → Lookup Types / Sources`. Each lookup type row is a leaf carrying a `uri` such as `rdm/lookupTypes/AddressTypes`.

The values behind a lookup type come from a different endpoint — `GET {serviceUri}/lookups/{rdmTenantId}/{lookupTypeName}` — and its response is nested two levels deep:

```
[ { code, type, enabled, sourceMappings: [ { source, values: [ { code, value, … } ] } ], … } ]
```

The supplied sample (`AddressTypes`) has 7 codes × 4 sources = 28 flattened rows, with exactly one value per source. That regularity is a property of one lookup type in one tenant, not of the format: `values` is an array and may hold none or several.

Two existing constraints shape the design.

**The service URI is discovered but discarded.** `rdm-configuration-fetch` D4 fetches the tenant physical configuration, extracts `rdmConfig`, and keeps nothing — deliberately, because that response carries messaging credentials and storage service accounts. But the lookups endpoint needs `serviceUri`, and the command runs long after the fetch.

**Webviews in this repo are CSP-hardened.** `csp-nonce-hardening` and `harden-ontology-webview-messaging` established the pattern that `entityDetailPanel` follows: `default-src 'none'`, nonce-gated `style-src`/`script-src`, and `escapeHtml` on every interpolated value.

## Goals / Non-Goals

**Goals:**

- One right-click on a lookup type shows its codes and per-source values, without leaving the IDE.
- Nothing is fetched until the user asks for a specific lookup type.
- The table answers the question directly: Code, Source, Value at Source.
- The panel is as safe as the existing ones — no inline script or style without a nonce, every value escaped.
- A lookup type with no values, or a source with none, reads as empty rather than broken.

**Non-Goals:**

- **Editing lookup values.** Read-only, consistent with the rest of the RDM sub-tree — nothing is PUT to the RDM service.
- **Caching values on disk.** They are fetched per invocation; no file is written and no baseline exists for them.
- **Prefetching or a values sub-tree.** Expanding a lookup type into value nodes would reintroduce the eager-loading cost this design exists to avoid.
- **A command on sources rows.** The endpoint is keyed by lookup type; a source has no equivalent call.
- **Surfacing `enabled`, `canonicalValue`, `downStreamDefaultValue`.** The three requested columns answer the question; see D5 for why the rest stays out of the table but not out of reach.

## Decisions

### D1: Resolve the service URI from an in-memory cache, falling back to rediscovery

A session-scoped `Map` keyed by `{environmentName}::{tenantId}` holds the service URI, written whenever `writeRdmFromApi` discovers one. The command reads the cache; on a miss it fetches the tenant physical configuration again and populates it.

This keeps the guarantee that matters — the physical configuration response is never persisted and nothing but the service URI outlives the call — while avoiding a redundant round trip in the common case where the user fetches and then explores.

**Alternative considered — always rediscover:** simplest and stateless, but it doubles the request count for every lookup the user opens, on an interaction meant to feel immediate.

**Alternative considered — persist `serviceUri` to disk beside the RDM file:** rejected. It would survive reloads, but it introduces a second source of truth for a value the server owns, and it starts down the path of persisting parts of a response the previous change deliberately kept off disk.

The cache is intentionally not invalidated on a timer: a tenant's RDM service host is stable, and a stale entry surfaces as a failed request the user can retry, not as silently wrong data.

### D2: Flatten to one row per (code, source, value)

The table is the cross product the response already describes: for each entry, for each `sourceMappings[]`, for each `values[]`, emit `{ code, source, valueAtSource }`. Rows are ordered as the response orders them — codes in server order, sources within a code in server order — because that order reflects how Reltio itself presents them and re-sorting would obscure it.

Two degenerate cases are specified rather than left to chance, since the sample exhibits neither:

- A source mapping with an **empty `values` array** still emits one row, with an empty Value at Source. Dropping it would hide that the source is mapped but unpopulated — a meaningful state.
- An entry with **no source mappings** emits one row with empty Source and Value at Source, so the code is still visible.

**Alternative considered — nested rendering (a sub-table per code):** closer to the payload's shape, but the question being asked is "which source says what", which a flat, scannable table answers better.

### D3: Lookup type name comes from the node, not from re-parsing the URI

`RdmItemNode` gains the lookup type name at construction, taken from the same `uri` tail the label already derives. The command then has it directly.

The URL is built as `{toHttpsBase(serviceUri)}/lookups/{encoded rdmTenantId}/{encoded lookupTypeName}`. Passing `serviceUri` through `toHttpsBase()` keeps the trusted-host allowlist in force, which matters because that host came from a server response.

### D4: A single reusable panel, retitled per lookup type

One panel instance is reused and its title set to the lookup type name, exactly as `entityDetailPanel` reuses `currentPanel`. Opening a second lookup type replaces the contents rather than accumulating tabs — the panel is a viewer, not a document, and a user comparing two lookup types is better served by the tree than by tab management.

### D5: The table shows three columns; the raw response stays available

Code, Source and Value at Source are the table. `enabled`, `canonicalValue` and `downStreamDefaultValue` are real but secondary, and adding three more columns would dilute the one the user asked for.

They are not discarded: the panel includes the pretty-printed raw JSON in a collapsed `<details>`, the same affordance `entityDetailPanel` provides. Anyone needing a flag can see it without another tool, and the table stays readable.

### D6: Failures are reported, never rendered as an empty table

A failed request leaves any currently open panel untouched and reports the error through a notification. An empty but successful response opens the panel and states that the lookup type has no values.

Rendering an empty table for a failed call is the specific outcome to avoid: it reads as "this lookup type has no values", which is a factual claim the extension has no basis for making. A 401 from the lookups endpoint routes to the existing `handle401`, like every other Reltio call.

### D7: Presentation follows `entityDetailPanel` rather than abstracting over it

The new panel copies that module's structure — nonce generation, the `default-src 'none'` CSP, `escapeHtml` on every interpolation, VS Code theme variables for styling.

**Alternative considered — extracting a shared panel/table helper first:** rejected for now. Two panels with similar scaffolding is not yet duplication worth a shared abstraction, and factoring `entityDetailPanel` apart would put a working, recently-hardened module at risk for no behavioural gain. Worth revisiting at a third panel.

## Risks / Trade-offs

- **[Risk]** A lookup type with many codes across many sources produces a large table (rows = codes × sources) → **Mitigation**: accepted for now; the panel is plain HTML with no virtualization, and the realistic ceiling for reference data is hundreds of rows, not thousands. If it bites, the raw-JSON `<details>` still works and pagination is a contained follow-up.
- **[Risk]** The in-memory service-URI cache is empty after a window reload, so the first lookup of a session pays a rediscovery round trip → **Mitigation**: correct by construction rather than a bug — the fallback exists precisely for this, and the cost is one extra request once per tenant per session.
- **[Risk]** Rediscovery calls `GET /reltio/tenants/{tenantId}`, which `test-replace-tenants-with-enhanced-tenants` currently flags as a retired, internally-restricted endpoint → **Mitigation**: none available here. This change inherits the open question from `rdm-configuration-fetch` rather than adding to it; if that endpoint proves inaccessible to external users, both changes need the same replacement discovery source.
- **[Risk]** The flattening was designed against a single lookup type whose sources each had exactly one value → **Mitigation**: the multi-value and zero-value paths are specified (D2) and covered by constructed test inputs rather than only by the fixture, so the code does not encode that sample's regularity.
- **[Trade-off]** No disk cache means reopening the same lookup type refetches it. Accepted: values are server-owned reference data with no baseline, and a stale local copy would be worse than a short wait.

## Migration Plan

Purely additive. No file formats, stored state or existing commands change, and a tenant that never right-clicks a lookup type sees no difference. Rollback is a plain revert: the command disappears and the RDM sub-tree returns to browse-only.

## Open Questions

None blocking. One to settle from real use: whether the three columns suffice, or whether `enabled` earns a place for lookup types where disabled codes are common. The raw-JSON section makes that answerable from experience rather than up front.

## Test plan

| Tier | Script / Method | What it covers |
|------|------------------|-----------------|
| A (automated) | `scripts/test-rdm-lookup-values.cjs` | Flattening the sanitized fixture yields one row per (code, source, value) with counts derived from the fixture, not hard-coded; response order is preserved; a constructed source with **several** values yields one row each; an **empty** `values` array yields one row with an empty value; an entry with **no** `sourceMappings` yields one row with empty source and value; a non-array response yields no rows rather than throwing |
| A (automated) | same script | URL construction: `{serviceUri}/lookups/{rdmTenantId}/{lookupTypeName}`, with both path segments encoded, and a scheme-less service URI normalized to `https://` |
| B (automated) | same script | The rendered HTML sets a `default-src 'none'` CSP with a nonce on every `<style>`/`<script>`; a lookup value containing `<script>` or quotes appears escaped and not as live markup; `package.json` contributes `reltio.getRdmLookupValues` with a menu entry scoped to `reltio.rdm.item.lookupTypes` and **not** to sources, roots or the group |
| C (manual QA) | Extension Development Host against a live tenant | Right-click a lookup type → **Get Lookup Values** opens a panel titled with that type, showing Code / Source / Value at Source; right-click a source, an RDM tenant row, and the RDM group → the command is **absent**; a lookup type with no values shows the empty-state message, not a blank table; with an expired token the 401 reaches the re-login flow; opening a second lookup type reuses the same panel and retitles it |
