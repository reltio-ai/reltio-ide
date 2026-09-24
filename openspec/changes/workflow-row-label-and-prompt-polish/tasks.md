## 1. Tooltip label

- [x] 1.1 In `src/tree/workflowNodes.ts`, change `ProcessDefinitionNode`'s field from `['Process ID', …]` to `['ID', …]` (D1).
- [x] 1.2 Change `WorkflowDraftNode`'s tooltip line from `Process ID: …` to `ID: …`, so the two rows agree (D1).

## 2. Menu

- [x] 2.1 Remove the `reltio.openWorkflowBpmn` entry from `view/item/context` in `package.json`, leaving the command declaration and the `registerCommand` call alone (D2).
- [x] 2.2 Move both `reltio.previewWorkflowDiagram` context entries from `navigation@2` to `navigation@1` (D2).

## 3. Prompts

- [x] 3.1 Reword the process-id prompt in `src/extension.ts` to lead with `ID` and state it is the technical identifier — file name and tenant identity (D3).
- [x] 3.2 Reword both display-name prompts to name the audience and contrast the value with the id (D3).
- [x] 3.3 Change the id-taken validation message to say `ID` rather than `process ID`, since it renders under the reworded prompt (D3).

## 4. Tests

- [x] 4.1 Extend `scripts/test-workflow-inspector.cjs` with design.md test-plan items 1–3, including the negative assertion on `Process ID:`.
- [x] 4.2 Drop `reltio.openWorkflowBpmn` from `mustBeRightClickable` in `scripts/test-workflow-authoring.cjs` and add items 4, 5 and 7 as an explicit exception with its reason.
- [x] 4.3 Add items 8 and 9, asserting both new prompt strings and the absence of the old one.

## 5. Verify

- [x] 5.1 `npm run compile` and `npm test` green.
- [ ] 5.2 Tier C manual QA per design.md's test plan.
