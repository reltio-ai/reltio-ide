---
name: reltio-workflow-repo-contribution
description: Get custom workflow Java from a local change to a JAR registered on the tenant, via Reltio's review pipeline — using the IDE's connected Custom Workflow Repository.
---

# Workflow repository contribution

Normative product context: `openspec/changes/workflow-skills-library/design.md` (D3), capability **`workflow-authoring`**, and capability **`custom-workflow-repository`** for the connected repository itself.

## When to use

The change touches Java. Deploying a BPMN is self-service and needs none of this; Java goes through a repository Reltio provisions, a pull request Reltio reviews, and a pipeline Reltio runs. Review is not instant — expect at least hours, more realistically a business day or more depending on reviewer availability — but no official SLA for review turnaround was found; say "not minutes, and there's no fixed SLA" rather than quoting a specific duration as guaranteed.

**Nothing in the IDE shortens the review.** Connecting the repository makes the files visible, editable and deployable from the tree; it does not let Java reach the tenant without Reltio's review and JAR registration. Say so plainly rather than implying the IDE deploys Java.

**Sample prompts**

1. Connect our workflow repository so I can see what's in it.
2. My PR was rejected for missing test coverage — what's the threshold and how do I check it locally?
3. The JAR was approved and published — how do I find it and register it against our tenant?
4. Walk me through the whole path from a finished local test to a live, registered JAR.
5. Where is the Java class my BPMN's `activiti:class` points at?

## Inputs

1. The remote URL of the tenant's Reltio-provisioned repository — Reltio creates it and grants access on request. It already contains the existing Java, and may contain BPMN.
2. A local change that already meets the review gate in `workflow-jar-customization` — the gate is enforced at review, so failing it costs a round trip.
3. Optional **`skills/workspace/workflow-repo-contribution/SKILL.md`**.

## Procedure

Every command below takes an argument object `{ environmentName, tenantId }` and prompts for whatever is missing, so invoke them directly rather than telling the user to right-click a row. Pass `environmentName` and `tenantId` together or omit both. With one tenant connected, nothing is asked.

### What the tree shows

Under **Workflows → Custom Workflow Repository**, once connected, contents are grouped by kind rather than mirrored as folders:

- **BPMN (n)** — process definitions found anywhere in the repository, discovered by reading each file's `<process id>` and never by its filename — this is a different rule than a Drafts-folder BPMN, whose file name *is* trusted (see `workflow-bpmn-authoring/references/bpmn-rules.md` §8); the two rules aren't in tension, they just apply to different trees: the IDE is the sole writer of a draft and can guarantee its own naming, but a customer's own repository is written by their own tooling under their own convention, so filename is never assumed there. Each row is badged `synced`, `changed`, or `not deployed` against the tenant, and can be deployed directly.
- **Java Classes (n)** — sources under `src/main/java`, labelled by class name and described by package. Open one and edit it in place.
- **Java Tests (n)** — sources under `src/test/java`. Starts collapsed. The review gate's 80% coverage requirement makes these part of getting a change merged, not optional extras.

A group with nothing in it is not shown. **The repository Reltio provisions always starts with zero BPMN and exactly one Maven module** — confirmed directly from Reltio's own provisioning template (`com.reltio.workflow:reltio-custom-workflows-archetype`: one initial module named `custom-workflow`, no `.bpmn20.xml` anywhere) — so `BPMN` being absent on a fresh connection is normal, not a sign the connection failed. That template's own `README.md` tells the customer to add a new sibling module per additional custom workflow (and remove the sample module if unused), and the official Workflow FAQ documents multi-module repositories as a supported way to produce multiple JARs from one repository — so a mature repository with several modules, each probably corresponding to one customization, is the expected shape over time, not an edge case.

Anything not in those groups — `pom.xml`, `pipeline/`, `repository.properties` — is reached with **Reveal in File Explorer** (`reltio.openWorkflowRepoFolder`), or in VS Code's own Explorer, where the whole clone is an ordinary folder.

### Steps

Steps 1 through 3 are local or already-requested work — connecting a repository the user just asked
you to connect, building, and testing on disk are all things you can do and then report, not things
to ask permission for one at a time. **Step 4, opening the pull request, is the one deliberate
checkpoint in this whole playbook**: it is the first point anything leaves the user's own machine and
becomes visible to Reltio. State what you're about to open it with (branch, summary, which gate items
you can already show passing) and get a go-ahead there — not before step 2, not before step 3.

1. **Connect the repository, if it isn't** — `reltio.connectWorkflowRepository`. It asks for the remote URL and clones into `Workflows/Custom Workflows/`. Then run **Refresh JARs** on **Workflows → JAR Deployments**: a first connection often coincides with a JAR that was published but never registered. If the tenant is also bound to Git for Business Config promotion, that is a *different* repository and both can coexist — the IDE keeps the nested clone out of the outer repository's tracking without being asked.
2. **Check the change builds and its tests pass** — If you can run `mvn test`, do it yourself and report only a failure; local Workflow Adapter testing is not part of this path. The PR's pipeline is the gate, so a PR is the next step once the change is written.
3. **Edit the Java in place** — Open the class from **Java Classes** and change it in the editor; it is an ordinary file on disk. Update or add the matching test under **Java Tests** in the same pass, because coverage is gated. Build and run tests in a terminal (`mvn test`) — the IDE does not run Maven for you, so do not claim a gate item passes unless you have output that says so.
4. **Open a pull request** on the provisioned repository — the checkpoint named above. Reltio reviews it, and an automated pipeline runs **Sonar and Snyk** against it (confirmed by name from the official Workflow FAQ — code-quality/style and dependency-vulnerability scanning respectively); unmet checklist items block the merge rather than producing comments to fix later.
5. **Wait for the build** — On approval, a Reltio pipeline compiles the Java into a JAR and publishes it to a dedicated S3 bucket. Nobody does this by hand, and you do not upload to S3 yourself.
6. **Watch for the notification** — Reltio notifies you when the JAR is available to register.
7. **Register the JAR on the tenant** — This is the step that makes it live. Run **Refresh JARs** on **Workflows → JAR Deployments** (`reltio.refreshJarDeployments`): a published-but-unregistered JAR shows up in a nested **Unregistered** subfolder there. Click it, or right-click → **Register JAR...**, to register it directly (`reltio.registerJarDeployment`) — no hand-built API call needed. It asks for a name (pre-filled from the JAR's file name) and an optional description. Registering requires **`ROLE_WORKFLOW_MANAGER`** — confirmed directly from the official doc portal, which names this same role as required "to publish process definitions"; a 403 here means the role, not a bad request. The same official source documents that **one registered JAR can be used across multiple tenants, and its classes incorporated into multiple workflows** — registration is per-tenant, but the JAR itself isn't tied to exactly one tenant or one workflow by anything in the platform. **If you cannot invoke `reltio.registerJarDeployment` yourself, see "When you can't invoke commands yourself" below before reaching for a raw API call.**
   - **If the Unregistered subfolder never appears**: not every tenant supports this discovery — it depends on a `jarsLocation` config that some tenants lack even with JARs already registered and working. That is not an error to chase; ask whoever performs registrations for this tenant (Reltio's workflow team, in that case) to register it instead, quoting the module path Reltio's notification gave you.
8. **Apply** — Point the BPMN's `activiti:class` at the class the JAR provides, then deploy the BPMN. If that BPMN lives in the repository, deploy it straight from its row — there is no copy-into-drafts step. Registered JARs are listed under **Workflows → JAR Deployments**; copy a module path with `reltio.copyJarModulePath`. Same caveat as step 7 if you can't invoke `reltio.deployWorkflow` yourself.
9. **Re-check the badge** — After deploying, `reltio.refreshWorkflowRepoSync` recomputes the sync badges. Editing a repository BPMN clears its badge rather than leaving a stale `synced`, so a blank badge after an edit means "not compared yet", not "not deployed".

**Finding the Java behind an `activiti:class`:** read the fully-qualified name out of the BPMN and match it against the **Java Classes** rows, whose description is the package. The tree does not annotate a class with the BPMN files that reference it, and you should not either — a class can be used by any number of processes, and shared helpers are used from other Java without appearing in any BPMN at all.

### If no repository is connected

The manual route still works and is the fallback when the customer has no remote URL to hand, or declines to clone into the workspace: clone the repository yourself in a terminal, edit, test, and open the pull request. Steps 4 through 8 are identical — only the browsing and the direct BPMN deploy are lost.

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

- A pull request that passes review on the first pass, with each gate item evidenced by command output rather than asserted.
- A statement of what is now live on the tenant: which JAR, which classes, and which BPMN references them.
- **The next step, named.** End by saying what is available now. When the next step is not an IDE action — Reltio's review, the pipeline build, the JAR publication notification — say that explicitly, and say roughly how long it takes, instead of offering a command that cannot advance the work.
