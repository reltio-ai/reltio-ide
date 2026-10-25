# Design — workflow-authoring

Builds directly on `workflow-inspector`. Everything here assumes the Workflow Adapter URL sidecar, the `Workflows` tree branch, and the three read endpoints already exist.

---

## D1. Prompt for the process id up front, never a placeholder

**Decision.** New Workflow asks for the process id before writing anything, validated against `^[A-Za-z_][A-Za-z0-9_.-]{0,63}$`. It does not write a skeleton containing `REPLACE_ME` for the user to fill in.

**Rationale.** Four reasons, in order of weight:

1. **A forgotten placeholder deploys as a real workflow.** If the user never edits it, `REPLACE_ME` becomes a live process type on the tenant. Renaming the local file afterwards does not undo it — the deployment already happened server-side under that id.
2. **The filename derives from the id.** We cannot name the file before we know it. Renaming later breaks `resolveDraftContext()` (D4) and orphans any open editor tab.
3. **Collision detection must precede the write.** We need to check both "is there already a draft with this name" and "is there already a deployed definition with this id" — neither is answerable without the value.
4. **It is injected into three different contexts**: a filename, a URL query parameter, and XML content. The validator's job is as much path-traversal and injection safety as it is usability; `../../etc/passwd` must not be a legal process id.

**Rejected:** a placeholder skeleton the user edits. Simpler to implement, but the failure mode is silent and unrecoverable.

## D2. Duplicate defaults the new id to `{type}Copy`

**Decision.** Duplicate as Draft pre-fills the id input with `{originalType}Copy` rather than the original id, and warns if the chosen id collides with a definition whose `generic` flag is `true`.

**Rationale.** Activiti versions deployments by process id. A `ProcessDefinition.id` of `dataChangeRequestReview:3:70513367` means the tenant is already running **version 3** of that process. Deploying a BPMN that reuses an existing id therefore does not create a new workflow — it creates the next version of the existing one, and new process instances immediately use it.

A user who clicks "Duplicate" intends "give me a copy to work on". A naive implementation that preserved the id would instead let them silently replace a live, possibly Reltio-built-in, workflow — with a successful-looking deploy and no warning. Defaulting to `{type}Copy` makes the safe outcome the default and the risky one deliberate.

## D3. Hand-built `Uint8Array` multipart body, not `FormData`

**Decision.** `buildMultipartBody(part, boundary)` constructs the request body byte by byte. `FormData` + `Blob` is the documented fallback if a live Adapter rejects our bytes.

**Rationale.** Two independent reasons:

- **Testability.** `FormData` generates its boundary randomly inside the runtime, so a test cannot assert the exact bytes on the wire. A hand-built body takes the boundary as a parameter, which means a unit test can pin it and compare the whole payload exactly — CRLF placement, the `Content-Disposition` line, the terminating `--{boundary}--`.
- **Type availability is unverified.** `tsconfig.json` sets `lib: ["ES2022"]` with no `"DOM"`. Whether `FormData`/`Blob` typecheck at all in this project is an open question, and the answer would gate the implementation.

The specific bug class this protects against: a BPMN containing a non-ASCII character (an accented process name) where length is measured in UTF-16 code units instead of bytes. The request silently malforms and the server rejects it with an unhelpful error. A byte-exact test with a non-ASCII fixture catches it immediately.

## D4. `deployProcessDefinition` takes the XML as a `string`, never a `Uri`

**Decision.** The API function's signature accepts `xml: string`. Reading bytes off disk stays in `extension.ts` via `doc.getText()`.

**Rationale.** This is the testability hinge for the whole change. The test harness's `vscode` stub returns an empty `Uint8Array` from `workspace.fs.readFile`, so **anything that reads a file is untestable by construction**. Keeping the file read in the command handler leaves the API layer as a pure string→bytes→request transform, which is exactly the part with rules that can be wrong.

The same reasoning governs `workflowDrafts.ts`: naming, skeleton generation and context resolution are pure functions; only `listWorkflowDrafts` and `writeWorkflowDraft` touch `vscode.workspace.fs`, and they contain no logic worth asserting.

## D5. Drafts are real files with a dedicated tree node

**Decision.** `{tenantId}.reltio.tenant/workflows/{processId}.bpmn20.xml`, surfaced under a `Drafts (N)` folder that appears only when at least one draft exists.

**Rationale.** A scratch buffer is lost on reload and invisible to source control. A real file is neither, and it means the draft is the customer's artifact rather than the extension's. The conditional folder mirrors `shouldShowHistoryFolder()` — an empty folder is noise on the majority of tenants that have no drafts.

The on-disk filename and the multipart part filename are kept identical, so what the user sees in the Explorer is what the server receives.

## D6. Drafts survive deploy, untouched

**Decision.** A successful deploy does not delete, move, or mark the draft.

**Rationale.** It is the only local copy of the file. Activiti versions deployments anyway, so keeping the draft is how a user iterates: deploy, observe, edit, deploy again. Consuming the source file on success would make the second iteration start from nothing.

## D7. Deploy cannot be pre-gated on role

**Decision.** The Deploy action is always enabled. A 403 is handled reactively with a message naming the required role and confirming the draft is safe.

**Rationale.** Verified: the extension never decodes the JWT and never calls a roles or permissions endpoint. The signed-in user's Reltio roles are **unknowable client-side**, so a `when`-clause gate is impossible and a disabled-looking menu item would be a lie. The honest alternative is to let it run and explain the refusal:

> Deploy refused (403). Deploying a workflow requires the `ROLE_WORKFLOW_MANAGER` role on tenant "{tenantId}". Your draft is saved and unchanged — ask a tenant admin to grant the role, then deploy again.

A 404 on deploy is treated as a probable wrong-adapter-URL and offers the existing **Edit Adapter URL** action, since the read endpoints and the deploy endpoint sit on the same host.

## D8. Re-fetch from the server after a successful deploy

**Decision.** Call `doFetchWorkflows(...)` after deploy rather than pushing the new definition into the cache locally.

**Rationale.** The server assigns the version number, the deployment id and the deploy timestamp, and it re-serializes the XML. Only a re-fetch reflects what actually landed. `markWorkflowsLoaded` alone would leave a list that looks right and isn't.

## D9. Regex rewrite of the first `<process>` element, no XML parser

**Decision.** Duplicate rewrites `id` and `name` on the first `<process>` tag using a bounded regex. No XML parser is introduced.

**Rationale.** The codebase deliberately has no XML parser — `workflowAdapterClient.ts` records that "no XML parser means no XXE surface". Adding one for a two-attribute rewrite would trade a documented security property for convenience, and would also breach the effectively-frozen dependency policy. The regex is namespace-aware (`<(?:[\w.-]+:)?process\b`) and operates on the first match only.

## D10. `getParent()` completion is pulled forward

**Decision.** Add the missing `getParent()` branches for every node below `WorkflowsFolderNode` in this change, rather than in `custom-workflow-repository` as originally sequenced.

**Rationale.** Today everything below the Workflows folder falls through to `undefined`, so `reveal()` does not work on any workflow node. Both New and Duplicate want to reveal the draft they just created. Building those flows against a broken `reveal()` would mean writing them twice. Reconstruction is safe because every node sets a stable `id` and VS Code matches on it — the same technique the existing `TenantNode` branches already use.

---

## Open questions — blocking the deploy path only

Both are answerable with two `curl` calls against a real tenant. Everything else in this change can be built and tested without them.

1. **Multipart field name and required parameters.** Is the part field literally `file`? Is the `name` query parameter mandatory? What status code and response body come back on success? Does the part filename have to end `.bpmn20.xml`, or is `.xml` accepted?
2. **Response shape on success.** Needed to decide whether the deploy result is worth surfacing beyond a toast.

Until these are answered the wire format is an assumption, held in one place (`DEPLOY_PART_FIELD` and the URL builder) so a correction is a one-line change rather than a rewrite. The raw responses should be fixtured into the test script once captured.

---

## Test plan

**Automated — Tier A (pure logic, no I/O, no VS Code host)**

| # | Assertion |
|---|---|
| 1 | Multipart bytes exactly: CRLF placement, `Content-Disposition` line, terminating `--{boundary}--` |
| 2 | UTF-8 length correctness with a non-ASCII display name (the D3 bug class) |
| 3 | Boundary-collision regeneration when the payload contains the candidate boundary |
| 4 | Deploy URL contains `/workflow-adapter/workflow/deployments`, carries percent-encoded `tenantId`/`name`, and has **no** tenant path segment |
| 5 | `method === 'POST'`; headers carry `Authorization`, `EnvironmentURL`, `Content-Type: multipart/form-data; boundary=`; no `xxx-client` |
| 6 | Untrusted host → `UntrustedHostError` with `fetch` never called |
| 7 | 401/403/500 → `ReltioApiError` with the right `statusCode`; network throw → `WorkflowConnectionError` |
| 8 | `buildBpmnSkeleton` escapes `&`, `<`, `"`; contains the id and `isExecutable="true"` |
| 9 | Process-id validator accept/reject table: `../x`, `a b`, `1abc`, empty, 64+ chars, valid names |
| 10 | `resolveDraftContext()` round-trips a URI produced by `getWorkflowDraftUri()` |
| 11 | Duplicate's id/name rewrite hits only the first `<process>` element and survives a namespace prefix |

**Automated — Tier B (structural)**

| # | Assertion |
|---|---|
| 12 | All four commands declared in `package.json` with the expected `when` clauses, each prefixed `view == reltioConfigTree &&` |
| 13 | `scripts/test-workflow-authoring.cjs` is registered in the `SCRIPTS` array in `run-unit-tests.cjs` |

**Manual QA — Tier C**

- Deploy a skeleton end to end against a real tenant; confirm it appears in Process Definitions after the automatic refresh.
- Deploy with a genuinely unprivileged account; confirm the 403 message names the role and the draft is untouched.
- Create a draft, reload the window, confirm it is still listed under Drafts and still opens.
- Edit a draft without saving, hit Deploy, confirm the saved content is what uploads.
- Enter an id that collides with an existing draft, and one that collides with a `generic: true` definition; confirm both warn.
- Confirm the deployed BPMN renders in the Reltio console — if the skeleton's missing `BPMNDI` section prevents it, add a minimal diagram block.
