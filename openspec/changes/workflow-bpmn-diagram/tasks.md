## 1. Structural read

- [x] 1.1 Add `src/workflow/bpmnModel.ts` with `extractProcessModel(xml)` → process attributes, flow nodes and sequence flows. Bounded regexes, no XML parser (D1).
- [x] 1.2 Match namespace prefixes optionally everywhere — the same document deploys as `<userTask>` or `<bpmn:userTask>`.
- [x] 1.3 Blank comments and the existing `<bpmndi:BPMNDiagram>` block with same-length space runs before scanning, so reported offsets still index the original text (D2).
- [x] 1.4 Record a character offset on every node and flow. Nothing consumes them yet — validation is V2 — but they cannot be recovered later without re-scanning.
- [x] 1.5 Read `activiti:candidateGroups` and `activiti:class` with the prefix optional, and unescape attribute values (`&amp;` last, so `&amp;lt;` does not double-unescape).
- [x] 1.6 Scope `<conditionExpression>` to its own flow's body. A global search hands a default flow its neighbour's condition — the exact pair Activiti rejects.
- [x] 1.7 Build every `g`-flagged pattern per call, never as a module constant: a shared global regex carries `lastIndex` between uses and silently starts mid-document.
- [x] 1.8 Export `hasDiagramSection(xml)`.

## 2. Diagram serialization (pure)

- [x] 2.1 Add `src/workflow/bpmnDiagram.ts`: `SHAPE_SIZES` at the BPMN 2.0 defaults (event 36×36, gateway 50×50, task 100×80), `Bounds`, `Point`, `DiagramLayout` (D5).
- [x] 2.2 Add `renderDiagramSection(processId, model, layout)` — shapes before edges, integer coordinates, every interpolated value XML-escaped, elements without positions skipped rather than emitted at the origin.
- [x] 2.3 Add `withDiagramSection(xml, section)` inserting before `</definitions>`, replacing any section already present, and returning the document unchanged when there is no anchor.
- [x] 2.4 Add `readDiagramLayout(xml)` and `isCompleteFor(layout, model)` (D4). Tolerant: a shape without bounds is skipped, not defaulted to the origin.
- [x] 2.5 Add `layoutChain(nodes, flows)` for a fixed straight run, aligning vertical centres so connectors come out horizontal.

## 3. Layout engine

- [x] 3.1 Add `src/workflow/bpmnLayout.ts` holding the `elkjs` import, so the draft path never loads it (D3).
- [x] 3.2 Add `layoutProcess(model)`: `layered`, `elk.direction: RIGHT`, `elk.edgeRouting: ORTHOGONAL` (D5). Declare the read subset of ELK's result locally rather than importing its typings.
- [x] 3.3 Drop flows whose endpoints do not resolve before ELK sees them (D6).
- [x] 3.4 Fall back to a straight box-edge-to-box-edge line for any flow ELK placed but did not route.
- [x] 3.5 Add `generateDiagramSection(xml)` returning `undefined` when there is nothing to draw, and `withGeneratedDiagram(xml)`.

## 4. Drafts carry DI

- [x] 4.1 Add the three diagram namespaces plus `xsd`, `typeLanguage` and `expressionLanguage` to `buildBpmnSkeleton`, bringing it in line with `bpmn-rules.md` §1 — it declared four of seven.
- [x] 4.2 Emit the skeleton's DI by extracting its own XML, running `layoutChain`, and serializing (D3). Keep the function pure and synchronous.
- [x] 4.3 Fix `rewriteProcessIdentity` to retarget `<bpmndi:BPMNPlane bpmnElement>` when it names the old process id, leaving shape references alone (D9).
- [x] 4.4 In `reltio.duplicateWorkflowDraft`, generate a diagram when the source has none — the copy is new authored content, unlike the fetched original.

## 5. The viewer

- [x] 5.1 Add `src/workflow/bpmnPanel.ts`: one panel per document URI, CSP nonce, `localResourceRoots` restricted to `dist/`, debounced refresh on document change, panel reuse — following `ontologyPanel.ts`.
- [x] 5.2 Flatten the layout `Map`s into arrays before posting: `postMessage` serialises structurally and a `Map` arrives as `{}`.
- [x] 5.3 Prefer the document's own DI when complete, compute otherwise (D4).
- [x] 5.4 Handle `revealOffset` and nothing else; clamp the offset against the current document length (D7).
- [x] 5.5 Add `src/webview/bpmnView.ts`: circle for events (heavy border for an end event), diamond for gateways, rounded rect for tasks, polyline with an arrowhead for flows. Check message origin via `isTrustedMessageOrigin`; `textContent` only.
- [x] 5.6 Draw the role or delegate under a task name — the Reltio-specific half of the diagram.
- [x] 5.7 Pan, pointer-anchored zoom, and fit-to-content that includes below-shape labels so the bottom row is not clipped.
- [x] 5.8 Add `src/webview/bpmnView.css` on VS Code theme variables (D8).
- [x] 5.9 Add `build:bpmnview` to `package.json` and invoke it from `build`; declare `reltio.previewWorkflowDiagram` with menu entries on drafts, definitions and `editor/title`; register it in `src/extension.ts`, downloading a definition that has not been fetched rather than refusing.

## 6. Skill

- [x] 6.1 Add §11 to `bpmn-rules.md`: the section's placement, the plane reference, per-element shapes, default sizes, and what each mistake costs.
- [x] 6.2 Add checklist item 11 and two deny-list entries.
- [x] 6.3 Point the playbook's write step at §11, and add a step to show the diagram after authoring.
- [x] 6.4 Bump `skillsBundleVersion` in `resources/reltio-agent-assets.json` — the sync gate is a string inequality, so changes without a bump reach nobody.

## 7. Tests

- [x] 7.1 Add `scripts/test-workflow-bpmn-diagram.cjs` covering Tier A items 1–14 in design.md's test plan.
- [x] 7.2 Add the Tier B structural and webview-safety checks (items 15–16).
- [x] 7.3 **Register the script in the hardcoded `SCRIPTS` array in `scripts/run-unit-tests.cjs`**, alphabetically.

## 8. Docs

- [x] 8.1 Update `ARCHITECTURE.md`: `src/workflow/`, the second webview bundle, and the new command.
- [x] 8.2 `npm run compile`, `npm run build` and `npm test` green.

## 9. Blocked on a live tenant

- [ ] 9.1 Tier C manual QA per design.md's test plan — in particular M2, whether the Reltio console renders a generated diagram.
