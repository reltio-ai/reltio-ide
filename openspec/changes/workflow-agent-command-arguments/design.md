# Design — workflow-agent-command-arguments

Extends the commands added by `workflow-authoring` and the playbook added by `workflow-skills-library`. No new endpoints.

---

## D1. Widen the existing commands; do not add agent-only ones

**Decision.** Each command's first parameter becomes `TreeItem | WorkflowCommandArgs | undefined`. No parallel `reltio.agent.*` command is added.

**Rationale.** A second set of commands doing the same work is a second set to keep correct. They would drift — a validation rule tightened on the human path and not the agent path, or a confirmation added to one and forgotten on the other — and the drift would be invisible, since each path has its own users who never exercise the other.

Widening also means the agent and the user are demonstrably running the same code: the deploy confirmation cannot be bypassed by calling a different entry point, because there is no different entry point.

The union is narrowed once, in `workflowCommandArgs()`, so no handler discriminates it inline.

## D2. Deploy confirms unconditionally

**Decision.** `confirmDeploy()` is a modal shown before every deploy, naming the process id and tenant and stating whether this creates a workflow or replaces a live one. It supersedes the built-in-collision-only warning.

**Rationale.** Deploy is the only irreversible step in the flow, and it has a property that makes it unusually easy to under-estimate: Activiti versions by process id, so deploying an id that already exists silently becomes version N+1 of a *running* workflow, and new process instances pick it up immediately. There is no local undo.

The collision-only condition was calibrated for a human who had just clicked a button labelled Deploy — for them, the click is the confirmation and an extra dialog is friction. That calibration does not survive the caller becoming an agent. "…and deploy it" in a sentence is a much weaker act of consent than clicking Deploy on a specific row, and the user's mental model of what they approved may not include the tenant or the version semantics at all.

The dialog distinguishes the two cases because they are different decisions. "Uploads as a new workflow" and "replaces the version currently running on this tenant" warrant different amounts of care, and a single generic message would make the dangerous case look like the safe one.

This is the **only** unconditional prompt added. Draft creation is not confirmed (D5).

## D3. Prompt for what is missing, reject nothing

**Decision.** An argument object supplying some fields prompts for the rest. An unrecognised or empty one behaves exactly as the palette invocation does today.

**Rationale.** This is what makes a partial instruction work. "Copy the data change request review workflow" names a source and nothing else; the agent should pass what the user said and let the IDE ask for the process id with its own validator and its own collision check. The alternative — the agent inventing the missing values — puts a guessed process id into a namespace where the id is the deployed identity.

The prompts are the existing ones, unchanged, so the interactive path is identical whether a field was omitted by an agent or by a user opening the palette.

## D4. One connected tenant is not a question

**Decision.** `resolveWorkflowTenant()` uses the argument's tenant if given; otherwise, if exactly one tenant is connected, uses it and says which in the resulting message; otherwise shows a QuickPick.

**Rationale.** Most workspaces have one tenant connected. Asking "which tenant?" when there is one possible answer is the kind of prompt that teaches users to click through prompts without reading, which is exactly the habit that makes D2's confirmation stop working. Naming the tenant in the confirmation covers the case where the single connected tenant is not the one the user was picturing.

## D5. Creating a draft is not confirmed

**Decision.** `reltio.newWorkflowDraft` and `reltio.duplicateWorkflowDraft` write the file and open it, with no confirmation.

**Rationale.** A draft is a local file. It is reversible by deleting it, it touches no tenant, and the user sees the result immediately because the editor opens on it. The cost of prompting is not the click — it is that every dismissible prompt lowers the attention paid to the next one, and the next one here is the deploy.

## D6. Six questions, one turn

**Decision.** The skill instructs the agent to ask all six questions together, and says why.

**Rationale.** The questions are not independent in *value* but they are independent in *answerability* — the user can answer all six without needing the reply to any of them. Serialising them into six turns costs six round trips and reads as interrogation; users start answering "just do it", which is a worse outcome than not having asked.

Each question carries its own default and the consequence of getting it wrong, so the agent can proceed sensibly on a partial answer rather than re-asking. The two that cannot be defaulted away — the process id's validity, and the deploy confirmation — are marked unskippable, because they are the two whose failure is not fixable locally afterwards.

## Test plan

**Automated (Tier B — extends `scripts/test-workflow-skills-library.cjs`)**

The skill's four-H2 structure and bolded-verb Procedure steps are already enforced by that script; the new content is written to satisfy it rather than relax it.

**Not automated, and why.** The handlers are `vscode.window.showQuickPick` / `showInputBox` / `showWarningMessage` sequences. The test stub returns `undefined` from each, so a test could assert only that a cancelled prompt cancels the command — which is not where the risk is. The logic worth asserting (id validation, filename round-trip, identity rewriting) was factored into `workflowDrafts.ts` by `workflow-authoring` and is covered by `test-workflow-authoring.cjs`.

**Manual QA (Tier C)**

| # | Step | Expected |
|---|---|---|
| M1 | Ask the agent to create a new workflow, giving no detail | All six questions arrive in one turn |
| M2 | Answer with an id already deployed on the tenant | The agent re-validates and warns that deploying it would replace a live workflow |
| M3 | Ask for a copy of a workflow, naming it approximately | The agent asks which of the similar ids, rather than choosing |
| M4 | Ask the agent to deploy | A modal naming the process id and tenant appears; dismissing it deploys nothing |
| M5 | Deploy an id already on the tenant | The modal says it replaces the running version, and the button reads Deploy new version |
| M6 | Invoke each command from the palette with no arguments | Behaviour is unchanged from before this change |
| M7 | Invoke with two tenants connected and no tenant argument | A QuickPick appears |
| M8 | Invoke with one tenant connected and no tenant argument | No prompt; the tenant is named in the confirmation |
