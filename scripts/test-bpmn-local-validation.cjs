#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const scriptPath = path.join(repoRoot, 'scripts/validate-bpmn-definition.cjs');
const libPath = path.join(repoRoot, 'scripts/lib/validate-bpmn-definition.cjs');

const VALID = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:activiti="http://activiti.org/bpmn"
             xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
             xmlns:omgdc="http://www.omg.org/spec/DD/20100524/DC"
             xmlns:omgdi="http://www.omg.org/spec/DD/20100524/DI">
  <process id="sample" name="Sample" isExecutable="true">
    <startEvent id="start" name="Start"/>
    <userTask id="review" name="Review">
      <extensionElements>
        <activiti:formProperty id="decision" type="enum">
          <activiti:value id="Approve" name="Approve"/>
          <activiti:value id="Reject" name="Reject"/>
        </activiti:formProperty>
      </extensionElements>
    </userTask>
    <exclusiveGateway id="gate" name="Gate"/>
    <endEvent id="endApprove" name="End approve"/>
    <endEvent id="endReject" name="End reject"/>
    <sequenceFlow id="f1" sourceRef="start" targetRef="review"/>
    <sequenceFlow id="f2" sourceRef="review" targetRef="gate"/>
    <sequenceFlow id="fApprove" sourceRef="gate" targetRef="endApprove">
      <conditionExpression xsi:type="tFormalExpression"><![CDATA[\${decision=='Approve'}]]></conditionExpression>
    </sequenceFlow>
    <sequenceFlow id="fReject" sourceRef="gate" targetRef="endReject">
      <conditionExpression xsi:type="tFormalExpression"><![CDATA[\${decision=='Reject'}]]></conditionExpression>
    </sequenceFlow>
    <dataObject id="manualStart" name="manualStart">
      <extensionElements><activiti:value>false</activiti:value></extensionElements>
    </dataObject>
  </process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="sample">
      <bpmndi:BPMNShape id="s_start" bpmnElement="start"><omgdc:Bounds x="0" y="0" width="50" height="50"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="s_review" bpmnElement="review"><omgdc:Bounds x="150" y="0" width="100" height="50"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="s_gate" bpmnElement="gate"><omgdc:Bounds x="300" y="0" width="50" height="50"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="s_endApprove" bpmnElement="endApprove"><omgdc:Bounds x="450" y="0" width="50" height="50"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="s_endReject" bpmnElement="endReject"><omgdc:Bounds x="450" y="100" width="50" height="50"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="s_manualStart" bpmnElement="manualStart"><omgdc:Bounds x="0" y="120" width="100" height="50"/></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="e_f1" bpmnElement="f1"><omgdi:waypoint x="50" y="25"/><omgdi:waypoint x="150" y="25"/></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="e_f2" bpmnElement="f2"><omgdi:waypoint x="250" y="25"/><omgdi:waypoint x="300" y="25"/></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="e_fApprove" bpmnElement="fApprove"><omgdi:waypoint x="350" y="25"/><omgdi:waypoint x="450" y="25"/></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="e_fReject" bpmnElement="fReject"><omgdi:waypoint x="325" y="50"/><omgdi:waypoint x="325" y="125"/><omgdi:waypoint x="450" y="125"/></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</definitions>
`;

function run(xml, filename) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmn-validate-'));
	const file = path.join(dir, filename);
	fs.writeFileSync(file, xml);
	const before = fs.readFileSync(file);
	let status = 0;
	let stderr = '';
	try {
		execFileSync(process.execPath, [scriptPath, file], { encoding: 'utf8' });
	} catch (error) {
		status = error.status;
		stderr = error.stderr || '';
	}
	const after = fs.readFileSync(file);
	fs.rmSync(dir, { recursive: true, force: true });
	assert.deepStrictEqual(after, before, 'validation must leave the file unchanged');
	return { status, stderr };
}

{
	const source = fs.readFileSync(scriptPath, 'utf8') + fs.readFileSync(libPath, 'utf8');
	assert.ok(!/\bfetch\s*\(/.test(source), 'validator must not call fetch');
	assert.ok(!/\bhttps?\b/.test(source), 'validator must not reference http');
	assert.ok(!/XMLHttpRequest|axios/.test(source), 'validator must not use an HTTP client');
	assert.ok(!/\/deployments/.test(source), 'validator must not call POST /deployments');
}

{
	const result = run('', 'empty.bpmn20.xml');
	assert.notStrictEqual(result.status, 0, 'Invalid XML is rejected and nothing is deployed');
	assert.match(result.stderr, /cannot be null or empty/);
}

{
	const result = run('<definitions><process id="x">', 'broken.bpmn20.xml');
	assert.notStrictEqual(result.status, 0);
	assert.match(result.stderr, /not well-formed/);
}

{
	const result = run(VALID, 'sample.bpmn20.xml');
	assert.strictEqual(result.status, 0, `Valid XML passes and would still pass deploy\n${result.stderr}`);
}

{
	const result = run(VALID, 'sample.xml');
	assert.notStrictEqual(result.status, 0);
	assert.match(result.stderr, /extension/);
}

function expectFail(xml, pattern, label) {
	const result = run(xml, 'sample.bpmn20.xml');
	assert.notStrictEqual(result.status, 0, label);
	assert.match(result.stderr, pattern, `${label}: ${result.stderr}`);
}

expectFail(VALID.replace('<startEvent id="start" name="Start"/>', ''), /No start event found/, 'one start event');
expectFail(
	VALID.replace('<startEvent id="start" name="Start"/>', '<startEvent id="start" name="Start"/><startEvent id="start2" name="Start 2"/>'),
	/More than 1 start event found/,
	'The process graph must match the adapter leaf and start rules',
);
expectFail(
	VALID.replace('<endEvent id="endReject" name="End reject"/>', '<userTask id="endReject" name="Stuck"><extensionElements/></userTask>'),
	/Node cannot be a leaf/,
	'allowed leaves only',
);
expectFail(VALID.replace('id="manualStart" name="manualStart"', 'id="other" name="other"'), /manualStart not found/, 'manualStart');
expectFail(VALID.replace('<activiti:value>false</activiti:value>', '<activiti:value>yes</activiti:value>'), /dataObject value not valid/, 'true/false data-object values');
expectFail(
	VALID.replace(/<userTask id="review"[\s\S]*?<\/userTask>/, '<userTask id="review" name="Review"/>'),
	/extensionElements|form properties/i,
	'user-task extension elements',
);
expectFail(VALID.replace('sourceRef="start"', 'sourceRef="missing"'), /Invalid source for sequenceFlow/, 'sequence-flow endpoints');
expectFail(VALID.replace("decision=='Approve'", "decision=='Hold'"), /decision enum value not found/, 'A deploy-invalid document fails validation the same way');
expectFail(VALID.replace('<bpmndi:BPMNShape id="s_start" bpmnElement="start"><omgdc:Bounds x="0" y="0" width="50" height="50"/></bpmndi:BPMNShape>', ''), /Missing shapes for: start/, 'Diagram interchange must cover shapes and edges');
expectFail(
	VALID.replace('<bpmndi:BPMNEdge id="e_f1" bpmnElement="f1"><omgdi:waypoint x="50" y="25"/><omgdi:waypoint x="150" y="25"/></bpmndi:BPMNEdge>', '<bpmndi:BPMNEdge id="e_f1" bpmnElement="f1"><omgdi:waypoint x="50" y="25"/></bpmndi:BPMNEdge>'),
	/Missing waypoints for: f1/,
	'a sequence flow needs at least two waypoints',
);
expectFail(
	VALID.replace('<bpmndi:BPMNShape id="s_gate" bpmnElement="gate"><omgdc:Bounds x="300" y="0" width="50" height="50"/></bpmndi:BPMNShape>', '<bpmndi:BPMNShape id="s_gate" bpmnElement="gate"></bpmndi:BPMNShape>'),
	/Missing bounds for: gate/,
	'a flow node needs Bounds',
);

console.log('test-bpmn-local-validation: OK');
