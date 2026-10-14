# Match rules reference

Companion to `SKILL.md`. Use it to choose operators, match token and comparator classes, cleansers and scoring.

It is grounded in three sources:

- **The schema**: [match-group.schema.json](./match-group.schema.json) in this folder, the match-group part of the Reltio IDE's schema (`MatchGroup`, `MatchRule`, `NegativeMatchRule` and what they use). These set `additionalProperties: false`, so a misspelled field fails validation, and shows up in the editor's Problems panel once the rule is in the file.
- **Reltio's match-rule documentation**, for the classes, parameters and semantics below.
- **The Velocity Pack configurations** in `.reltio/reltio-agent/velocity-packs/*/BusinessConfig.json`, for patterns real tenants use. Search them for a class name to see it in context.

This is not Reltio's full catalogue. If a requirement needs something not covered here, say so, and rely on live verification to confirm it works.

---

## 1. Match group fields

A match group is one entry in an entity type's `matchGroups` array.

| Field | Required | Values |
|---|---|---|
| `uri` | yes | `configuration/entityTypes/<Type>/matchGroups/<Name>`. Unique on the entity type. |
| `label` | yes | States the logic, e.g. `Fuzzy(FirstName, LastName); Exact(Email)`. |
| `type` | yes | `suspect`: matches are queued for review as potential matches. `automatic`: matches merge. `relevance_based`: the action comes from a score and `actionThresholds` (§6). Tenants may also use other types (`automatic_grouping`, …); don't introduce them unless asked. |
| `scope` | no | `ALL`: internal and external matching. `INTERNAL`: only between the tenant's own records. `EXTERNAL`: only against external data (for example a data tenant). Lowercase is also accepted. |
| `useOvOnly` | no | `true`: compare operational values only (the survivorship winners). `false`: compare all values, which raises sensitivity and noise. **Omitted means `false`.** Write a boolean; existing configurations often hold the string `"true"`, which is also valid. |
| `rule` | yes, unless `negativeRule` | The match expression (§2). |
| `negativeRule` | instead of `rule` | See §5. |
| `scoreStandalone`, `scoreIncremental` | no | Numbers. `scoreStandalone` is the rule's score when it matches on its own; `scoreIncremental` is added when a higher-scoring rule also matched. Usually `0`. |

Leave other schema fields (`matchMethod`, `crossTypeMatch`, `matchServiceClass`, …) out unless the user asks.

## 2. Rule operators

Operand lists hold full attribute URIs.

### Comparison

| Operator | True when |
|---|---|
| `exact` | Values match, as judged by the attribute's comparator. |
| `fuzzy` | Values are similar, as judged by the attribute's comparator. **Without a fuzzy comparator mapping this behaves like `exact`.** |
| `exactOrNull` | Values match, **or** one side is empty, **or** both are. |
| `exactOrAllNull` | Values match, **or** both are empty. One side empty fails. |
| `notExact` | Values do **not** match exactly. Items are objects: `[{ "uri": "<attr>" }]`. |
| `multi` | Compares several attributes as one: swapped first/last names (§3, `CrossMultiComparator`) or latitude + longitude (§3, geo). `[{ "uri": "<group uri>", "attributes": ["<attr>", "<attr>"] }]`. |

### Logic and filters

| Operator | Meaning |
|---|---|
| `and` / `or` | All / any child conditions hold. Either an object, whose operators are all combined, or an array of nested rules. |
| `not` | The child condition does not hold. |
| `equals` | The attribute holds one of the values: `[{ "uri": "<attr>", "values": ["Sales"] }]`. |
| `in` | Same shape as `equals`, for a set of values. |
| `notEquals` | The attribute holds none of the values. |
| `ignoreInToken` | The listed attributes are compared, but generate no match tokens. Use it for filter attributes, and **always** alongside `notEquals`. |
| `nullValues` | Values to treat as empty before `exactOrNull` / `exactOrAllNull`: `[{ "attribute": "<attr>", "value": "NA" }]`. |

**Put several conditions inside an explicit `and`.** The rule object accepts several operators side by side, but an explicit `and` makes the intent unambiguous to reviewers.

### Common patterns

| Requirement | Pattern |
|---|---|
| Attribute **missing on both** records | `equals` with only a `uri`: `[{ "uri": "…/Email/attributes/Email" }]` |
| Attribute **present on both**, whatever the value | `notEquals` with only a `uri`, plus that attribute in `ignoreInToken` |
| Only some source systems | `in`: `[{ "uri": "configuration/sources", "values": ["SAP", "Salesforce"] }]` |
| Only **across** sources, never within one | `not`: `{ "exact": ["configuration/sources"] }` |
| Exclude a source | `not`: `{ "equals": [{ "uri": "configuration/sources", "values": ["DnB"] }] }` |
| Only when a field has a value | `equals` / `in` on that field, e.g. `AddressRank` in `["1", "2"]` |

## 3. Match token and comparator classes

Each attribute has a **match token class**, which decides which records become candidates at all, and a **comparator class**, which decides whether two values agree. Map both for **every** attribute in the rule, in `rule.matchTokenClasses.mapping` and `rule.comparatorClasses.mapping`, as `{ "attribute": "<uri>", "class": "<class>" }`. An unmapped attribute uses its **attribute type's** default classes if it has one, otherwise `ExactMatchToken` with `BasicStringComparator`. Attribute types in `attributeTypes` can declare `matchTokenClass` / `comparatorClass` (shipped packs do this for `PhoneNumber`, `AddressLine`, `Email`, `SimpleName`, `OrganizationName`, `WebsiteURL`), so an unmapped attribute may not behave as its operator suggests. The plain fallback is right for `exact` but silently turns `fuzzy` into exact. Mapping every attribute explicitly keeps the rule's behaviour visible in the rule itself.

Class prefixes are `com.reltio.match.token.` and `com.reltio.match.comparator.`.

| Data | Operator | Token class | Comparator class | Parameters |
|---|---|---|---|---|
| Exact strings: IDs, email, city, codes | `exact` | `ExactMatchToken` | `BasicStringComparator` | |
| Person first or last name | `fuzzy` | `DoubleMetaphoneMatchToken` | `DoubleMetaphoneComparator` | Add `NameDictionaryCleanser` for first names (§4). |
| Person name, Soundex variant | `fuzzy` | `ComplexPhoneticNameToken` | `SoundexComparator` | |
| Organization name, noise words removed | `fuzzy` | `BasicTokenizedOrganizationNameMatchToken` | `BasicTokenizedOrganizationNameComparator` | Built-in noise list (Inc, LLC, Corp…). |
| Organization name, share of words | `fuzzy` | `OrganizationNameMatchToken` | `OrganizationNamesComparator` | |
| Organization name, Jaro-Winkler | `fuzzy` | none (put the name in `ignoreInToken`) | `CustomComparator` wrapping `JaroWinklerComparator` | See *Custom classes*. |
| Street address line | `fuzzy` | `AddressLineMatchToken` | `AddressLineComparator` | Built-in noise list (St, Ave, Rd…). |
| Phone, tolerant of formats | `fuzzy` | `PhoneNumberMatchToken` | `PhoneNumberComparator` | |
| Phone, exact | `exact` | `ExactNumberMatchToken` or `ExactMatchToken` | `PhoneNumberComparator` | |
| Product, material or other single-word text with typos | `fuzzy` | `FuzzyTextAndNumberMatchToken` | `DynamicDamerauLevenshteinDistance` | |
| Product name, phonetic | `fuzzy` | `FuzzyTextMatchToken` | `MetaphoneComparator` | |
| Multi-word text, word by word | `fuzzy` | `DistinctWordsMatchToken` | `DistinctWordsComparator` | `threshold` (share of words, e.g. `"60%"`), `useStemmer`, `useSoundex` |
| Numbers within a range | `fuzzy` | `RangeNumericMatchToken` | `RangeNumericComparator` | `threshold`: absolute (`"10"`) or a percentage (`"10%"`) of the **smaller** value |
| Latitude / longitude | `multi` | `ProximateGeoToken` | `ProximateGeoComparator` | `distance_miles`, e.g. `"0.02"` |
| Swapped first / last name | `multi` | — | `CrossMultiComparator` on the group, `BasicStringComparator` on each member | |

Parameters go on a mapping as `"parameters": [{ "parameter": "threshold", "value": "10" }]`. **Write parameter values as strings** (`"true"`, `"10"`); the schema rejects other types.

### Custom classes

`CustomMatchToken` and `CustomComparator` apply a class to part of a value, or with options plain mappings don't offer, through a `groups` parameter:

```json
{
  "attribute": "configuration/entityTypes/HCP/attributes/FirstName",
  "class": "com.reltio.match.comparator.CustomComparator",
  "parameters": [{
    "parameter": "groups",
    "values": [{ "className": "com.reltio.match.comparator.BasicStringComparator", "pattern": "[A-Za-z]{3}$" }]
  }]
}
```

Each group may carry:

| Key | Purpose |
|---|---|
| `className` | The class applied to this part. |
| `pattern` | Regular expression selecting the part: `[A-Za-z]{3}$` last 3 letters, `\\d{6}$` last 6 digits, `^([0-9]{5})` first 5 digits of a ZIP, `\\w+` each word. |
| `classParams` | Parameters for that class: `{ "threshold": "80%" }` for a token class, `{ "thresholdChars": "80%" }` (share of characters) for `DistinctWordsComparator`, `{ "similarityThreshold": "0.8" }` for `JaroWinklerComparator`. |
| `noiseDictionary` | Words to ignore: `"organizationName"` for the built-in organization list, or the URL of a custom list (§4). |
| `sortWords` | Sort words before comparing, so word order doesn't matter. |
| `useNoiseIfEmpty` | If removing noise leaves nothing, compare the original value. |

Use the same `pattern` on the token side and the comparator side, or tokens and comparisons disagree.

## 4. Cleansers

Cleansers normalise values during matching only. They never change stored data. They go in `rule.cleanse`.

**Name synonyms** (`Bob` ↔ `Robert`): `com.reltio.cleanse.impl.NameDictionaryCleanser`.

```json
"cleanse": [{
  "cleanseAdapter": "com.reltio.cleanse.impl.NameDictionaryCleanser",
  "cleanseAdapterParams": { "dictionary": "SynonymFirstNamesNA_2020-09-01", "keepOriginalValue": false },
  "mappings": [{
    "attribute": "configuration/entityTypes/Individual/attributes/FirstName",
    "cleanseAttribute": "configuration/entityTypes/Individual/attributes/FirstName"
  }]
}]
```

- `dictionary`: name `SynonymFirstNamesNA_2020-09-01`. Without it, the older `SynonymFirstNamesNA_2012-06-01` applies.
- `keepOriginalValue`: also compare the original value alongside the synonym.
- **A team's own synonym list** is an RDM lookup type: set `dictionary` to `rdm/lookupTypes/<TYPE>`, plus `rdmServiceUri`, `oauthInstance` and `rdmTenantId`. Ask the user for these; never guess them.

**String replacement**: `com.reltio.cleanse.impl.RegexpReplaceCleanser`, with `cleanseAdapterParams.dictionary` set to the URL of a hosted text file of `source=>replacement` lines (regular expressions allowed on the left). Reltio Support hosts the file and returns its URL, so **only use this when the user supplies that URL**. For a replacement a file can't express, such as collapsing repeated spaces into one, add `"dictionaryItems": [{ "regex": "\\s{2,}", "replacement": " " }]`.

**Custom noise words** are not a cleanser. Wrap the comparator, and its token class, in `CustomComparator` / `CustomMatchToken` with a group whose `noiseDictionary` is the URL of the team's list (§3). Same rule: only with a URL the user supplies.

## 5. Negative rules

A match group with `negativeRule` instead of `rule` **demotes any automatic merge to a suspect match** when it holds, for example when two records carry different NPIs. Its `type` has no effect. Operators: `notExactSame`, `notFuzzySame`, plus `equals`, `notEquals`, `in`, `and`, `or`.

## 6. Relevance-based rules

`type: "relevance_based"` scores a pair from 0 to 1. Each comparator returns a relevance (`BasicStringComparator`: 0 or 1; `DistinctWordsComparator` and others: fractions), and the operators combine them:

| Operator | Score |
|---|---|
| `and` | Weighted average: Σ(relevance × weight) ÷ Σ(weight) |
| `or` | Highest weighted value: max(relevance × weight) |
| `not` | 1 − relevance |

**Weights** go in `rule.weights`. An unlisted simple attribute weighs `1`; an unlisted nested attribute takes the largest weight among its sub-attributes.

**`actionThresholds`** map score ranges to actions: `auto_merge` and `potential_match` (a suspect match). A score on a boundary, or where ranges overlap, produces a potential match. A score outside every range produces nothing, so leave no unintended gaps.

```json
"weights": [
  { "attribute": "configuration/entityTypes/Individual/attributes/LastName", "weight": 1.0 },
  { "attribute": "configuration/entityTypes/Individual/attributes/FirstName", "weight": 0.5 }
],
"actionThresholds": [
  { "type": "auto_merge", "threshold": "0.8-1.0" },
  { "type": "potential_match", "threshold": "0.5-0.8" }
]
```

Worked example, weights FirstName 0.5, LastName 1.0, MiddleName 0.3, all under `and`: `Jon Doe` vs `Jonathan A Doe` scores (0×0.5 + 1×1.0 + 0×0.3) ÷ 1.8 = 0.56, a potential match. Verification reports each rule's `relevance`, so compare it with your calculation.

## 7. Attribute URIs

Full paths: `configuration/entityTypes/<Type>/attributes/<Attr>`, adding `/attributes/<Sub>` per nesting level, for example `…/Email/attributes/Email`. Source systems are `configuration/sources`.

**Never assume a name.** Tenants differ (`Address` vs `Addresses`, `Zip/attributes/Zip5` vs `Zip5`, `Phone/attributes/Number` vs `FormattedNumber`). Use the URIs that exist in the configuration file.

A `multi` group's `uri` names the combination. Use the URI of the real parent attribute where one exists (`…/Address/attributes/GeoLocation`). A made-up name such as `…/attributes/NameSwap` works, but the editor reports it as an unresolved URI; say so in your report.

## 8. Pitfalls

- **Fuzzy without classes is exact.** Map a fuzzy comparator for every `fuzzy` attribute.
- **Over-merging.** Name-only or fuzzy-only rules produce false positives. Add a strong qualifier (email, phone, identifier, address), or use `suspect` instead of `automatic`.
- **No shared token.** If every attribute in a rule is in `ignoreInToken`, or the token classes produce nothing in common, the pair is never compared. Verification reports this as `no-shared-token`.
- **`notEquals` without `ignoreInToken`** tokenizes unexpectedly.
- **Mismatched patterns.** A `CustomMatchToken` and its `CustomComparator` need the same `pattern`.
- **Duplicates.** Don't reuse an existing match group `uri`.

## 9. Worked examples

All schema-valid. Use them as shapes, after replacing every URI with one that exists in the user's configuration. **[examples.md](./examples.md)** has over 40 more, organised by operator, kind of data, cleanser and scenario.

### Exact email

```json
{
  "uri": "configuration/entityTypes/Individual/matchGroups/ExactEmail",
  "label": "Exact(Email)",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "matchTokenClasses": { "mapping": [
      { "attribute": "configuration/entityTypes/Individual/attributes/Email/attributes/Email", "class": "com.reltio.match.token.ExactMatchToken" }
    ] },
    "comparatorClasses": { "mapping": [
      { "attribute": "configuration/entityTypes/Individual/attributes/Email/attributes/Email", "class": "com.reltio.match.comparator.BasicStringComparator" }
    ] },
    "exact": ["configuration/entityTypes/Individual/attributes/Email/attributes/Email"]
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Fuzzy names and exact email or phone

```json
{
  "uri": "configuration/entityTypes/Individual/matchGroups/FuzzyNameEmailOrPhone",
  "label": "Fuzzy(FirstName, LastName); Exact(Email or Phone)",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "cleanse": [{
      "cleanseAdapter": "com.reltio.cleanse.impl.NameDictionaryCleanser",
      "cleanseAdapterParams": { "dictionary": "SynonymFirstNamesNA_2020-09-01", "keepOriginalValue": false },
      "mappings": [{
        "attribute": "configuration/entityTypes/Individual/attributes/FirstName",
        "cleanseAttribute": "configuration/entityTypes/Individual/attributes/FirstName"
      }]
    }],
    "matchTokenClasses": { "mapping": [
      { "attribute": "configuration/entityTypes/Individual/attributes/FirstName", "class": "com.reltio.match.token.DoubleMetaphoneMatchToken" },
      { "attribute": "configuration/entityTypes/Individual/attributes/LastName", "class": "com.reltio.match.token.DoubleMetaphoneMatchToken" },
      { "attribute": "configuration/entityTypes/Individual/attributes/Email/attributes/Email", "class": "com.reltio.match.token.ExactMatchToken" },
      { "attribute": "configuration/entityTypes/Individual/attributes/Phone/attributes/Number", "class": "com.reltio.match.token.ExactNumberMatchToken" }
    ] },
    "comparatorClasses": { "mapping": [
      { "attribute": "configuration/entityTypes/Individual/attributes/FirstName", "class": "com.reltio.match.comparator.DoubleMetaphoneComparator" },
      { "attribute": "configuration/entityTypes/Individual/attributes/LastName", "class": "com.reltio.match.comparator.DoubleMetaphoneComparator" },
      { "attribute": "configuration/entityTypes/Individual/attributes/Email/attributes/Email", "class": "com.reltio.match.comparator.BasicStringComparator" },
      { "attribute": "configuration/entityTypes/Individual/attributes/Phone/attributes/Number", "class": "com.reltio.match.comparator.PhoneNumberComparator" }
    ] },
    "and": [
      { "fuzzy": [
        "configuration/entityTypes/Individual/attributes/FirstName",
        "configuration/entityTypes/Individual/attributes/LastName"
      ] },
      { "or": { "exact": [
        "configuration/entityTypes/Individual/attributes/Email/attributes/Email",
        "configuration/entityTypes/Individual/attributes/Phone/attributes/Number"
      ] } }
    ]
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Cross-source only, for listed sources

```json
{
  "uri": "configuration/entityTypes/Individual/matchGroups/CrossSourceNameEmail",
  "label": "Fuzzy(FirstName); Exact(Email); across SAP, Salesforce",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "matchTokenClasses": { "mapping": [
      { "attribute": "configuration/entityTypes/Individual/attributes/FirstName", "class": "com.reltio.match.token.DoubleMetaphoneMatchToken" },
      { "attribute": "configuration/entityTypes/Individual/attributes/Email/attributes/Email", "class": "com.reltio.match.token.ExactMatchToken" }
    ] },
    "comparatorClasses": { "mapping": [
      { "attribute": "configuration/entityTypes/Individual/attributes/FirstName", "class": "com.reltio.match.comparator.DoubleMetaphoneComparator" },
      { "attribute": "configuration/entityTypes/Individual/attributes/Email/attributes/Email", "class": "com.reltio.match.comparator.BasicStringComparator" }
    ] },
    "and": {
      "fuzzy": ["configuration/entityTypes/Individual/attributes/FirstName"],
      "exact": ["configuration/entityTypes/Individual/attributes/Email/attributes/Email"],
      "in": [{ "uri": "configuration/sources", "values": ["SAP", "Salesforce"] }],
      "not": { "exact": ["configuration/sources"] }
    }
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Exact names when email is missing on both

```json
{
  "uri": "configuration/entityTypes/Individual/matchGroups/ExactNamesNoEmail",
  "label": "Exact(FirstName, LastName); Email missing on both",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "matchTokenClasses": { "mapping": [
      { "attribute": "configuration/entityTypes/Individual/attributes/FirstName", "class": "com.reltio.match.token.ExactMatchToken" },
      { "attribute": "configuration/entityTypes/Individual/attributes/LastName", "class": "com.reltio.match.token.ExactMatchToken" }
    ] },
    "comparatorClasses": { "mapping": [
      { "attribute": "configuration/entityTypes/Individual/attributes/FirstName", "class": "com.reltio.match.comparator.BasicStringComparator" },
      { "attribute": "configuration/entityTypes/Individual/attributes/LastName", "class": "com.reltio.match.comparator.BasicStringComparator" }
    ] },
    "and": {
      "exact": [
        "configuration/entityTypes/Individual/attributes/FirstName",
        "configuration/entityTypes/Individual/attributes/LastName"
      ],
      "equals": [{ "uri": "configuration/entityTypes/Individual/attributes/Email/attributes/Email" }]
    }
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Organization name, address and first five ZIP digits

```json
{
  "uri": "configuration/entityTypes/Organization/matchGroups/NameAddressZip5",
  "label": "Fuzzy(Name); Exact(AddressLine1, ZIP first 5)",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "matchTokenClasses": { "mapping": [
      { "attribute": "configuration/entityTypes/Organization/attributes/Name", "class": "com.reltio.match.token.BasicTokenizedOrganizationNameMatchToken" },
      { "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/AddressLine1", "class": "com.reltio.match.token.AddressLineMatchToken" },
      { "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/PostalCode", "class": "com.reltio.match.token.CustomMatchToken",
        "parameters": [{ "parameter": "groups", "values": [{ "className": "com.reltio.match.token.ExactMatchToken", "pattern": "^([0-9]{5})" }] }] }
    ] },
    "comparatorClasses": { "mapping": [
      { "attribute": "configuration/entityTypes/Organization/attributes/Name", "class": "com.reltio.match.comparator.BasicTokenizedOrganizationNameComparator" },
      { "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/AddressLine1", "class": "com.reltio.match.comparator.AddressLineComparator" },
      { "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/PostalCode", "class": "com.reltio.match.comparator.CustomComparator",
        "parameters": [{ "parameter": "groups", "values": [{ "className": "com.reltio.match.comparator.BasicStringComparator", "pattern": "^([0-9]{5})" }] }] }
    ] },
    "and": {
      "fuzzy": ["configuration/entityTypes/Organization/attributes/Name"],
      "exact": [
        "configuration/entityTypes/Organization/attributes/Address/attributes/AddressLine1",
        "configuration/entityTypes/Organization/attributes/Address/attributes/PostalCode"
      ]
    }
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Nearby locations

```json
{
  "uri": "configuration/entityTypes/Location/matchGroups/NearbyBlock",
  "label": "Proximate(Geo, 0.02 mi); Exact(BlockCode)",
  "type": "suspect",
  "scope": "INTERNAL",
  "useOvOnly": true,
  "rule": {
    "ignoreInToken": ["configuration/entityTypes/Location/attributes/BlockCode"],
    "matchTokenClasses": { "mapping": [
      { "attribute": "configuration/entityTypes/Location/attributes/GeoLocation", "class": "com.reltio.match.token.ProximateGeoToken",
        "parameters": [{ "parameter": "distance_miles", "value": "0.02" }] }
    ] },
    "comparatorClasses": { "mapping": [
      { "attribute": "configuration/entityTypes/Location/attributes/GeoLocation", "class": "com.reltio.match.comparator.ProximateGeoComparator",
        "parameters": [{ "parameter": "distance_miles", "value": "0.02" }] },
      { "attribute": "configuration/entityTypes/Location/attributes/BlockCode", "class": "com.reltio.match.comparator.BasicStringComparator" }
    ] },
    "and": {
      "multi": [{
        "uri": "configuration/entityTypes/Location/attributes/GeoLocation",
        "attributes": [
          "configuration/entityTypes/Location/attributes/GeoLocation/attributes/Latitude",
          "configuration/entityTypes/Location/attributes/GeoLocation/attributes/Longitude"
        ]
      }],
      "exact": ["configuration/entityTypes/Location/attributes/BlockCode"]
    }
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Same asset, model year within 10 years

```json
{
  "uri": "configuration/entityTypes/Asset/matchGroups/AssetIdModelYear",
  "label": "Exact(AssetID); Fuzzy(ModelYear ±10)",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "ignoreInToken": ["configuration/entityTypes/Asset/attributes/ModelYear"],
    "matchTokenClasses": { "mapping": [
      { "attribute": "configuration/entityTypes/Asset/attributes/AssetID", "class": "com.reltio.match.token.ExactMatchToken" }
    ] },
    "comparatorClasses": { "mapping": [
      { "attribute": "configuration/entityTypes/Asset/attributes/AssetID", "class": "com.reltio.match.comparator.BasicStringComparator" },
      { "attribute": "configuration/entityTypes/Asset/attributes/ModelYear", "class": "com.reltio.match.comparator.RangeNumericComparator",
        "parameters": [{ "parameter": "threshold", "value": "10" }] }
    ] },
    "and": {
      "exact": ["configuration/entityTypes/Asset/attributes/AssetID"],
      "fuzzy": ["configuration/entityTypes/Asset/attributes/ModelYear"]
    }
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Relevance-based names

```json
{
  "uri": "configuration/entityTypes/Individual/matchGroups/WeightedNames",
  "label": "Relevance: Fuzzy(FirstName); Exact(LastName, MiddleName)",
  "type": "relevance_based",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "matchTokenClasses": { "mapping": [
      { "attribute": "configuration/entityTypes/Individual/attributes/FirstName", "class": "com.reltio.match.token.DoubleMetaphoneMatchToken" },
      { "attribute": "configuration/entityTypes/Individual/attributes/LastName", "class": "com.reltio.match.token.ExactMatchToken" },
      { "attribute": "configuration/entityTypes/Individual/attributes/MiddleName", "class": "com.reltio.match.token.ExactMatchToken" }
    ] },
    "comparatorClasses": { "mapping": [
      { "attribute": "configuration/entityTypes/Individual/attributes/FirstName", "class": "com.reltio.match.comparator.DoubleMetaphoneComparator" },
      { "attribute": "configuration/entityTypes/Individual/attributes/LastName", "class": "com.reltio.match.comparator.BasicStringComparator" },
      { "attribute": "configuration/entityTypes/Individual/attributes/MiddleName", "class": "com.reltio.match.comparator.BasicStringComparator" }
    ] },
    "and": {
      "fuzzy": ["configuration/entityTypes/Individual/attributes/FirstName"],
      "exact": [
        "configuration/entityTypes/Individual/attributes/LastName",
        "configuration/entityTypes/Individual/attributes/MiddleName"
      ]
    },
    "weights": [
      { "attribute": "configuration/entityTypes/Individual/attributes/FirstName", "weight": 0.5 },
      { "attribute": "configuration/entityTypes/Individual/attributes/LastName", "weight": 1.0 },
      { "attribute": "configuration/entityTypes/Individual/attributes/MiddleName", "weight": 0.3 }
    ],
    "actionThresholds": [
      { "type": "auto_merge", "threshold": "0.8-1.0" },
      { "type": "potential_match", "threshold": "0.5-0.8" }
    ]
  }
}
```

### Negative rule

```json
{
  "uri": "configuration/entityTypes/HCP/matchGroups/NegativeNPI",
  "label": "Not same NPI",
  "type": "automatic",
  "scope": "INTERNAL",
  "negativeRule": {
    "notExactSame": ["configuration/entityTypes/HCP/attributes/Identifiers/attributes/ID"],
    "equals": [{ "uri": "configuration/entityTypes/HCP/attributes/Identifiers/attributes/Type", "values": ["NPI"] }]
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

## 10. Test records for verification

Each side of a pair is an inline entity in Reltio's attribute format. Every value is a list of `{ "value": … }` objects, and a nested attribute's value is itself an object of attribute lists:

```json
{
  "type": "configuration/entityTypes/Individual",
  "attributes": {
    "FirstName": [{ "value": "Robert" }],
    "LastName": [{ "value": "Smith" }],
    "Email": [{ "value": { "Email": [{ "value": "rsmith@example.com" }] } }]
  },
  "crosswalks": [{ "type": "configuration/sources/Reltio", "value": "test-1" }]
}
```

- Attribute keys are the last URI segment at each level (`Email` → `Email`), not full URIs.
- `crosswalks[].type` must be a source defined in the configuration's `sources`. Give each record a distinct crosswalk `value`. For source filters, give the two records the sources the test needs.
- Use invented but realistic values. Never copy real customer data into a test record.
- Instead of an inline entity you can pass the URI of an existing entity (`"entities/<id>"`) when the user names one.
