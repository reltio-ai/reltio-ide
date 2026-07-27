declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

interface AttrInfo {
	uri: string;
	name: string;
	category: 'Simple' | 'Nested' | 'Reference';
	valueType: string;
	children?: AttrInfo[];
	relationshipTypeURI?: string;
	referencedEntityTypeURI?: string;
}

function shortUri(uri: string): string {
	const parts = uri.split('/');
	return parts[parts.length - 1];
}

interface GraphNode {
	id: string; label: string; abstract: boolean; consolidated: boolean;
	simpleAttrCount: number; nestedAttrCount: number; refAttrCount: number;
	matchGroupCount: number; attrs: AttrInfo[];
	x: number; y: number; width: number; height: number;
}

interface RelTypeInfo {
	label: string; uri: string;
	startEntityId: string; endEntityId: string;
}

interface GraphEdge {
	id: string; source: string; target: string;
	type: 'connection' | 'extends'; label: string;
	relationshipLabels: string[]; relationshipURIs: string[];
	referenceLabels: string[]; referenceURIs: string[];
	relationTypes: RelTypeInfo[]; referenceAttrs: AttrInfo[];
}

interface GraphModel { nodes: GraphNode[]; edges: GraphEdge[]; }

const vscode = acquireVsCodeApi();
const NS = 'http://www.w3.org/2000/svg';

const NODE_HEADER_H = 28;
const MAX_LABEL_CHARS = 24;

let graph: GraphModel | null = null;
let selectedNodeId: string | null = null;
let selectedEdgeId: string | null = null;
let needsFitViewBox = true;

let viewBox = { x: 0, y: 0, w: 0, h: 0 };
let zoom = 1;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

let svgEl: SVGSVGElement;
let rootGroup: SVGGElement;
let gridRect: SVGRectElement;

let inspectorEl: HTMLDivElement | null = null;
let contextMenuEl: HTMLDivElement | null = null;

let scrollbarH: HTMLDivElement;
let scrollbarV: HTMLDivElement;
let thumbH: HTMLDivElement;
let thumbV: HTMLDivElement;
let contentBounds = { x: 0, y: 0, w: 0, h: 0 };

// --- Drag state (nodes) ---
let dragNodeId: string | null = null;
let dragStartPointer = { x: 0, y: 0 };
let dragStartNodePos = { x: 0, y: 0 };
let isDragging = false;

// --- Pan state ---
let isPanning = false;
let panStart = { x: 0, y: 0 };
let panStartViewBox = { x: 0, y: 0 };

// --- Edge click ---
let clickedEdgeId: string | null = null;

// --- Double-click detection ---
const DBL_CLICK_MS = 350;
let lastClickId: string | null = null;
let lastClickKind: 'node' | 'edge' | null = null;
let lastClickTime = 0;

// ===== Initialization =====

function init(): void {
	const root = document.getElementById('canvas-root')!;

	svgEl = document.createElementNS(NS, 'svg');
	root.appendChild(svgEl);

	const defs = document.createElementNS(NS, 'defs');
	defs.appendChild(createDotGridPattern());
	defs.appendChild(createArrowMarker('arrow-filled', false));
	defs.appendChild(createArrowMarker('arrow-open', true));
	defs.appendChild(createNodeClipPath());
	svgEl.appendChild(defs);

	gridRect = document.createElementNS(NS, 'rect');
	gridRect.setAttribute('fill', 'url(#dot-grid)');
	svgEl.appendChild(gridRect);

	rootGroup = document.createElementNS(NS, 'g');
	svgEl.appendChild(rootGroup);

	svgEl.addEventListener('wheel', onWheel, { passive: false });
	svgEl.addEventListener('pointerdown', onPointerDown);
	svgEl.addEventListener('pointermove', onPointerMove);
	svgEl.addEventListener('pointerup', onPointerUp);
	svgEl.addEventListener('contextmenu', onContextMenu);

	scrollbarH = document.createElement('div');
	scrollbarH.className = 'scrollbar scrollbar-h';
	thumbH = document.createElement('div');
	thumbH.className = 'scrollbar-thumb';
	scrollbarH.appendChild(thumbH);
	root.appendChild(scrollbarH);

	scrollbarV = document.createElement('div');
	scrollbarV.className = 'scrollbar scrollbar-v';
	thumbV = document.createElement('div');
	thumbV.className = 'scrollbar-thumb';
	scrollbarV.appendChild(thumbV);
	root.appendChild(scrollbarV);

	initScrollbarDrag(scrollbarH, thumbH, 'h');
	initScrollbarDrag(scrollbarV, thumbV, 'v');

	document.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Escape') { closeInspector(); closeContextMenu(); }
	});
}

function createDotGridPattern(): SVGPatternElement {
	const pattern = document.createElementNS(NS, 'pattern');
	pattern.setAttribute('id', 'dot-grid');
	pattern.setAttribute('width', '20');
	pattern.setAttribute('height', '20');
	pattern.setAttribute('patternUnits', 'userSpaceOnUse');
	const dot = document.createElementNS(NS, 'circle');
	dot.setAttribute('cx', '10');
	dot.setAttribute('cy', '10');
	dot.setAttribute('r', '1');
	dot.setAttribute('fill', 'rgba(255, 255, 255, 0.12)');
	pattern.appendChild(dot);
	return pattern;
}

function createArrowMarker(id: string, open: boolean): SVGMarkerElement {
	const marker = document.createElementNS(NS, 'marker');
	marker.setAttribute('id', id);
	marker.setAttribute('viewBox', '0 0 10 6');
	marker.setAttribute('refX', '10');
	marker.setAttribute('refY', '3');
	marker.setAttribute('markerWidth', '10');
	marker.setAttribute('markerHeight', '6');
	marker.setAttribute('orient', 'auto-start-reverse');
	const path = document.createElementNS(NS, 'path');
	path.setAttribute('d', open ? 'M0,0 L10,3 L0,6' : 'M0,0 L10,3 L0,6 Z');
	path.setAttribute('fill', open ? 'none' : '#b0b0cc');
	path.setAttribute('stroke', '#b0b0cc');
	path.setAttribute('stroke-width', '1');
	marker.appendChild(path);
	return marker;
}

function createNodeClipPath(): SVGClipPathElement {
	const clip = document.createElementNS(NS, 'clipPath');
	clip.setAttribute('id', 'node-clip');
	const rect = document.createElementNS(NS, 'rect');
	rect.setAttribute('width', '220');
	rect.setAttribute('height', '100');
	rect.setAttribute('rx', '4');
	clip.appendChild(rect);
	return clip;
}

// ===== Rendering =====

function render(): void {
	if (!graph) return;
	while (rootGroup.firstChild) rootGroup.removeChild(rootGroup.firstChild);

	for (const edge of graph.edges) renderEdge(edge);
	for (const node of graph.nodes) renderNode(node);

	if (needsFitViewBox) {
		fitViewBox();
		needsFitViewBox = false;
	}
}

function truncate(s: string, max: number): string {
	return s.length > max ? s.slice(0, max - 1) + '\u2026' : s;
}

function nodeConnectionCount(nodeId: string): number {
	if (!graph) return 0;
	return graph.edges.filter(e => e.source === nodeId || e.target === nodeId).length;
}

function renderNode(node: GraphNode): void {
	const g = document.createElementNS(NS, 'g');
	g.classList.add('node');
	if (node.id === selectedNodeId) g.classList.add('selected');
	g.setAttribute('transform', `translate(${node.x}, ${node.y})`);
	g.dataset.nodeId = node.id;

	const bg = document.createElementNS(NS, 'rect');
	bg.setAttribute('width', String(node.width));
	bg.setAttribute('height', String(node.height));
	bg.setAttribute('rx', '4');
	bg.classList.add('node-bg');
	if (node.abstract) bg.classList.add('abstract');
	else if (node.consolidated) bg.classList.add('consolidated');
	else bg.classList.add('normal');
	g.appendChild(bg);

	const clipGroup = document.createElementNS(NS, 'g');
	clipGroup.setAttribute('clip-path', 'url(#node-clip)');
	const header = document.createElementNS(NS, 'rect');
	header.setAttribute('width', String(node.width));
	header.setAttribute('height', String(NODE_HEADER_H));
	header.classList.add('node-header-bg');
	clipGroup.appendChild(header);
	g.appendChild(clipGroup);

	const sep = document.createElementNS(NS, 'line');
	sep.setAttribute('x1', '0');
	sep.setAttribute('y1', String(NODE_HEADER_H));
	sep.setAttribute('x2', String(node.width));
	sep.setAttribute('y2', String(NODE_HEADER_H));
	sep.classList.add('node-separator');
	g.appendChild(sep);

	g.appendChild(svgText(node.width / 2, 18, truncate(node.label, MAX_LABEL_CHARS), 'node-label'));

	const totalAttrs = node.simpleAttrCount + node.nestedAttrCount + node.refAttrCount;
	const connCount = nodeConnectionCount(node.id);
	let y = NODE_HEADER_H + 15;

	g.appendChild(svgText(node.width / 2, y, `Attrs: ${totalAttrs}  ·  Conn: ${connCount}`, 'node-stats'));
	y += 14;

	if (node.matchGroupCount > 0) {
		g.appendChild(svgText(node.width / 2, y, `Match rules: ${node.matchGroupCount}`, 'node-stats'));
		y += 14;
	}

	if (node.consolidated) {
		g.appendChild(svgText(node.width / 2, y, '\u2605 Consolidated', 'node-badge'));
	} else if (node.abstract) {
		g.appendChild(svgText(node.width / 2, y, 'Abstract', 'node-badge'));
	}

	rootGroup.appendChild(g);
}

function svgText(x: number, y: number, content: string, cls: string): SVGTextElement {
	const t = document.createElementNS(NS, 'text');
	t.setAttribute('x', String(x));
	t.setAttribute('y', String(y));
	t.setAttribute('text-anchor', 'middle');
	t.classList.add(cls);
	t.textContent = content;
	return t;
}

// ===== Orthogonal edge routing =====

function renderEdge(edge: GraphEdge): void {
	if (!graph) return;
	const src = graph.nodes.find(n => n.id === edge.source);
	const tgt = graph.nodes.find(n => n.id === edge.target);
	if (!src || !tgt) return;

	const pathD = orthogonalRoute(src, tgt, edge);

	const g = document.createElementNS(NS, 'g');
	g.classList.add('edge');
	if (edge.id === selectedEdgeId) g.classList.add('selected');
	g.dataset.edgeId = edge.id;

	const hitPath = document.createElementNS(NS, 'path');
	hitPath.setAttribute('d', pathD);
	hitPath.setAttribute('stroke', 'transparent');
	hitPath.setAttribute('stroke-width', '14');
	hitPath.setAttribute('fill', 'none');
	hitPath.classList.add('edge-hit');
	g.appendChild(hitPath);

	const path = document.createElementNS(NS, 'path');
	path.setAttribute('d', pathD);
	path.classList.add(edge.type === 'extends' ? 'extends' : 'connection');
	path.setAttribute('marker-end', edge.type === 'extends' ? 'url(#arrow-open)' : 'url(#arrow-filled)');
	g.appendChild(path);

	const mid = pathMidpoint(pathD);
	if (edge.label) {
		const bgRect = document.createElementNS(NS, 'rect');
		const textLen = edge.label.length * 6 + 10;
		bgRect.setAttribute('x', String(mid.x - textLen / 2));
		bgRect.setAttribute('y', String(mid.y - 10));
		bgRect.setAttribute('width', String(textLen));
		bgRect.setAttribute('height', '14');
		bgRect.setAttribute('rx', '3');
		bgRect.classList.add('edge-label-bg');
		g.appendChild(bgRect);

		g.appendChild(svgText(mid.x, mid.y, truncate(edge.label, 34), 'edge-label'));
	}

	rootGroup.appendChild(g);
}

function orthogonalRoute(src: GraphNode, tgt: GraphNode, edge: GraphEdge): string {
	const srcCx = src.x + src.width / 2;
	const tgtCx = tgt.x + tgt.width / 2;
	const srcBottom = src.y + src.height;
	const srcTop = src.y;
	const tgtBottom = tgt.y + tgt.height;
	const tgtTop = tgt.y;

	const off = edgeParallelOffset(edge);

	const vGapDown = tgtTop - srcBottom;
	if (vGapDown > 10) {
		const midY = srcBottom + vGapDown / 2 + off;
		return `M${srcCx},${srcBottom} V${midY} H${tgtCx} V${tgtTop}`;
	}

	const vGapUp = srcTop - tgtBottom;
	if (vGapUp > 10) {
		const midY = tgtBottom + vGapUp / 2 + off;
		return `M${srcCx},${srcTop} V${midY} H${tgtCx} V${tgtBottom}`;
	}

	const srcCy = src.y + src.height / 2;
	const tgtCy = tgt.y + tgt.height / 2;
	if (srcCx < tgtCx) {
		const gap = tgt.x - (src.x + src.width);
		const midX = src.x + src.width + Math.max(gap / 2, 20) + off;
		return `M${src.x + src.width},${srcCy} H${midX} V${tgtCy} H${tgt.x}`;
	} else {
		const gap = src.x - (tgt.x + tgt.width);
		const midX = tgt.x + tgt.width + Math.max(gap / 2, 20) + off;
		return `M${src.x},${srcCy} H${midX} V${tgtCy} H${tgt.x + tgt.width}`;
	}
}

function edgeParallelOffset(edge: GraphEdge): number {
	if (!graph) return 0;
	const key = [edge.source, edge.target].sort().join('|');
	const siblings = graph.edges.filter(e => [e.source, e.target].sort().join('|') === key);
	if (siblings.length <= 1) return 0;
	const idx = siblings.indexOf(edge);
	return (idx - (siblings.length - 1) / 2) * 16;
}

function pathMidpoint(d: string): { x: number; y: number } {
	const nums = d.match(/-?[\d.]+/g)?.map(Number) ?? [];
	if (nums.length < 4) return { x: 0, y: 0 };
	const xs: number[] = [], ys: number[] = [];
	let cx = 0, cy = 0, i = 0;
	for (const ch of d) {
		if (ch === 'M' || ch === 'L') { cx = nums[i++]; cy = nums[i++]; xs.push(cx); ys.push(cy); }
		else if (ch === 'H') { cx = nums[i++]; xs.push(cx); ys.push(cy); }
		else if (ch === 'V') { cy = nums[i++]; xs.push(cx); ys.push(cy); }
	}
	const mid = Math.floor(xs.length / 2);
	if (mid > 0 && mid < xs.length) return { x: (xs[mid - 1] + xs[mid]) / 2, y: (ys[mid - 1] + ys[mid]) / 2 };
	return { x: xs[0] ?? 0, y: ys[0] ?? 0 };
}

// ===== ViewBox =====

function computeContentBounds(): void {
	if (!graph || graph.nodes.length === 0) return;
	const padding = 80;
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const n of graph.nodes) {
		minX = Math.min(minX, n.x);
		minY = Math.min(minY, n.y);
		maxX = Math.max(maxX, n.x + n.width);
		maxY = Math.max(maxY, n.y + n.height);
	}
	contentBounds = { x: minX - padding, y: minY - padding, w: maxX - minX + 2 * padding, h: maxY - minY + 2 * padding };
}

function fitViewBox(): void {
	if (!graph || graph.nodes.length === 0) return;
	computeContentBounds();
	viewBox = { ...contentBounds };
	zoom = 1;
	applyViewBox();
}

function applyViewBox(): void {
	svgEl.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
	const pad = Math.max(viewBox.w, viewBox.h) * 3;
	gridRect.setAttribute('x', String(viewBox.x - pad));
	gridRect.setAttribute('y', String(viewBox.y - pad));
	gridRect.setAttribute('width', String(viewBox.w + 2 * pad));
	gridRect.setAttribute('height', String(viewBox.h + 2 * pad));
	updateScrollbars();
}

function updateScrollbars(): void {
	if (!contentBounds.w || !contentBounds.h) return;
	const totalX = Math.min(contentBounds.x, viewBox.x);
	const totalY = Math.min(contentBounds.y, viewBox.y);
	const totalR = Math.max(contentBounds.x + contentBounds.w, viewBox.x + viewBox.w);
	const totalB = Math.max(contentBounds.y + contentBounds.h, viewBox.y + viewBox.h);
	const totalW = totalR - totalX;
	const totalH = totalB - totalY;

	const hRatio = viewBox.w / totalW;
	const vRatio = viewBox.h / totalH;

	if (hRatio >= 0.99) {
		scrollbarH.style.display = 'none';
	} else {
		scrollbarH.style.display = '';
		const trackW = scrollbarH.clientWidth;
		thumbH.style.width = `${Math.max(24, hRatio * trackW)}px`;
		thumbH.style.left = `${((viewBox.x - totalX) / totalW) * trackW}px`;
	}

	if (vRatio >= 0.99) {
		scrollbarV.style.display = 'none';
	} else {
		scrollbarV.style.display = '';
		const trackH = scrollbarV.clientHeight;
		thumbV.style.height = `${Math.max(24, vRatio * trackH)}px`;
		thumbV.style.top = `${((viewBox.y - totalY) / totalH) * trackH}px`;
	}
}

function initScrollbarDrag(track: HTMLDivElement, thumb: HTMLDivElement, axis: 'h' | 'v'): void {
	let dragging = false;
	let startPos = 0;
	let startScroll = 0;

	thumb.addEventListener('pointerdown', (e: PointerEvent) => {
		e.stopPropagation();
		e.preventDefault();
		dragging = true;
		startPos = axis === 'h' ? e.clientX : e.clientY;
		startScroll = axis === 'h' ? viewBox.x : viewBox.y;
		thumb.setPointerCapture(e.pointerId);
	});

	thumb.addEventListener('pointermove', (e: PointerEvent) => {
		if (!dragging) return;
		const delta = (axis === 'h' ? e.clientX : e.clientY) - startPos;
		const trackSize = axis === 'h' ? track.clientWidth : track.clientHeight;

		const totalMin = axis === 'h'
			? Math.min(contentBounds.x, viewBox.x)
			: Math.min(contentBounds.y, viewBox.y);
		const totalMax = axis === 'h'
			? Math.max(contentBounds.x + contentBounds.w, viewBox.x + viewBox.w)
			: Math.max(contentBounds.y + contentBounds.h, viewBox.y + viewBox.h);
		const totalSize = totalMax - totalMin;

		const svgDelta = (delta / trackSize) * totalSize;
		if (axis === 'h') viewBox.x = startScroll + svgDelta;
		else viewBox.y = startScroll + svgDelta;
		applyViewBox();
	});

	thumb.addEventListener('pointerup', (e: PointerEvent) => {
		dragging = false;
		thumb.releasePointerCapture(e.pointerId);
	});

	track.addEventListener('pointerdown', (e: PointerEvent) => {
		if (e.target === thumb) return;
		e.stopPropagation();
		const rect = track.getBoundingClientRect();
		const clickRatio = axis === 'h'
			? (e.clientX - rect.left) / rect.width
			: (e.clientY - rect.top) / rect.height;

		const totalMin = axis === 'h'
			? Math.min(contentBounds.x, viewBox.x)
			: Math.min(contentBounds.y, viewBox.y);
		const totalMax = axis === 'h'
			? Math.max(contentBounds.x + contentBounds.w, viewBox.x + viewBox.w)
			: Math.max(contentBounds.y + contentBounds.h, viewBox.y + viewBox.h);
		const totalSize = totalMax - totalMin;

		const target = totalMin + clickRatio * totalSize;
		if (axis === 'h') viewBox.x = target - viewBox.w / 2;
		else viewBox.y = target - viewBox.h / 2;
		applyViewBox();
	});
}

// ===== Zoom =====

function onWheel(e: WheelEvent): void {
	e.preventDefault();
	const factor = e.deltaY > 0 ? 1.1 : 0.9;
	const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
	if (newZoom === zoom) return;

	const rect = svgEl.getBoundingClientRect();
	const mx = (e.clientX - rect.left) / rect.width;
	const my = (e.clientY - rect.top) / rect.height;

	const scale = zoom / newZoom;
	const newW = viewBox.w * scale;
	const newH = viewBox.h * scale;

	viewBox.x += (viewBox.w - newW) * mx;
	viewBox.y += (viewBox.h - newH) * my;
	viewBox.w = newW;
	viewBox.h = newH;
	zoom = newZoom;
	applyViewBox();
}

// ===== Pointer events =====

function svgPoint(clientX: number, clientY: number): { x: number; y: number } {
	const rect = svgEl.getBoundingClientRect();
	return {
		x: viewBox.x + (clientX - rect.left) / rect.width * viewBox.w,
		y: viewBox.y + (clientY - rect.top) / rect.height * viewBox.h,
	};
}

function onPointerDown(e: PointerEvent): void {
	closeContextMenu();
	if (e.button !== 0) return;
	const pt = svgPoint(e.clientX, e.clientY);
	const nodeEl = findNodeElement(e.target as Element);

	if (nodeEl) {
		const nodeId = nodeEl.dataset.nodeId!;
		selectedNodeId = nodeId;
		selectedEdgeId = null;
		dragNodeId = nodeId;
		const node = graph?.nodes.find(n => n.id === nodeId);
		if (node) {
			dragStartPointer = pt;
			dragStartNodePos = { x: node.x, y: node.y };
			isDragging = false;
		}
		svgEl.setPointerCapture(e.pointerId);
		render();
		return;
	}

	const edgeEl = findEdgeElement(e.target as Element);
	if (edgeEl) {
		const eid = edgeEl.dataset.edgeId ?? null;
		clickedEdgeId = eid;
		selectedEdgeId = eid;
		selectedNodeId = null;
		render();
		return;
	}

	selectedNodeId = null;
	selectedEdgeId = null;
	clickedEdgeId = null;
	isPanning = true;
	panStart = { x: e.clientX, y: e.clientY };
	panStartViewBox = { x: viewBox.x, y: viewBox.y };
	svgEl.setPointerCapture(e.pointerId);
	render();
}

function onPointerMove(e: PointerEvent): void {
	if (dragNodeId && graph) {
		const pt = svgPoint(e.clientX, e.clientY);
		const dx = pt.x - dragStartPointer.x;
		const dy = pt.y - dragStartPointer.y;
		if (!isDragging && Math.abs(dx) + Math.abs(dy) > 3) isDragging = true;
		const node = graph.nodes.find(n => n.id === dragNodeId);
		if (node && isDragging) {
			node.x = dragStartNodePos.x + dx;
			node.y = dragStartNodePos.y + dy;
			render();
		}
		return;
	}
	if (isPanning) {
		const rect = svgEl.getBoundingClientRect();
		const dx = (e.clientX - panStart.x) / rect.width * viewBox.w;
		const dy = (e.clientY - panStart.y) / rect.height * viewBox.h;
		viewBox.x = panStartViewBox.x - dx;
		viewBox.y = panStartViewBox.y - dy;
		applyViewBox();
	}
}

function onPointerUp(e: PointerEvent): void {
	if (dragNodeId && isDragging && graph) {
		computeContentBounds();
		const positions: Record<string, { x: number; y: number }> = {};
		for (const n of graph.nodes) positions[n.id] = { x: n.x, y: n.y };
		vscode.postMessage({ type: 'savePositions', positions });
	}
	if (dragNodeId && !isDragging) {
		handleClick('node', dragNodeId, e.clientX, e.clientY);
	} else if (clickedEdgeId) {
		handleClick('edge', clickedEdgeId, e.clientX, e.clientY);
	}
	dragNodeId = null;
	clickedEdgeId = null;
	isDragging = false;
	isPanning = false;
	svgEl.releasePointerCapture(e.pointerId);
}

function handleClick(kind: 'node' | 'edge', id: string, cx: number, cy: number): void {
	const now = Date.now();
	if (lastClickKind === kind && lastClickId === id && now - lastClickTime < DBL_CLICK_MS) {
		lastClickId = null; lastClickKind = null; lastClickTime = 0;
		onDoubleClick(kind, id, cx, cy);
	} else {
		lastClickId = id; lastClickKind = kind; lastClickTime = now;
	}
}

function onDoubleClick(kind: 'node' | 'edge', id: string, cx: number, cy: number): void {
	if (kind === 'node') {
		const node = graph?.nodes.find(n => n.id === id);
		if (node) showEntityInspector(node, cx, cy);
	} else {
		const edge = graph?.edges.find(ed => ed.id === id);
		if (edge) showConnectionInspector(edge, cx, cy);
	}
}

// ===== Context menu (fix9) =====

function onContextMenu(e: MouseEvent): void {
	e.preventDefault();
	closeContextMenu();

	const nodeEl = findNodeElement(e.target as Element);
	const edgeEl = findEdgeElement(e.target as Element);

	const items: { label: string; action: () => void }[] = [];

	if (nodeEl) {
		const nodeId = nodeEl.dataset.nodeId!;
		items.push({ label: 'Show in Editor', action: () => vscode.postMessage({ type: 'revealInEditor', nodeId }) });
		items.push({ label: 'Show in Tree View', action: () => vscode.postMessage({ type: 'revealInTreeView', nodeId }) });
	} else if (edgeEl) {
		const edgeId = edgeEl.dataset.edgeId!;
		const edge = graph?.edges.find(ed => ed.id === edgeId);
		if (edge) {
			items.push({ label: `Show "${edge.source}" in Editor`, action: () => vscode.postMessage({ type: 'revealInEditor', nodeId: edge.source }) });
			items.push({ label: `Show "${edge.target}" in Editor`, action: () => vscode.postMessage({ type: 'revealInEditor', nodeId: edge.target }) });
		}
	}

	if (items.length === 0) return;
	showContextMenuAt(e.clientX, e.clientY, items);
}

function showContextMenuAt(clientX: number, clientY: number, items: InspectorAction[]): void {
	closeContextMenu();
	const root = document.getElementById('canvas-root')!;
	const rootRect = root.getBoundingClientRect();
	const menu = document.createElement('div');
	menu.className = 'context-menu';
	menu.style.left = `${clientX - rootRect.left}px`;
	menu.style.top = `${clientY - rootRect.top}px`;

	for (const item of items) {
		const btn = document.createElement('div');
		btn.className = 'context-menu-item';
		btn.textContent = item.label;
		btn.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); item.action(); closeContextMenu(); });
		menu.appendChild(btn);
	}

	menu.addEventListener('pointerdown', (ev) => ev.stopPropagation());
	root.appendChild(menu);
	contextMenuEl = menu;

	const closeOnOutside = () => { closeContextMenu(); document.removeEventListener('pointerdown', closeOnOutside, true); };
	setTimeout(() => document.addEventListener('pointerdown', closeOnOutside, true), 0);
}

function closeContextMenu(): void {
	if (contextMenuEl) { contextMenuEl.remove(); contextMenuEl = null; }
}

// ===== DOM helpers =====

function findNodeElement(el: Element | null): SVGGElement | null {
	while (el && el !== svgEl) {
		if (el instanceof SVGGElement && el.classList.contains('node')) return el;
		el = el.parentElement;
	}
	return null;
}

function findEdgeElement(el: Element | null): SVGGElement | null {
	while (el && el !== svgEl) {
		if (el instanceof SVGGElement && el.classList.contains('edge')) return el;
		el = el.parentElement;
	}
	return null;
}

// ===== Inspector (draggable, resizable, scrollable) =====

let inspectorDragState: { startX: number; startY: number; startLeft: number; startTop: number } | null = null;

function closeInspector(): void {
	if (inspectorEl) { inspectorEl.remove(); inspectorEl = null; }
}

interface InspectorAction { label: string; action: () => void; }

function createInspector(title: string, bodyHtml: string, clientX: number, clientY: number, actions?: InspectorAction[]): void {
	closeInspector();
	const root = document.getElementById('canvas-root')!;

	const div = document.createElement('div');
	div.className = 'inspector';

	const rootRect = root.getBoundingClientRect();
	let left = clientX - rootRect.left + 10;
	let top = clientY - rootRect.top + 10;
	if (left + 320 > root.clientWidth) left = Math.max(10, root.clientWidth - 330);
	if (top + 280 > root.clientHeight) top = Math.max(10, root.clientHeight - 290);
	div.style.left = `${left}px`;
	div.style.top = `${top}px`;

	div.innerHTML = `
		<div class="inspector-header">
			<h3>${escapeHtml(title)}</h3>
			<button class="inspector-close" aria-label="Close">\u00d7</button>
		</div>
		<div class="inspector-body">${bodyHtml}</div>
	`;

	div.addEventListener('contextmenu', (e: Event) => {
		e.preventDefault();
		e.stopPropagation();
		closeContextMenu();
		const me = e as MouseEvent;
		const target = me.target as HTMLElement;
		const menuItems: InspectorAction[] = [];

		const attrEl = target.closest('[data-attr-uri]') as HTMLElement | null;
		if (attrEl) {
			const attrUri = attrEl.dataset.attrUri!;
			const attrName = shortUri(attrUri);
			menuItems.push({ label: `Show "${attrName}" in Editor`, action: () => vscode.postMessage({ type: 'revealUriInEditor', uri: attrUri }) });
		}

		const relEl = target.closest('[data-rel-uri]') as HTMLElement | null;
		if (relEl) {
			const relUri = relEl.dataset.relUri!;
			const relName = shortUri(relUri);
			menuItems.push({ label: `Show "${relName}" in Editor`, action: () => vscode.postMessage({ type: 'revealUriInEditor', uri: relUri }) });
		}

		const entityEl = target.closest('[data-entity-id]') as HTMLElement | null;
		if (entityEl) {
			const entityId = entityEl.dataset.entityId!;
			menuItems.push({ label: `Show "${entityId}" in Editor`, action: () => vscode.postMessage({ type: 'revealInEditor', nodeId: entityId }) });
			menuItems.push({ label: `Show "${entityId}" in Tree View`, action: () => vscode.postMessage({ type: 'revealInTreeView', nodeId: entityId }) });
		}

		if (actions?.length) menuItems.push(...actions);
		if (menuItems.length) showContextMenuAt(me.clientX, me.clientY, menuItems);
	});

	// Close button: use pointerdown so pointer capture on header doesn't block it (fix1)
	div.querySelector('.inspector-close')!.addEventListener('pointerdown', (e: Event) => {
		e.stopPropagation();
		closeInspector();
	});

	const headerEl = div.querySelector('.inspector-header')! as HTMLElement;
	headerEl.addEventListener('pointerdown', (e: PointerEvent) => {
		if ((e.target as Element).closest('.inspector-close')) return;
		e.stopPropagation();
		inspectorDragState = {
			startX: e.clientX, startY: e.clientY,
			startLeft: div.offsetLeft, startTop: div.offsetTop,
		};
		headerEl.setPointerCapture(e.pointerId);
	});
	headerEl.addEventListener('pointermove', (e: PointerEvent) => {
		if (!inspectorDragState) return;
		div.style.left = `${inspectorDragState.startLeft + e.clientX - inspectorDragState.startX}px`;
		div.style.top = `${inspectorDragState.startTop + e.clientY - inspectorDragState.startY}px`;
	});
	headerEl.addEventListener('pointerup', (e: PointerEvent) => {
		inspectorDragState = null;
		headerEl.releasePointerCapture(e.pointerId);
	});

	div.addEventListener('pointerdown', (e) => e.stopPropagation());

	root.appendChild(div);
	inspectorEl = div;
}

function renderAttrTree(attrs: AttrInfo[]): string {
	let html = '';
	for (const a of attrs) {
		const dataUri = ` data-attr-uri="${escapeHtml(a.uri)}"`;
		if (a.category === 'Simple') {
			html += `<li${dataUri}>${escapeHtml(a.name)} <span class="attr-type">: ${escapeHtml(a.valueType)}</span></li>`;
		} else if (a.category === 'Nested') {
			html += `<li${dataUri}><details><summary>${escapeHtml(a.name)} <span class="attr-type">: Nested</span></summary>`;
			if (a.children?.length) html += `<ul>${renderAttrTree(a.children)}</ul>`;
			html += `</details></li>`;
		} else {
			html += `<li${dataUri}><details><summary>${escapeHtml(a.name)} <span class="attr-type">: Reference</span></summary>`;
			html += `<ul>`;
			if (a.referencedEntityTypeURI) html += `<li class="ref-meta">${escapeHtml(shortUri(a.referencedEntityTypeURI))} <span class="attr-type">: Entity</span></li>`;
			if (a.relationshipTypeURI) html += `<li class="ref-meta">${escapeHtml(shortUri(a.relationshipTypeURI))} <span class="attr-type">: Relation</span></li>`;
			if (a.children?.length) {
				html += `<li><details><summary>Attributes (${a.children.length})</summary><ul>${renderAttrTree(a.children)}</ul></details></li>`;
			}
			html += `</ul></details></li>`;
		}
	}
	return html;
}

function renderRelTypeTree(relTypes: RelTypeInfo[]): string {
	let html = '';
	for (const rt of relTypes) {
		html += `<li data-rel-uri="${escapeHtml(rt.uri)}"><details><summary>${escapeHtml(rt.label)}</summary><ul>`;
		html += `<li data-entity-id="${escapeHtml(rt.startEntityId)}">${escapeHtml(rt.startEntityId)} <span class="attr-type">: Start Type</span></li>`;
		html += `<li data-entity-id="${escapeHtml(rt.endEntityId)}">${escapeHtml(rt.endEntityId)} <span class="attr-type">: End Type</span></li>`;
		html += `<li data-rel-uri="${escapeHtml(rt.uri)}">${escapeHtml(rt.label)} <span class="attr-type">: Relation Type</span></li>`;
		html += `</ul></details></li>`;
	}
	return html;
}

function showEntityInspector(node: GraphNode, cx: number, cy: number): void {
	let html = `<p><strong>URI:</strong> ${escapeHtml(node.id)}</p>`;
	if (node.abstract) html += `<p><em>Abstract entity type</em></p>`;
	if (node.consolidated) html += `<p><em>\u2605 Consolidated profile type</em></p>`;

	const simple = node.attrs.filter(a => a.category === 'Simple').sort((a, b) => a.name.localeCompare(b.name));
	const nested = node.attrs.filter(a => a.category === 'Nested').sort((a, b) => a.name.localeCompare(b.name));
	const refs = node.attrs.filter(a => a.category === 'Reference').sort((a, b) => a.name.localeCompare(b.name));
	const total = simple.length + nested.length + refs.length;

	html += `<details><summary>Attributes (${total})</summary><div class="attr-tree">`;
	if (simple.length) {
		html += `<details class="attr-group"><summary>Simple (${simple.length})</summary><ul>${renderAttrTree(simple)}</ul></details>`;
	}
	if (nested.length) {
		html += `<details class="attr-group"><summary>Nested (${nested.length})</summary><ul>${renderAttrTree(nested)}</ul></details>`;
	}
	if (refs.length) {
		html += `<details class="attr-group"><summary>Reference (${refs.length})</summary><ul>${renderAttrTree(refs)}</ul></details>`;
	}
	html += `</div></details>`;

	if (node.matchGroupCount > 0) {
		html += `<details><summary>Match Groups (${node.matchGroupCount})</summary><ul>`;
		html += `<li>${node.matchGroupCount} group(s) configured</li>`;
		html += `</ul></details>`;
	}

	const connected = graph?.edges.filter(e => e.source === node.id || e.target === node.id) ?? [];
	if (connected.length > 0) {
		html += `<details><summary>Connections (${connected.length})</summary><div class="attr-tree">`;
		for (const e of connected) {
			const other = e.source === node.id ? e.target : e.source;
			html += `<details class="attr-group"><summary data-entity-id="${escapeHtml(other)}">\u2194 ${escapeHtml(other)}</summary><div class="attr-tree">`;
			if (e.relationTypes.length > 0) {
				html += `<details class="attr-group"><summary>Relationship Types (${e.relationTypes.length})</summary><ul>${renderRelTypeTree(e.relationTypes)}</ul></details>`;
			}
			if (e.referenceAttrs.length > 0) {
				html += `<details class="attr-group"><summary>Reference Attributes (${e.referenceAttrs.length})</summary><ul>${renderAttrTree(e.referenceAttrs)}</ul></details>`;
			}
			html += `</div></details>`;
		}
		html += `</div></details>`;
	}

	const nodeShort = shortUri(node.id);
	createInspector(node.label, html, cx, cy, [
		{ label: `Show "${nodeShort}" in Editor`, action: () => vscode.postMessage({ type: 'revealInEditor', nodeId: node.id }) },
		{ label: `Show "${nodeShort}" in Tree View`, action: () => vscode.postMessage({ type: 'revealInTreeView', nodeId: node.id }) },
	]);
}

function showConnectionInspector(edge: GraphEdge, cx: number, cy: number): void {
	let html = `<p><strong>From:</strong> ${escapeHtml(edge.source)} \u2192 ${escapeHtml(edge.target)}</p>`;

	if (edge.type === 'extends') {
		html += `<p><em>Inheritance (extends)</em></p>`;
	} else {
		if (edge.relationTypes.length > 0) {
			html += `<details open><summary>Relationship Types (${edge.relationTypes.length})</summary><ul>${renderRelTypeTree(edge.relationTypes)}</ul></details>`;
		}
		if (edge.referenceAttrs.length > 0) {
			html += `<details open><summary>Reference Attributes (${edge.referenceAttrs.length})</summary><ul>${renderAttrTree(edge.referenceAttrs)}</ul></details>`;
		}
	}

	const edgeActions: InspectorAction[] = [
		{ label: `Show "${edge.source}" in Editor`, action: () => vscode.postMessage({ type: 'revealInEditor', nodeId: edge.source }) },
		{ label: `Show "${edge.target}" in Editor`, action: () => vscode.postMessage({ type: 'revealInEditor', nodeId: edge.target }) },
		{ label: `Show "${edge.source}" in Tree View`, action: () => vscode.postMessage({ type: 'revealInTreeView', nodeId: edge.source }) },
		{ label: `Show "${edge.target}" in Tree View`, action: () => vscode.postMessage({ type: 'revealInTreeView', nodeId: edge.target }) },
	];
	for (const rt of edge.relationTypes) {
		if (rt.uri) {
			edgeActions.push({ label: `Show "${rt.label}" in Editor`, action: () => vscode.postMessage({ type: 'revealUriInEditor', uri: rt.uri }) });
		}
	}
	createInspector(edge.label || 'Connection', html, cx, cy, edgeActions);
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== Message handling =====

window.addEventListener('message', (e: MessageEvent) => {
	const msg = e.data;
	if (msg.type === 'setGraph') {
		graph = msg.graph;
		needsFitViewBox = true;
		closeInspector();
		closeContextMenu();
		render();
	} else if (msg.type === 'setPositions' && graph) {
		for (const node of graph.nodes) {
			const pos = msg.positions[node.id];
			if (pos) { node.x = pos.x; node.y = pos.y; }
		}
		render();
	}
});

// ===== Bootstrap =====
init();
