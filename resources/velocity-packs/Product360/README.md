# Product 360 Velocity Pack

Pre-built data model for general product data management. Covers products, product groups, substances, manufacturers, and competitive relationships across any industry. Designed to master product records from multiple source systems into a single authoritative product profile.

## Entity types

| Entity type | Purpose |
|-------------|---------|
| Product | Core product records |
| Product Group | Product families and groupings |
| Substance | Ingredients and component substances |
| Entity | Abstract parent type |

## Relation types

| Relation type | Description |
|---------------|-------------|
| Ingredient | Substance → Product (component relationship) |
| Manufacturer | Product → Organization (manufacturing relationship) |
| Has Product Group | Product → Product Group |
| Child Product Group | Product Group → Product Group (hierarchy) |
| Has Market Product | Product ↔ Product (market equivalents) |
| is Marketed by | Product → Organization (marketing relationship) |
| Has Competitor | Product ↔ Product (competitive relationship) |
| Peer Product | Product ↔ Product (peer relationship) |

## What's preconfigured

- Match rules and survivorship groups for Product entity types
- Reference data lookup types including availability, currency, territory, license type, and subscription type
- Cleansers for standardizing product data from multiple source systems
- Preconfigured Hub UI for managing product portfolios

## Documentation

[Reltio for Product velocity pack](https://docs.reltio.com/en/products/reltio-multidomain-master-data-management-mdm/reltio-multidomain-master-data-management-mdm-at-a-glance/reltio-multidomain-master-data-management-mdm-reference/reltio-multidomain-master-data-management-mdm-velocity-packs/reltio-for-product-velocity-pack)
