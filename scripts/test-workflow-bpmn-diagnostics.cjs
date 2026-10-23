#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: workflow-bpmn-diagnostics
 *
 * Every rule in this suite asserts two things, not one: that the finding is
 * raised, and that its range lands on the element at fault. A diagnostic on line
 * 1 of a 90-line file is barely better than no diagnostic — it says something is
 * wrong and makes the reader search — so the position is part of the behaviour
 * rather than an implementation detail.
 *
 * Tier A — pure rules, no I/O, no VS Code host:
 *   1.  A clean document, and the skeleton the IDE itself writes, both produce
 *       nothing. This is the assertion that keeps the feature usable: a rule set
 *       that squiggles a correct file is one users switch off.
 *   2.  A document with no `<process>` is silent. Half-typed XML is authoring in
 *       progress, not ten violations.
 *   3.  §10.1 duplicate ids, reported on the second occurrence, including across
 *       element types and between a node and a flow.
 *   4.  §10.2 `sourceRef`/`targetRef` missing or unresolvable.
 *   5.  §10.3 exclusive gateway with no `default`; a `default` naming no flow;
 *       a `default` naming a flow that leaves a different gateway; and a default
 *       flow carrying a condition — the pair Activiti rejects outright.
 *   6.  §10.4 a gateway with no outgoing flow or a one-in-one-out pass-through (a join is valid), and a parallel
 *       gateway not being asked for a default it has no concept of.
 *   7.  §10.5 a `userTask` missing either `create` listener, on every task and
 *       not only the first.
 *   8.  §10.6 an `activiti:class` outside §5, as a warning — a customer JAR
 *       legitimately supplies its own.
 *   9.  §10.9 `isExecutable`, and §8 process id against the file name.
 *  10.  §10.11 no diagram section; a plane naming another process; an element
 *       with no shape.
 *  11.  The §5 allow-list in code and the §5 tables in `bpmn-rules.md` are the
 *       same set — the linter and the skill reading from one source is the point
 *       of exporting it.
 *
 * Tier B — the editor adapter and its wiring:
 *  12.  Ranges become `vscode.Range`s over the right text; the severity setting
 *       acts as a floor and `off` suppresses everything; a baseline file is never
 *       squiggled; `clear` empties one document without touching another.
 *  13.  Declared in package.json, wired into all three document listeners, and
 *       registered in the runner's hardcoded SCRIPTS array.
 *
 * Tier C (manual) — documented in design.md's test plan.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');
const vscode = require('./lib/vscode-stub.cjs');

const { analyseBpmn, RELTIO_OOTB_CLASSES, REQUIRED_USER_TASK_LISTENERS } =
	importDist('workflow/bpmnDiagnostics');
const { BpmnDiagnosticsManager, bpmnProcessIdForDocument } =
	importDist('workflow/bpmnDiagnosticsManager');
const { buildBpmnSkeleton } = importDist('workspace/workflowDrafts');
const { extractProcessModel } = importDist('workflow/bpmnModel');
const { renderDiagramSection, layoutChain, withDiagramSection } = importDist('workflow/bpmnDiagram');
const repoRoot = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const LISTENERS = `      <extensionElements>
        <activiti:taskListener event="create"
          class="com.reltio.workflow.activiti.service.TaskStartEventListener" />
        <activiti:taskListener event="create"
          class="com.reltio.workflow.activiti.service.DCRTypeTaskListener" />
      </extensionElements>`;
/**
 * A document that must satisfy every rule, built from parts so each fixture below
 * can break exactly one thing. Sections are interpolated rather than replaced by
 * regex so a fixture's intent is readable at its call site.
 */
function buildFixture(options = {}) {
	const {
		processId = 'review',
		isExecutable = 'true',
		gatewayDefault = ' default="flowReject"',
		rejectCondition = '',
		reviewListeners = LISTENERS,
		applyClass = 'com.reltio.workflow.activiti.service.ChangeRequestApply',
		extra = '',
		diagram = true,
		planeId = undefined,
	} = options;

	const body = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:activiti="http://activiti.org/bpmn"
             xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
             xmlns:omgdc="http://www.omg.org/spec/DD/20100524/DC"
             xmlns:omgdi="http://www.omg.org/spec/DD/20100524/DI">
  <process id="${processId}" name="Review" isExecutable="${isExecutable}">
    <startEvent id="start" name="Start" />
    <sequenceFlow id="flow1" sourceRef="start" targetRef="reviewTask" />
    <userTask id="reviewTask" name="Review" activiti:candidateGroups="ROLE_STEWARD">
${reviewListeners}
    </userTask>
    <sequenceFlow id="flow2" sourceRef="reviewTask" targetRef="decision" />
    <exclusiveGateway id="decision" name="Approved?"${gatewayDefault} />
    <sequenceFlow id="flowApprove" sourceRef="decision" targetRef="applyTask">
      <conditionExpression><![CDATA[\${decision=='Approve'}]]></conditionExpression>
    </sequenceFlow>
    <sequenceFlow id="flowReject" sourceRef="decision" targetRef="end">${rejectCondition}</sequenceFlow>
    <serviceTask id="applyTask" name="Apply" activiti:class="${applyClass}" />
    <sequenceFlow id="flow5" sourceRef="applyTask" targetRef="end" />
    <endEvent id="end" name="End" />
${extra}
  </process>
</definitions>
`;

	if (!diagram) return body;
	const model = extractProcessModel(body);
	const layout = layoutChain(model.nodes, model.flows);
	return withDiagramSection(body, renderDiagramSection(planeId ?? processId, model, layout));
}

/** Findings for a code, or all of them when no code is given. */
function findingsFor(xml, code, context = { fileProcessId: 'review' }) {
	const all = analyseBpmn(xml, context);
	return code ? all.filter(f => f.code === code) : all;
}

/** The document text a finding's range actually covers. */
function textAt(xml, finding) {
	return xml.slice(finding.offset, finding.offset + finding.length);
}
/** Exactly one finding for `code`, whose range covers `expected`. */
function expectOne(xml, code, expected, context) {
	const hits = findingsFor(xml, code, context);
	assert.strictEqual(hits.length, 1, `expected exactly one ${code}, got ${hits.length}`);
	const covered = textAt(xml, hits[0]);
	assert.ok(
		covered.includes(expected),
		`${code}: the range covers ${JSON.stringify(covered)}, which does not contain ` +
		`${JSON.stringify(expected)} — a finding on the wrong element makes the reader search`,
	);
	return hits[0];
}

// ── 1. A correct document produces nothing ──────────────────────────────────
{
	const clean = buildFixture();
	assert.deepStrictEqual(
		analyseBpmn(clean, { fileProcessId: 'review' }),
		[],
		`a compliant document must be silent, got: ${JSON.stringify(analyseBpmn(clean, { fileProcessId: 'review' }), null, 2)}`,
	);

	// The one document this extension writes itself. A new draft that opens with
	// squiggles on it teaches the user that the squiggles are noise, and it is the
	// skeleton that is wrong in that case, not the rules — the skeleton shipped
	// without §3's two create listeners until this suite asked for them.
	const skeleton = buildBpmnSkeleton('myApproval', 'My Approval');
	assert.deepStrictEqual(
		analyseBpmn(skeleton, { fileProcessId: 'myApproval' }),
		[],
		`New Workflow… must produce a clean draft, got: ${JSON.stringify(analyseBpmn(skeleton, { fileProcessId: 'myApproval' }), null, 2)}`,
	);

	// Findings come back in document order, matching how the Problems panel sorts.
	const noisy = buildFixture({ isExecutable: 'false', gatewayDefault: '', diagram: false });
	const offsets = analyseBpmn(noisy, { fileProcessId: 'review' }).map(f => f.offset);
	assert.deepStrictEqual(offsets, [...offsets].sort((a, b) => a - b));
}

// ── 2. Not-yet-a-BPMN is silent ─────────────────────────────────────────────
{
	for (const partial of ['', '<?xml version="1.0"?>', '<definitions>', '<definitions></definitions>']) {
		assert.deepStrictEqual(
			analyseBpmn(partial, { fileProcessId: 'review' }), [],
			`"${partial}" is a file being typed, not ten rule violations`,
		);
	}
}

// ── 3. §10.1 Duplicate ids ──────────────────────────────────────────────────
{
	// Same element type twice.
	const twice = buildFixture({ extra: '    <endEvent id="end" name="End again" />' });
	const hit = expectOne(twice, 'reltio-bpmn/duplicate-id', 'End again');
	assert.strictEqual(hit.severity, 'error');
	assert.ok(hit.message.includes('"end"'), 'the message must name the id');

	// Across element types, resolved by document order rather than by which tag
	// name the scanner happens to reach first.
	const crossType = buildFixture({ extra: '    <userTask id="start" name="Clashes with the event" />' });
	expectOne(crossType, 'reltio-bpmn/duplicate-id', 'Clashes with the event');

	// A flow taking a node's id. Nothing in the file can then say which it means.
	const flowClash = buildFixture({
		extra: '    <sequenceFlow id="end" sourceRef="start" targetRef="end" />',
	});
	expectOne(flowClash, 'reltio-bpmn/duplicate-id', 'sequenceFlow id="end"');

	// The first occurrence is left alone: it is usually the one the author meant,
	// and squiggling it sends them to edit the element that is already correct.
	const first = twice.indexOf('id="end"');
	for (const finding of findingsFor(twice, 'reltio-bpmn/duplicate-id')) {
		assert.ok(finding.offset > first, 'only the later occurrence is reported');
	}
}

// ── 4. §10.2 Endpoints resolve ──────────────────────────────────────────────
{
	const dangling = buildFixture({
		extra: '    <sequenceFlow id="ghost" sourceRef="start" targetRef="doesNotExist" />',
	});
	const hit = expectOne(dangling, 'reltio-bpmn/unresolved-endpoint', 'ghost');
	assert.strictEqual(hit.severity, 'error');
	assert.ok(hit.message.includes('targetRef'), 'the message must say which end');
	assert.ok(hit.message.includes('doesNotExist'));

	const headless = buildFixture({
		extra: '    <sequenceFlow id="headless" targetRef="end" />',
	});
	expectOne(headless, 'reltio-bpmn/missing-endpoint', 'headless');

	const anonymous = buildFixture({
		extra: '    <sequenceFlow sourceRef="start" targetRef="end" />',
	});
	const noId = expectOne(anonymous, 'reltio-bpmn/missing-flow-id', 'sourceRef="start"');
	assert.strictEqual(noId.severity, 'error');
}

// ── 5. §10.3 The default flow ───────────────────────────────────────────────
{
    // No default at all: an unmatched value strands the instance at the gateway.
    // Reported as a *warning*, not an error, and the distinction is the whole
    // point of the severity split. Activiti does not reject this at deploy, and
    // conditions over a required two-value enum — the shape every Reltio review
    // workflow uses — are exhaustive, so the gateway provably cannot strand
    // anything. An error here fires on correct, already-deployed definitions,
    // and a panel that cries wolf on those is a panel users switch off.
    const noDefault = buildFixture({ gatewayDefault: '' });
    const missing = expectOne(noDefault, 'reltio-bpmn/gateway-no-default', 'exclusiveGateway id="decision"');
    assert.strictEqual(
        missing.severity, 'warning',
        'Activiti accepts this deploy and exhaustive conditions make it unreachable, so by the ' +
        'severity rule in ARCHITECTURE.md it cannot be an error',
    );
    assert.ok(
        !/hangs the process instance forever, with no error/.test(missing.message),
        'Activiti raises an exception when no flow can be selected, so the message must not ' +
        'promise a silent hang',
    );

	// A default naming a flow that is not in the file.
	const ghostDefault = buildFixture({ gatewayDefault: ' default="notAFlow"' });
	expectOne(ghostDefault, 'reltio-bpmn/default-flow-missing', 'exclusiveGateway id="decision"');
	assert.strictEqual(findingsFor(ghostDefault, 'reltio-bpmn/gateway-no-default').length, 0);

	// A default naming a real flow that leaves something else — plausible after a
	// copy/paste, and it hangs the same way a missing default does.
	const foreignDefault = buildFixture({ gatewayDefault: ' default="flow1"' });
	expectOne(foreignDefault, 'reltio-bpmn/default-flow-not-outgoing', 'exclusiveGateway id="decision"');

	// A default carrying a condition: rejected at deploy, so the range goes on the
	// flow rather than the gateway — the flow is the element to edit.
	const conditioned = buildFixture({
		rejectCondition: `
      <conditionExpression><![CDATA[\${decision=='Reject'}]]></conditionExpression>
    `,
	});
	const both = expectOne(conditioned, 'reltio-bpmn/default-flow-has-condition', 'sequenceFlow id="flowReject"');
	assert.strictEqual(both.severity, 'error');
	assert.ok(
		both.message.includes('activiti-exclusive-gateway-condition-on-seq-flow'),
		'the message must carry the error Activiti will actually return',
	);
}

// ── 6. §10.4 Outgoing flow count ────────────────────────────────────────────
{
	const oneWay = `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <process id="review" name="R" isExecutable="true">
    <startEvent id="start" />
    <sequenceFlow id="f1" sourceRef="start" targetRef="lonely" />
    <exclusiveGateway id="lonely" default="f2" />
    <sequenceFlow id="f2" sourceRef="lonely" targetRef="end" />
    <endEvent id="end" />
  </process>
</definitions>`;
	const hit = expectOne(oneWay, 'reltio-bpmn/gateway-outgoing-flows', 'exclusiveGateway id="lonely"', {});
	assert.strictEqual(hit.severity, 'error');
	assert.ok(hit.message.includes('1 outgoing flow'), 'the count must be in the message');

	// A parallel gateway takes every branch, so it has no default to be missing.
	const parallel = `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <process id="review" name="R" isExecutable="true">
    <startEvent id="start" />
    <sequenceFlow id="f1" sourceRef="start" targetRef="fork" />
    <parallelGateway id="fork" />
    <sequenceFlow id="f2" sourceRef="fork" targetRef="a" />
    <sequenceFlow id="f3" sourceRef="fork" targetRef="b" />
    <endEvent id="a" />
    <endEvent id="b" />
  </process>
</definitions>`;
	assert.strictEqual(
		findingsFor(parallel, 'reltio-bpmn/gateway-no-default', {}).length, 0,
		'a parallel gateway has no concept of a default flow',
	);
	assert.strictEqual(findingsFor(parallel, 'reltio-bpmn/gateway-outgoing-flows', {}).length, 0);
}

// ── 7. §10.5 Both create listeners, on every user task ──────────────────────
{
	const none = buildFixture({ reviewListeners: '' });
	const hit = expectOne(none, 'reltio-bpmn/user-task-listeners', 'userTask id="reviewTask"');
	assert.strictEqual(hit.severity, 'error');
	assert.ok(hit.message.includes('10044'), 'the message must carry the error code it produces');
	for (const required of REQUIRED_USER_TASK_LISTENERS) {
		assert.ok(hit.message.includes(required), `the message must name ${required}`);
	}

	// One of two is still a runtime failure.
	const half = buildFixture({
		reviewListeners: `      <extensionElements>
        <activiti:taskListener event="create"
          class="com.reltio.workflow.activiti.service.TaskStartEventListener" />
      </extensionElements>`,
	});
	const partial = expectOne(half, 'reltio-bpmn/user-task-listeners', 'userTask id="reviewTask"');
	assert.ok(partial.message.includes('DCRTypeTaskListener'));
	assert.ok(
		!partial.message.includes('TaskStartEventListener'),
		'only the missing listener is named, or the message sends the reader to re-add one they have',
	);

	// The right event: both classes present but on `assignment` satisfies nothing.
	const wrongEvent = buildFixture({
		reviewListeners: LISTENERS.replace(/event="create"/g, 'event="assignment"'),
	});
	assert.strictEqual(findingsFor(wrongEvent, 'reltio-bpmn/user-task-listeners').length, 1);

	// §3 applies to every user task, not the first. A second task with no
	// listeners is the case a global search for the classes would call clean.
	const second = buildFixture({
		extra: `    <userTask id="clarifyTask" name="Clarify" activiti:candidateGroups="ROLE_STEWARD">
${LISTENERS.replace(/class="[^"]*"/g, 'class="com.reltio.workflow.activiti.service.TaskStartEventListener"')}
    </userTask>`,
	});
	const secondHits = findingsFor(second, 'reltio-bpmn/user-task-listeners');
	assert.strictEqual(secondHits.length, 1, 'the compliant first task must not be reported');
	assert.ok(textAt(second, secondHits[0]).includes('clarifyTask'));

	// Listeners belong to the task that encloses them: a self-closing user task
	// followed by a compliant one must not borrow its neighbour's.
	const selfClosing = buildFixture({
		extra: '    <userTask id="bare" name="Bare" />',
	});
	const bareHits = findingsFor(selfClosing, 'reltio-bpmn/user-task-listeners');
	assert.strictEqual(bareHits.length, 1);
	assert.ok(textAt(selfClosing, bareHits[0]).includes('bare'));
}

// ── 6b. Joins are valid; dead ends and pass-throughs are not ────────────────
{
	const join = `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <process id="review" name="R" isExecutable="true">
    <startEvent id="start" />
    <sequenceFlow id="f1" sourceRef="start" targetRef="merge" />
    <sequenceFlow id="f2" sourceRef="start" targetRef="merge" />
    <exclusiveGateway id="merge" />
    <sequenceFlow id="f3" sourceRef="merge" targetRef="end" />
    <endEvent id="end" />
  </process>
</definitions>`;
	assert.deepStrictEqual(
		findingsFor(join, undefined, {}).filter(f => /gateway/.test(f.code)), [],
		'an exclusive join (two in, one out) reports nothing, and gets no missing-default warning',
	);

	const deadEnd = join.replace('<sequenceFlow id="f3" sourceRef="merge" targetRef="end" />', '');
	expectOne(deadEnd, 'reltio-bpmn/gateway-outgoing-flows', 'exclusiveGateway id="merge"', {});
}

// ── 7b. The type listener follows the process kind ──────────────────────────
{
	const only = className => `      <extensionElements>
        <activiti:taskListener event="create"
          class="com.reltio.workflow.activiti.service.TaskStartEventListener" />
        <activiti:taskListener event="create" class="${className}" />
      </extensionElements>`;
	const DCR = 'com.reltio.workflow.activiti.service.DCRTypeTaskListener';
	const ENTITY = 'com.reltio.workflow.activiti.service.EntityTypeTaskListener';
	const hits = (processId, className) => findingsFor(
		buildFixture({ processId, reviewListeners: className ? only(className) : '' }),
		'reltio-bpmn/user-task-listeners', { fileProcessId: processId },
	);

	assert.strictEqual(hits('potentialMatchReview', ENTITY).length, 0, 'entity listener satisfies potentialMatchReview');
	assert.strictEqual(hits('potentialMatchReview', DCR).length, 1, 'the DCR listener does not satisfy potentialMatchReview');
	assert.strictEqual(hits('dataChangeRequestReview', DCR).length, 0);
	assert.strictEqual(hits('dataChangeRequestReview', ENTITY).length, 1, 'the entity listener does not satisfy a DCR review');
	assert.strictEqual(hits('dataChangeRequestReview', undefined).length, 1);
	for (const listener of [DCR, ENTITY]) {
		assert.strictEqual(hits('customReview', listener).length, 0, `any process accepts ${listener}`);
	}
	assert.strictEqual(hits('customReview', undefined).length, 1);

	// `RelationTypeTaskListener` is deliberately excluded from the above, even though the public
	// Reltio Workflow source defines it (bpmn-rules.md §12.5): it is not yet on the §5 allow-list
	// either, so a task using it must be flagged by *both* checks consistently, rather than this
	// one accepting it while `reltio-bpmn/unknown-class` warns on the same class.
	const RELATION = 'com.reltio.workflow.activiti.service.RelationTypeTaskListener';
	assert.strictEqual(
		hits('customReview', RELATION).length, 1,
		'RelationTypeTaskListener is not yet wired into enforcement and must not satisfy the check',
	);
	const relationFixture = buildFixture({ processId: 'customReview', reviewListeners: only(RELATION) });
	const unknownClassHits = findingsFor(relationFixture, 'reltio-bpmn/unknown-class', { fileProcessId: 'customReview' });
	assert.strictEqual(
		unknownClassHits.length, 1,
		'the same class must also warn as unknown — not satisfy one check while tripping the other',
	);
}

// ── 8. §10.6 The class allow-list ───────────────────────────────────────────
{
	const invented = buildFixture({ applyClass: 'com.acme.workflow.DoTheThing' });
	const hit = expectOne(invented, 'reltio-bpmn/unknown-class', 'serviceTask id="applyTask"');
	assert.strictEqual(
		hit.severity, 'warning',
		'a customer shipping their own JAR supplies classes outside §5, and this check ' +
		'cannot see that JAR — an error here would be wrong for every tenant that has one',
	);
	assert.ok(hit.message.includes('com.acme.workflow.DoTheThing'));
	assert.ok(/runtime/.test(hit.message), 'the message must say when it will fail');

	// A listener class is checked the same way.
	const strangeListener = buildFixture({
		reviewListeners: LISTENERS.replace(
			'com.reltio.workflow.activiti.service.DCRTypeTaskListener',
			'com.acme.MyListener',
		),
	});
	const listenerHits = findingsFor(strangeListener, 'reltio-bpmn/unknown-class');
	assert.strictEqual(listenerHits.length, 1);
	assert.ok(listenerHits[0].message.includes('com.acme.MyListener'));

	// Every class §5 lists is accepted.
	for (const known of RELTIO_OOTB_CLASSES) {
		assert.strictEqual(
			findingsFor(buildFixture({ applyClass: known }), 'reltio-bpmn/unknown-class').length, 0,
			`${known} is in §5 and must not be flagged`,
		);
	}
}

// ── 9. §10.9 isExecutable, and §8 the file name ─────────────────────────────
{
	for (const value of ['false', '']) {
		const hit = expectOne(
			buildFixture({ isExecutable: value }),
			'reltio-bpmn/not-executable',
			'<process id="review"',
		);
		assert.strictEqual(hit.severity, 'error');
		assert.ok(/never runs/.test(hit.message), 'the message must say it deploys and does nothing');
	}

	// The file name sets the deployed name and the process id sets the
	// processType; when they differ the deploy succeeds and the wrong thing starts.
	const renamed = buildFixture({ processId: 'reviewV2' });
	const hit = expectOne(renamed, 'reltio-bpmn/id-filename-mismatch', '<process id="reviewV2"', {
		fileProcessId: 'review',
	});
	assert.strictEqual(hit.severity, 'error');
	assert.ok(hit.message.includes('review.bpmn20.xml'), 'the message must name the file it expected');
	// Without a file name — an unsaved buffer, or a fixture — there is nothing to
	// compare against, and inventing a comparison would squiggle every scratch file.
	assert.strictEqual(findingsFor(renamed, 'reltio-bpmn/id-filename-mismatch', {}).length, 0);

	const idless = '<definitions><process name="R" isExecutable="true"><startEvent id="s" /></process></definitions>';
	assert.strictEqual(findingsFor(idless, 'reltio-bpmn/missing-process-id', {}).length, 1);
}

// ── 10. §10.11 The diagram section ──────────────────────────────────────────
{
	const blank = buildFixture({ diagram: false });
	const hit = expectOne(blank, 'reltio-bpmn/no-diagram', '<process id="review"');
	assert.strictEqual(
		hit.severity, 'warning',
		'it deploys and runs correctly; what it breaks is review, so it is not an error',
	);
	assert.ok(/blank canvas/.test(hit.message));
	// One finding, not one per element: a file with no diagram at all has no
	// shapes either, and reporting both would be the same fact ten times.
	assert.strictEqual(findingsFor(blank, 'reltio-bpmn/no-shape').length, 0);

	// A plane naming another process renders nothing at all. This is the failure
	// mode of a definition that was copied and re-identified.
	const wrongPlane = buildFixture({ planeId: 'somethingElse' });
	const plane = expectOne(wrongPlane, 'reltio-bpmn/plane-mismatch', '<process id="review"');
	assert.strictEqual(plane.severity, 'error');
	assert.ok(plane.message.includes('somethingElse') && plane.message.includes('review'));

	// Partial DI is worse than none: what is drawn looks right, so the missing
	// elements read as not being in the workflow.
	const partial = buildFixture().replace(
		/\s*<bpmndi:BPMNShape id="BPMNShape_applyTask"[\s\S]*?<\/bpmndi:BPMNShape>/,
		'',
	);
	const undrawn = expectOne(partial, 'reltio-bpmn/no-shape', 'serviceTask id="applyTask"');
	assert.strictEqual(undrawn.severity, 'warning');
	assert.strictEqual(findingsFor(partial, 'reltio-bpmn/no-diagram').length, 0);
}

// ── 11. §5 in code and §5 in the skill are one set ──────────────────────────
// The skill reads the markdown table; the editor checks this array. They can
// only stay in step if something compares them, which is why the array is
// exported rather than kept private to the rules module.
{
	const rules = read('skills/reltio-default/workflow-bpmn-authoring/references/bpmn-rules.md');
	const documented = new Set(
		(rules.match(/`(com\.reltio\.[A-Za-z0-9_.]+)`/g) ?? []).map(m => m.slice(1, -1)),
	);

	for (const known of RELTIO_OOTB_CLASSES) {
		assert.ok(
			documented.has(known),
			`${known} is in the allow-list but not in bpmn-rules.md — the skill and the ` +
			'linter would then disagree about what is legal',
		);
	}
	for (const listed of documented) {
		assert.ok(
			RELTIO_OOTB_CLASSES.includes(listed),
			`${listed} is documented in bpmn-rules.md but missing from RELTIO_OOTB_CLASSES, ` +
			'so the editor would warn on a class the skill told the agent to use',
		);
	}
}

// ── 12. The editor adapter ──────────────────────────────────────────────────
{
	/** Enough of a TextDocument for the manager: text, a URI, and offset mapping. */
	function fakeDocument(fileName, text) {
		return {
			uri: vscode.Uri.file(`/ws/tenant.reltio.tenant/workflows/${fileName}`),
			getText: () => text,
			positionAt(offset) {
				const before = text.slice(0, offset);
				const line = before.split('\n').length - 1;
				const lastBreak = before.lastIndexOf('\n');
				return new vscode.Position(line, offset - lastBreak - 1);
			},
		};
	}

	const withConfiguration = (value, run) => {
		const original = vscode.workspace.getConfiguration;
		vscode.workspace.getConfiguration = () => ({
			get: (_key, fallback) => (value === undefined ? fallback : value),
			update: async () => {},
		});
		try {
			return run();
		} finally {
			vscode.workspace.getConfiguration = original;
		}
	};

	// Which documents are in scope. A baseline records what the tenant has, so
	// squiggling it would be reporting someone else's file back at the user.
	assert.strictEqual(
		bpmnProcessIdForDocument(fakeDocument('review.bpmn20.xml', '')), 'review',
	);
	assert.strictEqual(
		bpmnProcessIdForDocument(fakeDocument('review.bpmn20.baseline.xml', '')), undefined,
		'a baseline must never be squiggled',
	);
	assert.strictEqual(bpmnProcessIdForDocument(fakeDocument('L3.reltio.json', '')), undefined);
	assert.strictEqual(bpmnProcessIdForDocument(fakeDocument('notes.xml', '')), undefined);

    // One rule of each kind: `not-executable` is a hard error, `unknown-class`
    // is advisory. The setting must move the second and never the first.
    const broken = buildFixture({ isExecutable: 'false', applyClass: 'com.acme.Nope' });

	// Ranges cover the offending element, converted to editor positions.
	const manager = new BpmnDiagnosticsManager();
	const doc = fakeDocument('review.bpmn20.xml', broken);
	withConfiguration(undefined, () => manager.update(doc));
	// Read back through the manager's own collection. `private` is a compile-time
	// notion, so the field is reachable here, and it is the only place the
	// diagnostics this manager produced can be observed.
	const collection = manager.collection;
	const diagnostics = collection.get(doc.uri);
	assert.ok(diagnostics && diagnostics.length >= 2, 'both findings must reach the editor');

	const hard = diagnostics.find(d => d.code === 'reltio-bpmn/not-executable');
	assert.ok(hard, 'the code must survive onto the Diagnostic — users filter on it');
	assert.strictEqual(hard.source, 'reltio');
	assert.ok(hard.range.start.line > 0, 'the range must not collapse onto line 1');
	assert.strictEqual(
		broken.split('\n')[hard.range.start.line].includes('<process'), true,
		'the range must start on the process line',
	);

	// Default: the advisory rule is a warning, the definite one an error.
	assert.strictEqual(
		diagnostics.find(d => d.code === 'reltio-bpmn/unknown-class').severity,
		vscode.DiagnosticSeverity.Warning,
	);
	assert.strictEqual(hard.severity, vscode.DiagnosticSeverity.Error);

	// The setting moves the advisory rules. It must not be able to demote a file
	// Activiti is going to reject, or it becomes a way to hide a failing deploy.
	withConfiguration('hint', () => manager.update(doc));
	const quiet = collection.get(doc.uri);
	assert.strictEqual(
		quiet.find(d => d.code === 'reltio-bpmn/unknown-class').severity,
		vscode.DiagnosticSeverity.Hint,
		'turning the noise down must move the advisory findings',
	);
	assert.strictEqual(
		quiet.find(d => d.code === 'reltio-bpmn/not-executable').severity,
		vscode.DiagnosticSeverity.Error,
		'a definite failure stays an error however quiet the rest is set',
	);

	withConfiguration('error', () => manager.update(doc));
	assert.strictEqual(
		collection.get(doc.uri).find(d => d.code === 'reltio-bpmn/unknown-class').severity,
		vscode.DiagnosticSeverity.Error,
		'and raising it promotes them',
	);
	withConfiguration('off', () => manager.update(doc));
	assert.deepStrictEqual(collection.get(doc.uri), [], '"off" must clear, not merely stop adding');

	// A baseline is skipped entirely — including not being cleared, since it was
	// never set. Passing one through must not throw.
	const baseline = fakeDocument('review.bpmn20.baseline.xml', broken);
	withConfiguration(undefined, () => manager.update(baseline));
	assert.strictEqual(collection.get(baseline.uri), undefined);

	// Closing one document leaves another's findings alone.
	const other = fakeDocument('second.bpmn20.xml', broken);
	withConfiguration(undefined, () => {
		manager.update(doc);
		manager.update(other);
	});
	assert.ok(collection.get(other.uri).length > 0);
	manager.clear(doc.uri);
	assert.strictEqual(collection.get(doc.uri), undefined);
	assert.ok(collection.get(other.uri).length > 0, 'clearing one document must not clear another');
	manager.dispose();
}

// ── 13. Wired up ────────────────────────────────────────────────────────────
{
	const pkg = JSON.parse(read('package.json'));
	const setting = pkg.contributes.configuration.properties['reltio.bpmnDiagnosticsSeverity'];
	assert.ok(setting, 'the severity setting must be declared, or it can never be turned off');
	assert.strictEqual(setting.default, 'warning');
	assert.ok(setting.enum.includes('off'), '"off" must be offered, not just honoured');

	const source = read('src/extension.ts');
	assert.ok(
		source.includes('new BpmnDiagnosticsManager()'),
		'the manager must be constructed in extension.ts',
	);
	assert.ok(
		/context\.subscriptions\.push\([\s\S]{0,600}bpmnDiagnosticsManager,/.test(source),
		'the manager must be disposed with the extension, or its collection outlives it',
	);
	// All three listeners, because each covers a case the others do not: editing,
	// switching to a file that was never edited, and closing one.
	assert.ok(
		/onDidChangeTextDocument[\s\S]*?bpmnDiagnosticsManager\.update/.test(source),
		'editing a BPMN must refresh its findings',
	);
	assert.ok(
		/onDidChangeActiveTextEditor[\s\S]*?bpmnDiagnosticsManager\.update/.test(source),
		'activating a BPMN must report on it, even if it was never edited',
	);
	assert.ok(
		/onDidCloseTextDocument[\s\S]*?bpmnDiagnosticsManager\.clear/.test(source),
		'closing a BPMN must clear it, or the Problems panel keeps a stale entry',
	);

	const runner = read('scripts/run-unit-tests.cjs');
	assert.ok(
		runner.includes("'test-workflow-bpmn-diagnostics.cjs'"),
		'this script must be listed in run-unit-tests.cjs — the runner is not a glob',
	);
}

console.log('test-workflow-bpmn-diagnostics: OK');
