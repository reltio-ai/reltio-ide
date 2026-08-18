import type { AttrInfo, GraphEdge, GraphNode, RelTypeInfo } from './modelToGraph';

/**
 * Pure, DOM-free HTML-string builders for the ontology webview's double-click inspector
 * popup. Kept here (outside `src/webview/`, which `tsc` excludes) so the existing
 * `importDist()` test harness can exercise them directly against hostile input — see
 * `scripts/test-ontology-webview-hardening.cjs`.
 *
 * Every dynamic string value below MUST be passed through `escapeHtml()` before being placed
 * inside the returned markup. `number` values may be interpolated raw — their string form
 * cannot contain HTML metacharacters. The one caller-side exception is `createInspector()`'s
 * `bodyHtml` parameter itself, which is pre-built HTML by design; everything that ever
 * constructs a `bodyHtml` string is one of the functions in this file.
 */
export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export function shortUri(uri: string): string {
	const parts = uri.split('/');
	return parts[parts.length - 1];
}

export function renderAttrTree(attrs: AttrInfo[]): string {
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

export function renderRelTypeTree(relTypes: RelTypeInfo[]): string {
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

export function buildEntityInspectorHtml(node: GraphNode, connectedEdges: GraphEdge[]): string {
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

	if (connectedEdges.length > 0) {
		html += `<details><summary>Connections (${connectedEdges.length})</summary><div class="attr-tree">`;
		for (const e of connectedEdges) {
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

	return html;
}

export function buildConnectionInspectorHtml(edge: GraphEdge): string {
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

	return html;
}
