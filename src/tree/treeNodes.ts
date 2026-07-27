import * as vscode from 'vscode';

export type ConfigNodeType =
	// Folders
	| 'entityTypesFolder' | 'attributeTypesFolder' | 'relationTypesFolder'
	| 'interactionTypesFolder' | 'groupTypesFolder' | 'graphTypesFolder'
	| 'categoryTypesFolder' | 'hierarchyTypesFolder' | 'changeRequestTypesFolder'
	| 'rolesFolder' | 'matchActionsFolder' | 'survivorshipStrategiesFolder'
	| 'sourcesFolder' | 'ratingsFolder' | 'activityFolder'
	| 'groupingTypesFolder' | 'matchGroupsFolder' | 'survivorshipGroupsFolder'
	| 'associationGroupsFolder' | 'surrogateCrosswalksFolder'
	| 'ruleBasedAttributesFolder' | 'dependentAttributesFolder'
	| 'attributesFolder' | 'cleanseConfigFolder' | 'hiddenConfigFolder'
	// Items
	| 'entityType' | 'relationType' | 'simpleAttribute' | 'nestedAttribute'
	| 'referenceAttribute' | 'matchGroup' | 'matchRule' | 'matchRuleOperand'
	| 'survivorshipGroup' | 'survivorshipMapping' | 'cleanseInfo' | 'cleanseConfig'
	| 'source' | 'attributeTypeDefinition' | 'changeRequestType' | 'role'
	| 'groupType' | 'matchAction' | 'interactionType' | 'graphType'
	| 'categoryType' | 'hierarchyType' | 'survivorshipStrategy' | 'rating'
	| 'activity' | 'groupingType' | 'associationGroup' | 'surrogateCrosswalk'
	| 'ruleBasedAttribute' | 'dependentAttribute' | 'indexingConfig'
	| 'dataPipelineConfig' | 'unmerge' | 'hiddenConfig' | 'matchAssets'
	| 'negativeMatchRule' | 'startObject' | 'endObject' | 'entityBrowser';

const NODE_ICONS: Record<string, string> = {
	entityTypesFolder: 'symbol-class',
	entityType: 'symbol-class',
	attributeTypesFolder: 'symbol-type-parameter',
	attributeTypeDefinition: 'symbol-type-parameter',
	relationTypesFolder: 'git-compare',
	relationType: 'git-compare',
	interactionTypesFolder: 'pulse',
	interactionType: 'pulse',
	groupTypesFolder: 'group-by-ref-type',
	groupType: 'group-by-ref-type',
	graphTypesFolder: 'graph',
	graphType: 'graph',
	categoryTypesFolder: 'tag',
	categoryType: 'tag',
	hierarchyTypesFolder: 'list-tree',
	hierarchyType: 'list-tree',
	changeRequestTypesFolder: 'request-changes',
	changeRequestType: 'request-changes',
	rolesFolder: 'key',
	role: 'key',
	matchActionsFolder: 'zap',
	matchAction: 'zap',
	survivorshipStrategiesFolder: 'link',
	survivorshipStrategy: 'link',
	sourcesFolder: 'database',
	source: 'database',
	ratingsFolder: 'star',
	rating: 'star',
	activityFolder: 'activity-bar-left',
	activity: 'activity-bar-left',
	groupingTypesFolder: 'layers',
	groupingType: 'layers',
	attributesFolder: 'symbol-field',
	simpleAttribute: 'symbol-field',
	nestedAttribute: 'symbol-struct',
	referenceAttribute: 'references',
	matchGroupsFolder: 'search',
	matchGroup: 'search',
	matchRule: 'regex',
	matchRuleOperand: 'circle-small',
	negativeMatchRule: 'close',
	survivorshipGroupsFolder: 'shield',
	survivorshipGroup: 'shield',
	survivorshipMapping: 'arrow-swap',
	associationGroupsFolder: 'link-external',
	associationGroup: 'link-external',
	surrogateCrosswalksFolder: 'key',
	surrogateCrosswalk: 'key',
	ruleBasedAttributesFolder: 'settings-gear',
	ruleBasedAttribute: 'settings-gear',
	dependentAttributesFolder: 'type-hierarchy',
	dependentAttribute: 'type-hierarchy',
	cleanseConfigFolder: 'beaker',
	cleanseInfo: 'beaker',
	cleanseConfig: 'beaker',
	indexingConfig: 'search-fuzzy',
	dataPipelineConfig: 'server-process',
	unmerge: 'split-horizontal',
	hiddenConfigFolder: 'eye-closed',
	hiddenConfig: 'eye-closed',
	matchAssets: 'file-binary',
	startObject: 'arrow-right',
	endObject: 'arrow-left',
	entityBrowser: 'table',
};

function contextValueFor(nodeType: ConfigNodeType, jsonPath: (string | number)[]): string {
	const base = nodeType.endsWith('Folder')
		? `reltio.folder.${nodeType}`
		: `reltio.item.${nodeType}`;
	// Reference attributes aren't a supported combination for relation types
	if ((nodeType === 'attributesFolder' || nodeType === 'nestedAttribute') && jsonPath[0] === 'relationTypes') {
		return `${base}.relationType`;
	}
	return base;
}

export class ConfigTreeItem extends vscode.TreeItem {
	public tenantL3Uri: vscode.Uri | undefined;
	public browseEntityTypeUris: string[] | undefined;

	constructor(
		public readonly nodeLabel: string,
		public readonly nodeType: ConfigNodeType,
		public readonly jsonPath: (string | number)[],
		collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly nodeDescription?: string,
		tenantL3Uri?: vscode.Uri,
	) {
		super(nodeLabel, collapsibleState);
		this.tenantL3Uri = tenantL3Uri;
		this.id = tenantL3Uri
			? `${tenantL3Uri.toString()}|${jsonPath.join('/')}${nodeType === 'entityBrowser' ? '|browseEntities' : ''}`
			: `${jsonPath.join('/')}${nodeType === 'entityBrowser' ? '|browseEntities' : ''}`;
		this.contextValue = contextValueFor(nodeType, jsonPath);
		this.tooltip = jsonPath.length > 0
			? jsonPath.join(' / ')
			: nodeLabel;
		if (nodeDescription) {
			this.description = nodeDescription;
		}
		const iconId = NODE_ICONS[nodeType];
		if (iconId) {
			this.iconPath = new vscode.ThemeIcon(iconId);
		}
	}

	rebindTenant(uri: vscode.Uri): void {
		this.tenantL3Uri = uri;
		this.id = `${uri.toString()}|${this.jsonPath.join('/')}${this.nodeType === 'entityBrowser' ? '|browseEntities' : ''}`;
	}
}
