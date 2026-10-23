## Why

`workflow-authoring` let a user create, edit and deploy a BPMN without leaving the IDE. It deliberately emitted no diagram interchange (DI), on the reasoning that the Activiti engine executes a process perfectly well without one.

That reasoning was correct and beside the point. DI is not decoration — it is the *only* thing any viewer reads. A definition without it opens as a blank canvas in the Reltio console, in Camunda Modeler, and in every bpmn.io-based tool. So the drafts this extension produced executed correctly and could not be looked at: a workflow nobody can see is a workflow nobody can review, and the reviewer is usually not the author.

The second half of the problem is that the IDE had nothing to look at it *with*. A user editing a 200-line BPMN by hand cannot see that they have wired a gateway's default flow to the wrong task; the XML is where the Reltio rules live, but it is a poor place to read a process.

Both halves are solvable without a new dependency. `elkjs` is already in the extension for the Ontology preview and is already configured for exactly this kind of graph, and the webview panel pattern is already established.

## What Changes

- **Every draft carries diagram interchange.** `buildBpmnSkeleton` now declares all seven namespaces from `bpmn-rules.md` §1 — it was declaring four — and emits a `<bpmndi:BPMNDiagram>` section. Duplicating a definition that has none generates one.
- **Duplicating re-points the diagram plane.** `rewriteProcessIdentity` rewrote the `<process>` element's `id` and left `<bpmndi:BPMNPlane bpmnElement="…">` naming the old one. A plane pointing at an id that no longer exists in the document renders **nothing at all**, so every duplicate of a definition that did have DI produced an invisible diagram.
- **A read-only diagram preview**, `reltio.previewWorkflowDiagram`, on drafts, deployed definitions and any open `.bpmn20.xml`. It prefers the coordinates already in the file and computes them only when there are none — a deployed definition is shown as its author arranged it, not silently re-laid-out.
- **The viewer shows what makes a BPMN Reltio's**, not just its shape: a user task's `activiti:candidateGroups` and a service task's `activiti:class` are drawn under the task name. Those are the fields most often wrong and least visible in the XML.
- **Clicking a shape reveals the element in the editor.** The one interaction offered; editing stays in the XML.
- **`bpmn-rules.md` gains §11**, a checklist item and two deny-list entries covering DI — so an agent authoring a file by hand produces one that can be viewed.

## Capabilities

**Code**
- **New files**: `src/workflow/bpmnModel.ts` (bounded-regex structural read with character offsets), `src/workflow/bpmnDiagram.ts` (pure DI serializer, reader and fixed-chain layout), `src/workflow/bpmnLayout.ts` (the `elkjs` half), `src/workflow/bpmnPanel.ts` (webview host), `src/webview/bpmnView.ts` + `bpmnView.css` (SVG renderer), `scripts/test-workflow-bpmn-diagram.cjs`
- **Modified files**: `src/workspace/workflowDrafts.ts` (namespaces, DI in the skeleton, plane retargeting), `src/extension.ts` (the preview command, DI generation on duplicate), `package.json` (command, menus, `build:bpmnview` target), `skills/reltio-default/workflow-bpmn-authoring/references/bpmn-rules.md`, `ARCHITECTURE.md`

**External API**
- None. Layout is local, and the viewer reads a document that is already on disk.

**Dependencies**
- None added. `elkjs` is already a dependency; no XML parser is introduced, for the same reason the rest of the repo has none.

**Tests**
- `scripts/test-workflow-bpmn-diagram.cjs`: structural extraction with and without namespace prefixes, comment and DI blanking that preserves offsets, condition scoping, serializer escaping and ordering, a write/read round trip, partial-DI detection, the skeleton's completeness, plane retargeting on duplicate, ELK layout with non-overlapping shapes and dropped dangling flows, and the viewer's CSP and message-origin handling.

**Docs**
- `bpmn-rules.md` §11; `ARCHITECTURE.md` package structure and the webview bundle list.

**Not in scope (this change)**
- **Editing the diagram.** Read-only. A drag-and-drop modeller would be a second authoring surface, weaker than the XML (where the Reltio rules are expressible and an agent can work) and with its own persistence problem.
- **BPMN validation and XML completion.** Deferred to V2. `bpmnModel.ts` records character offsets for it, since they cost nothing to carry and cannot be recovered later without re-scanning.
- **Re-laying-out a fetched definition.** Its author's layout is preserved; a viewer that quietly rearranges someone's diagram is reporting something other than what is deployed.
- **Pools, lanes, and sub-process expansion.** `bpmn-rules.md` §9 lists two supported topologies; neither needs them.
