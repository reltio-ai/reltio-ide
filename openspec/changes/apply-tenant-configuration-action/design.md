## Context

The extension already **downloads** tenant configuration via **`GET …/reltio/api/{tenantId}/configuration`** (`fetchL3Configuration` in `src/api/reltioClient.ts`), pretty-prints it, and writes **`L3.reltio.json`** (`writeL3FromApi` in `src/extension.ts`). **Bearer** tokens live only in **`TokenStore`** (memory). **Configuration history** snapshots under **`history/`** are separate rows from **`GET …/configuration/_history`** and are **cleared** on “Fetch configuration history” (`clearHistoryDirectory`) — so anything we need for **apply safety** must **not** rely on those files alone unless we exempt them from clear.

The user requires **pushing** edits back with **`PUT …/reltio/api/{tenantId}/configuration`**, with **strict gates**: prove what the remote looked like when the IDE last synced (**baseline**), detect **drift** at apply time, force **review** when remote changed, and offer **diff + confirm** before mutating the tenant.

## Goals / Non-Goals

**Goals:**

- Implement **apply configuration to tenant** with: fresh **GET**, **baseline vs remote** check, **local vs remote** review via **`vscode.diff`**, user **confirmation** paths exactly as in the proposal (including **Yes / Cancel / View changes** when remote matches baseline, and **Review changes / Skip** when remote diverged).
- Add **`putL3Configuration`** (name TBD) in **`reltioClient.ts`** using the **same auth** and error posture as **`fetchL3Configuration`** (Bearer, 401 → caller handles like existing flows).
- Persist a **durable baseline** representing the **remote configuration text** after each successful **Fetch L3** (initial sync), used only for **staleness detection** — not as the PUT payload.

**Non-Goals:**

- Three-way merge or automatic conflict resolution inside the IDE.
- Persisting tokens to disk.
- Changing Reltio API semantics beyond documented **GET/PUT** pair for configuration.

## Decisions

### D1 — Baseline file location and lifecycle

**Decision:** Maintain **`L3.remote-baseline.reltio.json`** (name TBD) **next to** **`L3.reltio.json`** in the tenant folder. On every successful **`reltio.fetchL3`** / **`writeL3FromApi`**, write the **same formatted text** that was written to **`L3.reltio.json`** into the baseline file (atomic replace).

**Rationale:** **`history/`** is wiped when refreshing API-driven history; mixing baseline into **`history/`** without schema changes risks accidental deletion. A sibling file stays visible in the workspace, is cheap to implement, and can still be **surfaced in the tree** under the tenant (and optionally linked from the History section as a dedicated node).

**Alternatives considered:** Only **workspaceState** hash — invisible on disk and useless to agents; **history/** snapshot — conflicts with **`clearHistoryDirectory`**.

### D2 — Equality / drift detection

**Decision:** After **GET** current remote configuration (apply flow), **parse** baseline text and remote text as JSON and compare **deep equality** of the resulting objects (or compare **canonical serialized** forms if we need stable ordering — prefer **deep equality** on parsed objects to ignore whitespace-only drift).

**Rationale:** Matches author intent (“same configuration”) better than raw string compare on pretty-printed files.

**Edge cases:** If **`L3.remote-baseline.reltio.json`** is **missing** (never fetched in this workspace), the command SHALL refuse apply with a clear message: **Fetch L3** first (or establish baseline).

### D3 — Dirty editor handling

**Decision:** Before opening diffs or issuing **PUT**, if **`L3.reltio.json`** is dirty, **`save`** the document (or prompt once to save — align with existing **`reltio.autoSaveOnEditorSwitch`** philosophy). Implementation SHOULD follow **`document.save()`** semantics used elsewhere.

### D4 — Confirmation UX

**Decision:**

- **Remote == baseline:** **`showInformationMessage`** (or modal **`showWarningMessage`** if product prefers stronger friction) with actions **Yes**, **Cancel**, **View changes**.
  - **View changes** → **`vscode.diff`** left = **remote GET** (read-only, can use `TextDocumentContentProvider` or temp file uri), right = **local L3** → on close, optionally re-show confirmation or a follow-up **Proceed / Cancel** (design: second step **Proceed** only after explicit **Yes** from diff flow — avoid double-apply).
- **Remote ≠ baseline:** Remote diverged — **review mandatory**. Present **Review changes** and **Skip** (cancel). **Review changes** opens **diff** comparing **remote GET** vs **local L3**; **Continue** only from an explicit confirmation after review.

**Rationale:** Matches requested strict workflow; **Skip** maps to **abort** (no PUT).

### D5 — PUT payload

**Decision:** **PUT** body = JSON text derived from the **current local** `L3.reltio.json` after save (same logical content the user intends to publish). Use **`Content-Type: application/json`** and **`Authorization: Bearer`**.

**Note:** Confirm during implementation that the server expects the **same envelope** as **GET** returns (extension already stores full response text as L3).

### D6 — API surface

**Decision:** Add **`putL3Configuration(baseUrl, tenantId, token, body: string)`** in **`src/api/reltioClient.ts`**, mirroring **`fetchL3Configuration`** timeout and **`ReltioApiError`** mapping.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| **Baseline != “last opened”** if user edits file without re-fetch | Baseline updates **only** on **Fetch L3**; messaging tells users to **fetch** before long offline edits if they care about drift semantics |
| **Large JSON diffs** slow UI | Progress notification; optional future cap is out of scope |
| **401 on PUT** | Reuse **`handle401`** pattern like fetch commands |

## Migration Plan

1. Ship baseline writing alongside existing fetch — **no** migration for old workspaces until user runs **Fetch L3** once.
2. Document in **ARCHITECTURE.md** (during implementation) the baseline file name and apply command.

## Open Questions

- **Modal vs non-modal** confirmations — product preference for destructive remote writes.
- Whether **PUT** must send **only** `configuration` subtree vs full GET payload — **verify** against Reltio API docs during implementation (current stored L3 shape should match GET).
