/**
 * Browser-side renderer for the BPMN diagram preview.
 *
 * Bundled separately as an IIFE (`dist/bpmnView.js`), like `ontologyView.ts`.
 * Draws SVG from coordinates the host has already resolved — this file contains
 * no layout logic and no XML handling, so the only thing that can be wrong here
 * is the drawing.
 *
 * Five shapes cover what Reltio's engine supports: a circle for events, a
 * diamond for gateways, a rounded rectangle for tasks, a polyline with an
 * arrowhead for flows, and a text label. `bpmn-rules.md` §9 lists two supported
 * topologies, so this is not a subset of BPMN so much as the whole of the part
 * that can be deployed.
 */
import { isTrustedMessageOrigin } from '../ontology/webviewMessageSafety';
import {
	DETAIL_FONT_SIZE,
	LABEL_FONT_SIZE,
	edgeLabel,
	lineHeight,
	outsideLabelBand,
	outsideLabelBox,
	outsideLabelTop,
	taskDetailBox,
	taskLabelBox,
	type LabelBox,
} from '../workflow/bpmnLabels';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

const vscode = acquireVsCodeApi();
const NS = 'http://www.w3.org/2000/svg';

/**
 * Captured once, as this script starts inside its own webview. VS Code assigns
 * each panel a random `vscode-webview://<uuid>` origin, so there is nothing to
 * hardcode; every incoming message is checked against this before it is read.
 * Same control as `ontologyView.ts`.
 */
const trustedOrigin = window.origin;

/** Padding around the content when fitting the viewBox. */
const FIT_MARGIN = 40;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
/** Clearance between a connector and the condition text sitting above it. */
const EDGE_LABEL_LIFT = 5;

interface Point {
	x: number;
	y: number;
}

interface DiagramNode extends Point {
	id: string;
	label: string;
	shape: 'event' | 'gateway' | 'task';
	tag: string;
	detail?: string;
	offset: number;
	width: number;
	height: number;
}

interface DiagramEdge {
	id: string;
	label?: string;
	points: Point[];
}

interface Diagram {
	processId: string;
	processName?: string;
	nodes: DiagramNode[];
	edges: DiagramEdge[];
	fromDiagramSection: boolean;
}

let svgEl: SVGSVGElement;
let rootGroup: SVGGElement;
let statusEl: HTMLElement;
let headerEl: HTMLElement;
let headerNameEl: HTMLElement;
let headerIdEl: HTMLElement;
let viewBox = { x: 0, y: 0, w: 0, h: 0 };

let isPanning = false;
let panStart = { x: 0, y: 0 };
let panStartViewBox = { x: 0, y: 0 };

// ═══ Bootstrap ═══════════════════════════════════════════════════════════════

function init(): void {
	const root = document.getElementById('diagram-root');
	statusEl = document.getElementById('diagram-status') as HTMLElement;
	headerEl = document.getElementById('diagram-header') as HTMLElement;
	headerNameEl = document.getElementById('diagram-header-name') as HTMLElement;
	headerIdEl = document.getElementById('diagram-header-id') as HTMLElement;
	if (!root || !statusEl || !headerEl || !headerNameEl || !headerIdEl) return;

	svgEl = document.createElementNS(NS, 'svg');
	svgEl.appendChild(buildArrowMarker());
	rootGroup = document.createElementNS(NS, 'g');
	svgEl.appendChild(rootGroup);
	root.appendChild(svgEl);

	svgEl.addEventListener('mousedown', onPanStart);
	window.addEventListener('mousemove', onPanMove);
	window.addEventListener('mouseup', onPanEnd);
	svgEl.addEventListener('wheel', onWheel, { passive: false });

	window.addEventListener('message', onMessage);
}

function onMessage(event: MessageEvent): void {
	if (!isTrustedMessageOrigin(event.origin, trustedOrigin)) return;
	const data = event.data as { type?: string; diagram?: Diagram | null };
	if (data.type !== 'setDiagram') return;
	render(data.diagram ?? null);
}

/**
 * The arrowhead, defined once and referenced by every flow.
 *
 * `context-stroke` is not used for the fill: it is unsupported in the Electron
 * version some VS Code builds ship, and the marker silently disappears rather
 * than falling back. The CSS variable is resolved by the stylesheet instead.
 */
function buildArrowMarker(): SVGDefsElement {
	const defs = document.createElementNS(NS, 'defs');
	const marker = document.createElementNS(NS, 'marker');
	marker.setAttribute('id', 'bpmn-arrow');
	marker.setAttribute('viewBox', '0 0 10 10');
	marker.setAttribute('refX', '9');
	marker.setAttribute('refY', '5');
	marker.setAttribute('markerWidth', '8');
	marker.setAttribute('markerHeight', '8');
	marker.setAttribute('orient', 'auto-start-reverse');
	const path = document.createElementNS(NS, 'path');
	path.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
	path.setAttribute('class', 'flow-arrow');
	marker.appendChild(path);
	defs.appendChild(marker);
	return defs;
}

// ═══ Rendering ═══════════════════════════════════════════════════════════════

function render(diagram: Diagram | null): void {
	rootGroup.replaceChildren();
	renderHeader(diagram);

	if (!diagram) {
		showStatus('No process definition to draw. A BPMN needs a <process> element with at least one flow element.');
		return;
	}
	hideStatus();

	// Edges first so a connector never overdraws a shape's border.
	const routes = diagram.edges.map(edge => edge.points);
	for (const edge of diagram.edges) rootGroup.appendChild(drawEdge(edge));
	for (const node of diagram.nodes) rootGroup.appendChild(drawNode(node, routes));

	fitToContent(diagram);
}

/**
 * The one piece of context missing from a floating panel: which process this
 * is. `Diagram: <filename>` is already the panel's tab title, but a tab title
 * is elided the moment two panels are open side by side or the panel is wide
 * — the process's own display name, the thing a reviewer actually recognises,
 * is what is worth keeping visible.
 *
 * The id is shown beside it, not instead of it: `bpmn-rules.md` §8 draws a
 * real distinction between the two (a display name and the deployed
 * `processType` can differ), and a reviewer confirming which is which should
 * not have to open the XML to find out.
 */
function renderHeader(diagram: Diagram | null): void {
	if (!diagram) {
		headerEl.hidden = true;
		return;
	}
	headerEl.hidden = false;
	headerNameEl.textContent = diagram.processName ?? diagram.processId;
	// Omitted rather than repeated when the name already is the id — the
	// common case for a definition with no separate display name.
	headerIdEl.textContent = diagram.processName ? diagram.processId : '';
}

function drawEdge(edge: DiagramEdge): SVGGElement {
	const group = document.createElementNS(NS, 'g');
	group.setAttribute('class', 'flow');

	// A connector between two shapes is often only sixty or seventy units long,
	// so a condition drawn along it is ellipsised to almost nothing. Keeping the
	// full text as the accessible name means it is one hover away instead of
	// lost — the same bargain `drawNode` makes for a clipped element name.
	if (edge.label) {
		const title = document.createElementNS(NS, 'title');
		title.textContent = edge.label;
		group.appendChild(title);
	}

	const line = document.createElementNS(NS, 'polyline');
	line.setAttribute('points', edge.points.map(p => `${p.x},${p.y}`).join(' '));
	line.setAttribute('class', 'flow-line');
	line.setAttribute('marker-end', 'url(#bpmn-arrow)');
	group.appendChild(line);

	// Size and position come back together, because how wide the caption may be
	// is decided by the run it is about to sit on.
	const placed = edgeLabel(edge.label, edge.points);
	if (placed) {
		const text = document.createElementNS(NS, 'text');
		text.setAttribute('x', String(placed.anchor.x));
		text.setAttribute('y', String(placed.anchor.y - EDGE_LABEL_LIFT));
		text.setAttribute('class', 'flow-label');
		text.setAttribute('text-anchor', 'middle');
		// `textContent`, never `innerHTML`: this string is document content.
		text.textContent = placed.box.lines[0] ?? '';
		group.appendChild(text);
	}

	return group;
}

function drawNode(node: DiagramNode, routes: readonly (readonly Point[])[]): SVGGElement {
	const group = document.createElementNS(NS, 'g');
	group.setAttribute('class', `node node-${node.shape}`);
	// `title` is the accessible name and the native tooltip; the full label and
	// the untruncated detail both live here rather than being lost to ellipsis.
	const title = document.createElementNS(NS, 'title');
	title.textContent = nodeTooltip(node);
	group.appendChild(title);

	group.appendChild(shapeFor(node));
	appendLabel(group, node, routes);

	group.addEventListener('click', () => {
		vscode.postMessage({ type: 'revealOffset', offset: node.offset });
	});

	return group;
}

function shapeFor(node: DiagramNode): SVGElement {
	if (node.shape === 'event') {
		const circle = document.createElementNS(NS, 'circle');
		circle.setAttribute('cx', String(node.x + node.width / 2));
		circle.setAttribute('cy', String(node.y + node.height / 2));
		circle.setAttribute('r', String(Math.min(node.width, node.height) / 2));
		// An end event is drawn with a heavy border, which is how BPMN
		// distinguishes it from a start event without relying on position.
		circle.setAttribute('class', node.tag === 'endEvent' ? 'shape shape-end' : 'shape');
		return circle;
	}

	if (node.shape === 'gateway') {
		const cx = node.x + node.width / 2;
		const cy = node.y + node.height / 2;
		const diamond = document.createElementNS(NS, 'polygon');
		diamond.setAttribute(
			'points',
			[
				`${cx},${node.y}`,
				`${node.x + node.width},${cy}`,
				`${cx},${node.y + node.height}`,
				`${node.x},${cy}`,
			].join(' '),
		);
		diamond.setAttribute('class', 'shape');
		return diamond;
	}

	const rect = document.createElementNS(NS, 'rect');
	rect.setAttribute('x', String(node.x));
	rect.setAttribute('y', String(node.y));
	rect.setAttribute('width', String(node.width));
	rect.setAttribute('height', String(node.height));
	rect.setAttribute('rx', '8');
	rect.setAttribute('class', 'shape');
	return rect;
}

/**
 * Place the label inside a task and beneath an event or gateway.
 *
 * That is the BPMN convention, and it is also the only thing that fits: a
 * 36-unit circle cannot hold readable text, while a 100x80 task can. Both cases
 * take their wrapping from `bpmnLabels`, the same module the layout consulted
 * when it reserved room, so what is drawn is what was measured.
 */
function appendLabel(
	group: SVGGElement,
	node: DiagramNode,
	routes: readonly (readonly Point[])[],
): void {
	const cx = node.x + node.width / 2;

	if (node.shape === 'task') {
		const label = taskLabelBox(node.label, node.width);
		const detail = taskDetailBox(node.detail, node.width);
		// The name and the detail line are centred as one block, not
		// independently: a two-line name with a role under it otherwise runs out
		// through the bottom of the shape.
		const top = node.y + node.height / 2 - (label.height + detail.height) / 2;
		const afterLabel = appendLines(group, label, cx, top, LABEL_FONT_SIZE, 'node-label');
		appendLines(group, detail, cx, afterLabel, DETAIL_FONT_SIZE, 'node-detail');
		return;
	}

	appendLines(
		group,
		outsideLabelBox(node.label),
		cx,
		outsideLabelTop(node, node.label, routes),
		LABEL_FONT_SIZE,
		'node-label',
	);
}

/**
 * Draw one wrapped label with its top edge at `top`, and return the next free y.
 *
 * SVG does not wrap text, so each line is its own `<tspan>` positioned
 * absolutely rather than by `dy` — a relative offset drifts as soon as one line
 * is empty, and lands the second line of a name somewhere else entirely.
 */
function appendLines(
	group: SVGGElement,
	box: LabelBox,
	cx: number,
	top: number,
	fontSize: number,
	className: string,
): number {
	if (box.lines.length === 0) return top;
	const step = lineHeight(fontSize);

	const text = document.createElementNS(NS, 'text');
	text.setAttribute('x', String(cx));
	text.setAttribute('text-anchor', 'middle');
	text.setAttribute('class', className);
	box.lines.forEach((line, index) => {
		const span = document.createElementNS(NS, 'tspan');
		span.setAttribute('x', String(cx));
		span.setAttribute('y', String(top + fontSize + index * step));
		// `textContent`, never `innerHTML`: this string is document content.
		span.textContent = line;
		text.appendChild(span);
	});
	group.appendChild(text);

	return top + box.lines.length * step;
}

function nodeTooltip(node: DiagramNode): string {
	const lines = [`${node.tag}: ${node.label}`, `id: ${node.id}`];
	if (node.detail) lines.push(node.detail);
	return lines.join('\n');
}

// ═══ Viewport ════════════════════════════════════════════════════════════════

function fitToContent(diagram: Diagram): void {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	const consider = (x: number, y: number): void => {
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	};

	for (const node of diagram.nodes) {
		consider(node.x, node.y);
		consider(node.x + node.width, node.y + node.height);
		// An event's or a gateway's label sits below the shape and is not bounded
		// by its width, so a fit that only considered shapes would clip the bottom
		// row's captions and the ends of the wide ones. The band and the width come
		// from the same functions the layout reserved room with.
		if (node.shape !== 'task') {
			const label = outsideLabelBox(node.label);
			const bottom = node.y + node.height + outsideLabelBand(node.label);
			const cx = node.x + node.width / 2;
			consider(cx - label.width / 2, bottom);
			consider(cx + label.width / 2, bottom);
		}
	}
	for (const edge of diagram.edges) {
		for (const point of edge.points) consider(point.x, point.y);
	}

	if (!Number.isFinite(minX)) return;

	viewBox = {
		x: minX - FIT_MARGIN,
		y: minY - FIT_MARGIN,
		w: maxX - minX + FIT_MARGIN * 2,
		h: maxY - minY + FIT_MARGIN * 2,
	};
	applyViewBox();
}

function applyViewBox(): void {
	svgEl.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
}

function onPanStart(event: MouseEvent): void {
	// Left button only, and never on a shape: a click there means "show me this
	// element in the XML", and a pan would swallow it.
	if (event.button !== 0) return;
	if ((event.target as Element).closest('.node')) return;
	isPanning = true;
	panStart = { x: event.clientX, y: event.clientY };
	panStartViewBox = { x: viewBox.x, y: viewBox.y };
	svgEl.classList.add('panning');
}

function onPanMove(event: MouseEvent): void {
	if (!isPanning) return;
	const rect = svgEl.getBoundingClientRect();
	if (rect.width === 0 || rect.height === 0) return;
	// Pointer movement is in screen pixels; the viewBox is in diagram units, so
	// the delta has to be scaled or panning drifts at any zoom but 1.
	viewBox.x = panStartViewBox.x - ((event.clientX - panStart.x) * viewBox.w) / rect.width;
	viewBox.y = panStartViewBox.y - ((event.clientY - panStart.y) * viewBox.h) / rect.height;
	applyViewBox();
}

function onPanEnd(): void {
	isPanning = false;
	svgEl.classList.remove('panning');
}

/**
 * Zoom about the pointer, so the thing under the cursor stays under it.
 *
 * Bounds are expressed against the fitted width rather than a zoom factor held
 * separately, which keeps the only piece of view state the viewBox itself.
 */
function onWheel(event: WheelEvent): void {
	event.preventDefault();
	const rect = svgEl.getBoundingClientRect();
	if (rect.width === 0 || rect.height === 0 || viewBox.w === 0) return;

	const scale = event.deltaY > 0 ? 1.1 : 1 / 1.1;
	const nextW = viewBox.w * scale;
	const nextH = viewBox.h * scale;

	const anchorX = viewBox.x + ((event.clientX - rect.left) / rect.width) * viewBox.w;
	const anchorY = viewBox.y + ((event.clientY - rect.top) / rect.height) * viewBox.h;

	const ratio = nextW / rect.width;
	if (ratio < 1 / MAX_ZOOM || ratio > 1 / MIN_ZOOM) return;

	viewBox = {
		x: anchorX - (anchorX - viewBox.x) * scale,
		y: anchorY - (anchorY - viewBox.y) * scale,
		w: nextW,
		h: nextH,
	};
	applyViewBox();
}

// ═══ Status ══════════════════════════════════════════════════════════════════

/** `textContent`, never `innerHTML`: this string can carry document content. */
function showStatus(message: string): void {
	statusEl.textContent = message;
	statusEl.hidden = false;
}

function hideStatus(): void {
	statusEl.hidden = true;
}

init();
