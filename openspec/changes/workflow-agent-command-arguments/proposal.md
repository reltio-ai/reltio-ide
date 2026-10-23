## Why

"Create a new workflow", "copy this one and change the reviewer role", "deploy it" are the requests users actually bring to the agent. The commands that do those things existed, but only as tree-item handlers: each one took a `TreeItem` subclass and read the tenant off it. An agent has no `TreeItem`. It could open the right file and write correct XML, then had to tell the user to go right-click a row to deploy it.

The reverse problem was in the skill. It listed inputs but not questions, so an agent would infer a process id from the request, write a file, and only then surface a name the user had not chosen — in a namespace where the id **is** the deployed identity and reusing an existing one replaces a live workflow.

And `reltio.deployWorkflow` confirmed only when it detected a collision with a Reltio built-in. Every other deploy went straight out. That is defensible for a human who clicked a button labelled Deploy; it is not defensible when the caller is an agent acting on "…and deploy it", where the user's sense of what they approved is much looser than the API call about to happen.

## What Changes

- **Three workflow commands accept a plain argument object** as well as a `TreeItem`, so an agent can invoke them directly. `workflowCommandArgs()` narrows the union in one place and `resolveWorkflowTenant()` handles tenant selection, prompting only when the answer is genuinely unknown — with one tenant connected, it is used without a question.
- **Deploy always confirms, modally**, and the dialog states which case it is: a new workflow, or a new version of one already live on the tenant. This replaces the collision-only warning. It is the one irreversible step in the flow and the only unconditional prompt added.
- **Missing arguments still prompt.** A partial call is completed interactively rather than rejected, so the agent can supply what the user said and let the IDE ask for the rest.
- **The skill asks its questions up front, together.** Six questions in one turn — tenant, new or copy, which source, process id, display name, draft-only or deploy — rather than one per turn for six turns, which is worse than asking nothing.
- **Process id validity and the deploy confirmation are marked unskippable** in the skill, since they are the two checks whose failure is not recoverable locally.

## Capabilities

**Code**
- **Modified files**: `src/extension.ts` (`WorkflowCommandArgs`, `workflowCommandArgs`, `resolveWorkflowTenant`, `confirmDeploy`, and the three command handlers — `reltio.newWorkflowDraft`, `reltio.duplicateWorkflowDraft`, `reltio.deployWorkflow`), `skills/reltio-default/workflow-bpmn-authoring/SKILL.md`, `resources/reltio-agent-assets.json`

**External API**
- None. The same endpoints are called by the same client functions.

**Tests**
- Extends `scripts/test-workflow-skills-library.cjs` for the skill's structure. The command handlers themselves stay Tier C: they are `vscode.window` interaction, which the stub cannot meaningfully exercise, and the logic worth asserting was already factored out into `workflowDrafts.ts` by `workflow-authoring`.

**Docs**
- The skill's own Inputs and Procedure sections, which are the agent-facing documentation.

**Not in scope (this change)**
- **A confirmation on draft creation.** Writing a local file is reversible by deleting it. Prompting there would train users to dismiss prompts, which is what makes the deploy one stop working.
- **Language-model tool declarations.** The commands are now callable with plain arguments, which is what the skill needs; `languageModelTools` contributions are a larger surface and a separate decision.
- **Batch deploy.** One definition at a time, one confirmation each.
