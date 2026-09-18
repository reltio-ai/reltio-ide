---
name: reltio-workflow-bpmn-authoring
description: Author or edit a BPMN process definition for a Reltio tenant, and deploy it from the Workflows tree.
---

# BPMN authoring

Normative product context: `openspec/changes/workflow-skills-library/design.md` (D1) and capability **`workflow-authoring`**.

## When to use

The user wants a new approval flow, an extra review step, different reviewers per step, or conditional routing — anything that changes **the order things happen** rather than the logic inside a step.

## Inputs

1. **`references/bpmn-rules.md`** (beside this file) — read it **before** writing any XML. It is the deny-list and validation checklist, not background reading.
2. The tenant's deployed definitions (**Workflows → Process Definitions**) and the roles that exist on it, for `candidateGroups`.
3. Optional **`skills/workspace/workflow-bpmn-authoring/SKILL.md`**.

## Procedure

1. **Decide whether BPMN is enough** — Extra steps, different reviewers, routing on a submitted decision and due dates are BPMN-only. Clarification loops, N-of-M quorum, custom notification text and external calls need Java; say so and stop rather than approximating.
2. **Check the id** — Ask whether the process `id` already exists on the tenant. If it does, deploying creates **version N+1 of that live workflow**, not a new one. For a DCR customization the id must stay `dataChangeRequestReview`.
3. **Plan before XML** — State the flow, each task with its `candidateGroups`, each gateway with its default, and every `activiti:class`. Get agreement, then write.
4. **Write from the skeleton** — Copy §1 of `bpmn-rules.md`. Use only the OOTB class names in §5; an invented class deploys and then fails at runtime.
5. **Run the checklist** — All ten items in §10 must pass. Report each one, not a summary.
6. **Apply** — If you can invoke VS Code commands, use **New Workflow…** (`reltio.newWorkflowDraft`) or **Duplicate as Draft…** (`reltio.duplicateWorkflowDraft`). If you can only write files, create the draft yourself at `.reltio/<environment>.reltio.environment/<tenantId>.reltio.tenant/workflows/<processId>.bpmn20.xml` — reuse the environment and tenant folder names already in the workspace rather than inventing them; anything written elsewhere will not be recognized as a draft. The Workflows tree picks it up on save, with no refresh needed. Then edit the file and deploy with **Deploy to Tenant** (`reltio.deployWorkflow`).

## Outputs

- A `.bpmn20.xml` file that passes every item in §10, with the checklist reported item by item.
- A one-line statement of whether this deploy creates a new workflow or a new version of an existing one.
