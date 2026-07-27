## Why

Editors can change tenant metadata locally in `L3.reltio.json`, but there is no supported path to **push** those edits back to the Reltio environment. Doing so blindly risks **overwriting concurrent changes** on the tenant. We need a **strict, review-first workflow** that verifies remote state, compares against a **known baseline** captured when configuration was loaded, and only then performs **`PUT …/configuration`** with the same **Bearer** authorization model as reads.

## What Changes

- Add a **tenant configuration apply** command (tree / palette) that **GETs** the current remote configuration, compares it to a **persisted baseline** (the remote configuration as of the last successful **Fetch L3** — stored as a dedicated sibling file next to **`L3.reltio.json`** so it survives **`history/`** clears from configuration-history fetch; surfacing in the tree next to tenant/history is part of delivery).
- **Branch A — remote unchanged since baseline:** prompt **Yes** / **Cancel** / **View changes**; **View changes** opens a **diff** (remote current vs user’s document) and allows proceeding after review.
- **Branch B — remote changed since baseline:** **review is mandatory**; user chooses **Review changes** (opens the same comparison flow) or **Skip** (abort apply; no PUT).
- Implement **`PUT https://<environment>/reltio/api/<tenantId>/configuration`** with the **full configuration JSON body**, using **`Authorization: Bearer <token>`** like **`GET …/configuration`** (`fetchL3Configuration`).

## Capabilities

### New Capabilities

- `tenant-configuration-apply`: Safe **apply local L3 to tenant** workflow: baseline tracking, remote freshness check, confirmation and diff review gates, and **PUT** upload with shared auth/error handling patterns as existing API commands.

### Modified Capabilities

- *(None — no `openspec/specs/` baseline in-repo; requirements live under this change only.)*

## Impact

- **`src/api/reltioClient.ts`** — add **PUT** configuration helper mirroring **GET** headers/timeout/401 handling.
- **`src/extension.ts`** — register command(s); orchestrate GET/compare/diff/PUT; reuse **`TokenStore`** and tenant/environment resolution like **`reltio.fetchL3`**.
- **`src/workspace/`** — persist **baseline** snapshot on each successful **Fetch L3** (see **`design.md`** — not inside cleared **`history/`**); document lifecycle (clear/replace rules).
- **`package.json`** — new command contribution(s), optional settings (e.g. confirm dialogs toggles — only if product agrees).
- **User-facing:** destructive remote update is **never silent**; diff uses **`vscode.diff`** or equivalent consistent with history compare commands.
