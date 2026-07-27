## Why

RP-188093: the tenant node's context menu has grown organically as commands were added over time, mixing "Get configuration from tenant," "push configuration to tenant," "add a new element," and "housekeeping" actions with no consistent grouping — e.g. **Copy Tenant ID** sits near the top instead of near **Remove Tenant**, and the "Add a new X" element-insert commands are scattered in a different order than users think about them. Alexey asked for a specific 4-section reorganization, plus a consistent "Add a new X" naming convention (replacing the inconsistent "Insert X" wording) across every context menu that offers an insert action.

## What Changes

- **Tenant node context menu** (`viewItem == reltio.tenant.l3`) is regrouped into 4 sections, top to bottom:
  1. Get Configuration, View Configuration History
  2. Apply Configuration to Tenant
  3. Add a new Entity Type, Relationship Type, Interaction Type, Hierarchy Type, Graph Type, Grouping Type, Source (in that order)
  4. Copy Tenant ID (second-to-last), Remove Tenant (last)
- Command **titles** renamed (command IDs unchanged, so nothing else — keybindings, `when` clauses, tests referencing IDs — breaks):
  - `reltio.fetchL3`: "Fetch Configuration" → **"Get Configuration"**
  - `reltio.fetchConfigurationHistory`: "Fetch Configuration History" → **"View Configuration History"**
  - Every "Insert X" title (`addEntityType`, `addRelationType`, and all `insert*` commands across every context menu — top-level types, attributes, match groups, survivorship groups, cleanse config) → **"Add a new X"**. `addRelationType`'s title becomes "Add a new Relationship Type" (matching the ticket's wording), not "Relation Type."
- No behavior change to any command — this is presentation-only (titles + menu `group` ordering in `package.json`).

## Capabilities

### New Capabilities

- `tenant-context-menu-layout`: the 4-section grouping and ordering of the tenant node's context menu.

### Modified Capabilities

_None._ (No existing capability spec covers menu title wording or the tenant node's section layout.)

## Impact

- `package.json` only — command `title` fields and `contributes.menus["view/item/context"]` `group` values for the tenant-node entries and the affected top-level insert commands. `reltio.fetchMoreConfigurationHistory` (a different tree node — the history folder, not the tenant node) is unaffected.
- New test script `scripts/test-context-menu-reorganization.cjs` (Tier B — parses `package.json` directly), registered in `scripts/run-unit-tests.cjs`.
- No `src/` changes — no command handler, model, or schema changes.
