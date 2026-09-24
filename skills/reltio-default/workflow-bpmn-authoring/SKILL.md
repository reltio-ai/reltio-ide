---
name: reltio-workflow-bpmn-authoring
description: Author or edit a BPMN process definition for a Reltio tenant, and deploy it from the Workflows tree.
---

# BPMN authoring

Normative product context: `openspec/changes/workflow-skills-library/design.md` (D1) and capability **`workflow-authoring`**.

## When to use

The user wants a new approval flow, an extra review step, different reviewers per step, or conditional routing — anything that changes **the order things happen** rather than the logic inside a step.

**Sample prompts**

1. Add a second review step to our DCR approval flow, with a different role reviewing after the first approval.
2. Create a new BPMN for a potential-match review that routes to Merge or Not-a-Match based on the reviewer's decision.
3. I have a workflow that deploys but the task never shows up for anyone — what's wrong?

## Inputs

1. **`references/bpmn-rules.md`** (beside this file) — read it **before** writing any XML. It is the deny-list and validation checklist, not background reading. Most of §10 is now enforced by the editor as you type (see Procedure 7), so it is what you write *from*, not what you grade yourself against afterwards. Its §12 "Known Ambiguities" lists what is confirmed against Reltio's own source/docs versus this team's inference from observed deploy behavior — read it before stating any rule as unconditional. Its §14 lists all 4 fixed OOTB workflows (not just DCR) and how each one actually triggers — read it before customizing PMR, Delete, or Authoring, since the same "keep the id or the UI stops auto-triggering it" rule applies to all four, and Delete's id is the one known to vary by tenant (`deleteReview` vs. `recommendForDelete`).
2. **`references/reltio-doc-portal-reference.md`** (beside this file) — the citable, official Reltio doc-portal pages and the public `github.com/reltio-ai/workflow` source repository for this domain. If it and `bpmn-rules.md` disagree, the official source wins; say so rather than picking a side silently.
3. The tenant's deployed definitions (**Workflows → Process Definitions**) and the roles that exist on it, for `candidateGroups`.
4. **Answers to all six of these, asked together in one turn** — a question per turn for six turns is worse than no questions. *Which tenant?* (drafts live under one tenant and deploy to it; with one connected, use it and say which). *New workflow, or a copy of an existing one?* (a copy inherits working structure and is usually the right start). *Which workflow is being copied?* (ask by name if the user was approximate — never guess between two similar ids). *What is the process `id`?* (it is the identity on the tenant and the filename; reusing a deployed id deploys version N+1 of that live workflow). *What is the display name?* (free text; default it to the id and say so). *Draft only, or deploy as well?* (deploying writes to a live tenant — never assume).
5. Optional **`skills/workspace/workflow-bpmn-authoring/SKILL.md`**.

## Procedure

1. **Restate** the six answers in one line — tenant, new-or-copy, id, name, deploy-or-not — before doing anything.
2. **Decide whether BPMN is enough** — Extra steps, different reviewers, routing on a submitted decision and due dates are BPMN-only. Clarification loops, N-of-M quorum, custom notification text and external calls need Java; say so and stop rather than approximating.
3. **Check the id** — Ask whether the process `id` already exists on the tenant. If it does, deploying creates **version N+1 of that live workflow**, not a new one. For a DCR customization the id must stay whatever the tenant's `dcr.processtype` setting names (default `dataChangeRequestReview`); for PMR, Delete, or Authoring the same rule applies to that flow's own id (§14) — and for Delete specifically, confirm the live id with `GET /processDefinitions` rather than assuming `deleteReview` or `recommendForDelete`.
4. **Plan before XML** — State the flow, each task with its `candidateGroups` **and its two required create listeners from §3 — every user task, not only the first**, each gateway with its default, and every `activiti:class`. Get agreement, then write. Listeners are easy to type correctly once and by memory the second time; a second or third review task is the one most likely to be missing one, which is exactly why the plan calls it out per task rather than once for the workflow.
5. **Write from the skeleton** — Copy §1 of `bpmn-rules.md` in full, including the three diagram namespaces, and emit the `<bpmndi:BPMNDiagram>` section from §11. A definition with no diagram interchange executes correctly and renders as a blank canvas in every viewer, the Reltio console included. Use only the OOTB class names in §5; an invented class deploys and then fails at runtime.
6. **Invoke the command with what you already know** — each takes an argument object and prompts only for what is missing: `reltio.newWorkflowDraft` with `{ environmentName, tenantId, processId, displayName }`, `reltio.duplicateWorkflowDraft` with the same plus `sourceProcessId`, `reltio.deployWorkflow` with `{ environmentName, tenantId, processId }`. Pass `environmentName` and `tenantId` together or omit both. Two things you cannot bypass: the process id is always re-validated in a prompt pre-filled with yours (if the user changes it, that is the id — use it in everything you say afterwards), and deploy always shows a modal confirmation with no flag to suppress it. If the user declines, nothing was uploaded; say so rather than retrying. If you cannot invoke commands at all, write the file at `.reltio/<environment>.reltio.environment/<tenantId>.reltio.tenant/workflows/<processId>.bpmn20.xml`, reusing folder names already in the workspace — anything written elsewhere is not recognized as a draft, and the tree picks up a correct path on save.
7. **Read the diagnostics, do not attest to them** — The extension checks nine of the eleven §10 items itself and reports them on the file, so save the draft and read the diagnostics for it (the Problems panel, or the editor's own report for that URI). Quote what it says and fix every finding; a `reltio-bpmn/…` code is the rule it came from. An empty report is the evidence — do not restate the checklist as though you had walked it, because a claim that the file is clean is worth nothing beside a tool that says so. Only §10.7 (condition values matching a form property's `activiti:value` exactly, case included) and §10.10 (whether this id is already live on the tenant) are still yours to check, because nothing in the file can answer either.
8. **Show the diagram** — Run **Show BPMN Diagram** (`reltio.previewWorkflowDiagram`) and have the user check the shape of the flow. It is the fastest review of work you just did.

## Outputs

- A `.bpmn20.xml` file whose diagnostics are empty, quoted as such rather than asserted.
- The two §10 items no tool can check, answered explicitly: whether every condition value matches its form property exactly, and whether this id is already live on the tenant.
- A one-line statement of whether this deploy creates a new workflow or a new version of an existing one.
- Confirmation of what actually happened: draft written, and deployed or not deployed.
