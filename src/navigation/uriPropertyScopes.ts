/**
 * Maps JSON property names → which `configuration/...` definition family to suggest
 * (see `design.md` D2, OpenSpec `autocomplete-improvements`).
 *
 * **Source:** Inferred from high-count keys under `resources/velocity-packs/` (`BusinessConfig.json` per pack)
 * (string values and string arrays whose values start with `configuration/`) plus
 * `schemas/reltio-metadata.schema.json` URI fields. Expand when new patterns appear in shipped L3.
 */
export type UriCompletionScope =
	| 'entityType'
	| 'relationType'
	| 'attributeUnderEntity'
	| 'attributePath'
	| 'source'
	| 'matchGroup'
	| 'survivorshipStrategy'
	| 'cleanseMapping'
	| 'extendsType'
	| 'verticalReference'
	| 'role'
	| 'anyDefinition';

/**
 * Explicit property → scope. Keys omitted here fall back to **same-file reuse only**
 * (no model-index filter); unknown URI-shaped keys can be added as we discover them.
 */
export const PROPERTY_URI_COMPLETION_SCOPE: Record<string, UriCompletionScope> = {
	/* --- Top-level entity type URIs --- */
	objectTypeURI: 'entityType',
	referencedEntityTypeURI: 'entityType',
	entityType: 'entityType',
	entityTypeURIs: 'entityType',
	startObject: 'entityType',
	endObject: 'entityType',

	/* --- Top-level relation type URIs --- */
	relationshipTypeURI: 'relationType',
	relationType: 'relationType',
	relationshipTypeURIs: 'relationType',
	reverseOfTypeURIs: 'relationType',
	sameAsTypeURIs: 'relationType',
	reachByRelationTypeURIs: 'relationType',

	/* --- Reference attribute: sibling entity narrows attribute list --- */
	referencedAttributeURIs: 'attributeUnderEntity',

	/* --- Attribute paths (incl. match/survivorship field refs from packs) --- */
	attribute: 'attributePath',
	attributes: 'attributePath',
	fieldURI: 'attributePath',
	matchFieldURIs: 'attributePath',
	matchFieldURIsExactOrNull: 'attributePath',
	matchFieldURIsExactOrAllNull: 'attributePath',
	keyAttributeURIs: 'attributePath',
	keyAttributeURIsExactOrNull: 'attributePath',
	keyAttributeURIsExactOrAllNull: 'attributePath',
	primaryAttributeUri: 'attributePath',
	cleanseAttribute: 'attributePath',
	nestedAttributeToCleanse: 'attributePath',
	defaultFacetedAttributes: 'attributePath',
	defaultSearchAttributes: 'attributePath',
	imageAttributeURIs: 'attributePath',
	dependentLookupAttributes: 'attributePath',
	ignoreInToken: 'attributePath',
	latitude: 'attributePath',
	longitude: 'attributePath',
	winnerSourceAttributes: 'attributePath',
	businessCardAttributeURIs: 'attributePath',
	exact: 'attributePath',
	fuzzy: 'attributePath',
	exactOrNull: 'attributePath',
	exactOrAllNull: 'attributePath',
	notExactSame: 'attributePath',
	showAttributeURI: 'attributePath',

	/* --- Sources --- */
	source: 'source',
	resultingValuesSourceTypeUri: 'source',
	winnerSourceType: 'source',
	sourcesUriOrder: 'source',
	doNotOverrideForSourceURIs: 'source',

	/* --- Match groups (rules live under …/matchGroups/…) --- */
	groupingRule: 'matchGroup',

	/* --- Survivorship strategies --- */
	strategyUri: 'survivorshipStrategy',
	defaultSurvivorshipStrategy: 'survivorshipStrategy',
	parentStrategyURI: 'survivorshipStrategy',

	/* --- Cleanse / mapping outputs --- */
	outputMappingRef: 'cleanseMapping',

	/* --- Inheritance / vertical --- */
	extendsTypeURI: 'extendsType',
	referenceConfigurationURI: 'verticalReference',

	/* --- Roles --- */
	entityTypeRoleURIs: 'role',

	/* --- Generic definition URI (sources, entity types, nested paths, …) --- */
	uri: 'anyDefinition',
};

/**
 * Resolve completion scope from the JSON property name on the value being edited.
 */
export function getUriCompletionScope(propertyKey: string | undefined): UriCompletionScope | undefined {
	if (!propertyKey) return undefined;
	return PROPERTY_URI_COMPLETION_SCOPE[propertyKey];
}
