import type { Node } from 'jsonc-parser';
import type { ReltioBusinessModel, EntityType, Attribute } from '../model/types';

export interface VirtualDefinition {
	realUri: string;
	realNode: Node;
	/** When set, Go-to-Definition lands on this node (e.g. inline `outputMapping` array). */
	targetNode?: Node;
}

export interface UnresolvedReference {
	uri: string;
	node: Node;
}

const URI_PREFIX = 'configuration/';
const MAX_VIRTUAL_DEPTH = 5;

/**
 * Platform vertical packs (`configuration/_vertical/…`) are hosted by Reltio, not
 * authored inside a tenant L3. References like `referenceConfigurationURI` should
 * not be treated as unresolved local configuration URIs.
 */
export function isPlatformHostedConfigurationUri(uri: string): boolean {
	return uri.startsWith(`${URI_PREFIX}_vertical/`);
}

export class UriIndex {
	readonly definitions = new Map<string, Node>();
	readonly virtualDefinitions = new Map<string, VirtualDefinition>();
	readonly references = new Map<string, Node[]>();

	build(model: ReltioBusinessModel, ast: Node): void {
		this.definitions.clear();
		this.virtualDefinitions.clear();
		this.references.clear();

		this.walkAst(ast, null);
		this.buildOutputMappingRefDefinitions();
		this.buildVirtualDefinitions(model);
	}

	getDefinition(uri: string): Node | undefined {
		return this.definitions.get(uri) ?? this.virtualDefinitions.get(uri)?.realNode;
	}

	getRealUri(uri: string): string {
		const virt = this.virtualDefinitions.get(uri);
		return virt ? virt.realUri : uri;
	}

	getDefinitionNode(uri: string): Node | undefined {
		const real = this.definitions.get(uri);
		if (real) {
			return this.findUriValueNode(real);
		}
		const virt = this.virtualDefinitions.get(uri);
		if (virt) {
			return virt.targetNode ?? this.findUriValueNode(virt.realNode);
		}
		return undefined;
	}

	getReferences(uri: string): Node[] {
		return this.references.get(uri) ?? [];
	}

	getAllUnresolved(): UnresolvedReference[] {
		const result: UnresolvedReference[] = [];
		for (const [uri, nodes] of this.references) {
			if (isPlatformHostedConfigurationUri(uri)) {
				continue;
			}
			if (!this.definitions.has(uri) && !this.virtualDefinitions.has(uri)) {
				for (const node of nodes) {
					result.push({ uri, node });
				}
			}
		}
		return result;
	}

	/** All definition URIs (real + virtual) for completion and navigation consistency */
	getAllDefinitionUris(): string[] {
		const out = new Set<string>();
		for (const u of this.definitions.keys()) {
			out.add(u);
		}
		for (const u of this.virtualDefinitions.keys()) {
			out.add(u);
		}
		return [...out];
	}

	isDefinitionProperty(node: Node): boolean {
		const parent = node.parent;
		if (!parent || parent.type !== 'property') return false;
		const children = parent.children;
		if (!children || children.length < 2) return false;
		const keyNode = children[0];
		return keyNode.type === 'string' && keyNode.value === 'uri' && children[1] === node;
	}

	private walkAst(node: Node, parentPropertyKey: string | null): void {
		if (node.type === 'string') {
			const val = node.value as string;
			if (typeof val === 'string' && val.startsWith(URI_PREFIX)) {
				if (parentPropertyKey === 'uri') {
					this.registerDefinition(val, node);
				} else {
					this.registerReference(val, node);
				}
			}
			return;
		}

		if (node.type === 'property' && node.children && node.children.length >= 2) {
			const keyNode = node.children[0];
			const valNode = node.children[1];
			const key = keyNode.type === 'string' ? keyNode.value as string : null;
			this.walkAst(valNode, key);
			return;
		}

		if (node.children) {
			for (const child of node.children) {
				this.walkAst(child, parentPropertyKey);
			}
		}
	}

	private registerDefinition(uri: string, valueNode: Node): void {
		const objectNode = valueNode.parent?.parent;
		if (objectNode && objectNode.type === 'object') {
			this.definitions.set(uri, objectNode);
		}
	}

	private registerReference(uri: string, node: Node): void {
		let refs = this.references.get(uri);
		if (!refs) {
			refs = [];
			this.references.set(uri, refs);
		}
		refs.push(node);
	}

	private buildOutputMappingRefDefinitions(): void {
		const suffix = '/outputMapping';
		for (const [uri] of this.references) {
			if (!uri.endsWith(suffix)) {
				continue;
			}
			const mappingUri = uri.slice(0, -suffix.length);
			const mappingObj = this.definitions.get(mappingUri);
			if (!mappingObj) {
				continue;
			}
			const outputMappingNode = this.findPropertyValueNode(mappingObj, 'outputMapping');
			if (outputMappingNode) {
				this.virtualDefinitions.set(uri, {
					realUri: mappingUri,
					realNode: mappingObj,
					targetNode: outputMappingNode,
				});
			}
		}
	}

	private findPropertyValueNode(objectNode: Node, propertyKey: string): Node | undefined {
		if (!objectNode.children) {
			return undefined;
		}
		for (const prop of objectNode.children) {
			if (prop.type === 'property' && prop.children && prop.children.length >= 2) {
				const key = prop.children[0];
				if (key.type === 'string' && key.value === propertyKey) {
					return prop.children[1];
				}
			}
		}
		return undefined;
	}

	private buildVirtualDefinitions(model: ReltioBusinessModel): void {
		const entityTypes = model.entityTypes;
		if (!entityTypes) return;

		const entityMap = new Map<string, EntityType>();
		for (const et of entityTypes) {
			if (et.uri) entityMap.set(et.uri, et);
		}

		// Two passes to handle multi-hop chains
		for (let pass = 0; pass < 2; pass++) {
			for (const et of entityTypes) {
				if (et.attributes) {
					this.synthesizeVirtualAttrs(et.attributes, entityMap, 0);
				}
			}
		}
	}

	private synthesizeVirtualAttrs(
		attrs: Attribute[],
		entityMap: Map<string, EntityType>,
		depth: number,
	): void {
		if (depth >= MAX_VIRTUAL_DEPTH) return;

		for (const attr of attrs) {
			if (attr.type === 'Reference' && attr.referencedEntityTypeURI && attr.uri) {
				const targetET = entityMap.get(attr.referencedEntityTypeURI);
				if (targetET?.attributes) {
					this.graftAttributes(attr.uri, targetET.attributes, entityMap, depth + 1);
				}
			}
			if (attr.attributes) {
				this.synthesizeVirtualAttrs(attr.attributes, entityMap, depth);
			}
		}
	}

	private graftAttributes(
		virtualPrefix: string,
		targetAttrs: Attribute[],
		entityMap: Map<string, EntityType>,
		depth: number,
	): void {
		if (depth >= MAX_VIRTUAL_DEPTH) return;

		for (const tAttr of targetAttrs) {
			if (!tAttr.name && !tAttr.uri) continue;
			const name = tAttr.name ?? tAttr.uri!.split('/').pop()!;
			const virtualUri = `${virtualPrefix}/attributes/${name}`;
			const realUri = tAttr.uri;

			if (realUri && !this.definitions.has(virtualUri)) {
				const realNode = this.definitions.get(realUri);
				if (realNode) {
					this.virtualDefinitions.set(virtualUri, { realUri, realNode });
				}
			}

			if (tAttr.attributes) {
				this.graftAttributes(virtualUri, tAttr.attributes, entityMap, depth + 1);
			}

			if (tAttr.type === 'Reference' && tAttr.referencedEntityTypeURI) {
				const nestedTarget = entityMap.get(tAttr.referencedEntityTypeURI);
				if (nestedTarget?.attributes) {
					this.graftAttributes(virtualUri, nestedTarget.attributes, entityMap, depth + 1);
				}
			}
		}
	}

	private findUriValueNode(objectNode: Node): Node | undefined {
		if (!objectNode.children) return undefined;
		for (const prop of objectNode.children) {
			if (prop.type === 'property' && prop.children && prop.children.length >= 2) {
				const key = prop.children[0];
				if (key.type === 'string' && key.value === 'uri') {
					return prop.children[1];
				}
			}
		}
		return undefined;
	}
}
