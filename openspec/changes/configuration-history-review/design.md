## Context

The extension already supports multi-tenant workspaces (`*.reltio.environment/` → `*.reltio.tenant/`), fetches current metadata to `L3.reltio.json`, and centralizes HTTPS calls in `src/api/reltioClient.ts`. Reltio’s **configuration history** endpoint returns an array of objects shaped like `{ updatedBy, timestamp, configuration }` where `configuration` is the **full** tenant configuration document—expensive to refetch on every tree refresh.

## Goals / Non-Goals

**Goals:**

- Integrate `_history` into the **tree** with explicit user actions (no silent bulk download on expand).
- Persist fetched snapshots under the tenant directory for **offline reuse** and faster reopen.
- Provide **diff** workflows: snapshot vs current `L3.reltio.json`, and **two-snapshot** compare using a select-then-compare pattern.
- Support **paged** “older” fetches via `offset` / `max` without duplicating identical snapshots on disk.

**Non-Goals:**

- Rewriting or “replaying” history back to the Reltio API from the extension.
- Guaranteeing deduplication across arbitrary manual file edits inside `history/` (design assumes extension owns file naming).
- Replacing Reltio’s history format—**consume** API as-is.

## Decisions

### D1: On-disk layout under the tenant folder

**Decision:** Use a subdirectory **`history/`** next to `L3.reltio.json` inside `{tenantId}.reltio.tenant/`. Each API row becomes one file:

`history/L3-<sanitizedUpdatedBy>---<timestamp>.reltio.json`

- **Body:** JSON-stringify only the `configuration` object (pretty-printed with stable indentation) so the file remains a valid `*.reltio.json` for schema validation and existing tooling.
- **Sanitization:** Replace filesystem-hostile characters in `updatedBy` with `_` (max reasonable length, e.g. 80 chars) to avoid cross-platform issues.

**Alternatives:** Single JSON manifest holding all snapshots (rejected: loses one-file-one-tab ergonomics and duplicates memory).

### D2: Tree visibility and lazy loading

**Decision:** Do **not** show a History node until the user runs **Fetch configuration history** successfully at least once for that tenant. After that, show a **History** folder (collapsible) whose children are **only** files discovered on disk under `history/` matching `L3-*---*.reltio.json` (sorted newest-first by parsing `timestamp` from filename suffix).

**Alternatives:** Always show empty History folder (rejected: user asked hidden until fetch).

### D3: Pagination and “fetch more”

**Decision:** First fetch: `max=10`, `offset=0`. **Fetch more:** set `offset` to the **number of snapshot files** already stored for that tenant (append-only). If the API returns fewer than `max` rows, treat as **end of history** and disable or hide “Fetch more” until a future product decision.

**Alternatives:** Track offset in VS Code `workspaceState` only (rejected: breaks after clone unless files match; file count aligns with disk truth).

### D4: Labels and timestamps

**Decision:** Parse `timestamp` as integer milliseconds (string from API is acceptable). Display in **local** timezone as `DD-MM-YYYY HH:MM` per user request; tree description may show full precision if needed.

### D5: Compare UX

**Decision:**

- **Compare with current:** `vscode.diff` with left = selected snapshot URI, right = tenant `L3.reltio.json` URI (or swap per team preference—document title clearly).
- **Select for compare / Compare selected:** maintain **per-workspace** “first selection” URI in `ExtensionContext.workspaceState` (or module singleton scoped to workspace), keyed by a stable key such as `reltio.historyCompareA`. Second command opens diff between A and B; validate same tenant where required.
- **Compare with previous snapshot:** `vscode.diff` between the **selected** snapshot file and the **immediate older** snapshot in the same tenant `history/` directory—i.e. the on-disk revision whose timestamp is closest to the selected one but **strictly older** (chronological predecessor among files in that folder). The command is **in scope only when that neighbor exists** (not for the chronologically **oldest** snapshot in the directory, which has no older peer). Left/right order should match the other compare commands (e.g. older on the left, selected on the right) and the diff title should name both sides clearly.

**Alternatives:** Custom diff webview (rejected: unnecessary vs built-in diff).

### D6: API surface in code

**Decision:** Add `fetchConfigurationHistory(baseUrl, tenantId, token, offset, max): Promise<HistoryEntry[]>` where `HistoryEntry` includes `updatedBy`, `timestamp`, and serialized `configuration` object. Reuse `fetchWithTimeout`, Bearer header, and `ReltioApiError` semantics consistent with `fetchL3Configuration`.

## Risks / Trade-offs

- **[Large disk usage]** → Mitigation: default `max=10`; user opts into “more”; document size implications.
- **[Slow first fetch]** → Mitigation: progress notification; write files sequentially or batched without blocking UI thread (async/await with yielding if needed).
- **[Schema validation noise on old snapshots]** → Mitigation: snapshots are still `*.reltio.json`; if older API shapes fail validation, consider a secondary file extension in a follow-up (non-goal for v1—accept same extension per proposal).
- **[Concurrent fetches]** → Mitigation: disable commands while a fetch runs for that tenant.

## Migration Plan

1. Ship read-only history browsing + diff; no migration of existing workspaces beyond creating `history/` on first fetch.
2. Rollback: remove commands and tree contributions; leave orphan files harmless.

## Open Questions

- Exact API behavior when `offset` exceeds available rows (empty array vs error)—handle both gracefully.
- Whether `updatedBy` can contain characters beyond simple usernames (email, URN)—drives sanitization table.
- Should **Fetch configuration history** clear `history/` first or merge (proposal: **append** for “more”; initial fetch could **replace** directory contents for a clean slate—pick one in implementation and document in tasks).
