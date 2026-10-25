## Context

Reltio Workflow (the Activiti-based engine behind DCR/PMR/Delete-review) runs as a **separate service** from the platform API this extension already talks to — different base URL (commonly, but not reliably, `{env}-workflow.reltio.com`), different required header (`EnvironmentURL`, not a path segment), same OAuth token space. `LEARN_WORKFLOW_APIS.md` (Part 2) documents three read-only GETs that together answer "what's deployed on this tenant": `jarDeployments`, `processDefinitions`, `processDefinitions/{type}`. This change adds a tree surface for exactly those three calls — nothing that mutates tenant state.

Confirmed with the user before drafting this:
- Reuse the tenant's existing Bearer token — do not build a second auth flow.
- Do **not** guess the Workflow Adapter URL. Naming conventions are not reliable across all tenants; ask once, then remember.
- Local dev adapter (`localhost:8080`) support is explicitly deferred — this is a read-only inspector against real tenants.
- The existing config tree (History + all L3 sections) gets nested one level deeper under a new `Business Config` folder, as a sibling of the new `Workflows` folder — a deliberate, visible restructuring of every tenant row, not an additive-only change.

## Goals / Non-Goals

**Goals:**
- List every deployed process definition and every registered JAR for a tenant, and show one process definition's full BPMN XML, using only GET requests.
- Never call the Workflow Adapter until the user explicitly opts in for that tenant (`Fetch Workflows`).
- Persist the entered Workflow Adapter URL so the prompt only happens once per tenant, using the same "sidecar file next to the tenant" pattern already established for layout persistence.
- Reuse the existing host-allowlist protection (`reltio.trustedHostSuffixes`) for this new outbound call, since it carries the same live token as every other call in the extension.

**Non-Goals:**
- Deploying or removing a BPMN file or JAR, starting a process instance, or acting on a task — all state-changing Workflow Adapter operations are deferred to a later change, if ever.
- Supporting a local development adapter — deferred; would need a materially different trust model (no allowlist makes sense for `localhost`).
- Visual BPMN diagram rendering — raw XML only for V1.
- Deriving the Workflow Adapter URL automatically from the environment URL — rejected; see D2.

## Decisions

### D1: Tenant children regroup into `Business Config` + `Workflows` siblings

**Decision**: `MultiTenantTreeProvider.getChildren(TenantNode)` currently returns `[HistoryFolderNode?, ...getConfigRootChildren()]` directly as the tenant's children. It changes to return `[BusinessConfigFolderNode, WorkflowsFolderNode]`; `BusinessConfigFolderNode`'s own children are exactly what the tenant's children are today (History + every non-empty L3 section, unchanged internally).

**Rationale**: Confirmed explicitly with the user over the alternative (leave the flat list alone, add `Workflows` as a third sibling folder at the same level as `Entity Types` etc.). The regroup was chosen because Workflows and Business Config are conceptually different systems (different API, different auth-URL, different lifecycle) and visually flattening them together under one tenant row would blur that distinction more than the one extra click costs.

**Trade-off accepted**: every existing user's tree gains one level of nesting to reach Entity Types/Relation Types/etc. This is a visible behavior change on upgrade — call it out in release notes, same as `multi-tenant-tree-view` did for its own tree restructuring.

### D2: Workflow Adapter URL is asked for, once, never derived

**Decision**: `WorkflowsFolderNode` starts in an "unfetched" state (`Fetch Workflows` inline action/description, mirroring the existing `T_NO_L3` → "L3 not fetched — click to fetch" pattern on `TenantNode`). The first click prompts an input box for the Workflow Adapter base URL. There is no attempt to compute a default from the environment name.

**Rationale**: The `{env}-workflow.reltio.com` convention mentioned in `LEARN_WORKFLOW_APIS.md` is explicitly *not* guaranteed — confirmed as an open question for the Workflow team, unresolved as of this writing. Guessing wrong and silently trying it first would mean either a confusing failed request before the real prompt, or (worse) a plausible-looking wrong host that happens to resolve to something. Asking once and remembering is simpler and correct regardless of what the Workflow team's answer turns out to be; if they confirm a reliable convention later, a follow-up change can add it as a *pre-filled default* in the same input box, not as an auto-fetch.

**Alternative considered**: new per-environment setting (`reltio.workflowAdapterUrl` map). Rejected for V1 — settings are environment-scoped, but the entered value is genuinely tenant-scoped in general (nothing prevents two tenants under the same platform environment from routing to different Workflow Adapter instances), and a settings-based flow would be slower to build than reusing the existing sidecar-file pattern already proven for tenant-scoped local data (D3).

### D3: Persistence — sidecar file next to the tenant, not `workspaceState`

**Decision**: The entered URL is written to a new sidecar file, `WorkflowAdapter.reltio.json`, inside the same `{tenantId}.reltio.tenant/` directory `EnvironmentManager` already manages (alongside `L3.reltio.json`, `L3.remote-baseline.reltio.json`, `history/`). Shape: `{ "workflowAdapterUrl": "https://..." }`.

**Rationale**: `ARCHITECTURE.md`'s own "Key Design Patterns" section already documents this exact pattern for a different piece of tenant-local, non-token data — `*.reltio.layout.json` sidecars for ontology node positions — specifically because it's "portable across machines and visible in the file system," unlike `workspaceState`. The same reasoning applies here: if this workspace folder is committed to git or copied to a teammate, the Workflow Adapter URL should travel with it exactly like a layout sidecar does, and a teammate opening the same tenant shouldn't have to re-discover and retype the same URL. `EnvironmentManager` gets one new method, `getWorkflowAdapterConfigUri(environment, tenantId)`, following the exact shape of `getLayoutUri()`.

**Alternative considered (from the earlier requirements pass)**: `workspaceState`. Rejected — confirmed with the user; a value this is tied to the tenant's own identity, not this VS Code install, so it belongs on disk with the tenant, not in per-machine state.

### D4: Wrong-URL recovery — explicit edit command, plus error-triggered re-prompt

**Decision**: Two ways to fix a bad URL, both confirmed with the user:
1. A context-menu command, **Edit Workflow Adapter URL**, on the `Workflows` folder (parallel to how `reltio.removeEnvironment` etc. hang off their respective tree rows) — always available once a URL is persisted.
2. If a fetch fails with a network-level error (DNS failure, connection refused, timeout — i.e., the URL itself looks wrong, not an auth/permission problem), the error notification includes an **Edit URL** action button that opens the same prompt directly, pre-filled with the current (wrong) value.

**Rationale**: A 401/403 from a reachable host is an auth or permission problem, not a URL problem (per `LEARN_WORKFLOW_APIS.md`'s own troubleshooting table) — re-prompting for a *new URL* in that case would send the user down the wrong remediation path. Only connection-level failures trigger the URL-specific recovery action; 401/403 follow the existing "session expired" / permission-error messaging already used elsewhere in the extension.

### D5: Reuse the existing host allowlist — export, don't duplicate

**Decision**: `reltioClient.ts`'s private `toHttpsBase()` (which enforces `reltio.trustedHostSuffixes` and force-upgrades `http://`, per the `harden-reltio-client-base-url` change) is exported as-is, unchanged internally. `workflowAdapterClient.ts` imports and calls it on the user-supplied Workflow Adapter URL before every request, exactly like every platform-API call already does.

**Rationale**: This is precisely the situation `harden-reltio-client-base-url`'s own D1 rationale anticipated: "a future call site could forget it" if the check lived anywhere other than the one function every caller passes through. This change is that future call site. Duplicating an equivalent check inside `workflowAdapterClient.ts` instead of importing the real one would recreate exactly the fragility that change closed — two allowlists that could silently drift apart. No behavior change to any existing `reltioClient.ts` caller; `toHttpsBase` goes from module-private to exported, nothing else.

**Consequence**: a Workflow Adapter URL outside `*.reltio.com` (and not covered by an extended `reltio.trustedHostSuffixes`) is rejected the same way an untrusted platform environment host is — `UntrustedHostError`, no request sent, no token attached.

### D6: `EnvironmentURL` header is never asked for — it's already known

**Decision**: The `EnvironmentURL` header every Workflow Adapter call requires (per `LEARN_WORKFLOW_APIS.md` §2.3–2.5) is populated automatically from the tenant's own platform environment URL — the same value `EnvironmentManager`/`EnvironmentInfo` already has for the connected environment. The user only ever supplies the Workflow Adapter's own base URL (D2); the header is never a second prompt.

**Rationale**: Nothing about this value is tenant-specific input — it is, by definition, the platform URL for the environment the tenant already lives under. Asking for it would be redundant and error-prone (typo risk for zero benefit, since the correct value is already in memory).

### D7: BPMN XML view — read-only virtual document, not an editable "Untitled" tab

**Decision**: Clicking a process definition opens its XML via a new `vscode.TextDocumentContentProvider` registered on a custom scheme (e.g. `reltio-workflow-bpmn:`), rather than `vscode.workspace.openTextDocument({ content, language: 'xml' })` (which produces an editable, "dirty"-flaggable Untitled document with a Save-As prompt on close).

**Rationale**: The fetched XML is a read-only snapshot of tenant state, not something the user is meant to edit and re-save through this flow (that would imply a deploy action, out of scope — see Non-Goals). A content provider gives VS Code's native read-only editor behavior (no dirty dot, no accidental "unsaved changes" prompt) for free, and is the standard idiom other extensions use for this exact "show me this remote thing as text" need.

**Alternative considered**: Output channel. Rejected — an XML document benefits from the editor's syntax highlighting and normal scroll/search/copy affordances; an Output channel does not apply a language grammar.

### D8: Workflows folder is independent of `hasL3` / Business Config fetch state

**Decision**: `WorkflowsFolderNode` is always rendered as a `TenantNode` child (alongside `BusinessConfigFolderNode`), regardless of whether the tenant has fetched its L3 yet. Its own "unfetched" state is tracked independently (D2), not derived from `TenantNode.hasL3`.

**Rationale**: The Workflow Adapter and the platform's L3 configuration are unrelated systems from the tenant's perspective; forcing a user to fetch Business Config first just to reach the Workflows folder would be an arbitrary sequencing requirement with no technical basis.

### D9: Icons and node types follow the existing `ConfigNodeType`/`NODE_ICONS` convention, in a new file

**Decision**: New tree node classes (`BusinessConfigFolderNode`, `WorkflowsFolderNode`, `ProcessDefinitionsFolderNode`, `JarDeploymentsFolderNode`, `ProcessDefinitionNode`, `JarDeploymentNode`) live in a new `src/tree/workflowNodes.ts`, not appended to `multiTenantNodes.ts` or `treeNodes.ts`'s `ConfigNodeType` union — those two files model the L3/business-config domain specifically (`ReltioBusinessModel`-shaped data); Workflow Adapter data has its own shape (`processDefinitions`/`jarDeployments` JSON) and does not belong in the same type union.

**Rationale**: Keeps `configSubtree.ts`'s `SECTIONS`-driven dispatch (which is purely about `ReltioBusinessModel` keys) untouched and untangled from an unrelated data source, consistent with `ARCHITECTURE.md`'s existing package-structure separation between `src/tree/` sub-concerns.

## REST API Reference

| Operation | Method | URL | Auth | Response |
|-----------|--------|-----|------|----------|
| List JAR deployments | GET | `{workflowAdapterUrl}/workflow-adapter/workflow/{tenantId}/jarDeployments` | `Authorization: Bearer {token}`, `EnvironmentURL: {platform env URL}` | `{ status, data: [{ module, name, description, createdBy, createTime }], total }` |
| List process definitions | GET | `{workflowAdapterUrl}/workflow-adapter/workflow/{tenantId}/processDefinitions` | same | `{ status, data: [{ id, type, displayName, deploymentId, deployTime, deployedBy, generic, fileName, manualStart }], total }` |
| Fetch one process definition's BPMN | GET | `{workflowAdapterUrl}/workflow-adapter/workflow/{tenantId}/processDefinitions/{type}` | same | Raw BPMN 2.0 XML (or, per `LEARN_WORKFLOW_APIS.md` §2.5, occasionally JSON-wrapped on a local adapter — not applicable here since local adapters are out of scope) |

All three go through the exported `toHttpsBase()` allowlist check (D5) before the `Authorization` header is attached.

## Risks

- **The `{env}-workflow.reltio.com` naming convention may or may not be reliable** → Already mitigated by design (D2: never guessed). Still open: whether the Workflow Adapter accepts the *same* Bearer token as the platform API for every tenant, or needs a distinct client-credentials pair — flagged as an explicit open question for the Workflow team; if the answer is "distinct credentials," this change's auth-reuse assumption (confirmed by the user as "token is same, I know for sure") needs revisiting before `Apply`.
- **A wrong-but-reachable Workflow Adapter URL returns a confusing error** (e.g. a real server that isn't a Workflow Adapter, returning an unrelated 404) → Mitigated by surfacing the raw response status/body in the error notification, same as `formatPutConfigurationFailureMessage()` does for L3 PUT failures, so the user has enough information to tell "wrong URL" apart from "right URL, real problem."
- **Sidecar file drifts from reality** if a tenant's Workflow Adapter is later moved to a new host → Mitigated by D4's edit command; no auto-detection is attempted.
- **Visible tree restructuring (D1) surprises existing users on upgrade** → Same mitigation as the naming-convention risk above: call out explicitly in release notes.

## Migration Plan

No persisted data is migrated or destroyed. Existing `{tenantId}.reltio.tenant/` directories gain, at most, a new optional `WorkflowAdapter.reltio.json` sidecar the first time a user runs **Fetch Workflows** for that tenant — nothing is written before that action. The tree restructuring (D1) is a pure rendering change; no files move. Rollback is reverting the commit.

## Open Questions

- **For the Workflow team**: does every tenant's Workflow Adapter accept the same OAuth session/token already used for the platform API, or does it require separate client credentials? Does the Workflow Adapter's base URL reliably follow `{env}-workflow.reltio.com`, or can it differ per tenant/customer? (Exact wording already drafted for the user to forward.) Neither answer blocks writing this proposal, but the first one blocks `Apply` if the answer is "separate credentials," since D6's "no second prompt" assumption would need a new decision.

## Test plan

**Automated (Tier A / B)**, in `scripts/test-workflow-inspector.cjs`

| # | Tier | Assertion |
|---|---|---|
| 1 | A | `listProcessDefinitions` / `listJarDeployments` / `fetchProcessDefinitionXml` build the documented URL shape and headers (`EnvironmentURL`, `Authorization: Bearer`), given a stubbed `fetch` |
| 2 | A | A Workflow Adapter URL outside the allowlist is rejected via the exported `toHttpsBase()` before `fetch` is ever called, for all three helpers |
| 3 | A | An explicit `http://` Workflow Adapter URL is upgraded to `https://` (same behavior as the platform client, proving the export didn't fork behavior) |
| 4 | A | A non-200 response surfaces a `WorkflowApiError` with status code and body, mirroring `ReltioApiError`'s shape |
| 5 | B | `getChildren(TenantNode)` returns exactly `[BusinessConfigFolderNode, WorkflowsFolderNode]`, and `BusinessConfigFolderNode`'s children match what `getConfigRootChildren()` + History produced before this change (structural regression check against the canonical fixture) |
| 6 | B | `WorkflowAdapter.reltio.json` sidecar round-trips (`write` then `read`) via the same `vscode.workspace.fs` pattern as `L3.reltio.layout.json` |

**Manual QA (Tier C)**

| # | Check |
|---|---|
| 1 | Fresh tenant, no sidecar file: expand tenant → see `Business Config` and `Workflows` (unfetched) siblings; existing Business Config content unchanged one level deeper |
| 2 | Click **Fetch Workflows** → prompted for URL → enter a real Workflow Adapter URL → folder populates `Process Definitions (N)` / `Custom JARs (N)`; sidecar file now exists on disk with the entered URL |
| 3 | Reload the window → **Workflows** folder is already "fetched" for that tenant with no re-prompt (persisted URL read from sidecar) |
| 4 | Click a process definition → BPMN XML opens read-only (no dirty indicator, no Save-As on close) |
| 5 | Enter a URL outside `*.reltio.com` → rejected with the same `UntrustedHostError` message style used for environments; extend `reltio.trustedHostSuffixes` and confirm it then succeeds |
| 6 | Enter an unreachable host (typo) → error notification includes **Edit URL**; clicking it re-opens the prompt pre-filled with the wrong value |
| 7 | Right-click **Workflows** folder → **Edit Workflow Adapter URL** → change the value → next fetch uses the new URL and the sidecar updates |
