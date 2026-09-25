## ADDED Requirements

### Requirement: A tenant folder materializes a fixed component tree
When a tenant folder is created, the extension SHALL materialize a fixed tree of component folders inside it. The tree SHALL be identical for every tenant regardless of environment, tenant ID, or which components that tenant actually uses. The set of folders SHALL be:

```
Business Config/
RDM/
Workflows/BPMN/
Workflows/Custom Workflows/
```

The tree covers the components teams version today. `Workflows/` exists as an implied container,
giving five directories in total.

#### Scenario: Adding a tenant creates the full tree
- **WHEN** the user adds a tenant to an environment
- **THEN** every folder in the fixed tree exists inside the tenant folder
- **AND** the tree is created before any configuration is fetched

#### Scenario: The tree is identical across tenants
- **WHEN** two tenants in different environments are added
- **THEN** the relative folder paths inside each tenant folder are byte-identical
- **AND** no folder name contains an environment host or tenant ID

#### Scenario: Re-creating an existing tenant is non-destructive
- **WHEN** the tree is materialized into a tenant folder that already contains some of those folders
- **THEN** existing folders and their contents are left untouched
- **AND** only missing folders are created

### Requirement: The tenant configuration file is `Business Config/BusinessConfig.json`
The fetched tenant configuration SHALL be stored at `Business Config/BusinessConfig.json` relative to the tenant folder. The legacy name `L3.reltio.json` SHALL NOT be used for newly written configuration.

#### Scenario: Fetch writes to the component path
- **WHEN** the user runs **Fetch Configuration** for a tenant
- **THEN** the configuration is written to `Business Config/BusinessConfig.json` inside that tenant folder

#### Scenario: Language features apply to the renamed file
- **WHEN** `Business Config/BusinessConfig.json` is open in the editor
- **THEN** Go-to-Definition, Find All References, unresolved-URI diagnostics, URI completion, schema validation, the configuration tree and the ontology preview all behave exactly as they did for `L3.reltio.json`

#### Scenario: Apply reads from the component path
- **WHEN** the user runs **Apply Configuration to Tenant**
- **THEN** the payload is read from `Business Config/BusinessConfig.json`

### Requirement: Unmanaged component folders carry a README placeholder
Git does not track empty directories. Every component folder that has no leaf subfolder and that the IDE does not yet manage SHALL contain a `README.md`. The README SHALL name the component, list the files expected to live there, link to the component's page on `docs.reltio.com`, and state that the IDE does not currently fetch or apply them.

The documentation URL for each folder SHALL come from a single map declared alongside the component-tree definition, so that a link correction is one edit with no migration.

#### Scenario: Placeholders survive a commit
- **WHEN** a freshly created tenant folder is committed and pushed
- **THEN** every component folder is present in the pushed tree
- **AND** each unmanaged folder contains its `README.md`

#### Scenario: Business Config has no placeholder
- **WHEN** the tree is materialized
- **THEN** `Business Config/` contains no `README.md`, because it holds a managed file

#### Scenario: A user-authored file is never overwritten
- **WHEN** a component folder already contains a `README.md` that differs from the generated content
- **THEN** the existing file is left unchanged

#### Scenario: Every unmanaged folder has a documentation link
- **WHEN** the component tree is materialized
- **THEN** every generated `README.md` contains a non-empty `docs.reltio.com` URL for its component
- **AND** no folder falls back to a generic or placeholder link

### Requirement: Component folders no longer in the tree are removed, but only when generated
Earlier builds materialized fourteen further component folders. The extension SHALL remove those
folders from existing tenants, and SHALL do so only when a folder holds nothing but a `README.md`
this extension generated. Any other file, or a `README.md` the user has rewritten, SHALL keep the
folder and everything in it.

#### Scenario: A purely generated folder is removed
- **WHEN** a retired component folder contains only the generated `README.md`
- **THEN** the folder is removed
- **AND** the removal is reported in the migration summary

#### Scenario: A user file keeps the folder
- **WHEN** a retired component folder contains a file the user added
- **THEN** the folder and its contents are left untouched

#### Scenario: A rewritten README keeps the folder
- **WHEN** a retired component folder's `README.md` no longer carries the generated wording
- **THEN** the folder is treated as user content and left untouched

#### Scenario: Surviving components are never pruned
- **WHEN** retired folders are removed
- **THEN** `Business Config/`, `RDM/`, `Workflows/BPMN/` and `Workflows/Custom Workflows/` remain

#### Scenario: Pruning is idempotent
- **WHEN** the prune runs a second time on the same tenant
- **THEN** nothing further is removed

### Requirement: IDE working state is isolated in `.reltio-ide/`
Files the extension maintains for its own operation SHALL live under `.reltio-ide/` at the tenant folder root, separate from the tracked component tree. This SHALL cover the drift baseline, the ontology layout sidecar, and configuration history snapshots.

| Purpose | Path relative to the tenant folder |
|---|---|
| Drift baseline | `.reltio-ide/BusinessConfig.baseline.json` |
| Ontology layout | `.reltio-ide/BusinessConfig.layout.json` |
| History snapshots | `.reltio-ide/history/` |

#### Scenario: Fetch writes the baseline out of the tracked tree
- **WHEN** **Fetch Configuration** completes successfully
- **THEN** the remote baseline is written to `.reltio-ide/BusinessConfig.baseline.json`
- **AND** no baseline file is written inside `Business Config/`

#### Scenario: Ontology layout persists outside the tracked tree
- **WHEN** the user arranges nodes in the ontology preview and the layout is saved
- **THEN** the positions are written to `.reltio-ide/BusinessConfig.layout.json`

#### Scenario: History snapshots are isolated
- **WHEN** the user runs **Fetch configuration history**
- **THEN** snapshot files are written under `.reltio-ide/history/`
- **AND** clearing history on first fetch affects only that directory

### Requirement: Tenant folders are created at the workspace root
New environment folders SHALL be created directly under the workspace root rather than under the hidden `.reltio/` directory, so that tenant repositories are visible at depth two. The `.reltio/` directory SHALL continue to hold extension-managed agent assets only.

#### Scenario: A new environment lands at the workspace root
- **WHEN** the user adds an environment
- **THEN** `{host}.reltio.environment/` is created directly under the workspace root

#### Scenario: Existing `.reltio/` environments are still found
- **WHEN** a workspace contains environment folders under `.reltio/` from a previous version
- **THEN** those environments continue to appear in the tree and remain fully usable

#### Scenario: Agent assets are unaffected
- **WHEN** the extension syncs bundled skills and Velocity Packs
- **THEN** they are written under `.reltio/reltio-agent/` exactly as before
