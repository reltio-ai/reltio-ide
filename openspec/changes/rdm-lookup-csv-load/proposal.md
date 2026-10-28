## Why

Reference data usually arrives as a spreadsheet: a lookup type's codes and how each source spells them. **Add Value** in the lookup values panel adds codes by hand, which suits a few but not a source's whole code list. Teams load these lists today with REST clients and hand-built JSON, which is slow and easy to get wrong: a mistyped code, or a code that already exists, silently replaces mappings the tenant depends on.

The IDE's agents can already read a workspace and talk to the user. What they cannot do is reach the tenant: they never hold the user's session. This change gives them a safe way to load a CSV into an RDM lookup type, with the extension doing every network call and the user approving every write in the IDE.

## What Changes

- A new bundled agent skill, **`reltio-rdm-lookup-values-from-csv`**, installed by the existing agent-asset sync for Claude Code (`.claude/skills/`) and Cursor (`.cursor/skills/`). It is used from an agent conversation only. No command or palette entry is added.
- **CSV format.** The file is named after the lookup type (`MaritalStatuses.csv` loads into `MaritalStatuses`). Required columns: `Code`, `Source`, `Value at Source` — the same columns Get Lookup Values shows. Optional columns: `Code at Source`, `Canonical`, `Downstream Default`. Rows sharing a `Code` form one lookup value, with one source mapping per row.
- **Value at Source sets both the source's code and its value**, so source data arriving with that value is transcoded to the canonical code. `Code at Source`, when present, sets the source's code separately.
- **A new file bridge**, `.reltio/reltio-agent/rdm-lookup-load/`, alongside the match verification bridge. The agent writes `request.json` naming the CSV and the tenant's RDM configuration file. The extension parses and checks the CSV, works out the environment, tenant, RDM tenant and lookup type itself, calls the RDM service with the user's session, and writes `result.json`.
- **Two steps: plan, then load.** A plan is read-only: it reports which codes are new, which already exist, and any errors or warnings, with CSV line numbers. A load repeats the plan against a fresh fetch, then shows a **modal dialog in the IDE** naming the tenant, lookup type and counts. Nothing is written unless the user clicks **Load** there; the agent alone can never write.
- **Existing codes are skipped and reported.** Posting a code that already exists would replace its mappings, so only new codes are sent. Rerunning a load is therefore safe.
- New codes are sent with the same request Add Value uses, `POST {serviceUri}/lookups/{rdmTenantId}`, in chunks of at most 100. Each code's outcome is judged from the response and a re-fetch.
- A setting, **`reltio.enableRdmLookupLoad`** (default on), lets the user turn the bridge off.

## Capabilities

### New Capabilities

- `rdm-lookup-csv-load`: loading lookup values from a CSV through an agent skill — the CSV format and its checks, the plan/load bridge and its identity rules, the approval dialog, skipping existing codes, chunked posting and per-code results, and the bundled skill.

### Modified Capabilities

_None._ The panel's Add Value (`rdm-lookup-value-authoring`) is unchanged; this change reuses its request body, client call and reconciliation.

## Impact

- `src/rdm/lookupCsv.ts` — new, pure: CSV parsing, conversion to lookup values, checks with line numbers, plan classification, chunking and per-code outcomes. No `vscode` import.
- `src/rdm/lookupLoadBridge.ts` — new: watches the request file, resolves identity from the workspace, runs plans and loads, asks for approval, writes the result.
- `src/extension.ts` — registers the bridge with the existing session, refresh and service-URI resolution.
- `src/rdm/lookupValueDraft.ts`, `src/api/reltioClient.ts` — reused as they are.
- `package.json` — the `reltio.enableRdmLookupLoad` setting. No command, menu or dependency.
- `skills/reltio-default/rdm-lookup-values-from-csv/` — the skill. `resources/reltio-agent-assets.json` — `skillsBundleVersion` raised so existing workspaces receive it. `.cursor/skills/reltio-rdm-lookup-values-from-csv/SKILL.md` — contributor pointer.
- `scripts/test-rdm-lookup-csv-load.cjs` — new, registered in `scripts/run-unit-tests.cjs`; `scripts/test-workflow-skills-library.cjs` — pinned bundle version and content hash updated.
- `ARCHITECTURE.md` — the bridge, its protocol and the skill.
- Depends on `rdm-lookup-value-authoring` (same branch) for the request body, client call and reconciliation.
