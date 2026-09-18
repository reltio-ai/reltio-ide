# Design — workflow-skills-library

## D1. BPMN authoring: rules in a reference file, not in the playbook

**Decision.** `SKILL.md` stays at house length (~30 lines) and its first Input is
`references/bpmn-rules.md`, marked as required reading before any XML is written.

**Rationale.** Determinism needs the exact namespace block, the full OOTB class allow-list and a
ten-item checklist — several hundred lines. Inlining that would break a house style measured across
five existing skills; dropping it would leave the assistant guessing at precisely the details that
decide whether a deploy succeeds. `copyDirectory` recurses, so a sibling `references/` folder ships
with no mechanism change.

Every rule states the failure it prevents — `errorCode 10044`, `errorCode 13032`, "deploys then
fails at runtime", "hangs forever with no error". A rule with a named consequence is followed; a
rule that reads as style is not.

## D2. JAR customization leads with "is Java actually required?"

**Decision.** Step 1 is confirming the requirement cannot be expressed as ordering.

**Rationale.** BPMN deploy is self-service and immediate; Java costs a pull request, a Reltio review
of roughly a business day, a pipeline build and a registration step. An assistant that reaches for
Java when ordering would do turns a one-API-call change into a multi-day one. The asymmetry is large
enough to be worth a gate.

## D3. The review gate is stated as the gate, not as advice

**Decision.** JDK 17, 80% coverage, `provided` scope, shade plugin, no unused dependencies, no
hardcoded secrets, stateless listeners — listed as the checklist a PR must pass, and the Outputs
section requires reporting each item's actual state rather than a claim of passing.

**Rationale.** These are the conditions Reltio's reviewers enforce. Unmet items block the merge, so
discovering them at review costs a round trip.

## D4. Local adapter setup ships even though the IDE does not run it

**Decision.** Include the playbook; do not orchestrate the setup.

**Rationale.** It is the largest single time sink in custom workflow development and the part with
no existing guided path. Guidance is cheap and useful; orchestrating another service's installation
is neither, and is out of scope for this extension.

## D5. Curation is a review step with a test behind it

**Decision.** Exclude internal-only material — internal skill cross-references, the internal error
catalogue numbering, the config-cache tooling, AWS credential guardrails and direct S3 actions — and
assert their absence in the test script.

**Rationale.** The internal skills are written for people with direct tenant and bucket access.
Customers on the Reltio-managed path never touch S3 and cannot act on those instructions; shipping
them would be confusing at best. A curation rule that is only a review habit decays, so it is a
test.

Descriptive mentions of S3 stay — a customer should understand where their JAR comes from. What is
excluded is instruction to act on it.

## Test plan

**Automated — Tier B (structural)**

| # | Assertion |
|---|---|
| 1 | `skillsBundleVersion` is greater than `"1"`, `velocityPacksBundleVersion` untouched |
| 2 | All four playbooks exist with a non-empty `SKILL.md` |
| 3 | Exactly two frontmatter fields, `name` matching `reltio-<folder>` |
| 4 | Sections `When to use` → `Inputs` → `Procedure` → `Outputs`, in that order |
| 5 | Last Input is the `skills/workspace/<folder>/SKILL.md` override |
| 6 | Every Procedure step opens with a bolded verb |
| 7 | One `.cursor/skills/reltio-<folder>/SKILL.md` pointer per playbook, naming both paths |
| 8 | `bpmn-rules.md` present, and lists every OOTB class the deny-list depends on |
| 9 | Curation guard: no internal-only references anywhere in the shipped skills |
| 10 | `.vscodeignore` still whitelists `skills/**`, so the bundle actually ships |

**Manual QA — Tier C**

- Open a workspace with a previous version's `.sync-state.json`; confirm the four folders appear under `.reltio/reltio-agent/skills/default/` after the bump.
- Ask an assistant in that workspace for a two-step approval BPMN; confirm it reads `bpmn-rules.md`, reports the ten-item checklist item by item, and produces a file that deploys first time.
