## Why

The BPMN preview shipped by `workflow-bpmn-diagram` draws shapes in the right places and text in the wrong ones. On a real `dataChangeRequestReview` the caption under an end event runs across the shape next to it, a gateway's condition is drawn on top of the gateway it leaves, and names arrive clipped as `Custom Listener T…` and `ChangeRequestReje…` with room to spare on either side.

Three independent causes, none of them the layout engine's fault:

**ELK was never told labels exist.** `layoutProcess` handed it `{ id, ...shapeSize(node.shape) }` — a bare 36x36 circle or 50x50 diamond. ELK reserved clearance for the shape and nothing for the caption drawn *below* it or the condition drawn *alongside* the connector leaving it, so it packed the next row into the space the text would occupy.

**Edge labels anchored to the wrong segment.** `drawEdge()` used `points[0]` and `points[1]` unconditionally. On an orthogonal route out of a gateway that first segment is a stub a few units long, so the label's midpoint landed on the diamond.

**Truncation was a fixed character count.** `MAX_LABEL_CHARS = 18`, regardless of the room available — too few for a caption below an event, which nothing bounds, and no help at all inside a task, which is bounded by 100 units and could have taken a second line.

## What Changes

- **New `src/workflow/bpmnLabels.ts`**, the single place that decides how wide a label is and what it says. The host consults it to reserve room and the webview consults it to draw; previously each had its own idea, which is the whole mechanism of the overlap.
- **`layoutProcess` gives ELK an inflated *layout box*** for events and gateways — tall enough for the caption band, wide enough for the caption — and writes the **true BPMN size** into the DI. Camunda draws whatever size it finds in the file, so the inflation must not leak into it.
- **Height is inflated symmetrically**, and terminal waypoints are snapped from the box edge back onto the shape. ELK attaches connectors at a box's mid-height and on its east/west faces, so an asymmetrically padded or widened box would leave arrows pointing at empty space beside the circle.
- **Edge labels carry a declared size**, plus `elk.spacing.edgeNode` / `edgeLabel`, so the layered algorithm reserves a lane for condition text instead of routing the edge flush against its neighbour.
- **Condition text anchors to the longest horizontal run** of its polyline, falling back to the longest segment of any orientation and then to nothing.
- **Labels wrap and clip to the space they have.** A task name gets two lines inside its box; a caption below a shape gets a generous but capped width; a delegate tail and a role line each get the task's own width. `fitToContent` allows for the band and the caption's overhang, so nothing is clipped after a fit.
- **The skeleton and the panel stop deriving labels themselves.** `bpmnPanel.viewNodes` had its own copy of "name or id" and `shortClassName`; both move into `bpmnLabels.ts`.

## Capabilities

**Code**
- **New files**: `src/workflow/bpmnLabels.ts`
- **Modified files**: `src/workflow/bpmnLayout.ts` (`layoutBox`, `elkEdge`, `snapToShape`, spacing, size write-back), `src/workflow/bpmnDiagram.ts` (`readPlaneElement`), `src/workflow/bpmnPanel.ts` (uses the shared label text), `src/webview/bpmnView.ts` (`appendLines`, `fitToContent`, edge-label anchoring; `MAX_LABEL_CHARS` and `truncate` removed)

**External API**
- None. Nothing new is fetched and the DI written to disk is byte-compatible with what the previous version produced for the same topology.

**Tests**
- Extends `scripts/test-workflow-bpmn-diagram.cjs` with four sections: the shared label functions; the anchor choosing the longest horizontal run, verified both in isolation and against real ELK output; a full **ink map** over two fixtures shaped like the reported screenshots, asserting that no two drawn rectangles overlap — shapes, captions and conditions alike; and that inflation reaches neither the DI nor the connector endpoints.

**Docs**
- `ARCHITECTURE.md`: `bpmnLabels.ts` in the `src/workflow/` description, and a Key Design Pattern note on label-aware layout.

**Not in scope (this change)**
- **An external renderer.** Adopting `bpmn-js` would fix the drawing and bring a second BPMN model, a second layout engine and a bundle an order of magnitude larger, for three defects that are each a few lines. Considered and declined; see design.md D0.
- **Editing in the diagram.** The preview stays read-only. Editing happens in the XML, which is where the Reltio rules are expressed and where an agent can work.
- **Measuring text.** Widths are estimated from an average glyph advance. The host has no DOM at layout time, so a measured width would have to come back from the webview and re-run the layout.
