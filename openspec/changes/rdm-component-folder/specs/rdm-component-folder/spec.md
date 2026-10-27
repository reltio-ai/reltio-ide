## ADDED Requirements

### Requirement: RDM configurations live in the RDM component folder

Each RDM configuration SHALL be stored at `RDM/{rdmTenantId}/config.json` inside the tenant folder, one subfolder per RDM tenant. The path pieces SHALL be declared in the module that names every other tenant path.

#### Scenario: Configuration written into the component tree

- **WHEN** the RDM configuration for RDM tenant `RdmSampleTenant` is fetched for a tenant
- **THEN** it SHALL be written to `RDM/RdmSampleTenant/config.json` in that tenant's folder
- **AND** no RDM configuration SHALL be written to the tenant folder root

#### Scenario: Several RDM tenants each get a subfolder

- **WHEN** a tenant declares two RDM tenants
- **THEN** each SHALL be written to its own `RDM/{rdmTenantId}/config.json`

### Requirement: RDM baselines are kept out of the tracked tree

Each RDM baseline SHALL be stored at `.reltio-ide/RDM/{rdmTenantId}.baseline.json`, inside the IDE working-state folder that the tenant's generated `.gitignore` already excludes.

#### Scenario: Baseline is not tracked by Git

- **WHEN** an RDM configuration is fetched into a Git-bound tenant
- **THEN** its baseline SHALL be written under `.reltio-ide/RDM/`
- **AND** `git status` SHALL NOT list the baseline

### Requirement: RDM tenants are enumerated from the component folder

The extension SHALL treat each subfolder of `RDM/` that contains a `config.json` as one RDM tenant, named by the subfolder. Files placed directly in `RDM/`, and subfolders without a `config.json`, SHALL NOT be treated as RDM tenants.

#### Scenario: Placeholder README is not an RDM tenant

- **WHEN** `RDM/` contains the generated `README.md` and one subfolder holding `config.json`
- **THEN** exactly one RDM tenant SHALL be enumerated

#### Scenario: Empty subfolder is ignored

- **WHEN** `RDM/` contains a subfolder with no `config.json`
- **THEN** that subfolder SHALL NOT be enumerated as an RDM tenant

### Requirement: Root-level RDM files are relocated into the component tree

On activation, after the layout migration, the extension SHALL move each root-level `RDM.{rdmTenantId}.reltio.json` to `RDM/{rdmTenantId}/config.json`, and each root-level `RDM.{rdmTenantId}.remote-baseline.reltio.json` to `.reltio-ide/RDM/{rdmTenantId}.baseline.json`.

The relocation SHALL run independently of the layout migration's per-tenant stamp, so that tenants which have already migrated are still reached.

#### Scenario: Legacy files are moved

- **WHEN** a tenant folder has `RDM.X.reltio.json` and `RDM.X.remote-baseline.reltio.json` at its root
- **THEN** after activation they SHALL be at `RDM/X/config.json` and `.reltio-ide/RDM/X.baseline.json`
- **AND** they SHALL no longer be at the root

#### Scenario: Already-migrated tenants are reached

- **WHEN** a tenant has already been stamped as migrated by the layout migration but still has root-level RDM files
- **THEN** those files SHALL still be relocated

#### Scenario: Repeating is harmless

- **WHEN** relocation runs again on a tenant that has already been relocated
- **THEN** no file SHALL be moved or modified

#### Scenario: An existing destination is never overwritten

- **WHEN** a root-level RDM file's destination already exists
- **THEN** the root-level file SHALL be left where it is, the destination SHALL be unchanged, and the conflict SHALL be reported

### Requirement: Connecting a tenant fetches its RDM configuration

When a tenant is connected — by browser sign-in auto-add, **Add Tenant**, the **Setup Wizard**, or **Apply default environments** — the extension SHALL fetch its RDM configuration after its Business Config is written successfully, as Get Configuration does.

Every connect flow SHALL obtain this behaviour from one shared operation rather than by calling the Business Config writer and continuing into RDM itself, so that a flow which is handed the writer as a dependency cannot connect a tenant without its RDM.

#### Scenario: Sign-in fetches RDM

- **WHEN** a tenant is auto-added after a successful browser sign-in and its Business Config is written
- **THEN** its RDM configuration SHALL be fetched without the user running Get Configuration

#### Scenario: Add Tenant fetches RDM

- **WHEN** the user adds a tenant and its Business Config is written
- **THEN** its RDM configuration SHALL be fetched

#### Scenario: The Setup Wizard fetches RDM

- **WHEN** the user connects a tenant through the Setup Wizard and its Business Config is written
- **THEN** its RDM configuration SHALL be fetched

#### Scenario: Apply default environments fetches RDM

- **WHEN** default environments are applied with Business Config fetching enabled and a tenant's Business Config is written
- **THEN** that tenant's RDM configuration SHALL be fetched

#### Scenario: A failed Business Config fetch skips RDM

- **WHEN** a tenant is connected but its Business Config could not be fetched
- **THEN** no RDM request SHALL be made

#### Scenario: A tenant without RDM connects silently

- **WHEN** a connected tenant has no RDM configured
- **THEN** the connect SHALL complete with no RDM notification

#### Scenario: An RDM failure does not undo the connect

- **WHEN** the RDM fetch fails after the Business Config was written
- **THEN** the tenant SHALL remain added with its Business Config, and the RDM failure SHALL be reported on its own
