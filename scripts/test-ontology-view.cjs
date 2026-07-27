#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: ontology-view
 * Tier A: buildGraphModel invariants on canonical fixture
 * Tier C (manual): webview pan/zoom, inspectors — openspec/changes/ontology-view/
 */
const assert = require('assert');
const { importDist } = require('./lib/import-dist.cjs');
const { loadCanonicalFixture } = require('./lib/load-canonical-fixture.cjs');

const { buildGraphModel } = importDist('ontology/modelToGraph');
const { applyLayout } = importDist('ontology/layoutPersistence');

const { model } = loadCanonicalFixture();
const graph = buildGraphModel(model);

assert.ok(graph.nodes.length >= 1, 'graph nodes');
assert.ok(Array.isArray(graph.edges), 'graph edges');

const nodeIds = new Set(graph.nodes.map(n => n.id));
for (const edge of graph.edges) {
	assert.ok(nodeIds.has(edge.source), `edge source missing: ${edge.source}`);
	assert.ok(nodeIds.has(edge.target), `edge target missing: ${edge.target}`);
}

for (const et of model.entityTypes ?? []) {
	if (et.extendsTypeURI) {
		const extendsEdge = graph.edges.find(
			e => e.type === 'extends' && e.source === et.uri && e.target === et.extendsTypeURI,
		);
		assert.ok(extendsEdge, `extends edge for ${et.uri} → ${et.extendsTypeURI}`);
	}
}

const positions = {};
for (const n of graph.nodes) {
	positions[n.id] = { x: n.x + 10, y: n.y + 10 };
}
const { applied, graph: laidOut } = applyLayout(graph, positions);
assert.strictEqual(applied, true, 'layout applied');
assert.ok(laidOut.nodes.length === graph.nodes.length);

console.log('test-ontology-view: OK');
