## 1. Playbooks

- [x] 1.1 Add `skills/reltio-default/workflow-bpmn-authoring/SKILL.md` in house style, whose first Input is the rules reference marked as required reading before any XML (D1).
- [x] 1.2 Add `skills/reltio-default/workflow-bpmn-authoring/references/bpmn-rules.md`: namespace block, process-id rules, mandatory `userTask` create listeners, the four gateway rules, OOTB class allow-list, schema ordering, file-name contract, standard topologies, ten-item validation checklist, deny-list — each entry naming the failure it prevents.
- [x] 1.3 Add `workflow-jar-customization/SKILL.md`, leading with "is Java actually required?" (D2) and stating the review gate as a gate (D3).
- [x] 1.4 Add `workflow-repo-contribution/SKILL.md` covering repository access → local proof → PR → Reltio review → pipeline build → notification → registration.
- [x] 1.5 Add `workflow-local-adapter-setup/SKILL.md` (D4).

## 2. Delivery

- [x] 2.1 Add four `.cursor/skills/reltio-<folder>/SKILL.md` pointers, 1:1 with the playbooks.
- [x] 2.2 Bump `skillsBundleVersion` `"1"` → `"2"` in `resources/reltio-agent-assets.json`; leave `velocityPacksBundleVersion` alone.
- [x] 2.3 Confirm no change to `reltioAgentSync.ts` is needed — `copyDirectory` already recurses, so `references/` ships.

## 3. Curation

- [x] 3.1 Exclude internal-only material: internal skill cross-references, internal error-catalogue numbering, config-cache tooling, AWS credential guardrails, direct S3 actions (D5).
- [x] 3.2 Keep descriptive S3 mentions — a customer should understand where their JAR comes from; what is excluded is instruction to act on it.
- [x] 3.3 Do not ship `skill-improver` or any other internal-only skill.

## 4. Tests

- [x] 4.1 Add `scripts/test-workflow-skills-library.cjs` covering the ten Tier B assertions in design.md.
- [x] 4.2 Register it in the hardcoded `SCRIPTS` array in `scripts/run-unit-tests.cjs`.
- [x] 4.3 Mutation-check the curation guard and the bundle-version assertion.

## 5. Docs

- [x] 5.1 Note the workflow playbooks in `ARCHITECTURE.md`'s agent-assets section.
- [x] 5.2 `npm run compile` and `npm test` green apart from the pre-existing velocity-packs failure; `npx openspec validate --changes` clean for this change.

## 6. Blocked on manual QA

- [ ] 6.1 Confirm the four folders materialise into a workspace carrying an older `.sync-state.json`.
- [ ] 6.2 Ask an assistant for a two-step approval BPMN in that workspace and confirm it reads the rules file, reports the checklist item by item, and produces a BPMN that deploys first time.

## 7. Content quality pass (D6) — sourced against the public Reltio Workflow repository

- [x] 7.1 Add `bpmn-rules.md` §12 "Known Ambiguities / Needs Verification", modeled on the (reverted) LCA assistant's KB-01 §7: separate confirmed-against-source, inferred-from-observed-behavior, and genuinely-unresolved tiers. Found and documented two real discrepancies against `github.com/reltio-ai/workflow`'s own OOTB files: `dcrTwoApprovals.bpmn20.xml` omits the type task listener entirely (contradicts treating it as unconditionally mandatory), and the OOTB form-property validator package (`core.task.validator`) differs from the public repo's source-tree package (`activiti.service.validators`) for the same class names.
- [x] 7.2 Add `bpmn-rules.md` §13 and `references/reltio-doc-portal-reference.md`: official docs.reltio.com pages **do** exist for this domain (unlike an initial assumption going in) plus the public `github.com/reltio-ai/workflow` source repository, both indexed with a precedence rule — official source wins, conflicts get flagged in §12, not silently resolved.
- [x] 7.3 **Revised scope, see below:** document `RelationTypeTaskListener` and `SingleEntityTaskValidator` — confirmed to exist in the public source but previously undocumented here. Not added to §5's class tables: they are not in this extension's editor-enforced allow-list (`RELTIO_OOTB_CLASSES` in `src/workflow/bpmnDiagnostics.ts`), and §5 and that allow-list are kept in lockstep by a test, so adding one without the other would make the doc and the enforced list disagree. Documented instead in §12.5 as known-but-not-yet-wired-in, with an explicit "do not put either name in generated BPMN" until a maintainer adds both together.
- [x] 7.4 Add a "Sample prompts" section (2–3 prompts) to all four `SKILL.md` files, modeled on the LCA assistant's `SKILL.md`.
- [x] 7.5 Add `openspec/changes/workflow-skills-library/demo-script.md`: a Tier C behavioral script, modeled on the LCA assistant's `demo-script.md`, weighted toward `workflow-bpmn-authoring` (three prompts) with one prompt per remaining playbook plus a cross-cutting check that the agent surfaces §12's ambiguity rather than asserting false confidence.
- [x] 7.6 Bump `skillsBundleVersion` `"5"` → `"6"` (content-only change to shipped `SKILL.md`/`references/` files).
- [ ] 7.7 **Not done, cannot be done by this pass:** `bpmn-rules.md` has never had sign-off from a Reltio Workflow-platform SME — it was authored and validated against observed tenant behavior by this IDE team, the same gap the LCA assistant's `PROVENANCE.md` required LCA-team sign-off to close. Flagged as an open risk for a human to act on.

## 8. Content accuracy pass — sourced against the real customer-repo provisioning template and the official doc portal's Java-customization pages

- [x] 8.1 Add `workflow-jar-customization/references/java-patterns.md`: this skill previously had zero code — no interface names, no skeleton, didn't even cover its own sample prompt (a fresh `TaskListener` for region-restricted assignment). Now documents, with a confidence tier per fact: the confirmed interfaces (`WorkflowTaskListener`, `WorkflowExecutionListener`, a validator's `doValidate(TaskValidationInfo): boolean throws InvalidTaskException`), code skeletons for extending an OOTB service task and writing a fresh task listener, the statelessness and `ExecutionService.setVariable` rules, and a `pom.xml` transcribed directly from the real `com.reltio.workflow:reltio-custom-workflows-archetype` template (not a guess) — confirmed dependency versions, shade-plugin config, and the JaCoCo coverage gate.
- [x] 8.2 Discovered and documented a real discrepancy the archetype pom.xml exposes: the official doc portal states a 70% test-coverage minimum; the actual provisioning template's `jacoco-check` rule enforces 80%. Documented in `java-patterns.md`'s own Known Ambiguities section, defaulting to 80% as the number that's mechanically enforced.
- [x] 8.3 Discovered a second discrepancy: the doc portal's validator signature (`doValidate(TaskValidationInfo taskInfo): boolean throws InvalidTaskException`, fetched directly) differs from a differently-shaped signature seen in an earlier, non-this-repo internal reference (`doValidate(Task task): void throws Exception`). Documented as unresolved; told the reader to confirm against their own tenant's provisioned repo before committing to either.
- [x] 8.4 Corrected a factual error already shipped in `workflow-jar-customization/SKILL.md`: it named GSON as a `provided`-scope dependency. The real archetype's `pom.xml` uses `jackson-databind`, not GSON. Fixed.
- [x] 8.5 Corrected a factual error already shipped in `workflow-repo-contribution/SKILL.md`: it stated the provisioned repository always has "four Maven modules." The real archetype generates exactly **one** initial module (`custom-workflow`). Replaced with the actual, confirmed fact (one module, zero BPMN, on every fresh connection) plus the real growth path: the archetype's own `README.md` instructs customers to add one sub-module per additional custom workflow, independently corroborated by the official Workflow FAQ's documented "Multi-Module Builds" pattern.
- [x] 8.6 Added citations that were previously missing for two specific, already-shipped claims: `ROLE_WORKFLOW_MANAGER` required for JAR registration (confirmed by the doc portal, which names the same role for "publish process definitions"), and "automated security scans" on a PR (confirmed by name: Sonar + Snyk, from the official Workflow FAQ). Hedged a third, previously-unsourced claim ("roughly a business day" for PR review) since no official SLA was found.
- [x] 8.7 Added a cross-reference reconciling an apparent (not actual) contradiction between `bpmn-rules.md` §8 (a Drafts-folder BPMN's filename is trusted) and `workflow-repo-contribution/SKILL.md` (a connected repository's BPMN is discovered by content, never filename) — different trees, different authorities, now stated explicitly in both places.
- [x] 8.8 Added `bpmn-rules.md` §15 with real skeletons for two BPMN-only patterns previously named as "needs Java" with no further detail: multi-instance parallel quorum review, and boundary-timer time-based escalation — each skeleton states precisely where it stops being BPMN-only (vote-tallying beyond presence/absence; an escalation action beyond an OOTB service task). Also added the reasoning (not just the assertion) for why a clarification loop back to the original requester needs Java: `${reltioUser}`/`${initiator}` can't reliably address the original requester later, so capturing their identity needs a listener.
- [x] 8.9 Added a one-line footnote in `bpmn-rules.md` §1 on the `expressionLanguage="XPath"` + JUEL `${...}` condition syntax mismatch in the skeleton, so a literal reader doesn't mistake inherited Activiti boilerplate for an error in this file.
- [x] 8.10 Fixed a real inconsistency in `workflow-local-adapter-setup/references/start-adapter.bat`: its own comment block listed a JDK 25 example path immediately next to a JDK 17 one, while JDK 17 is the stated requirement everywhere else (including the now-confirmed archetype `pom.xml`). Removed the JDK 25 example.
- [x] 8.11 Answered `workflow-local-adapter-setup`'s own previously-unanswered sample prompt ("BPMN deploys but doesn't show up as a process definition") with a concrete, ordered checklist of what to rule out first. Added IntelliJ/VS Code remote-debug attach steps (the scripts promised port 5005 but neither `SKILL.md` nor the scripts said how to attach). Added a named-but-unconfirmed SSL/truststore failure mode for reaching a tenant's environment URL from a local adapter.
- [x] 8.12 Re-crawled the doc portal (2026-09-22's pass had only indexed URLs for this skill's pages, not fetched their content) and fetched directly: "Overview of Workflow Customizations" (the `/en/engage/...` path — the content-bearing one; a second, differently-pathed `/en/objectives/...` page with a similar title was previously indexed and is flagged as possibly-the-same-content-two-ways, not reconciled), the "Workflow FAQ" page, and the "Setting Up the Reltio Workflow Adapter" page (confirmed to be an index page; its real child-page URLs were not guessed at or fetched). All three added to `reltio-doc-portal-reference.md` with what each actually confirms.
- [x] 8.13 Read `com.reltio.workflow:reltio-custom-workflows-archetype` directly (the actual Maven archetype that generates every customer's provisioned repository) and added it to `reltio-doc-portal-reference.md` as an authoritative, non-doc-portal source — it is what grounded 8.1, 8.2, 8.4, and 8.5 above in a real file rather than an inference.
- [x] 8.14 Bump `skillsBundleVersion` `"8"` → `"9"` (content-only change to shipped `SKILL.md`/`references/` files).
- [ ] 8.15 **Not done, same open risk as 7.7:** none of the corrections above have SME sign-off either. The archetype and doc-portal fetches are stronger evidence than this team's own prior notes, but still not a substitute for a Reltio Workflow Platform Engineering review.

## 9. Confirmation discipline — collapse serial check-ins into one upfront batch plus one named checkpoint

Prompted by reviewing an unrelated, much simpler LCA-authoring chat transcript as a negative example:
that session asked the user to say "yes" seven separate times for one hook — three of those because
the agent discovered a gap (no tenant connected, no matching entity type, the chosen type missing a
field) and bounced back to ask instead of resolving what it could and presenting the rest as one
proposal. `workflow-bpmn-authoring` already modeled the batching half of this correctly (Input 4's
six questions asked together); this pass extends that discipline to the question of *when to stop
again after that*, across all four playbooks.

- [x] 9.1 `workflow-bpmn-authoring/SKILL.md` Procedure: added an explicit framing statement that steps
  1–5 (plan and draft, both local and reversible) run without checking back in, and step 6's deploy —
  which the IDE already gates with an unsuppressible modal — is the only remaining checkpoint. Fixed
  step 3 to say "check the id yourself" against the tenant's already-available deployed-definitions
  list instead of "ask whether it exists" — a checkable fact, not something only the user knows.
  Fixed step 4 ("Plan before XML ... Get agreement, then write") to state the plan and proceed
  straight into writing — the plan is there to let the user catch a mistake early, not a permission
  gate on a file nobody has to accept yet. Added one line to step 7 saying diagnostic fixes apply and
  re-save without asking first, since a diagnostic has one correct fix, not a judgment call.
- [x] 9.2 `workflow-repo-contribution/SKILL.md`: added an explicit statement that steps 1–3
  (connecting an already-requested repository, local proof, local edit+test) are autonomous, and step
  4 — opening the pull request, the first point anything leaves the user's machine and becomes
  visible to Reltio — is named as the one deliberate checkpoint in the playbook.
- [x] 9.3 `workflow-jar-customization/SKILL.md`: added a framing line that writing the class, its
  test, and checking the gate are all local work with no checkpoint of their own — the checkpoint is
  `workflow-repo-contribution`'s PR step, not this skill's.
- [x] 9.4 `workflow-local-adapter-setup/SKILL.md`: added a framing line that nothing in this playbook
  touches a live tenant or a shared system, so all seven steps run through to a result with nothing to
  check in about along the way.
- [x] 9.5 Did not add a new shared "confirmation discipline" reference file — scoped to editing the
  four existing playbooks directly, not introducing a fifth document for an agent to also have to
  read. If a fifth workflow skill is added later, carry this same distinction (batch the unavoidable
  questions once; name exactly one consequential checkpoint; treat local/reversible work as yours to
  just do) into it directly rather than retrofitting a shared doc at that point either.
- [x] 9.6 Bump `skillsBundleVersion` `"9"` → `"10"` (content-only change to shipped `SKILL.md` files).

## 10. Don't ask for a Bearer token — point back to the tree instead

Prompted by a real transcript (a different tool, operating on a connected repository's cloned
folder, no bridge to the running IDE extension) that got stuck exactly where `workflow-repo-contribution`
gives no guidance: needing to register a jar and deploy a BPMN, unable to invoke `reltio.*`
commands itself, and defaulting to asking the human to paste a Bearer access token or hand over
credentials to derive one.

- [x] 10.1 Confirmed the actual mechanism before writing any guidance, rather than assuming: read
  `src/api/tokenStore.ts` directly. The token is an in-memory `Map` only, explicitly "never
  persisted" — not written to a file, not in VS Code's secret storage, not anywhere a second
  process could read it. This is a deliberate security boundary, not a gap to close by exposing it
  — the fix is in what the agent does next, not in making the token reachable.
- [x] 10.2 `workflow-repo-contribution/SKILL.md`: added a new "When you can't invoke commands
  yourself" subsection, distinct from the existing "If no repository is connected" one — the real
  case is a *connected* repository (sidecar files present) with an agent that simply has no command
  bridge. States plainly: tell the user to run steps 7/8 themselves from the tree by name, don't
  fall back to raw API calls, don't ask for a token or credentials to derive one. Cross-referenced
  from steps 7 and 8 directly.
- [x] 10.3 `workflow-bpmn-authoring/SKILL.md` step 6: extended the existing "if you cannot invoke
  commands at all" clause (previously only covered *writing* the draft) to also say the deploy
  itself is the user's job from the tree in that case — not a raw `POST .../deployments` call, and
  not something to ask a Bearer token for.
- [x] 10.4 Bump `skillsBundleVersion` `"10"` → `"11"` (content-only change to shipped `SKILL.md` files).

## 11. Closing the exact gaps a real deployed workflow exposed

Prompted by reviewing real code an agent (a different tool, no connection to this skill set's live
diagnostics) wrote for a customer's actual two-step Location DCR approval workflow: it compiled,
its unit tests passed, and the BPMN was well-formed XML — and it still shipped with no diagram
section, a task listener missing on two secondary tasks, and zero `accessTypes`/`validator` form
properties anywhere. Traced each to a root cause rather than patching symptoms.

- [x] 11.1 **Root cause, Part A — the one canonical `userTask` example in `bpmn-rules.md` §3 never
  showed a complete task.** It illustrated the two-listener rule in isolation, with no form
  properties at all, not even `decision`. An agent copying "the skeleton" literally would reproduce
  exactly the missing-`accessTypes`/`validator` bug. Rewrote §3 to lead with one complete, compliant
  skeleton (all five form properties + both listeners) and a table naming the consequence of
  omitting each one, explicitly citing the real bug this was found from.
- [x] 11.2 Added §10 item 12 (`accessTypes`/`validator` present on review tasks) — marked "(yours)"
  honestly, not "(checked)", since the editor's diagnostics do not enforce this yet; added here so
  the checklist doesn't silently omit a known real failure mode just because no code checks it.
- [x] 11.3 **Root cause, Part B — the bigger one.** §10's "(checked)" items, and `SKILL.md` procedure
  step 7's instruction to "read the diagnostics," both implicitly assume the BPMN is being authored
  *inside* Reltio IDE, where the diagnostics engine runs continuously. An agent authoring BPMN any
  other way (a different tool, a cloned repo folder, no running IDE window) gets no such check for
  any item — and nothing previously told it so. Added `bpmn-rules.md` §10's "When you have no live
  diagnostics to read" and a matching branch in `SKILL.md` step 7: in that situation, every item,
  including the ones marked "(checked)", becomes the agent's own job, walked explicitly, one at a
  time, not skimmed. This is the structural fix — it would have caught all three findings in the
  real bug at once, not just the one Part A also addresses directly.
- [x] 11.4 **`java-patterns.md` correction, not just an addition.** The same real code
  (`CaptureRequestor.java`, a real service task that compiled and passed 3/3 tests in a live GitHub
  Actions run) proved a prior reasoned guess in this file wrong: the service task interface is
  `com.reltio.workflow.api.actions.WorkflowAction`/`Execution`, not raw Activiti's
  `JavaDelegate`/`DelegateExecution`. Corrected every code sample in the file, resolved two Known
  Ambiguities entries with real evidence instead of reasoning, and confirmed `ExecutionService`,
  `ReltioApi`, `Utility`, and `@WorkflowService` field injection from the same source.
- [x] 11.5 Added a new pattern, "surfacing a mandatory rejection comment to whoever gets the next
  task" — the real workflow's fourth finding (not a bug, a judgment call: `commentRequired="true"`
  guarantees a comment is collected and recorded in process history, but nothing makes it visible
  inside a *later* task without capturing it as its own variable). Flagged more speculative than
  this file's other patterns, since it is not itself confirmed against real code.
- [x] 11.6 Bump `skillsBundleVersion` `"11"` → `"12"` (content-only change to shipped
  `SKILL.md`/`references/` files).

## 12. Ground-truthed against `github.com/reltio-ai/samples-custom-workflow` — the real thing, not reasoning

Prompted directly: "I am 100% sure all workflow things can be done using BPMN and JAR — go look at
this repo." Cloned it (14 complete, working sample modules: real BPMN, real Java, real tests, each
with its own `Readme.md`) and used it to settle, with real evidence, several things this skill set
had previously only reasoned about or sourced from a documentation page's prose.

- [x] 12.1 **Corrected a wrong answer given earlier in the same conversation.** Told the user
  `objectTypes`/`manualStart` were "Workflow Modeler-only settings, not expressible in raw BPMN" —
  wrong for `manualStart` (and `deleted`): confirmed as `<dataObject>` elements inside `<process>`,
  identically shaped, across 12 independent real sample files. Added this to `bpmn-rules.md` §2 with
  the full skeleton. `objectTypes` specifically was *not* found in any of the 12 — flagged as
  genuinely unconfirmed rather than assumed either way, correcting an official doc-portal page's
  claim that grouped it with the other two.
- [x] 12.2 **Resolved `java-patterns.md`'s two remaining Known Ambiguities with real evidence,
  reversing a previous recommendation.** The validator signature: real, compiled, duplicated-across-
  two-samples code confirms `TaskValidator`/`doValidate(Task task): void throws Exception`/
  `ValidationError` — the doc-portal's `TaskValidationInfo`/`boolean`/`InvalidTaskException` shape,
  previously treated as the current one, is now the one to doubt. `WorkflowTaskListener`/
  `WorkflowExecutionListener` exact packages and `notify()` signatures: both fully confirmed from
  multiple independent real files.
- [x] 12.3 Documented `TaskService` for the first time (`setVariable`/`getVariable`/
  `getVariableLocal`/`getVariables`/`setDueDate`/`setOwner`/`assignTask`/`getAllPossibleAssignees`) —
  a task-scoped sibling of `ExecutionService` used throughout the real samples (especially the
  parallel-quorum pattern) that this file previously didn't mention at all. Also documented the real
  `activiti:field` injection type (`com.reltio.workflow.api.expressions.Field`) and `Task.getReltioUser()`.
- [x] 12.4 Fixed every code sample in `java-patterns.md` to use the now-confirmed real interfaces
  throughout, not just the one the prior pass happened to correct.
- [x] 12.5 Independently re-confirmed `bpmn-rules.md` §12.1's `dcrTwoApprovals.bpmn20.xml` finding
  (zero `DCRTypeTaskListener` occurrences) and §15.2's boundary-timer shape, directly from this
  clone — both matched exactly, no changes needed there.
- [x] 12.6 Added `github.com/reltio-ai/samples-custom-workflow` to `reltio-doc-portal-reference.md`
  and `bpmn-rules.md`'s authoritative-sources callout as a primary source, alongside (not replacing)
  `github.com/reltio-ai/workflow` and the doc portal.
- [x] 12.7 Bump `skillsBundleVersion` `"12"` → `"13"` (content-only change to shipped `SKILL.md`/
  `references/` files).

## 13. Comprehensive pass across all 14 sample modules — "do it like an expert skill writer"

Explicit ask: mine the full sample repo, not just the handful of modules the previous pass happened
to touch. Read every module's `Readme.md` and every remaining Java file not yet read
(`aws-access`, `change-due-date`, `change-priority`, `custom-notifications`, `default-assignee`,
`two-approval-default-flows`, `workflow-external-dcr`, `update-task-timer`'s utils/service classes).

- [x] 13.1 `bpmn-rules.md` §16 (new): three more confirmed, real, zero-or-minimal-Java patterns —
  default assignee at startup, the two-approval switcher at startup, and (replacing a
  reasoning-only paragraph in §9) the **complete** clarification-loop skeleton: the `${dcrReviewer}`
  assignee expression, the `complete`-event listener that captures it, and the `BackToCreator`/
  `Suggest` decision pair, from `dcr-review-loop/dcrWithClarification.bpmn20.xml` verbatim.
- [x] 13.2 Strengthened §12.5: `SingleEntityTaskValidator` is now confirmed a second, independent
  way — the sample repo's own `delete-review-with-validation/Readme.md` names it directly as the
  OOTB Recommend-for-Delete default validator, not just a class found in source.
- [x] 13.3 `java-patterns.md`: four new patterns, each from real, compiled, official code —
  `TaskService.setPriority` (with the four confirmed numeric priority values), a full
  `NotificationSenderService` email pattern (subject/body/recipients/inline-image attachment,
  resolving a task's assignee email address), the `AwsService.getTemporaryCredentials` assumed-role
  pattern (with its real operational prerequisite — contacting Reltio Support first), and calling
  the Workflow Adapter's own API with separately-held `client_credentials`, not the acting user's
  token.
- [x] 13.4 **Flagged a genuine security gotcha found while documenting the last pattern above,
  not glossed over**: the sample's own AES encrypt/decrypt utility derives its key from a hardcoded
  string literal in the public source file — so copying that literal key into a real deployment
  protects nothing, since the "secret" key is exactly as public as the sample itself. Said so
  explicitly rather than presenting the encrypted-dataObject pattern as safe by default.
- [x] 13.5 Documented `ExecutionService`'s typed `getVariable(id, name, Class<T>)` overload and
  `Task.getExecutionId()`, both newly observed in this pass.
- [x] 13.6 Caught and fixed two new instances of the backtick-quoted-FQCN pitfall from task 7's own
  prior fix (a custom, non-allow-listed class name written in backticks outside a code fence trips
  the bpmn-rules.md↔`RELTIO_OOTB_CLASSES` sync test) — `test-workflow-bpmn-diagnostics.cjs` caught
  both immediately; fixed by de-backticking the class name in prose, consistent with how every
  other custom (non-OOTB) class name in this file is already written.
- [x] 13.7 Bump `skillsBundleVersion` `"13"` → `"14"` (content-only change to shipped `SKILL.md`/
  `references/` files).

## 14. Default the process id for OOTB-flow customizations — don't ask, FYI instead — and eliminate the "is DCR routing configured" gap it created

Direct instruction, after two real Cursor transcripts both ended with vague "import in Workflow
Modeler, set objectTypes, confirm DCR routing is configured" guidance instead of either a real
default or the actual tree-action sequence: for the 4 fixed OOTB flows, default the process `id` to
that flow's own id instead of treating it as a sixth thing to ask about, state the choice and its
real consequence as an FYI (not a question), and inline the concrete PR→tree-action sequence instead
of pointing at other skills by name only.

- [x] 14.1 `workflow-bpmn-authoring/SKILL.md` Input 4: removed process `id` from the five questions
  asked together — it's no longer asked about by default at all.
- [x] 14.2 `workflow-bpmn-authoring/SKILL.md` Procedure step 3, and `bpmn-rules.md` §2: rewrote to
  default the id to the relevant OOTB flow's own id (`dataChangeRequestReview` for a DCR
  customization — the common case — `potentialMatchReview`, or `deleteReview`/`recommendForDelete`
  for Delete) unless the user already named a different one, state it as one line of FYI, and
  **not** ask permission for it. Kept, deliberately, as part of the same FYI rather than hidden: this
  replaces the tenant's current flow for **every** entity type of that kind, not just the one
  being discussed, since `objectTypes`-based scoping to a single entity type is not confirmed to work
  from raw BPMN. The point was to stop asking a question, not to stop disclosing a real consequence.
- [x] 14.3 This directly removes the need for the vague "confirm DCR routing is configured" step
  that both transcripts ended on: defaulting to the OOTB id *is* what makes the Hub UI auto-trigger
  it, with no separate Business Config wiring required — that's the whole reason the default exists.
- [x] 14.4 `workflow-bpmn-authoring/SKILL.md` Outputs: stopped letting the Java handoff collapse into
  a bare pointer ("move to `workflow-jar-customization`/`workflow-repo-contribution`"). Both real
  transcripts folded all three skills into one answer and, in doing so, both dropped the "shall I
  raise a PR" checkpoint and the tree-action instructions entirely, substituting vaguer phrasing
  ("import in Workflow Modeler," "build/publish via your pipeline," "register it with the tenant").
  Inlined the actual sequence instead: implement BPMN + Java together, ask the one checkpoint
  question explicitly, then name the tree actions (Refresh JARs → Unregistered → Register JAR...;
  open the BPMN → Deploy) by name — not a reference to go read it elsewhere.
- [x] 14.5 Bump `skillsBundleVersion` `"14"` → `"15"` (content-only change to shipped `SKILL.md`/
  `references/` files).
- [x] 14.6 Bump the extension's own `package.json` version `1.0.22` → `1.0.23` to ship this alongside
  the `onStartupFinished` activation fix from the previous pass.

## 15. Entity-type gate + delivery without `.cursor/` (1.0.25, bundle 17)

- [x] 15.1 `bpmn-rules.md` §17 (entity-type gate: resolver service task → exclusive gateway, default
  branch = unchanged standard review) + §2/Step 3 rule: a named entity type means keep the OOTB id and
  gate inside it — never offer a new-id-vs-override choice, never `objectTypes` after import.
- [x] 15.2 `java-patterns.md`: "resolve the entity type for a gateway" (`ResolveEntityType`), built from
  confirmed pieces; flagged verify-on-test-tenant. Deny-list rows added.
- [x] 15.3 Sync no longer writes `.cursor/`: managed marker block in `AGENTS.md` + `CLAUDE.md` requiring
  the agent to read the playbooks first and open with a `Skills read:` proof line; legacy 1.0.24
  `.cursor/` pointers removed on sync. Pure `mergeManagedBlock` tested (preserves user content, idempotent).
- [x] 15.4 `skillsBundleVersion` `"16"` → `"17"`; extension `1.0.24` → `1.0.25`.

## 16. Nothing outside `.reltio/` — discovery through a core skill (1.0.27, bundle 19)

- [x] 16.1 Removed the AGENTS.md / CLAUDE.md instruction block (and the earlier `.cursor/` pointers) from the
  sync. Customer workspaces get files only under `.reltio/reltio-agent/`.
- [x] 16.2 New core skill `workflow-assistant` (`reltio-workflow-assistant`): entry point that names the three
  playbooks to read, the `Skills read:` line, the reply shape and voice rules. Invoked by the user
  ("follow the Reltio workflow assistant"), the same convention as the LCA assistant (RP-191824, PR #13).
- [x] 16.3 Sync removes what 1.0.24–1.0.26 left behind: the managed block in AGENTS.md / CLAUDE.md (file deleted
  if it held nothing else) and `.cursor/` pointers prefixed `reltio-`.
- [x] 16.4 Playbooks use the real menu label **Deploy to Tenant**.
- [ ] 16.5 Coordinate with PR #13 (RP-191824): both change `reltioAgentSync.ts`, `reltio-agent-assets.json`,
  `package.json` and `ARCHITECTURE.md` — expect conflicts; keep both the KB sync and the legacy cleanup.
