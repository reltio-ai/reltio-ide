import * as vscode from 'vscode';
import { ConfigTreeItem, ConfigNodeType } from './treeNodes';
import type {
	ReltioBusinessModel, EntityType, RelationType, Attribute,
	MatchGroup, MatchRule, SurvivorshipGroup, SurvivorshipMapping,
	CleanseConfig, CleanseInfo, GroupType, InteractionType, CategoryType,
	AssociationGroup, Source, MatchAction, GraphType, HierarchyType,
	SurvivorshipStrategy, Rating, GroupingType, ChangeRequestType, Role,
	AttributeTypeDefinition, SurrogateCrosswalk, RuleBasedAttribute,
	DependentAttributes, NegativeMatchRule,
} from '../model/types';

type SectionConfig = {
	key: keyof ReltioBusinessModel;
	label: string;
	folderType: ConfigNodeType;
	itemType: ConfigNodeType;
	getLabel: (item: any) => string;
	getDescription?: (item: any) => string | undefined;
	getChildren?: (item: any, parentPath: (string | number)[]) => ConfigTreeItem[];
};

function scopeItems(items: ConfigTreeItem[], tenantL3Uri: vscode.Uri): void {
	for (const item of items) {
		item.rebindTenant(tenantL3Uri);
	}
}

export function getConfigRootChildren(model: ReltioBusinessModel, tenantL3Uri: vscode.Uri): ConfigTreeItem[] {
	const items = getRootChildren(model);
	scopeItems(items, tenantL3Uri);
	return items;
}

export function getConfigNodeChildren(model: ReltioBusinessModel, element: ConfigTreeItem): ConfigTreeItem[] {
	const items = getNodeChildren(model, element);
	if (element.tenantL3Uri) {
		scopeItems(items, element.tenantL3Uri);
	}
	return items;
}

export function getConcreteEntityTypeUris(model: ReltioBusinessModel, path: (string | number)[]): string[] {
	const selected = resolveModelPath(model, path) as EntityType | undefined;
	if (!selected?.uri) return [];
	if (!selected.abstract) return [selected.uri];
	const concreteUris = new Set<string>();
	for (const candidate of model.entityTypes ?? []) {
		if (candidate.abstract || !candidate.uri) continue;
		if (extendsEntityType(model, candidate, selected.uri)) {
			concreteUris.add(candidate.uri);
		}
	}
	return [...concreteUris];
}

function extendsEntityType(model: ReltioBusinessModel, entityType: EntityType, ancestorUri: string): boolean {
	const byUri = new Map((model.entityTypes ?? []).filter(et => et.uri).map(et => [et.uri, et]));
	let current = entityType.extendsTypeURI;
	const seen = new Set<string>();
	while (current && !seen.has(current)) {
		if (current === ancestorUri) return true;
		seen.add(current);
		current = byUri.get(current)?.extendsTypeURI;
	}
	return false;
}

export function findConfigEntityTypeItem(
	model: ReltioBusinessModel,
	shortName: string,
	tenantL3Uri?: vscode.Uri,
): ConfigTreeItem | undefined {
	const entityTypes = model.entityTypes ?? [];
	for (let i = 0; i < entityTypes.length; i++) {
		const et = entityTypes[i];
		const name = extractName(et.uri);
		if (name === shortName) {
			return new ConfigTreeItem(
				et.label || name,
				'entityType',
				['entityTypes', i],
				vscode.TreeItemCollapsibleState.Collapsed,
				et.abstract ? 'abstract' : undefined,
				tenantL3Uri,
			);
		}
	}
	return undefined;
}

export function getConfigTreeItemParent(model: ReltioBusinessModel, element: ConfigTreeItem): ConfigTreeItem | undefined {
	const path = element.jsonPath;
	if (path.length <= 1) return undefined;

	const parentPath = path.slice(0, -1);
	if (parentPath.length === 1) {
		const sectionKey = parentPath[0] as keyof ReltioBusinessModel;
		const section = SECTIONS.find(s => s.key === sectionKey);
		if (section) {
			const value = model[section.key];
			const count = Array.isArray(value) ? value.length : 0;
			return new ConfigTreeItem(
				Array.isArray(value) ? `${section.label} (${count})` : section.label,
				section.folderType,
				parentPath,
				vscode.TreeItemCollapsibleState.Collapsed,
				undefined,
				element.tenantL3Uri,
			);
		}
	}
	return undefined;
}

// -----------------------------------------------------------------------
// Root level — one folder per non-empty top-level section
// -----------------------------------------------------------------------

function getRootChildren(model: ReltioBusinessModel): ConfigTreeItem[] {
		const items: ConfigTreeItem[] = [];

		for (const section of SECTIONS) {
			const value = model[section.key];
			if (value === undefined || value === null) continue;

			if (Array.isArray(value)) {
				if (value.length === 0) continue;
				items.push(new ConfigTreeItem(
					`${section.label} (${value.length})`,
					section.folderType,
					[section.key],
					vscode.TreeItemCollapsibleState.Collapsed,
				));
			} else if (typeof value === 'object') {
				items.push(new ConfigTreeItem(
					section.label,
					section.folderType,
					[section.key],
					vscode.TreeItemCollapsibleState.Collapsed,
				));
			}
		}
		return items;
	}

	// -----------------------------------------------------------------------
	// Dispatch children by node type
	// -----------------------------------------------------------------------

function getNodeChildren(model: ReltioBusinessModel, element: ConfigTreeItem): ConfigTreeItem[] {
	const path = element.jsonPath;
	const type = element.nodeType;

	const section = SECTIONS.find(s => s.folderType === type);
	if (section) {
		return getSectionItems(model, section, path);
	}

	switch (type) {
		case 'entityType': return getEntityTypeChildren(model, path);
		case 'relationType': return getRelationTypeChildren(model, path);
		case 'nestedAttribute':
		case 'simpleAttribute':
		case 'referenceAttribute': return getAttributeChildren(model, path);
		case 'matchGroup': return getMatchGroupChildren(model, path);
		case 'matchRule': return getMatchRuleChildren(model, path);
		case 'negativeMatchRule': return getNegativeMatchRuleChildren(model, path);
		case 'survivorshipGroup': return getSurvivorshipGroupChildren(model, path);
		case 'survivorshipMapping': return getSurvivorshipMappingChildren(model, path);
		case 'groupType': return getGroupTypeChildren(model, path);
		case 'interactionType': return getInteractionTypeChildren(model, path);
		case 'categoryType': return getCategoryTypeChildren(model, path);
		case 'associationGroup': return getAssociationGroupChildren(model, path);
		case 'cleanseConfig': return getCleanseConfigChildren(model, path);
		case 'attributesFolder': return getAttributesFolderChildren(model, path);
		case 'matchGroupsFolder': return getMatchGroupsFolderChildren(model, path);
		case 'survivorshipGroupsFolder': return getSurvivorshipGroupsFolderChildren(model, path);
		case 'associationGroupsFolder': return getAssociationGroupsFolderChildren(model, path);
		case 'surrogateCrosswalksFolder': return getSurrogateCrosswalksFolderChildren(model, path);
		case 'ruleBasedAttributesFolder': return getRuleBasedAttributesFolderChildren(model, path);
		case 'dependentAttributesFolder': return getDependentAttributesFolderChildren(model, path);
		case 'cleanseConfigFolder': return getCleanseConfigFolderChildren(model, path);
		case 'hiddenConfigFolder': return getHiddenConfigFolderChildren(model, path);
		default: return [];
	}
}

	// -----------------------------------------------------------------------
	// Section items — generic list expansion
	// -----------------------------------------------------------------------

function getSectionItems(
		model: ReltioBusinessModel,
		section: SectionConfig,
		folderPath: (string | number)[],
	): ConfigTreeItem[] {
		const value = resolveModelPath(model, folderPath);
		if (Array.isArray(value)) {
			return value.map((item, i) => {
				const childPath = [...folderPath, i];
				const hasChildren = section.getChildren !== undefined
					|| hasExpandableChildren(section.itemType, item);
				return new ConfigTreeItem(
					section.getLabel(item),
					resolveItemNodeType(section.itemType, item),
					childPath,
					hasChildren
						? vscode.TreeItemCollapsibleState.Collapsed
						: vscode.TreeItemCollapsibleState.None,
					section.getDescription?.(item),
				);
			});
		}
		return [];
	}

	// -----------------------------------------------------------------------
	// Entity type children
	// -----------------------------------------------------------------------

function getEntityTypeChildren(model: ReltioBusinessModel, path: (string | number)[]): ConfigTreeItem[] {
		const et = resolveModelPath(model, path) as EntityType | undefined;
		if (!et) return [];
		const items: ConfigTreeItem[] = [];

		const browseItem = new ConfigTreeItem('Browse Entities', 'entityBrowser', path,
			vscode.TreeItemCollapsibleState.None);
		browseItem.browseEntityTypeUris = getConcreteEntityTypeUris(model, path);
		items.push(browseItem);
		if (et.attributes?.length) {
			items.push(folder('Attributes', 'attributesFolder', [...path, 'attributes'], et.attributes.length));
		}
		if (et.matchGroups?.length) {
			items.push(folder('Match Groups', 'matchGroupsFolder', [...path, 'matchGroups'], et.matchGroups.length));
		}
		if (et.survivorshipGroups?.length) {
			items.push(folder('Survivorship Groups', 'survivorshipGroupsFolder', [...path, 'survivorshipGroups'], et.survivorshipGroups.length));
		}
		if (et.associationGroups?.length) {
			items.push(folder('Association Groups', 'associationGroupsFolder', [...path, 'associationGroups'], et.associationGroups.length));
		}
		if (et.surrogateCrosswalks?.length) {
			items.push(folder('Surrogate Crosswalks', 'surrogateCrosswalksFolder', [...path, 'surrogateCrosswalks'], et.surrogateCrosswalks.length));
		}
		if (et.cleanseConfig) {
			items.push(new ConfigTreeItem('Cleanse Config', 'cleanseConfig', [...path, 'cleanseConfig'],
				vscode.TreeItemCollapsibleState.Collapsed));
		}
		if (et.ruleBasedAttributes?.length) {
			items.push(folder('Rule-Based Attributes', 'ruleBasedAttributesFolder', [...path, 'ruleBasedAttributes'], et.ruleBasedAttributes.length));
		}
		if (et.dependentAttributes?.length) {
			items.push(folder('Dependent Attributes', 'dependentAttributesFolder', [...path, 'dependentAttributes'], et.dependentAttributes.length));
		}
		if (Array.isArray(et.hidden) && et.hidden.length) {
			items.push(folder('Hidden Config', 'hiddenConfigFolder', [...path, 'hidden'], et.hidden.length));
		}
		if (et.unmerge) {
			items.push(new ConfigTreeItem('Unmerge', 'unmerge', [...path, 'unmerge'],
				vscode.TreeItemCollapsibleState.None));
		}
		if (et.indexingConfig) {
			items.push(new ConfigTreeItem('Indexing Config', 'indexingConfig', [...path, 'indexingConfig'],
				vscode.TreeItemCollapsibleState.None));
		}
		if (et.dataPipelineConfig) {
			items.push(new ConfigTreeItem('Data Pipeline Config', 'dataPipelineConfig', [...path, 'dataPipelineConfig'],
				vscode.TreeItemCollapsibleState.None));
		}
		if (et.matchAssets) {
			items.push(new ConfigTreeItem('Match Assets', 'matchAssets', [...path, 'matchAssets'],
				vscode.TreeItemCollapsibleState.None));
		}
		return items;
	}

	// -----------------------------------------------------------------------
	// Relation type children
	// -----------------------------------------------------------------------

function getRelationTypeChildren(model: ReltioBusinessModel, path: (string | number)[]): ConfigTreeItem[] {
		const rt = resolveModelPath(model, path) as RelationType | undefined;
		if (!rt) return [];
		const items: ConfigTreeItem[] = [];

		if (rt.startObject) {
			const desc = extractEndpointName(rt.startObject.objectTypeURI);
			items.push(new ConfigTreeItem('Start Object', 'startObject', [...path, 'startObject'],
				vscode.TreeItemCollapsibleState.None, desc));
		}
		if (rt.endObject) {
			const desc = extractEndpointName(rt.endObject.objectTypeURI);
			items.push(new ConfigTreeItem('End Object', 'endObject', [...path, 'endObject'],
				vscode.TreeItemCollapsibleState.None, desc));
		}
		if (rt.attributes?.length) {
			items.push(folder('Attributes', 'attributesFolder', [...path, 'attributes'], rt.attributes.length));
		}
		if (rt.survivorshipGroups?.length) {
			items.push(folder('Survivorship Groups', 'survivorshipGroupsFolder', [...path, 'survivorshipGroups'], rt.survivorshipGroups.length));
		}
		return items;
	}

	// -----------------------------------------------------------------------
	// Attribute children (recursive nesting)
	// -----------------------------------------------------------------------

function getAttributeChildren(model: ReltioBusinessModel, path: (string | number)[]): ConfigTreeItem[] {
		const attr = resolveModelPath(model, path) as Attribute | undefined;
		if (!attr?.attributes?.length) return [];
		return groupAndSortAttributes(attr.attributes, [...path, 'attributes']);
	}

function getAttributesFolderChildren(model: ReltioBusinessModel, path: (string | number)[]): ConfigTreeItem[] {
		const attrs = resolveModelPath(model, path) as Attribute[] | undefined;
		if (!attrs) return [];
		return groupAndSortAttributes(attrs, path);
	}

	// -----------------------------------------------------------------------
	// Match group children
	// -----------------------------------------------------------------------

function getMatchGroupChildren(model: ReltioBusinessModel, path: (string | number)[]): ConfigTreeItem[] {
		const mg = resolveModelPath(model, path) as MatchGroup | undefined;
		if (!mg) return [];
		const items: ConfigTreeItem[] = [];

		if (mg.rule) {
			items.push(new ConfigTreeItem('Rule', 'matchRule', [...path, 'rule'],
				vscode.TreeItemCollapsibleState.Collapsed));
		}
		if (mg.negativeRule) {
			items.push(new ConfigTreeItem('Negative Rule', 'negativeMatchRule', [...path, 'negativeRule'],
				vscode.TreeItemCollapsibleState.Collapsed));
		}
		return items;
	}

function getMatchGroupsFolderChildren(model: ReltioBusinessModel, path: (string | number)[]): ConfigTreeItem[] {
		const groups = resolveModelPath(model, path) as MatchGroup[] | undefined;
		if (!groups) return [];
		return groups.map((mg, i) => new ConfigTreeItem(
			extractName(mg.uri) || mg.label || `Match Group ${i}`,
			'matchGroup',
			[...path, i],
			vscode.TreeItemCollapsibleState.Collapsed,
			mg.scope ?? mg.type,
		));
	}

	// -----------------------------------------------------------------------
	// Match rule children (recursive)
	// -----------------------------------------------------------------------

function getMatchRuleChildren(model: ReltioBusinessModel, path: (string | number)[]): ConfigTreeItem[] {
		const rule = resolveModelPath(model, path) as MatchRule | undefined;
		if (!rule) return [];
		return matchRuleChildItems(rule, path);
	}

function getNegativeMatchRuleChildren(model: ReltioBusinessModel, path: (string | number)[]): ConfigTreeItem[] {
		const rule = resolveModelPath(model, path) as NegativeMatchRule | undefined;
		if (!rule) return [];
		const items: ConfigTreeItem[] = [];

		for (const field of ['notExactSame', 'notFuzzySame'] as const) {
			const arr = rule[field];
			if (arr?.length) {
				for (let i = 0; i < arr.length; i++) {
					items.push(new ConfigTreeItem(
						`${field}: ${extractName(arr[i])}`,
						'matchRuleOperand',
						[...path, field, i],
						vscode.TreeItemCollapsibleState.None,
					));
				}
			}
		}
		return items;
	}

	// -----------------------------------------------------------------------
	// Survivorship children
	// -----------------------------------------------------------------------

function getSurvivorshipGroupChildren(model: ReltioBusinessModel, path: (string | number)[]): ConfigTreeItem[] {
		const sg = resolveModelPath(model, path) as SurvivorshipGroup | undefined;
		if (!sg) return [];
		const mapping = sg.mapping;
		if (!mapping) return [];
		const items: ConfigTreeItem[] = [];
		if (Array.isArray(mapping)) {
			for (let i = 0; i < mapping.length; i++) {
				const m = mapping[i];
				items.push(new ConfigTreeItem(
					m.attribute ? extractName(m.attribute) : m.survivorshipStrategy,
					'survivorshipMapping',
					[...path, 'mapping', i],
					m.fallbackStrategies?.length
						? vscode.TreeItemCollapsibleState.Collapsed
						: vscode.TreeItemCollapsibleState.None,
					m.survivorshipStrategy,
				));
			}
		} else {
			items.push(new ConfigTreeItem(
				mapping.attribute ? extractName(mapping.attribute) : mapping.survivorshipStrategy,
				'survivorshipMapping',
				[...path, 'mapping'],
				mapping.fallbackStrategies?.length
					? vscode.TreeItemCollapsibleState.Collapsed
					: vscode.TreeItemCollapsibleState.None,
				mapping.survivorshipStrategy,
			));
		}
		return items;
	}

function getSurvivorshipGroupsFolderChildren(model: ReltioBusinessModel, path: (string | number)[]): ConfigTreeItem[] {
		const groups = resolveModelPath(model, path) as SurvivorshipGroup[] | undefined;
		if (!groups) return [];
		return groups.map((sg, i) => new ConfigTreeItem(
			extractName(sg.uri) || sg.label || `Survivorship Group ${i}`,
			'survivorshipGroup',
			[...path, i],
			vscode.TreeItemCollapsibleState.Collapsed,
			sg.default ? 'default' : undefined,
		));
	}

function getSurvivorshipMappingChildren(model: ReltioBusinessModel, path: (string | number)[]): ConfigTreeItem[] {
		const mapping = resolveModelPath(model, path) as SurvivorshipMapping | undefined;
		if (!mapping?.fallbackStrategies?.length) return [];
		return mapping.fallbackStrategies.map((fb, i) => new ConfigTreeItem(
			fb.attribute ? extractName(fb.attribute) : fb.survivorshipStrategy,
			'survivorshipMapping',
			[...path, 'fallbackStrategies', i],
			fb.fallbackStrategies?.length
				? vscode.TreeItemCollapsibleState.Collapsed
				: vscode.TreeItemCollapsibleState.None,
			`fallback: ${fb.survivorshipStrategy}`,
		));
	}

	// -----------------------------------------------------------------------
	// Sub-folders for entity type child sections
	// -----------------------------------------------------------------------

function getAssociationGroupsFolderChildren(model: ReltioBusinessModel, path: (string | number)[]): ConfigTreeItem[] {
		const groups = resolveModelPath(model, path) as AssociationGroup[] | undefined;
		if (!groups) return [];
		return groups.map((ag, i) => new ConfigTreeItem(
			extractName(ag.uri) || ag.label || `Association Group ${i}`,
			'associationGroup',
			[...path, i],
			vscode.TreeItemCollapsibleState.Collapsed,
		));
	}

function getAssociationGroupChildren(model: ReltioBusinessModel, path: (string | number)[]): ConfigTreeItem[] {
		const ag = resolveModelPath(model, path) as AssociationGroup | undefined;
		if (!ag?.rule) return [];
		return [new ConfigTreeItem('Rule', 'matchRule', [...path, 'rule'],
			vscode.TreeItemCollapsibleState.Collapsed)];
	}

function getSurrogateCrosswalksFolderChildren(model: ReltioBusinessModel, path: (string | number)[]): ConfigTreeItem[] {
		const items = resolveModelPath(model, path) as SurrogateCrosswalk[] | undefined;
		if (!items) return [];
		return items.map((sc, i) => new ConfigTreeItem(
			sc.source || `Surrogate Crosswalk ${i}`,
			'surrogateCrosswalk',
			[...path, i],
			vscode.TreeItemCollapsibleState.None,
			sc.generationLogic,
		));
	}

function getRuleBasedAttributesFolderChildren(model: ReltioBusinessModel, path: (string | number)[]): ConfigTreeItem[] {
		const items = resolveModelPath(model, path) as RuleBasedAttribute[] | undefined;
		if (!items) return [];
		return items.map((rba, i) => new ConfigTreeItem(
			rba.name || extractName(rba.uri),
			'ruleBasedAttribute',
			[...path, i],
			vscode.TreeItemCollapsibleState.None,
			rba.type,
		));
	}

function getDependentAttributesFolderChildren(model: ReltioBusinessModel, path: (string | number)[]): ConfigTreeItem[] {
		const items = resolveModelPath(model, path) as DependentAttributes[] | undefined;
		if (!items) return [];
		return items.map((da, i) => new ConfigTreeItem(
			extractName(da.attributeUri),
			'dependentAttribute',
			[...path, i],
			vscode.TreeItemCollapsibleState.None,
		));
	}

function getCleanseConfigFolderChildren(model: ReltioBusinessModel, path: (string | number)[]): ConfigTreeItem[] {
		const items = resolveModelPath(model, path) as CleanseInfo[] | undefined;
		if (!items) return [];
		return items.map((ci, i) => new ConfigTreeItem(
			extractName(ci.uri) || ci.cleanseProvider,
			'cleanseInfo',
			[...path, i],
			vscode.TreeItemCollapsibleState.None,
		));
	}

function getCleanseConfigChildren(model: ReltioBusinessModel, path: (string | number)[]): ConfigTreeItem[] {
		const cc = resolveModelPath(model, path) as CleanseConfig | undefined;
		if (!cc) return [];
		const items: ConfigTreeItem[] = [];
		if (cc.infos?.length) {
			items.push(folder('Cleanse Infos', 'cleanseConfigFolder', [...path, 'infos'], cc.infos.length));
		}
		if (cc.mappings?.length) {
			items.push(folder('Cleanse Mappings', 'cleanseConfigFolder', [...path, 'mappings'], cc.mappings.length));
		}
		return items;
	}

function getHiddenConfigFolderChildren(model: ReltioBusinessModel, path: (string | number)[]): ConfigTreeItem[] {
		const items = resolveModelPath(model, path) as any[] | undefined;
		if (!items) return [];
		return items.map((_h, i) => new ConfigTreeItem(
			`Hidden Config ${i}`,
			'hiddenConfig',
			[...path, i],
			vscode.TreeItemCollapsibleState.None,
		));
	}

	// -----------------------------------------------------------------------
	// Group type / interaction type / category type children
	// -----------------------------------------------------------------------

function getGroupTypeChildren(model: ReltioBusinessModel, path: (string | number)[]): ConfigTreeItem[] {
		const gt = resolveModelPath(model, path) as GroupType | undefined;
		if (!gt) return [];
		const items: ConfigTreeItem[] = [];
		if (gt.attributes?.length) {
			items.push(folder('Attributes', 'attributesFolder', [...path, 'attributes'], gt.attributes.length));
		}
		if (gt.survivorshipGroups?.length) {
			items.push(folder('Survivorship Groups', 'survivorshipGroupsFolder', [...path, 'survivorshipGroups'], gt.survivorshipGroups.length));
		}
		return items;
	}

function getInteractionTypeChildren(model: ReltioBusinessModel, path: (string | number)[]): ConfigTreeItem[] {
		const it = resolveModelPath(model, path) as InteractionType | undefined;
		if (!it) return [];
		const items: ConfigTreeItem[] = [];
		if (it.attributes?.length) {
			items.push(folder('Attributes', 'attributesFolder', [...path, 'attributes'], it.attributes.length));
		}
		return items;
	}

function getCategoryTypeChildren(model: ReltioBusinessModel, path: (string | number)[]): ConfigTreeItem[] {
		const ct = resolveModelPath(model, path) as CategoryType | undefined;
		if (!ct) return [];
		const items: ConfigTreeItem[] = [];
		if (ct.attributes?.length) {
			items.push(folder('Attributes', 'attributesFolder', [...path, 'attributes'], ct.attributes.length));
		}
		return items;
	}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function folder(label: string, type: ConfigNodeType, path: (string | number)[], count: number): ConfigTreeItem {
	return new ConfigTreeItem(
		`${label} (${count})`,
		type,
		path,
		vscode.TreeItemCollapsibleState.Collapsed,
	);
}

function extractName(uri?: string): string {
	if (!uri) return '';
	const parts = uri.split('/');
	return parts[parts.length - 1] || uri;
}

function extractEndpointName(uri?: string): string | undefined {
	if (!uri) return undefined;
	return extractName(uri);
}

function resolveModelPath(model: any, path: (string | number)[]): any {
	let current = model;
	for (const segment of path) {
		if (current === undefined || current === null) return undefined;
		current = current[segment];
	}
	return current;
}

function classifyAttribute(attr: Attribute): ConfigNodeType {
	if (attr.type?.toLowerCase() === 'nested' || attr.attributes?.length) return 'nestedAttribute';
	if (attr.type?.toLowerCase() === 'reference' || attr.referencedEntityTypeURI) return 'referenceAttribute';
	return 'simpleAttribute';
}

function attributeItem(attr: Attribute, path: (string | number)[]): ConfigTreeItem {
	const nodeType = classifyAttribute(attr);
	let desc: string | undefined = attr.type;

	if (nodeType === 'referenceAttribute' && attr.referencedEntityTypeURI) {
		desc = `Ref → ${extractName(attr.referencedEntityTypeURI)}`;
	}

	const hasChildren = (attr.attributes?.length ?? 0) > 0;

	return new ConfigTreeItem(
		attr.name || extractName(attr.uri),
		nodeType,
		path,
		hasChildren
			? vscode.TreeItemCollapsibleState.Collapsed
			: vscode.TreeItemCollapsibleState.None,
		desc,
	);
}

function groupAndSortAttributes(attrs: Attribute[], basePath: (string | number)[]): ConfigTreeItem[] {
	const indexed = attrs.map((attr, i) => ({ attr, originalIndex: i }));

	const nested = indexed.filter(a => classifyAttribute(a.attr) === 'nestedAttribute');
	const reference = indexed.filter(a => classifyAttribute(a.attr) === 'referenceAttribute');
	const simple = indexed.filter(a => classifyAttribute(a.attr) === 'simpleAttribute');

	const byName = (a: { attr: Attribute }, b: { attr: Attribute }) => {
		const nameA = (a.attr.name || extractName(a.attr.uri)).toLowerCase();
		const nameB = (b.attr.name || extractName(b.attr.uri)).toLowerCase();
		return nameA.localeCompare(nameB);
	};

	nested.sort(byName);
	reference.sort(byName);
	simple.sort(byName);

	const items: ConfigTreeItem[] = [];
	const groups: [string, typeof nested][] = [
		['Nested', nested],
		['Reference', reference],
		['Simple', simple],
	];

	for (const [, group] of groups) {
		for (const entry of group) {
			items.push(attributeItem(entry.attr, [...basePath, entry.originalIndex]));
		}
	}

	return items;
}

function hasExpandableChildren(itemType: ConfigNodeType, item: any): boolean {
	switch (itemType) {
		case 'entityType': {
			const et = item as EntityType;
			return !!(et.attributes?.length || et.matchGroups?.length ||
				et.survivorshipGroups?.length || et.cleanseConfig ||
				et.associationGroups?.length || et.surrogateCrosswalks?.length ||
				et.ruleBasedAttributes?.length || et.dependentAttributes?.length ||
				(Array.isArray(et.hidden) && et.hidden.length) || et.unmerge || et.indexingConfig ||
				et.dataPipelineConfig || et.matchAssets);
		}
		case 'relationType': {
			const rt = item as RelationType;
			return !!(rt.startObject || rt.endObject || rt.attributes?.length ||
				rt.survivorshipGroups?.length);
		}
		case 'simpleAttribute':
		case 'nestedAttribute':
		case 'referenceAttribute':
			return !!(item as Attribute).attributes?.length;
		case 'matchGroup':
			return !!((item as MatchGroup).rule || (item as MatchGroup).negativeRule);
		case 'survivorshipGroup':
			return !!(item as SurvivorshipGroup).mapping;
		case 'groupType':
			return !!((item as GroupType).attributes?.length || (item as GroupType).survivorshipGroups?.length);
		case 'interactionType':
			return !!(item as InteractionType).attributes?.length;
		case 'categoryType':
			return !!(item as CategoryType).attributes?.length;
		case 'associationGroup':
			return !!(item as AssociationGroup).rule;
		default:
			return false;
	}
}

function resolveItemNodeType(defaultType: ConfigNodeType, item: any): ConfigNodeType {
	if (defaultType === 'simpleAttribute' || defaultType === 'nestedAttribute' || defaultType === 'referenceAttribute') {
		const attr = item as Attribute;
		if (attr.type?.toLowerCase() === 'nested' || attr.attributes?.length) return 'nestedAttribute';
		if (attr.type?.toLowerCase() === 'reference' || attr.referencedEntityTypeURI) return 'referenceAttribute';
		return 'simpleAttribute';
	}
	return defaultType;
}

function matchRuleChildItems(rule: MatchRule, path: (string | number)[]): ConfigTreeItem[] {
	const items: ConfigTreeItem[] = [];

	for (const field of ['exact', 'fuzzy', 'exactOrNull', 'exactOrAllNull', 'ignoreInToken'] as const) {
		const arr = rule[field];
		if (arr?.length) {
			for (let i = 0; i < arr.length; i++) {
				items.push(new ConfigTreeItem(
					`${field}: ${extractName(arr[i])}`,
					'matchRuleOperand',
					[...path, field, i],
					vscode.TreeItemCollapsibleState.None,
				));
			}
		}
	}

	for (const field of ['or', 'and', 'not'] as const) {
		const sub = rule[field];
		if (sub) {
			if (Array.isArray(sub)) {
				for (let i = 0; i < sub.length; i++) {
					items.push(new ConfigTreeItem(
						`${field.toUpperCase()} [${i}]`,
						'matchRule',
						[...path, field, i],
						vscode.TreeItemCollapsibleState.Collapsed,
					));
				}
			} else {
				items.push(new ConfigTreeItem(
					field.toUpperCase(),
					'matchRule',
					[...path, field],
					vscode.TreeItemCollapsibleState.Collapsed,
				));
			}
		}
	}

	if (rule.equals?.length) {
		for (let i = 0; i < rule.equals.length; i++) {
			items.push(new ConfigTreeItem(
				`equals: ${extractName(rule.equals[i].uri)}`,
				'matchRuleOperand',
				[...path, 'equals', i],
				vscode.TreeItemCollapsibleState.None,
			));
		}
	}

	return items;
}

// ---------------------------------------------------------------------------
// Section definitions for the 17 top-level sections
// ---------------------------------------------------------------------------

function getRelationDescription(rt: RelationType): string | undefined {
	const start = extractEndpointName(rt.startObject?.objectTypeURI);
	const end = extractEndpointName(rt.endObject?.objectTypeURI);
	if (start && end) return `${start} → ${end}`;
	return undefined;
}

const SECTIONS: SectionConfig[] = [
	{
		key: 'entityTypes', label: 'Entity Types',
		folderType: 'entityTypesFolder', itemType: 'entityType',
		getLabel: (et: EntityType) => et.label || extractName(et.uri),
		getDescription: (et: EntityType) => et.abstract ? 'abstract' : undefined,
	},
	{
		key: 'relationTypes', label: 'Relation Types',
		folderType: 'relationTypesFolder', itemType: 'relationType',
		getLabel: (rt: RelationType) => rt.label || extractName(rt.uri),
		getDescription: getRelationDescription,
	},
	{
		key: 'attributeTypes', label: 'Attribute Types',
		folderType: 'attributeTypesFolder', itemType: 'attributeTypeDefinition',
		getLabel: (at: AttributeTypeDefinition) => extractName(at.uri),
	},
	{
		key: 'interactionTypes', label: 'Interaction Types',
		folderType: 'interactionTypesFolder', itemType: 'interactionType',
		getLabel: (it: InteractionType) => it.label || extractName(it.uri),
	},
	{
		key: 'groupTypes', label: 'Group Types',
		folderType: 'groupTypesFolder', itemType: 'groupType',
		getLabel: (gt: GroupType) => gt.label || extractName(gt.uri),
	},
	{
		key: 'graphTypes', label: 'Graph Types',
		folderType: 'graphTypesFolder', itemType: 'graphType',
		getLabel: (gt: GraphType) => gt.label || extractName(gt.uri),
	},
	{
		key: 'categoryTypes', label: 'Category Types',
		folderType: 'categoryTypesFolder', itemType: 'categoryType',
		getLabel: (ct: CategoryType) => ct.label || extractName(ct.uri),
	},
	{
		key: 'hierarchyTypes', label: 'Hierarchy Types',
		folderType: 'hierarchyTypesFolder', itemType: 'hierarchyType',
		getLabel: (ht: HierarchyType) => ht.label || extractName(ht.uri),
	},
	{
		key: 'changeRequestTypes', label: 'Change Request Types',
		folderType: 'changeRequestTypesFolder', itemType: 'changeRequestType',
		getLabel: (crt: ChangeRequestType) => extractName(crt.uri),
	},
	{
		key: 'roles', label: 'Roles',
		folderType: 'rolesFolder', itemType: 'role',
		getLabel: (r: Role) => r.label || extractName(r.uri),
	},
	{
		key: 'matchActions', label: 'Match Actions',
		folderType: 'matchActionsFolder', itemType: 'matchAction',
		getLabel: (ma: MatchAction) => ma.name,
	},
	{
		key: 'survivorshipStrategies', label: 'Survivorship Strategies',
		folderType: 'survivorshipStrategiesFolder', itemType: 'survivorshipStrategy',
		getLabel: (ss: SurvivorshipStrategy) => ss.label || extractName(ss.uri),
	},
	{
		key: 'sources', label: 'Sources',
		folderType: 'sourcesFolder', itemType: 'source',
		getLabel: (s: Source) => s.label || extractName(s.uri),
	},
	{
		key: 'ratings', label: 'Ratings',
		folderType: 'ratingsFolder', itemType: 'rating',
		getLabel: (_r: Rating, i?: number) => `Rating`,
	},
	{
		key: 'groupingTypes', label: 'Grouping Types',
		folderType: 'groupingTypesFolder', itemType: 'groupingType',
		getLabel: (gt: GroupingType) => gt.label || extractName(gt.uri),
	},
];
