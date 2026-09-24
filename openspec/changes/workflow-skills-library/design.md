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

## D6. Confidence-labeled ambiguities, sourced against the public Reltio Workflow repository

**Decision.** Add `bpmn-rules.md` §12 "Known Ambiguities / Needs Verification" and §13 "Official
Reltio documentation — precedence", plus a new `references/reltio-doc-portal-reference.md`. §12
separates rules into three tiers — confirmed against Reltio's own source or the doc portal, this
team's inference from observed deploy behavior, and genuinely unresolved — rather than presenting all
of §§1–11 with uniform confidence.

**Rationale.** A colleague's LCA assistant skill (built independently, merged, then reverted for
being out of that release's scope — not for quality) used exactly this pattern in its knowledge
base's §7, and it is a real content-quality gap here: `bpmn-rules.md` states error codes and failure
modes as flatly as it states namespace requirements, but the two rest on very different evidence.
Checking against the public `github.com/reltio-ai/workflow` repository (the workflow domain's
equivalent of the LCA framework's own interface source) surfaced two genuine, previously-unknown
discrepancies rather than only confirming existing rules: a Reltio-shipped OOTB file
(`dcrTwoApprovals.bpmn20.xml`) that omits the type task listener entirely, contradicting §3's
"every user task" framing; and a validator class package name that differs between what OOTB
form-property values actually reference and what the public repo's own source tree uses for the
same class names. Neither is resolvable by picking a side — both are stated as open, with what to do
in the meantime and what would resolve them.

Official docs.reltio.com pages for Workflow/BPMN customization **do exist** (confirmed by search, not
assumed) — this is not the "no doc-portal presence" case the initial framing allowed for. The pages
found are narrative/customization guides, not a request/response contract, so §12.5 is explicit that
the error-code and mandatory-listener rules are still this team's own inference, not a documented
platform guarantee, even after this pass.

**Not addressed by this decision — flagged as an open risk, not a task item:** `bpmn-rules.md` has
never had review sign-off from a Reltio Workflow-platform SME. The LCA assistant's own knowledge base
required exactly this kind of sign-off (`PROVENANCE.md`, tracked on its Jira) before shipping to
partners; this file has shipped without an equivalent. This decision closes the citation/confidence
gap that content review would need as an input, but it is not a substitute for that review.

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
