import type { ReltioBusinessModel, Attribute } from '../model/types';

export interface AttrInfo {
	uri: string;
	name: string;
	category: 'Simple' | 'Nested' | 'Reference';
	valueType: string;
	children?: AttrInfo[];
	relationshipTypeURI?: string;
	referencedEntityTypeURI?: string;
}

export interface GraphNode {
	id: string;
	label: string;
	abstract: boolean;
	consolidated: boolean;
	simpleAttrCount: number;
	nestedAttrCount: number;
	refAttrCount: number;
	matchGroupCount: number;
	attrs: AttrInfo[];
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface RelTypeInfo {
	label: string;
	uri: string;
	startEntityId: string;
	endEntityId: string;
}

export interface GraphEdge {
	id: string;
	source: string;
	target: string;
	type: 'connection' | 'extends';
	label: string;
	relationshipLabels: string[];
	relationshipURIs: string[];
	referenceLabels: string[];
	referenceURIs: string[];
	relationTypes: RelTypeInfo[];
	referenceAttrs: AttrInfo[];
}

export interface GraphModel {
	nodes: GraphNode[];
	edges: GraphEdge[];
}

const NODE_WIDTH = 220;
const NODE_HEIGHT = 100;

function uriToShortName(uri: string): string {
	const parts = uri.split('/');
	return parts[parts.length - 1];
}

type AttrLookup = Map<string, Attribute>;

function buildAttrLookup(model: ReltioBusinessModel): AttrLookup {
	const map: AttrLookup = new Map();
	const addAttrs = (prefix: string, attrs: Attribute[] | undefined) => {
		if (!attrs) return;
		for (const a of attrs) {
			map.set(a.uri, a);
			if (a.attributes) addAttrs(a.uri, a.attributes);
		}
	};
	for (const et of model.entityTypes ?? []) addAttrs(et.uri, et.attributes);
	for (const rt of model.relationTypes ?? []) addAttrs(rt.uri, rt.attributes);
	return map;
}

function collectAttrs(attrs: Attribute[] | undefined, lookup: AttrLookup): { counts: { simple: number; nested: number; ref: number }; infos: AttrInfo[] } {
	let simple = 0, nested = 0, ref = 0;
	const infos: AttrInfo[] = [];
	if (!attrs) return { counts: { simple, nested, ref }, infos };
	for (const attr of attrs) {
		const name = attr.name ?? attr.label ?? uriToShortName(attr.uri);
		const category: AttrInfo['category'] = attr.type === 'Nested' ? 'Nested' : attr.type === 'Reference' ? 'Reference' : 'Simple';
		if (category === 'Nested') nested++;
		else if (category === 'Reference') ref++;
		else simple++;

		const info: AttrInfo = { uri: attr.uri, name, category, valueType: attr.type ?? 'String' };

		if (category === 'Nested' && attr.attributes?.length) {
			const sub = collectAttrs(attr.attributes, lookup);
			info.children = sub.infos;
		}

		if (category === 'Reference') {
			if (attr.relationshipTypeURI) info.relationshipTypeURI = attr.relationshipTypeURI;
			if (attr.referencedEntityTypeURI) info.referencedEntityTypeURI = attr.referencedEntityTypeURI;
			info.children = resolveReferencedAttrs(attr.referencedAttributeURIs, lookup);
		}

		infos.push(info);
	}
	return { counts: { simple, nested, ref }, infos };
}

function resolveReferencedAttrs(uris: string[] | string | undefined, lookup: AttrLookup): AttrInfo[] {
	if (!uris) return [];
	const list = Array.isArray(uris) ? uris : [uris];
	const resolved: AttrInfo[] = [];
	for (const uri of list) {
		const attr = lookup.get(uri);
		if (attr) {
			const name = attr.name ?? attr.label ?? uriToShortName(uri);
			const cat: AttrInfo['category'] = attr.type === 'Nested' ? 'Nested' : attr.type === 'Reference' ? 'Reference' : 'Simple';
			resolved.push({ uri, name, category: cat, valueType: attr.type ?? 'String' });
		} else {
			resolved.push({ uri, name: uriToShortName(uri), category: 'Simple', valueType: '?' });
		}
	}
	return resolved;
}

interface RawConnection {
	kind: 'relationship' | 'reference';
	label: string;
	uri: string;
	startEntityId?: string;
	endEntityId?: string;
	attrInfo?: AttrInfo;
}

function collectReferenceConnections(entityId: string, attrs: Attribute[] | undefined, map: Map<string, RawConnection[]>, lookup: AttrLookup): void {
	if (!attrs) return;
	for (const attr of attrs) {
		if (attr.type === 'Reference' && attr.referencedEntityTypeURI) {
			const targetId = uriToShortName(attr.referencedEntityTypeURI);
			if (targetId === entityId) continue;
			const key = [entityId, targetId].sort().join('|');
			const arr = map.get(key) ?? [];
			const name = attr.name ?? attr.label ?? uriToShortName(attr.uri);
			const attrInfo: AttrInfo = { uri: attr.uri, name, category: 'Reference', valueType: 'Reference' };
			if (attr.relationshipTypeURI) attrInfo.relationshipTypeURI = attr.relationshipTypeURI;
			if (attr.referencedEntityTypeURI) attrInfo.referencedEntityTypeURI = attr.referencedEntityTypeURI;
			attrInfo.children = resolveReferencedAttrs(attr.referencedAttributeURIs, lookup);
			arr.push({ kind: 'reference', label: name, uri: attr.uri, attrInfo });
			map.set(key, arr);
		}
		if (attr.attributes) {
			collectReferenceConnections(entityId, attr.attributes, map, lookup);
		}
	}
}

function connectionLabel(relLabels: string[], refLabels: string[]): string {
	if (relLabels.length > 1) return `Connected with ${relLabels.length} relation types`;
	if (relLabels.length === 1) return relLabels[0];
	if (refLabels.length > 1) return `${refLabels.length} reference attributes`;
	if (refLabels.length === 1) return refLabels[0];
	return '';
}

export function buildGraphModel(model: ReltioBusinessModel): GraphModel {
	const nodes: GraphNode[] = [];
	const edges: GraphEdge[] = [];
	const connectionMap = new Map<string, RawConnection[]>();
	const lookup = buildAttrLookup(model);

	const entityTypes = model.entityTypes ?? [];
	for (const et of entityTypes) {
		const id = uriToShortName(et.uri);
		const isAbstract = et.abstract === true;
		const matchGroups = Array.isArray(et.matchGroups) ? et.matchGroups : et.matchGroups ? [et.matchGroups] : [];
		const { counts, infos } = collectAttrs(et.attributes, lookup);

		nodes.push({
			id,
			label: et.label ?? id,
			abstract: isAbstract,
			consolidated: matchGroups.length > 0 && !isAbstract,
			simpleAttrCount: counts.simple,
			nestedAttrCount: counts.nested,
			refAttrCount: counts.ref,
			matchGroupCount: matchGroups.length,
			attrs: infos,
			x: 0,
			y: 0,
			width: NODE_WIDTH,
			height: NODE_HEIGHT,
		});

		collectReferenceConnections(id, et.attributes, connectionMap, lookup);

		if (et.extendsTypeURI) {
			const parentId = uriToShortName(et.extendsTypeURI);
			edges.push({
				id: `extends-${id}-${parentId}`,
				source: id,
				target: parentId,
				type: 'extends',
				label: 'extends',
				relationshipLabels: [],
				relationshipURIs: [],
				referenceLabels: [],
				referenceURIs: [],
				relationTypes: [],
				referenceAttrs: [],
			});
		}
	}

	const relationTypes = model.relationTypes ?? [];
	for (const rt of relationTypes) {
		const startUri = rt.startObject?.objectTypeURI;
		const endUri = rt.endObject?.objectTypeURI;
		if (!startUri || !endUri) continue;

		const sourceId = uriToShortName(startUri);
		const targetId = uriToShortName(endUri);
		if (sourceId === targetId) continue;

		const label = rt.label ?? uriToShortName(rt.uri);
		const key = [sourceId, targetId].sort().join('|');
		const arr = connectionMap.get(key) ?? [];
		arr.push({ kind: 'relationship', label, uri: rt.uri, startEntityId: sourceId, endEntityId: targetId });
		connectionMap.set(key, arr);
	}

	for (const [key, conns] of connectionMap) {
		const [a, b] = key.split('|');
		const rels = conns.filter(c => c.kind === 'relationship');
		const refs = conns.filter(c => c.kind === 'reference');

		edges.push({
			id: `conn-${a}-${b}`,
			source: a,
			target: b,
			type: 'connection',
			label: connectionLabel(rels.map(c => c.label), refs.map(c => c.label)),
			relationshipLabels: rels.map(c => c.label),
			relationshipURIs: rels.map(c => c.uri),
			referenceLabels: refs.map(c => c.label),
			referenceURIs: refs.map(c => c.uri),
			relationTypes: rels.map(c => ({ label: c.label, uri: c.uri, startEntityId: c.startEntityId!, endEntityId: c.endEntityId! })),
			referenceAttrs: refs.map(c => c.attrInfo!).filter(Boolean),
		});
	}

	return { nodes, edges };
}
