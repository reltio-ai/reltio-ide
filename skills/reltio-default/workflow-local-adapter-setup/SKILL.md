---
name: reltio-workflow-local-adapter-setup
description: Stand up a local Workflow Adapter and database so a custom workflow can be tested before it is submitted.
---

# Local Workflow Adapter setup

Normative product context: `openspec/changes/workflow-skills-library/design.md` (D4) and capability **`workflow-authoring`**.

## When to use

Custom Java has to be proven before it goes into a pull request. Reltio IDE does not run this for you — it is a separate service on the developer's own machine — so this playbook is the guided version of a setup that is otherwise figure-it-out-yourself.

**Sample prompts**

1. Walk me through setting up a local Workflow Adapter so I can test a new listener before opening a PR.
2. My local adapter starts but the BPMN I deployed to it doesn't show up as a process definition — why?
3. How do I attach a debugger to step through my custom class while a local process instance runs?

## Inputs

1. JDK 17, Maven, and a local MariaDB — the adapter will not start against a database it cannot reach.
2. The Workflow Adapter distribution, the tenant's platform environment URL, and a bearer token for the tenant being stood in for.
3. **`references/start-adapter.sh`** (Mac/Linux) or **`references/start-adapter.bat`** (Windows) — the launch command, with the JDK path and debug port already set; only the JDK path needs editing.
4. Optional **`skills/workspace/workflow-local-adapter-setup/SKILL.md`**.

## Procedure

1. **Create the database and user** — A dedicated MariaDB schema and an account with rights on it. Nothing else works until this does.
2. **Point the adapter at it** — Configure the adapter's properties with the JDBC URL, credentials, and the folder it should load JARs from. Start it with the script from Input 3 (edit the JDK path first) and confirm it answers on `localhost:8080`.
3. **Register the tenant you are simulating** in the local database, so the adapter knows which environment it stands in for.
4. **Build and place the JAR** — `mvn package` produces `-everything.jar` via the shade plugin; copy it to the JAR folder from step 2, then register it with the local adapter over its API.
5. **Deploy the BPMN locally** — A local adapter has no process definitions at all, not even the out-of-the-box ones. Deploy yours the same way as to a tenant.
6. **Step through it** — Set breakpoints, start a process instance against the local adapter, and confirm the behaviour. Verify the outcome on the object, not just that the process completed.

## Outputs

- A local adapter that starts clean and has your JAR and BPMN loaded.
- Evidence the workflow behaved correctly — the observed end state, not only a green process instance.
- Anything that had to be worked around locally, flagged as local-only so it is not mistaken for tenant behaviour.
