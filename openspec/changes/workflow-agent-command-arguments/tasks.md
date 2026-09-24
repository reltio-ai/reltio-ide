## 1. Argument handling

- [x] 1.1 Add the `WorkflowCommandArgs` type to `src/extension.ts` — `environmentName`, `tenantId`, `processId`, `displayName`, `sourceProcessId`, all optional.
- [x] 1.2 Add `workflowCommandArgs(arg)` narrowing `TreeItem | WorkflowCommandArgs | undefined` in one place, so no handler discriminates the union inline (D1).
- [x] 1.3 Add `resolveWorkflowTenant(args)`: the argument's tenant, else the single connected tenant, else a QuickPick (D4).

## 2. Commands

- [x] 2.1 Widen `reltio.newWorkflowDraft` to accept the argument object; prompt for anything missing, with the existing validator and collision check (D3).
- [x] 2.2 Widen `reltio.duplicateWorkflowDraft`; fall back to `pickProcessDefinition` when `sourceProcessId` is absent.
- [x] 2.3 Widen `reltio.deployWorkflow`, keeping the `Uri` and palette paths working.
- [x] 2.4 Add `confirmDeploy(processId, tenantId, replacesLive)` — a modal, shown before **every** deploy, whose detail text and button label differ between creating a workflow and replacing a running one (D2).
- [x] 2.5 Remove the collision-only warning that `confirmDeploy` supersedes, so there is one confirmation rather than two on the built-in path.
- [x] 2.6 Leave draft creation unconfirmed (D5).

## 3. Skill

- [x] 3.1 Rewrite the playbook's Inputs to carry all six questions as one item, each with its default and the consequence of getting it wrong (D6).
- [x] 3.2 Add the command-invocation table to Procedure, documenting the argument object for each of the three commands.
- [x] 3.3 Mark process-id re-validation and the deploy confirmation as unskippable.
- [x] 3.4 Keep the four-H2 structure (SKILL.md's own sections, unrelated to the command count above) and bolded-verb Procedure steps that `scripts/test-workflow-skills-library.cjs` enforces — new content goes inside the existing sections, not beside them.
- [x] 3.5 Bump `skillsBundleVersion` in `resources/reltio-agent-assets.json`.

## 4. Verify

- [x] 4.1 `npm run compile` and `npm test` green, including the skills-library structural test.
- [ ] 4.2 Tier C manual QA per design.md's test plan — M4 and M5 are the confirmation behaviour.
