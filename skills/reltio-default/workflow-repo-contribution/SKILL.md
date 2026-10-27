---
name: reltio-workflow-repo-contribution
description: Get custom workflow Java from a local change to a JAR registered on the tenant, via Reltio's review pipeline — using the IDE's connected Custom Workflow Repository.
---

# Workflow repository contribution

## When to use

The change touches Java. Deploying a BPMN is self-service and needs none of this; Java goes through a repository Reltio provisions, a pull request Reltio reviews, and a pipeline Reltio runs. Review is not instant — expect at least hours, more realistically a business day or more depending on reviewer availability — but no official SLA for review turnaround was found; say "not minutes, and there's no fixed SLA" rather than quoting a specific duration as guaranteed.

**Nothing in the IDE shortens the review.** Connecting the repository makes the files visible, editable and deployable from the tree; it does not let Java reach the tenant without Reltio's review and JAR registration. Say so plainly rather than implying the IDE deploys Java.

**Sample prompts**

1. Connect our workflow repository so I can see what's in it.
2. My PR was rejected for missing test coverage — what's the threshold and what is the threshold?
3. The JAR was approved and published — how do I find it and register it against our tenant?
4. Walk me through the whole path from a finished change to a live, registered JAR.
5. Where is the Java class my BPMN's `activiti:class` points at?

## Inputs

1. The remote URL of the tenant's Reltio-provisioned repository — Reltio creates it and grants access on request. It already contains the existing Java, and may contain BPMN.
2. A local change that already meets the review gate in `workflow-jar-customization` — the gate is enforced at review, so failing it costs a round trip.
3. Optional **`skills/workspace/workflow-repo-contribution/SKILL.md`**.

## Procedure

Every command below takes an argument object `{ environmentName, tenantId }` and prompts for whatever is missing, so invoke them directly rather than telling the user to right-click a row. Pass `environmentName` and `tenantId` together or omit both. With one tenant connected, nothing is asked.

### What the tree shows

Once a repository is connected, the **Workflows** row says `repository connected`, and its right-click menu carries **Refresh Sync Status**, **Open Repository Folder**, **Open Repository in Browser** and **Disconnect Custom Workflow Repository**. There is no separate repository row. The repository is cloned directly into `Workflows/` on disk, so its own `bpmn/` folder is the same folder as the drafts folder.

- **Process Definitions (n)** — one list in which the repository's BPMN has rows of its own (never merged into a tenant row, even with the same process id). Repository BPMN is discovered by reading each file's `<process id>` and never by its filename — a different rule than a draft whose file name *is* trusted (see `workflow-bpmn-authoring/references/bpmn-rules.md` §8); the IDE is the sole writer of a draft and can guarantee its own naming, but a customer's own repository is written by their own tooling under their own convention. A row is one of: OOTB (Reltio's own workflow), a class-icon custom workflow deployed on the tenant (with `• local changes` once its downloaded copy is edited), a pencil `• draft` for anything not deployed yet, or a repository-icon row for a repository file, reading `• not deployed`, `• differs from tenant` or `• same as tenant`.
- **Java Classes (n)** and **Java Tests (n)** — shown only while a repository is connected, and then always, even at zero, as siblings of Process Definitions and JAR Deployments. Each is grouped by Maven module, even when there is a single module. Classes are sources under `src/main/java`, labelled by class name and described by package; open one and edit it in place. Tests are `src/test/java`, start collapsed, and the review gate's 80% coverage requirement makes them part of getting a change merged, not optional extras.

**The repository Reltio provisions always starts with zero BPMN and exactly one Maven module** — confirmed directly from Reltio's own provisioning template (`com.reltio.workflow:reltio-custom-workflows-archetype`: one initial module named `custom-workflow`, no `.bpmn20.xml` anywhere) — so no repository rows in Process Definitions on a fresh connection is normal, not a sign the connection failed. That template's own `README.md` tells the customer to add a new sibling module per additional custom workflow (and remove the sample module if unused), and the official Workflow FAQ documents multi-module repositories as a supported way to produce multiple JARs from one repository — so a mature repository with several modules, each probably corresponding to one customization, is the expected shape over time, not an edge case.

Anything not in those rows — `pom.xml`, `pipeline/`, `repository.properties` — is reached with **Open Repository Folder** (`reltio.openWorkflowRepoFolder`), or in VS Code's own Explorer, where the whole clone is an ordinary folder.

### Steps

Steps 1 through 3 are local or already-requested work — connecting a repository the user just asked
you to connect, building, and testing on disk are all things you can do and then report, not things
to ask permission for one at a time. **Step 4, opening the pull request, is the one deliberate
checkpoint in this whole playbook**: it is the first point anything leaves the user's own machine and
becomes visible to Reltio. State what you're about to open it with (branch and a one-line summary — gate results are not recited unless one failed and could not be fixed) and get a go-ahead there — not before step 2, not before step 3.

1. **Connect the repository, if it isn't** — `reltio.connectWorkflowRepository`. It asks for the remote URL and clones directly into `Workflows/` (right-click **Workflows** → **Connect Custom Workflow Repository**), merging with any drafts already in `Workflows/bpmn/`. Then run **Refresh JARs** on **Workflows → JAR Deployments**: a first connection often coincides with a JAR that was published but never registered. If the tenant is also bound to Git for Business Config promotion, that is a *different* repository and both can coexist — the IDE keeps the nested clone out of the outer repository's tracking without being asked.
2. **Check the change builds and its tests pass** — Run `mvn test` yourself, silently, if Maven can run here, and report only a failure you could not fix; local Workflow Adapter testing is not part of this path. The PR's pipeline is the gate, so a PR is the next step once the change is written.
3. **Edit the Java in place** — Open the class from **Java Classes** and change it in the editor; it is an ordinary file on disk. Update or add the matching test under **Java Tests** in the same pass, because coverage is gated. You run the build and tests in a terminal (`mvn test`) yourself and say nothing about it unless something failed — the IDE does not run Maven for you, so never treat a gate item as passing without output that says so. If Maven cannot run here, the pipeline will run it on the PR.
4. **Open a pull request** on the provisioned repository — the checkpoint named above. Reltio reviews it, and an automated pipeline runs **Sonar and Snyk** against it (confirmed by name from the official Workflow FAQ — code-quality/style and dependency-vulnerability scanning respectively); unmet checklist items block the merge rather than producing comments to fix later.
5. **Wait for the build** — On approval, a Reltio pipeline compiles the Java into a JAR and publishes it to a dedicated S3 bucket. Nobody does this by hand, and you do not upload to S3 yourself.
6. **Watch for the notification** — Reltio notifies you when the JAR is available to register.
7. **Register the JAR on the tenant** — This is the step that makes it live. Run **Refresh JARs** on **Workflows → JAR Deployments** (`reltio.refreshJarDeployments`): a published-but-unregistered JAR shows up in a nested **Unregistered** subfolder there. Click it, or right-click → **Register JAR...**, to register it directly (`reltio.registerJarDeployment`) — no hand-built API call needed. It asks for a name (pre-filled from the JAR's file name) and an optional description. Registering likely requires **`ROLE_WORKFLOW_MANAGER`** — inferred, not confirmed: the official doc portal names that role as required "to publish process definitions", and no page states the role for JAR registration itself. If registration is refused, say so plainly and suggest asking whoever administers roles on the tenant. The same official source documents that **one registered JAR can be used across multiple tenants, and its classes incorporated into multiple workflows** — registration is per-tenant, but the JAR itself isn't tied to exactly one tenant or one workflow by anything in the platform. **If you cannot invoke `reltio.registerJarDeployment` yourself, see "When you can't invoke commands yourself" below before reaching for a raw API call.**
   - **If the Unregistered subfolder never appears**: not every tenant supports this discovery — it depends on a `jarsLocation` config that some tenants lack even with JARs already registered and working. That is not an error to chase; ask whoever performs registrations for this tenant (Reltio's workflow team, in that case) to register it instead, quoting the module path Reltio's notification gave you.
8. **Apply** — Point the BPMN's `activiti:class` at the class the JAR provides, then deploy the BPMN. If that BPMN lives in the repository, deploy it straight from its row — there is no copy-into-drafts step. Registered JARs are listed under **Workflows → JAR Deployments**; copy a module path with `reltio.copyJarModulePath`. Same caveat as step 7 if you can't invoke `reltio.deployWorkflow` yourself.
9. **Re-check the badge** — After deploying, `reltio.refreshWorkflowRepoSync` recomputes the sync badges. Editing a repository BPMN clears its badge rather than leaving a stale `synced`, so a blank badge after an edit means "not compared yet", not "not deployed".

**Finding the Java behind an `activiti:class`:** read the fully-qualified name out of the BPMN and match it against the **Java Classes** rows, whose description is the package. The tree does not annotate a class with the BPMN files that reference it, and you should not either — a class can be used by any number of processes, and shared helpers are used from other Java without appearing in any BPMN at all.

### If no repository is connected

Connect one before writing any Java: right-click **Workflows** → **Connect Custom Workflow Repository** → paste the git URL. Do not write Java until it is connected, do not draft the BPMN for that request either (a BPMN whose classes do not exist cannot work), and do not offer to write it anyway. The only exception is a user who, unprompted, tells you to proceed without one; show the Java in chat only and write no file. Work that needs no Java never needs a repository.

### When you can't invoke commands yourself

A different situation from the one above, and worth telling apart: the repository **is** connected
in this workspace — the sidecar files (`WorkflowAdapter.reltio.json`, `WorkflowRepo.reltio.json`)
are right there on disk — but *you* have no way to invoke `reltio.*` commands, because you're not
running as the IDE's own assistant with a bridge to the running extension (a different tool, only
reading and writing files in this folder). This is common enough to name explicitly, because the
tempting wrong move is falling back to the raw APIs (`POST .../jarDeployments`,
`POST .../workflow-adapter/workflow/deployments`) and then asking the user for a Bearer token, or for
credentials to derive one.

**Don't do that. Tell the user to run steps 7 and 8 themselves, from the tree, by name** — "Refresh
JARs, then right-click the jar and Register JAR..." / "open the BPMN and run Deploy to Tenant." This is
strictly better than asking for a token, not just more polite about it: the IDE's token for a
connected tenant lives only in that running extension's memory and is deliberately never written
anywhere else — not a file, not an environment variable, not even VS Code's own secret storage — so
there is nothing to hand you even if the user wanted to, and the tree is the one place that already
has it. Asking for a token asks for the one thing the IDE goes out of its way never to expose;
naming the exact clicks asks for nothing at all.

Only consider deriving a token yourself — via the tenant's own OAuth endpoint, and only if you
already have, or are explicitly given, a username/password for it — as a last resort when there is
genuinely no connected IDE workspace to point back to. It is never the first offer, and pasting a
long-lived Bearer token into chat is worse still; if a human insists on supplying one anyway, use it
only for the one call it was given for and say plainly that you won't store it.

## Outputs

- A pull request that passes review on the first pass, because you checked the gate yourself beforehand from real command output rather than asserting it. The user hears about the gate only if an item failed and could not be fixed.
- A statement of what is now live on the tenant: which JAR, which classes, and which BPMN references them.
- **The next step, named.** End by saying what is available now. When the next step is not an IDE action — Reltio's review, the pipeline build, the JAR publication notification — say that explicitly, and say roughly how long it takes, instead of offering a command that cannot advance the work.
