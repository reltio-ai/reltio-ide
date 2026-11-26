#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: ontology-view
 * Tier A: buildGraphModel invariants on canonical fixture
 * Tier C (manual): webview pan/zoom, inspectors — openspec/changes/ontology-view/
 *
 * Regression rows: BIZCFG-003 graph model ids,
 * edges and attribute counts, connection merging, saved layout (applyLayout / loadLayout /
 * saveLayout on memory-fs) and webview pure-logic safety (testBizcfg003).
 */
const assert = require('assert');
const vscode = require('./lib/vscode-stub.cjs');
const { importDist } = require('./lib/import-dist.cjs');
const { loadCanonicalFixture } = require('./lib/load-canonical-fixture.cjs');
const { installMemoryFs } = require('./lib/memory-fs.cjs');

const { buildGraphModel } = importDist('ontology/modelToGraph');
const { applyLayout, loadLayout, saveLayout } = importDist('ontology/layoutPersistence');
const { isTrustedMessageOrigin, createKeyedMap } = importDist('ontology/webviewMessageSafety');
const { renderAttrTree, renderRelTypeTree } = importDist('ontology/inspectorHtml');

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

async function testBizcfg003() {
	// 1. Canonical fixture: ids, edge endpoints, attribute counts.
	{
		const ids = graph.nodes.map(n => n.id);
		assert.deepStrictEqual(ids, (model.entityTypes ?? []).map(et => et.uri.split('/').pop()), 'BIZCFG-003 #1: node ids are the entity type URI tail names');
		assert.strictEqual(new Set(ids).size, ids.length, 'BIZCFG-003 #1: node ids are unique');
		for (const e of graph.edges) {
			assert.ok(ids.includes(e.source) && ids.includes(e.target), `BIZCFG-003 #1: edge ${e.id} joins two node ids`);
		}
		assert.ok(graph.edges.some(e => e.type === 'connection'), 'BIZCFG-003 #1: the fixture yields connection edges');
		for (const et of model.entityTypes ?? []) {
			const node = graph.nodes.find(n => n.id === et.uri.split('/').pop());
			const attrs = et.attributes ?? [];
			const nested = attrs.filter(a => a.type === 'Nested').length;
			const ref = attrs.filter(a => a.type === 'Reference').length;
			assert.deepStrictEqual(
				[node.simpleAttrCount, node.nestedAttrCount, node.refAttrCount],
				[attrs.length - nested - ref, nested, ref],
				`BIZCFG-003 #1: ${node.id} simple / nested / reference counts`,
			);
			assert.strictEqual(node.simpleAttrCount + node.nestedAttrCount + node.refAttrCount, attrs.length, `BIZCFG-003 #1: ${node.id} counts add up to its attributes`);
		}
	}

	// 2. Connection merging, self-reference, incomplete relation, extends id.
	{
		const et = id => `configuration/entityTypes/${id}`;
		const g = buildGraphModel({
			entityTypes: [
				{ uri: et('X'), attributes: [
					{ uri: `${et('X')}/attributes/RefY`, name: 'RefY', type: 'Reference', referencedEntityTypeURI: et('Y') },
					{ uri: `${et('X')}/attributes/Self`, name: 'Self', type: 'Reference', referencedEntityTypeURI: et('X') },
				] },
				{ uri: et('Y'), extendsTypeURI: et('X') },
			],
			relationTypes: [
				{ uri: 'configuration/relationTypes/R1', label: 'R1', startObject: { objectTypeURI: et('X') }, endObject: { objectTypeURI: et('Y') } },
				{ uri: 'configuration/relationTypes/R2', label: 'R2', startObject: { objectTypeURI: et('Y') }, endObject: { objectTypeURI: et('X') } },
				{ uri: 'configuration/relationTypes/R3', label: 'R3', startObject: { objectTypeURI: et('X') } },
			],
		});
		const conns = g.edges.filter(e => e.type === 'connection');
		assert.deepStrictEqual(conns.map(e => e.id), ['conn-X-Y'], 'BIZCFG-003 #2: one conn-X-Y edge; self-reference and incomplete relation add none');
		const c = conns[0];
		assert.deepStrictEqual(c.relationshipLabels, ['R1', 'R2'], 'BIZCFG-003 #2: two relationship labels');
		assert.deepStrictEqual(c.referenceLabels, ['RefY'], 'BIZCFG-003 #2: one reference label');
		assert.strictEqual(c.label, 'Connected with 2 relation types', 'BIZCFG-003 #2: merged edge label');
		const ext = g.edges.filter(e => e.type === 'extends');
		assert.deepStrictEqual(ext.map(e => e.id), ['extends-Y-X'], 'BIZCFG-003 #2: extends edge id is extends-<id>-<parent>');
	}

	// 3. Layout: apply complete / partial / empty; load and save via memory-fs.
	{
		const complete = {};
		for (const n of graph.nodes) complete[n.id] = { x: n.x + 7, y: n.y + 11 };
		const full = applyLayout(graph, complete);
		assert.strictEqual(full.applied, true, 'BIZCFG-003 #3: complete map is applied');
		for (const n of full.graph.nodes) assert.deepStrictEqual([n.x, n.y], [complete[n.id].x, complete[n.id].y], `BIZCFG-003 #3: ${n.id} x/y copied`);
		const partialMap = { ...complete };
		delete partialMap[graph.nodes[0].id];
		const partial = applyLayout(graph, partialMap);
		assert.strictEqual(partial.applied, false, 'BIZCFG-003 #3: partial map is not applied');
		assert.strictEqual(partial.graph, graph, 'BIZCFG-003 #3: partial map returns the original graph');
		const empty = applyLayout(graph, {});
		assert.deepStrictEqual([empty.applied, empty.graph === graph], [false, true], 'BIZCFG-003 #3: empty map returns applied false and the original graph');

		const mem = installMemoryFs();
		const config = vscode.Uri.file('/ws/t1/tenant.reltio.json');
		const layoutPath = '/ws/t1/tenant.reltio.layout.json';
		const put = async obj => mem.writeFile(vscode.Uri.file(layoutPath), Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)));
		assert.strictEqual(await loadLayout(config), undefined, 'BIZCFG-003 #3: no layout file gives undefined');
		await put({ version: 2, positions: { A: { x: 1, y: 2 } } });
		assert.strictEqual(await loadLayout(config), undefined, 'BIZCFG-003 #3: version 2 gives undefined');
		await put('{"version":1,"positions":');
		assert.strictEqual(await loadLayout(config), undefined, 'BIZCFG-003 #3: malformed JSON gives undefined');
		await put({ version: 1, positions: { A: { x: 1, y: 2 } } });
		assert.deepStrictEqual(await loadLayout(config), { A: { x: 1, y: 2 } }, 'BIZCFG-003 #3: a valid file loads its positions');
		mem._files.clear();
		await saveLayout(config, { B: { x: 3, y: 4 } });
		assert.deepStrictEqual([...mem._files.keys()], [layoutPath], 'BIZCFG-003 #3: the layout file swaps .reltio.json for .reltio.layout.json');
		assert.deepStrictEqual(await loadLayout(config), { B: { x: 3, y: 4 } }, 'BIZCFG-003 #3: a saved layout loads back');
	}

	// 4. Webview pure-logic safety.
	{
		assert.strictEqual(isTrustedMessageOrigin('vscode-webview://other', 'vscode-webview://mine'), false, 'BIZCFG-003 #4: a foreign origin is rejected');
		const map = createKeyedMap();
		map['__proto__'] = { x: 1, y: 2 };
		assert.ok(Object.prototype.hasOwnProperty.call(map, '__proto__'), 'BIZCFG-003 #4: __proto__ is stored as an own key');
		assert.deepStrictEqual(Object.keys(map), ['__proto__'], 'BIZCFG-003 #4: __proto__ is the only own key');
		const hostile = `<img onerror=x>"'`;
		const attrHtml = renderAttrTree([
			{ uri: `u${hostile}`, name: `n${hostile}`, category: 'Simple', valueType: `t${hostile}` },
			{ uri: 'n', name: hostile, category: 'Nested', valueType: 'Nested', children: [{ uri: 'c', name: hostile, category: 'Simple', valueType: 'String' }] },
			{ uri: 'r', name: hostile, category: 'Reference', valueType: 'Reference', referencedEntityTypeURI: `configuration/entityTypes/${hostile}`, relationshipTypeURI: `configuration/relationTypes/${hostile}` },
		]);
		const relHtml = renderRelTypeTree([{ label: hostile, uri: `u${hostile}`, startEntityId: hostile, endEntityId: hostile }]);
		for (const [name, html] of [['renderAttrTree', attrHtml], ['renderRelTypeTree', relHtml]]) {
			assert.ok(!html.includes('<img'), `BIZCFG-003 #4: ${name} escapes <img`);
			assert.ok(!html.includes(`"'`), `BIZCFG-003 #4: ${name} escapes the quotes`);
			assert.ok(html.includes('&lt;img onerror=x&gt;&quot;&#39;'), `BIZCFG-003 #4: ${name} holds the escaped value`);
			const attrValues = html.match(/="[^"]*"/g) ?? [];
			for (const v of attrValues) assert.ok(!/[<>']/.test(v), `BIZCFG-003 #4: ${name} attribute value ${v} is escaped`);
		}
	}
}

testBizcfg003().then(() => {
	console.log('test-ontology-view: OK');
}).catch(e => {
	console.error(e);
	process.exit(1);
});
