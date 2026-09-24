/**
 * The `bpmn-rules.md` §10 checklist, as code.
 *
 * Until now that checklist was walked by hand — by a person, or by an agent
 * asserting it had. Both produce the same failure: the deploy is rejected by
 * Activiti, or accepted and then the workflow hangs at runtime, and the answer
 * was sitting in the file the whole time. A rule that is only written down is
 * a rule that is checked when someone remembers to.
 *
 * Pure and `vscode`-free on purpose, like `bpmnModel.ts` and `bpmnDiagram.ts`:
 * every rule is a function of the document text, so the whole rule set is unit
 * tested without a VS Code host. `bpmnDiagnosticsManager.ts` is the thin adapter
 * that turns these into squiggles.
 *
 * ── Severity, and why some of this is a warning ─────────────────────────────
 *
 * A finding is an `error` when Activiti or a viewer will definitely reject or
 * mis-handle the file, and a `warning` when the rule holds for every workflow
 * built out of Reltio's own parts but can legitimately be broken by a customer
 * shipping their own JAR. Getting that line wrong in either direction is what
 * trains a user to ignore the Problems panel, so it is drawn deliberately per
 * rule rather than globally.
 */
import { isCompleteFor, readDiagramLayout, readPlaneElement } from './bpmnDiagram';
import { extractProcessModel, hasDiagramSection, type BpmnProcessModel } from './bpmnModel';

/**
 * The classes `bpmn-rules.md` §5 lists as shipped by Reltio.
 *
 * Exported so the linter and the skill cannot drift: §5 is a table in a markdown
 * file an agent reads, and this is the same set the editor checks against. A test
 * pins one against the other.
 */
export const RELTIO_SERVICE_CLASSES: readonly string[] = [
	'com.reltio.workflow.activiti.service.ChangeRequestApply',
	'com.reltio.workflow.activiti.service.ChangeRequestReject',
	'com.reltio.workflow.activiti.service.Merge',
	'com.reltio.workflow.activiti.service.NotAMatch',
	'com.reltio.workflow.activiti.service.Delete',
];

export const RELTIO_TASK_LISTENER_CLASSES: readonly string[] = [
	'com.reltio.workflow.activiti.service.TaskStartEventListener',
	'com.reltio.workflow.activiti.service.DCRTypeTaskListener',
	'com.reltio.workflow.activiti.service.EntityTypeTaskListener',
	'com.reltio.workflow.activiti.service.TaskAssignmentEventListener',
];

export const RELTIO_VALIDATOR_CLASSES: readonly string[] = [
	'com.reltio.workflow.core.task.validator.DataChangeRequestValidator',
	'com.reltio.workflow.core.task.validator.PotentialMatchTaskValidator',
];

export const RELTIO_EXECUTION_LISTENER_CLASSES: readonly string[] = [
	'com.reltio.workflow.activiti.service.DCRHasChangesListener',
];

/** Every class `bpmn-rules.md` §5 lists, in one set for membership checks. */
export const RELTIO_OOTB_CLASSES: readonly string[] = [
	...RELTIO_SERVICE_CLASSES,
	...RELTIO_TASK_LISTENER_CLASSES,
	...RELTIO_VALIDATOR_CLASSES,
	...RELTIO_EXECUTION_LISTENER_CLASSES,
];

/**
 * The two `create` listeners every `userTask` must carry (§3). Omitting either
 * produces `errorCode 10044` at runtime — not at deploy, which is what makes it
 * worth flagging in the editor.
 */
export const REQUIRED_USER_TASK_LISTENERS: readonly string[] = [
	'com.reltio.workflow.activiti.service.TaskStartEventListener',
	'com.reltio.workflow.activiti.service.DCRTypeTaskListener',
];

export type BpmnFindingSeverity = 'error' | 'warning';

export interface BpmnFinding {
	/** Character offset into the document text the range starts at. */
	readonly offset: number;
	readonly length: number;
	readonly message: string;
	readonly severity: BpmnFindingSeverity;
	/**
	 * Stable identifier, `reltio-bpmn/<rule>`. Shown in the Problems panel and is
	 * what a user filters on, so it is part of the contract rather than debug text.
	 */
	readonly code: string;
}

export interface BpmnDiagnosticsContext {
	/**
	 * The process id the file name claims, from `processIdFromBpmnFileName`.
	 *
	 * Reltio derives the deployed `processType` from the file name (§8) while the
	 * engine derives it from the `<process id>`. When the two disagree the deploy
	 * succeeds and starts the wrong workflow, so the check needs both and neither
	 * is available from the document alone.
	 */
	readonly fileProcessId?: string;
}

const FALLBACK_RANGE = { offset: 0, length: 1 };

/**
 * Run every rule over one document.
 *
 * Takes raw text rather than a parsed model because two of the rules are about
 * the diagram section, which `extractProcessModel` deliberately blanks out before
 * it scans. Findings come back in document order: the Problems panel sorts by
 * position, and matching that makes a diff of two runs readable.
 */
export function analyseBpmn(xml: string, context: BpmnDiagnosticsContext = {}): BpmnFinding[] {
	const model = extractProcessModel(xml);

	// No `<process>` at all is not a rule violation, it is a file that is not a
	// BPMN yet — a half-typed skeleton, or one being pasted into. Reporting ten
	// findings against it would squiggle every keystroke of authoring it.
	if (!model.processTag) return [];

	const findings: BpmnFinding[] = [
		...processFindings(model, context),
		...duplicateIdFindings(model),
		...flowEndpointFindings(model),
		...gatewayFindings(model),
		...userTaskListenerFindings(model),
		...classAllowListFindings(model),
		...diagramFindings(xml, model),
	];

	return findings.sort((a, b) => a.offset - b.offset || a.code.localeCompare(b.code));
}

// ─── §10.9 and §10.8 — the process element itself ────────────────────────────

function processFindings(
	model: BpmnProcessModel,
	context: BpmnDiagnosticsContext,
): BpmnFinding[] {
	const at = model.processTag ?? FALLBACK_RANGE;
	const findings: BpmnFinding[] = [];

	if (!model.isExecutable) {
		findings.push({
			...at,
			severity: 'error',
			code: 'reltio-bpmn/not-executable',
			message:
				'isExecutable must be "true". A non-executable process deploys successfully ' +
				'and then never runs.',
		});
	}

	// §8: the uploaded file name decides the deployed name, so a rename that did
	// not reach the XML produces a workflow under an id nobody is starting.
	if (
		context.fileProcessId !== undefined &&
		model.processId !== undefined &&
		model.processId !== context.fileProcessId
	) {
		findings.push({
			...at,
			severity: 'error',
			code: 'reltio-bpmn/id-filename-mismatch',
			message:
				`Process id "${model.processId}" does not match the file name ` +
				`"${context.fileProcessId}.bpmn20.xml". The file name sets the deployed name ` +
				'and the process id sets the processType; when they differ the deploy succeeds ' +
				'and the wrong workflow starts.',
		});
	}

	if (!model.processId) {
		findings.push({
			...at,
			severity: 'error',
			code: 'reltio-bpmn/missing-process-id',
			message: 'The process needs an id: it becomes the API processType.',
		});
	}

	return findings;
}

// ─── §10.1 — ids are unique ──────────────────────────────────────────────────

/**
 * A duplicate id is reported on the *second* occurrence and every one after it.
 *
 * Flagging the first as well would be even-handed and unhelpful: the first is
 * usually the one the author meant, and squiggling it sends them to edit the
 * element that is already correct.
 *
 * Flow nodes come from `model.duplicates` rather than `model.nodes`, because the
 * model is keyed by id and cannot hold the second claimant — see the field's note.
 */
function duplicateIdFindings(model: BpmnProcessModel): BpmnFinding[] {
	const findings: BpmnFinding[] = [];
	const seen = new Set(model.nodes.map(node => node.id));

	const duplicate = (id: string, offset: number, length: number): BpmnFinding => ({
		offset,
		length,
		severity: 'error',
		code: 'reltio-bpmn/duplicate-id',
		message: `Duplicate element id "${id}". Ids must be unique within the process.`,
	});

	for (const node of model.duplicates) {
		findings.push(duplicate(node.id, node.offset, node.length));
	}

	for (const flow of model.flows) {
		if (!flow.id) continue;
		if (seen.has(flow.id)) {
			findings.push(duplicate(flow.id, flow.offset, flow.length));
		}
		seen.add(flow.id);
	}

	return findings;
}

// ─── §10.2 — flows resolve ───────────────────────────────────────────────────

function flowEndpointFindings(model: BpmnProcessModel): BpmnFinding[] {
	const nodeIds = new Set(model.nodes.map(node => node.id));
	const findings: BpmnFinding[] = [];

	for (const flow of model.flows) {
		const name = flow.id ? `"${flow.id}"` : 'A sequenceFlow';

		if (!flow.id) {
			findings.push({
				offset: flow.offset,
				length: flow.length,
				severity: 'error',
				code: 'reltio-bpmn/missing-flow-id',
				message:
					'A sequenceFlow needs an id: a gateway names its default flow by id, and ' +
					'the diagram references it by id.',
			});
		}

		for (const [attribute, value] of [
			['sourceRef', flow.sourceRef],
			['targetRef', flow.targetRef],
		] as const) {
			if (value === undefined) {
				findings.push({
					offset: flow.offset,
					length: flow.length,
					severity: 'error',
					code: 'reltio-bpmn/missing-endpoint',
					message: `${name} has no ${attribute}.`,
				});
			} else if (!nodeIds.has(value)) {
				findings.push({
					offset: flow.offset,
					length: flow.length,
					severity: 'error',
					code: 'reltio-bpmn/unresolved-endpoint',
					message: `${name} points its ${attribute} at "${value}", which is not an element in this file.`,
				});
			}
		}
	}

	return findings;
}

// ─── §10.3 and §10.4 — gateways ──────────────────────────────────────────────

/**
 * The four gateway rules from §4, three of which Activiti rejects at deploy and
 * one of which — a missing `default` — it accepts and then hangs on forever with
 * no error at all. That last one is the reason this rule set exists.
 */
function gatewayFindings(model: BpmnProcessModel): BpmnFinding[] {
	const findings: BpmnFinding[] = [];
	const flowsById = new Map(model.flows.filter(f => f.id).map(f => [f.id as string, f]));

	for (const node of model.nodes) {
		if (node.shape !== 'gateway') continue;
		const outgoing = model.flows.filter(flow => flow.sourceRef === node.id);
		const at = { offset: node.offset, length: node.length };

		if (outgoing.length < 2) {
			findings.push({
				...at,
				severity: 'error',
				code: 'reltio-bpmn/gateway-outgoing-flows',
				message:
					`Gateway "${node.id}" has ${outgoing.length} outgoing flow${outgoing.length === 1 ? '' : 's'}. ` +
					'Activiti rejects a gateway with fewer than two; connect the elements directly instead.',
			});
		}

		// Only the exclusive gateway chooses one branch, so only it needs a
		// fallback. A parallel gateway takes every branch and has no default.
		if (node.tag !== 'exclusiveGateway') continue;

		if (!node.defaultFlow) {
			findings.push({
				...at,
				severity: 'warning',
				code: 'reltio-bpmn/gateway-no-default',
				message:
					`Exclusive gateway "${node.id}" has no default flow, so a value matching none of ` +
					'its conditions would strand the process instance here. Harmless if the ' +
					'conditions are exhaustive — a two-value required enum, say — which is why this ' +
					'is a warning; add default="<flowId>" to be sure.',
			});
			continue;
		}

		const fallback = flowsById.get(node.defaultFlow);
		if (!fallback) {
			findings.push({
				...at,
				severity: 'error',
				code: 'reltio-bpmn/default-flow-missing',
				message:
					`Exclusive gateway "${node.id}" names "${node.defaultFlow}" as its default, ` +
					'but no sequenceFlow has that id.',
			});
			continue;
		}

		if (fallback.sourceRef !== node.id) {
			findings.push({
				...at,
				severity: 'error',
				code: 'reltio-bpmn/default-flow-not-outgoing',
				message:
					`Exclusive gateway "${node.id}" names "${node.defaultFlow}" as its default, ` +
					'but that flow does not leave this gateway.',
			});
		}

		if (fallback.condition !== undefined) {
			findings.push({
				offset: fallback.offset,
				length: fallback.length,
				severity: 'error',
				code: 'reltio-bpmn/default-flow-has-condition',
				message:
					`"${fallback.id}" is the default flow of gateway "${node.id}", so it must carry ` +
					'no conditionExpression. Activiti rejects the deploy with ' +
					'activiti-exclusive-gateway-condition-on-seq-flow.',
			});
		}
	}

	return findings;
}

// ─── §10.5 — every userTask carries both create listeners ────────────────────

function userTaskListenerFindings(model: BpmnProcessModel): BpmnFinding[] {
	const findings: BpmnFinding[] = [];

	for (const node of model.nodes) {
		if (node.tag !== 'userTask') continue;

		const present = new Set(
			node.taskListeners
				.filter(listener => listener.event === 'create' && listener.className)
				.map(listener => listener.className as string),
		);
		const missing = REQUIRED_USER_TASK_LISTENERS.filter(required => !present.has(required));
		if (missing.length === 0) continue;

		findings.push({
			offset: node.offset,
			length: node.length,
			severity: 'error',
			code: 'reltio-bpmn/user-task-listeners',
			message:
				`User task "${node.id}" is missing ${missing.length === 1 ? 'the' : 'both'} required ` +
				`create listener${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}. ` +
				'Omitting either produces errorCode 10044 at runtime.',
		});
	}

	return findings;
}

// ─── §10.6 — classes come from §5 or from your own JAR ───────────────────────

/**
 * Reported as a **warning**, not an error.
 *
 * An invented class name is the most common cause of a workflow that deploys and
 * then fails at runtime, so it is worth surfacing. But a customer shipping their
 * own JAR supplies classes that are legitimately outside §5, and this check
 * cannot see that JAR — so an error here would be wrong for every tenant that
 * has one, and those users would learn to ignore the panel.
 */
function classAllowListFindings(model: BpmnProcessModel): BpmnFinding[] {
	const known = new Set(RELTIO_OOTB_CLASSES);
	const findings: BpmnFinding[] = [];

	for (const node of model.nodes) {
		const at = { offset: node.offset, length: node.length };

		if (node.delegateClass && !known.has(node.delegateClass)) {
			findings.push({
				...at,
				severity: 'warning',
				code: 'reltio-bpmn/unknown-class',
				message:
					`"${node.delegateClass}" is not one of the classes Reltio ships. If it is not in ` +
					'a JAR you have deployed to this tenant, the workflow will deploy and then ' +
					'fail at runtime.',
			});
		}

		for (const listener of node.taskListeners) {
			if (!listener.className || known.has(listener.className)) continue;
			findings.push({
				...at,
				severity: 'warning',
				code: 'reltio-bpmn/unknown-class',
				message:
					`Task listener "${listener.className}" on "${node.id}" is not one of the classes ` +
					'Reltio ships. If it is not in a JAR you have deployed to this tenant, the ' +
					'workflow will deploy and then fail at runtime.',
			});
		}
	}

	return findings;
}

// ─── §10.11 — the diagram section ────────────────────────────────────────────

/**
 * A missing or mis-pointed diagram section deploys and runs perfectly, and is
 * invisible in every viewer — the console, Camunda Modeler, this extension's own
 * preview. That combination is why it is checked here rather than trusted: there
 * is no runtime signal at all, only a reviewer looking at a blank canvas.
 */
function diagramFindings(xml: string, model: BpmnProcessModel): BpmnFinding[] {
	const at = model.processTag ?? FALLBACK_RANGE;

	if (!hasDiagramSection(xml)) {
		return [
			{
				...at,
				severity: 'warning',
				code: 'reltio-bpmn/no-diagram',
				message:
					'No bpmndi:BPMNDiagram section. The process will deploy and run, and will ' +
					'render as a blank canvas in the Reltio console, in Camunda Modeler and in ' +
					'Show BPMN Diagram — so nobody can review it.',
			},
		];
	}

	const findings: BpmnFinding[] = [];
	const plane = readPlaneElement(xml);

	if (model.processId && plane !== undefined && plane !== model.processId) {
		findings.push({
			...at,
			severity: 'error',
			code: 'reltio-bpmn/plane-mismatch',
			message:
				`The diagram's plane describes "${plane}", but this process is "${model.processId}". ` +
				'A plane pointing at a missing id renders nothing at all — this is what breaks a ' +
				'copied definition whose id was changed.',
		});
	}

	const layout = readDiagramLayout(xml);
	if (!isCompleteFor(layout, model)) {
		const undrawn = model.nodes.filter(node => !layout.bounds.has(node.id));
		for (const node of undrawn) {
			findings.push({
				offset: node.offset,
				length: node.length,
				severity: 'warning',
				code: 'reltio-bpmn/no-shape',
				message:
					`"${node.id}" has no BPMNShape, so viewers draw the rest of the diagram without ` +
					'it. Partial diagram information is worse than none: what is drawn looks ' +
					'correct, so the missing elements read as not being in the workflow.',
			});
		}
	}

	return findings;
}
