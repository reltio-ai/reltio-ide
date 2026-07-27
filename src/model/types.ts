// Reltio Business Model — TypeScript interfaces
// Designed from the official RBMschema-for-json.xsd specification.
// Each interface corresponds to an XSD complexType; each union type
// corresponds to an XSD simpleType with xs:enumeration restrictions.

// ---------------------------------------------------------------------------
// Enum / Union types
// ---------------------------------------------------------------------------

export type MatchGroupScope =
  | 'none' | 'internal' | 'external' | 'all' | 'ml_match'
  | 'NONE' | 'INTERNAL' | 'EXTERNAL' | 'ALL' | 'ML_MATCH';

export type MatchMethod = 'match_iq' | 'rule_based';

export type EntityEndDateStrategy =
  | 'END_DATE_RELATION'
  | 'END_DATE_RELATION_CROSSWALKS';

export type FallbackUsingCriteria =
  | 'ZERO_OR_MORE_THAN_ONE'
  | 'MORE_THAN_ONE'
  | 'ZERO';

export type GenerationLogic =
  | 'ovOnly'
  | 'useFirstNonOvWhenOvMissing'
  | 'generateUidWhenOvMissing'
  | 'generateUidWhenOvAndNonOvMissing'
  | 'generateUidWhenAllOvMissing';

export type GroupingFunctionType =
  | 'fixedValue' | 'copy' | 'survivedValue' | 'aggregate'
  | 'count' | 'countDistinct' | 'groupingRule' | 'srcCopy'
  | 'topK' | 'mostRecent' | 'firstNonNull';

export type RuleBasedAttributeType = 'Conditional';

export type PromptTemplate = 'SINGLEVALUE' | 'MULTIVALUE';

export type MultiAttributeCombinationsStrategy = 'DROP_ALL' | 'FIRST_N' | 'NOOP';

// ---------------------------------------------------------------------------
// Root model
// ---------------------------------------------------------------------------

export interface ReltioBusinessModel {
  // Metadata attributes
  schemaVersion?: string;
  createdTime?: number;
  updatedTime?: number;
  createdBy?: string;
  updatedBy?: string;
  referenceConfigurationURI?: string;
  abstract?: boolean;
  flatOvCalculation?: boolean;
  label?: string;
  uri?: string;
  rdmTenantId?: string;
  pinIgnoredPriority?: string[];

  // 17 top-level sections
  description?: string;
  attributeTypes?: AttributeTypeDefinition[];
  entityTypes?: EntityType[];
  changeRequestTypes?: ChangeRequestType[];
  roles?: Role[];
  groupTypes?: GroupType[];
  matchActions?: MatchAction[];
  relationTypes?: RelationType[];
  interactionTypes?: InteractionType[];
  graphTypes?: GraphType[];
  categoryTypes?: CategoryType[];
  survivorshipStrategies?: SurvivorshipStrategy[];
  sources?: Source[];
  ratings?: Rating[];
  activity?: Activity;
  groupingTypes?: GroupingType[];
  hierarchyTypes?: HierarchyType[];
}

// ---------------------------------------------------------------------------
// Top-level section types
// ---------------------------------------------------------------------------

/** Global attribute type definition (attributeTypesType) */
export interface AttributeTypeDefinition {
  uri?: string;
  valueType?: string;
  extendsTypeURI?: string;
  matchTokenClass?: GenericMatchTokenClassMapping;
  comparatorClass?: GenericComparatorClassMapping;
}

/** Entity type (entityTypesType) */
export interface EntityType {
  // XSD attributes
  uri: string;
  label?: string;
  typeIcon?: string;
  typeImage?: string;
  typeGraphIcon?: string;
  typeColor?: string;
  entitySmartLogic?: string;
  abstract?: boolean;
  singleDefaultCrosswalk?: boolean;
  skipValidationForAbstractType?: boolean;
  matchBeforeCreate?: boolean;
  configurationLessMatching?: boolean;
  cleanseInputObjectBeforeOverwrite?: boolean;
  searchable?: boolean;
  validateRequiredAttributes?: boolean;
  overrideIgnorePin?: boolean;
  uniqueGeneratedValuePerEntityPerRequest?: boolean;
  ignoreWarnings?: boolean;
  ignoreNonOVChangesWhenUpdateThroughReferencedEntity?: boolean;
  useOnlyOvValuesInReferencedEntities?: boolean;
  forceOvForUiUpdates?: boolean;
  defaultSurvivorshipStrategy?: string;

  // Child elements
  description?: string;
  precedingCleanseProcedureUris?: string[];
  succeedingCleanseProcedureUris?: string[];
  cleanse?: CleanseInfo[];
  dataPipelineConfig?: DataPipelineConfig;
  cleanseConfig?: CleanseConfig;
  attributes?: Attribute[];
  activenessAttributes?: ActivenessAttributes;
  geoLocationAttributes?: GeoAttributes | GeoAttributes[];
  dataLabelPattern?: string;
  secondaryLabelPattern?: string;
  dataTooltipPattern?: string;
  entityTypeRoleURIs?: string[];
  businessCardAttributeURIs?: string[];
  imageAttributeURIs?: string[];
  matchGroups?: MatchGroup[];
  matchAssets?: MatchAssets;
  associationGroups?: AssociationGroup[];
  survivorshipGroups?: SurvivorshipGroup[];
  surrogateCrosswalks?: SurrogateCrosswalk[];
  defaultFacetedAttributes?: string[];
  defaultSearchAttributes?: string[];
  dependentAttributes?: DependentAttributes[];
  lifecycleActions?: unknown;
  analyticsAttributes?: AnalyticsAttributes | AnalyticsAttributes[];
  extendsTypeURI?: string;
  /** List of hidden configs or empty / free-form object (live L3) */
  hidden?: HiddenEntityTypeConfiguration[] | Record<string, unknown>;
  unmerge?: EntityUnmerge;
  ruleBasedAttributes?: RuleBasedAttribute[];
  indexingConfig?: IndexingConfig;
  groupLabels?: string[];
  /** Access / security metadata from API (array of capability strings, map, or string) */
  access?: string | string[] | Record<string, unknown>;
}

/** Relation type (relationTypesType) */
export interface RelationType {
  // XSD attributes
  uri: string;
  label?: string;
  direction?: string;
  implicit?: string | boolean;
  typeColor?: string;
  reverseOfTypeURIs?: string;
  singleDefaultCrosswalk?: boolean;
  sameAsTypeURIs?: string;
  validateRequiredAttributes?: boolean;
  entityEndDateStrategy?: EntityEndDateStrategy;
  ignoreWarnings?: boolean;
  contributorCrosswalkSingleSourceUpdateMode?: boolean;
  defaultSurvivorshipStrategy?: string;

  // Child elements
  description?: string;
  precedingCleanseProcedureUris?: string[];
  succeedingCleanseProcedureUris?: string[];
  cleanse?: CleanseInfo[];
  cleanseConfig?: CleanseConfig;
  attributes?: Attribute[];
  startObject?: RelationEndpoint;
  endObject?: RelationEndpoint;
  activenessAttributes?: ActivenessAttributes;
  survivorshipGroups?: SurvivorshipGroup[];
  lifecycleActions?: unknown;
  extendsTypeURI?: string;
  dataPipelineConfig?: DataPipelineConfig;
  analyticsAttributes?: AnalyticsAttributes | AnalyticsAttributes[];
  indexingConfig?: IndexingConfig;
  access?: string | string[] | Record<string, unknown>;
}

/** Relation endpoint — startObject / endObject (startObjectType / endObjectType) */
export interface RelationEndpoint {
  objectTypeURI?: string;
  uri?: string;
  directionalContext?: DirectionalContext[];
}

/** Directional context on a relation endpoint (directionalContextType) */
export interface DirectionalContext {
  labelPattern?: string;
  uri?: string;
  /** Single rule or list (live L3 / schema `oneOf`) */
  rule?: EndpointRule | EndpointRule[];
}

/** Rule within a directional context (ruleType) */
export interface EndpointRule {
  value?: string;
  condition?: string;
  type?: string;
  attribute?: string;
}

/** Change request type (changeRequestTypesType) */
export interface ChangeRequestType {
  uri: string;
  lifecycleActions?: unknown;
}

/** Role (rolesType) */
export interface Role {
  uri: string;
  label: string;
  description?: string;
  extendsTypeURI?: string;
}

/** Group type (groupTypesType) */
export interface GroupType {
  uri: string;
  type: string;
  label: string;
  limitMemberToOneGroupInstance?: string | boolean;
  multiplePrimaryMembers?: string | boolean;
  hasPrimaryMember?: string | boolean;
  ignoreWarnings?: boolean;

  description?: string;
  precedingCleanseProcedureUris?: string[];
  succeedingCleanseProcedureUris?: string[];
  cleanse?: CleanseInfo[];
  cleanseConfig?: CleanseConfig;
  attributes?: Attribute[];
  dataLabelPattern?: string;
  dataTooltipPattern?: string;
  /** Single element, list, or free-form object (live L3 / schema `oneOf`) */
  groupElements?: GroupElement | GroupElement[] | Record<string, unknown>;
  memberTypes?: MemberType[];
  survivorshipGroups?: SurvivorshipGroup[];
  lifecycleActions?: unknown;
}

/** Match action (matchActionsType) */
export interface MatchAction {
  name: string;
  mapping: MatchActionMapping[];
}

/** Match action mapping (matchActionMappingType) */
export interface MatchActionMapping {
  class: string;
  parameters?: MatchAttributeParameter[];
}

/** Interaction type (interactionTypesType) */
export interface InteractionType {
  uri: string;
  label?: string;
  ignoreWarnings?: boolean;

  attributes?: InteractionAttribute[];
  memberTypes?: MemberType[];
  groupKeyAttributeUris?: string[];
  extendsTypeURI?: string;
  ignoreUniqueness?: boolean;
  hasMembers?: boolean;
  lifecycleActions?: unknown;
  dataPipelineConfig?: DataPipelineConfig;
}

/** Graph type (graphTypesType) */
export interface GraphType {
  uri: string;
  label?: string;
  allowCycles?: string | boolean;
  layout?: string;
  type?: string;
  limitMemberToOneGraphInstance?: string | boolean;
  graphStructure?: string;
  ignoreWarnings?: boolean;

  description?: string;
  relationshipTypeURIs?: string[];
  lifecycleActions?: unknown;
}

/** Category type (categoryTypesType) */
export interface CategoryType {
  uri: string;
  label?: string;
  typeGraphIcon?: string;
  typeImage?: string;
  typeIcon?: string;
  typeColor?: string;
  singleDefaultCrosswalk?: boolean;
  abstract?: boolean;
  ignoreWarnings?: boolean;

  description?: string;
  precedingCleanseProcedureUris?: string[];
  succeedingCleanseProcedureUris?: string[];
  cleanse?: CleanseInfo[];
  cleanseConfig?: CleanseConfig;
  attributes?: Attribute[];
  dataLabelPattern?: string;
  secondaryLabelPattern?: string;
  dataTooltipPattern?: string;
  surrogateCrosswalks?: SurrogateCrosswalk[];
  acceptableEntityTypes?: string[];
  extendsTypeURI?: string;
  lifecycleActions?: unknown;
}

/** Hierarchy type (hierarchyTypesType) */
export interface HierarchyType {
  uri: string;
  label?: string;
  allowedEntityTypes?: string[];
}

/** Survivorship strategy (survivorshipStrategiesType) */
export interface SurvivorshipStrategy {
  uri: string;
  label?: string;
  parentStrategyURI?: string;
  mainSourceType?: string;
  winnerSourceType?: string;
  winnerSourceAttributes?: string | string[];
  primaryAttributeUri?: string;
  default?: boolean;
}

/** Source (sourcesType) */
export interface Source {
  uri: string;
  label?: string;
  icon?: string;
  abbreviation?: string;
  priority?: string | number;
  autoGenerated?: string | boolean;
  generator?: string;
  autoGenerationPattern?: string;

  description?: string;
  indexingConfig?: IndexingConfig;
}

/** Rating (ratingsType) */
export interface Rating {
  sources?: MapEntry[];
  userRoles?: MapEntry[];
  timestamp?: number;
}

/** Activity (activityType) */
export interface Activity {
  uri?: string;
  attributes?: ActivityAttribute[];
}

/** Grouping type (groupingType) */
export interface GroupingType {
  uri: string;
  label?: string;
  source?: string;
  entityType: string;
  groupForSingleEntity?: boolean;

  description?: string;
  members: GroupingMember[];
  attributeMappings?: GroupingAttributeMapping[];
}

// ---------------------------------------------------------------------------
// Attribute system
// ---------------------------------------------------------------------------

/** Attribute (attributesType) — recursive, contains nested attributes.
 *  Many boolean-like fields accept both string and boolean because
 *  the XSD uses xs:string but real Reltio JSON uses native booleans. */
export interface Attribute {
  // XSD attributes (all the xs:attribute entries)
  uri: string;
  type?: string;
  name?: string;
  label?: string;
  hidden?: string | boolean;
  important?: string | boolean;
  faceted?: string | boolean;
  searchable?: string | boolean;
  system?: string | boolean;
  required?: string | boolean;
  prioritizeOv?: string | boolean;
  matchOvOnly?: string | boolean;
  matchFieldURIsIgnoreCase?: string | boolean;
  keyAttributeURIsIgnoreCase?: string | boolean;
  lookupCode2?: string;
  resolveLookupCode?: string | boolean;
  survivorshipStrategy?: string;
  dataLabelPattern?: string;
  relationshipLabelPattern?: string;
  relationshipTypeURI?: string;
  referencedEntityTypeURI?: string;
  referenceAttributeDirection?: string;
  autoGenerated?: string | boolean;
  generator?: string;
  autoGenerationPattern?: string;
  generateIfEmpty?: string | boolean;
  generateIfNotEmpty?: string | boolean;
  generatedValueUniqueForCrosswalk?: string | boolean;
  defaultValue?: unknown;
  skipInDataAccess?: boolean;
  customReltioId?: boolean;
  vectorized?: boolean;

  // Child elements
  values?: unknown[];
  dependentLookupAttributes?: string[];
  attributes?: Attribute[];
  referencedAttributeURIs?: string[];
  immutableForSources?: string[];
  immutableExceptForSources?: string[];
  immutable?: string | boolean;
  doNotOverrideForSourceURIs?: string[];
  matchFieldURIs?: string | string[];
  matchFieldURIsExactOrNull?: string | string[];
  matchFieldURIsExactOrAllNull?: string | string[];
  keyAttributeURIs?: string | string[];
  keyAttributeURIsExactOrNull?: string | string[];
  keyAttributeURIsExactOrAllNull?: string | string[];
  singleValue?: string | boolean;
  singleValueByCrosswalk?: string | boolean;
  singleValueByCrosswalkSources?: SingleValueByCrosswalkSources;
  description?: string;
  attributeOrdering?: AttributeOrdering;
  masking?: AttributeMasking;
  autoGenerationNestedPattern?: MapEntry[] | Record<string, unknown>;
  cardinality?: Cardinality;
  indexingConfig?: IndexingConfig;
  enableNestedPartialOverride?: string | boolean;
  lookupCode?: string;
  /** Access / security metadata from API */
  access?: string | string[] | Record<string, unknown>;
}

/** Interaction attribute — subset of Attribute for interaction types (interactionAttributesType) */
export interface InteractionAttribute {
  uri: string;
  type?: string;
  name?: string;
  label?: string;
  hidden?: string;
  important?: string;
  faceted?: string;
  searchable?: string;
  system?: string;
  required?: string;
  dataLabelPattern?: string;
  maxOccurs?: number;
  skipInDataAccess?: boolean;

  values?: unknown[];
  attributes?: InteractionAttribute[];
  description?: string;
  attributeOrdering?: AttributeOrdering;
  lookupCode?: string;
  access?: string | string[] | Record<string, unknown>;
}

/** Analytics attribute (analyticsAttributesType) — recursive */
export interface AnalyticsAttributes {
  uri: string;
  type?: string;
  name?: string;
  label?: string;
  maxOccurs?: number;
  couldUpdateWithLCA?: boolean;
  dataLabelPattern?: string;
  faceted?: string | boolean;
  searchable?: string | boolean;

  description?: string;
  analyticsAttributes?: AnalyticsAttributes | AnalyticsAttributes[];
}

/** Activity attribute (activityAttributesType) */
export interface ActivityAttribute {
  uri: string;
  type?: string;
  name?: string;
  label?: string;
  searchable?: string;
  description?: string;
}

/** Cardinality (cardinalityType) */
export interface Cardinality {
  maxValue?: number;
  minValue?: number;
}

/** Attribute masking (AttributeMaskingInfoType) */
export interface AttributeMasking {
  regexPattern: string;
  maskMatched?: boolean;
}

/** Attribute ordering (AttributeOrderingInfoType) */
export interface AttributeOrdering {
  orderType?: string;
  fieldURI?: string;
  orderingStrategy?: string;
}

/** Single value by crosswalk sources (singleValueByCrosswalkSourcesType) */
export interface SingleValueByCrosswalkSources {
  include?: string[];
  exclude?: string[];
}

/** Activeness attributes (activenessAttributesType) */
export interface ActivenessAttributes {
  type: string;
  uri: string;
}

/** Geo attributes (geoAttributesType) */
export interface GeoAttributes {
  latitude: string;
  longitude: string;
}

/** Data pipeline config (dataPipelineConfigType) */
export interface DataPipelineConfig {
  enabled: boolean;
  attributes?: string[];
}

/** Indexing config (IndexingConfigType) */
export interface IndexingConfig {
  enabled?: boolean;
  predicateEnabled?: boolean;
  segmentationEnabled?: boolean;
  consistency?: string;
  caseSensitive?: boolean;
  subAttributeValuesLimit?: number;
  attributes?: string[];
}

// ---------------------------------------------------------------------------
// Match system
// ---------------------------------------------------------------------------

/** Match group (matchGroupType) */
export interface MatchGroup {
  // XSD attributes
  uri: string;
  type: string;
  label: string;
  scope?: MatchGroupScope;
  matchServiceClass?: string;
  useOvOnly?: string;
  scoreStandalone?: string | number;
  scoreIncremental?: string | number;
  matchMethod?: MatchMethod;
  crossTypeMatch?: boolean;

  // Child elements
  matchMethodMetadata?: MatchMethodMetadata;
  rule?: MatchRule;
  negativeRule?: NegativeMatchRule;
  documentComparator?: DocumentComparatorMapping;
  documentTokenizer?: DocumentTokenizerMapping;
  aliasing?: MatchGroupAliasing;
  overrides?: MatchGroupOverrides;
  methods?: CompositeMatchMethods;
  postEvaluation?: MatchPostEvaluation;
  candidatesLookup?: CandidatesLookup;
  matchPrerequisites?: MatchPrerequisites;
}

/** Match rule — recursive (logicalRuleSuperpositionType) */
export interface MatchRule {
  matchTokenClass?: string;
  comparatorClass?: string;

  exact?: string[];
  fuzzy?: string[];
  exactOrNull?: string[];
  exactOrAllNull?: string[];
  ignoreInToken?: string[];
  /** Null, URI string, single cleanse config, or list of cleanse steps (live L3 / schema `oneOf`) */
  cleanse?: string | null | MatchRuleCleanse | MatchRuleCleanse[];
  notExact?: NotExactOperand[];
  equals?: EqualsOperand[];
  notEquals?: EqualsOperand[];
  in?: EqualsOperand[];
  multi?: MultiOperand[];
  or?: MatchRule | MatchRule[];
  and?: MatchRule | MatchRule[];
  not?: MatchRule | MatchRule[];
  matchTokenClasses?: MatchTokenClassMappings;
  comparatorClasses?: ComparatorClassMappings;
  nullValues?: NullValues[];
  weights?: AttributeWeight | AttributeWeight[];
  actionThresholds?: ActionThreshold | ActionThreshold[];
}

/** Negative match rule (logicalNegativeRuleSuperpositionType) */
export interface NegativeMatchRule {
  matchTokenClass?: string;
  comparatorClass?: string;

  notExactSame?: string[];
  notFuzzySame?: string[];
  equals?: EqualsOperand[];
  notEquals?: EqualsOperand[];
  in?: EqualsOperand[];
  nullValues?: NullValues[];
  or?: NegativeMatchRule | NegativeMatchRule[];
  and?: NegativeMatchRule | NegativeMatchRule[];
  comparatorClasses?: ComparatorClassMappings;
}

/** Equals operand (equalsOperandType) */
export interface EqualsOperand {
  uri: string;
  value?: string;
  values?: string | string[];
  strict?: boolean;
  weight?: number;
  checkNulls?: boolean;
}

/** Not-exact operand (notExactOperandType) */
export interface NotExactOperand {
  uri?: string;
  multiValueAnyMismatchIsPositive?: boolean;
}

/** Multi operand (multiOperandType) */
export interface MultiOperand {
  uri: string;
  attributes: string[];
  combinationsConfig?: CombinationsConfig;
}

/** Combinations config (combinationsConfigType) */
export interface CombinationsConfig {
  threshold?: number;
  strategy?: MultiAttributeCombinationsStrategy;
}

/** Null values (nullValues) */
export interface NullValues {
  value: string;
  attribute: string;
}

/** Attribute weight (attributeWeight) */
export interface AttributeWeight {
  attribute: string;
  weight: string | number;
}

/** Action threshold (actionThreshold) */
export interface ActionThreshold {
  type: string;
  threshold: string | number;
  label?: string;
}

/** Match rule cleanse (logicalRuleCleanseInfoType) */
export interface MatchRuleCleanse {
  cleanseAdapter: string;
  /** MapEntry list or free-form object (live L3) */
  cleanseAdapterParams?: MapEntry[] | Record<string, unknown>;
  mappings?: CleanseMappingDefinition[];
  attributes?: string[];
}

/** Match token class mappings container (matchTokenClassMappings) */
export interface MatchTokenClassMappings {
  mapping: MatchTokenClassMapping[];
}

/** Comparator class mappings container (comparatorClassMappings) */
export interface ComparatorClassMappings {
  mapping: ComparatorClassMapping[];
}

/** Match token class mapping (matchTokenClassMapping) */
export interface MatchTokenClassMapping {
  attribute: string;
  class: string;
  parameters?: MatchAttributeParameter[];
}

/** Comparator class mapping (comparatorClassMapping) */
export interface ComparatorClassMapping {
  attribute: string;
  class: string;
  parameters?: MatchAttributeParameter[];
}

/** Generic match token class mapping — attribute prohibited (genericAttributeMatchTokenClassMapping) */
export interface GenericMatchTokenClassMapping {
  class: string;
  parameters?: MatchAttributeParameter[];
}

/** Generic comparator class mapping — attribute prohibited (genericAttributeComparatorClassMapping) */
export interface GenericComparatorClassMapping {
  class: string;
  parameters?: MatchAttributeParameter[];
}

/** Document comparator mapping (documentComparatorClassMapping) */
export interface DocumentComparatorMapping {
  class: string;
  parameters?: MatchAttributeParameter[];
  fernConfig?: FernConfig;
}

/** Document tokenizer mapping (documentMatchTokenClassMapping) */
export interface DocumentTokenizerMapping {
  class: string;
  parameters?: MatchAttributeParameter[];
}

/**
 * Comparator / match-token parameter value object (aligns with JSON Schema
 * `$defs/MatchComparatorTokenParameterValue`; superset of `MapEntry` keys).
 */
export type MatchComparatorTokenParameterValue = Record<string, unknown>;

/** Match attribute parameter (matchAttributeMappingParameter) */
export interface MatchAttributeParameter {
  parameter: string;
  value?: string;
  values?: (MapEntry | MatchComparatorTokenParameterValue)[];
}

/** Match method metadata (matchMethodMetadataMapping) */
export interface MatchMethodMetadata {
  packageVersion?: string;
  packageId?: string;
  packageProfile?: string;
  origin?: string;
  matchMethodApplicability?: string;
}

/** Match group aliasing (matchGroupAliasing) */
export interface MatchGroupAliasing {
  mapping?: AliasMapping[];
}

/** Alias mapping (matchGroupAliasMapping) */
export interface AliasMapping {
  from: string;
  to: string;
}

/** Match group overrides (matchGroupOverrides) */
export interface MatchGroupOverrides {
  attributesMapping?: MatchGroupAttributeMapping[];
}

/** Match group attribute mapping (matchGroupAttributeMapping) */
export interface MatchGroupAttributeMapping {
  dataModelAttribute?: string;
  matchMethodAttribute: string;
}

/** Composite match methods (compositeMatchMethodParticipants) */
export interface CompositeMatchMethods {
  links?: MatchMethodLink[];
  weightingAlgorithm?: WeightingAlgorithm;
}

/** Match method link (matchMethodLink) */
export interface MatchMethodLink {
  uri: string;
  retain?: boolean;
}

/** Weighting algorithm (matchMethodsWeightingAlgorithm) */
export interface WeightingAlgorithm {
  type: string;
  fallback?: string;
  parameters?: MatchAttributeParameter[];
  list?: string[];
}

/** Match post evaluation (matchMethodPostEvaluation) */
export interface MatchPostEvaluation {
  type: string;
  assetsList: string[];
}

/** Candidates lookup (candidatesLookupType) */
export interface CandidatesLookup {
  lookupMethods?: LookupMethod[];
}

/** Lookup method (lookupMethodType) */
export interface LookupMethod {
  enabled: boolean;
  type: string;
  parameters?: MatchAttributeParameter[];
}

/** Match prerequisites (matchPrerequisitesType) */
export interface MatchPrerequisites {
  rules?: PrerequisiteRule[];
}

/** Match prerequisite rule (matchPrerequisitesRuleType) */
export interface PrerequisiteRule {
  onMatch?: string;
  scoreThreshold?: string;
  evaluationContinuation?: boolean;
  filters?: PrerequisiteFilter[];
}

/** Match prerequisite filter (matchPrerequisitesRuleFilterType) */
export interface PrerequisiteFilter {
  uri?: string;
  uriPattern?: string;
  type?: string;
  defined?: string;
}

/** Match assets (matchAssetsType) */
export interface MatchAssets {
  algorithm?: string;
  rematchOnThreshold?: boolean;
  assetDefinitions?: AssetDefinition[];
}

/** Asset definition (assetDefinitionType) */
export interface AssetDefinition {
  uri: string;
  label?: string;
  pattern?: string;
  threshold?: number;
  description?: string;
  attributes?: MatchAssetAttribute[];
  sourceSystem?: MatchAssetSourceSystem[];
}

/** Match asset attribute (matchAssetAttributeType) */
export interface MatchAssetAttribute {
  uri: string;
  optional?: boolean;
  defaultValue?: string;
  noiseCharacters?: string;
  transformers?: MatchAssetTransformer[];
}

/** Match asset transformer (matchAssetAttributeTransformerType) */
export interface MatchAssetTransformer {
  type?: string;
  parameters?: MapEntry[];
}

/** Match asset source system (matchAssetSourceSystemType) */
export interface MatchAssetSourceSystem {
  included?: string[];
}

/** Association group (associationGroupType) */
export interface AssociationGroup {
  uri: string;
  label?: string;
  groupEntityTypes: string;
  targetType: string;
  targetUri: string;
  scoreStandalone?: string | number;
  scoreIncremental?: string | number;
  rule: MatchRule;
}

/** FERN config (fernConfigType) */
export interface FernConfig {
  featureDefaults?: FeatureDefaults;
  featureOverrides?: FeatureOverrides;
}

/** Feature defaults (featureDefaultsType) */
export interface FeatureDefaults {
  promptTemplate?: PromptTemplate;
  prefilter?: Prefilter;
}

/** Prefilter (prefilterType) */
export interface Prefilter {
  enabled?: boolean;
  algorithm?: string;
  threshold?: string;
}

/** Feature overrides (featureOverridesType) */
export interface FeatureOverrides {
  entry?: FeatureOverrideEntry[];
}

/** Feature override entry (featureOverrideEntryType) */
export interface FeatureOverrideEntry {
  key: string;
  value: FeatureOverride;
}

/** Feature override (featureOverrideType) */
export interface FeatureOverride {
  promptTemplate?: PromptTemplate;
  prefilter?: Prefilter;
}

// ---------------------------------------------------------------------------
// Survivorship system
// ---------------------------------------------------------------------------

/** Survivorship group (survivorshipGroupsType) */
export interface SurvivorshipGroup {
  uri: string;
  label?: string;
  default: string | boolean;

  roles?: string[];
  sourcesUriOrder?: string[];
  sourcesForOv?: string[];
  mapping?: SurvivorshipMapping | SurvivorshipMapping[];
  description?: string;
}

/** Survivorship mapping — recursive (survivorshipGroupMapping) */
export interface SurvivorshipMapping {
  survivorshipStrategy: string;
  attribute?: string;
  sortAs?: string;
  comparisonAttributeUri?: string;
  comparisonAttributeOvOnly?: string | boolean;
  primaryAttributeUri?: string;
  fallbackUsingCriteria?: FallbackUsingCriteria;
  ignoreCase?: boolean;

  sourcesUriOrder?: string[];
  valuesPriorityOrder?: string[];
  /** Array of URIs, single URI string, or object map (live L3) */
  lookupComparisonField?: string | string[] | Record<string, unknown>;
  sourcesForOv?: string[];
  filter?: SurvivorshipFilter;
  fallbackStrategiesChain?: string[];
  fallbackStrategies?: SurvivorshipMapping[];
}

/** Survivorship filter (survivorshipGroupMappingFilterType) */
export interface SurvivorshipFilter {
  equals?: FilterEqualsCriteria[];
  ne?: FilterNotEqualsCriteria[];
  lt?: FilterLessCriteria[];
  lte?: FilterLessOrEqualCriteria[];
  gt?: FilterGreatCriteria[];
  gte?: FilterGreatOrEqualCriteria[];
  missing?: FilterMissingCriteria[];
  exists?: FilterExistsCriteria[];
  in?: FilterInCriteria[];
  notIn?: FilterNotInCriteria[];
  /** Single condition or list (live L3 / schema `oneOf`) */
  or?: OrCondition | OrCondition[];
  and?: AndCondition | AndCondition[];
  discardIgnoredDeletedValues?: boolean;
}

export interface FilterEqualsCriteria {
  uri: string;
  value: string;
}

export interface FilterNotEqualsCriteria {
  uri: string;
  value: string;
}

export interface FilterLessCriteria {
  uri: string;
  value: string;
}

export interface FilterLessOrEqualCriteria {
  uri: string;
  value: string;
}

export interface FilterGreatCriteria {
  uri: string;
  value: string;
}

export interface FilterGreatOrEqualCriteria {
  uri: string;
  value: string;
}

export interface FilterMissingCriteria {
  uri?: string;
}

export interface FilterExistsCriteria {
  uri?: string;
}

export interface FilterInCriteria {
  uri: string;
  value: string;
}

export interface FilterNotInCriteria {
  uri: string;
  value: string;
}

export interface OrCondition {
  uri?: string;
  operator?: string;
  value?: string;
  or?: OrCondition | OrCondition[];
  and?: AndCondition | AndCondition[];
}

export interface AndCondition {
  uri?: string;
  operator?: string;
  value?: string;
  or?: OrCondition | OrCondition[];
  and?: AndCondition | AndCondition[];
}

// ---------------------------------------------------------------------------
// Cleanse system
// ---------------------------------------------------------------------------

/** Cleanse info (cleanseInfoType) */
export interface CleanseInfo {
  cleanseProvider: string;
  uri: string;
  resultingValuesSourceTypeUri: string;
  inputMapping: CleanseMappingDefinition[];
  outputMapping: CleanseMappingDefinition[];
}

/** Cleanse config (cleanseConfigType) */
export interface CleanseConfig {
  uri?: string;
  mappings?: CleanseMappings[];
  infos?: CleanseInfos[];
  addressAutoCompleteConfig?: AddressAutoCompleteConfig;
  attributeVerificationConfig?: AttributeVerificationConfig[];
}

/** Cleanse mappings (cleanseMappingsType) */
export interface CleanseMappings {
  uri?: string;
  inputMapping?: CleanseMappingDefinition[];
  inputMappingRef?: string;
  outputMapping?: CleanseMappingDefinition[];
  outputMappingRef?: string;
}

/** Cleanse infos (cleanseInfosType) */
export interface CleanseInfos {
  uri: string;
  useInCleansing?: string | boolean | null;
  nestedAttributeToCleanse?: string;
  sequence?: CleanseSequence[];
}

/** Cleanse sequence (cleanseSequenceType) */
export interface CleanseSequence {
  uri?: string;
  chain?: CleanseChain[];
}

/** Cleanse chain (cleanseChainType) */
export interface CleanseChain {
  uri?: string;
  cleanseFunction: string;
  resultingValuesSourceTypeUri?: string;
  proceedOnSuccess?: string | boolean;
  proceedOnFailure?: string | boolean;
  removeOldCleanseResultsOnFailure?: string | boolean;
  mapping?: CleanseMappings;
  /** MapEntry list or free-form object map (live L3) */
  params?: MapEntry[] | Record<string, unknown>;
  /** Optional filter expression on the cleanse chain (live L3) */
  filter?: string | Record<string, unknown>;
}

/** Cleanse mapping definition (cleanseMappingsDefinitionType) */
export interface CleanseMappingDefinition {
  attribute: string;
  cleanseAttribute: string;
  uri?: string;
  mandatory?: boolean;
  allValues?: boolean;
}

/** Address auto-complete config (addressAutoCompleteMappingConfigType) */
export interface AddressAutoCompleteConfig {
  uri: string;
  minSearchTextLen?: number;
  providerOpts?: MapEntry[] | Record<string, unknown>;
  inputMapping?: CleanseMappingDefinition[];
  inputMappingRef?: string;
  outputMapping?: CleanseMappingDefinition[];
  outputMappingRef?: string;
}

/** Attribute verification config (attributeVerificationMappingConfigType) */
export interface AttributeVerificationConfig {
  uri?: string;
  resultingValuesSourceTypeUri?: string;
  verificationFunction: string;
  params?: MapEntry[];
  inputMapping?: VerificationMappingDefinition[];
  outputMapping?: VerificationMappingDefinition[];
}

/** Verification mapping definition (verificationMappingsDefinitionType) */
export interface VerificationMappingDefinition {
  attribute: string;
  verificationAttribute: string;
  mandatory?: boolean;
  uri?: string;
}

// ---------------------------------------------------------------------------
// Other types
// ---------------------------------------------------------------------------

/** Surrogate crosswalk (surrogateCrosswalkType) */
export interface SurrogateCrosswalk {
  source?: string;
  generationLogic?: GenerationLogic;
  enforce?: boolean;
  attributes: string[];
}

/** Dependent attributes (dependentAttributesType) */
export interface DependentAttributes {
  attributeUri: string;
  default?: string[];
  values?: DependentAttributeValues[];
}

/** Dependent attribute values (dependentAttributeValuesType) */
export interface DependentAttributeValues {
  valuesList?: string[];
  visibleAttributes: string[];
}

/** Rule-based attribute (ruleBasedAttributes) */
export interface RuleBasedAttribute {
  uri: string;
  name: string;
  type: RuleBasedAttributeType;
  label?: string;
  description?: string;
  controlFunction: ControlFunction;
}

/** Control function (controlFunctionType) */
export interface ControlFunction {
  expression: string;
  showAttributeURI: string[];
}

/** Entity unmerge (entityUnmergeType) */
export interface EntityUnmerge {
  enabled?: boolean;
  retainManualMerges?: boolean;
  retainMergeConditions?: RetainMergeCondition;
  actions?: UnmergeAction[];
}

/** Retain merge condition (retainMergeConditionType) */
export interface RetainMergeCondition {
  sources?: string[];
  matchGroups?: UnmergeMatchGroup[];
}

/** Unmerge match group (unmergeMatchGroupType) */
export interface UnmergeMatchGroup {
  uri: string;
}

/** Unmerge action (onUnmergeAction) */
export interface UnmergeAction {
  enabled: boolean;
  proceed?: boolean;
  type: string;
  parameters?: MatchAttributeParameter[];
}

/** Hidden entity type configuration (hiddenEntityTypeConfigurationType) */
export interface HiddenEntityTypeConfiguration {
  matchGroups?: MatchGroup[];
  skippedMatchRules?: string[];
}

/** Group element (groupElementsType) */
export interface GroupElement {
  uri: string;
  entityTypeURIs: string | string[];
  reachByRelationTypeURIs?: string | string[];
}

/** Member type (memberTypesType) */
export interface MemberType {
  uri: string;
  label?: string;
  name?: string;
  primaryMember?: string | boolean;
  minOccurs?: string | boolean | number;
  objectTypeURI?: string;
}

/** Grouping member (groupingMember) */
export interface GroupingMember {
  entityType: string;
  relationType: string;
  groupingRule: string;
}

/** Grouping attribute mapping (groupingAttributeMapping) */
export interface GroupingAttributeMapping {
  uri: string;
  function: GroupingFunction;
}

/** Grouping function (groupingFunction) */
export interface GroupingFunction {
  type: GroupingFunctionType;
  config?: unknown;
  survivorshipGroupMapping?: SurvivorshipMapping;
}

// ---------------------------------------------------------------------------
// Generic map/entry types
// ---------------------------------------------------------------------------

/** Key-value entry for XSD map/hashMap types */
export interface MapEntry {
  key?: string;
  value?: unknown;
}
