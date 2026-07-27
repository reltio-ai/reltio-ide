## 1. API and baseline persistence

- [x] 1.1 Add `putL3Configuration` in `src/api/reltioClient.ts` (Bearer, timeout, `ReltioApiError` on non-OK, 401) mirroring `fetchL3Configuration`
- [x] 1.2 On successful `writeL3FromApi`, write or replace `L3.remote-baseline.reltio.json` next to `L3.reltio.json` with the same formatted text as the downloaded L3
- [x] 1.3 Add a small JSON deep-equality helper (or reuse) for comparing parsed GET, baseline, and local document for drift detection

## 2. Apply command and workflow

- [x] 2.1 Register `reltio.applyL3Configuration` (name TBD) in `package.json` with tree context for tenant with L3; require token like `reltio.fetchL3`
- [x] 2.2 Implement orchestration: ensure `L3.reltio.json` saved; GET remote; load baseline; branch on equality vs baseline
- [x] 2.3 **Remote == baseline:** show **Yes** / **Cancel** / **View changes**; **View changes** opens `vscode.diff` (remote vs local)
- [x] 2.4 **Remote != baseline:** show **Review changes** / **Skip**; **Review changes** opens the same diff; require explicit proceed to PUT
- [x] 2.5 On user confirm, `PUT` local JSON; on success, refresh baseline to match new remote (re-fetch or write from accepted body per design)
- [x] 2.6 On 401 from GET or PUT, use same `handle401` pattern as existing commands

## 3. Tree and documentation

- [x] 3.1 Add a tree node or label under the tenant (or History) for the baseline file / apply entry point if product wants discoverability (optional if command-only is enough)
- [x] 3.2 Update `ARCHITECTURE.md` (apply command, baseline file, PUT network line) and manual QA steps for apply + diff + 401
