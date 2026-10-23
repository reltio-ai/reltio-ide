## Why

`workflow-bpmn-authoring`'s procedure step 7 read: **"Run the checklist — Every item in §10 must pass. Report each one, not a summary."**

That instruction produces the worst available output. The agent reports eleven passes derived from the same reading of the file that introduced the error in the first place, and the user gets a confident, itemised, unfalsifiable list. "Report each one, not a summary" makes it *longer* without making it evidence. When the workflow then fails to deploy, the transcript contains an explicit claim that it would.

The user's read on the agent was "not very good, not very bad". This is a large part of why: the step that was supposed to be the quality gate was the step that produced the least information.

`workflow-bpmn-diagnostics` removes the excuse. Nine of the eleven §10 items are now checked by the extension and reported on the file. The skill can stop asking the agent to grade itself and start asking it to read a tool's output — and, just as importantly, it can name the two items no tool can answer instead of burying them in a list of eleven.

## What Changes

- **`SKILL.md` step 7 becomes "read the diagnostics, do not attest to them"** — save the draft, read the reported findings, quote them, fix them, and treat an empty report as the evidence. The `reltio-bpmn/…` code is named as the way back to the rule.
- **The two manual items are called out by number and by reason**: §10.7 (a condition value against a form property's `activiti:value`, case included) and §10.10 (whether this id is already live on the tenant). Neither is answerable from the file, which is why they are still the agent's.
- **The Outputs section changes from "passes every item in §10, with the checklist reported item by item"** to an empty diagnostics report quoted as such, plus explicit answers to those two.
- **The Inputs entry for `bpmn-rules.md` says what it is now for** — what you write *from*, not what you grade yourself against afterwards.
- **`bpmn-rules.md` §10 marks every item (checked) or (yours)**, notes that the class rule is a warning *because* the editor cannot see a customer JAR, and points at `reltio.bpmnDiagnosticsSeverity` along with the fact that it cannot demote the hard failures.
- **`skillsBundleVersion` goes 3 → 4**, so existing workspaces re-sync the bundle.

## Capabilities

**Code**
- None.

**External API**
- None.

**Tests**
- No new script. `scripts/test-workflow-skills-library.cjs` already enforces the four-section SKILL.md structure and the reference file's presence, and `scripts/test-workflow-bpmn-diagnostics.cjs` pins the §5 tables in `bpmn-rules.md` against the exported allow-list in both directions — so a class added to one and not the other fails the suite.

**Docs**
- `skills/reltio-default/workflow-bpmn-authoring/SKILL.md`, `.../references/bpmn-rules.md`, `resources/reltio-agent-assets.json`

**Not in scope (this change)**
- **Restructuring the skill.** The four H2 sections stay; `test-workflow-skills-library.cjs` enforces them, and the defect was in one step's content, not the shape.
- **The six up-front questions.** Asking all of them in one turn is already right and is not what was weak.
- **Making the agent run a command to fetch diagnostics.** VS Code has no command that returns a document's diagnostics as text. The agent reads the Problems panel or the editor's report for the URI; if a future change adds such a command, the wording can name it.
