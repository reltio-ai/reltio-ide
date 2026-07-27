# Life Sciences Customer 360 Velocity Pack

Pre-built data model for Life Sciences customer data management. Designed to master healthcare professionals (HCPs), healthcare organizations (HCOs), and their affiliations — providing a single version of truth for Life Sciences customer data. Supports NPI and DEA data enrichment for compliance and data quality purposes.

## Entity types

| Entity type | Purpose |
|-------------|---------|
| HCP (Healthcare Professional) | Individual healthcare providers — physicians, nurses, pharmacists |
| HCO (Healthcare Organization) | Hospitals, clinics, health systems, and pharmacies |
| GPO (Group Purchasing Organization) | Purchasing consortiums and group buying entities |
| IDN (Integrated Delivery Network) | Integrated networks of healthcare facilities |
| Location | Physical addresses linked to HCPs and HCOs |
| Contact | Contacts associated with healthcare organizations |
| Company | Corporate entities in the Life Sciences space |
| Party | Abstract parent type |

## Relation types

| Relation type | Connects |
|---------------|---------|
| Has Health Care Role | HCP → HCO (practitioner affiliation) |
| has address | HCP / HCO → Location |
| Affiliated with | HCO ↔ HCO / HCO ↔ GPO / HCO ↔ IDN |

## What's preconfigured

- Match rules and survivorship groups for HCP and HCO entity types
- NPI and DEA identifier support for regulatory data enrichment
- Cleansers for standardizing healthcare professional and organization data
- Preconfigured Hub UI for managing Life Sciences customer profiles and affiliations

## Documentation

[Reltio for Life Sciences velocity pack](https://docs.reltio.com/en/products/reltio-multidomain-master-data-management-mdm/reltio-multidomain-master-data-management-mdm-at-a-glance/reltio-multidomain-master-data-management-mdm-reference/reltio-multidomain-master-data-management-mdm-velocity-packs/reltio-for-life-sciences-velocity-pack)
