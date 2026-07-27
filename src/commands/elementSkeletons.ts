/**
 * Pure builders + naming for inline JSON skeleton insertion (no-create-wizards).
 */

import type {
	Attribute,
	EntityType,
	GroupingType,
	GraphType,
	HierarchyType,
	InteractionType,
	MatchGroup,
	RelationType,
	Source,
	SurvivorshipGroup,
} from '../model/types';

/** Escape a string for use inside a RegExp constructor. */
export function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Next label `Prefix{n}` where n is one greater than the max existing `Prefix\d+` among labels.
 */
export function nextDefaultLabel(prefix: string, existingLabels: readonly string[]): string {
	const re = new RegExp(`^${escapeRegex(prefix)}(\\d+)$`);
	let max = 0;
	for (const lab of existingLabels) {
		const m = lab.match(re);
		if (m) max = Math.max(max, parseInt(m[1]!, 10));
	}
	return `${prefix}${max + 1}`;
}

export function uriTail(uri: string): string {
	const parts = uri.split('/');
	return parts[parts.length - 1] ?? '';
}

/** Display-ish names from entity/relation/attribute rows for collision detection. */
export function labelsFromEntityTypes(items: EntityType[] | undefined): string[] {
	if (!items?.length) return [];
	return items.map(et => (et.label?.trim() || uriTail(et.uri)).trim()).filter(Boolean);
}

export function labelsFromRelationTypes(items: RelationType[] | undefined): string[] {
	if (!items?.length) return [];
	return items.map(rt => (rt.label?.trim() || uriTail(rt.uri)).trim()).filter(Boolean);
}

export function labelsFromMatchGroups(items: MatchGroup[] | undefined): string[] {
	if (!items?.length) return [];
	return items.map(m => (m.label?.trim() || uriTail(m.uri)).trim()).filter(Boolean);
}

export function labelsFromSurvivorshipGroups(items: SurvivorshipGroup[] | undefined): string[] {
	if (!items?.length) return [];
	return items.map(g => (g.label?.trim() || uriTail(g.uri)).trim()).filter(Boolean);
}

export function labelsFromGroupingTypes(items: GroupingType[] | undefined): string[] {
	if (!items?.length) return [];
	return items.map(g => (g.label?.trim() || uriTail(g.uri)).trim()).filter(Boolean);
}

export function labelsFromGraphTypes(items: GraphType[] | undefined): string[] {
	if (!items?.length) return [];
	return items.map(g => (g.label?.trim() || uriTail(g.uri)).trim()).filter(Boolean);
}

export function labelsFromHierarchyTypes(items: HierarchyType[] | undefined): string[] {
	if (!items?.length) return [];
	return items.map(h => (h.label?.trim() || uriTail(h.uri)).trim()).filter(Boolean);
}

export function labelsFromInteractionTypes(items: InteractionType[] | undefined): string[] {
	if (!items?.length) return [];
	return items.map(i => (i.label?.trim() || uriTail(i.uri)).trim()).filter(Boolean);
}

export function labelsFromSources(items: Source[] | undefined): string[] {
	if (!items?.length) return [];
	return items.map(s => (s.label?.trim() || uriTail(s.uri)).trim()).filter(Boolean);
}

export function labelsFromAttributes(items: Attribute[] | undefined): string[] {
	if (!items?.length) return [];
	return items.map(a => (a.label?.trim() || uriTail(a.uri)).trim()).filter(Boolean);
}

export function buildEntityTypeObject(label: string): Record<string, unknown> {
	const uri = `configuration/entityTypes/${label}`;
	return {
		uri,
		label,
		dataLabelPattern: '',
		attributes: [],
	};
}

export function buildRelationTypeObject(label: string): Record<string, unknown> {
	const uri = `configuration/relationTypes/${label}`;
	return {
		uri,
		label,
		startObject: { objectTypeURI: '' },
		endObject: { objectTypeURI: '' },
	};
}

export function buildGroupingTypeObject(label: string): Record<string, unknown> {
	const uri = `configuration/groupingTypes/${label}`;
	return {
		uri,
		label,
		entityType: '',
		members: [
			{
				entityType: '',
				relationType: '',
				groupingRule: '',
			},
		],
	};
}

export function buildGraphTypeObject(label: string): Record<string, unknown> {
	const uri = `configuration/graphTypes/${label}`;
	return {
		uri,
		label,
		graphStructure: '',
		relationshipTypeURIs: [],
	};
}

export function buildHierarchyTypeObject(label: string): Record<string, unknown> {
	const uri = `configuration/hierarchyTypes/${label}`;
	return {
		uri,
		label,
		allowedEntityTypes: [],
	};
}

export function buildInteractionTypeObject(label: string): Record<string, unknown> {
	const uri = `configuration/interactionTypes/${label}`;
	return {
		uri,
		label,
		attributes: [],
	};
}

export function buildSourceObject(label: string): Record<string, unknown> {
	const uri = `configuration/sources/${label}`;
	return {
		uri,
		label,
		abbreviation: label,
		description: '',
		icon: '',
	};
}

export function buildMatchGroupObject(entityTypeUri: string, label: string): Record<string, unknown> {
	const uri = `${entityTypeUri}/matchGroups/${label}`;
	return {
		uri,
		type: 'automatic',
		label,
		rule: {},
	};
}

export function buildSurvivorshipGroupObject(parentUri: string, label: string): Record<string, unknown> {
	const uri = `${parentUri}/survivorshipGroups/${label}`;
	return {
		uri,
		label,
		default: false,
		mapping: {
			survivorshipStrategy: 'Other',
			attribute: '',
		},
	};
}

export function buildCleanseConfigSkeleton(entityTypeUri: string): Record<string, unknown> {
	return {
		uri: `${entityTypeUri}/cleanseConfig`,
		mappings: [],
	};
}

export type AttributeSkeletonKind = 'String' | 'Nested' | 'Reference';

export function buildAttributeObject(
	parentUriPrefix: string,
	label: string,
	kind: AttributeSkeletonKind,
): Record<string, unknown> {
	const uri = `${parentUriPrefix}/attributes/${label}`;
	const base: Record<string, unknown> = {
		uri,
		label,
		type: kind,
	};
	if (kind === 'Nested') {
		// dataLabelPattern is mandatory on the Reltio UI for Nested attributes (RP-189634)
		base.dataLabelPattern = '';
		base.attributes = [];
	} else if (kind === 'Reference') {
		base.referencedEntityTypeURI = '';
		base.relationshipTypeURI = '';
		// relationshipLabelPattern is mandatory on the Reltio UI for Reference attributes (RP-189645)
		base.relationshipLabelPattern = '';
	}
	return base;
}
