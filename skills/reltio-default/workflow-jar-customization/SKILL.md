---
name: reltio-workflow-jar-customization
description: Write or change the Java behind a Reltio workflow — service tasks, task listeners and validators.
---

# Workflow JAR customization

Normative product context: `openspec/changes/workflow-skills-library/design.md` (D2) and capability **`workflow-authoring`**.

## When to use

The requirement cannot be expressed as ordering: a clarification loop back to the requester, N-of-M quorum, custom notification content, a call to another system, or a validation rule. Anything expressible as ordering belongs in `workflow-bpmn-authoring` instead — it is self-service, this is not.

## Inputs

1. The existing Java in the tenant's provisioned Bitbucket repository — the samples there are the most reliable pattern source.
2. The BPMN that will reference the class, so the `activiti:class` name and the implementation cannot drift apart.
3. Optional **`skills/workspace/workflow-jar-customization/SKILL.md`**.

## Procedure

1. **Confirm Java is actually required** — Restate which specific behaviour cannot be ordering. If it can, stop and switch playbooks; this path costs a pull request and a Reltio review, the other costs one API call.
2. **Extend, never reimplement** — Subclass the OOTB class (`ChangeRequestApply`, `ChangeRequestReject`) rather than implementing `JavaDelegate` and guessing at workflow variable names, which are usually unset.
3. **Keep every listener and service task stateless** — Injected fields are shared singletons reused across invocations. A class field written by one execution can leak into a concurrent one. Pass per-invocation data as arguments or read it back from the `Execution`/`Task`.
4. **Set variables through the service** — Use `ExecutionService.setVariable(execution, name, value)`, not `execution.setVariable(...)` directly.
5. **Meet the review gate before opening the PR** — JDK 17; 80% test coverage; `workflow-api`, `workflow-custom` and GSON at `provided` scope; `maven-shade-plugin` present so the build emits `-everything.jar`; no unused dependencies; no hardcoded secrets.
6. **Apply** — The BPMN half deploys from the tree (`reltio.deployWorkflow`); the Java half goes through `workflow-repo-contribution`.

## Outputs

- Java that compiles on JDK 17 with tests at 80% coverage or above.
- The review-gate list above, reported item by item with its actual state — not a claim that it passes.
