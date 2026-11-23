## Why

Adding an RDM lookup type takes a trip to the Reltio view: **Add a new Lookup Type** inserts a placeholder named `LookupType1`, which the user then renames in two places. Entity types, relation types and attributes can already be added by asking an agent ("Add entity type …"); lookup types cannot, and the CSV load skill stops at a lookup type that does not exist yet.

## What Changes

- A new bundled agent skill, **`reltio-rdm-lookup-type-concepts`**, installed by the existing agent-asset sync for Claude Code and Cursor. It answers requests such as "Add lookup type OrganizationStatuses".
- The skill adds the entry **Add a new Lookup Type** writes — `uri` `rdm/lookupTypes/<Name>`, `label`, `enabled`, `startDate`, `endDate` — to the tenant's `RDM/<rdmTenantId>/config.json`, one or several per request.
- Before writing, it checks the name can be a URI segment and that no lookup type with the same name or label exists under any spelling; a near match waits for the user.
- It never pushes. The user applies with **Apply RDM Configuration**, which keeps its baseline check and confirmation.
- `reltio-rdm-lookup-values-from-csv` points to it when a lookup type is missing.
- `skillsBundleVersion` is raised so existing workspaces receive the skill. No code changes: the skill only edits a local file.

## Capabilities

### New Capabilities

- `rdm-lookup-type-concepts`: adding RDM lookup types from an agent request.

### Modified Capabilities

_None._

## Impact

- `skills/reltio-default/rdm-lookup-type-concepts/SKILL.md` — new; `.cursor/skills/reltio-rdm-lookup-type-concepts/SKILL.md` — contributor pointer.
- `skills/reltio-default/rdm-lookup-values-from-csv/SKILL.md` — hand-off to the new skill.
- `resources/reltio-agent-assets.json` — `skillsBundleVersion` 30; `scripts/test-workflow-skills-library.cjs` — pinned version and hash.
- `scripts/test-rdm-lookup-type-concepts.cjs` — new, registered in `scripts/run-unit-tests.cjs`.
- `ARCHITECTURE.md` — RDM authoring section.
