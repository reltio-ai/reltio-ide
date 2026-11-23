---
name: reltio-rdm-lookup-type-concepts
description: Add RDM lookup types to a tenant's RDM configuration from a request such as "Add lookup type OrganizationStatuses". Writes the same entry the Reltio IDE's Add a new Lookup Type command does, after checking the name is valid and not already there under any spelling. Never pushes to the tenant itself; the user applies the change with Apply RDM Configuration.
---

# RDM lookup type concepts

Adds one or more lookup types to the RDM configuration file of a tenant in the workspace. Each lookup type is one entry in the file's `lookupTypes` list, identified by its URI, `rdm/lookupTypes/<Name>`. That URI is also what an L3 attribute's `lookupCode` points to. The skill only edits the local file: nothing reaches the tenant until the user runs **Apply RDM Configuration** in the Reltio IDE.

## When to use

The user wants a new RDM lookup type. For example: "Add lookup type OrganizationStatuses", "create lookup types AddressTypes and PhoneTypes in RDM", "we need an RDM lookup for organization statuses".

Not for:

- **Values** of a lookup type (codes and source mappings): use `reltio-rdm-lookup-values-from-csv`, after the lookup type is applied.
- **Sources**: the IDE's **Add a new Source** command adds them.
- **Renaming, disabling or deleting** a lookup type: values and L3 attributes may depend on it. Point the user at the file and let them decide.
- **L3 attributes**: setting an attribute's `lookupCode` belongs to `reltio-attributes-from-concept`.

## Inputs

1. **The lookup type names** from the request. A name becomes the last segment of the URI, so it must be letters and digits only, starting with a letter: no spaces, slashes or punctuation. Follow the tenant's existing style, which is usually PascalCase and plural, such as `OrganizationStatuses`, `AddressTypes` or `MaritalStatuses`.
2. **The tenant's RDM configuration**: `<environment>/<tenant>/RDM/<rdmTenantId>/config.json`, with its `lookupTypes` list. If the workspace has several tenants or RDM tenants and the request doesn't say which, ask. If the tenant has no `RDM/` folder, its RDM configuration hasn't been fetched: ask the user to run **Get Configuration** on the tenant. If there is still none, the tenant has no RDM tenant, so stop and say so.
3. **A team override**: `skills/workspace/rdm-lookup-type-concepts/SKILL.md`, if present, takes precedence over this file.

## Procedure

1. **Read** the RDM configuration and list the lookup types it already has, by URI and label.
2. **Name** each requested lookup type. If a name has spaces or other characters a URI can't hold, such as "Organization Statuses", propose the cleaned name (`OrganizationStatuses`) and confirm it with the user before writing.
3. **Check** each name against the file. Compare the URI's last segment and the label, ignoring case:
   - **Same URI**: the lookup type already exists. Say so and add nothing for it.
   - **Same name in another case, or the same label**, such as `organizationStatuses`: it is very likely the same lookup type under another spelling. Name the existing one and ask before adding anything; RDM would hold both.
   - A name requested twice is added once.
4. **Write** each new lookup type at the end of `lookupTypes`, creating the list if the file has none. Write exactly the entry **Add a new Lookup Type** writes, with the name in both `uri` and `label`:

   ```json
   {
     "uri": "rdm/lookupTypes/OrganizationStatuses",
     "label": "OrganizationStatuses",
     "enabled": true,
     "startDate": 0,
     "endDate": 0
   }
   ```

   Use another `label` only when the user asks for a display label; the URI keeps the name. Keep the file's indentation, and change nothing else in it: not other lookup types, not `sources`, `tenantId`, `version`, `updatedBy` or `updateDate`. If the file isn't valid JSON, stop and tell the user rather than repairing it.
5. **Show** the lookup types you added, with their URIs, and the ones you skipped and why.
6. **Tell** the user how to put it on the tenant: in the Reltio view, right-click the RDM tenant row (`<rdmTenantId>` under the tenant's RDM folder) and choose **Apply RDM Configuration**. It needs a baseline from **Get Configuration**, asks before it sends anything, and shows the differences first if the tenant's RDM configuration changed since that fetch. If the user has the file open with unsaved changes, they must save it before applying.

Never apply the configuration yourself, never call the RDM API, and never ask for, read or pass on a token. The file is the only thing this skill changes.

## Outputs

Report, in this order:

1. **Where**: the RDM configuration file, with its tenant and RDM tenant.
2. **Added**: each new lookup type's URI and label.
3. **Skipped**: each name not added, and why: already there, a different spelling of an existing lookup type (waiting for the user), or not a valid name.
4. **Next steps**:
   - Run **Apply RDM Configuration** on the RDM tenant row. Until then the lookup type exists only in the local file.
   - Load values, after applying, with `reltio-rdm-lookup-values-from-csv`, or add them one at a time with **Get Lookup Values** and its **Add Value** form.
   - To use the lookup type on an L3 attribute, set that attribute's `lookupCode` to the URI, for example `rdm/lookupTypes/OrganizationStatuses`.
