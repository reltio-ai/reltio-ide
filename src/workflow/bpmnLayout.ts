/**
 * Graph layout for BPMN documents whose topology is not known in advance.
 *
 * Split from `bpmnDiagram.ts` so that the draft-creation path, whose topology
 * *is* known, never pulls in a layout engine — and so the serializer's unit
 * tests do not need one either. Everything here is async because `elkjs` is.
 *
 * `elkjs` is already a dependency of this extension, configured for exactly this
 * kind of graph in `src/ontology/elkLayout.ts`. No new dependency was needed to
 * lay out a process, which is the main reason a BPMN viewer could be built in
 * house rather than bundling one.
 */
import ELK from 'elkjs/lib/elk.bundled.js';
import type { BpmnFlowNode, BpmnProcessModel } from './bpmnModel';
import { extractProcessModel } from './bpmnModel';
import {
	renderDiagramSection,
	shapeSize,
	withDiagramSection,
	type Bounds,
	type DiagramLayout,
	type Point,
} from './bpmnDiagram';
import {
	OUTSIDE_LABEL_GAP,
	edgeLabelBox,
	flowLabelText,
	nodeLabelText,
	outsideLabelBox,
} from './bpmnLabels';

const elk = new ELK();

/**
 * The subset of ELK's result this module reads.
 *
 * Declared locally rather than imported: `elkjs` ships its types through a
 * bundled JS entry point, and naming its edge-section interface would couple
 * this file to a detail of that package's typings. Every field is optional
 * because ELK omits whatever it did not compute.
 */
interface ElkLaidOut {
	children?: { id?: string; x?: number; y?: number; width?: number; height?: number }[];
	edges?: {
		id?: string;
		sections?: {
			startPoint?: Point;
			endPoint?: Point;
			bendPoints?: Point[];
		}[];
	}[];
}

/** A flow with both endpoints resolved — the only kind ELK can be given. */
interface RoutableFlow {
	readonly id: string;
	readonly sourceRef: string;
	readonly targetRef: string;
	/** The caption, when there is one, so ELK can leave room for it. */
	readonly label: string | undefined;
}

/**
 * Keep only the flows whose endpoints name real nodes.
 *
 * An edge referencing a missing node is a validation finding (deferred to V2),
 * but handing one to ELK turns it into a thrown exception that would take the
 * entire diagram down. Dropping it degrades to a diagram with one connector
 * missing, which is both visible to the user and survivable.
 */
function routableFlows(model: BpmnProcessModel): RoutableFlow[] {
	const nodeIds = new Set(model.nodes.map(node => node.id));
	const routable: RoutableFlow[] = [];
	for (const flow of model.flows) {
		const { id, sourceRef, targetRef } = flow;
		if (!id || !sourceRef || !targetRef) continue;
		if (!nodeIds.has(sourceRef) || !nodeIds.has(targetRef)) continue;
		// The same caption the renderer will draw. Reserving room for the raw
		// condition when a short name is what gets drawn spreads the diagram out
		// for text that never appears.
		routable.push({ id, sourceRef, targetRef, label: flowLabelText(flow) });
	}
	return routable;
}

/**
 * The box ELK is given for a node, which is not the shape drawn inside it.
 *
 * An event's or a gateway's name is drawn *below* the shape, and ELK cannot see
 * that when it is handed a bare 36x36 circle: it packs the next row a spacing
 * apart from the circle, the caption is then drawn into that gap, and the
 * diagram reads as text lying across shapes. So the box is inflated to cover the
 * caption, and only the shape's true size is recorded afterwards — the DI in the
 * file has to stay at BPMN's default sizes or Camunda draws a 36-unit event as a
 * 70-unit one.
 *
 * Height is inflated symmetrically even though the caption sits only below it:
 * ELK attaches connectors at the box's mid-height, so a box padded downward
 * alone would have every edge arrive below the centre of the circle it points
 * at.
 */
function layoutBox(node: BpmnFlowNode): { width: number; height: number } {
	const size = shapeSize(node.shape);
	// A task's name is drawn inside it, so its shape is already its box.
	if (node.shape === 'task') return size;

	const label = outsideLabelBox(nodeLabelText(node));
	if (label.height === 0) return size;

	const band = OUTSIDE_LABEL_GAP + label.height;
	return {
		width: Math.max(size.width, label.width),
		height: size.height + band * 2,
	};
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(Math.max(value, low), high);
}

/**
 * Gap, in diagram units, between a boundary event's own edge and its host task's border.
 * Matches `elk.spacing.edgeNode` below in spirit — close enough to read as "attached", far
 * enough that the event's own border does not overlap the task's.
 */
const BOUNDARY_EVENT_OFFSET = 6;

/**
 * Where a boundary event sits once its host task has a position: centred on the task's
 * bottom-right corner, the conventional BPMN placement, offset outward by `BOUNDARY_EVENT_OFFSET`
 * so its circle reads as sitting *on* the border rather than straddling it exactly.
 *
 * Laid out this way, rather than handed to ELK as an ordinary node, because ELK has no concept of
 * "attached to" — it would place a boundary event as a free-floating node wherever the layered
 * algorithm finds room, which is almost never on the border of the task it actually belongs to.
 *
 * `index` spaces out a second (or third) boundary event on the same task leftward along the
 * bottom edge, by one event-width-plus-gap each — rare in practice, but the alternative of
 * stacking every sibling at the exact same point would hide all but the last one drawn.
 */
function boundaryEventBounds(
	host: Bounds,
	size: { width: number; height: number },
	index: number,
): Bounds {
	const spacing = size.width + BOUNDARY_EVENT_OFFSET;
	return {
		x: host.x + host.width - size.width / 2 + BOUNDARY_EVENT_OFFSET - index * spacing,
		y: host.y + host.height - size.height / 2 + BOUNDARY_EVENT_OFFSET,
		width: size.width,
		height: size.height,
	};
}

/**
 * Pull one end of a route back onto the shape it connects to.
 *
 * ELK routes to the boxes it was given, and `layoutBox` made those larger than
 * the shapes drawn inside them. Left alone the connector stops where the
 * caption's reserved band ends rather than where the circle is, which draws as
 * an arrow pointing at empty space beside the element.
 *
 * `elk.direction: RIGHT` puts every port on a box's east or west side, so both
 * terminal segments run level. That is what makes this safe rather than a
 * reroute: moving the outer point's `x` keeps the segment level, and moving the
 * shared `y` of *both* of the segment's points keeps the next segment — which is
 * vertical — vertical. A terminal segment that is not level is left alone, since
 * there is no such move for it.
 */
function snapToShape(points: readonly Point[], shape: Bounds, atStart: boolean): Point[] {
	const outer = atStart ? 0 : points.length - 1;
	const inner = atStart ? 1 : points.length - 2;
	const from = points[outer];
	const to = points[inner];
	if (!from || !to || Math.abs(from.y - to.y) > 1) return [...points];

	const y = clamp(from.y, shape.y, shape.y + shape.height);
	// Whichever vertical edge of the shape this end already sits nearer to.
	const x = from.x <= shape.x + shape.width / 2 ? shape.x : shape.x + shape.width;

	const snapped = [...points];
	snapped[outer] = { x, y };
	snapped[inner] = { x: to.x, y };
	return snapped;
}

/**
 * One edge, with its condition declared as a label.
 *
 * An unlabelled edge is routed as close to its neighbour as spacing allows, and
 * the condition text is then drawn onto that neighbour. Declaring the label
 * makes the layered algorithm reserve a lane for it instead.
 */
function elkEdge(flow: RoutableFlow): {
	id: string;
	sources: string[];
	targets: string[];
	labels: { id: string; text: string; width: number; height: number }[];
} {
	const label = edgeLabelBox(flow.label);
	return {
		id: flow.id,
		sources: [flow.sourceRef],
		targets: [flow.targetRef],
		labels:
			label.height === 0
				? []
				: [
						{
							id: `${flow.id}__label`,
							text: label.lines.join(' '),
							width: label.width,
							height: label.height,
						},
					],
	};
}

/**
 * Compute positions for an arbitrary process.
 *
 * `RIGHT` rather than the ontology view's `DOWN`: a process diagram is read left
 * to right, and one that flows downward looks wrong in a modeller even when the
 * coordinates are valid. `ORTHOGONAL` matches BPMN's right-angled connectors.
 */
export async function layoutProcess(model: BpmnProcessModel): Promise<DiagramLayout> {
	const bounds = new Map<string, Bounds>();
	const waypoints = new Map<string, readonly Point[]>();
	if (model.nodes.length === 0) return { bounds, waypoints };

	const flows = routableFlows(model);

	// A boundary event is excluded from ELK's own graph only when its host actually resolves to
	// another node in this process — see `boundaryEventBounds()`'s doc comment for why ELK is the
	// wrong tool for positioning it at all. An unresolved `attachedToRef` (missing attribute, or
	// naming a node that is not in this process) falls back to being handed to ELK like any other
	// node, so it still gets *a* position instead of silently vanishing from the diagram.
	const nonBoundaryIds = new Set(model.nodes.filter(n => n.tag !== 'boundaryEvent').map(n => n.id));
	const attachedBoundaryEvents = model.nodes.filter(
		n => n.tag === 'boundaryEvent' && n.attachedToRef !== undefined && nonBoundaryIds.has(n.attachedToRef),
	);
	const attachedIds = new Set(attachedBoundaryEvents.map(n => n.id));
	const elkNodes = model.nodes.filter(n => !attachedIds.has(n.id));
	// Flows into/out of an attached boundary event are excluded the same way: ELK was never given
	// the node, so an edge naming it would be the "endpoint not in the graph" exception
	// `routableFlows()`'s own doc comment already protects against for a missing node. These are
	// picked up by the straight-line fallback near the end of this function instead, same as any
	// other edge ELK declines to route.
	const elkFlows = flows.filter(f => !attachedIds.has(f.sourceRef) && !attachedIds.has(f.targetRef));

	const laid = (await elk.layout({
		id: 'root',
		layoutOptions: {
			'elk.algorithm': 'layered',
			'elk.direction': 'RIGHT',
			'elk.edgeRouting': 'ORTHOGONAL',
			// Spacing is measured between the boxes `layoutBox` produces, and those
			// already contain their own captions, so these are clearances between
			// drawn things rather than between shapes with text hanging out of them.
			'elk.spacing.nodeNode': '60',
			'elk.spacing.edgeNode': '30',
			'elk.spacing.edgeLabel': '6',
			'elk.layered.spacing.nodeNodeBetweenLayers': '80',
			'elk.layered.spacing.edgeNodeBetweenLayers': '30',
			'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
		},
		children: elkNodes.map(node => ({ id: node.id, ...layoutBox(node) })),
		edges: elkFlows.map(elkEdge),
	})) as ElkLaidOut;

	const shapes = new Map(model.nodes.map(node => [node.id, node.shape]));

	for (const child of laid.children ?? []) {
		if (!child.id) continue;
		const shape = shapes.get(child.id);
		if (!shape) continue;
		const size = shapeSize(shape);
		// Centre the shape in the box it was laid out in, and record the shape
		// rather than the box. The inflation in `layoutBox` exists only to reserve
		// room for text; writing it out would put the wrong size in the DI, and
		// every reader of that file draws the size it finds.
		bounds.set(child.id, {
			x: (child.x ?? 0) + ((child.width ?? size.width) - size.width) / 2,
			y: (child.y ?? 0) + ((child.height ?? size.height) - size.height) / 2,
			width: size.width,
			height: size.height,
		});
	}

	// Now that every host task has a position, place each attached boundary event relative to it.
	// Grouped by host first so two siblings on the same task are spread out rather than stacked.
	const boundariesByHost = new Map<string, BpmnFlowNode[]>();
	for (const boundary of attachedBoundaryEvents) {
		const hostId = boundary.attachedToRef as string;
		const siblings = boundariesByHost.get(hostId) ?? [];
		siblings.push(boundary);
		boundariesByHost.set(hostId, siblings);
	}
	for (const [hostId, siblings] of boundariesByHost) {
		const host = bounds.get(hostId);
		if (!host) continue;
		siblings.forEach((boundary, index) => {
			bounds.set(boundary.id, boundaryEventBounds(host, shapeSize(boundary.shape), index));
		});
	}

	const endpoints = new Map(flows.map(flow => [flow.id, flow]));

	for (const edge of laid.edges ?? []) {
		if (!edge.id) continue;
		const section = edge.sections?.[0];
		if (!section?.startPoint || !section.endPoint) continue;

		let points: Point[] = [
			section.startPoint,
			...(section.bendPoints ?? []),
			section.endPoint,
		];
		// The route ELK returned connects the inflated boxes; the diagram shows the
		// shapes inside them, so both ends move in to meet what is actually drawn.
		const flow = endpoints.get(edge.id);
		const source = flow && bounds.get(flow.sourceRef);
		const target = flow && bounds.get(flow.targetRef);
		if (source) points = snapToShape(points, source, true);
		if (target) points = snapToShape(points, target, false);

		waypoints.set(edge.id, points);
	}

	// ELK can place both endpoints and still decline to route between them. A
	// straight line from one box edge to the other is a worse diagram than an
	// orthogonal route, and a much better one than a missing connector.
	for (const flow of flows) {
		if (waypoints.has(flow.id)) continue;
		const from = bounds.get(flow.sourceRef);
		const to = bounds.get(flow.targetRef);
		if (!from || !to) continue;
		waypoints.set(flow.id, [
			{ x: from.x + from.width, y: from.y + from.height / 2 },
			{ x: to.x, y: to.y + to.height / 2 },
		]);
	}

	return { bounds, waypoints };
}

/**
 * Produce a diagram section for a document.
 *
 * Returns `undefined` when there is nothing to draw — no process id, or no flow
 * nodes — so a caller can leave the document untouched rather than write an
 * empty plane, which readers report as a corrupt diagram.
 */
export async function generateDiagramSection(xml: string): Promise<string | undefined> {
	const model = extractProcessModel(xml);
	if (!model.processId || model.nodes.length === 0) return undefined;
	const layout = await layoutProcess(model);
	return renderDiagramSection(model.processId, model, layout);
}

/**
 * Give a document a diagram section, replacing any section already present.
 *
 * Callers decide whether replacing is appropriate: `hasDiagramSection()` exists
 * so that a definition fetched from a tenant — laid out by whoever authored it —
 * is left alone rather than silently re-laid-out on the way past.
 */
export async function withGeneratedDiagram(xml: string): Promise<string> {
	const section = await generateDiagramSection(xml);
	return section ? withDiagramSection(xml, section) : xml;
}
