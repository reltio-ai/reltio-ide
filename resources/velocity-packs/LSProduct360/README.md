# Life Sciences Product 360 Velocity Pack

Pre-built data model for Life Sciences product data management. Covers medicinal products, substances, manufacturers, regulatory bodies, and other aspects of the pharmaceutical product industry. Closely aligned to IDMP (Identification of Medicinal Products) standards and compatible with the HL7 standard for inbound and outbound use cases.

## Entity types

| Entity type | Purpose |
|-------------|---------|
| Medicinal Product | Approved medicinal products and branded drugs |
| Product | General product records |
| Promotional Product | Promotional and sample product records |
| Product Group | Product groupings and families |
| Substance | Active pharmaceutical ingredients and substances |
| Entity | Abstract parent type |

## Relation types

| Relation type | Description |
|---------------|-------------|
| Ingredient | Substance → Product (active ingredient relationship) |
| Manufacturer | Product → Organization (manufacturing relationship) |
| Brand To Strength | Branded product → product strength variant |
| Strength To Product | Strength variant → base product |
| Therapeutic Area To Brand | Therapeutic classification → branded product |
| Has Product Group | Product → Product Group |
| Has Market Product | Product ↔ Product (market equivalents) |
| is Marketing Holder | Product → Organization (marketing authorization holder) |
| is regulator | Product → Organization (regulatory body) |
| Has Competitor | Product ↔ Product (competitive relationship) |
| Peer Entity | Entity ↔ Entity |

## What's preconfigured

- Match rules and survivorship groups for medicinal product and substance entity types
- IDMP-aligned data model for regulatory compliance
- Preconfigured Hub UI for managing Life Sciences product portfolios

## Documentation

[Reltio for Life Sciences velocity pack](https://docs.reltio.com/en/products/reltio-multidomain-master-data-management-mdm/reltio-multidomain-master-data-management-mdm-at-a-glance/reltio-multidomain-master-data-management-mdm-reference/reltio-multidomain-master-data-management-mdm-velocity-packs/reltio-for-life-sciences-velocity-pack)
