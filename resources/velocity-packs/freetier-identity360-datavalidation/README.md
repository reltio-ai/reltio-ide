# Free Tier — Identity 360 with Data Validation

Pre-built identity resolution data model for the Reltio free tier. Covers individuals, organizations, locations, and a comprehensive set of personal, professional, and organizational relationship types. Includes data validation rules preconfigured for the free-tier environment.

## Entity types

| Entity type | Purpose |
|-------------|---------|
| Individual | Person profiles |
| Organization | Companies and organizational entities |
| Location | Physical addresses |
| Party | Abstract parent type for individuals and organizations |

## Relation types

**Personal relationships**

| Relation type | Description |
|---------------|-------------|
| Spouse | Marriage relationship |
| Parent | Parent–child relationship |
| Sibling | Sibling relationship |
| domestic partner | Domestic partnership |
| Family | General family relationship |
| Relative | Extended family |
| Friend | Friendship |
| ReferredBy | Referral relationship |

**Professional relationships**

| Relation type | Description |
|---------------|-------------|
| Employment | Individual → Organization (employment) |
| Manager | Management relationship |
| Assistant | Assistance relationship |
| Advisor | Advisory relationship |
| Accountant | Accounting relationship |
| Attorney | Legal relationship |
| Contractor | Contract work relationship |
| Contact | General contact relationship |
| Business | Business relationship |
| Partner | Business partnership |
| Influencer | Influence relationship |

**Organizational relationships**

| Relation type | Description |
|---------------|-------------|
| Affiliated with | Organization ↔ Organization |
| Subsidiary of | Organization → Organization (hierarchy) |
| Organization Hierarchy (Managed / Owned / Officer / Boardmember) | Ownership and governance relationships |
| has address | Entity → Location |
| Leased | Individual / Organization → Location |

## What's preconfigured

- Match rules and survivorship groups for Individual and Organization entity types
- Data validation functions for verifying address, phone, and email data
- Identity resolution configuration for deduplicating person and organization records
- Preconfigured for free-tier Reltio environments

## Documentation

[Reltio velocity packs](https://docs.reltio.com/en/reltio/whats-in-the-box/whats-in-the-box-at-a-glance/tenants-at-a-glance/tenant-architecture/reltio-velocity-packs)
