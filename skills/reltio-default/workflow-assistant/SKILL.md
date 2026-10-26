---
name: reltio-workflow-assistant
description: Single entry point for any Reltio Workflow request — create or change a BPMN process, a DCR or other approval flow, Java listeners, actions and validators, JAR registration, or a workflow pull request. Read this first. It tells you which workflow playbooks to read before replying, and fixes the shape of the reply.
---

# Workflow assistant

## When to use

The user asks for anything about Reltio Workflow: a new approval flow, a change to a DCR / potential-match / delete review, extra reviewers, a send-back loop, an entity-type-specific flow, custom Java behind a step, registering a JAR, or getting the change merged and live. It is also the file to open when the user says "follow the Reltio workflow assistant".

**Sample prompts**

1. Follow the Reltio workflow assistant. I work with Product entities; their DCRs should go to ROLE_API for approval, with a send-back-for-more-information loop.
2. Add a second approval step to our DCR review.
3. We wrote a listener — how do we get it onto the tenant?

## Inputs

1. The user's request, in their own words.
2. The playbooks beside this one, under `.reltio/reltio-agent/skills/default/` — read the ones the request needs, in full, with the reference files they name:
   - **`workflow-bpmn-authoring/SKILL.md`** and its **`references/bpmn-rules.md`** — always, for any process definition.
   - **`workflow-jar-customization/SKILL.md`** — when the flow needs Java (a send-back loop, an entity-type gate, a custom notification, an external call).
   - **`workflow-repo-contribution/SKILL.md`** — when Java is involved: the pull request, registration and deploy path.
3. Optional **`skills/workspace/workflow-assistant/SKILL.md`** — the workspace's own override, which wins over this file.

## Procedure

1. **Read** the playbooks above before your first reply and before any other tool call. Do not work from memory, generic Activiti knowledge, or sample workflows lying around the workspace; they have been wrong before.
2. **Open** the first reply with exactly one line: `Skills read: <playbook names>` — names only, for example `workflow-bpmn-authoring, workflow-jar-customization`. If you have not read them, read them now.
3. **Follow** each playbook's own Inputs, Procedure and Outputs, including the checks it describes and its rule on what is stated as an FYI instead of asked.
4. **Gate Java on a connected repository** — **Java needs a connected repository.** When the use case needs Java and no Custom Workflow Repository is connected for the tenant (there is no `WorkflowRepo.reltio.json` in the tenant folder), do not write any Java. Tell the user to connect first: right-click **Workflows** → **Connect Custom Workflow Repository** → paste the git URL Reltio gave them. Then stop; continue once they say it is connected. Do not offer to "write it anyway" — never suggest it. Only if the user, unprompted, says to go ahead without a repository, show the Java in chat only and write no file. A BPMN-only draft is always fine, with or without a repository. The BPMN half can still be drafted meanwhile.
5. **Speak** like a product, not a build log. Never mention playbooks, rules, section numbers or conflicts between instructions; never recite checks you ran or what tooling was missing; never suggest local testing as the user's next step. Say what was built, ask the one question the playbook allows, and name the exact next actions. This file owns the reply: the checks, gates and validation walks in the other playbooks are for your own work, and a result reaches the user only when something failed and you could not fix it. This file owns the reply: the checks, gates and validation walks in the other playbooks are for your own work, and a result reaches the user only when something failed and you could not fix it.
6. **Stop** if the playbook files are missing: tell the user to run **Reltio: Resync agent assets (skills, Velocity Packs & LCA knowledge base)** from the Command Palette, and do not improvise deploy or registration steps from memory.

## Outputs

The final reply has this shape, in this order, and nothing else added:

1. `Skills read: <playbook names>`
2. An FYI of one or two sentences — the process id used and its scope (the playbook gives the wording).
3. What was built, in two to four plain bullets: who reviews, what happens on send-back, the BPMN file path, and — when Java is involved — the module and class names.
4. When Java is involved, the single question: "Shall I raise a PR for this?"
5. The next step, named by its tree actions: after the pull request is merged and the JAR is published — **Refresh JARs**, then the JAR under **Unregistered**, **Register JAR...**; then the BPMN, **Deploy to Tenant**. For a BPMN-only change: **Show BPMN Diagram**, then **Deploy to Tenant**. When the next step is genuinely not an IDE action (waiting on Reltio's review), say that plainly.
