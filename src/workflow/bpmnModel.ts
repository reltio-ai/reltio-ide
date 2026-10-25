/**
 * Structural read of a BPMN document: the process, its flow nodes and the
 * sequence flows between them.
 *
 * Deliberately not a parser. No XML parser is used anywhere in this extension —
 * see the note in `src/api/workflowAdapterClient.ts` — and adding one here would
 * put an XXE surface in the path of customer BPMN content for the sake of
 * reading four attributes off each element. The existing precedent is
 * `BPMNDI_BLOCK` in `src/workspace/workflowBpmnFiles.ts`, which strips the
 * diagram section with a bounded regex.
 *
 * What that buys and what it costs: a BPMN written by a modeller is a flat list
 * of elements inside one `<process>`, which is exactly what bounded regexes read
 * well. It does mean this module believes the document is well-formed. Every
 * consumer treats a thin or empty result as "nothing to draw" rather than an
 * error, so a malformed file degrades instead of throwing.
 *
 * Offsets and lengths are recorded on every element because they are the
 * difference between a diagnostic that lands on the offending task and one that
 * lands on line 1. `bpmnDiagnostics.ts` is what consumes them; they span the
 * opening tag only, which is where the attributes a finding is about live.
 */

/** Element names treated as flow nodes, in the shape they appear in a document. */
const FLOW_NODE_TAGS: readonly string[] = [
	'startEvent',
	'endEvent',
	'userTask',
	'serviceTask',
	'scriptTask',
	'receiveTask',
	'manualTask',
	'businessRuleTask',
	'sendTask',
	'callActivity',
	'subProcess',
	'exclusiveGateway',
	'parallelGateway',
	'inclusiveGateway',
	'eventBasedGateway',
	'intermediateCatchEvent',
	'intermediateThrowEvent',
	'boundaryEvent',
];

/** The three shapes a renderer and a layout engine need to tell apart. */
export type BpmnNodeShape = 'event' | 'gateway' | 'task';

export interface BpmnFlowNode {
	/** The element name without its namespace prefix, e.g. `userTask`. */
	readonly tag: string;
	readonly id: string;
	readonly name: string | undefined;
	readonly shape: BpmnNodeShape;
	/** `activiti:candidateGroups`, when present — a user task's assigned role. */
	readonly candidateGroups: string | undefined;
	/** `activiti:class`, when present — the delegate a service task runs. */
	readonly delegateClass: string | undefined;
	/**
	 * A gateway's `default` attribute — the flow taken when no condition matches.
	 * Its absence is what makes a process hang silently rather than fail, which is
	 * why it is read even though nothing draws it (`bpmn-rules.md` §4).
	 */
	readonly defaultFlow: string | undefined;
	/** `class` values of nested `<activiti:taskListener>` elements, by event. */
	readonly taskListeners: readonly BpmnTaskListener[];
	/**
	 * A `boundaryEvent`'s `attachedToRef` — the task it sits on the border of. `undefined` for
	 * every other node, and for a `boundaryEvent` missing the attribute (invalid BPMN, but this
	 * module degrades rather than throws — see the file's own doc comment).
	 */
	readonly attachedToRef: string | undefined;
	/** Character offset of the `<` that opens this element. */
	readonly offset: number;
	/** Length of the opening tag, so a range can cover it rather than one character. */
	readonly length: number;
}

/** One `<activiti:taskListener event="…" class="…" />` inside a task. */
export interface BpmnTaskListener {
	readonly event: string | undefined;
	readonly className: string | undefined;
}

export interface BpmnSequenceFlow {
	readonly id: string | undefined;
	readonly sourceRef: string | undefined;
	readonly targetRef: string | undefined;
	/**
	 * The flow's `name`, which is what a diagram captions the branch with — the
	 * author's own short word for it, `Approve`, where the condition is
	 * `${quorumDecision == 'Approve'}`. Read because a connector is a few dozen
	 * units long and the expression does not fit on one.
	 */
	readonly name: string | undefined;
	/** Inner text of a child `<conditionExpression>`, CDATA unwrapped. */
	readonly condition: string | undefined;
	readonly offset: number;
	readonly length: number;
}

/** An element whose id was already taken, recorded where `nodes` cannot hold it. */
export interface BpmnDuplicateElement {
	readonly id: string;
	readonly tag: string;
	readonly offset: number;
	readonly length: number;
}

export interface BpmnProcessModel {
	readonly processId: string | undefined;
	readonly processName: string | undefined;
	readonly isExecutable: boolean;
	readonly nodes: readonly BpmnFlowNode[];
	readonly flows: readonly BpmnSequenceFlow[];
	/**
	 * Flow nodes dropped from `nodes` because their id was already used.
	 *
	 * `nodes` is keyed by id — a layout and a renderer both need it to be — so a
	 * second element claiming the same id cannot live there. Discarding it outright
	 * would make the one error that invalidates every other id-based check in the
	 * file the one error nothing can see.
	 */
	readonly duplicates: readonly BpmnDuplicateElement[];
	/** Offset and length of the `<process>` opening tag, or `undefined` if absent. */
	readonly processTag: { readonly offset: number; readonly length: number } | undefined;
}

/** Matches the opening tag of the first `<process>`, with or without a prefix. */
const PROCESS_TAG = /<(?:[\w.-]+:)?process\b([^>]*)>/;

/**
 * Patterns used with the `g` flag are built per call, never shared as module
 * constants.
 *
 * A global regex carries `lastIndex` between uses, so a shared one would make
 * the second call on the same document start scanning from wherever the first
 * one stopped. That is a silently-wrong result, not a crash.
 */
const DIAGRAM_BLOCK_SOURCE = String.raw`<(?:[\w.-]+:)?BPMNDiagram\b[\s\S]*?<\/(?:[\w.-]+:)?BPMNDiagram>`;
const XML_COMMENT_SOURCE = String.raw`<!--[\s\S]*?-->`;

// ─── Attribute reading ───────────────────────────────────────────────────────

/**
 * Read one attribute out of an already-isolated tag body.
 *
 * `prefix` is matched optionally rather than literally: the same attribute is
 * `activiti:class` in a modeller's output and `class` in a document that made
 * Activiti its default namespace, and both deploy.
 */
function attribute(tagBody: string, name: string, allowPrefix = false): string | undefined {
	const namePattern = allowPrefix ? `(?:[\\w.-]+:)?${name}` : name;
	const match = new RegExp(`\\b${namePattern}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tagBody);
	if (!match) return undefined;
	const raw = match[1] ?? match[2];
	return raw === undefined ? undefined : unescapeXml(raw);
}

/**
 * Reverse the five escapes `escapeXml()` in `workflowDrafts.ts` applies.
 *
 * `&amp;` is done last so `&amp;lt;` — an escaped literal `&lt;` — comes back as
 * the text `&lt;` rather than being unescaped twice into `<`.
 */
export function unescapeXml(value: string): string {
	return value
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&');
}

function shapeFor(tag: string): BpmnNodeShape {
	if (tag.endsWith('Gateway')) return 'gateway';
	if (tag.endsWith('Event')) return 'event';
	return 'task';
}

// ─── Extraction ──────────────────────────────────────────────────────────────

/**
 * Blank out comments and the diagram block, preserving every character offset.
 *
 * Replacing with same-length runs of spaces rather than deleting is what keeps
 * the offsets this module reports pointing at the right place in the *original*
 * text. The diagram block goes because it carries `bpmnElement` attributes that
 * would otherwise be read as a second, phantom copy of every node.
 */
function blankIgnoredRegions(xml: string): string {
	const blank = (match: string): string => ' '.repeat(match.length);
	return xml
		.replace(new RegExp(XML_COMMENT_SOURCE, 'g'), blank)
		.replace(new RegExp(DIAGRAM_BLOCK_SOURCE, 'gi'), blank);
}

/**
 * Parse the document's first process.
 *
 * A BPMN may declare several processes; Reltio deploys one per file (the
 * filename is the process id — `bpmn-rules.md` §8), so the first is the subject
 * and any others are ignored rather than merged into it.
 */
export function extractProcessModel(xml: string): BpmnProcessModel {
	const scannable = blankIgnoredRegions(xml);
	const processMatch = PROCESS_TAG.exec(scannable);
	const processBody = processMatch?.[1] ?? '';
	// Nodes and flows are read from `processScope`, not `scannable`: a second `<process>` later
	// in the same file is free to reuse the same local ids as the first (they are two different
	// id spaces), so scanning the whole document folded the second process's nodes and flows
	// into the first's, reporting phantom duplicate ids and drawing flows between elements that
	// were never connected.
	const processScope = scopeToFirstProcess(scannable, processMatch);
	const { nodes, duplicates } = extractFlowNodes(processScope);

	return {
		processId: attribute(processBody, 'id'),
		processName: attribute(processBody, 'name'),
		isExecutable: attribute(processBody, 'isExecutable') === 'true',
		nodes,
		duplicates,
		flows: extractSequenceFlows(processScope),
		processTag: processMatch
			? { offset: processMatch.index, length: processMatch[0].length }
			: undefined,
	};
}

/**
 * Blank out everything outside the first `<process>`'s own body, the same same-length way
 * `blankIgnoredRegions()` blanks comments and the diagram block — so every offset this module
 * reports stays an absolute offset into the original `xml`, not an index into a shorter slice.
 *
 * Reltio deploys one process per file and the first `<process>` is already the one whose id and
 * name this module reports (see `extractProcessModel`'s own doc comment); this is what makes
 * `extractFlowNodes`/`extractSequenceFlows` agree, instead of reading every process in the file
 * as if it were one.
 */
function scopeToFirstProcess(scannable: string, processMatch: RegExpExecArray | null): string {
	if (!processMatch || processMatch[0].endsWith('/>')) {
		// No process at all, or a self-closing `<process … />` with no body to read.
		return ' '.repeat(scannable.length);
	}
	const bodyStart = processMatch.index + processMatch[0].length;
	const closing = /<\/(?:[\w.-]+:)?process\s*>/g;
	closing.lastIndex = bodyStart;
	const closeMatch = closing.exec(scannable);
	const bodyEnd = closeMatch ? closeMatch.index : scannable.length;

	return (
		' '.repeat(bodyStart) +
		scannable.slice(bodyStart, bodyEnd) +
		' '.repeat(scannable.length - bodyEnd)
	);
}

function extractFlowNodes(scannable: string): {
	nodes: BpmnFlowNode[];
	duplicates: BpmnDuplicateElement[];
} {
	const nodes: BpmnFlowNode[] = [];
	const duplicates: BpmnDuplicateElement[] = [];

	// Scanned tag by tag, then sorted into document order *before* ids are
	// claimed. Deduplicating during the scan would resolve a collision by tag
	// order instead — so the survivor of a `userTask`/`endEvent` id clash would be
	// whichever tag this list happens to name first, not the one the author wrote
	// first, and the finding would point at the wrong element.
	const candidates: { tag: string; body: string; offset: number; length: number; selfClosing: boolean }[] = [];
	for (const tag of FLOW_NODE_TAGS) {
		// Self-closing and paired forms both matter: `<endEvent id="end" />` and
		// `<userTask id="t">…</userTask>` are equally common, and only the opening
		// tag is read either way.
		const pattern = new RegExp(`<(?:[\\w.-]+:)?${tag}\\b([^>]*?)(\\/?)>`, 'g');
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(scannable)) !== null) {
			candidates.push({
				tag,
				body: match[1] ?? '',
				offset: match.index,
				length: match[0].length,
				selfClosing: match[2] === '/',
			});
		}
	}
	// Document order is the author's reading order and a stable tie-break for layout.
	candidates.sort((a, b) => a.offset - b.offset);

	const seen = new Set<string>();
	for (const candidate of candidates) {
		const { tag, body, offset, length } = candidate;
		const id = attribute(body, 'id');
		// A node without an id cannot be referenced by a flow or a diagram shape,
		// so it is unusable rather than merely incomplete.
		if (!id) continue;
		if (seen.has(id)) {
			duplicates.push({ id, tag, offset, length });
			continue;
		}
		seen.add(id);
		nodes.push({
			tag,
			id,
			name: attribute(body, 'name'),
			shape: shapeFor(tag),
			candidateGroups: attribute(body, 'candidateGroups', true),
			delegateClass: attribute(body, 'class', true),
			defaultFlow: attribute(body, 'default'),
			attachedToRef: tag === 'boundaryEvent' ? attribute(body, 'attachedToRef') : undefined,
			taskListeners: candidate.selfClosing
				? []
				: readTaskListeners(scannable, offset + length, tag),
			offset,
			length,
		});
	}

	return { nodes, duplicates };
}

/** `<activiti:taskListener event="create" class="…" />`, prefix optional. */
const TASK_LISTENER_SOURCE = String.raw`<(?:[\w.-]+:)?taskListener\b([^>]*?)\/?>`;

/**
 * Hard ceiling on how far `readTaskListeners()`/`readCondition()` will look for their
 * element's closing tag.
 *
 * Both are called once per task/flow, from inside `extractFlowNodes`'s and
 * `extractSequenceFlows`'s own loops over every element in the document. Without a ceiling,
 * each call that fails to find its closing tag (an unclosed or truncated element — malformed,
 * not necessarily malicious) scans all the way to the end of the document; a document with many
 * such elements turns one bad file into an O(n²) scan, the kind of cost a file only has to be
 * *opened* or *previewed*, not deployed, to pay. 20,000 characters comfortably covers any
 * legitimate task body or condition expression this extension has seen.
 */
const MAX_ELEMENT_BODY_SEARCH = 20_000;

/**
 * Find where an element's body ends, searching forward from `bodyStart` for `closingSource` but
 * never past `MAX_ELEMENT_BODY_SEARCH` characters — see that constant's own doc comment for why.
 * The window is sliced out and searched with a fresh, non-global regex, rather than seeking a
 * global one with `lastIndex`, specifically so a `.exec()` that fails to match cannot cost more
 * than scanning that one bounded slice.
 */
function findElementBodyEnd(scannable: string, bodyStart: number, closingSource: string): number {
	const windowEnd = Math.min(scannable.length, bodyStart + MAX_ELEMENT_BODY_SEARCH);
	const closeMatch = new RegExp(closingSource).exec(scannable.slice(bodyStart, windowEnd));
	return closeMatch ? bodyStart + closeMatch.index : windowEnd;
}

/**
 * Read the `<activiti:taskListener>` elements nested in one task.
 *
 * Scoped to this element's own body, not searched globally: `bpmn-rules.md` §3
 * requires *every* user task to carry both `create` listeners, so a process whose
 * first task has them and whose second does not is exactly the `errorCode 10044`
 * case worth catching — and a global search would report both tasks as fine.
 */
function readTaskListeners(scannable: string, bodyStart: number, tag: string): BpmnTaskListener[] {
	const bodyEnd = findElementBodyEnd(scannable, bodyStart, String.raw`<\/(?:[\w.-]+:)?${tag}\s*>`);
	const body = scannable.slice(bodyStart, bodyEnd);

	const listeners: BpmnTaskListener[] = [];
	const pattern = new RegExp(TASK_LISTENER_SOURCE, 'g');
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(body)) !== null) {
		const attributes = match[1] ?? '';
		listeners.push({
			event: attribute(attributes, 'event'),
			className: attribute(attributes, 'class', true),
		});
	}
	return listeners;
}

/** `<sequenceFlow …>` in either the self-closing or paired form. */
const SEQUENCE_FLOW_SOURCE = String.raw`<(?:[\w.-]+:)?sequenceFlow\b([^>]*?)(\/?)>`;
const CONDITION_EXPRESSION = /<(?:[\w.-]+:)?conditionExpression\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?conditionExpression>/;
const CDATA = /<!\[CDATA\[([\s\S]*?)\]\]>/;

function extractSequenceFlows(scannable: string): BpmnSequenceFlow[] {
	const flows: BpmnSequenceFlow[] = [];
	const pattern = new RegExp(SEQUENCE_FLOW_SOURCE, 'g');
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(scannable)) !== null) {
		const body = match[1] ?? '';
		const selfClosing = match[2] === '/';
		flows.push({
			id: attribute(body, 'id'),
			sourceRef: attribute(body, 'sourceRef'),
			targetRef: attribute(body, 'targetRef'),
			name: attribute(body, 'name'),
			condition: selfClosing
				? undefined
				: readCondition(scannable, match.index + match[0].length),
			offset: match.index,
			length: match[0].length,
		});
	}
	return flows;
}

/**
 * Read the condition out of a paired `<sequenceFlow>`'s body.
 *
 * Scoped to the text between this flow's opening tag and its closing tag rather
 * than searched globally, so a conditionless default flow cannot pick up the
 * condition belonging to the next flow in the file — which is the exact pair
 * `bpmn-rules.md` §4 says Activiti rejects, and the pair most worth getting
 * right.
 */
function readCondition(scannable: string, bodyStart: number): string | undefined {
	// Tag-aware, not a literal `indexOf('sequenceFlow>', …)`: a condition's text or CDATA content
	// that happens to contain that literal substring — e.g. referencing another flow's tag name in
	// a comment-like string — would otherwise truncate the body early. Optional namespace prefix
	// matches the convention `BPMNDI_BLOCK` in `workflowBpmnFiles.ts` uses for the same kind of
	// closing-tag search. Bounded by `findElementBodyEnd()` — see `MAX_ELEMENT_BODY_SEARCH`'s own
	// doc comment for why an unbounded search here is a per-flow cost, not a one-time one.
	const bodyEnd = findElementBodyEnd(scannable, bodyStart, String.raw`<\/(?:[\w.-]+:)?sequenceFlow\s*>`);
	const body = scannable.slice(bodyStart, bodyEnd);
	const expression = CONDITION_EXPRESSION.exec(body);
	if (!expression?.[1]) return undefined;

	const inner = expression[1];
	const cdata = CDATA.exec(inner);
	const text = (cdata?.[1] ?? inner).trim();
	return text ? unescapeXml(text) : undefined;
}

/** True when the document already carries a `<bpmndi:BPMNDiagram>` section. */
export function hasDiagramSection(xml: string): boolean {
	return new RegExp(DIAGRAM_BLOCK_SOURCE, 'i').test(xml);
}
