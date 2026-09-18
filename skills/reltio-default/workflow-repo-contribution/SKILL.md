---
name: reltio-workflow-repo-contribution
description: Get custom workflow Java from a local change to a JAR registered on the tenant, via Reltio's review pipeline.
---

# Workflow repository contribution

Normative product context: `openspec/changes/workflow-skills-library/design.md` (D3) and capability **`workflow-authoring`**.

## When to use

The change touches Java. Deploying a BPMN is self-service and needs none of this; Java goes through a repository Reltio provisions, a pull request Reltio reviews, and a pipeline Reltio runs. Expect roughly a business day for review, not minutes.

## Inputs

1. Access to the tenant's Bitbucket repository — Reltio creates it and grants access on request; it already contains the existing BPMN and Java.
2. A local change that already meets the review gate in `workflow-jar-customization` — the gate is enforced at review, so failing it costs a round trip.
3. Optional **`skills/workspace/workflow-repo-contribution/SKILL.md`**.

## Procedure

1. **Prove it locally first** — Run it against a local Workflow Adapter before opening anything. See `workflow-local-adapter-setup`. A PR is a poor place to discover the logic is wrong.
2. **Open a pull request** on the provisioned repository. Reltio reviews it and runs automated security scans; unmet checklist items block the merge rather than producing comments to fix later.
3. **Wait for the build** — On approval, a Reltio pipeline compiles the Java into a JAR and publishes it to a dedicated S3 bucket. Nobody does this by hand, and you do not upload to S3 yourself.
4. **Watch for the notification** — Reltio notifies you when the JAR is available to register.
5. **Register the JAR on the tenant** — This is the step that makes it live. Confirm who performs it for your tenant; it is either you via the registration API or Reltio's workflow team.
6. **Apply** — Point the BPMN's `activiti:class` at the class the JAR provides, then deploy the BPMN from the tree (`reltio.deployWorkflow`). Registered JARs are listed under **Workflows → JAR Deployments**; copy a module path with `reltio.copyJarModulePath`.

## Outputs

- A pull request that passes review on the first pass, with each gate item evidenced.
- A statement of what is now live on the tenant: which JAR, which classes, and which BPMN references them.
