## Context

`contributes.menus["view/item/context"]` entries in `package.json` are grouped and ordered by VS Code as follows: entries are bucketed by the string before `@` in their `group` value, buckets are rendered in ASCII-sort order (with a separator line between buckets), and entries within the same bucket are ordered by the number after `@` (entries with no `@N` suffix share one bucket, ordered by declaration order).

Before this change, the tenant node (`viewItem == reltio.tenant.l3`) rendered:
1. `2_workspace@10` — Copy Tenant ID
2. `3_fetch` (no `@N`, in declaration order) — Fetch Configuration, Apply Configuration to Tenant, Fetch Configuration History
3. `3_insert@01..07` — Add Entity/Relation/Grouping/Graph/Source/Hierarchy/Interaction Type
4. `9_delete` — Remove Tenant

i.e. Copy Tenant ID appeared near the top (`2_` sorts before `3_`), and Apply Configuration to Tenant was mixed into the same visual block as the two "get from tenant" actions. Remove Tenant was already last (`9_` sorts after everything), so the ticket's "make Remove Tenant last" requirement was already satisfied — only Copy Tenant ID needed to move.

## Goals / Non-Goals

**Goals:**
- Produce exactly the 4-section layout Alexey specified for the tenant node.
- Rename "Insert" → "Add a new" everywhere, and the two specific "Fetch" → "Get"/"View" renames, without changing any command ID.
- Keep the change to `package.json` only — no command handler needs to know its own display title.

**Non-Goals:**
- Not renaming `reltio.applyL3Configuration`'s title — the ticket's "Apply Configuration to the Tenant" differs from the current "Apply Configuration to Tenant" only by an inserted "the," which isn't a meaningful distinction worth a title change.
- Not touching `reltio.fetchMoreConfigurationHistory` — it lives on a different tree node (`reltio.history.folder`, the history pagination folder), not the tenant node this ticket describes.
- Not touching the attribute-level, match-group, survivorship-group, or cleanse-config insert commands' `group`/ordering — only their titles change to "Add a new X"; their menu position was never in scope (the ticket's section list is specifically about the tenant node).

## Decisions

### D1: New group-prefix scheme for the tenant node

| Old group | New group | Commands |
|---|---|---|
| `3_fetch` (fetchL3, fetchConfigurationHistory) | `3_getconfig@01` / `3_getconfig@02` | Get Configuration, View Configuration History |
| `3_fetch` (applyL3Configuration) | `4_apply` | Apply Configuration to Tenant |
| `3_insert@01..07` | `5_insert@01..07` | Add a new Entity/Relationship/Interaction/Hierarchy/Graph/Grouping Type, Source (reordered — see D2) |
| `2_workspace@10` | `8_tenantid` | Copy Tenant ID |
| `9_delete` (unchanged) | `9_delete` | Remove Tenant |

Sorting `3 < 4 < 5 < 8 < 9` reproduces the ticket's 5 visual sections (4 content sections + the implicit separator before Remove Tenant) exactly. `8_` (not `6_`/`7_`) is chosen to leave room between the insert block and delete block for any future section, consistent with the existing gap-based numbering style already used elsewhere in this file (`1_auth`, `2_workspace`, `3_*`, `7_modification`, `9_delete`).

**Alternative considered — reuse `2_workspace` for Copy Tenant ID's new position**: rejected; `2_workspace` already sorts before `3_getconfig`, so reusing it wouldn't move the item at all. A new prefix was required.

### D2: Reordering the "Add a new X" block

The ticket specifies: Entity, Relationship, Interaction, Hierarchy, Graph, Grouping, Source — different from today's Entity, Relation, Grouping, Graph, Source, Hierarchy, Interaction. Only the `@NN` suffixes (and matching declaration order, for readability — matching this file's existing convention of keeping declaration order aligned with `@NN` order) change; the `when` clauses (which folder/tenant contexts each command shows under) are untouched.

### D3: Title renames don't touch command IDs

`command` (the ID) and `title` (the display string) are independent fields in a `contributes.commands` entry. Renaming only `title` means:
- No `when` clause, keybinding, or `executeCommand` call site needs updating (they all reference the ID).
- No risk of breaking anything that isn't purely cosmetic.

### D4: Test approach — Tier B only

This is declarative `package.json` configuration, not executable logic — there's no function to unit-test. Following the existing precedent (`scripts/test-extension-packaging.cjs`, which parses `package.json` directly and asserts on its shape), `scripts/test-context-menu-reorganization.cjs` parses `package.json` and asserts:
- The renamed titles are exactly as specified.
- The tenant-node menu entries' `group` values sort into the expected 5-bucket order.
- The "Add a new X" title convention holds for every `insert*`/`addEntityType`/`addRelationType` command.

## Risks / Trade-offs

- **[Risk]** A future contributor adds a new tenant-node menu entry with an ad-hoc group prefix that accidentally sorts into the wrong section → **Mitigation**: the new test asserts the full expected group-order for every currently-known tenant-node command; a new entry not covered by the test won't fail it, but the design doc's group-prefix table above is the reference for where new entries should go.
- **[Risk]** External documentation/screenshots showing the old "Insert X" wording become stale → **Mitigation**: out of scope for a menu-copy change; `ARCHITECTURE.md`'s command table already describes commands by ID and behavior, not by exact UI title text, so it needed no update.

## Test plan

| Tier | Script / Method | What it covers |
|------|------------------|-----------------|
| B (automated, parses `package.json`) | `scripts/test-context-menu-reorganization.cjs` | Renamed titles ("Get Configuration", "View Configuration History", every "Add a new X"); tenant-node menu entries' `group` prefixes sort into the 5 expected buckets in the expected order |
| C (manual QA) | Install packaged `.vsix`; right-click a tenant with a fetched L3 configuration; confirm the context menu shows the 4 sections in the specified order, with Copy Tenant ID second-to-last and Remove Tenant last |
