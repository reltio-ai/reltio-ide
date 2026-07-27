# Account 360 Velocity Pack

Pre-built data model for B2B customer data management. Covers organizations, contacts, locations, and their affiliations — giving you a single version of truth for end-to-end customer data in business-to-business operations. Includes preconfigured hierarchy integrations with Dun & Bradstreet (D&B) and Bureau van Dijk (BvD).

## Entity types

| Entity type | Purpose |
|-------------|---------|
| Organization | Companies, accounts, and corporate entities |
| Contact | Individual contacts associated with organizations |
| Location | Physical addresses linked to organizations and contacts |
| Individual | Individual person profiles |
| Employee | Employee records |
| Product | Products associated with accounts |
| Party | Abstract parent type for organizations and individuals |

## Relation types

| Relation type | Connects |
|---------------|---------|
| has address | Organization / Contact → Location |
| D&B Subsidiary of | Organization → Organization (D&B hierarchy) |
| BvD Subsidiary of | Organization → Organization (BvD hierarchy) |
| Affiliated with | Organization ↔ Organization |

## What's preconfigured

- Match rules for Organization, Contact, and Location entity types
- Survivorship groups and cleansers for standardizing incoming data
- Reference data lookup types (address types, country codes, and more)
- Preconfigured Hub UI for searching, segmenting, and managing profiles

## Documentation

[Reltio for B2B Data Domains velocity pack](https://docs.reltio.com/en/products/reltio-multidomain-master-data-management-mdm/reltio-multidomain-master-data-management-mdm-at-a-glance/reltio-multidomain-master-data-management-mdm-reference/reltio-multidomain-master-data-management-mdm-velocity-packs/reltio-for-b2b-data-domains-velocity-pack)
