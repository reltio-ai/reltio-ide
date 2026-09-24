# Design — workflow-row-label-and-prompt-polish

Wording and menu placement only. No behaviour changes, no new data, no new files.

---

## D1. `ID`, not `Process ID`

**Decision.** Both workflow tooltips label the field `ID`.

**Rationale.** Three names already exist for this value — the row's own description text, the `processType` in the deploy contract, and the file stem — and `Process ID` is a fourth that appears nowhere else. Dropping the qualifier is not a loss of precision: the hover is already headed **Custom workflow** or **Built-in workflow**, so "the ID of what" is answered one line above.

The draft row's tooltip is changed in the same commit rather than left for later. Two rows in the same tree using different labels for the same value is the confusion this change is removing, not a smaller version of it.

## D2. The redundant menu entry, not the command

**Decision.** Remove `reltio.openWorkflowBpmn` from `view/item/context`. Keep the command declared in `contributes.commands` and registered in `src/`.

**Rationale.** The command is what a plain row click executes — `ProcessDefinitionNode` sets `command` to it, with the node as the argument — so a menu entry offers the user a second way to do what single-clicking the row they are already pointing at does. Verified before removing: nothing in `src/` invokes it through `executeCommand`, so the only other consumer is the click binding.

Deleting the command as well would break that binding. This is also why `scripts/test-workflow-authoring.cjs` keeps its "every declared command is registered" check and gains a *separate* assertion that this one has no menu entry: the two properties are independent, and a single "is it wired up" check would not have caught either direction.

**Consequence.** With the duplicate gone, **Show BPMN Diagram** is the only action on a definition row, so it takes `navigation@1`. Leaving it at `navigation@2` would put the sole entry in the second slot, which renders identically today and quietly mis-orders the menu the moment anything else is added.

## D3. Prompts state what the value is for, not what it is

**Decision.** The id prompt is `ID — the technical identifier the system uses: it becomes the file name and the workflow's identity on the tenant.` The name prompt is `Business-friendly name shown to reviewers in the Reltio console and in this tree (not the technical ID).`

**Rationale.** The flow already asked two questions; the defect was that neither prompt said how its answer differs from the other's. Naming the *audience* is what separates them — the system reads one, a reviewer reads the other — and it is more useful than describing the format, because the format is already enforced by `validateInput` on the first and unconstrained on the second.

The parenthetical on the name prompt is doing real work. The name field is pre-filled with the id, so without it the obvious action is to accept the default, and the two values stay identical for the life of the workflow.

The id-taken validation message changes from "A draft with this process ID already exists" to "…this ID…" for the same reason as D1: it appears directly under a prompt now labelled `ID`.

## Test plan

**Automated (Tier A/B)**

| # | Assertion | Script |
|---|---|---|
| 1 | The definition tooltip contains `ID: <id>` | `test-workflow-inspector.cjs` |
| 2 | It does **not** contain `Process ID:` — a bare `includes('ID:')` passes against the old wording, so the negative is the real assertion | `test-workflow-inspector.cjs` |
| 3 | A sparse row (only `type`) shows `ID:` and not `Process ID:` | `test-workflow-inspector.cjs` |
| 4 | `reltio.openWorkflowBpmn` is still declared in `contributes.commands` | `test-workflow-authoring.cjs` |
| 5 | It has zero `view/item/context` entries | `test-workflow-authoring.cjs` |
| 6 | It is still passed to `registerCommand` in `src/` (the existing declared-vs-registered sweep) | `test-workflow-authoring.cjs` |
| 7 | Every `reltio.previewWorkflowDiagram` context entry is `navigation@1` | `test-workflow-authoring.cjs` |
| 8 | The id prompt leads with `ID — the technical identifier`, and no prompt begins `Process ID` | `test-workflow-authoring.cjs` |
| 9 | The name prompt frames itself as business-friendly and contrasts itself with the id | `test-workflow-authoring.cjs` |

**Manual QA (Tier C)**

| # | Step | Expected |
|---|---|---|
| M1 | Hover a deployed definition | Bold classification, then `ID:` — no `Process ID:` |
| M2 | Right-click a definition row | **Show BPMN Diagram** first; no **Open BPMN** |
| M3 | Single-click the same row | The BPMN opens, exactly as before |
| M4 | Run **New Workflow…** | Two prompts that read as different questions |

## Open questions

None. Each of the three is a wording or placement decision with a single defensible answer.
