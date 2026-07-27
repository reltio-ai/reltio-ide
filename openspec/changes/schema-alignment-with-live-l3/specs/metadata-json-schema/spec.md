## ADDED Requirements

### Requirement: Cleanse chain flags accept API booleans and legacy strings

The JSON Schema SHALL allow `proceedOnSuccess`, `proceedOnFailure`, and other cleanse-chain fields that the platform encodes as JSON booleans to validate when the schema previously required only strings. The schema SHALL continue to accept string encodings for the same fields where legacy configurations use them.

#### Scenario: Boolean proceed flags validate

- **WHEN** a `CleanseChain` object contains `proceedOnSuccess` or `proceedOnFailure` with JSON boolean values as returned by the Reltio configuration API
- **THEN** the contributed JSON Schema validation SHALL NOT report a type error solely for those boolean values

#### Scenario: String proceed flags still validate

- **WHEN** the same fields contain string values
- **THEN** validation SHALL NOT regress relative to the prior string-only schema acceptance for those values

### Requirement: Cleanse info fields accept null where the API sends null

The JSON Schema SHALL permit `null` and JSON **booleans** for `useInCleansing` (and other cleanse metadata fields) on `CleanseInfos` when live L3 payloads use those forms instead of strings.

#### Scenario: Null useInCleansing validates

- **WHEN** `cleanseConfig.infos[]` includes `useInCleansing: null`
- **THEN** validation SHALL NOT emit a type error for that null value

#### Scenario: Boolean useInCleansing validates

- **WHEN** `cleanseConfig.infos[]` includes `useInCleansing` as a JSON boolean (e.g. `true`) as returned by the API
- **THEN** validation SHALL NOT emit a type error for that boolean value

### Requirement: CleanseChain params accept object or MapEntry array

The JSON Schema SHALL accept `CleanseChain.params` as either an array of `MapEntry` (existing shape) or a JSON object (key/value map structures returned by the API).

#### Scenario: Object params validate

- **WHEN** `params` is a JSON object (including nested maps) as in live L3 cleanse configuration
- **THEN** validation SHALL NOT reject it for being a non-array

#### Scenario: Array params still validate

- **WHEN** `params` is an array of map entries
- **THEN** validation SHALL continue to accept that shape

### Requirement: Polymorphic match and relation rules validate

The JSON Schema SHALL model polymorphic fields—including `matchGroups[].rule.cleanse`, relation `directionalContext[].rule`, and match/survivorship `and` nodes—so that string, object, and (where present in live L3) array encodings validate without spurious type errors.

#### Scenario: String cleanse reference on match rule validates

- **WHEN** `matchGroups[].rule.cleanse` is a string (e.g. URI reference) as returned by the API
- **THEN** validation SHALL NOT require that value to be only an object

#### Scenario: Array of cleanse steps on match rule validates

- **WHEN** `matchGroups[].rule.cleanse` is an array of cleanse configuration objects
- **THEN** validation SHALL accept that shape

#### Scenario: Directional context rule variants validate

- **WHEN** `directionalContext[].rule` uses an object or array shape present in live L3
- **THEN** validation SHALL accept those shapes per the schema’s declared unions

### Requirement: Match comparator and token parameter values include platform keys

The JSON Schema definitions for comparator and match-token parameter value objects SHALL include optional properties for high-frequency keys observed in live L3 (including but not limited to `className`, `pattern`, `noiseDictionary`, `classParams`, `useNoiseIfEmpty`, `sortWords`, `useSoundex`, `useStemmer`, `wordReplacements`, `transliterate`, `wordDelimiter`, `splitByWordsBoundaries`, `parameter`) so that valid platform payloads do not fail solely due to `additionalProperties: false` omissions.

#### Scenario: className on parameter value validates

- **WHEN** a parameter value object includes a `className` property used by the platform
- **THEN** validation SHALL NOT report an additionalProperties error for `className` alone

#### Scenario: pattern and noiseDictionary validate

- **WHEN** the same class of objects includes `pattern` and/or `noiseDictionary`
- **THEN** validation SHALL NOT report additionalProperties errors for those keys alone

### Requirement: Schema alignment verified in the editor on representative configurations

After substantive schema edits, maintainers SHOULD open representative `L3.reltio.json` files (for example under `examples/prod/` when available locally) and confirm that `schemas/reltio-metadata.schema.json` validates as expected in VS Code. _(Historical: a batch `scripts/validate-corpus.cjs` harness and `VALIDATION_IMPROVEMENTS.md` supported aggregate corpus compares; both have been **removed**.)_

#### Scenario: Editor validation on examples corpus files

- **WHEN** a maintainer opens `L3.reltio.json` under `examples/prod/` (or other `examples/` paths) matching `*.reltio.json`
- **THEN** VS Code SHALL apply `schemas/reltio-metadata.schema.json` via built-in `jsonValidation` and surface any schema violations in the Problems panel

#### Scenario: Editor validation on samples

- **WHEN** a maintainer opens `samples/*.reltio.json` or nested sample tenant `L3.reltio.json`
- **THEN** VS Code SHALL apply the same schema via `jsonValidation`

### Requirement: Match rule weights and action thresholds accept live L3 shapes

The JSON Schema for **`MatchRule.weights`** and **`MatchRule.actionThresholds`** SHALL accept the shapes returned by the Reltio configuration API on the examples corpus, including **object** and **array** (or other observed variants) via `oneOf` or equivalent unions—not only a single object `$ref` when live payloads use arrays.

#### Scenario: Array-shaped weights validate

- **WHEN** `matchGroups[].rule.weights` is a JSON array as present in live L3 under `examples/prod/`
- **THEN** validation SHALL NOT reject it solely for not being a single object

#### Scenario: Array-shaped action thresholds validate

- **WHEN** `matchGroups[].rule.actionThresholds` is a JSON array as present in live L3
- **THEN** validation SHALL NOT reject it solely for not being a single object

### Requirement: Group and member configuration accepts booleans and alternate shapes

The JSON Schema for **`GroupType`**, **`MemberType`**, and related **`GroupElement`** (and sibling fields) SHALL accept `string | boolean` (and `null` where the API sends it) for fields that the corpus still flags as string-only XSD holdovers—including but not limited to `primaryMember`, `hasPrimaryMember`, `multiplePrimaryMembers`, `limitMemberToOneGroupInstance`, `minOccurs`, `enableNestedPartialOverride`, and `autoGenerated`. **`groupElements`** SHALL accept the shapes used in live L3 (single object, **array**, or richer object) per `oneOf` or dedicated `$defs` informed by corpus inspection.

#### Scenario: Boolean primary member flags validate

- **WHEN** a `MemberType` (or equivalent group member node) includes `primaryMember` or related flags as JSON booleans
- **THEN** validation SHALL NOT emit a type error solely for boolean values

#### Scenario: groupElements array form validates

- **WHEN** `groupElements` is a JSON array as returned by the API for some tenants
- **THEN** validation SHALL accept that shape without requiring a single object only

### Requirement: Survivorship mapping lookup comparison field is polymorphic

The JSON Schema for **`SurvivorshipMapping.lookupComparisonField`** SHALL accept **array**, **object**, and **string** forms (as applicable) observed in live L3, using `oneOf` or a typed union—not a single array-only or object-only constraint when both appear in the corpus.

#### Scenario: Single-object lookupComparisonField validates

- **WHEN** `lookupComparisonField` is a single object
- **THEN** validation SHALL accept it

#### Scenario: Array lookupComparisonField validates

- **WHEN** `lookupComparisonField` is an array of comparison descriptors
- **THEN** validation SHALL accept it

### Requirement: Match comparator token parameter groupTokenLimit accepts string or number

The JSON Schema property **`groupTokenLimit`** on `MatchComparatorTokenParameterValue` (or equivalent `$def`) SHALL accept **`integer`** and **`string`** encodings when both appear in live L3.

#### Scenario: String groupTokenLimit validates

- **WHEN** a comparator/token parameter value includes `"groupTokenLimit": "10"` (string digits)
- **THEN** validation SHALL NOT report a type error solely for string encoding

### Requirement: Nested structures and entity extensions do not spuriously fail additionalProperties

For remaining **`additionalProperties`** failures observed on the examples corpus (including nested keys under **`classParams`** and similar objects), the schema SHALL be updated by **extending inner `$defs`** or by **narrowly** setting `additionalProperties` where the platform is open-ended, until material reduction or the team documents an intentional cap. Documented optional keys on **`EntityType`** / **`Attribute`** (e.g. **`access`**) used in API-round-tripped configs SHALL be accepted without requiring removal from tenant JSON.

#### Scenario: access on entity type validates

- **WHEN** an `entityTypes[]` entry includes an `access` property as in `samples/r360.reltio.json` or live L3
- **THEN** validation SHALL NOT report an additionalProperties error for `access` alone on that object

#### Scenario: Nested classParams extras validate

- **WHEN** nested objects under comparator configuration include keys not yet listed in `$defs` but allowed by the narrowed loosening decision for that subtree
- **THEN** validation SHALL NOT fail solely for those documented or explicitly loosened keys

### Requirement: Residual match rule cleanse shapes validate

The JSON Schema for **`MatchRule.cleanse`** SHALL be extended so all cleanse payloads in the examples corpus match **some** `oneOf` branch—including **`null`** or other wrapper shapes if present after inspection of failing tenants in that corpus.

#### Scenario: Null cleanse validates when API sends null

- **WHEN** `matchGroups[].rule.cleanse` is JSON `null` where the platform allows omission-by-null
- **THEN** validation SHALL accept `null` without `oneOf` failure, if that shape is confirmed in corpus-driven inspection

### Requirement: TypeScript model stays aligned with schema phase 2

When phase 2 schema widenings ship (`tasks.md` §7), **`src/model/types.ts`** SHALL be updated so interfaces for `MatchRule`, `GroupType`, `MemberType`, `SurvivorshipMapping`, `EntityType`, `Attribute`, and related types reflect the same unions and optional fields, and **`npm run compile`** SHALL succeed.

#### Scenario: Compile after model sync

- **WHEN** schema phase 2 changes are merged with corresponding `src/model/types.ts` updates
- **THEN** the TypeScript project SHALL compile without new errors attributable to those types
