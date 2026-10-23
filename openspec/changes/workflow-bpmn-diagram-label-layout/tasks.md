## 1. The shared label module

- [x] 1.1 Add `src/workflow/bpmnLabels.ts` with the font sizes mirrored from `bpmnView.css`, the glyph-width estimate and its rationale, and `textWidth` / `lineHeight` (D1).
- [x] 1.2 Implement `layoutLabel` returning the final display strings, greedy-wrapped to `maxLines` and ellipsised per line (D5).
- [x] 1.3 Add the four call-site wrappers — `outsideLabelBox`, `taskLabelBox`, `taskDetailBox`, `edgeLabelBox` — and `outsideLabelBand` (D5).
- [x] 1.4 Move `nodeLabelText` and `nodeDetailText` (with `shortClassName`) out of `bpmnPanel.ts` into this module, so the layout measures the strings the renderer draws (D1).
- [x] 1.5 Add `edgeLabelAnchor` here rather than in the webview, so it is unit testable (D4).

## 2. Label-aware layout

- [x] 2.1 Add `layoutBox(node)` to `bpmnLayout.ts`: shape size for a task, caption-inflated box otherwise, symmetric in height (D2).
- [x] 2.2 Centre the shape in ELK's returned box and record the **shape's** size in `bounds`, never the box's (D2).
- [x] 2.3 Carry `flow.condition` onto `RoutableFlow` and declare it as an ELK edge label with a real width and height (D1, proposal).
- [x] 2.4 Raise `elk.spacing.nodeNode` and `elk.layered.spacing.nodeNodeBetweenLayers`, and add `elk.spacing.edgeNode`, `elk.spacing.edgeLabel` and `elk.layered.spacing.edgeNodeBetweenLayers`.
- [x] 2.5 Add `snapToShape` and apply it to both ends of every route, leaving a non-level terminal segment alone (D3).
- [x] 2.6 Add `readPlaneElement` to `bpmnDiagram.ts` — needed by the diagnostics change, and it belongs with the other DI readers.

## 3. Renderer

- [x] 3.1 Delete `MAX_LABEL_CHARS` and `truncate` from `bpmnView.ts`.
- [x] 3.2 Add `appendLines`, drawing each wrapped line as an absolutely positioned `<tspan>` — `dy` drifts once a line is empty.
- [x] 3.3 Centre a task's name and detail line as one block, so a two-line name with a role under it stays inside the box (D5).
- [x] 3.4 Draw a caption below an event or gateway from `outsideLabelBox`, at the gap the layout reserved.
- [x] 3.5 Anchor a condition with `edgeLabelAnchor` and clip it with `edgeLabelBox` (D4).
- [x] 3.6 Extend `fitToContent` to include the caption band and the caption's horizontal overhang (D5).
- [x] 3.7 Point `bpmnPanel.viewNodes` at the shared label text and delete its local `shortClassName` (D1).

## 4. Tests

- [x] 4.1 Add the two fixtures — a gateway fan-out and an all-captions-overflowing process — plus a `disjoint` helper, and reuse it in the existing shape-overlap check (D6).
- [x] 4.2 Add test-plan items 1–6 for the shared label functions.
- [x] 4.3 Add items 7–8 for the anchor, in isolation and against real ELK output.
- [x] 4.4 Add item 9, the full ink map over both fixtures (D6).
- [x] 4.5 Add items 10–11: default sizes in `bounds` and in the serialized DI, and both route ends landing on a shape.

## 5. Docs

- [x] 5.1 `ARCHITECTURE.md`: add `bpmnLabels.ts` to the `src/workflow/` list and a Key Design Pattern note on why the layout and the renderer share it.

## 6. Verify

- [x] 6.1 `npm run compile`, `npm run build:bpmnview` and `npm test` green.
- [ ] 6.2 Tier C manual QA per design.md's test plan.
