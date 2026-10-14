---
name: reltio-workflow-jar-customization
description: Write or change the Java behind a Reltio workflow — service tasks, task listeners and validators.
---

# Workflow JAR customization

Normative product context: `openspec/changes/workflow-skills-library/design.md` (D2) and capability **`workflow-authoring`**.

## When to use

The requirement cannot be expressed as ordering: a clarification loop back to the requester, N-of-M quorum, custom notification content, a call to another system, or a validation rule. Anything expressible as ordering belongs in `workflow-bpmn-authoring` instead — it is self-service, this is not.

**Sample prompts**

1. When a DCR is approved, we need to call an external inventory API before the change commits — can this be a service task?
2. Write a task listener that blocks assignment to anyone outside the requester's own region.
3. Our custom class works alone but fails intermittently under load — could it be a statefulness bug?

## Inputs

1. **`references/java-patterns.md`** (beside this file) — the actual interfaces (`WorkflowTaskListener`, `WorkflowExecutionListener`, the validator contract), code skeletons, the real `pom.xml` transcribed from Reltio's own customer-repository provisioning template, and a Known Ambiguities section for the two places sources disagree (the coverage-gate number, and the validator method signature). Read it before writing a class, not after.
2. The existing Java in the tenant's provisioned Bitbucket repository — the samples there are the most reliable pattern source, and the one place that can resolve anything `references/java-patterns.md` flags as unconfirmed for *your* tenant's platform version.
3. The BPMN that will reference the class, so the `activiti:class` name and the implementation cannot drift apart.
4. Optional **`skills/workspace/workflow-jar-customization/SKILL.md`**.

## Procedure

Everything below — picking the extension point, writing the class, writing its test, checking the
gate — is local work on disk with nothing to ask permission for along the way. The one checkpoint in
this whole path belongs to `workflow-repo-contribution`'s PR step, not to this skill; get all the way
to a gate reported clean before involving the user again.

1. **Confirm Java is actually required** — Restate which specific behaviour cannot be ordering. If it can, stop and switch playbooks; this path costs a pull request and a Reltio review, the other costs one API call.
2. **Pick the right extension point** — A service task's own logic: extend an OOTB class (`ChangeRequestApply`, `ChangeRequestReject`) rather than implementing `JavaDelegate` and guessing at workflow variable names, which are usually unset. A listener on a user task: implement `WorkflowTaskListener`. A listener on a service task: implement `WorkflowExecutionListener`. A validator: the `doValidate(...)` contract. See `references/java-patterns.md` for the confirmed names and skeletons for each.
3. **Keep every listener and service task stateless** — Injected fields are shared singletons reused across invocations. A class field written by one execution can leak into a concurrent one. Pass per-invocation data as arguments or read it back from the `Execution`/`Task`.
4. **Set variables through the service** — Use `ExecutionService.setVariable(execution, name, value)` for writes, not `execution.setVariable(...)` directly. Reads go through `execution.getEngineServices().getRuntimeService().getVariable(...)` — confirmed directly from Reltio's own documentation, see `references/java-patterns.md`.
5. **Meet the review gate before opening the PR** — JDK 17; `workflow-api`, `workflow-custom`, and `jackson-databind` at `provided` scope (not GSON — confirmed from the real provisioning template's `pom.xml`); `maven-shade-plugin` present so the build emits `-everything.jar`; no unused dependencies; no hardcoded secrets. **80% line coverage per package**, enforced by the template's own `jacoco-check` rule — the official doc portal states a 70% minimum elsewhere, but 80% is what the actual pipeline checks (see `references/java-patterns.md`'s Known Ambiguities for why these two numbers disagree and which one to treat as binding).

   **Run the gate yourself, silently, before claiming any item passes — show output only for a failure, and never hand these commands to the user as a to-do. If Maven cannot run here (for example the Reltio repository is not reachable), say once, in one sentence, that the pipeline will run it on the PR — do not present that as a blocker or a user task:**
   - `python pipeline/WorkflowJarProjectValidator.py ./pom.xml` — reproduces the pipeline's own `verify-pom` step: JDK version ≤17, pinned AWS SDK versions, and `provided` scope on `workflow-api`/`workflow-custom`/`gson`. Run from the repository root; it reads every module's `pom.xml` via the parent's `<modules>` list. Safe to run with no Bitbucket env vars set — it only attempts to post a PR comment when `BITBUCKET_PR_ID` is present, and skips that step otherwise.
   - `mvn -B verify` — reproduces the pipeline's own `build-and-test` step: compiles on the configured JDK, runs the JUnit suite, and enforces the JaCoCo `jacoco-check` coverage rule from the root `pom.xml`. A failure here is the same failure the pipeline would report — fix it before opening the PR, not after.
   - Neither command needs network access to Bitbucket or Reltio's own infra; both run entirely against the local working tree. They do **not** cover `Snyk`, `SonarCloud`, or the `git-secrets-scan` steps, which only run inside the real pipeline — say so rather than implying full gate parity.
6. **Apply** — The BPMN half deploys from the tree (`reltio.deployWorkflow`); the Java half goes through `workflow-repo-contribution`.

## Outputs

- Java that compiles on JDK 17 with tests at 80% line coverage per package or above (the number the pipeline actually enforces — see Procedure step 5).
- The review-gate list above, reported item by item with its actual state — not a claim that it passes.
- **The next step, named: "Shall I raise a PR for this?"** (`workflow-repo-contribution`). With a gate item failing, it is that item and nothing else. Do not propose local adapter testing or running Maven as the user's next step — the PR's pipeline is the gate, then registration and deploy from the tree.
