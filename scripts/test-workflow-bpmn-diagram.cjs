#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: workflow-bpmn-diagram
 *
 * Tier A — pure logic, no I/O, no VS Code host, no layout engine:
 *   1.  Structural read: process attributes, flow nodes, sequence flows, and
 *       the Reltio-specific `activiti:candidateGroups` / `activiti:class`.
 *   2.  Namespace prefixes are optional everywhere — the same document deploys
 *       with `<userTask>` or `<bpmn:userTask>`, so both must read the same.
 *   3.  A commented-out element is not a real one, and the diagram section is
 *       not a second copy of every node. Both are blanked with same-length
 *       runs so reported offsets still index the original text.
 *   4.  Offsets point at the `<` of the element they describe.
 *   5.  A condition belongs to the flow that encloses it: a conditionless
 *       default flow must not pick up the next flow's condition, which is the
 *       exact pair Activiti rejects.
 *   5b. A condition whose CDATA contains the literal substring "sequenceFlow>"
 *       must not have its body truncated there (security/code-quality review).
 *   6.  Serialization: shapes before edges, the plane names the process, every
 *       value XML-escaped, and elements without positions skipped rather than
 *       stacked at the origin.
 *   7.  `withDiagramSection` inserts inside `</definitions>` and replaces an
 *       existing section rather than emitting two.
 *   8.  Round trip: a section this module writes is read back by
 *       `readDiagramLayout` to the same coordinates.
 *   9.  Partial DI is reported incomplete, so the caller re-lays-out the whole
 *       diagram instead of mixing authored and computed positions.
 *  10.  `buildBpmnSkeleton` emits all seven namespaces and a complete diagram
 *       section — a draft that renders as a blank canvas is the bug this
 *       change exists to fix.
 *  11.  `rewriteProcessIdentity` re-points the plane at the new id. Leaving it
 *       pointing at the old one makes a duplicated definition render nothing.
 *
 * Tier A (async) — with the layout engine:
 *  12.  `layoutProcess` positions every node and routes every resolvable flow.
 *  13.  A flow naming a missing node is dropped, not thrown on.
 *  14.  `withGeneratedDiagram` turns a DI-less document into one that reads
 *       back complete.
 *  18.  Labels wrap and clip to a box, from the one module both the layout and
 *       the renderer consult — the two disagreeing is what drew text across
 *       shapes, so the shared function is pinned rather than each side's use
 *       of it.
 *  19.  A condition is anchored to the longest horizontal run of its route, not
 *       to the stub ELK leaves at a gateway, and clears every shape.
 *  20.  The full ink map is disjoint: shapes, the captions below them, and the
 *       conditions along the connectors. Section 12's shape-only version stayed
 *       green throughout the period those captions were unreadable.
 *  21.  Layout-time inflation stays out of the file (the DI still carries BPMN's
 *       default sizes) and off the connectors (both ends still land on a shape).
 *
 * Tier B — structural:
 *  15.  The viewer's command is declared, menu-scoped and registered; its
 *       webview bundle has a build target; and this script is in the runner.
 *  16.  The webview never interpolates document text into HTML, and checks the
 *       origin of every message before reading it.
 *
 * Tier C (manual) — documented in design.md's test plan.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');

const {
	extractProcessModel,
	hasDiagramSection,
	unescapeXml,
} = importDist('workflow/bpmnModel');

const {
	renderDiagramSection,
	withDiagramSection,
	readDiagramLayout,
	isCompleteFor,
	layoutChain,
	shapeSize,
	SHAPE_SIZES,
} = importDist('workflow/bpmnDiagram');

const { layoutProcess, generateDiagramSection, withGeneratedDiagram } =
	importDist('workflow/bpmnLayout');

const {
	edgeLabel,
	edgeLabelAnchor,
	edgeLabelBox,
	flowLabelText,
	layoutLabel,
	lineHeight,
	nodeDetailText,
	nodeLabelText,
	outsideLabelBand,
	outsideLabelBox,
	outsideLabelTop,
	taskDetailBox,
	taskLabelBox,
	textWidth,
	LABEL_FONT_SIZE,
} = importDist('workflow/bpmnLabels');

const { buildBpmnSkeleton, rewriteProcessIdentity } = importDist('workspace/workflowDrafts');

const repoRoot = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

/** A branching process, prefixed, with conditions and a default flow. */
const BRANCHING = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:activiti="http://activiti.org/bpmn">
  <!-- <bpmn:userTask id="commentedOut" name="Ignore me" /> -->
  <bpmn:process id="review" name="Review &amp; Approve" isExecutable="true">
    <bpmn:startEvent id="start" name="Start" />
    <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="decide" />
    <bpmn:exclusiveGateway id="decide" name="Approved?" default="fDefault" />
    <bpmn:sequenceFlow id="fApprove" sourceRef="decide" targetRef="applyTask">
      <bpmn:conditionExpression><![CDATA[\${decision == 'approve'}]]></bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="fDefault" sourceRef="decide" targetRef="end" />
    <bpmn:serviceTask id="applyTask" name="Apply"
                      activiti:class="com.reltio.workflow.activiti.service.ChangeRequestApply" />
    <bpmn:sequenceFlow id="f4" sourceRef="applyTask" targetRef="end" />
    <bpmn:userTask id="reviewTask" name="Review" activiti:candidateGroups="ROLE_REVIEWER" />
    <bpmn:endEvent id="end" name="End" />
  </bpmn:process>
</bpmn:definitions>
`;

/**
 * A condition whose CDATA happens to contain the literal substring `sequenceFlow>` —
 * the exact shape that broke `readCondition()`'s old `indexOf('sequenceFlow>', …)` closing-tag
 * search (security/code-quality review pass). Prefixed, like `BRANCHING` above, so the fix's
 * optional-namespace-prefix handling is exercised too.
 */
const TRICKY_CDATA = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:process id="trickyProcess" isExecutable="true">
    <bpmn:startEvent id="s" />
    <bpmn:exclusiveGateway id="g" />
    <bpmn:sequenceFlow id="fTricky" sourceRef="g" targetRef="e1">
      <bpmn:conditionExpression><![CDATA[\${note == 'see sequenceFlow> above for details'}]]></bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="fOther" sourceRef="g" targetRef="e2" />
    <bpmn:endEvent id="e1" />
    <bpmn:endEvent id="e2" />
  </bpmn:process>
</bpmn:definitions>
`;

/**
 * The shape of the two screenshots that prompted this: a gateway fanning out on
 * conditions, into end events whose names are longer than the circles they hang
 * under. Both of the failure modes — a condition drawn across its own gateway,
 * and a caption drawn across the next row — show up on this one process.
 */
const GATEWAY_FANOUT = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:activiti="http://activiti.org/bpmn">
  <process id="dataChangeRequestReview" name="Review" isExecutable="true">
    <startEvent id="startEvent" name="Change Request Created" />
    <sequenceFlow id="f1" sourceRef="startEvent" targetRef="reviewTask" />
    <userTask id="reviewTask" name="Custom Listener Task Review"
              activiti:candidateGroups="ROLE_DATA_STEWARD" />
    <sequenceFlow id="f2" sourceRef="reviewTask" targetRef="decision" />
    <exclusiveGateway id="decision" name="Approved?" default="fReject" />
    <sequenceFlow id="fApprove" sourceRef="decision" targetRef="applyTask">
      <conditionExpression><![CDATA[\${decision == 'Approved'}]]></conditionExpression>
    </sequenceFlow>
    <sequenceFlow id="fEscalate" sourceRef="decision" targetRef="escalateTask">
      <conditionExpression><![CDATA[\${decision == 'Escalated'}]]></conditionExpression>
    </sequenceFlow>
    <sequenceFlow id="fReject" sourceRef="decision" targetRef="rejectEnd" />
    <serviceTask id="applyTask" name="Apply Changes"
                 activiti:class="com.reltio.workflow.activiti.service.ChangeRequestApply" />
    <userTask id="escalateTask" name="Escalate" activiti:candidateGroups="ROLE_ADMIN" />
    <sequenceFlow id="f5" sourceRef="applyTask" targetRef="approveEnd" />
    <sequenceFlow id="f6" sourceRef="escalateTask" targetRef="approveEnd" />
    <endEvent id="approveEnd" name="ChangeRequestApproved" />
    <endEvent id="rejectEnd" name="ChangeRequestRejected" />
  </process>
</definitions>
`;

/** Every caption wider than the shape it hangs under, including an unnamed one. */
const LONG_NAMES = `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <process id="p" name="P" isExecutable="true">
    <startEvent id="s" name="Data Change Request Received From Source System" />
    <sequenceFlow id="a" sourceRef="s" targetRef="g" />
    <parallelGateway id="g" />
    <sequenceFlow id="b" sourceRef="g" targetRef="t1" />
    <sequenceFlow id="c" sourceRef="g" targetRef="t2" />
    <userTask id="t1" name="Review By Data Steward Before Publication" />
    <userTask id="t2" name="Secondary Review" />
    <sequenceFlow id="d" sourceRef="t1" targetRef="e1" />
    <sequenceFlow id="e" sourceRef="t2" targetRef="e2" />
    <endEvent id="e1" name="ChangeRequestApprovedAndPublished" />
    <endEvent id="e2" name="ChangeRequestRejectedWithComment" />
  </process>
</definitions>
`;

/** Two boxes share no interior. Used for shapes and for shapes-plus-captions. */
function disjoint(a, b) {
	return (
		a.x + a.width <= b.x || b.x + b.width <= a.x ||
		a.y + a.height <= b.y || b.y + b.height <= a.y
	);
}

// ── 1-2. Structural read, with and without prefixes ─────────────────────────
{
	const model = extractProcessModel(BRANCHING);
	assert.strictEqual(model.processId, 'review');
	assert.strictEqual(model.processName, 'Review & Approve', 'attribute values must be unescaped');
	assert.strictEqual(model.isExecutable, true);

	const byId = new Map(model.nodes.map(n => [n.id, n]));
	assert.deepStrictEqual(
		[...byId.keys()].sort(),
		['applyTask', 'decide', 'end', 'reviewTask', 'start'],
	);
	assert.strictEqual(byId.get('decide').shape, 'gateway');
	assert.strictEqual(byId.get('start').shape, 'event');
	assert.strictEqual(byId.get('end').shape, 'event');
	assert.strictEqual(byId.get('applyTask').shape, 'task');
	assert.strictEqual(byId.get('reviewTask').candidateGroups, 'ROLE_REVIEWER');
	assert.strictEqual(
		byId.get('applyTask').delegateClass,
		'com.reltio.workflow.activiti.service.ChangeRequestApply',
		'activiti:class must be read through its prefix',
	);

	// The unprefixed form of the same document reads identically.
	const unprefixed = BRANCHING.replace(/bpmn:/g, '');
	const plain = extractProcessModel(unprefixed);
	assert.strictEqual(plain.processId, 'review');
	assert.strictEqual(plain.nodes.length, model.nodes.length);
	assert.strictEqual(plain.flows.length, model.flows.length);
}

// ── 3. Comments and the diagram block are not content ───────────────────────
{
	const model = extractProcessModel(BRANCHING);
	assert.ok(
		!model.nodes.some(n => n.id === 'commentedOut'),
		'a commented-out element must not be read as a real one',
	);

	// A document with DI must report the same nodes as the same document without
	// it — DI carries a bpmnElement per node, which would otherwise double them.
	const withDi = withDiagramSection(
		BRANCHING,
		renderDiagramSection('review', model, layoutChain(model.nodes, model.flows)),
	);
	const fromDi = extractProcessModel(withDi);
	assert.strictEqual(fromDi.nodes.length, model.nodes.length, 'DI must not add phantom nodes');
	assert.strictEqual(fromDi.flows.length, model.flows.length, 'DI must not add phantom flows');
}

// ── 4. Offsets index the original text ──────────────────────────────────────
{
	const model = extractProcessModel(BRANCHING);
	for (const node of model.nodes) {
		assert.strictEqual(
			BRANCHING[node.offset], '<',
			`${node.id}: offset must land on the opening angle bracket`,
		);
		assert.ok(
			BRANCHING.slice(node.offset, node.offset + 60).includes(node.id),
			`${node.id}: offset must land on its own element`,
		);
	}
	for (const flow of model.flows) {
		assert.strictEqual(BRANCHING[flow.offset], '<', `${flow.id}: offset must land on '<'`);
	}
}

// ── 5. A condition belongs to its own flow ──────────────────────────────────
{
	const model = extractProcessModel(BRANCHING);
	const byId = new Map(model.flows.map(f => [f.id, f]));

	assert.strictEqual(
		byId.get('fApprove').condition, "${decision == 'approve'}",
		'CDATA must be unwrapped',
	);
	// The default flow is declared immediately after a conditional one. A global
	// search would hand it the neighbour's condition, producing exactly the
	// gateway/default pair the deny-list forbids.
	assert.strictEqual(
		byId.get('fDefault').condition, undefined,
		'a default flow must not inherit the previous flow\'s condition',
	);
	assert.strictEqual(byId.get('f1').condition, undefined, 'a self-closing flow has no condition');
}

// ── 5b. A literal "sequenceFlow>" inside a condition's CDATA must not truncate it ──
// Regression guard: `readCondition()` used to search for the closing tag with a literal
// `indexOf('sequenceFlow>', …)`. A condition whose text or CDATA happens to contain that exact
// substring — e.g. referencing another flow's tag name in a comment-like string — found the
// substring inside its own CDATA instead of the real closing tag, truncated its body mid-CDATA,
// and silently lost the whole condition (no `</conditionExpression>` left inside the truncated
// body for `CONDITION_EXPRESSION` to match).
{
	const model = extractProcessModel(TRICKY_CDATA);
	const byId = new Map(model.flows.map(f => [f.id, f]));
	assert.strictEqual(
		byId.get('fTricky').condition,
		"${note == 'see sequenceFlow> above for details'}",
		'a literal "sequenceFlow>" substring inside the CDATA must not truncate the condition',
	);
	assert.strictEqual(byId.get('fOther').condition, undefined, 'the sibling flow must not inherit anything from the truncation');
}

// ── 6. Serialization ────────────────────────────────────────────────────────
{
	const model = extractProcessModel(BRANCHING);
	const layout = layoutChain(model.nodes, model.flows);
	const section = renderDiagramSection('review', model, layout);

	assert.ok(section.includes('<bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="review">'));
	assert.ok(
		section.indexOf('BPMNShape') < section.indexOf('BPMNEdge'),
		'shapes must be emitted before edges',
	);
	assert.ok(section.includes('<omgdc:Bounds'), 'shapes carry omgdc:Bounds');
	assert.ok(section.includes('<omgdi:waypoint'), 'edges carry omgdi:waypoint');

	// Coordinates are integers — a viewer gains nothing from sub-pixels.
	for (const value of section.match(/(?:x|y|width|height)="([^"]+)"/g) ?? []) {
		const n = Number(value.split('"')[1]);
		assert.ok(Number.isInteger(n), `${value} must be an integer`);
	}

	// Escaping: an id carrying a metacharacter must not break the document.
	const hostile = { ...model, nodes: [{ ...model.nodes[0], id: 'a"&<b' }] };
	const hostileLayout = { bounds: new Map([['a"&<b', { x: 0, y: 0, width: 36, height: 36 }]]), waypoints: new Map() };
	const escaped = renderDiagramSection('p&p', hostile, hostileLayout);
	assert.ok(escaped.includes('bpmnElement="p&amp;p"'), 'the process id must be escaped');
	assert.ok(escaped.includes('a&quot;&amp;&lt;b'), 'element ids must be escaped');
	assert.ok(!escaped.includes('a"&<b'), 'no raw metacharacter may survive');

	// A node with no position is skipped, not drawn at the origin where it would
	// stack invisibly on top of every other unpositioned node.
	const empty = renderDiagramSection('review', model, { bounds: new Map(), waypoints: new Map() });
	assert.ok(!empty.includes('BPMNShape'), 'unpositioned nodes must be omitted');
	assert.ok(empty.includes('BPMNPlane'), 'the plane is still emitted');
}

// ── 7. Insertion and replacement ────────────────────────────────────────────
{
	const model = extractProcessModel(BRANCHING);
	const section = renderDiagramSection('review', model, layoutChain(model.nodes, model.flows));

	const once = withDiagramSection(BRANCHING, section);
	assert.ok(hasDiagramSection(once));
	assert.ok(
		once.indexOf('BPMNDiagram') > once.indexOf('</bpmn:process>'),
		'DI must sit after the process, inside definitions',
	);
	assert.ok(
		once.indexOf('BPMNDiagram') < once.indexOf('</bpmn:definitions>'),
		'DI must sit inside the root element',
	);

	const twice = withDiagramSection(once, section);
	assert.strictEqual(
		(twice.match(/<bpmndi:BPMNDiagram/g) || []).length, 1,
		're-applying must replace the section, not append a second one',
	);

	// Nothing to anchor to: return the document rather than append outside root.
	const rootless = '<process id="x"><startEvent id="s" /></process>';
	assert.strictEqual(withDiagramSection(rootless, section), rootless);
}

// ── 8. Round trip ───────────────────────────────────────────────────────────
{
	const model = extractProcessModel(BRANCHING);
	const layout = layoutChain(model.nodes, model.flows);
	const document = withDiagramSection('<definitions></definitions>',
		renderDiagramSection('review', model, layout));

	const readBack = readDiagramLayout(document);
	for (const [id, bounds] of layout.bounds) {
		assert.deepStrictEqual(
			readBack.bounds.get(id), bounds,
			`${id}: bounds must survive a write/read round trip`,
		);
	}
	for (const [id, points] of layout.waypoints) {
		assert.deepStrictEqual(readBack.waypoints.get(id), [...points], `${id}: waypoints must survive`);
	}
}

// ── 9. Partial DI is incomplete ─────────────────────────────────────────────
{
	const model = extractProcessModel(BRANCHING);
	const full = layoutChain(model.nodes, model.flows);
	assert.ok(isCompleteFor(full, model), 'a layout covering every node is complete');

	const partial = { bounds: new Map([...full.bounds].slice(0, 2)), waypoints: new Map() };
	assert.ok(
		!isCompleteFor(partial, model),
		'a layout missing a node must be reported incomplete, not mixed with computed positions',
	);

	assert.ok(!isCompleteFor({ bounds: new Map(), waypoints: new Map() }, model));
}

// ── 10. The skeleton is viewable ────────────────────────────────────────────
{
	const xml = buildBpmnSkeleton('myApproval', 'My Approval');

	for (const ns of [
		'http://www.omg.org/spec/BPMN/20100524/MODEL',
		'http://www.w3.org/2001/XMLSchema-instance',
		'http://www.w3.org/2001/XMLSchema',
		'http://activiti.org/bpmn',
		'http://www.omg.org/spec/BPMN/20100524/DI',
		'http://www.omg.org/spec/DD/20100524/DC',
		'http://www.omg.org/spec/DD/20100524/DI',
	]) {
		assert.ok(xml.includes(ns), `the skeleton must declare ${ns}`);
	}

	assert.ok(hasDiagramSection(xml), 'a new draft must carry diagram interchange');

	const model = extractProcessModel(xml);
	const layout = readDiagramLayout(xml);
	assert.ok(
		isCompleteFor(layout, model),
		'every element in the skeleton must have a shape, or viewers show a partial diagram',
	);
	assert.strictEqual(
		layout.bounds.size, model.nodes.length,
		'no more shapes than elements',
	);
	for (const flow of model.flows) {
		assert.ok(layout.waypoints.has(flow.id), `${flow.id} must have waypoints`);
	}

	// Default BPMN sizes, so a generated diagram looks like a hand-drawn one.
	assert.deepStrictEqual(shapeSize('event'), SHAPE_SIZES.event);
	const start = layout.bounds.get('start');
	assert.strictEqual(start.width, 36);
	assert.strictEqual(start.height, 36);
	const task = layout.bounds.get('reviewTask');
	assert.strictEqual(task.width, 100);
	assert.strictEqual(task.height, 80);

	// Aligned centres are what make the connectors horizontal.
	assert.strictEqual(start.y + start.height / 2, task.y + task.height / 2);

	// The plane names the process, not something else.
	assert.ok(xml.includes('bpmnElement="myApproval"'));
}

// ── 11. Duplicating re-points the plane ─────────────────────────────────────
{
	const original = buildBpmnSkeleton('myApproval', 'My Approval');
	const copy = rewriteProcessIdentity(original, 'myApprovalCopy', 'My Approval Copy');

	assert.ok(copy.includes('<process id="myApprovalCopy"'));
	assert.ok(
		copy.includes('bpmnElement="myApprovalCopy"'),
		'the plane must follow the process id',
	);
	assert.ok(
		!/BPMNPlane[^>]*bpmnElement="myApproval"/.test(copy),
		'a plane left pointing at the old id renders nothing at all',
	);

	// Shape-level references name flow nodes, whose ids are untouched.
	assert.ok(copy.includes('bpmnElement="reviewTask"'), 'shape references must not be rewritten');

	const model = extractProcessModel(copy);
	assert.ok(isCompleteFor(readDiagramLayout(copy), model), 'the copy is still fully drawable');

	// A document with no plane is still rewritten, not refused.
	const planeless = '<definitions><process id="a" name="A"></process></definitions>';
	const rewritten = rewriteProcessIdentity(planeless, 'b', 'B');
	assert.ok(rewritten.includes('<process id="b" name="B">'));
	assert.strictEqual(rewriteProcessIdentity('<definitions/>', 'b', 'B'), undefined);
}

// ── 12-14. With the layout engine ───────────────────────────────────────────
(async () => {
	{
		const model = extractProcessModel(BRANCHING);
		const layout = await layoutProcess(model);

		for (const node of model.nodes) {
			const bounds = layout.bounds.get(node.id);
			assert.ok(bounds, `${node.id} must be positioned`);
			assert.deepStrictEqual(
				{ width: bounds.width, height: bounds.height },
				shapeSize(node.shape),
				`${node.id} must keep its BPMN default size`,
			);
		}
		for (const flow of model.flows) {
			const points = layout.waypoints.get(flow.id);
			assert.ok(points && points.length >= 2, `${flow.id} must be routed with at least 2 points`);
		}

		// Left-to-right: the start event is left of the end event.
		assert.ok(
			layout.bounds.get('start').x < layout.bounds.get('end').x,
			'a process diagram reads left to right',
		);

		// Nothing overlaps. (Section 20 makes the same assertion over what is
		// actually inked, captions included.)
		const boxes = [...layout.bounds.values()];
		for (let i = 0; i < boxes.length; i++) {
			for (let j = i + 1; j < boxes.length; j++) {
				assert.ok(disjoint(boxes[i], boxes[j]), 'laid-out shapes must not overlap');
			}
		}
	}

	// 13. A dangling flow is dropped, not thrown on.
	{
		const dangling = `<definitions><process id="p">
			<startEvent id="s" />
			<sequenceFlow id="bad" sourceRef="s" targetRef="doesNotExist" />
			<endEvent id="e" />
		</process></definitions>`;
		const model = extractProcessModel(dangling);
		const layout = await layoutProcess(model);
		assert.ok(layout.bounds.get('s'), 'the real nodes are still positioned');
		assert.ok(layout.bounds.get('e'));
		assert.ok(!layout.waypoints.has('bad'), 'an unresolvable flow is dropped');
	}

	// 14. A DI-less document becomes a complete one.
	{
		const bare = BRANCHING;
		assert.ok(!hasDiagramSection(bare), 'fixture starts with no DI');

		const repaired = await withGeneratedDiagram(bare);
		assert.ok(hasDiagramSection(repaired));
		const model = extractProcessModel(repaired);
		assert.ok(
			isCompleteFor(readDiagramLayout(repaired), model),
			'the generated section must cover every element',
		);

		// Nothing to draw: leave the document alone rather than write an empty
		// plane, which readers report as a corrupt diagram.
		assert.strictEqual(await generateDiagramSection('<definitions/>'), undefined);
		assert.strictEqual(
			await generateDiagramSection('<definitions><process id="p" /></definitions>'),
			undefined,
			'a process with no flow elements has nothing to draw',
		);
		const untouched = '<definitions><process id="p" /></definitions>';
		assert.strictEqual(await withGeneratedDiagram(untouched), untouched);
	}

	// ── 18. Labels wrap and clip to a box, identically on both sides ─────────
	// One module decides this, because the layout reserves room in the extension
	// host — where no DOM exists to measure text against — and the renderer fills
	// it in the webview. The two disagreeing is the whole cause of the overlap
	// this section exists to prevent, so the shared function is pinned directly.
	{
		const oneLine = layoutLabel('Approved?', { maxWidth: 200, fontSize: 11, maxLines: 2 });
		assert.deepStrictEqual(oneLine.lines, ['Approved?'], 'a label that fits is untouched');
		assert.strictEqual(oneLine.height, lineHeight(11));

		const wrapped = layoutLabel('Custom Listener Task Review', {
			maxWidth: 88, fontSize: 11, maxLines: 2,
		});
		assert.strictEqual(wrapped.lines.length, 2, 'a long name wraps rather than being cut at 18 chars');
		assert.ok(
			wrapped.lines.every(line => textWidth(line, 11) <= 88),
			`every line must fit the box, got ${JSON.stringify(wrapped.lines)}`,
		);
		assert.strictEqual(wrapped.height, 2 * lineHeight(11));

		// Overflow past the last allowed line is folded back into it and ellipsised,
		// so the "…" marks text that was omitted instead of implying the label ended.
		const folded = layoutLabel('one two three four five six seven eight nine', {
			maxWidth: 60, fontSize: 11, maxLines: 2,
		});
		assert.strictEqual(folded.lines.length, 2);
		assert.ok(folded.lines[1].endsWith('…'), 'the final line must show it was clipped');

		// A single word wider than the box has no space to wrap on, but with a
		// second line still free it is hard-split rather than ellipsised on the
		// spot — showing more of an identifier beats showing less of it while a
		// whole line sits empty underneath. Wide enough for both halves to fit
		// as-is, `ChangeRequestRejected` recovers fully across the two.
		const split = layoutLabel('ChangeRequestRejected', { maxWidth: 70, fontSize: 11, maxLines: 2 });
		assert.strictEqual(split.lines.length, 2, 'a second line is spent before an ellipsis is');
		assert.strictEqual(
			split.lines.join(''), 'ChangeRequestRejected',
			'the two lines are a straight split, so rejoining them recovers the original — nothing ' +
			'was cut when both lines were used to show it',
		);
		for (const line of split.lines) assert.ok(textWidth(line, 11) <= 70, `"${line}" must fit the box`);

		// A single word that still does not fit even split across every line
		// available is ellipsised on the last one — the general overflow case
		// hard-wrapping does not remove, only postpones past the extra line.
		const stillTooLong = layoutLabel('ChangeRequestRejectedAfterSecondaryReview', {
			maxWidth: 40, fontSize: 11, maxLines: 2,
		});
		assert.strictEqual(stillTooLong.lines.length, 2);
		assert.ok(stillTooLong.lines[1].endsWith('…'), 'what still does not fit is marked as cut');
		for (const line of stillTooLong.lines) assert.ok(textWidth(line, 11) <= 40);

		// One line is still enough when it is asked for: `maxLines: 1` must not
		// grow a second line under it regardless of how the word is shaped.
		assert.strictEqual(
			layoutLabel('ChangeRequestRejected', { maxWidth: 40, fontSize: 11, maxLines: 1 }).lines.length,
			1,
		);

		// An unnamed element reserves nothing, so an anonymous gateway is not
		// padded out for a caption it does not have.
		for (const nothing of [undefined, '', '   ']) {
			assert.deepStrictEqual(layoutLabel(nothing, { maxWidth: 80, fontSize: 11, maxLines: 2 }).lines, []);
			assert.strictEqual(outsideLabelBand(nothing), 0);
		}
		assert.ok(outsideLabelBand('Approved?') > 0);

		// A wide box does not make a long name unbounded: the cap is what stops one
		// verbose element setting the column width for the whole diagram.
		const long = 'ChangeRequestRejectedByDataStewardAfterReview';
		assert.ok(
			outsideLabelBox(long).width < textWidth(long, LABEL_FONT_SIZE),
			'a name below a shape is still capped',
		);

		// Inside a task the bound is the box, and the detail line gets the same one.
		assert.ok(taskLabelBox('Apply Changes Immediately', 100).lines.length >= 1);
		for (const line of taskLabelBox('Apply Changes Immediately', 100).lines) {
			assert.ok(textWidth(line, LABEL_FONT_SIZE) <= 100, 'a task label must fit its box');
		}
		assert.ok(taskDetailBox('ROLE_DATA_STEWARD', 100).lines.length >= 1);

		// The role that sent the tenant scan looking for this fix: a 100x80
		// task box has never had room for `ROLE_INITIATE_CHANGE_REQUEST` on one
		// line, and it was disappearing with no ellipsis at all — CSS draws
		// `.node-detail` in the editor font, which this module's single shared
		// ratio underestimated, so the ellipsised string was still wider than the
		// box `fitToContent` had already sized the viewBox to, and the excess was
		// clipped by the SVG viewport instead of by this module. Two lines at the
		// wider, monospace-tuned ratio both fixes the estimate and uses the
		// second line a task box already has.
		const role = taskDetailBox('ROLE_INITIATE_CHANGE_REQUEST', 120);
		assert.strictEqual(role.lines.length, 2, 'a role this long must use the second line, not vanish');
		assert.strictEqual(
			role.lines.join(''), 'ROLE_INITIATE_CHANGE_REQUEST',
			'both lines together must be the whole role, or the fix traded a silent clip for a silent cut',
		);

		// The two strings a shape shows come from here too, so the layout measures
		// exactly what the renderer draws.
		assert.strictEqual(nodeLabelText({ id: 'g1', name: undefined }), 'g1');
		assert.strictEqual(nodeLabelText({ id: 'g1', name: 'Approved?' }), 'Approved?');
		assert.strictEqual(
			nodeDetailText({ delegateClass: 'com.reltio.workflow.activiti.service.ChangeRequestApply' }),
			'ChangeRequestApply',
			'only the distinguishing tail of a delegate class fits a task box',
		);
		assert.strictEqual(
			nodeDetailText({ candidateGroups: 'ROLE_REVIEWER', delegateClass: 'x.Y' }),
			'ROLE_REVIEWER',
			'a role wins over a delegate: a user task has both and the role is the point',
		);
		assert.strictEqual(nodeDetailText({}), undefined);
	}

	// ── 19. A condition clears the gateway it leaves ─────────────────────────
	// The screenshot bug: ELK gives a fan-out gateway a stub segment a few units
	// long before the route turns, and a label anchored to the first segment is
	// drawn on top of the diamond.
	{
		assert.deepStrictEqual(
			edgeLabelAnchor([
				{ x: 0, y: 0 }, { x: 10, y: 0 },      // the stub
				{ x: 10, y: 100 },                     // the turn
				{ x: 210, y: 100 },                    // the long run
			]),
			{ x: 110, y: 100 },
			'the anchor must be the midpoint of the longest horizontal run, not of the first segment',
		);
		// A route that never runs level still gets a label somewhere sensible.
		assert.deepStrictEqual(
			edgeLabelAnchor([{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 0, y: 140 }]),
			{ x: 0, y: 90 },
		);
		assert.strictEqual(edgeLabelAnchor([{ x: 0, y: 0 }]), undefined, 'one point is not a segment');
		assert.strictEqual(edgeLabelAnchor([]), undefined);

		// And on real ELK output: the text as actually drawn touches no shape.
		const model = extractProcessModel(GATEWAY_FANOUT);
		const layout = await layoutProcess(model);
		const shapes = [...layout.bounds.values()];

		const conditional = model.flows.filter(f => f.condition);
		assert.ok(conditional.length >= 2, 'the fixture must fan out on conditions');

		for (const flow of conditional) {
			const points = layout.waypoints.get(flow.id);
			const placed = edgeLabel(flowLabelText(flow), points);
			assert.ok(placed, `${flow.id}: must have a label and somewhere to put it`);
			const { anchor, box } = placed;

			// Matches the renderer: centred on the anchor, lifted clear of the line.
			const text = {
				x: anchor.x - box.width / 2,
				y: anchor.y - 5 - box.height,
				width: box.width,
				height: box.height,
			};
			for (const shape of shapes) {
				assert.ok(
					disjoint(text, shape),
					`${flow.id}: its condition is drawn across a shape at ` +
					`(${Math.round(shape.x)},${Math.round(shape.y)})`,
				);
			}
		}
	}

	// ── 20. Nothing a viewer inks overlaps ───────────────────────────────────
	// Section 12 already pins that no two *shapes* collide, which stayed true the
	// whole time the captions between them were unreadable. This is the same
	// assertion over everything actually drawn: each shape together with the band
	// its caption occupies, and each condition where the renderer puts it.
	{
		for (const fixture of [GATEWAY_FANOUT, LONG_NAMES]) {
			const model = extractProcessModel(fixture);
			const layout = await layoutProcess(model);
			const inked = [];

			for (const node of model.nodes) {
				const bounds = layout.bounds.get(node.id);
				assert.ok(bounds, `${node.id} must be positioned`);
				// A task's caption is inside it; everything else carries one below,
				// which may also be wider than the shape it hangs under.
				if (node.shape === 'task') {
					inked.push({ id: node.id, ...bounds });
					continue;
				}
				const label = outsideLabelBox(nodeLabelText(node));
				const width = Math.max(bounds.width, label.width);
				inked.push({
					id: node.id,
					x: bounds.x + bounds.width / 2 - width / 2,
					y: bounds.y,
					width,
					height: bounds.height + outsideLabelBand(nodeLabelText(node)),
				});
			}

			for (const flow of model.flows) {
				const placed = edgeLabel(flowLabelText(flow), layout.waypoints.get(flow.id) ?? []);
				if (!placed) continue;
				const { anchor, box } = placed;
				// Mirrors the renderer: centred on the anchor, lifted off the line.
				inked.push({
					id: `${flow.id} (condition)`,
					x: anchor.x - box.width / 2,
					y: anchor.y - 5 - box.height,
					width: box.width,
					height: box.height,
				});
			}

			for (let i = 0; i < inked.length; i++) {
				for (let j = i + 1; j < inked.length; j++) {
					assert.ok(
						disjoint(inked[i], inked[j]),
						`${inked[i].id} and ${inked[j].id} overlap once labels are drawn`,
					);
				}
			}
		}
	}

	// ── 21. Inflation stays out of the file, and off the connectors ──────────
	{
		const model = extractProcessModel(LONG_NAMES);
		const layout = await layoutProcess(model);

		// The boxes handed to ELK are larger than the shapes, but a reader draws
		// whatever size it finds in the DI — so the DI must carry BPMN's defaults
		// or a 36-unit event is rendered as a 70-unit one.
		const section = await generateDiagramSection(LONG_NAMES);
		for (const node of model.nodes) {
			const expected = shapeSize(node.shape);
			assert.deepStrictEqual(
				{ width: layout.bounds.get(node.id).width, height: layout.bounds.get(node.id).height },
				expected,
				`${node.id}: label-aware layout must not change the size written out`,
			);
			assert.ok(
				new RegExp(`bpmnElement="${node.id}">\\s*<omgdc:Bounds [^/]*width="${expected.width}" height="${expected.height}"`)
					.test(section),
				`${node.id}: the serialized DI must carry its BPMN default size`,
			);
		}

		// Inflation is symmetric in height for exactly this reason: ELK attaches a
		// connector at its box's mid-height, so a box padded only downward would
		// have every edge arrive below the centre of the circle it points at.
		const TOLERANCE = 4;
		for (const flow of model.flows) {
			const points = layout.waypoints.get(flow.id);
			if (!points) continue;
			for (const [point, id] of [
				[points[0], flow.sourceRef],
				[points[points.length - 1], flow.targetRef],
			]) {
				const shape = layout.bounds.get(id);
				if (!shape) continue;
				assert.ok(
					point.x >= shape.x - TOLERANCE && point.x <= shape.x + shape.width + TOLERANCE &&
					point.y >= shape.y - TOLERANCE && point.y <= shape.y + shape.height + TOLERANCE,
					`${flow.id}: an endpoint at (${Math.round(point.x)},${Math.round(point.y)}) ` +
					`misses ${id} — the shape is not centred in its layout box`,
				);
			}
		}
	}

	// ── 22. A caption is sized by the run it sits on ─────────────────────────
	// The defect the tenant's own diagrams showed: sections 19 and 20 cover the
	// path where *we* lay the diagram out, and every definition fetched from a
	// tenant ships its own DI and takes the other one. There the run length is
	// whatever its author chose, and a caption sized against a constant instead
	// spilled across the gateway at one end and the task at the other.
	{
		// An 80-unit run between a gateway and the task beside it, which is the
		// ordinary spacing in a hand-drawn Reltio diagram.
		const run = [{ x: 410, y: 217 }, { x: 490, y: 217 }];
		const long = "${quorumDecision == 'Approve'}";

		const unbounded = edgeLabelBox(long);
		const fitted = edgeLabel(long, run);
		assert.ok(fitted, 'a run of eighty units is somewhere to put a caption');
		assert.ok(
			unbounded.width > 80,
			'the fixture must be a caption that genuinely does not fit, or this proves nothing',
		);
		assert.ok(
			fitted.box.width <= 80,
			`a caption on an 80-unit run must not be ${Math.round(fitted.box.width)} units wide`,
		);
		assert.ok(fitted.box.lines[0].endsWith('…'), 'what was cut must be marked as cut');

		// The same text on a long run keeps more of itself, so the clamp is
		// tracking the geometry rather than just truncating harder everywhere.
		const roomy = edgeLabel(long, [{ x: 0, y: 0 }, { x: 400, y: 0 }]);
		assert.ok(
			roomy.box.width > fitted.box.width,
			'a longer run must carry more of the caption',
		);

		// Centred on the anchor, it clears both ends of its own run.
		const half = fitted.box.width / 2;
		assert.ok(
			fitted.anchor.x - half >= run[0].x && fitted.anchor.x + half <= run[1].x,
			'the drawn text must stay between the two shapes the connector joins',
		);
	}

	// ── 23. A connector's caption is its name, its condition's value, or its
	//        condition — in that order ────────────────────────────────────────
	// Every BPMN tool captions a branch with its name, and on a diagram it is
	// the only one that reliably fits: `Approve` against
	// `${quorumDecision == 'Approve'}`. Most Reltio flows never get a `name`
	// though — this is what `twoStepDcrWithLoops`, a real workflow, looks like
	// without it, and why the value inside a simple equality is read back out
	// as if it had been.
	{
		const named = extractProcessModel(`<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <process id="p" isExecutable="true">
    <exclusiveGateway id="gw" name="Decision" default="unconditional" />
    <sequenceFlow id="yes" name="Approve" sourceRef="gw" targetRef="a">
      <conditionExpression><![CDATA[\${decision=='Approve'}]]></conditionExpression>
    </sequenceFlow>
    <sequenceFlow id="unconditional" sourceRef="gw" targetRef="b" />
    <sequenceFlow id="unnamed" sourceRef="gw" targetRef="c">
      <conditionExpression><![CDATA[\${decision == 'Other'}]]></conditionExpression>
    </sequenceFlow>
    <sequenceFlow id="doubleQuoted" sourceRef="gw" targetRef="a">
      <conditionExpression><![CDATA[\${decision=="Other"}]]></conditionExpression>
    </sequenceFlow>
    <sequenceFlow id="compound" sourceRef="gw" targetRef="a">
      <conditionExpression><![CDATA[\${decision=='Approve' && amount>1000}]]></conditionExpression>
    </sequenceFlow>
    <endEvent id="a" /><endEvent id="b" /><endEvent id="c" />
  </process>
</definitions>`);
		const byId = Object.fromEntries(named.flows.map(f => [f.id, f]));

		assert.strictEqual(byId.yes.name, 'Approve', 'the model must read a flow name');
		assert.strictEqual(
			flowLabelText(byId.yes), 'Approve',
			'the name wins over the condition — it is what the author called the branch',
		);
		assert.strictEqual(
			flowLabelText(byId.unnamed), 'Other',
			'a simple ${var == \'Value\'} condition with no name is captioned with its value — ' +
			'this is the shape real Reltio conditions actually take, and showing the full JUEL ' +
			'is what made "${decisi" the caption for every branch of a real workflow',
		);
		assert.strictEqual(
			flowLabelText(byId.doubleQuoted), 'Other',
			'double quotes must match the same as single quotes — both appear in the wild',
		);
		assert.strictEqual(
			flowLabelText(byId.compound), "${decision=='Approve' && amount>1000}",
			'a compound condition does not match the single-equality shape and must fall through ' +
			'to the full text rather than to an arbitrary half of it',
		);
		assert.strictEqual(
			flowLabelText(byId.unconditional), undefined,
			'an unconditional flow is left bare, not captioned with an empty string',
		);
	}

	// ── 24. A caption moves off a connector routed through it ────────────────
	// A gateway's name sits below the diamond by convention, which is also
	// exactly where its downward branch is routed: `Quorum Decision` was drawn
	// with the reject connector running through the words. The caption is wider
	// than the 36-unit shape, so this is the normal case for a vertical fan-out,
	// not a near miss.
	{
		const diamond = { x: 370, y: 197, width: 40, height: 40 };
		const name = 'Quorum Decision';
		const below = diamond.y + diamond.height + 4;

		assert.strictEqual(
			outsideLabelTop(diamond, name, []), below,
			'with nothing in the way the conventional position is kept',
		);

		// The reject branch, leaving the gateway downward and turning right.
		const downward = [[{ x: 390, y: 237 }, { x: 390, y: 287 }, { x: 480, y: 287 }]];
		const moved = outsideLabelTop(diamond, name, downward);
		assert.ok(moved < diamond.y, `the caption must move above the shape, got ${moved}`);

		// A gateway that fans out both ways has no clear side, so it keeps the
		// conventional one rather than trading one collision for another.
		const bothWays = [...downward, [{ x: 390, y: 197 }, { x: 390, y: 147 }, { x: 480, y: 147 }]];
		assert.strictEqual(
			outsideLabelTop(diamond, name, bothWays), below,
			'flipping is only worth doing when the other side is actually clear',
		);

		// An unnamed element has no caption to place and must not be padded.
		assert.strictEqual(outsideLabelTop(diamond, undefined, downward), below);
	}

	// ── 15. The viewer is wired end to end ──────────────────────────────────
	{
		const pkg = JSON.parse(read('package.json'));
		const command = 'reltio.previewWorkflowDiagram';

		assert.ok(
			pkg.contributes.commands.some(c => c.command === command),
			`${command} must be declared in contributes.commands`,
		);

		const menus = Object.entries(pkg.contributes.menus)
			.flatMap(([id, items]) => items.filter(i => i.command === command).map(i => ({ id, ...i })));
		assert.ok(menus.length > 0, `${command} must be reachable from a menu`);
		for (const item of menus) {
			assert.ok(item.when, `${command} in ${item.id} must carry a when clause`);
			if (item.id === 'view/item/context') {
				assert.ok(
					item.when.includes('view == reltioConfigTree'),
					`${command} must be scoped to this extension's tree`,
				);
			}
		}

		// Declared and menu-placed but unregistered fails only at click time.
		const extensionSource = read('src/extension.ts');
		assert.ok(
			extensionSource.includes(`registerCommand(\n\t\t\t'${command}'`) ||
			extensionSource.includes(`'${command}'`),
			`${command} must be registered in src/extension.ts`,
		);
		assert.ok(
			new RegExp(`registerCommand\\(\\s*'${command.replace('.', '\\.')}'`).test(extensionSource),
			`${command} must be passed to vscode.commands.registerCommand`,
		);

		// The webview bundle needs its own esbuild target, or the panel loads a
		// script that does not exist and renders blank with no error.
		assert.ok(pkg.scripts['build:bpmnview'], 'the viewer needs an esbuild target');
		assert.ok(
			pkg.scripts.build.includes('build:bpmnview'),
			'build must invoke the viewer target, or the VSIX ships without it',
		);
		assert.ok(
			pkg.scripts['build:bpmnview'].includes('bpmnView.css'),
			'the stylesheet must be copied alongside the bundle',
		);
	}

	// ── 16a. A header names the process the panel is showing ─────────────────
	// The panel's tab title carries the file name, but a tab title is the first
	// thing elided once two panels sit side by side — the process's own display
	// name, which is what a reviewer actually recognises, needs a place that
	// survives that.
	{
		const html = read('src/workflow/bpmnPanel.ts');
		assert.ok(html.includes('id="diagram-header"'), 'the HTML must carry a header element');
		assert.ok(html.includes('id="diagram-header-name"'), 'and somewhere in it to put the process name');
		assert.ok(html.includes('id="diagram-header-id"'), 'and the process id beside it');

		const view = read('src/webview/bpmnView.ts');
		assert.ok(
			/headerNameEl\.textContent\s*=\s*diagram\.processName/.test(view),
			'the script must set the header from the diagram payload, not leave it static markup',
		);
		assert.ok(
			/headerEl\.hidden\s*=\s*true/.test(view),
			'a null diagram must hide the header rather than show a stale or empty one',
		);

		const css = read('src/webview/bpmnView.css');
		assert.ok(css.includes('#diagram-header'), 'the header needs its own styling, not inherited defaults');
	}

	// ── 16. Webview safety ──────────────────────────────────────────────────
	{
		const view = read('src/webview/bpmnView.ts');
		assert.ok(
			view.includes('isTrustedMessageOrigin'),
			'every incoming message must have its origin checked',
		);
		// Matches an assignment, not the word: the file names `innerHTML` in a
		// comment explaining why it is not used, and a substring check would
		// fail on the documentation of its own safety property.
		assert.ok(
			!/\.\s*innerHTML\s*=/.test(view) && !/insertAdjacentHTML/.test(view),
			'document-derived text must never reach innerHTML — use textContent',
		);

		const panel = read('src/workflow/bpmnPanel.ts');
		assert.ok(panel.includes('localResourceRoots'), 'the webview must be restricted to dist/');
		assert.ok(panel.includes("default-src 'none'"), 'the CSP must deny by default');
		assert.ok(panel.includes(`'nonce-`), 'scripts must be nonce-gated');
		assert.ok(
			!/script-src[^;]*unsafe-inline/.test(panel),
			'the CSP must not allow unsafe-inline scripts',
		);
	}

	// ── 17. Registered in the runner ────────────────────────────────────────
	{
		const runner = read('scripts/run-unit-tests.cjs');
		assert.ok(
			runner.includes("'test-workflow-bpmn-diagram.cjs'"),
			'this script must be listed in run-unit-tests.cjs — the runner is not a glob',
		);
	}

	// Sanity: the unescape helper reverses the five escapes, `&amp;` last.
	assert.strictEqual(unescapeXml('&amp;lt;'), '&lt;', 'double-unescaping must not happen');
	assert.strictEqual(unescapeXml('&lt;a&gt; &quot;b&quot; &apos;c&apos; &amp;'), `<a> "b" 'c' &`);

	console.log('test-workflow-bpmn-diagram: OK');
})().catch(e => {
	console.error(e);
	process.exit(1);
});
