## Why

The Workflow Inspector (`workflow-inspector`) made a tenant's deployed BPMNs and registered JARs visible in the tree, but strictly read-only. A user who wants to change how an approval flows still leaves the IDE entirely: they open the web-based Workflow Modeler, or hand-craft a `curl` upload against a different base URL.

That round trip is unnecessary for the most common case. Per Reltio's own documentation, deploying a BPMN is **self-service** for anyone holding `ROLE_WORKFLOW_MANAGER` — it does not require the Bitbucket repository, a pull request, Reltio review, or the CI pipeline that custom Java goes through. Only *new Java logic* needs that path. So a customer who is reordering approval steps, adding a reviewer, or branching on an existing condition can already do the whole job themselves; the IDE just doesn't let them.

This change closes that gap: create a BPMN from a skeleton or by duplicating an existing one, edit it as XML in a normal editor tab, and deploy it to the tenant — without leaving the tool they already use for Reltio configuration.

## What Changes

- **Drafts are real files on disk**, under `{tenantId}.reltio.tenant/workflows/{processId}.bpmn20.xml`, not scratch buffers. They survive a window reload, are visible in the Explorer, and can be put under source control by the customer if they want. A `Drafts (N)` folder appears under `Workflows` whenever at least one exists — the same conditional-visibility rule the existing Configuration History folder uses.
- **New Workflow** generates a minimal but genuinely deployable BPMN skeleton: start event → one user task → end event. It prompts for the process id **up front** and validates it, because the id is the workflow's identity on the tenant, the filename derives from it, and collision detection has to happen before anything is written.
- **Duplicate as Draft** seeds a new draft from a deployed definition's XML, rewriting the first `<process>` element's `id` and `name`. The new id defaults to `{type}Copy`: reusing the original id does not create a new workflow, it deploys **the next version of the existing one**, which is a materially riskier operation than the word "duplicate" implies.
- **Deploy Workflow to Tenant** uploads a draft to the Workflow Adapter as a multipart file upload — the first time this extension has ever sent a file. It saves a dirty editor first, so a draft can never upload stale disk contents.
- **Delete Draft** removes a draft, behind a modal confirmation.
- **Error handling is consolidated**: `reportWorkflowError()` is extracted and called from fetch, BPMN open, and deploy, so every Workflow surface maps 401/403/404/network failures the same way and names the role a 403 actually requires.
- **`getParent()` is completed for the Workflows sub-tree.** Today nothing below `WorkflowsFolderNode` resolves, so `reveal()` silently does nothing. New and Duplicate both want to reveal the draft they just created, so this is pulled forward from the Custom Workflow Repository change.

## Capabilities

**Code**
- **New files**: `src/workspace/workflowDrafts.ts` (skeleton generation, draft naming, listing, tenant-context resolution — all pure), `scripts/test-workflow-authoring.cjs`
- **Modified files**: `src/api/workflowAdapterClient.ts` (multipart body builder + `deployProcessDefinition`), `src/workspace/environmentManager.ts` (two URI helpers), `src/tree/workflowNodes.ts` (two node classes), `src/tree/multiTenantTreeProvider.ts` (union, Drafts branch, `getParent` completion, `notifyWorkflowDraftsChanged`), `src/extension.ts` (four commands, `reportWorkflowError`, `ensureL3DocumentSaved` → `ensureDocumentSaved`), `package.json`, `ARCHITECTURE.md`

**External API**
- One new outbound call, the first non-GET this extension makes to any service: `POST {adapter}/workflow-adapter/workflow/deployments?tenantId={id}&name={name}`, `multipart/form-data`, carrying the same `Authorization: Bearer` and `EnvironmentURL` headers the read endpoints already use. It goes through `toHttpsBase()` before the token is attached, exactly like every other call.

**Tests**
- `scripts/test-workflow-authoring.cjs`, registered in `scripts/run-unit-tests.cjs`: exact multipart bytes including UTF-8 length correctness, deploy URL and header shape, error mapping, skeleton XML escaping, the process-id validator's accept/reject table, and a `resolveDraftContext()` round trip.

**Docs**
- `ARCHITECTURE.md`: the drafts directory, the multipart pattern, and a recipe note for adding a mutating call to a separate service.

**Not in scope (this change)**
- **BPMN validation** — deferred to V2 by decision. It could only ever be partial: no API exposes which Java classes a registered JAR contains, so a BPMN's `activiti:class` references can never be fully verified. Shipping a check that looks authoritative but isn't is worse than shipping nothing.
- **A visual BPMN diagram** — V2, read-only, reusing the Ontology Viewer pattern.
- **Editing a live definition in place** — a deployed definition stays read-only. The path to changing one is Duplicate → edit → deploy.
- **Connecting the Bitbucket repository, registering JARs, checking for new builds** — the `custom-workflow-repository` change.
- **Local Workflow Adapter testing** — out of scope for the IDE; the shipped skills cover setup instead.
