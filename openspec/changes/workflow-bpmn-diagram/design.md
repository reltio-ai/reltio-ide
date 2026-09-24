# Design — workflow-bpmn-diagram

Builds on `workflow-authoring` (drafts on disk, the skeleton, `rewriteProcessIdentity`) and reuses the webview and layout patterns established by `ontology-view`.

---

## D1. Bounded regexes, not an XML parser

**Decision.** `bpmnModel.ts` reads BPMN with bounded regular expressions. No XML parser is added.

**Rationale.** The repo has no XML parser anywhere, deliberately: every mainstream Node XML parser resolves external entities by default or has done at some point, and this code path would be handling customer BPMN content. Adding an XXE surface to read four attributes off each element is a bad trade. `BPMNDI_BLOCK` in `src/workspace/workflowBpmnFiles.ts` already set this precedent.

What it costs: this module believes the document is well-formed. That is acceptable because of how every consumer treats the result — a thin or empty model means "nothing to draw", never an error. A malformed file degrades to an empty preview instead of throwing.

What makes it workable rather than merely tolerable: a BPMN produced by any modeller is a flat list of elements inside one `<process>`, with no recursion to speak of. That is the shape bounded regexes read reliably.

**Rejected:** `fast-xml-parser` with entity resolution disabled. Safer than the alternatives, but it is a dependency, a configuration that must stay correct, and a thing to audit — to gain strictness this module does not want.

## D2. Blank ignored regions, preserving offsets

**Decision.** Comments and the existing `<bpmndi:BPMNDiagram>` block are replaced with same-length runs of spaces before scanning, rather than deleted.

**Rationale.** Two problems, one technique.

The diagram block has to go because it carries a `bpmnElement` attribute per node; scanned as content it produces a second, phantom copy of every element in the process. Comments have to go because a commented-out task is not a task.

They are blanked rather than cut so that every offset this module reports still indexes the *original* text. Deleting would shift every subsequent offset by the length of what was removed, and the offsets are the difference between a click landing on the task you clicked and landing several elements away — or, when validation arrives, between a diagnostic on the offending element and one on line 1.

## D3. Pure serializer, two sources of coordinates

**Decision.** `bpmnDiagram.ts` is pure and synchronous and takes positions as an argument. `bpmnLayout.ts` holds the `elkjs` half and is async. The draft skeleton uses `layoutChain` from the pure side; an arbitrary document uses `layoutProcess` from the other.

**Rationale.** The skeleton's topology is fixed and known at author time — start, one task, end, in a line. Running a layout engine on it would buy nothing and would force `buildBpmnSkeleton` to become async, rippling through every caller, so that a function which needs no I/O could await one.

Splitting on that line has two further payoffs. The draft-creation path never loads the layout engine at all. And the serializer's unit tests assert emitted XML byte for byte without one, which is the part with rules that can be wrong.

The skeleton's DI is derived from its own emitted XML (extract → lay out → serialize) rather than written as hard-coded coordinates, so the shapes cannot drift out of step with the elements if the skeleton ever changes.

## D4. Existing DI wins; partial DI does not

**Decision.** The viewer reads coordinates from the file when it has a diagram section covering **every** node, and computes a fresh layout otherwise. `isCompleteFor()` is the gate.

**Rationale.** Preferring the file is what makes the preview trustworthy: a definition fetched from a tenant is shown as its author arranged it. A viewer that quietly re-arranges someone's diagram is reporting something other than what is deployed, and the user has no way to know which they are looking at.

The completeness gate exists because partial DI is worse than none. The shapes that are present look correct, so the ones that are missing do not read as a rendering gap — they read as elements that are not in the workflow. Mixing authored positions with computed ones for the remainder is worse still, since the two coordinate spaces have nothing to do with each other. All-or-nothing is the only honest rule.

## D5. `RIGHT` and `ORTHOGONAL`

**Decision.** ELK runs `layered` with `elk.direction: RIGHT` and `elk.edgeRouting: ORTHOGONAL`.

**Rationale.** Same engine and algorithm as `src/ontology/elkLayout.ts`, with the direction changed. An ontology is a hierarchy and reads downward; a process is a sequence and reads left to right. A BPMN laid out top-to-bottom looks wrong to anyone who works with them, even when every coordinate is valid. `ORTHOGONAL` matches BPMN's right-angled connectors.

Shapes use the BPMN 2.0 default sizes — event 36×36, gateway 50×50, task 100×80 — because matching them is what makes a generated diagram look like a hand-drawn one when it is opened in Camunda Modeler.

## D6. A flow naming a missing node is dropped, not thrown on

**Decision.** `routableFlows()` filters out any sequence flow whose `sourceRef` or `targetRef` does not resolve to a node in the model, before ELK sees it.

**Rationale.** An edge referencing a missing node is a genuine validation finding, and V2 will report it as one. Handing it to ELK instead turns it into a thrown exception that takes the whole diagram down — so the user's reward for having a bug in their BPMN is a blank panel with no indication of why. Dropping the edge degrades to a diagram with one connector missing, which is visible, survivable, and closer to being a useful bug report.

## D7. Read-only, with one interaction

**Decision.** The panel renders and does not edit. The only message it sends to the host is `revealOffset`.

**Rationale.** A drag-and-drop modeller is a second authoring surface, and a weaker one: the Reltio rules in `bpmn-rules.md` — the OOTB class allow-list, the create-listener requirement, the gateway-default constraint — are expressible in XML and not in a canvas, and an agent can write XML. It would also need to write positions back into the file, which means a persistence model, a dirty state, and a conflict with the text editor open on the same document.

Click-to-reveal is the one interaction that makes the diagram useful *for* the XML rather than instead of it: see the wrong thing, land on it.

The offset is clamped host-side. It arrives from the webview, and the document may have been edited between the diagram being posted and the click arriving, so an out-of-range offset is expected rather than exceptional.

## D8. Theme variables in the stylesheet

**Decision.** `bpmnView.css` is built on VS Code theme variables, unlike `ontologyView.css`, which uses a fixed dark palette.

**Rationale.** The ontology view predates the light-theme work and renders dark regardless of the user's theme. A process diagram is the thing most likely to be screenshotted into a change request or a review, so it should follow the editor rather than force a dark rectangle into a light document. The divergence is deliberate and noted in the file, so it does not read as an inconsistency to be "fixed" later.

## D9. Retarget the plane, not the shapes

**Decision.** `rewriteProcessIdentity` rewrites `<bpmndi:BPMNPlane bpmnElement="…">` when — and only when — it currently names the old process id. Shape-level `bpmnElement` references are untouched.

**Rationale.** DI references the process by id at the plane level and the flow nodes by id at the shape level. Duplicating changes the process id and nothing else, so the plane must follow and the shapes must not. A plane left naming an id that is no longer in the document is the worst available failure: the file is valid, deploys, runs, and renders nothing at all, with no error anywhere to explain it.

Conditioning on the old value matters too. A plane pointing somewhere else is either already correct or was written by something this function did not author; overwriting it would be a guess.

## Test plan

**Automated (Tier A — `scripts/test-workflow-bpmn-diagram.cjs`)**

| # | Assertion |
|---|---|
| 1 | Process attributes, flow nodes, sequence flows, `candidateGroups` and `activiti:class` are read |
| 2 | Prefixed and unprefixed forms of the same document read identically |
| 3 | A commented-out element is not read; a DI section does not double the node list |
| 4 | Every reported offset lands on the `<` of its own element in the original text |
| 5 | A conditionless default flow does not inherit the neighbouring flow's condition |
| 6 | Serializer: shapes before edges, integer coordinates, every value escaped, unpositioned elements skipped |
| 7 | `withDiagramSection` inserts inside `</definitions>`, replaces rather than appends, and no-ops without an anchor |
| 8 | A written section reads back to identical coordinates |
| 9 | Partial DI is reported incomplete |
| 10 | The skeleton declares all seven namespaces and carries complete, default-sized, centre-aligned DI |
| 11 | Duplicating re-points the plane and leaves shape references alone |
| 12 | ELK positions every node at its BPMN default size, routes every flow, orders left to right, and overlaps nothing |
| 13 | A flow naming a missing node is dropped, not thrown on |
| 14 | `withGeneratedDiagram` makes a DI-less document complete, and leaves an undrawable one untouched |

**Automated (Tier B)**

| # | Assertion |
|---|---|
| 15 | `reltio.previewWorkflowDiagram` is declared, menu-scoped with a `when`, and registered; `build:bpmnview` exists and `build` invokes it |
| 16 | The webview checks message origin and never assigns `innerHTML`; the panel restricts `localResourceRoots`, denies by default in CSP, and nonce-gates scripts |
| 17 | The script is registered in `scripts/run-unit-tests.cjs` |

**Manual QA (Tier C)**

| # | Step | Expected |
|---|---|---|
| M1 | Create a draft, then open it in Camunda Modeler | The diagram renders — not a blank canvas |
| M2 | Create a draft, deploy it, view it in the Reltio console | The diagram renders there too |
| M3 | Duplicate a deployed definition that has DI, then preview the copy | Shapes appear; the plane names the new id |
| M4 | Preview a deployed definition authored elsewhere | Its own layout is shown, not a recomputed one |
| M5 | Preview a definition with no DI | A computed layout appears, left to right |
| M6 | Click a task in the preview | The editor selects that element |
| M7 | Edit the XML with the preview open | It refreshes within a second; deleting the last flow element shows the empty-state message |
| M8 | Switch between a light and a dark theme | The diagram follows the theme |
| M9 | Preview a deliberately malformed BPMN | The empty-state message appears; no error notification, no crash |

## Open questions

1. **Does the Reltio console render a definition whose DI we generated?** M2 is the only way to know. The coordinates are schema-valid and Camunda-compatible, which is the best evidence available short of the tenant.
2. **Boundary events** are extracted and drawn as ordinary events rather than attached to their host task's border. Correct attachment needs the `attachedToRef` attribute, which `bpmnModel.ts` does not currently read. Deferred until a Reltio workflow that uses one appears; `bpmn-rules.md` §9 lists none.
