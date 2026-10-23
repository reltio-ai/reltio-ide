# Workflow skills — Tier C demo script

Manual QA after Extension Development Host load (or an installed VSIX) — behavioral acceptance for
the four workflow playbooks, modeled on the LCA assistant's demo script (RP-191824). Not a
substitute for `scripts/test-workflow-skills-library.cjs`, which checks structure, not conversation
quality.

## Setup

1. Open a workspace with a connected tenant that has Workflow enabled.
2. Confirm after activate/resync: `.reltio/reltio-agent/skills/default/workflow-bpmn-authoring/SKILL.md`, its `references/bpmn-rules.md` and `references/reltio-doc-portal-reference.md`, and the other three workflow playbooks.
3. Have at least one existing process definition on the tenant (the OOTB `dataChangeRequestReview` is enough) so "duplicate as draft" has something to copy.

## workflow-bpmn-authoring (primary focus — three prompts)

### Prompt 1 — Narrow

> What happens if I forget one of the two listeners on a review task?

**Expect:** Correct, specific answer (`errorCode 10044`) grounded in `bpmn-rules.md` §3, not a vague "it might not work." The agent should not claim this is documented Reltio platform behavior — if asked where this comes from, it should say it is this team's own observation, not an official doc-portal statement (§12.5).

### Prompt 2 — Real authoring task

> Add a second review step to our DCR approval, with a different reviewer role, after the first approval succeeds.

**Expect:** The agent asks the six required questions in one turn (tenant, new-or-copy, process id, display name, deploy-or-not, and which existing workflow to copy from if any) — not one question per turn. It plans the flow before writing XML, naming both required listeners per task explicitly for the *new* second task, not just the first. It writes the skeleton with all seven namespaces and a DI section. After writing, it reports the diagnostics output rather than asserting the file is clean.

### Prompt 3 — Edge case

> Can you make one of the review steps only happen if the request touches more than 3 attributes?

**Expect:** The agent recognizes this is a clarification/quorum-shaped requirement that a gateway condition alone cannot express reliably (JUEL has no attribute-count function reachable from workflow variables) and either says so plainly and redirects to `workflow-jar-customization`, or clearly flags it as needing custom Java rather than silently approximating it with a gateway condition that will not actually count attributes.

## workflow-jar-customization (one prompt)

> Our beforeApprove logic needs to call an external system — should this be BPMN or Java?

**Expect:** The agent confirms Java is required (external call = not expressible as ordering) before writing anything, per the playbook's step 1, rather than reaching for Java as a default.

## workflow-local-adapter-setup (one prompt)

> Set up a local adapter so I can test my new listener before opening a PR.

**Expect:** The agent walks the five-step order (database → adapter config/start → register tenant → build+place JAR → deploy BPMN locally) rather than skipping straight to "build the JAR." It notes the local adapter starts with zero process definitions, not even OOTB ones.

## workflow-repo-contribution (one prompt)

> My JAR was approved — what do I do now?

**Expect:** The agent describes waiting for Reltio's pipeline/S3 publish notification and the registration step, and does **not** tell the customer to upload to S3 themselves — that instruction is explicitly excluded from the shipped playbook (see `openspec/changes/workflow-skills-library/design.md` D5).

## Cross-cutting check — Known Ambiguities surfaced, not hidden

> Is the second create listener always required on every review task, even a third or fourth one?

**Expect:** The agent still recommends including it (the safe default), but — because `bpmn-rules.md` §12.1 documents a real Reltio-shipped counter-example — does **not** state this as an unconditional platform fact. It should mention the uncertainty if asked directly, rather than asserting confidence the file itself does not have.
