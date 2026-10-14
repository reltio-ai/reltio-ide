---
name: reltio-workflow-local-adapter-setup
description: Stand up a local Workflow Adapter and database so a custom workflow can be tested before it is submitted.
---

# Local Workflow Adapter setup

Normative product context: `openspec/changes/workflow-skills-library/design.md` (D4) and capability **`workflow-authoring`**.

## When to use

**Not part of the standard path.** Local adapter testing is not currently supported in this IDE's workflow. Use this playbook only when the user explicitly asks for it, and never propose it as a next step or as a "prove it first" stage.

Custom Java has to be proven before it goes into a pull request. Reltio IDE does not run this for you — it is a separate service on the developer's own machine — so this playbook is the guided version of a setup that is otherwise figure-it-out-yourself.

**Sample prompts**

1. Walk me through setting up a local Workflow Adapter so I can test a new listener before opening a PR.
2. My local adapter starts but the BPMN I deployed to it doesn't show up as a process definition — why?
3. How do I attach a debugger to step through my custom class while a local process instance runs?

## Inputs

1. JDK 17 specifically, Maven, and a local MariaDB — the adapter will not start against a database it cannot reach, and JDK 17 is what the review gate's build is pinned to (see `workflow-jar-customization/references/java-patterns.md`), so testing on a newer JDK installed alongside it risks a false pass.
2. The Workflow Adapter distribution, the tenant's platform environment URL, and a bearer token for the tenant being stood in for.
3. **`references/start-adapter.sh`** (Mac/Linux) or **`references/start-adapter.bat`** (Windows) — the launch command, with the JDK path and debug port already set; only the JDK path needs editing.
4. The official **Setting Up the Reltio Workflow Adapter** doc-portal pages (indexed in `workflow-bpmn-authoring/references/reltio-doc-portal-reference.md`) for anything this playbook doesn't already cover — its index page confirms real sections titled "Setting up JAVA HOME variables," "Install MariaDB server," and "Debugging a custom JAR file," but this skill hasn't fetched their content, so the exact `app.properties` key names in step 2 below are this team's best inference, not a transcription — verify them against those pages or your adapter distribution's own sample config before trusting them literally.
5. Optional **`skills/workspace/workflow-local-adapter-setup/SKILL.md`**.

## Procedure

Nothing below touches a live tenant or a shared system — a local database, a local process, a local
debugger. Work through all seven steps and bring back the result; there is no checkpoint in this
skill to stop at, only a result to report at the end (Outputs) or a specific failure to surface the
moment one actually blocks you.

1. **Create the database and user** — A dedicated MariaDB schema and an account with rights on it. Nothing else works until this does.
2. **Point the adapter at it** — Configure `app.properties` (the file `-DWORKFLOW_CONFIG_NAME` in the launch script names) with the JDBC URL, credentials, and the folder it should load JARs from. **NEEDS VERIFICATION**: the exact property key names (e.g. a `spring.datasource.url`-shaped key, a JAR-folder key) were not confirmed against an official source this session — see Input 4. Start it with the script from Input 3 (edit the JDK path first) and confirm it answers on `localhost:8080`.
3. **Register the tenant you are simulating** in the local database, so the adapter knows which environment it stands in for. If the adapter fails here or on step 2 with a TLS/certificate error while reaching the tenant's platform environment URL, that's a local JVM truststore problem, not a config mistake — a corporate proxy or an internal cert chain the local JDK doesn't already trust is the common cause. **NEEDS VERIFICATION**: the exact remediation (importing a cert into the JDK's `cacerts`, or a `-Djavax.net.ssl.trustStore` flag) wasn't confirmed against an official source this session; this is a named failure mode to recognize, not a tested fix.
4. **Build and place the JAR** — `mvn package` produces `-everything.jar` via the shade plugin; copy it to the JAR folder from step 2, then register it with the local adapter over its API.
5. **Deploy the BPMN locally** — A local adapter has no process definitions at all, not even the out-of-the-box ones. Deploy yours the same way as to a tenant. If it deploys without error but never shows up in a subsequent process-definitions list, check in order: the deploy actually targeted this local adapter's port (not a remote tenant by mistake — easy to do if the environment URL was left pointed at a real tenant); the file name ends exactly in `.bpmn20.xml` (see `bpmn-rules.md` §8 — a near-miss name deploys to a different internal bucket than expected on some adapter versions); and the process `id` doesn't collide with something already deployed under a different version you forgot about. This is a local-only checklist — a definition silently missing after a deploy that reported success is not an expected or well-understood failure mode, only a short list of what to rule out first.
6. **Attach a debugger** — Both scripts open debug port `5005`. In VS Code: **Run and Debug → create `launch.json` → add a configuration with `"type": "java"`, `"request": "attach"`, `"hostName": "localhost"`, `"port": 5005`**, then launch it after the adapter is already running. In IntelliJ: **Run → Edit Configurations → + → Remote JVM Debug**, host `localhost`, port `5005`, then Debug that configuration. Either way, start the adapter *first* — attaching to a port nothing is listening on just fails to connect, it doesn't wait.
7. **Step through it** — Set breakpoints, start a process instance against the local adapter, and confirm the behaviour. Verify the outcome on the object, not just that the process completed.

## Outputs

- A local adapter that starts clean and has your JAR and BPMN loaded.
- Evidence the workflow behaved correctly — the observed end state, not only a green process instance.
- Anything that had to be worked around locally, flagged as local-only so it is not mistaken for tenant behaviour.
- **The next step, named.** Once the behaviour is proven locally, that is the pull request (`workflow-repo-contribution`) for a Java change, or deploying the BPMN for a self-service one. If it is not proven, the next step is the specific failure observed — not another round of setup.
