## Why

Three small things in the Workflows surface say the wrong thing, and all three cost the same kind of confusion.

The hover introduced by `workflow-row-hover-details` labels the identity field **Process ID**. Nothing else in the product calls it that: the tree row shows it, the deploy contract calls it the `processType`, and the file is named after it. A label nobody else uses reads as a fourth, separate concept.

**Open BPMN** appears in the right-click menu on a process definition row. `ProcessDefinitionNode.command` is already bound to `reltio.openWorkflowBpmn`, so clicking the row runs the identical command with the identical argument. The menu entry is a duplicate of the row itself, and it occupies `navigation@1` — the first slot — pushing **Show BPMN Diagram**, the only thing on that row that a click does *not* already do, down to second.

And **New Workflow…** asks two questions in a row whose prompts do not distinguish them. "Process ID — the workflow's identity on the tenant, and the file name" is followed by "Shown in the Reltio console and in this tree. Free text." To anyone who does not already know Activiti, that is the same question twice, and the usual outcome is the same string typed into both.

## What Changes

- **The hover field is labelled `ID`**, in both `ProcessDefinitionNode` and `WorkflowDraftNode`. The draft row's `ID:` line changes too, so the two hovers agree.
- **The `reltio.openWorkflowBpmn` context-menu entry is removed.** The command stays declared and registered, because the row-click binding resolves it; only the redundant menu item goes. **Show BPMN Diagram** moves up to `navigation@1`.
- **The two draft prompts say what their value is for.** The id prompt leads with `ID` and states it is the technical identifier the system uses — the file name and the tenant identity. The name prompt frames itself as the business-friendly name reviewers see, explicitly contrasted with the id.

## Capabilities

**Code**
- **Modified files**: `src/tree/workflowNodes.ts` (both tooltips), `src/extension.ts` (both prompt strings and the id-taken validation message), `package.json` (`view/item/context`)

**External API**
- None.

**Tests**
- `scripts/test-workflow-inspector.cjs`: the tooltip reads `ID:`, and `Process ID:` is asserted absent — a bare `includes('ID:')` would pass against the old wording.
- `scripts/test-workflow-authoring.cjs`: `reltio.openWorkflowBpmn` stays declared and registered but has no `view/item/context` entry; every `reltio.previewWorkflowDiagram` entry is `navigation@1`; both prompts carry their new wording and the old wording is gone.

**Docs**
- None. `ARCHITECTURE.md` does not enumerate menu entries or prompt text.

**Not in scope (this change)**
- **The `processIdValidationMessage` strings** in `src/workspace/workflowBpmnFiles.ts`, which describe the rule in prose ("A process ID must start with a letter or underscore"). They are accurate as prose and are not a field label.
- **Renaming the concept in code.** `processId` remains the identifier throughout `src/`; this change is about what the user is shown.
