## MODIFIED Requirements

### Requirement: Baseline capture on fetch

The system SHALL persist a **baseline copy** of the remote configuration whenever a successful **Fetch L3** (download tenant configuration) completes, representing the remote tenant configuration at that moment for later **staleness checks**. The baseline SHALL be updated to match the same effective configuration content written to **`L3.reltio.json`** for that fetch.

The same fetch action SHALL additionally persist a baseline for each RDM configuration it writes, named `RDM.{rdmTenantId}.remote-baseline.reltio.json` and holding content identical to the corresponding `RDM.{rdmTenantId}.reltio.json`. RDM baselines exist to detect unapplied local edits before a re-fetch overwrites them; they SHALL NOT be consulted by **Apply**, which continues to operate on L3 alone and never pushes RDM content to any service.

#### Scenario: Fetch L3 establishes baseline

- **WHEN** the user successfully fetches L3 configuration for a tenant into **`L3.reltio.json`**
- **THEN** the system SHALL write or replace a dedicated baseline artifact on disk associated with that tenant so it can be compared later to a fresh **GET** response

#### Scenario: Same fetch establishes RDM baselines

- **WHEN** that same fetch also writes one or more `RDM.{rdmTenantId}.reltio.json` files for the tenant
- **THEN** the system SHALL write or replace a baseline artifact for each of them, with content identical to the file it shadows

#### Scenario: Apply is unaffected by RDM baselines

- **WHEN** the user runs Apply for a tenant that has RDM configurations and baselines on disk
- **THEN** the pre-flight drift check and the upload SHALL consider only the L3 configuration and its baseline
- **AND** no RDM file SHALL be read as part of the drift check or sent to any service

#### Scenario: Missing RDM baseline does not block apply

- **WHEN** a tenant has an `L3.reltio.json` and a valid L3 baseline but no RDM baseline on disk
- **THEN** Apply SHALL proceed exactly as it does today
