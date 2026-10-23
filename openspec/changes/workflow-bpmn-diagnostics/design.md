# Design — workflow-bpmn-diagnostics

Brings the Business Config diagnostics pattern to BPMN. Reuses `bpmnModel.ts`, extended; adds no parser and no network call.

---

## D1. Pure rules, thin adapter

**Decision.** `bpmnDiagnostics.ts` is `vscode`-free and returns `{ offset, length, message, severity, code }`. `bpmnDiagnosticsManager.ts` converts those to `vscode.Diagnostic`s and owns the collection.

**Rationale.** Matches `bpmnModel.ts` and `bpmnDiagram.ts`, and it is what makes the rule set testable: every rule is asserted in a CLI unit test against a string fixture, with no VS Code host and no stub of `TextDocument.positionAt`. The adapter has one behaviour worth testing on its own — the severity setting — and it is tested with a hand-rolled fake document.

Offsets rather than line/character because that is what `bpmnModel.ts` already records and what `document.positionAt` takes. Converting in the rules would mean the rules knowing about line breaks.

## D2. A finding points at the element, not the file

**Decision.** Every rule carries a range covering the **opening tag** of the element at fault. `bpmnModel.ts` gains a `length` on every node and flow to make that possible, and a `processTag` position for the rules that are about the process itself.

**Rationale.** A diagnostic on line 1 of a 90-line file says something is wrong and makes the reader search — barely better than the status quo. The opening tag is the right span because that is where the attributes a finding is about live: `default` on a gateway, `activiti:class` on a service task, `sourceRef` on a flow.

Two rules deliberately point somewhere other than the element that "has" the problem:

- **A default flow carrying a condition** is reported on the *flow*, not the gateway. The gateway is correct; the `<conditionExpression>` is the thing to delete.
- **A duplicate id** is reported on the *second* occurrence and every one after. Flagging the first as well is even-handed and unhelpful — it is usually the one the author meant, and squiggling it sends them to edit the element that is already right.

Each rule's test asserts the covered text, not just the count. A rule that fires on the wrong element passes a count assertion.

## D3. Duplicate ids, which the model could not previously see

**Decision.** `extractFlowNodes` collects candidates per tag, **sorts them into document order**, and only then claims ids — recording every rejected claimant in a new `model.duplicates`.

**Rationale.** `nodes` is keyed by id; a layout and a renderer both need it to be, so a second element claiming the same id cannot live there. It was previously dropped outright, which made the one error that invalidates every other id-based check in the file the one error nothing could observe.

Sorting before claiming matters for a cross-type collision. Deduplicating during the per-tag scan resolves a `userTask`/`endEvent` clash by whichever tag `FLOW_NODE_TAGS` happens to list first — so the survivor is decided by that array's order, not the author's, and the finding lands on the wrong element. The test covers exactly that case.

## D4. Listeners belong to the task that encloses them

**Decision.** `readTaskListeners` scans only between a task's opening tag and its matching close, using a locally constructed global regex seeked with `lastIndex`.

**Rationale.** `bpmn-rules.md` §3 requires the two `create` listeners on **every** user task, not the first. A global search for the class names would report a process whose first task is compliant and whose second is bare as entirely clean — which is the `errorCode 10044` case most worth catching, since the first task is the one anyone checks by hand.

Same reasoning and same shape as `readCondition`, which scopes a `<conditionExpression>` to its own flow so a default flow cannot inherit its neighbour's condition. The `lastIndex` seek is safe because the regex is constructed per call; the hazard the module header warns about is a *shared* global regex.

## D5. Error versus warning, decided per rule

**Decision.** `error` when Activiti or a viewer will definitely reject or mishandle the file. `warning` when the rule holds for every workflow built from Reltio's own parts but a customer JAR can legitimately break it.

Warnings: an `activiti:class` outside §5; a missing diagram section; an element with no `BPMNShape`. Everything else is an error.

**Rationale.** The class allow-list is the clearest case. An invented class name is the most common cause of a workflow that deploys and then fails at runtime, so it has to be visible — but a customer shipping their own JAR supplies classes that are legitimately outside §5, and this check cannot see that JAR. An error would be wrong on every tenant that has one, and those users would learn to ignore the panel, which costs more than the rule earns.

A missing diagram section is a warning because the process deploys and runs correctly; what it breaks is review. That is real — §11 is in the rules because a definition nobody can see is a definition nobody reviews — but it is not a failure.

## D6. The setting moves the advisory rules only

**Decision.** `reltio.bpmnDiagnosticsSeverity` (default `warning`, including `off`) sets the severity of the `warning`-class findings. The `error`-class findings are always reported as errors.

**Rationale.** This is the one place the adapter diverges from `diagnosticsManager.ts`, which has a single kind of finding and so maps its setting straight onto it. Here the rules already distinguish "Activiti will reject this file" from "this is unusual and might be fine", and letting one setting flatten both would offer a way to quietly downgrade a deploy that is going to fail.

`off` still clears everything, because a user who turns the feature off wants it off — and clearing rather than merely not adding is what removes findings already in the panel.

`update()` returns early for a document that is not a local BPMN, so `off` on a JSON file cannot clear a BPMN's findings.

## D7. Which documents are in scope

**Decision.** `bpmnProcessIdForDocument` filters with `processIdFromBpmnFileName`.

**Rationale.** That function already answers both questions this needs. It returns `undefined` for a `.bpmn20.baseline.xml` — a baseline is a record of what the tenant has, so squiggling it would be reporting someone else's file back at the user, on a file they cannot fix — and `undefined` for any stem that is not a valid process id. What it *returns* is the id the file name claims, which is precisely what the id-versus-file-name rule needs, and there is no second parser to disagree with the tree about what counts as a draft.

## D8. Three listeners, because each covers a case the others miss

**Decision.** Debounced on `onDidChangeTextDocument`, immediate on `onDidChangeActiveTextEditor`, `clear` on `onDidCloseTextDocument`.

**Rationale.** Edit is the obvious one. Activation is not: a definition downloaded from a tenant and opened has never fired a change event, and it is exactly the file most likely to violate something — it was authored elsewhere. Close matters because a collection keyed by URI otherwise keeps a stale entry in the Problems panel for a file that is no longer open.

The BPMN branch is a sibling of the JSON branch rather than a widening of it: `isReltioDocument` asks "is this Business Config JSON", which a BPMN is not. The preview panel has a debounce of its own, but it exists only while a diagram is open and these findings must work with no diagram at all.

## D9. The skeleton had to change

**Decision.** `buildBpmnSkeleton` now emits `<extensionElements>` with both `create` listeners.

**Rationale.** The first thing the new rules were pointed at was the document this extension writes itself, and it failed §10.5. Every draft created through **New Workflow…** carried a latent `errorCode 10044`.

Two ways out, and only one is honest. Relaxing the rule would silence the report; fixing the skeleton fixes the drafts. It also protects the feature's credibility — a rule set that squiggles the product's own output is one users switch off within a day — so the test asserting the skeleton is clean is a permanent part of the suite rather than a one-off check.

## D10. §5 lives in one place

**Decision.** The allow-list is exported from `bpmnDiagnostics.ts`, and a test compares it against every `com.reltio.*` class named in `bpmn-rules.md`, in both directions.

**Rationale.** The skill reads the markdown table; the editor checks the array. Drift in either direction is a bad outcome: a class documented but not listed makes the editor warn on something the skill told the agent to use, and a class listed but not documented is a rule nobody can look up. Only a test comparing them keeps them in step, and that is why the constant is exported rather than private.

## Test plan

**Automated (Tier A — `scripts/test-workflow-bpmn-diagnostics.cjs`)**

| # | Rule | Assertion |
|---|---|---|
| 1 | — | A compliant document, and `buildBpmnSkeleton`'s output, produce **zero** findings (D9) |
| 2 | — | Empty text, a bare prolog and an empty `<definitions>` produce zero findings |
| 3 | — | Findings come back in document order |
| 4 | §10.1 | Duplicate ids: same tag, across tags (D3), and a flow taking a node's id; only the later occurrence reported (D2) |
| 5 | §10.2 | Unresolvable `targetRef`, missing `sourceRef`, and a flow with no id |
| 6 | §10.3 | No `default`; a `default` naming no flow; a `default` naming another gateway's flow; a default carrying a condition, reported on the flow (D2) |
| 7 | §10.4 | A gateway with one outgoing flow, with the count in the message; a parallel gateway not asked for a default |
| 8 | §10.5 | Neither listener; one of two, naming only the missing one; both present but on the wrong event; a second non-compliant task while the first is clean (D4); a self-closing task not borrowing its neighbour's listeners |
| 9 | §10.6 | An invented delegate class and an invented listener class, both as **warnings** (D5); every §5 class accepted |
| 10 | §10.9, §8 | `isExecutable` false and absent; process id against the file name; no finding when there is no file name |
| 11 | §10.11 | No diagram section (warning, and no per-element noise); a plane naming another process (error); one element without a shape |
| 12 | D10 | The exported allow-list and `bpmn-rules.md` name the same classes, both directions |

**Automated (Tier B — the adapter and its wiring)**

| # | Assertion |
|---|---|
| 13 | A `.bpmn20.xml` is in scope; a `.bpmn20.baseline.xml`, an `L3.reltio.json` and a plain `.xml` are not (D7) |
| 14 | Ranges become `vscode.Range`s that start on the offending element's own line, and `code` and `source` survive onto the `Diagnostic` |
| 15 | Default severities: advisory as warning, definite as error |
| 16 | Setting to `hint` demotes the advisory finding and leaves the error alone; `error` promotes the advisory one (D6) |
| 17 | `off` sets an empty array, clearing what was already there |
| 18 | A baseline is never set, and passing one through does not throw |
| 19 | `clear` on one document leaves another's findings intact |
| 20 | The setting is declared with `off` in its enum; the manager is constructed, pushed to `subscriptions`, and reached from all three listeners; the script is in the runner's SCRIPTS array |

**Manual QA (Tier C)**

| # | Step | Expected |
|---|---|---|
| M1 | **New Workflow…**, then open the draft | No squiggles at all (D9) |
| M2 | Delete `default="…"` from the gateway | A red squiggle on the gateway within ~300ms, message naming the hang |
| M3 | Delete one `<activiti:taskListener>` | An error on that `userTask` naming only the missing class |
| M4 | Change `activiti:class` to something invented | A yellow squiggle, wording that allows for a customer JAR |
| M5 | Delete the whole `<bpmndi:BPMNDiagram>` block | One warning on `<process>`, not one per element |
| M6 | Rename the process id without renaming the file | An error naming both the id and the file it expected |
| M7 | Set `reltio.bpmnDiagnosticsSeverity` to `off` | The panel empties; JSON diagnostics unaffected |
| M8 | Set it to `hint` | The class warning greys out; the gateway error stays red |
| M9 | Open a `.bpmn20.baseline.xml` | No squiggles |
| M10 | Close the BPMN | Its entries leave the Problems panel |

## Open questions

1. **Quick fixes?** Adding the two listeners, re-pointing a plane and generating a missing diagram section are all mechanical. A `CodeActionProvider` over the same findings is the obvious next change; held back so the rules land and settle first.
2. **Should a deploy be blocked on errors?** `reltio.deployWorkflow` could refuse, or warn, when a file has error-severity findings. Attractive, and a behaviour change to a command users already rely on — deliberately not bundled with introducing the rules.
3. **§10.7 without the tenant.** A form property's `activiti:value` ids are sometimes in the same file, in which case the case-sensitivity rule becomes checkable. Not attempted: partial coverage of a case-sensitivity rule is worse than none, because a clean report would be read as the whole answer.
