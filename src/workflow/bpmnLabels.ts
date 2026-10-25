/**
 * How much room a label takes, and what it says.
 *
 * Shared by the layout engine and the renderer on purpose. `bpmnLayout.ts` runs
 * in the extension host, before any webview exists, so it cannot measure text
 * against a DOM; `bpmnView.ts` runs in the webview and draws it. When the two
 * disagreed about how wide a caption is — the layout reserving a 36-unit circle
 * and the renderer filling 130 units of text under it — the result was the
 * overlapping labels this module exists to remove. Both sides now call the same
 * function and get back the same strings, the same line breaks and the same box.
 *
 * Widths are estimated from an average glyph advance rather than measured. That
 * is an approximation, but a shared one: being uniformly a little generous
 * spreads a diagram out slightly, while disagreeing draws text across a shape.
 */
import type { Point } from './bpmnDiagram';
import type { BpmnFlowNode, BpmnSequenceFlow } from './bpmnModel';

/**
 * Font sizes, in the units both the SVG and the DI treat as pixels. These mirror
 * `.node-label`, `.node-detail` and `.flow-label` in `bpmnView.css`; changing one
 * without the other reintroduces exactly the mismatch described above.
 */
export const LABEL_FONT_SIZE = 11;
export const DETAIL_FONT_SIZE = 9;

/**
 * Average advance width as a fraction of the font size, for the proportional
 * UI font `.node-label` draws with (`--vscode-font-family`).
 *
 * Close to the mean for the sans-serif UI fonts VS Code resolves on all three
 * platforms, and deliberately on the high side: over-reserving leaves a gap,
 * under-reserving overlaps.
 */
const AVERAGE_GLYPH_RATIO = 0.55;

/**
 * Advance width as a fraction of the font size for `.node-detail` and
 * `.flow-label`, which are set in `--vscode-editor-font-family` — the user's
 * *editor* font, monospace by convention and usually by actual metric. A
 * monospace face runs wider per character than the proportional ratio above
 * assumes, and the gap is exactly what let a role name run past a task's
 * border with no visible ellipsis: the estimate said it fit inside the
 * viewBox `fitToContent` had already committed to, so the true, wider glyphs
 * were clipped by the SVG viewport instead of by this module's own truncation.
 */
const MONOSPACE_GLYPH_RATIO = 0.62;

/** Gap between a shape's bottom edge and the first line of the label beneath it. */
export const OUTSIDE_LABEL_GAP = 4;

/** Horizontal padding inside a task box, so its label never touches the border. */
export const TASK_LABEL_PADDING = 6;

/**
 * Widest a label drawn below a shape may grow before it is ellipsised.
 *
 * Nothing bounds it geometrically — a 36-unit event can carry an arbitrarily
 * long name — so the bound is chosen: wide enough that `ChangeRequestRejected`
 * survives intact, narrow enough that one verbose element does not set the
 * column width for the whole diagram.
 */
const MAX_OUTSIDE_LABEL_WIDTH = 132;

/** Widest a flow's condition may grow before it is ellipsised. */
const MAX_EDGE_LABEL_WIDTH = 150;

/** Lines a name may wrap to; past this it is ellipsised rather than wrapped on. */
const MAX_NAME_LINES = 2;

export function textWidth(text: string, fontSize: number, glyphRatio: number = AVERAGE_GLYPH_RATIO): number {
	return text.length * fontSize * glyphRatio;
}

export function lineHeight(fontSize: number): number {
	return Math.round(fontSize * 1.2);
}

export interface LabelBox {
	/** The exact strings to draw — already wrapped and already ellipsised. */
	readonly lines: readonly string[];
	readonly width: number;
	readonly height: number;
}

const EMPTY_LABEL: LabelBox = { lines: [], width: 0, height: 0 };

function ellipsise(text: string, maxWidth: number, fontSize: number, glyphRatio: number): string {
	if (textWidth(text, fontSize, glyphRatio) <= maxWidth) return text;
	const budget = Math.floor(maxWidth / (fontSize * glyphRatio)) - 1;
	// Below one surviving character there is no room for content plus an
	// ellipsis, and a lone "…" says less than a single clipped letter.
	return budget < 1 ? text.slice(0, 1) : `${text.slice(0, budget)}…`;
}

/**
 * Break one word that alone is wider than `maxWidth` into as many chunks as it
 * takes to each fit, each becoming its own line.
 *
 * `com.reltio.custom.dcr.CustomChangeRequestApply` and `ROLE_INITIATE_CHANGE_
 * REQUEST` are exactly the values this exists for: a dotted class name or an
 * underscore-joined role constant carries no space for the greedy wrap below
 * to break on, so left to it the "word" is placed whole and then ellipsised —
 * which is how a role name ran past its task's border with nothing readable to
 * show for the two extra lines of vertical room sitting unused beneath it.
 * Splitting mid-identifier reads worse than a wrapped space would, but it
 * shows the whole value, and the alternative is showing less of it for a
 * fixed cost in badness that widening never recovers.
 */
/**
 * Splits at most `maxChunks - 1` times, leaving everything past that in the
 * final chunk rather than continuing to slice it. The one caller (`layoutLabel`,
 * immediately below) runs every kept line through `ellipsise` afterwards, so a
 * final chunk that is still too long is trimmed there, the same as any other
 * overlong line — this only has to stop handing out whole-width lines once the
 * budget for this word is spent.
 */
function hardWrap(word: string, maxWidth: number, fontSize: number, glyphRatio: number, maxChunks: number): string[] {
	const chunks: string[] = [];
	let start = 0;
	while (start < word.length && chunks.length < maxChunks - 1) {
		let end = word.length;
		while (end > start + 1 && textWidth(word.slice(start, end), fontSize, glyphRatio) > maxWidth) end--;
		chunks.push(word.slice(start, end));
		start = end;
	}
	if (start < word.length) chunks.push(word.slice(start));
	return chunks;
}

/**
 * Wrap and clip a label to a box.
 *
 * Greedy word wrap: balanced lines would need the text measured twice and buy
 * nothing at two lines. A word that already exceeds the box on its own is hard
 * -wrapped rather than ellipsised on the spot, so a second line of allowance
 * is spent showing more of the value instead of being left empty while the
 * first line is cut short.
 */
export function layoutLabel(
	text: string | undefined,
	options: {
		readonly maxWidth: number;
		readonly fontSize: number;
		readonly maxLines: number;
		/** Defaults to the proportional UI font's ratio; pass the monospace one for `.node-detail`/`.flow-label` text. */
		readonly glyphRatio?: number;
	},
): LabelBox {
	const { maxWidth, fontSize, maxLines, glyphRatio = AVERAGE_GLYPH_RATIO } = options;
	const words = (text ?? '').trim().split(/\s+/).filter(Boolean);
	if (words.length === 0 || maxLines < 1) return EMPTY_LABEL;

	const wrapped: string[] = [];
	for (const word of words) {
		if (textWidth(word, fontSize, glyphRatio) > maxWidth) {
			const budget = Math.max(1, maxLines - wrapped.length);
			wrapped.push(...hardWrap(word, maxWidth, fontSize, glyphRatio, budget));
			continue;
		}
		const last = wrapped[wrapped.length - 1];
		if (last !== undefined && textWidth(`${last} ${word}`, fontSize, glyphRatio) <= maxWidth) {
			wrapped[wrapped.length - 1] = `${last} ${word}`;
		} else {
			wrapped.push(word);
		}
	}

	// Everything past the last allowed line is folded back into it rather than
	// dropped, so the ellipsis marks text that was omitted instead of implying
	// the label simply ended there.
	const kept =
		wrapped.length <= maxLines
			? wrapped
			: [...wrapped.slice(0, maxLines - 1), wrapped.slice(maxLines - 1).join(' ')];

	const lines = kept.map(line => ellipsise(line, maxWidth, fontSize, glyphRatio));
	return {
		lines,
		width: Math.max(...lines.map(line => textWidth(line, fontSize, glyphRatio))),
		height: lines.length * lineHeight(fontSize),
	};
}

/** The name drawn below an event or a gateway, which no shape bounds. */
export function outsideLabelBox(text: string | undefined): LabelBox {
	return layoutLabel(text, {
		maxWidth: MAX_OUTSIDE_LABEL_WIDTH,
		fontSize: LABEL_FONT_SIZE,
		maxLines: MAX_NAME_LINES,
	});
}

/** The name drawn inside a task, bounded by the box it sits in. */
export function taskLabelBox(text: string | undefined, shapeWidth: number): LabelBox {
	return layoutLabel(text, {
		maxWidth: shapeWidth - TASK_LABEL_PADDING * 2,
		fontSize: LABEL_FONT_SIZE,
		maxLines: MAX_NAME_LINES,
	});
}

/**
 * The role or delegate line under a task's name.
 *
 * Two lines, not one: `ROLE_INITIATE_CHANGE_REQUEST` and a class tail routinely
 * outrun a 100-unit task on a single line, and a task box is tall enough to
 * spare the second line — the name above it rarely uses both of its own two.
 * Monospace ratio, matching `.node-detail`'s `--vscode-editor-font-family`.
 */
export function taskDetailBox(text: string | undefined, shapeWidth: number): LabelBox {
	return layoutLabel(text, {
		maxWidth: shapeWidth - TASK_LABEL_PADDING * 2,
		fontSize: DETAIL_FONT_SIZE,
		maxLines: MAX_NAME_LINES,
		glyphRatio: MONOSPACE_GLYPH_RATIO,
	});
}

/**
 * A flow's caption, drawn along the connector.
 *
 * `available` is the length of the run it will sit on. Passing it is not
 * optional in practice: a connector between a gateway and the task beside it is
 * often 60-80 units, and a caption sized against a constant instead of against
 * that run is what drew `${quorumDecision == 'Approve'}` straight across the
 * gateway it belonged to and on into the task. It is still capped, because a
 * very long run does not make a very long expression worth reading.
 */
export function edgeLabelBox(text: string | undefined, available = MAX_EDGE_LABEL_WIDTH): LabelBox {
	return layoutLabel(text, {
		maxWidth: Math.min(MAX_EDGE_LABEL_WIDTH, available),
		fontSize: DETAIL_FONT_SIZE,
		maxLines: 1,
		glyphRatio: MONOSPACE_GLYPH_RATIO,
	});
}

/**
 * Vertical room a shape's outside label needs, including the gap above it.
 *
 * Zero for an unnamed element, so an anonymous gateway is not padded out for a
 * caption it does not have.
 */
export function outsideLabelBand(text: string | undefined): number {
	const box = outsideLabelBox(text);
	return box.height === 0 ? 0 : OUTSIDE_LABEL_GAP + box.height;
}

/** A shape's extent, which is all this module needs of a node to place its caption. */
export interface LabelledShape {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/**
 * The y a caption's first line starts at — below the shape, or above it when
 * below is occupied.
 *
 * Below is the convention and the default. It is also, for a gateway, exactly
 * where the engine routes the branch that leaves downward: `Quorum Decision`
 * was drawn under its diamond with the reject connector running straight
 * through the words. A caption is wider than the 36-unit shape it belongs to,
 * so this is not a near miss, it is the normal case for any gateway that fans
 * out vertically.
 *
 * Flipping is only worth doing if it helps, so above is taken only when it is
 * itself clear; a gateway that branches both ways keeps the conventional
 * position rather than trading one collision for another.
 */
export function outsideLabelTop(
	shape: LabelledShape,
	text: string | undefined,
	routes: readonly (readonly Point[])[],
): number {
	const box = outsideLabelBox(text);
	const below = shape.y + shape.height + OUTSIDE_LABEL_GAP;
	if (box.height === 0) return below;

	const at = (top: number) => ({
		x: shape.x + shape.width / 2 - box.width / 2,
		y: top,
		width: box.width,
		height: box.height,
	});

	const above = shape.y - OUTSIDE_LABEL_GAP - box.height;
	if (crossed(at(below), routes) && !crossed(at(above), routes)) return above;
	return below;
}

/**
 * Whether any connector runs through a box.
 *
 * Compares each segment's bounding box, which is the segment itself for the
 * orthogonal routes this renderer draws, and errs towards "crossed" for a
 * diagonal one. Erring that way costs a caption its conventional position;
 * erring the other way puts a line through the text.
 */
function crossed(box: LabelledShape, routes: readonly (readonly Point[])[]): boolean {
	for (const points of routes) {
		for (let i = 0; i < points.length - 1; i++) {
			const from = points[i];
			const to = points[i + 1];
			if (!from || !to) continue;
			const overlapsX = Math.min(from.x, to.x) <= box.x + box.width && Math.max(from.x, to.x) >= box.x;
			const overlapsY = Math.min(from.y, to.y) <= box.y + box.height && Math.max(from.y, to.y) >= box.y;
			if (overlapsX && overlapsY) return true;
		}
	}
	return false;
}

// ─── Where an edge's label goes ──────────────────────────────────────────────

/** A polyline segment within this many units of level counts as horizontal. */
const HORIZONTAL_TOLERANCE = 1;

/**
 * Anchor a flow's condition to the middle of its longest horizontal run.
 *
 * Using the first segment is cheaper and wrong. ELK leaves a gateway with a stub
 * a few units long before the route turns, so a label anchored to that segment is
 * drawn on top of the diamond — which is what put `${decision == 'Appr…` across
 * the gateway it belonged to. The longest horizontal run is the only part of an
 * orthogonal route with both room for the text and a consistent reading
 * direction.
 *
 * Falls back to the longest segment of any orientation, for a route that never
 * runs level, and returns nothing rather than guessing when there is no segment.
 */
export function edgeLabelAnchor(points: readonly Point[]): Point | undefined {
	return longestLevelRun(points)?.mid;
}

/** The run a caption will sit on: where its centre goes, and how long it is. */
function longestLevelRun(points: readonly Point[]): { mid: Point; length: number } | undefined {
	let level: { mid: Point; length: number } | undefined;
	let any: { mid: Point; length: number } | undefined;

	for (let i = 0; i < points.length - 1; i++) {
		const from = points[i];
		const to = points[i + 1];
		if (!from || !to) continue;
		const segment = {
			mid: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
			length: Math.hypot(to.x - from.x, to.y - from.y),
		};
		if (!any || segment.length > any.length) any = segment;
		if (Math.abs(to.y - from.y) <= HORIZONTAL_TOLERANCE) {
			if (!level || segment.length > level.length) level = segment;
		}
	}

	return level ?? any;
}

/**
 * Clearance left at each end of a run, so a caption stops short of the shapes
 * the connector joins rather than touching them.
 */
const EDGE_LABEL_MARGIN = 6;

/**
 * Where a flow's caption goes and what it says, decided together.
 *
 * Sizing and placement were two calls until a 148-unit condition was centred on
 * an 80-unit run, which put a third of it over the gateway and a third over the
 * task. They are one call now because the answer to "how wide may this be" is
 * "as wide as the run you are about to put it on", and nothing else can know
 * both. Returns nothing when there is no text or no run to hang it from.
 */
export function edgeLabel(
	text: string | undefined,
	points: readonly Point[],
): { readonly box: LabelBox; readonly anchor: Point } | undefined {
	const run = longestLevelRun(points);
	if (!run) return undefined;

	const box = edgeLabelBox(text, run.length - EDGE_LABEL_MARGIN * 2);
	return box.lines.length > 0 ? { box, anchor: run.mid } : undefined;
}

// ─── What a label says ───────────────────────────────────────────────────────

/**
 * An unnamed element is captioned with its id rather than left blank: a nameless
 * gateway is ordinary BPMN, and it still has to be findable on the diagram.
 */
export function nodeLabelText(node: BpmnFlowNode): string {
	return node.name ?? node.id;
}

/**
 * A condition of the single form `bpmn-rules.md` §4 shows and every OOTB
 * process actually uses: a form-property variable tested against one quoted
 * value, `${decision == 'Approve'}`. Matched loosely — either quote character,
 * either spacing around `==` — because the rule fixes the *shape*, not the
 * whitespace, and both appear in files this extension did not author.
 *
 * Anchored start-to-end deliberately: a compound condition
 * (`${a=='x' && b=='y'}`) does not match, and falls through to the full text
 * rather than to one arbitrary half of it.
 */
const SIMPLE_EQUALITY_CONDITION = /^\$\{\s*[\w.]+\s*==\s*(['"])([^'"]*)\1\s*\}$/;

/** The value side of a simple `${var == 'Value'}` condition, or nothing. */
function conditionValue(condition: string): string | undefined {
	return SIMPLE_EQUALITY_CONDITION.exec(condition.trim())?.[2];
}

/**
 * What a connector is captioned with: the flow's name, its condition's value,
 * or its condition verbatim — in that order of preference.
 *
 * Every BPMN tool prefers the name, and on a diagram it is the only one that
 * reliably fits — `Approve` against `${quorumDecision == 'Approve'}` on a run
 * of eighty units. Most Reltio conditions never get a `name` at all, though,
 * because the value already appears once in the `activiti:value id`; for
 * exactly that shape of condition, the value *is* effectively the name the
 * author would have given it, so it is read back out rather than showing the
 * JUEL a reviewer was never meant to parse off a diagram. Anything more
 * compound than that single comparison falls through to the raw condition,
 * unreadable on a short run but not silently wrong.
 */
export function flowLabelText(flow: BpmnSequenceFlow): string | undefined {
	if (flow.name) return flow.name;
	if (flow.condition === undefined) return undefined;
	return conditionValue(flow.condition) ?? flow.condition;
}

/**
 * The role a task is assigned to, or the delegate it runs.
 *
 * This is what makes the diagram Reltio's rather than a generic BPMN picture:
 * it is the field most often wrong and least visible in the XML.
 */
export function nodeDetailText(node: BpmnFlowNode): string | undefined {
	return node.candidateGroups ?? shortClassName(node.delegateClass);
}

/**
 * Show the last segment of a fully-qualified delegate class.
 *
 * `com.reltio.workflow.activiti.service.ChangeRequestApply` is 52 characters
 * against a 100-unit-wide task box. The distinguishing part is the tail, and the
 * full value is one hover away in the XML.
 */
function shortClassName(className: string | undefined): string | undefined {
	if (!className) return undefined;
	const tail = className.split('.').pop();
	return tail || className;
}
