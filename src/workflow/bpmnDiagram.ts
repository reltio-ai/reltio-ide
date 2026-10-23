/**
 * Diagram interchange (DI) for BPMN documents — the `<bpmndi:BPMNDiagram>`
 * section that says where each shape sits.
 *
 * Why this exists: the Activiti engine executes a process perfectly well without
 * DI, so the original skeleton emitted none. But DI is not decoration — it is
 * the only thing any viewer reads. Camunda Modeler, the Reltio console, the
 * bpmn.io-based VS Code extensions and this extension's own preview all draw the
 * coordinates in this section and nothing else. A document without it opens as a
 * blank canvas everywhere, which made every IDE-authored workflow invisible to
 * the people who had to review it.
 *
 * Everything here is pure and synchronous, and takes positions as an argument.
 * That is what lets the two callers differ: the draft skeleton has a fixed
 * topology whose layout is known at author time (`layoutChain`), while an
 * arbitrary document needs a layout engine (`bpmnLayout.ts`, which is async and
 * pulls in `elkjs`). Keeping the serializer on this side of that line means the
 * draft-creation path never loads a layout engine, and the unit tests can assert
 * the emitted XML byte for byte without one.
 */
import type { BpmnFlowNode, BpmnNodeShape, BpmnProcessModel } from './bpmnModel';

/**
 * Shape sizes, in the units every BPMN tool treats as pixels.
 *
 * These are the BPMN 2.0 defaults a modeller produces, not arbitrary choices: an
 * event is a 36-unit circle, a gateway a 50-unit diamond, a task a 100x80
 * rectangle. Matching them is what makes a generated diagram look like a
 * hand-drawn one when it is opened in Camunda Modeler.
 */
export const SHAPE_SIZES: Readonly<Record<BpmnNodeShape, { width: number; height: number }>> = {
	event: { width: 36, height: 36 },
	gateway: { width: 50, height: 50 },
	task: { width: 100, height: 80 },
};

export interface Bounds {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface Point {
	readonly x: number;
	readonly y: number;
}

/** Positions for one process: a box per node id, a polyline per flow id. */
export interface DiagramLayout {
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly waypoints: ReadonlyMap<string, readonly Point[]>;
}

export function shapeSize(shape: BpmnNodeShape): { width: number; height: number } {
	return SHAPE_SIZES[shape];
}

// ─── Serialization ───────────────────────────────────────────────────────────

/** Escape the five characters that matter inside an XML attribute value. */
function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

/** Coordinates are written as integers; a viewer gains nothing from sub-pixels. */
function round(value: number): number {
	return Math.round(value);
}

/**
 * Serialize a `<bpmndi:BPMNDiagram>` section for one process.
 *
 * Shapes are emitted before edges because that is the order a modeller writes
 * and some readers rely on a shape existing before an edge references it.
 * Elements without positions are skipped rather than emitted at the origin,
 * where they would stack invisibly on top of each other in the top-left corner.
 */
export function renderDiagramSection(
	processId: string,
	model: BpmnProcessModel,
	layout: DiagramLayout,
): string {
	const lines: string[] = [];
	lines.push('  <bpmndi:BPMNDiagram id="BPMNDiagram_1">');
	lines.push(`    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${escapeXml(processId)}">`);

	for (const node of model.nodes) {
		const bounds = layout.bounds.get(node.id);
		if (!bounds) continue;
		const id = escapeXml(node.id);
		lines.push(`      <bpmndi:BPMNShape id="BPMNShape_${id}" bpmnElement="${id}">`);
		lines.push(
			`        <omgdc:Bounds x="${round(bounds.x)}" y="${round(bounds.y)}" ` +
			`width="${round(bounds.width)}" height="${round(bounds.height)}" />`,
		);
		lines.push('      </bpmndi:BPMNShape>');
	}

	for (const flow of model.flows) {
		if (!flow.id) continue;
		const points = layout.waypoints.get(flow.id);
		// Two points is the minimum a polyline can be; one is not an edge.
		if (!points || points.length < 2) continue;
		const id = escapeXml(flow.id);
		lines.push(`      <bpmndi:BPMNEdge id="BPMNEdge_${id}" bpmnElement="${id}">`);
		for (const point of points) {
			lines.push(`        <omgdi:waypoint x="${round(point.x)}" y="${round(point.y)}" />`);
		}
		lines.push('      </bpmndi:BPMNEdge>');
	}

	lines.push('    </bpmndi:BPMNPlane>');
	lines.push('  </bpmndi:BPMNDiagram>');
	return lines.join('\n');
}

/**
 * Insert or replace a document's diagram section, immediately before the
 * closing `</definitions>`.
 *
 * DI must sit outside `<process>` and inside `<definitions>`; putting it inside
 * the process is rejected by schema-aware readers. Returns the document
 * unchanged when there is no `</definitions>` to anchor to, rather than
 * appending a section that would sit outside the root element.
 */
export function withDiagramSection(xml: string, section: string): string {
	const stripped = xml.replace(
		new RegExp(String.raw`[^\S\r\n]*<(?:[\w.-]+:)?BPMNDiagram\b[\s\S]*?<\/(?:[\w.-]+:)?BPMNDiagram>\r?\n?`, 'gi'),
		'',
	);
	const closing = /<\/(?:[\w.-]+:)?definitions\s*>/.exec(stripped);
	if (!closing) return stripped;
	return withDiagramNamespaces(
		stripped.slice(0, closing.index) +
		`${section}\n` +
		stripped.slice(closing.index),
	);
}

const DIAGRAM_NAMESPACES: ReadonlyArray<readonly [string, string]> = [
	['bpmndi', 'http://www.omg.org/spec/BPMN/20100524/DI'],
	['omgdc', 'http://www.omg.org/spec/DD/20100524/DC'],
	['omgdi', 'http://www.omg.org/spec/DD/20100524/DI'],
];

/**
 * Declare `bpmndi`, `omgdc` and `omgdi` on the root `<definitions>` when it does not already bind
 * those prefixes. An older skeleton carries four declarations, so inserting diagram elements without
 * this leaves unbound prefixes and the file no longer parses as XML.
 */
function withDiagramNamespaces(xml: string): string {
	const root = /<((?:[\w.-]+:)?definitions)\b([^>]*)>/.exec(xml);
	if (!root) return xml;
	const attrs = root[2];
	const missing = DIAGRAM_NAMESPACES.filter(
		([prefix]) => !new RegExp(String.raw`\sxmlns:${prefix}\s*=`).test(attrs),
	);
	if (missing.length === 0) return xml;
	const selfClosing = attrs.endsWith('/');
	const body = (selfClosing ? attrs.slice(0, -1) : attrs).replace(/\s+$/, '');
	const indent = /\n([ \t]*)xmlns/.exec(body)?.[1];
	const sep = indent === undefined ? ' ' : `\n${indent}`;
	const added = missing.map(([prefix, uri]) => `${sep}xmlns:${prefix}="${uri}"`).join('');
	const open = `<${root[1]}${body}${added}${selfClosing ? ' /' : ''}>`;
	return xml.slice(0, root.index) + open + xml.slice(root.index + root[0].length);
}

// ─── Reading an existing diagram ─────────────────────────────────────────────

/** `<bpmndi:BPMNShape … bpmnElement="…"> … <omgdc:Bounds …/>` in one match. */
const SHAPE_WITH_BOUNDS_SOURCE = String.raw`<(?:[\w.-]+:)?BPMNShape\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?BPMNShape>`;
/** A shape written self-closing cannot carry bounds, so only the paired form is read. */
const BOUNDS_SOURCE = String.raw`<(?:[\w.-]+:)?Bounds\b([^>]*)\/?>`;
const EDGE_SOURCE = String.raw`<(?:[\w.-]+:)?BPMNEdge\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?BPMNEdge>`;
const WAYPOINT_SOURCE = String.raw`<(?:[\w.-]+:)?waypoint\b([^>]*)\/?>`;

function numericAttribute(tagBody: string, name: string): number | undefined {
	const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tagBody);
	const raw = match?.[1] ?? match?.[2];
	if (raw === undefined) return undefined;
	const value = Number.parseFloat(raw);
	return Number.isFinite(value) ? value : undefined;
}

function stringAttribute(tagBody: string, name: string): string | undefined {
	const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tagBody);
	return match?.[1] ?? match?.[2];
}

/**
 * Read the positions out of a document that already carries a diagram section.
 *
 * This is what makes a definition fetched from a tenant render the way its
 * author laid it out, rather than being silently re-laid-out on the way to the
 * screen. A viewer that quietly rearranges someone's diagram is reporting
 * something other than what is deployed.
 *
 * Tolerant throughout: a shape without bounds, or bounds without an `x`, is
 * skipped rather than defaulted to zero, because a shape at the origin is
 * indistinguishable from a rendering bug. The caller decides what to do about
 * incomplete coverage — see `isCompleteFor`.
 */
export function readDiagramLayout(xml: string): DiagramLayout {
	const bounds = new Map<string, Bounds>();
	const waypoints = new Map<string, readonly Point[]>();

	const shapes = new RegExp(SHAPE_WITH_BOUNDS_SOURCE, 'gi');
	let shape: RegExpExecArray | null;
	while ((shape = shapes.exec(xml)) !== null) {
		const element = stringAttribute(shape[1] ?? '', 'bpmnElement');
		if (!element) continue;
		const boundsTag = new RegExp(BOUNDS_SOURCE, 'i').exec(shape[2] ?? '');
		if (!boundsTag) continue;
		const body = boundsTag[1] ?? '';
		const x = numericAttribute(body, 'x');
		const y = numericAttribute(body, 'y');
		const width = numericAttribute(body, 'width');
		const height = numericAttribute(body, 'height');
		if (x === undefined || y === undefined || width === undefined || height === undefined) continue;
		bounds.set(element, { x, y, width, height });
	}

	const edges = new RegExp(EDGE_SOURCE, 'gi');
	let edge: RegExpExecArray | null;
	while ((edge = edges.exec(xml)) !== null) {
		const element = stringAttribute(edge[1] ?? '', 'bpmnElement');
		if (!element) continue;
		const points: Point[] = [];
		const wp = new RegExp(WAYPOINT_SOURCE, 'gi');
		let point: RegExpExecArray | null;
		while ((point = wp.exec(edge[2] ?? '')) !== null) {
			const body = point[1] ?? '';
			const x = numericAttribute(body, 'x');
			const y = numericAttribute(body, 'y');
			if (x === undefined || y === undefined) continue;
			points.push({ x, y });
		}
		if (points.length >= 2) waypoints.set(element, points);
	}

	return { bounds, waypoints };
}

/** The document's first `<bpmndi:BPMNPlane>` opening tag, with its `bpmnElement`. */
const PLANE_TAG_SOURCE = String.raw`<(?:[\w.-]+:)?BPMNPlane\b([^>]*)>`;

/**
 * Which process the diagram claims to describe.
 *
 * Worth reading separately from the shapes because getting it wrong is silent and
 * total: a plane whose `bpmnElement` names an id that is not in the file renders
 * nothing at all, no matter how correct every shape under it is. That is the
 * failure mode of a definition that was copied and re-identified.
 */
export function readPlaneElement(xml: string): string | undefined {
	const plane = new RegExp(PLANE_TAG_SOURCE, 'i').exec(xml);
	return plane ? stringAttribute(plane[1] ?? '', 'bpmnElement') : undefined;
}

/**
 * Whether a layout positions every node in the model.
 *
 * Partial DI is worse than none: the shapes it does cover look right, so the
 * missing ones read as elements that are not in the workflow at all. When
 * coverage is incomplete the caller computes a fresh layout for the whole
 * diagram instead of mixing the two.
 */
export function isCompleteFor(layout: DiagramLayout, model: BpmnProcessModel): boolean {
	return model.nodes.length > 0 && model.nodes.every(node => layout.bounds.has(node.id));
}

// ─── Fixed layouts ───────────────────────────────────────────────────────────

/**
 * Lay a straight chain out left to right on one axis.
 *
 * Used for the draft skeleton, whose topology is fixed and known, so it needs no
 * layout engine and its DI can be produced by a pure synchronous function.
 * Vertical centres are aligned across differently-sized shapes, which is what
 * makes the connectors horizontal.
 */
export function layoutChain(
	nodes: readonly BpmnFlowNode[],
	flows: readonly { id: string | undefined; sourceRef: string | undefined }[],
	options: { startX?: number; centreY?: number; gap?: number } = {},
): DiagramLayout {
	const startX = options.startX ?? 150;
	const centreY = options.centreY ?? 118;
	const gap = options.gap ?? 60;

	const bounds = new Map<string, Bounds>();
	let cursorX = startX;
	for (const node of nodes) {
		const { width, height } = shapeSize(node.shape);
		bounds.set(node.id, { x: cursorX, y: centreY - height / 2, width, height });
		cursorX += width + gap;
	}

	const waypoints = new Map<string, readonly Point[]>();
	for (const flow of flows) {
		if (!flow.id || !flow.sourceRef) continue;
		const from = bounds.get(flow.sourceRef);
		const toId = nodes[nodes.findIndex(node => node.id === flow.sourceRef) + 1]?.id;
		const to = toId ? bounds.get(toId) : undefined;
		if (!from || !to) continue;
		waypoints.set(flow.id, [
			{ x: from.x + from.width, y: centreY },
			{ x: to.x, y: centreY },
		]);
	}

	return { bounds, waypoints };
}
