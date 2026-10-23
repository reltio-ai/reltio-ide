# Design — workflow-bpmn-diagram-label-layout

Fixes the renderer and the layout shipped by `workflow-bpmn-diagram`. Same architecture: ELK in the host, SVG in a webview, positions posted across.

---

## D0. Fix it, rather than adopt `bpmn-js`

**Decision.** Keep the in-house viewer.

**Rationale.** The defects were three specific and small ones — ELK not being told labels exist, a label anchored to the wrong segment, and a character-count truncation — not evidence that drawing BPMN is harder than it looked. Against them, `bpmn-js` brings its own BPMN moddle (a second parser, where this repo deliberately has none — see `workflowAdapterClient.ts` on XXE), its own layouter, a bundle roughly an order of magnitude larger than `dist/bpmnView.js`, and a webview CSP that has to accommodate it.

It would also lose the two things this viewer does that a generic one cannot: showing a user task's `candidateGroups` and a service task's delegate tail on the shape, and rendering a definition that carries no diagram interchange at all. The second matters because DI-less definitions are exactly what this extension has to open — every draft authored before `workflow-bpmn-diagram` is one.

## D1. One module decides how wide a label is

**Decision.** `src/workflow/bpmnLabels.ts` owns font sizes, the glyph-width estimate, wrapping, clipping and the two "what does this label say" functions. `bpmnLayout.ts` calls it to size a box; `bpmnView.ts` calls it to draw; `bpmnPanel.ts` calls it for the strings.

**Rationale.** The layout runs in the extension host, before any webview exists, so it cannot measure text against a DOM. The renderer runs in the webview and can. That asymmetry is unavoidable, and it means one side has to accept the other's answer — otherwise the layout reserves 36 units and the renderer fills 130, which is precisely what happened.

`layoutLabel` returns the **final display strings**, not a width to be re-derived. The renderer draws `box.lines` verbatim. There is then no arithmetic to get out of step, only a function to call.

The webview bundles this module. It is pure, imports only types, and esbuild drops what is unused — so the cost of sharing it is a few hundred bytes against a class of bug that has no other fix.

**Estimated, not measured.** `AVERAGE_GLYPH_RATIO = 0.55` errs high. Over-reserving leaves a gap; under-reserving overlaps. The alternative is a round trip — post the diagram, measure in the DOM, send widths back, re-layout, re-post — for a read-only preview.

## D2. A layout box is not a shape

**Decision.** `layoutBox(node)` returns the shape size for a task, and for an event or gateway an inflated box: `width = max(shapeWidth, captionWidth)`, `height = shapeHeight + 2 × (gap + captionHeight)`. `layoutProcess` then centres the shape in the returned box and records **only the shape** in `bounds`.

**Rationale.** ELK reserves clearance around what it is given. Given a bare circle it has no way to know a caption hangs below it, so `elk.spacing.nodeNode` is measured from the circle and the caption is drawn into the gap. Inflating the box is telling it the truth about how much room the element occupies.

Writing the box into the DI instead would be worse than the original bug. Every reader draws the size it finds — `bpmn-rules.md` §11 lists the defaults as part of the contract — so a 70-unit `Bounds` on a start event renders a 70-unit circle in Camunda Modeler.

**Why height is symmetric.** The caption is only below the shape, so padding only below is the obvious move and it is wrong: ELK attaches connectors at the box's mid-height, and with the shape at the top of an asymmetric box every arrow arrives below the centre of the circle it points at. Symmetric padding costs vertical whitespace, which a fit-to-content viewer does not charge for.

## D3. Snapping the terminal segments

**Decision.** After reading ELK's route, `snapToShape` moves each end from the box boundary onto the shape boundary: the outer point's `x` to the shape's near vertical edge, and the *shared* `y` of both points of that terminal segment clamped into the shape's vertical extent. A terminal segment that is not level is left alone.

**Rationale.** D2's width inflation puts the box's east face up to 48 units right of a 36-unit circle, so ELK's start point — correctly on the box — is in empty space beside the shape. Height inflation has the same effect when ELK picks a port high or low on the face.

This is safe because of what `elk.direction: RIGHT` guarantees: layered puts every port on an east or west face, so both terminal segments run level. Moving the outer point's `x` therefore keeps the segment level, and moving the shared `y` of *both* its points keeps the next segment — which is vertical — vertical. Nothing is rerouted; two coordinates move along axes the route already had. A non-level terminal segment has no such move, so it is left as ELK drew it rather than bent.

## D4. Conditions anchor to the longest horizontal run

**Decision.** `edgeLabelAnchor(points)` returns the midpoint of the longest segment whose endpoints are within one unit of level; failing that, of the longest segment of any orientation; failing that, nothing.

**Rationale.** The previous code took `points[0]`–`points[1]` unconditionally. Out of a fan-out gateway ELK emits a stub of a few units before turning, so a centred label on that segment's midpoint spanned the diamond. On the reported fixture the anchor moves from 17 units right of the gateway's edge to 160.

Horizontal rather than merely longest, because the text is drawn horizontally: a long vertical segment offers no width, and a label centred on it is as bad as one on a corner. The fallbacks exist for routes that never run level, where somewhere on the line beats nowhere.

`edgeLabelAnchor` lives in `bpmnLabels.ts` rather than in the webview so it can be unit tested. Asserting on the webview's source text would have been the alternative, and a regex that finds the phrase "longest horizontal" proves nothing about the arithmetic.

## D5. Truncation is width-aware, and wrapping comes first

**Decision.** Greedy word wrap to a maximum line count, then ellipsise any line still too wide. Two lines for a name, one for a detail or condition. Bounds: a task's own width less padding; a capped 132 units for a caption below a shape; 150 for a condition.

**Rationale.** `MAX_LABEL_CHARS = 18` was wrong in both directions. Below an event nothing bounds the width, so 18 characters clipped `ChangeRequestApproved` for no reason; inside a 100-unit task 18 characters overflows the box, and a second line was available and unused.

Caps rather than no bound, because D2 turns a caption's width into a layout box's width: one verbose element would otherwise set the column width for the whole diagram. Words longer than the box are ellipsised, not hyphenated — a run-together name like `ChangeRequestRejectedByDataSteward` has no break point worth inventing.

## D6. The overlap test is an ink map

**Decision.** Compute every rectangle the viewer draws — shape, caption band including its overhang, condition at its anchor — and assert pairwise disjointness across two fixtures shaped like the reported screenshots.

**Rationale.** The suite already asserted that no two *shapes* overlap, and that assertion was green for the entire period the diagram was unreadable, because the shapes never were the problem. Testing the thing that was actually wrong means testing what is inked.

Rectangles rather than a rendered image: there is no rasteriser in the toolchain, and a pixel comparison would be brittle against font and theme. The geometric version is also stronger — it reports *which* two elements collide.

## Test plan

**Automated (Tier A — extends `scripts/test-workflow-bpmn-diagram.cjs`)**

| # | Assertion |
|---|---|
| 1 | A label that fits is returned unchanged; a long one wraps to two lines, each fitting the box |
| 2 | Overflow past the last allowed line is folded into it and ellipsised, not dropped |
| 3 | A single word wider than the box is ellipsised (the `ChangeRequestRejected` case) |
| 4 | An unnamed element reserves no band at all |
| 5 | A caption below a shape is capped below its natural width |
| 6 | `nodeLabelText` falls back to the id; `nodeDetailText` prefers a role over a delegate and shortens the class to its tail |
| 7 | `edgeLabelAnchor` picks the longest horizontal run over the first segment, handles an all-vertical route, and returns nothing for fewer than two points |
| 8 | On real ELK output for a fan-out fixture, every condition's drawn rectangle is disjoint from every shape |
| 9 | Full ink map disjoint on both fixtures: shapes, caption bands, conditions |
| 10 | Every laid-out node keeps its BPMN default size, in `bounds` and in the serialized `<omgdc:Bounds>` |
| 11 | Both ends of every route land within tolerance of a shape rectangle — the symmetric-inflation and snapping property |
| 12 | The pre-existing sections (12–14) still pass unchanged: shapes positioned, flows routed, dangling flow dropped, DI-less document repaired |

**Manual QA (Tier C)**

| # | Step | Expected |
|---|---|---|
| M1 | Open the diagram for a `dataChangeRequestReview` with a fan-out gateway | No text over any shape; each condition beside its own connector |
| M2 | Find a task whose name needs two lines | Name on two lines, role or delegate below, all inside the box |
| M3 | Fit and then zoom out | No caption clipped at the bottom or the sides |
| M4 | Open a definition fetched from a tenant (authored DI) | Drawn as its author arranged it; sizes untouched |
| M5 | Save a draft and open it in Camunda Modeler | Event 36x36, gateway 50x50, task 100x80 |

## Open questions

1. **Should the caption cap scale with the diagram?** A 132-unit cap is generous for a six-element process and tight for a wide one. Scaling it would make the layout depend on its own output, so it is fixed until a real diagram is clipped by it.
2. **Should a measured width ever replace the estimate?** The webview could report back and the host re-layout. That is two renders per open for a read-only preview; revisit only if a font is found where 0.55 is badly wrong.
