# Match rule examples

Worked examples for `SKILL.md`, from Reltio's match-rule documentation. Use them as shapes: replace every attribute URI with one that exists in the user's configuration, and every placeholder URL with one the user supplies.

All complete groups validate against the schema. `useOvOnly` is written as a boolean.

## Operators

Rule fragments and complete groups showing each operator on its own.

### exact

True when the values match exactly, as judged by the comparator.

```json
{
  "exact": [
    "configuration/entityTypes/Individual/attributes/FirstName"
  ]
}
```

### fuzzy

True when the values are similar. Needs a fuzzy comparator mapping to behave fuzzily.

```json
{
  "fuzzy": [
    "configuration/entityTypes/Individual/attributes/LastName"
  ]
}
```

### exactOrNull

True when the values match, or either side is empty.

```json
{
  "exactOrNull": [
    "configuration/entityTypes/Individual/attributes/MiddleName"
  ]
}
```

### exactOrAllNull

True when the values match, or both sides are empty.

```json
{
  "exactOrAllNull": [
    "configuration/entityTypes/Individual/attributes/NamePrefix"
  ]
}
```

### multi: swapped first and last names

`CrossMultiComparator` on a `multi` group compares permutations, so "John Doe" matches "Doe John". The group `uri` is a name for the combination, not a real attribute.

```json
{
  "multi": [
    {
      "uri": "configuration/entityTypes/Individual/attributes/MultiGroup1",
      "attributes": [
        "configuration/entityTypes/Individual/attributes/FirstName",
        "configuration/entityTypes/Individual/attributes/LastName"
      ]
    }
  ],
  "comparatorClasses": {
    "mapping": [
      {
        "attribute": "configuration/entityTypes/Individual/attributes/MultiGroup1",
        "class": "com.reltio.match.comparator.CrossMultiComparator"
      },
      {
        "attribute": "configuration/entityTypes/Individual/attributes/FirstName",
        "class": "com.reltio.match.comparator.BasicStringComparator"
      },
      {
        "attribute": "configuration/entityTypes/Individual/attributes/LastName",
        "class": "com.reltio.match.comparator.BasicStringComparator"
      }
    ]
  }
}
```

### and

Exact first name and fuzzy last name. The last name has no fuzzy mapping here, so it is compared exactly; see "Person names" for the mapping.

```json
{
  "uri": "configuration/entityTypes/Individual/matchGroups/ExactFirstNameANDFuzzyLastName",
  "label": "ExactFirstName AND FuzzyLastName",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "and": {
      "exact": [
        "configuration/entityTypes/Individual/attributes/FirstName"
      ],
      "fuzzy": [
        "configuration/entityTypes/Individual/attributes/LastName"
      ]
    }
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### or

Exact first name or fuzzy last name.

```json
{
  "uri": "configuration/entityTypes/Individual/matchGroups/ExactFirstNameORFuzzyLastName",
  "label": "ExactFirstName OR FuzzyLastName",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "or": {
      "exact": [
        "configuration/entityTypes/Individual/attributes/FirstName"
      ],
      "fuzzy": [
        "configuration/entityTypes/Individual/attributes/LastName"
      ]
    }
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### not

Fuzzy last name, and first names that do not match exactly. The `not` and `fuzzy` sit side by side at the rule root.

```json
{
  "uri": "configuration/entityTypes/Individual/matchGroups/NotExactFirstNameFuzzyLastName",
  "label": "Not Exact First Name Fuzzy Last Name",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "not": {
      "exact": [
        "configuration/entityTypes/Individual/attributes/FirstName"
      ]
    },
    "fuzzy": [
      "configuration/entityTypes/Individual/attributes/LastName"
    ]
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### equals

Fuzzy last name, only for records whose Department is Sales.

```json
{
  "uri": "configuration/entityTypes/Individual/matchGroups/FuzzyLastNameforSales",
  "label": "Fuzzy(Last Name)",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Individual/attributes/LastName",
          "class": "com.reltio.match.token.DoubleMetaphoneMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Individual/attributes/LastName",
          "class": "com.reltio.match.comparator.DoubleMetaphoneComparator"
        }
      ]
    },
    "and": {
      "fuzzy": [
        "configuration/entityTypes/Individual/attributes/LastName"
      ],
      "equals": [
        {
          "values": [
            "Sales"
          ],
          "uri": "configuration/entityTypes/Individual/attributes/Department"
        }
      ]
    }
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### in

Exact first name, only for records whose Department is Sales or Marketing.

```json
{
  "uri": "configuration/entityTypes/Individual/matchGroups/ExactFirstNameforSalesAndMarketing",
  "label": "Exact(First Name)",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "and": {
      "exact": [
        "configuration/entityTypes/Individual/attributes/FirstName"
      ],
      "in": [
        {
          "values": [
            "Sales",
            "Marketing"
          ],
          "uri": "configuration/entityTypes/Individual/attributes/Department"
        }
      ]
    }
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### nullValues

Exact first name, and Department exact or empty, treating "NA" as empty.

```json
{
  "uri": "configuration/entityTypes/Individual/matchGroups/ExactFirstNameExactOrNullDepartment",
  "label": "Exact First Name ExactOrNull Department",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "and": {
      "exact": [
        "configuration/entityTypes/Individual/attributes/FirstName"
      ],
      "exactOrNull": [
        "configuration/entityTypes/Individual/attributes/Department"
      ]
    },
    "nullValues": [
      {
        "attribute": "configuration/entityTypes/Individual/attributes/Department",
        "value": "NA"
      }
    ]
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

## Match token and comparator classes

One complete group per kind of data.

### Exact values

`ExactMatchToken` + `BasicStringComparator`: plain comparison with no normalisation.

```json
{
  "uri": "configuration/entityTypes/Individual/matchGroups/ExactFirstname",
  "label": "Exact(First Name)",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Individual/attributes/FirstName",
          "class": "com.reltio.match.token.ExactMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Individual/attributes/FirstName",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        }
      ]
    },
    "exact": [
      "configuration/entityTypes/Individual/attributes/FirstName"
    ]
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Organization names

`BasicTokenizedOrganizationNameMatchToken` + `BasicTokenizedOrganizationNameComparator`: tolerates noise words and small differences.

```json
{
  "uri": "configuration/entityTypes/Organization/matchGroups/FuzzyOrgName",
  "label": "Fuzzy(Org Name)",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Name",
          "class": "com.reltio.match.token.BasicTokenizedOrganizationNameMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Name",
          "class": "com.reltio.match.comparator.BasicTokenizedOrganizationNameComparator"
        }
      ]
    },
    "fuzzy": [
      "configuration/entityTypes/Organization/attributes/Name"
    ]
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Person names

`DoubleMetaphoneMatchToken` + `DoubleMetaphoneComparator`: names that sound alike.

```json
{
  "uri": "configuration/entityTypes/Individual/matchGroups/FuzzyFirstname",
  "label": "Fuzzy(First Name)",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Individual/attributes/FirstName",
          "class": "com.reltio.match.token.DoubleMetaphoneMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Individual/attributes/FirstName",
          "class": "com.reltio.match.comparator.DoubleMetaphoneComparator"
        }
      ]
    },
    "fuzzy": [
      "configuration/entityTypes/Individual/attributes/FirstName"
    ]
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Street address

`AddressLineMatchToken` + `AddressLineComparator`: tolerates noise words such as St, Ave, Rd.

```json
{
  "uri": "configuration/entityTypes/Location/matchGroups/FuzzyStreetAddress",
  "label": "Fuzzy(Street Address)",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Location/attributes/AddressLine1",
          "class": "com.reltio.match.token.AddressLineMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Location/attributes/AddressLine1",
          "class": "com.reltio.match.comparator.AddressLineComparator"
        }
      ]
    },
    "fuzzy": [
      "configuration/entityTypes/Location/attributes/AddressLine1"
    ]
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Phone numbers

`PhoneNumberMatchToken` + `PhoneNumberComparator`.

```json
{
  "uri": "configuration/entityTypes/Individual/matchGroups/FuzzyPhoneNumber",
  "label": "Fuzzy(Phone Number)",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Individual/attributes/Phone/attributes/Number",
          "class": "com.reltio.match.token.PhoneNumberMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Individual/attributes/Phone/attributes/Number",
          "class": "com.reltio.match.comparator.PhoneNumberComparator"
        }
      ]
    },
    "fuzzy": [
      "configuration/entityTypes/Individual/attributes/Phone/attributes/Number"
    ]
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Product or material names

`FuzzyTextAndNumberMatchToken` + `DynamicDamerauLevenshteinDistance`: tolerates spelling mistakes.

```json
{
  "uri": "configuration/entityTypes/Product/matchGroups/FuzzyProductName",
  "label": "Fuzzy(ProductName)",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Product/attributes/ProductName",
          "class": "com.reltio.match.token.FuzzyTextAndNumberMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Product/attributes/ProductName",
          "class": "com.reltio.match.comparator.DynamicDamerauLevenshteinDistance"
        }
      ]
    },
    "fuzzy": [
      "configuration/entityTypes/Product/attributes/ProductName"
    ]
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Numbers within a range

`RangeNumericMatchToken` + `RangeNumericComparator`. `threshold` is absolute (`5`) or a percentage of the smaller value (`10%`): with 5, 12 and 16 match; with 10%, they do not.

```json
{
  "uri": "configuration/entityTypes/Location/matchGroups/FuzzyHouseNumber",
  "label": "Fuzzy(House Number)",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Location/attributes/HouseNumber",
          "parameters": [
            {
              "parameter": "threshold",
              "value": "2"
            }
          ],
          "class": "com.reltio.match.token.RangeNumericMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Location/attributes/HouseNumber",
          "parameters": [
            {
              "parameter": "threshold",
              "value": "5"
            }
          ],
          "class": "com.reltio.match.comparator.RangeNumericComparator"
        }
      ]
    },
    "fuzzy": [
      "configuration/entityTypes/Location/attributes/HouseNumber"
    ]
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Single-word strings

`FuzzyTextAndNumberMatchToken` + `DynamicDamerauLevenshteinDistance`.

```json
{
  "uri": "configuration/entityTypes/Organization/matchGroups/FuzzySector",
  "label": "Fuzzy(Sector)",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Sector",
          "class": "com.reltio.match.token.FuzzyTextAndNumberMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Sector",
          "class": "com.reltio.match.comparator.DynamicDamerauLevenshteinDistance"
        }
      ]
    },
    "fuzzy": [
      "configuration/entityTypes/Organization/attributes/Sector"
    ]
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

## Cleansers

Cleansers normalise values during matching only; stored data is never changed. Dictionary and noise-word URLs below are placeholders: use the URL the user supplies.

### Name synonyms

`NameDictionaryCleanser` with the 2020 dictionary, so Bob matches Robert.

```json
{
  "uri": "configuration/entityTypes/Individual/matchGroups/NameDictionaryCleanser",
  "label": "Name Dictionary Cleanser On First Name",
  "type": "automatic",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "cleanse": [
      {
        "cleanseAdapter": "com.reltio.cleanse.impl.NameDictionaryCleanser",
        "cleanseAdapterParams": {
          "dictionary": "SynonymFirstNamesNA_2020-09-01",
          "keepOriginalValue": false
        },
        "mappings": [
          {
            "attribute": "configuration/entityTypes/Individual/attributes/FirstName",
            "cleanseAttribute": "configuration/entityTypes/Individual/attributes/FirstName"
          }
        ]
      }
    ],
    "exact": [
      "configuration/entityTypes/Individual/attributes/FirstName"
    ]
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Custom synonym list from RDM

A team's own synonyms, held as an RDM lookup type. Ask the user for the RDM values.

```json
{
  "cleanse": [
    {
      "cleanseAdapter": "com.reltio.cleanse.impl.NameDictionaryCleanser",
      "cleanseAdapterParams": {
        "rdmServiceUri": "https://rdm.reltio.com",
        "oauthInstance": "https://auth.reltio.com/oauth/token",
        "rdmTenantId": "rdm1234567890",
        "dictionary": "rdm/lookupTypes/CUSTOM_NAME_SYNONYMS"
      },
      "mappings": [
        {
          "attribute": "configuration/entityTypes/Individual/attributes/FirstName",
          "cleanseAttribute": "configuration/entityTypes/Individual/attributes/FirstName"
        }
      ]
    }
  ]
}
```

### String replacement

`RegexpReplaceCleanser` with a hosted `source=>replacement` file.

```json
{
  "cleanse": [
    {
      "cleanseAdapter": "com.reltio.cleanse.impl.RegexpReplaceCleanser",
      "cleanseAdapterParams": {
        "dictionary": "https://dictionaries.example.com/match/string-replacements.txt",
        "keepOriginalValue": false
      },
      "mappings": [
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Name",
          "cleanseAttribute": "configuration/entityTypes/HCO/attributes/Name"
        }
      ]
    }
  ]
}
```

### String replacement with an extra regular expression

`dictionaryItems` adds a replacement the file cannot express: here, collapsing repeated spaces to one.

```json
{
  "cleanse": [
    {
      "cleanseAdapter": "com.reltio.cleanse.impl.RegexpReplaceCleanser",
      "cleanseAdapterParams": {
        "dictionary": "https://dictionaries.example.com/match/organization-replacements.txt",
        "keepOriginalValue": "false",
        "dictionaryItems": [
          {
            "regex": "\\s{2,}",
            "replacement": " "
          }
        ]
      },
      "mappings": [
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Name",
          "mandatory": false,
          "allValues": false,
          "cleanseAttribute": "configuration/entityTypes/Organization/attributes/Name"
        }
      ]
    }
  ]
}
```

### Custom noise words

`AddressLineMatchToken` / `AddressLineComparator` wrapped in `CustomMatchToken` / `CustomComparator` so a custom `noiseDictionary` applies.

```json
{
  "uri": "configuration/entityTypes/Organization/matchGroups/Rule6",
  "label": "Rule6: Exact Organization Name Fuzzy Address (Ignore Numbers)",
  "type": "suspect",
  "useOvOnly": true,
  "rule": {
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/AddressLine1",
          "parameters": [
            {
              "parameter": "groups",
              "values": [
                {
                  "className": "com.reltio.match.token.AddressLineMatchToken",
                  "noiseDictionary": "https://dictionaries.example.com/match/address-line-noise-words.txt"
                }
              ]
            }
          ],
          "class": "com.reltio.match.token.CustomMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/AddressLine1",
          "parameters": [
            {
              "parameter": "groups",
              "values": [
                {
                  "className": "com.reltio.match.comparator.AddressLineComparator",
                  "noiseDictionary": "https://dictionaries.example.com/match/address-line-noise-words.txt"
                }
              ]
            }
          ],
          "class": "com.reltio.match.comparator.CustomComparator"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/AddressLine2",
          "parameters": [
            {
              "parameter": "groups",
              "values": [
                {
                  "className": "com.reltio.match.comparator.AddressLineComparator",
                  "noiseDictionary": "https://dictionaries.example.com/match/address-line-noise-words.txt"
                }
              ]
            }
          ],
          "class": "com.reltio.match.comparator.CustomComparator"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/City",
          "class": "com.reltio.match.comparator.DoubleMetaphoneComparator"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/StateProvince",
          "class": "com.reltio.match.comparator.DoubleMetaphoneComparator"
        }
      ]
    },
    "and": {
      "exact": [
        "configuration/entityTypes/Organization/attributes/OrganizationName"
      ],
      "exactOrNull": [
        "configuration/entityTypes/Organization/attributes/Address/attributes/Country",
        "configuration/entityTypes/Organization/attributes/Address/attributes/Zip/attributes/Zip5",
        "configuration/entityTypes/Organization/attributes/Address/attributes/AddressLine2"
      ],
      "fuzzy": [
        "configuration/entityTypes/Organization/attributes/Address/attributes/AddressLine1",
        "configuration/entityTypes/Organization/attributes/Address/attributes/City",
        "configuration/entityTypes/Organization/attributes/Address/attributes/StateProvince"
      ]
    }
  },
  "scoreStandalone": 85,
  "scoreIncremental": 0
}
```

## Relevance-based rules

### Weights

Unlisted simple attributes weigh 1.

```json
{
  "weights": [
    {
      "attribute": "configuration/entityTypes/HCP/attributes/Suffix",
      "weight": 0.2
    },
    {
      "attribute": "configuration/entityTypes/HCP/attributes/FirstName",
      "weight": 1
    }
  ]
}
```

### Action thresholds

0.8–1.0 merges, 0.4–0.8 creates a potential match, below 0.4 nothing. A score on a boundary or in an overlap creates a potential match.

```json
{
  "actionThresholds": [
    {
      "type": "auto_merge",
      "threshold": "0.8-1.0"
    },
    {
      "type": "potential_match",
      "threshold": "0.4-0.8"
    }
  ]
}
```

### Weighted names

Fuzzy FirstName (0.5), exact LastName (1.0) and MiddleName (0.3). "John A Doe" vs "John A Doe" scores 1 and merges; "Jon Doe" vs "Jonathan A Doe" scores 1.0 ÷ 1.8 = 0.56, a potential match.

```json
{
  "uri": "configuration/entityTypes/Individual/matchGroups/ByWeightedNames",
  "label": "By Weighted Names",
  "type": "relevance_based",
  "rule": {
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Individual/attributes/FirstName",
          "class": "com.reltio.match.token.DoubleMetaphoneMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/Individual/attributes/LastName",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/Individual/attributes/MiddleName",
          "class": "com.reltio.match.token.ExactMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Individual/attributes/FirstName",
          "class": "com.reltio.match.comparator.DoubleMetaphoneComparator"
        },
        {
          "attribute": "configuration/entityTypes/Individual/attributes/LastName",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/Individual/attributes/MiddleName",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        }
      ]
    },
    "and": {
      "fuzzy": [
        "configuration/entityTypes/Individual/attributes/FirstName"
      ],
      "exact": [
        "configuration/entityTypes/Individual/attributes/LastName",
        "configuration/entityTypes/Individual/attributes/MiddleName"
      ]
    },
    "weights": [
      {
        "attribute": "configuration/entityTypes/Individual/attributes/FirstName",
        "weight": 0.5
      },
      {
        "attribute": "configuration/entityTypes/Individual/attributes/LastName",
        "weight": 1
      },
      {
        "attribute": "configuration/entityTypes/Individual/attributes/MiddleName",
        "weight": 0.3
      }
    ],
    "actionThresholds": [
      {
        "type": "auto_merge",
        "threshold": "0.8-1.0"
      },
      {
        "type": "potential_match",
        "threshold": "0.5-0.8"
      }
    ]
  }
}
```

## Scenarios

Complete rules for common requirements.

### HCO name and address, exact

Merge records automatically on HCO entity type where there is an exact match on Name, Address Line 1, City, Zip5 and Address Line 2. The Condition on Address Line 2 should be Exact or All null i.e. If the Address line 2 is exactly the same in the matched records, or its null is all the matched records, the condition will be evaluated to true.

```json
{
  "uri": "configuration/entityTypes/HCO/matchGroups/R1",
  "label": "Exact (Name, Addr1, City, Zip5)  EOAN (Addr2)",
  "type": "automatic",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Address/attributes/City",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Name",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Address/attributes/AddressLine1",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Address/attributes/PostalCode/attributes/Zip5",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Address/attributes/AddressLine2",
          "class": "com.reltio.match.token.ExactMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Address/attributes/City",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Name",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Address/attributes/AddressLine1",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Address/attributes/PostalCode/attributes/Zip5",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Address/attributes/AddressLine2",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        }
      ]
    },
    "and": {
      "exact": [
        "configuration/entityTypes/HCO/attributes/Address/attributes/City",
        "configuration/entityTypes/HCO/attributes/Name",
        "configuration/entityTypes/HCO/attributes/Address/attributes/AddressLine1",
        "configuration/entityTypes/HCO/attributes/Address/attributes/PostalCode/attributes/Zip5"
      ],
      "exactOrAllNull": [
        "configuration/entityTypes/HCO/attributes/Address/attributes/AddressLine2"
      ]
    }
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Exact NPI and fuzzy HCO name

Create suspect matches on HCO entity when there is a fuzzy match on the Name (HCO Name), And exact match on Identifier Value where Identifier Type is NPI

```json
{
  "uri": "configuration/entityTypes/HCO/matchGroups/R2",
  "label": "Exact (NPI) Fuzzy (Name)",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Identifiers/attributes/ID",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Identifiers/attributes/Type",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Name",
          "class": "com.reltio.match.token.OrganizationNameMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Identifiers/attributes/ID",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Identifiers/attributes/Type",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Name",
          "class": "com.reltio.match.comparator.OrganizationNamesComparator"
        }
      ]
    },
    "and": {
      "exact": [
        "configuration/entityTypes/HCO/attributes/Identifiers/attributes/ID"
      ],
      "equals": [
        {
          "value": "NPI",
          "values": [
            "NPI"
          ],
          "uri": "configuration/entityTypes/HCO/attributes/Identifiers/attributes/Type"
        }
      ],
      "fuzzy": [
        "configuration/entityTypes/HCO/attributes/Name"
      ]
    }
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Exact identifier type and value, exact address line, fuzzy name

Create suspect matches on the HCO entity when there is a fuzzy match on Name and exact match on Address Line 1, Identifier/Type and Identifier/ID

```json
{
  "uri": "configuration/entityTypes/HCO/matchGroups/R3",
  "label": "Fuzzy (Name) Exact (Identifier/Type, Identifier/ID, Addr1)",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "ignoreInToken": [
      "configuration/entityTypes/HCO/attributes/Name"
    ],
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Address/attributes/AddressLine1",
          "class": "com.reltio.match.token.AddressLineMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Identifiers/attributes/Type",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Identifiers/attributes/ID",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Name",
          "class": "com.reltio.match.token.OrganizationNameMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Address/attributes/AddressLine1",
          "class": "com.reltio.match.comparator.AddressLineComparator"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Identifiers/attributes/Type",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Identifiers/attributes/ID",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Name",
          "class": "com.reltio.match.comparator.OrganizationNamesComparator"
        }
      ]
    },
    "and": {
      "exact": [
        "configuration/entityTypes/HCO/attributes/Address/attributes/AddressLine1",
        "configuration/entityTypes/HCO/attributes/Identifiers/attributes/Type",
        "configuration/entityTypes/HCO/attributes/Identifiers/attributes/ID"
      ],
      "fuzzy": [
        "configuration/entityTypes/HCO/attributes/Name"
      ]
    }
  },
  "scoreStandalone": 60,
  "scoreIncremental": 1
}
```

### Exact address and fuzzy name

Create suspect matches on the HCO entity when there is a fuzzy match on Name and exact match on Address attributes i.e. Address Line 1 , City, State, Zip 5 and Country.

```json
{
  "uri": "configuration/entityTypes/HCO/matchGroups/R4",
  "label": "Fuzzy (Name) Exact(Addr1, CIty, State, Zip5, Country)",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Name",
          "class": "com.reltio.match.token.OrganizationNameMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Address/attributes/AddressLine1",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Address/attributes/City",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Address/attributes/PostalCode/attributes/Zip5",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Address/attributes/StateProvince",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Address/attributes/Country",
          "class": "com.reltio.match.token.ExactMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Name",
          "class": "com.reltio.match.comparator.OrganizationNamesComparator"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Address/attributes/AddressLine1",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Address/attributes/City",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Address/attributes/PostalCode/attributes/Zip5",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Address/attributes/StateProvince",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/HCO/attributes/Address/attributes/Country",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        }
      ]
    },
    "and": {
      "exact": [
        "configuration/entityTypes/HCO/attributes/Address/attributes/AddressLine1",
        "configuration/entityTypes/HCO/attributes/Address/attributes/City",
        "configuration/entityTypes/HCO/attributes/Address/attributes/PostalCode/attributes/Zip5",
        "configuration/entityTypes/HCO/attributes/Address/attributes/StateProvince",
        "configuration/entityTypes/HCO/attributes/Address/attributes/Country"
      ],
      "fuzzy": [
        "configuration/entityTypes/HCO/attributes/Name"
      ]
    }
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Fuzzy name, exact address line, and city or ZIP5

Create suspect matches on Organization entity type when the Organization Name matches fuzzily, Address Line 1 matches exactly, and either City or Zip5 matches exactly.

```json
{
  "uri": "configuration/entityTypes/Organization/matchGroups/R6",
  "label": "Fuzzy(Name); Exact(Address1, City or Zip5)",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": false,
  "rule": {
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/AddressLine1",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Name",
          "class": "com.reltio.match.token.OrganizationNameMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/PostalCode/attributes/Zip5",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/City",
          "class": "com.reltio.match.token.ExactMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/AddressLine1",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Name",
          "class": "com.reltio.match.comparator.OrganizationNamesComparator"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/PostalCode/attributes/Zip5",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/City",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        }
      ]
    },
    "and": [
      {
        "and": {
          "exact": [
            "configuration/entityTypes/Organization/attributes/Address/attributes/AddressLine1"
          ],
          "fuzzy": [
            "configuration/entityTypes/Organization/attributes/Name"
          ]
        }
      },
      {
        "or": {
          "exact": [
            "configuration/entityTypes/Organization/attributes/Address/attributes/PostalCode/attributes/Zip5",
            "configuration/entityTypes/Organization/attributes/Address/attributes/City"
          ]
        }
      }
    ]
  },
  "scoreStandalone": 60,
  "scoreIncremental": 5
}
```

### Phonetic name, exact address line, and city or postal code

Create suspect matches on Organization entity type when Name matches fuzzily using a phonetic algorithm, Address Line 1 matches exactly, and either City or PostalCode matches exactly.

```json
{
  "uri": "configuration/entityTypes/Organization/matchGroups/Rule7",
  "label": "Fuzzy(Name Metaphone); Exact(Address1, City or PostalCode)",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": false,
  "rule": {
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/AddressLine1",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Name",
          "class": "com.reltio.match.token.DoubleMetaphoneMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/PostalCode/attributes/PostalCode",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/City",
          "class": "com.reltio.match.token.ExactMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/AddressLine1",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Name",
          "class": "com.reltio.match.comparator.DoubleMetaphoneComparator"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/PostalCode/attributes/PostalCode",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/City",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        }
      ]
    },
    "and": [
      {
        "and": {
          "exact": [
            "configuration/entityTypes/Organization/attributes/Address/attributes/AddressLine1"
          ],
          "fuzzy": [
            "configuration/entityTypes/Organization/attributes/Name"
          ]
        }
      },
      {
        "or": {
          "exact": [
            "configuration/entityTypes/Organization/attributes/Address/attributes/PostalCode/attributes/PostalCode",
            "configuration/entityTypes/Organization/attributes/Address/attributes/City"
          ]
        }
      }
    ]
  },
  "scoreStandalone": 60,
  "scoreIncremental": 5
}
```

### Fuzzy first and last name, and exact email or phone

Create suspect matches for HCP records where there is a fuzzy match on First Name and Last Name and exact match on either email address or Phone number. First Name is being cleansed using a name dictionary as well, which will identify the common synonyms like “Robert”/”Bob” etc.

```json
{
  "uri": "configuration/entityTypes/HCP/matchGroups/R3",
  "label": "Fuzzy (FirstName, LastName) Exact (Email or Phone)",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "ignoreInToken": [
      "configuration/entityTypes/HCP/attributes/FirstName",
      "configuration/entityTypes/HCP/attributes/LastName"
    ],
    "cleanse": [
      {
        "cleanseAdapter": "com.reltio.cleanse.impl.NameDictionaryCleanser",
        "cleanseAdapterParams": {
          "dictionary": "SynonymFirstNamesNA_2020-09-01",
          "keepOriginalValue": false
        },
        "mappings": [
          {
            "attribute": "configuration/entityTypes/HCP/attributes/FirstName",
            "mandatory": false,
            "allValues": false,
            "cleanseAttribute": "configuration/entityTypes/HCP/attributes/FirstName"
          }
        ]
      }
    ],
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/HCP/attributes/LastName",
          "class": "com.reltio.match.token.DoubleMetaphoneMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/HCP/attributes/FirstName",
          "class": "com.reltio.match.token.DoubleMetaphoneMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/HCP/attributes/Email/attributes/Email",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/HCP/attributes/Phone/attributes/FormattedNumber",
          "class": "com.reltio.match.token.ExactMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/HCP/attributes/LastName",
          "class": "com.reltio.match.comparator.DoubleMetaphoneComparator"
        },
        {
          "attribute": "configuration/entityTypes/HCP/attributes/FirstName",
          "class": "com.reltio.match.comparator.DoubleMetaphoneComparator"
        },
        {
          "attribute": "configuration/entityTypes/HCP/attributes/Email/attributes/Email",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/HCP/attributes/Phone/attributes/FormattedNumber",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        }
      ]
    },
    "and": [
      {
        "and": {
          "fuzzy": [
            "configuration/entityTypes/HCP/attributes/LastName",
            "configuration/entityTypes/HCP/attributes/FirstName"
          ]
        }
      },
      {
        "or": {
          "exact": [
            "configuration/entityTypes/HCP/attributes/Email/attributes/Email",
            "configuration/entityTypes/HCP/attributes/Phone/attributes/FormattedNumber"
          ]
        }
      }
    ]
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Fuzzy name, exact tax ID and date of birth

Create suspect matches on the Individual entity when there is a fuzzy match on the Name and an exact match on Tax ID and Date of Birth (DOB). This rule uses custom cleansing and advanced fuzzy comparison logic to detect possible matches with variations in name representation.

```json
{
  "uri": "configuration/entityTypes/Individual/matchGroups/Rule11",
  "label": "Fuzzy Name and Exact(Tax ID, DOB)",
  "type": "suspect",
  "scope": "INTERNAL",
  "useOvOnly": true,
  "rule": {
    "cleanse": [
      {
        "cleanseAdapter": "com.reltio.cleanse.impl.RegexpReplaceCleanser",
        "cleanseAdapterParams": {
          "dictionary": "https://dictionaries.example.com/match/name-replacements.txt",
          "keepOriginalValue": false
        },
        "mappings": [
          {
            "attribute": "configuration/entityTypes/Individual/attributes/Name",
            "mandatory": false,
            "allValues": false,
            "cleanseAttribute": "configuration/entityTypes/Individual/attributes/Name"
          }
        ]
      }
    ],
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Individual/attributes/Name",
          "class": "com.reltio.match.token.FuzzyTextMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Individual/attributes/Name",
          "parameters": [
            {
              "parameter": "groups",
              "values": [
                {
                  "useNoiseIfEmpty": true,
                  "classParams": {
                    "threshold": "85%",
                    "thresholdChars": "80%",
                    "useStemmer": true,
                    "useSoundex": true
                  },
                  "className": "com.reltio.match.comparator.DistinctWordsComparator"
                }
              ]
            }
          ],
          "class": "com.reltio.match.comparator.CustomComparator"
        }
      ]
    },
    "and": {
      "exact": [
        "configuration/entityTypes/Individual/attributes/TaxId/attributes/Id",
        "configuration/entityTypes/Individual/attributes/DOB"
      ],
      "fuzzy": [
        "configuration/entityTypes/Individual/attributes/Name"
      ]
    }
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Nearby locations

Create suspect matches on the Property entity type for internal matching when:

- Geographical coordinates are within 0.02 miles (proximate)
- `GeoAccuracy` equals P4
- `BlockCode` matches exactly

This rule is used to identify potential duplicates based on geographic and structural proximity of addresses.

```json
{
  "uri": "configuration/entityTypes/Property/matchGroups/Rule13",
  "label": "Proximate(Geo, 0.02), Equals(GeoAccuracy,P4), Exact(BlockCode)",
  "type": "suspect",
  "scope": "INTERNAL",
  "useOvOnly": true,
  "rule": {
    "ignoreInToken": [
      "configuration/entityTypes/Property/attributes/Address/attributes/BlockCode",
      "configuration/entityTypes/Property/attributes/Address/attributes/GeoLocation/attributes/GeoAccuracy"
    ],
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Property/attributes/Address/attributes/GeoLocation01",
          "parameters": [
            {
              "parameter": "distance_miles",
              "value": "0.02"
            }
          ],
          "class": "com.reltio.match.token.ProximateGeoToken"
        },
        {
          "attribute": "configuration/entityTypes/Property/attributes/Address/attributes/GeoLocation/attributes/GeoAccuracy",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/Property/attributes/Address/attributes/BlockCode",
          "class": "com.reltio.match.token.ExactMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Property/attributes/Address/attributes/GeoLocation01",
          "parameters": [
            {
              "parameter": "distance_miles",
              "value": "0.02"
            }
          ],
          "class": "com.reltio.match.comparator.ProximateGeoComparator"
        },
        {
          "attribute": "configuration/entityTypes/Property/attributes/Address/attributes/GeoLocation/attributes/GeoAccuracy",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/Property/attributes/Address/attributes/BlockCode",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        }
      ]
    },
    "and": {
      "exact": [
        "configuration/entityTypes/Property/attributes/Address/attributes/BlockCode"
      ],
      "equals": [
        {
          "value": "P4",
          "uri": "configuration/entityTypes/Property/attributes/Address/attributes/GeoLocation/attributes/GeoAccuracy"
        }
      ]
    },
    "multi": [
      {
        "uri": "configuration/entityTypes/Property/attributes/Address/attributes/GeoLocation01",
        "attributes": [
          "configuration/entityTypes/Property/attributes/Address/attributes/GeoLocation/attributes/Latitude",
          "configuration/entityTypes/Property/attributes/Address/attributes/GeoLocation/attributes/Longitude"
        ]
      }
    ]
  },
  "scoreStandalone": 50,
  "scoreIncremental": 0
}
```

### Negative rule: different NPIs

Downgrade automatic merges to suspect match when two HCP (Healthcare Professional) records if they both have an Identifier Type = NPI but the Identifier ID values are different. This rule acts as a negative match filter, disqualifying records from auto-merged based on conflicting NPI values.

```json
{
  "uri": "configuration/entityTypes/HCP/matchGroups/NegativeHCPByNPI",
  "label": "HCP not match (not same NPI)",
  "type": "automatic",
  "scope": "INTERNAL",
  "negativeRule": {
    "notExactSame": [
      "configuration/entityTypes/HCP/attributes/Identifiers/attributes/ID"
    ],
    "equals": [
      {
        "value": "NPI",
        "uri": "configuration/entityTypes/HCP/attributes/Identifiers/attributes/Type"
      }
    ]
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Fuzzy first name and email, across listed sources only

Merge records automatically on the Individual entity when there is a fuzzy match on the Name and exact match on Email. The match rule should be considered for a specific list of source systems and the match should be triggered only if it’s comparing the data between different sources.
For example:

- If the Match pairs are coming from Source1 and Source2, the rule should be evaluated to true.
- If both the records are coming from the same source, the match rule should be evaluated to false.

```json
{
  "uri": "configuration/entityTypes/Individual/matchGroups/Rule4",
  "label": "Rule4: Fuzzy (First Name); Exact(Email); Source1, Source2, Source3 Links",
  "type": "automatic",
  "scope": "ALL",
  "useOvOnly": false,
  "rule": {
    "cleanse": [
      {
        "cleanseAdapter": "com.reltio.cleanse.impl.NameDictionaryCleanser",
        "mappings": [
          {
            "attribute": "configuration/entityTypes/Individual/attributes/Primary_Given_Name/attributes/Primary_Given_Name",
            "mandatory": false,
            "allValues": false,
            "cleanseAttribute": "configuration/entityTypes/Individual/attributes/Primary_Given_Name/attributes/Primary_Given_Name"
          }
        ]
      }
    ],
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Individual/attributes/Primary_Given_Name/attributes/Primary_Given_Name",
          "class": "com.reltio.match.token.DoubleMetaphoneMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Individual/attributes/Primary_Given_Name/attributes/Primary_Given_Name",
          "class": "com.reltio.match.comparator.DoubleMetaphoneComparator"
        }
      ]
    },
    "and": {
      "exact": [
        "configuration/entityTypes/Individual/attributes/Email/attributes/Email_Address"
      ],
      "fuzzy": [
        "configuration/entityTypes/Individual/attributes/Primary_Given_Name/attributes/Primary_Given_Name"
      ],
      "in": [
        {
          "values": [
            "Source1",
            "Source2",
            "Source3"
          ],
          "uri": "configuration/sources"
        }
      ],
      "not": {
        "exact": [
          "configuration/sources"
        ]
      }
    }
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Exact last name and last 3 letters of first name

Create suspect matches on HCP entity type when there is an exact match on last name, and exact match on the last 3 characters of the first name

```json
{
  "uri": "configuration/entityTypes/HCP/matchGroups/ExactFName3CharsExactLName",
  "label": "Exact(FirstName last 3 letters, LastName)",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/HCP/attributes/FirstName",
          "parameters": [
            {
              "parameter": "groups",
              "values": [
                {
                  "className": "com.reltio.match.token.ExactMatchToken",
                  "pattern": "[A-Za-z]{3}$"
                }
              ]
            }
          ],
          "class": "com.reltio.match.token.CustomMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/HCP/attributes/LastName",
          "class": "com.reltio.match.token.ExactMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/HCP/attributes/FirstName",
          "parameters": [
            {
              "parameter": "groups",
              "values": [
                {
                  "className": "com.reltio.match.comparator.BasicStringComparator",
                  "pattern": "[A-Za-z]{3}$"
                }
              ]
            }
          ],
          "class": "com.reltio.match.comparator.CustomComparator"
        },
        {
          "attribute": "configuration/entityTypes/HCP/attributes/LastName",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        }
      ]
    },
    "exact": [
      "configuration/entityTypes/HCP/attributes/FirstName",
      "configuration/entityTypes/HCP/attributes/LastName"
    ]
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Exact product ID and last 6 digits of asset ID

Create suspect matches on Asset entity type when there is an exact match on product ID, and exact match on the last 6 digits of the asset ID

```json
{
  "uri": "configuration/entityTypes/Asset/matchGroups/ExactOnAssetIdLastSixCharsExactProductId",
  "label": "Exact (Asset ID Last 6 characters),  Exact (Product Id)",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Asset/attributes/ModelInternalIdentifier/attributes/ProductID",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/Asset/attributes/AssetID",
          "parameters": [
            {
              "parameter": "groups",
              "values": [
                {
                  "pattern": "\\d{6}$",
                  "className": "com.reltio.match.token.ExactMatchToken"
                }
              ]
            }
          ],
          "class": "com.reltio.match.token.CustomMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Asset/attributes/ModelInternalIdentifier/attributes/ProductID",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/Asset/attributes/AssetID",
          "parameters": [
            {
              "parameter": "groups",
              "values": [
                {
                  "pattern": "\\d{6}$",
                  "className": "com.reltio.match.comparator.BasicStringComparator"
                }
              ]
            }
          ],
          "class": "com.reltio.match.comparator.CustomComparator"
        }
      ]
    },
    "and": {
      "exact": [
        "configuration/entityTypes/Asset/attributes/AssetID",
        "configuration/entityTypes/Asset/attributes/ModelInternalIdentifier/attributes/ProductID"
      ]
    }
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Exact names when email is missing on both

Create suspect matches on Individual entity type when there is an exact match on first name and last name, and email doesn’t exist on both records

```json
{
  "uri": "configuration/entityTypes/Individual/matchGroups/FirstNameLastNameMissingEmail",
  "label": "FirstName LastName Missing Email",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Individual/attributes/FirstName",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/Individual/attributes/LastName",
          "class": "com.reltio.match.token.ExactMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Individual/attributes/FirstName",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/Individual/attributes/LastName",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        }
      ]
    },
    "and": {
      "exact": [
        "configuration/entityTypes/Individual/attributes/FirstName",
        "configuration/entityTypes/Individual/attributes/LastName"
      ],
      "equals": [
        {
          "uri": "configuration/entityTypes/Individual/attributes/Email/attributes/Email"
        }
      ]
    }
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Fuzzy names when 80% of characters match

Create suspect matches on Individual entity type when there is an fuzzy match on first name and last name when 80% of their characters are same

```json
{
  "uri": "configuration/entityTypes/Individual/matchGroups/80PercentFuzzyFNameLName",
  "label": "80 Percent Fuzzy FName LName",
  "type": "suspect",
  "scope": "INTERNAL",
  "useOvOnly": true,
  "rule": {
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Individual/attributes/FirstName",
          "parameters": [
            {
              "parameter": "groups",
              "values": [
                {
                  "useNoiseIfEmpty": "true",
                  "classParams": {
                    "threshold": "80%"
                  },
                  "className": "com.reltio.match.token.DistinctWordsMatchToken"
                }
              ]
            }
          ],
          "class": "com.reltio.match.token.CustomMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/Individual/attributes/LastName",
          "parameters": [
            {
              "parameter": "groups",
              "values": [
                {
                  "useNoiseIfEmpty": "true",
                  "classParams": {
                    "threshold": "80%"
                  },
                  "className": "com.reltio.match.token.DistinctWordsMatchToken"
                }
              ]
            }
          ],
          "class": "com.reltio.match.token.CustomMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Individual/attributes/FirstName",
          "parameters": [
            {
              "parameter": "groups",
              "values": [
                {
                  "useNoiseIfEmpty": "true",
                  "classParams": {
                    "thresholdChars": "80%"
                  },
                  "className": "com.reltio.match.comparator.DistinctWordsComparator"
                }
              ]
            }
          ],
          "class": "com.reltio.match.comparator.CustomComparator"
        },
        {
          "attribute": "configuration/entityTypes/Individual/attributes/LastName",
          "parameters": [
            {
              "parameter": "groups",
              "values": [
                {
                  "useNoiseIfEmpty": "true",
                  "classParams": {
                    "thresholdChars": "80%"
                  },
                  "className": "com.reltio.match.comparator.DistinctWordsComparator"
                }
              ]
            }
          ],
          "class": "com.reltio.match.comparator.CustomComparator"
        }
      ]
    },
    "and": {
      "fuzzy": [
        "configuration/entityTypes/Individual/attributes/FirstName",
        "configuration/entityTypes/Individual/attributes/LastName"
      ]
    }
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Fuzzy organization name when 60% of words match

Create suspect matches on Organization entity type when there is a fuzzy match on Name and 60% of the words in Organization Name matches

```json
{
  "uri": "configuration/entityTypes/Organization/matchGroups/60PercentFuzzyName",
  "label": "60 Percent Fuzzy Name",
  "type": "suspect",
  "scope": "INTERNAL",
  "useOvOnly": true,
  "rule": {
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Name",
          "parameters": [
            {
              "parameter": "groups",
              "values": [
                {
                  "useNoiseIfEmpty": "true",
                  "classParams": {
                    "threshold": "60%"
                  },
                  "className": "com.reltio.match.token.DistinctWordsMatchToken"
                }
              ]
            }
          ],
          "class": "com.reltio.match.token.CustomMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Name",
          "parameters": [
            {
              "parameter": "groups",
              "values": [
                {
                  "useNoiseIfEmpty": "true",
                  "classParams": {
                    "threshold": "60%"
                  },
                  "className": "com.reltio.match.comparator.DistinctWordsComparator"
                }
              ]
            }
          ],
          "class": "com.reltio.match.comparator.CustomComparator"
        }
      ]
    },
    "and": {
      "fuzzy": [
        "configuration/entityTypes/Organization/attributes/Name"
      ]
    }
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Exact asset ID, fuzzy manufacturer, model year within 10 years

Create suspect matches for the asset entity type when there is an exact match on Asset ID, a fuzzy match on Manufacturer name and the difference between the model years of two candidate pairs is 10 years or less.

```json
{
  "uri": "configuration/entityTypes/Asset/matchGroups/ExactOnAssetIdFuzzyOnManufacturerNameModelYear",
  "label": "Exact (Asset ID), Fuzzy (Model Year i.e. 10 Year range and Manufacturer Name)",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "ignoreInToken": [
      "configuration/entityTypes/Asset/attributes/ModelYear"
    ],
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Asset/attributes/AssetID",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/Asset/attributes/ModelInternalIdentifier/attributes/Organization",
          "class": "com.reltio.match.token.BasicTokenizedOrganizationNameMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Asset/attributes/AssetID",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/Asset/attributes/ModelInternalIdentifier/attributes/Organization",
          "class": "com.reltio.match.comparator.BasicTokenizedOrganizationNameComparator"
        },
        {
          "attribute": "configuration/entityTypes/Asset/attributes/ModelYear",
          "parameters": [
            {
              "parameter": "threshold",
              "value": "10"
            }
          ],
          "class": "com.reltio.match.comparator.RangeNumericComparator"
        }
      ]
    },
    "and": {
      "exact": [
        "configuration/entityTypes/Asset/attributes/AssetID"
      ],
      "fuzzy": [
        "configuration/entityTypes/Asset/attributes/ModelInternalIdentifier/attributes/Organization",
        "configuration/entityTypes/Asset/attributes/ModelYear"
      ]
    }
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### Jaro-Winkler organization name, exact address, address rank 1 or 2

Create suspect matches for the Organization entity type when we have exact match on Address Line 1, State and Postal Code and Fuzzy match on Organization Name using the Jaro Winkler algorithm where the Jarowinkler similarity threshold is 80%. The Address attributes should be matched only if the Address Rank is exactly same and the Address rank is 1 or 2.

```json
{
  "uri": "configuration/entityTypes/Organization/matchGroups/MatchOnEJaroNameExactAddr1StateAndPostalCode",
  "label": "Fuzzy (Name - JaroWinkler), Exact (Address line 1, State, Postal Code)",
  "type": "suspect",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "ignoreInToken": [
      "configuration/entityTypes/Organization/attributes/Name",
      "configuration/entityTypes/Organization/attributes/Address/attributes/AddressRank"
    ],
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/AddressLine1",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/StateProvince",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/PostalCode/attributes/PostalCode",
          "class": "com.reltio.match.token.ExactMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/AddressLine1",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/StateProvince",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/PostalCode/attributes/PostalCode",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Name",
          "parameters": [
            {
              "parameter": "groups",
              "values": [
                {
                  "classParams": {
                    "similarityThreshold": "0.8"
                  },
                  "useNoiseIfEmpty": false,
                  "pattern": "\\w+",
                  "className": "com.reltio.match.comparator.JaroWinklerComparator",
                  "sortWords": true,
                  "noiseDictionary": "organizationName"
                }
              ]
            }
          ],
          "class": "com.reltio.match.comparator.CustomComparator"
        }
      ]
    },
    "and": {
      "exact": [
        "configuration/entityTypes/Organization/attributes/Address/attributes/AddressLine1",
        "configuration/entityTypes/Organization/attributes/Address/attributes/StateProvince",
        "configuration/entityTypes/Organization/attributes/Address/attributes/PostalCode/attributes/PostalCode",
        "configuration/entityTypes/Organization/attributes/Address/attributes/AddressRank"
      ],
      "fuzzy": [
        "configuration/entityTypes/Organization/attributes/Name"
      ],
      "in": [
        {
          "values": [
            "1",
            "2"
          ],
          "uri": "configuration/entityTypes/Organization/attributes/Address/attributes/AddressRank"
        }
      ]
    }
  },
  "scoreStandalone": 0,
  "scoreIncremental": 0
}
```

### US organizations: exact name and address, ZIP5, noise words removed

Create auto merge rule for the Organization entity where Organization name, City, State and Postal Code and Address Rank matches exactly.
Special Considerations:

- The rule is specific to US Records
- Only the first 5 digits of the Postal Code (Zip5-Zip4) needs to be considered.
- Noise words should be removed from the Organization name and Address line 1
- Addresses should be matched only if the Address Rank is 1.
- If the Organization Name contains occurrences of multiple white space characters, then that needs to be replaced with single white space characters during matching.

```json
{
  "uri": "configuration/entityTypes/Organization/matchGroups/MatchOnExactNameAddr1AndCityByRankWithNoiseListForUS",
  "label": "US: Exact Name, Addr, City, State and Postal Code, Address Rank",
  "type": "automatic",
  "scope": "ALL",
  "useOvOnly": true,
  "rule": {
    "ignoreInToken": [
      "configuration/entityTypes/Organization/attributes/Address/attributes/Country",
      "configuration/entityTypes/Organization/attributes/Address/attributes/AddressRank"
    ],
    "cleanse": [
      {
        "cleanseAdapter": "com.reltio.cleanse.impl.RegexpReplaceCleanser",
        "cleanseAdapterParams": {
          "dictionary": "https://dictionaries.example.com/match/organization-aliases-and-noise-words.txt",
          "keepOriginalValue": "false",
          "dictionaryItems": [
            {
              "regex": "\\s{2,}",
              "replacement": " "
            }
          ]
        },
        "mappings": [
          {
            "attribute": "configuration/entityTypes/Organization/attributes/Name",
            "mandatory": false,
            "allValues": false,
            "cleanseAttribute": "configuration/entityTypes/Organization/attributes/Name"
          }
        ]
      },
      {
        "cleanseAdapter": "com.reltio.cleanse.impl.RegexpReplaceCleanser",
        "cleanseAdapterParams": {
          "dictionary": "https://dictionaries.example.com/match/address-line-1-aliases.txt",
          "keepOriginalValue": "false"
        },
        "mappings": [
          {
            "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/AddressLine1",
            "mandatory": false,
            "allValues": false,
            "cleanseAttribute": "configuration/entityTypes/Organization/attributes/Address/attributes/AddressLine1"
          }
        ]
      }
    ],
    "matchTokenClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Name",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/City",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/AddressLine1",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/StateProvince",
          "class": "com.reltio.match.token.ExactMatchToken"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/PostalCode/attributes/PostalCode",
          "parameters": [
            {
              "parameter": "groups",
              "values": [
                {
                  "pattern": "^([0-9]{5})",
                  "className": "com.reltio.match.token.ExactMatchToken"
                }
              ]
            }
          ],
          "class": "com.reltio.match.token.CustomMatchToken"
        }
      ]
    },
    "comparatorClasses": {
      "mapping": [
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Name",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/AddressLine1",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/City",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/StateProvince",
          "class": "com.reltio.match.comparator.BasicStringComparator"
        },
        {
          "attribute": "configuration/entityTypes/Organization/attributes/Address/attributes/PostalCode/attributes/PostalCode",
          "parameters": [
            {
              "parameter": "groups",
              "values": [
                {
                  "pattern": "^([0-9]{5})",
                  "className": "com.reltio.match.comparator.BasicStringComparator"
                }
              ]
            }
          ],
          "class": "com.reltio.match.comparator.CustomComparator"
        }
      ]
    },
    "and": {
      "exact": [
        "configuration/entityTypes/Organization/attributes/Address/attributes/City",
        "configuration/entityTypes/Organization/attributes/Address/attributes/AddressLine1",
        "configuration/entityTypes/Organization/attributes/Address/attributes/StateProvince",
        "configuration/entityTypes/Organization/attributes/Address/attributes/PostalCode/attributes/PostalCode",
        "configuration/entityTypes/Organization/attributes/Address/attributes/AddressRank",
        "configuration/entityTypes/Organization/attributes/Name"
      ],
      "in": [
        {
          "values": [
            "1"
          ],
          "uri": "configuration/entityTypes/Organization/attributes/Address/attributes/AddressRank"
        },
        {
          "values": [
            "US",
            "UNITED STATES",
            "United States"
          ],
          "uri": "configuration/entityTypes/Organization/attributes/Address/attributes/Country"
        }
      ]
    }
  },
  "scoreStandalone": 90,
  "scoreIncremental": 5
}
```
