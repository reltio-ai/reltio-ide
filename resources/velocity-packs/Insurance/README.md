# Insurance Velocity Pack

Pre-built data model for the insurance industry. Covers the full insurance data landscape — policyholders, brokers, contracts, claims, insured assets, and households — with preconfigured relationships connecting all entities. Supports property, casualty, and life insurance use cases.

> **Note:** This is the v3 Insurance velocity pack. It is not backwards compatible with previous versions of the Insurance velocity pack.

## Entity types

| Entity type | Purpose |
|-------------|---------|
| Individual | Policyholders, claimants, and named insureds |
| Organization | Insurance carriers, employers, and corporate entities |
| Broker Agent | Brokers and agents managing contracts |
| Location | Physical addresses linked to entities |
| Contract | Insurance policies and agreements |
| Claim | Insurance claims |
| Insured Asset | Assets covered under a contract |
| Structure | Physical structures covered under a contract |
| Household | Household groupings of individuals |

## Relation types

| Category | Relation types |
|----------|---------------|
| Address | Has Address (Individual), Has Address (Household), Has Address (Organization), Has Address (Broker/Agent) |
| Contract | Broker/Agent to Contract, Individual to Contract, Named Insured, Contract to Claim, Contract to Insured Asset, Contract To Structure, Contract to Location, Related Contracts |
| Claims | Individual to Claim, Insured Asset to Claim, Structure to Claim, Claim to Location, Claimant |
| Assets | Primary (Asset) Owner, Individual to Insured Asset, Insured Asset to Location, Structure to Location |
| Household | Household Membership, Spouse, Child, Other Dependent |
| Organization | Broker/Agent to Organization, Organization to Individual, Individual Employer, Professional Affiliation, Organization Affiliation, Organization Hierarchy, D&B Hierarchy |

## What's preconfigured

- Match rules for Individual, Organization, Location, and Broker Agent entity types
- Survivorship groups and cleansers for standardizing policyholder and claims data
- Reference data lookup types including asset types, claim status, contract types, property type, and more
- Preconfigured Hub UI for managing insurance profiles and relationships

## Documentation

[Reltio for Insurance velocity pack](https://docs.reltio.com/en/products/reltio-multidomain-master-data-management-mdm/reltio-multidomain-master-data-management-mdm-at-a-glance/reltio-multidomain-master-data-management-mdm-reference/reltio-multidomain-master-data-management-mdm-velocity-packs/reltio-for-insurance-velocity-pack)
