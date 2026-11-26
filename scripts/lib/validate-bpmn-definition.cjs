'use strict';

/**
 * Structural BPMN checks. The rules are implemented in this file.
 * Reads text only. No network, no temp file, no process engine.
 */

const FLOW_NODE_TYPES = new Set([
	'startEvent',
	'endEvent',
	'intermediateCatchEvent',
	'intermediateThrowEvent',
	'boundaryEvent',
	'userTask',
	'serviceTask',
	'scriptTask',
	'sendTask',
	'receiveTask',
	'manualTask',
	'businessRuleTask',
	'task',
	'exclusiveGateway',
	'parallelGateway',
	'inclusiveGateway',
	'eventBasedGateway',
	'complexGateway',
	'subProcess',
	'callActivity',
	'transaction',
	'adHocSubProcess',
	'dataObject',
]);

const LEAF_TYPES = new Set([
	'dataObject',
	'textAnnotation',
	'association',
	'extensionElements',
	'endEvent',
	'documentation',
]);

function localName(typeName) {
	const idx = typeName.lastIndexOf(':');
	return idx >= 0 ? typeName.slice(idx + 1) : typeName;
}

function isNodeType(constType, typeName) {
	if (constType.toLowerCase() === typeName.toLowerCase()) return true;
	const idx = typeName.indexOf(':');
	if (idx > 0) {
		const prefix = typeName.slice(0, idx).toLowerCase();
		const name = typeName.slice(idx + 1);
		return prefix === 'bpmn' && constType.toLowerCase() === name.toLowerCase();
	}
	return false;
}

function parseAttrs(raw) {
	const attrs = {};
	const re = /([:\w.-]+)="([^"]*)"/g;
	let match;
	while ((match = re.exec(raw))) attrs[match[1]] = match[2];
	return attrs;
}

function parseDocument(xml) {
	if (/<!DOCTYPE/i.test(xml)) {
		return { error: 'Invalid BPMN XML: DOCTYPE is not allowed' };
	}
	const stripped = xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');
	const re = new RegExp('<(\\/?)([A-Za-z_][\\w:.-]*)([^>]*?)>', 'g');
	const root = { name: '#root', attrs: {}, children: [], text: '' };
	const stack = [root];
	let last = 0;
	for (const match of stripped.matchAll(re)) {
		const between = stripped.slice(last, match.index);
		if (between) stack[stack.length - 1].text += between;
		last = match.index + match[0].length;
		const closing = match[1] === '/';
		const name = match[2];
		const rest = match[3];
		const selfClose = /\/\s*$/.test(rest);
		if (closing) {
			const top = stack[stack.length - 1];
			if (stack.length === 1 || localName(top.name) !== localName(name)) {
				return { error: 'Invalid BPMN XML: not well-formed' };
			}
			stack.pop();
			continue;
		}
		const el = { name, attrs: parseAttrs(rest), children: [], text: '' };
		stack[stack.length - 1].children.push(el);
		if (!selfClose) stack.push(el);
	}
	if (stack.length !== 1) return { error: 'Invalid BPMN XML: not well-formed' };
	if (/[<>]/.test(stripped.slice(last))) return { error: 'Invalid BPMN XML: not well-formed' };
	return { root };
}

function elementText(el) {
	const parts = [el.text || ''];
	for (const child of el.children) parts.push(elementText(child));
	return parts.join('').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function directProcessChildren(root) {
	const children = [];
	const walk = el => {
		if (isNodeType('process', el.name)) {
			for (const child of el.children) children.push(child);
			return;
		}
		for (const child of el.children) walk(child);
	};
	walk(root);
	return children;
}

function allElements(root) {
	const out = [];
	const walk = el => {
		out.push(el);
		for (const child of el.children) walk(child);
	};
	walk(root);
	return out;
}

function conditionText(flowEl) {
	for (const child of flowEl.children) {
		if (isNodeType('conditionExpression', child.name)) return elementText(child);
	}
	return null;
}

function formProperties(userTask) {
	const props = [];
	for (const child of userTask.children) {
		if (!isNodeType('extensionElements', child.name)) continue;
		for (const inner of child.children) {
			if (!isNodeType('activiti:formProperty', inner.name)) continue;
			const values = [];
			for (const valueEl of inner.children) {
				if (isNodeType('activiti:value', valueEl.name) && valueEl.attrs.id) {
					values.push(valueEl.attrs.id);
				}
			}
			props.push({ id: inner.attrs.id || '', values });
		}
	}
	return props;
}

function hasExtensionElements(el) {
	return el.children.some(child => isNodeType('extensionElements', child.name));
}

function decisionParts(expr) {
	if (!expr || !expr.includes('==')) return null;
	const str = expr.replace(/\$/g, '').replace(/\{/g, '').replace(/\}/g, '').replace(/'/g, '');
	const tokens = str.split('==');
	return { variable: tokens[0], value: tokens[1] === undefined ? '' : tokens[1] };
}

function buildGraph(children) {
	const nodes = [];
	const flows = [];
	for (const el of children) {
		if (isNodeType('sequenceFlow', el.name)) {
			flows.push({
				id: el.attrs.id || '',
				source: el.attrs.sourceRef || '',
				target: el.attrs.targetRef || '',
				decision: conditionText(el),
			});
			continue;
		}
		if (isNodeType('userTask', el.name)) {
			if (!hasExtensionElements(el)) {
				return {
					error: `At least two form properties (decision,validator required for userTask, id [${el.attrs.id || ''}]`,
				};
			}
			nodes.push({
				id: el.attrs.id || '',
				name: el.attrs.name || '',
				type: el.name,
				formProperties: formProperties(el),
			});
			continue;
		}
		if (isNodeType('dataObject', el.name)) {
			const name = el.attrs.name || '';
			if (name === 'manualStart' || name === 'deleted') {
				for (const child of el.children) {
					const value = elementText(child).trim();
					if (value !== 'true' && value !== 'false') {
						return { error: `dataObject value not valid for id: ${el.attrs.id || ''}` };
					}
				}
			}
		}
		nodes.push({
			id: el.attrs.id || '',
			name: el.attrs.name || '',
			type: el.name,
			formProperties: [],
		});
	}
	return { nodes, flows };
}

function outgoing(flows, nodeId) {
	return flows.filter(flow => flow.source === nodeId);
}

function validateGraph(nodes, flows) {
	const errors = [];
	const byId = new Map(nodes.filter(node => node.id).map(node => [node.id, node]));
	for (const flow of flows) {
		if (flow.source && !byId.has(flow.source)) {
			errors.push(`Invalid source for sequenceFlow, Id: ${flow.id}`);
		}
		if (flow.target && !byId.has(flow.target)) {
			errors.push(`Invalid target for sequenceFlow, Id: ${flow.id}`);
		}
	}

	const starts = nodes.filter(node => isNodeType('startEvent', node.type));
	if (starts.length === 0) errors.push('No start event found');
	else if (starts.length > 1) errors.push('More than 1 start event found');

	for (const node of nodes) {
		if (outgoing(flows, node.id).length === 0 && !LEAF_TYPES.has(localName(node.type))) {
			errors.push(`Node cannot be a leaf. id: ${node.id}, type: ${localName(node.type)}`);
		}
	}

	const manualStart = nodes.some(
		node => node.id === 'manualStart' && node.name === 'manualStart',
	);
	if (!manualStart) errors.push('manualStart not found');

	for (const flow of flows) {
		const parts = decisionParts(flow.decision);
		if (!parts || parts.variable !== 'decision') continue;
		const incoming = flows.find(other => other.target === flow.source);
		const source = incoming ? byId.get(incoming.source) : undefined;
		if (!source || !isNodeType('userTask', source.type)) continue;
		const prop = source.formProperties.find(item => item.id === parts.variable);
		const found = prop && prop.values.some(value => value.toLowerCase() === parts.value.toLowerCase());
		if (!found) errors.push('decision enum value not found');
	}
	return errors;
}

function validateDiagram(root) {
	const elements = allElements(root);
	const shapes = elements.filter(el => localName(el.name) === 'BPMNShape');
	const edges = elements.filter(el => localName(el.name) === 'BPMNEdge');
	const shapeIds = new Set(shapes.map(el => el.attrs.bpmnElement).filter(Boolean));
	const edgeIds = new Set(edges.map(el => el.attrs.bpmnElement).filter(Boolean));
	const requiredNodes = [];
	const requiredFlows = [];
	for (const el of elements) {
		const name = localName(el.name);
		if (!el.attrs.id) continue;
		if (FLOW_NODE_TYPES.has(name)) requiredNodes.push(el.attrs.id);
		if (name === 'sequenceFlow') requiredFlows.push(el.attrs.id);
	}
	const missingShapes = requiredNodes.filter(id => !shapeIds.has(id));
	const missingEdges = requiredFlows.filter(id => !edgeIds.has(id));
	const missingBounds = shapes
		.filter(el => el.attrs.bpmnElement)
		.filter(el => !allElements(el).some(child => localName(child.name) === 'Bounds'))
		.map(el => el.attrs.bpmnElement);
	const missingWaypoints = edges
		.filter(el => el.attrs.bpmnElement)
		.filter(el => allElements(el).filter(child => localName(child.name) === 'waypoint').length < 2)
		.map(el => el.attrs.bpmnElement);
	if (!missingShapes.length && !missingEdges.length && !missingBounds.length && !missingWaypoints.length) {
		return [];
	}
	let message = 'BPMN DI is incomplete.';
	if (missingShapes.length) message += ` Missing shapes for: ${missingShapes.join(', ')}.`;
	if (missingEdges.length) message += ` Missing edges for: ${missingEdges.join(', ')}.`;
	if (missingBounds.length) message += ` Missing bounds for: ${missingBounds.join(', ')}.`;
	if (missingWaypoints.length) message += ` Missing waypoints for: ${missingWaypoints.join(', ')}.`;
	return [message];
}

function validateBpmnDefinition(xml, filename) {
	if (xml == null || String(xml).trim() === '') {
		return { ok: false, errors: ['BPMN content cannot be null or empty'] };
	}
	if (filename != null && !String(filename).endsWith('.bpmn20.xml')) {
		return { ok: false, errors: ['Incorrect BPMN file extension'] };
	}
	const parsed = parseDocument(String(xml));
	if (parsed.error) return { ok: false, errors: [parsed.error] };
	const processes = allElements(parsed.root).filter(el => isNodeType('process', el.name));
	if (processes.length === 0) {
		return { ok: false, errors: ['Invalid BPMN XML: not well-formed'] };
	}
	const built = buildGraph(directProcessChildren(parsed.root));
	if (built.error) return { ok: false, errors: [built.error] };
	const errors = [
		...validateGraph(built.nodes, built.flows),
		...validateDiagram(parsed.root),
	];
	return { ok: errors.length === 0, errors };
}

module.exports = { validateBpmnDefinition };
