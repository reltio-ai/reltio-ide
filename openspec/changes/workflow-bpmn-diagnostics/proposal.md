## Why

Editing `L3.reltio.json` in this extension gets you red squiggles on an unresolved URI. Editing a `.bpmn20.xml` gets you nothing, and BPMN is where the expensive mistakes are.

`bpmn-rules.md` §10 is an eleven-item checklist, and every item on it exists because breaking it produced a real failure. Three of those failures are silent:

- An exclusive gateway with no `default` deploys cleanly. A value matching no condition then **hangs the instance forever**, with no error anywhere.
- A `userTask` missing either OOTB `create` listener deploys cleanly and fails at runtime with `errorCode 10044`.
- A diagram plane whose `bpmnElement` names the wrong id — the normal outcome of copying a definition and changing its id — deploys, runs, and renders **nothing at all** in every viewer.

The rest are deploy rejections that arrive minutes later, after a round trip to a tenant, when the answer was in the file the whole time.

And the checklist's only enforcement was a human or an agent walking it. The `workflow-bpmn-authoring` skill instructed the agent to "report each one, not a summary" — which produces a confident list of eleven passes derived from the same reading of the file that introduced the error.

## What Changes

- **New `src/workflow/bpmnDiagnostics.ts`** — nine of the eleven §10 items as pure functions of the document text, each returning a range on the offending element and a `reltio-bpmn/<rule>` code. §10.7 (condition values against a form property) and §10.10 (is this id already live) need data that is not in the file and stay manual.
- **New `src/workflow/bpmnDiagnosticsManager.ts`** — the `vscode` adapter, modelled on `src/navigation/diagnosticsManager.ts`: its own `reltio-bpmn` collection, `clear` on close, `dispose` on deactivate.
- **`bpmnModel.ts` reads what the rules need**: a gateway's `default`, each task's nested `<activiti:taskListener>` elements scoped to their own task, the `<process>` tag's position, an element **length** so a range covers the opening tag, and — new — the flow nodes it had to **drop** for reusing an id, which is the one error that invalidated every other id-based check while being invisible to the model.
- **Wired into the three document listeners** already in `extension.ts`: debounced on edit, on activation (so a file downloaded and never edited is still reported), cleared on close.
- **`reltio.bpmnDiagnosticsSeverity`**, defaulting to `warning`, with `off`. It moves the advisory findings; the rules Activiti rejects outright stay errors, because a setting that can hide a failing deploy is not a preference.
- **The skeleton now carries both `create` listeners.** `buildBpmnSkeleton` omitted them, so every draft the IDE wrote began with a latent `errorCode 10044` — found by pointing the new rules at it.
- **The skill stops attesting.** `SKILL.md` step 7 becomes "read the diagnostics and quote them"; `bpmn-rules.md` §10 marks each item **(checked)** or **(yours)**.

## Capabilities

**Code**
- **New files**: `src/workflow/bpmnDiagnostics.ts`, `src/workflow/bpmnDiagnosticsManager.ts`
- **Modified files**: `src/workflow/bpmnModel.ts`, `src/workspace/workflowDrafts.ts` (skeleton listeners), `src/extension.ts` (construction, disposal, three listeners), `package.json` (the setting), `scripts/lib/vscode-stub.cjs` (`Diagnostic`, `Range`, `Position`, `DiagnosticSeverity`, `createDiagnosticCollection`, and `getConfiguration` honouring its fallback), `skills/reltio-default/workflow-bpmn-authoring/SKILL.md`, `.../references/bpmn-rules.md`, `resources/reltio-agent-assets.json`

**External API**
- None. Every rule is a function of the file. That is a deliberate boundary: a check needing the tenant would make the squiggle depend on a network call.

**Tests**
- New `scripts/test-workflow-bpmn-diagnostics.cjs`, registered in the runner. One section per rule, each asserting both that the finding is raised **and** that its range lands on the element at fault. Plus: a compliant document and the IDE's own skeleton produce nothing; a half-typed file produces nothing; the §5 allow-list in code and the §5 tables in `bpmn-rules.md` are the same set; and the adapter's ranges, severity floor, `off`, baseline exclusion and per-document `clear`.

**Docs**
- `ARCHITECTURE.md`: both new modules, and a Key Design Pattern note on why the rules are pure and the adapter is thin.

**Not in scope (this change)**
- **§10.7 and §10.10.** One needs the tenant's form properties, the other needs its deployed definitions. Both stay the agent's to answer, and `bpmn-rules.md` now says so per item rather than leaving the reader to work it out.
- **Quick fixes.** Several rules have one obvious repair — adding the two listeners, pointing a plane at the right id. A `CodeActionProvider` is the natural follow-up and is a separate change.
- **Schema validation.** The rules check Reltio's constraints, not BPMN well-formedness. Adding a schema validator means adding an XML parser, which this repo declines for XXE reasons.
