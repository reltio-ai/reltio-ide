#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: harden-ontology-webview-messaging
 * Tier A: origin check, safe dynamic-key map, and HTML-escaping — including an end-to-end
 * hostile-fixture pass through the real graph-building + inspector-HTML pipeline.
 * Tier C (manual): live ontology preview QA — openspec/changes/harden-ontology-webview-messaging/design.md
 */
const assert = require('assert');
const { importDist } = require('./lib/import-dist.cjs');

const { isTrustedMessageOrigin, createKeyedMap } = importDist('ontology/webviewMessageSafety');
const {
	escapeHtml,
	renderAttrTree,
	buildEntityInspectorHtml,
	buildConnectionInspectorHtml,
} = importDist('ontology/inspectorHtml');
const { buildGraphModel } = importDist('ontology/modelToGraph');

// --- 1. isTrustedMessageOrigin() -------------------------------------------------------

{
	const origin = 'vscode-webview://abc123';
	assert.strictEqual(isTrustedMessageOrigin(origin, origin), true, 'same origin must be trusted');
	assert.strictEqual(
		isTrustedMessageOrigin('https://evil.example', origin),
		false,
		'a different origin must not be trusted',
	);
	assert.strictEqual(isTrustedMessageOrigin('', origin), false, 'empty candidate must not be trusted');
	assert.strictEqual(
		isTrustedMessageOrigin('null', origin),
		false,
		'"null" (sandboxed/opaque origin) must not be trusted against a real origin',
	);
}

// --- 2. escapeHtml() ---------------------------------------------------------------------

{
	assert.strictEqual(escapeHtml('&'), '&amp;');
	assert.strictEqual(escapeHtml('<'), '&lt;');
	assert.strictEqual(escapeHtml('>'), '&gt;');
	assert.strictEqual(escapeHtml('"'), '&quot;');
	assert.strictEqual(escapeHtml("'"), '&#39;', 'single quote must be escaped (design D3)');
	assert.strictEqual(
		escapeHtml(`"><img src=x onerror=alert(1)>`),
		'&quot;&gt;&lt;img src=x onerror=alert(1)&gt;',
	);
}

// --- 3/4. createKeyedMap() — no inherited prototype, magic keys are ordinary entries -----

for (const magicKey of ['__proto__', 'constructor', 'prototype']) {
	const map = createKeyedMap();
	assert.strictEqual(Object.getPrototypeOf(map), null, 'createKeyedMap() must start with a null prototype');

	map[magicKey] = { x: 1, y: 2 };

	assert.strictEqual(
		Object.getPrototypeOf(map),
		null,
		`assigning "${magicKey}" must not change the map's own prototype`,
	);
	assert.deepStrictEqual(
		map[magicKey],
		{ x: 1, y: 2 },
		`"${magicKey}" must be retrievable as an ordinary entry`,
	);

	// Regression check: on a plain `{}`, the equivalent assignment does NOT behave this way for
	// "__proto__" specifically — it reassigns the object's own prototype instead of storing an
	// entry. Documented here, not exercised against production code (the vulnerable pattern no
	// longer exists in src/), so a future reviewer can see exactly what createKeyedMap() fixes.
	if (magicKey === '__proto__') {
		const plain = {};
		plain[magicKey] = { x: 1, y: 2 };
		assert.notStrictEqual(
			Object.getPrototypeOf(plain),
			Object.prototype,
			'sanity check: a plain {} really is vulnerable to this pattern, proving createKeyedMap() is the fix',
		);
	}
}

// --- 5. End-to-end: hostile .reltio.json content cannot reach the DOM unescaped ----------

const hostileModel = {
	entityTypes: [
		{
			uri: 'configuration/entityTypes/HCP',
			label: 'HCP',
			matchGroups: [{}, {}, {}],
			attributes: [
				{
					uri: 'configuration/entityTypes/HCP/attributes/Evil',
					type: 'Simple',
					name: '"><img src=x onerror=alert(1)>',
				},
			],
		},
		{
			uri: 'configuration/entityTypes/Org',
			label: 'Org',
		},
	],
	relationTypes: [
		{
			uri: 'configuration/relationTypes/WorksFor',
			label: `HasWorked'"<b>`,
			startObject: { objectTypeURI: 'configuration/entityTypes/HCP' },
			endObject: { objectTypeURI: 'configuration/entityTypes/Org' },
		},
	],
};

const graph = buildGraphModel(hostileModel);
const hcpNode = graph.nodes.find(n => n.id === 'HCP');
assert.ok(hcpNode, 'HCP node must exist in the built graph');

const connectedEdges = graph.edges.filter(e => e.source === hcpNode.id || e.target === hcpNode.id);
const entityHtml = buildEntityInspectorHtml(hcpNode, connectedEdges);

assert.ok(
	!entityHtml.includes('<img src=x onerror=alert(1)>'),
	'raw hostile attribute name must never appear unescaped in inspector HTML',
);
assert.ok(entityHtml.includes('&lt;img'), 'the escaped form of the hostile attribute name must be present');
assert.ok(!/<script/i.test(entityHtml), 'no raw <script> tag anywhere in inspector HTML');

const connectionEdge = graph.edges.find(e => e.id === 'conn-HCP-Org');
assert.ok(connectionEdge, 'HCP-Org connection edge must exist');
const connectionHtml = buildConnectionInspectorHtml(connectionEdge);

assert.ok(!connectionHtml.includes(`'"<b>`), 'raw hostile relation-type label must never appear unescaped');
assert.ok(connectionHtml.includes('&#39;'), "relation label's apostrophe must be escaped");
assert.ok(connectionHtml.includes('&quot;'), 'relation label\'s quote must be escaped');
assert.ok(connectionHtml.includes('&lt;b&gt;'), 'relation label\'s <b> must be escaped, not rendered as a tag');

// Direct renderAttrTree() check too, since it's the function the scanner's code-flow trace named.
const attrTreeHtml = renderAttrTree(hcpNode.attrs);
assert.ok(!attrTreeHtml.includes('<img src=x'), 'renderAttrTree() must escape hostile attribute names');

// --- 6. Numeric interpolations stay raw (they cannot carry HTML metacharacters) ----------

assert.ok(entityHtml.includes('Match Groups (3)'), 'numeric match-group count must render unescaped');
assert.ok(entityHtml.includes('3 group(s) configured'), 'numeric match-group count must render unescaped');

console.log('test-ontology-webview-hardening: OK');
