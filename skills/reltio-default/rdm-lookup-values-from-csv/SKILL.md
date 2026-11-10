---
name: reltio-rdm-lookup-values-from-csv
description: Load RDM lookup values — codes and their source mappings — into a Reltio tenant from a CSV in the format RDM exports, such as <rdmTenantId>_lookups_<timestamp>.csv with columns code, type and sourceMappings.*. One file can hold several lookup types. Creates new codes and appends new source mappings to existing ones, never changing or removing what is stored. Plans first and shows the user what will be added, then asks the Reltio IDE to load it. The user approves every load in an IDE dialog.
---

# RDM lookup values from CSV

Loads lookup values — codes and their source mappings — from a CSV into the tenant's RDM. The CSV is in the format RDM exports, so a file exported from one tenant or environment can be loaded into another. The Reltio IDE makes every call to the tenant with the user's session: you write a request file, and it writes a result file. Nothing reaches the tenant until the user clicks **Load** in a dialog the IDE shows. For a code that already exists, only the mappings it lacks are appended: nothing stored is changed or removed.

## When to use

The user wants to load, import or upload lookup values, reference codes or transcoding mappings from a CSV into RDM, often one exported from RDM elsewhere. For example: "load RdmTenant_lookups_1793868681973.csv into RDM", "copy these lookup values from Dev into this tenant", "import the organization statuses in this CSV".

Not for changing or deleting codes or mappings that already exist, and not for creating a lookup type. A lookup type is added to the RDM configuration (**Add a new Lookup Type**, then **Apply RDM Configuration**) before values can be loaded into it. Parents, localizations and attributes are not loaded.

## Inputs

1. **The CSV**, in the format RDM exports. Its name is usually `<rdmTenantId>_lookups_<timestamp>.csv`, but any `.csv` name works. The first line is the header. Column names are matched ignoring case, in any order. Quote a field that contains a comma. Every row names a `code` and its `type`, and carries one part of that lookup value: a code row with `enabled`, `startDate` and `endDate` (at most one per code), or a mapping row with one source mapping in the `sourceMappings.*` columns.

   | Column | Required | Sets |
   |---|---|---|
   | `code` | yes | The lookup code. Rows with the same `code` and `type` form one value. |
   | `type` | yes | The lookup type, as `rdm/lookupTypes/<name>`. It must be in the RDM configuration. One file can hold several lookup types. |
   | `enabled` | no | `true`/`false`, `yes`/`no` or `1`/`0`. Blank: true. |
   | `startDate`, `endDate` | no | Milliseconds since 1970. Blank or `0`: no bound. |
   | `sourceMappings.source` | for a mapping | The source, by its abbreviation in the RDM configuration (`Reltio`, `BvD`, …). |
   | `sourceMappings.code` | for a mapping | The source's code, which data from that source is transcoded by. Blank: the value. |
   | `sourceMappings.value` | for a mapping | How the source reads. Blank: the code. |
   | `sourceMappings.enabled` | no | Blank: true. |
   | `sourceMappings.canonicalValue` | no | Blank: only the code's first mapping is canonical. An existing code keeps its canonical value. |
   | `sourceMappings.downStreamDefaultValue` | no | Blank: true. |
   | `parents`, `localizations.*`, `attributes.*` | no | Not loaded. Each row that sets them is reported as a warning. |

   ```csv
   code,type,enabled,startDate,endDate,parents,sourceMappings.source,sourceMappings.code,sourceMappings.value,sourceMappings.enabled,sourceMappings.canonicalValue,sourceMappings.downStreamDefaultValue,localizations.languageCode,localizations.value,attributes.name,attributes.value
   B,rdm/lookupTypes/OrganizationStatuses,true,0,0,,,,,,,,,,,
   B,rdm/lookupTypes/OrganizationStatuses,,,,,BvD,B,Business,true,true,true,,,,
   B,rdm/lookupTypes/OrganizationStatuses,,,,,SAP,B,Business,true,false,true,,,,
   C,rdm/lookupTypes/OrganizationStatuses,true,0,0,,,,,,,,,,,
   C,rdm/lookupTypes/OrganizationStatuses,,,,,BvD,COMPANY,Company,true,true,true,,,,
   ```

   At most 10,000 rows and 2 MB per file. The earlier layout with `Code`, `Source` and `Value at Source` columns is no longer read; the plan says so.
2. **The tenant's RDM configuration**: `<environment>/<tenant>/RDM/<rdmTenantId>/config.json`. It must declare every lookup type in the CSV. The CSV may come from another RDM tenant, such as an export from Dev loaded into Prod; the plan points that out. If the workspace has several tenants or RDM tenants and it's unclear which one is meant, ask.
3. **A team override**: `skills/workspace/rdm-lookup-values-from-csv/SKILL.md`, if present, takes precedence over this file.

## Procedure

1. **Find** the CSV and the RDM configuration. Don't edit either without asking.
2. **Plan** the load. Write `.reltio/reltio-agent/rdm-lookup-load/request.json`:

   ```json
   {
     "requestId": "<new unique id for every request>",
     "mode": "plan",
     "csvFile": "<workspace-relative path to the CSV>",
     "rdmConfigFile": "<workspace-relative path to RDM/<rdmTenantId>/config.json>"
   }
   ```

   Don't add a tenant, environment or lookup type: the IDE works out the tenant from the configuration's path and the lookup types from the CSV's `type` column, and ignores anything else. Then wait for `.reltio/reltio-agent/rdm-lookup-load/result.json` to show the same `requestId`, checking every few seconds for up to a minute. A plan never writes anything.
3. **Show** the plan: the lookup types, tenant and RDM tenant; for each lookup type, the new codes, the existing codes that get mappings appended (and how many), and the codes already fully stored; and every error and warning with its line numbers. If there are errors, stop there: list them and offer to fix the CSV with the user. Warnings don't block a load, but point these out:
   - an unknown source, usually a misspelled abbreviation;
   - a conflict: a row whose source and code at the source are already stored with a different value is skipped, and the stored value is kept;
   - an existing code whose `enabled`, `startDate` or `endDate` differs from the CSV: what is stored is kept;
   - a CSV exported from another RDM tenant;
   - parents, localizations or attributes, which are not loaded.
4. **Ask** the user whether to load what the plan shows. Only when they say yes, write the request again with `"mode": "load"` and a new `requestId`. Never send a load the user hasn't asked for.
5. **Tell** the user to approve it in the dialog the IDE now shows ("Load into …?", naming the lookup types and counting the new codes and appended mappings). Wait for the result for up to five minutes; the dialog waits for them.
6. **Report** the result as described under Outputs. After a load, suggest **Get Lookup Values** on each lookup type to see the codes.

For several CSVs, take one file at a time: plan, show, ask, load.

Never ask for, read or pass on a token, and never call the RDM API yourself. The request file is the only way to the tenant.

## Outputs

Act on `status` in `result.json`. Every result has a `message` you can show as it is.

| `status` | Meaning | What to do |
|---|---|---|
| `planned` | The plan ran. `lookupTypes` lists the CSV's lookup types. `codes` lists each code with its `lookupType`, `classification` and CSV `lines`: `new` (created), `append` (exists; mappings are added) or `unchanged` (exists; every row is already stored or conflicts). `counts`, `appendMappingCount`, `errors` and `warnings` follow. | Step 3. |
| `loaded` | The load ran. Each code has its `lookupType` and an `outcome`; `counts` totals them. An `error` means a request failed partway, and nothing after it was sent. | Report the counts and list every code that is not `added`, `appended` or `unchanged`. With `error`, show its `message` and `httpStatus`. |
| `cancelled` | The user didn't approve the load in the IDE. Nothing was written. | Say so. Don't retry unless the user asks. |
| `not-run` | The IDE could not act. `reason`: `disabled`, `repository-mode`, `no-tenant`, `signed-out` or `no-rdm-service`. | Tell the user why, using `message`. For `signed-out`, offer to try again after they sign in. For `disabled`, the setting is `reltio.enableRdmLookupLoad`. |
| `failed` | Nothing was sent. `error.kind`: `invalid-request`, `invalid-csv`, `unknown-lookup-type`, `api-error`, `untrusted-host` or `network`. | For `invalid-request`, correct the request and retry with a new `requestId`. For `invalid-csv`, list `errors`. For `unknown-lookup-type`, show `message`, which names each lookup type the configuration lacks and any it resembles, with the CSV lines in `errors`. For `api-error`, report `httpStatus` and `message`. Retry `network` once. |
| No result after the wait | The IDE isn't running or isn't answering. | Tell the user. Don't try another way to reach the tenant. |

Each code's `outcome` after a load:

| `outcome` | Meaning |
|---|---|
| `added` | A new code, now stored with its mappings. |
| `appended` | An existing code, now stored with the mappings the CSV added. Its other mappings are untouched. |
| `unchanged` | An existing code with nothing to add; not sent. |
| `not-stored` | Sent, but the tenant didn't store it. |
| `not-sent` | Not sent, because an earlier request failed. |
| `unconfirmed` | Sent, but the IDE could not confirm it. |

Loading the same file again is safe: mappings already stored are not sent again, and only what is still missing is offered.

Report, in this order:

1. **Where**: lookup types, tenant and RDM tenant.
2. **Counts**: added, appended to, unchanged, and anything else.
3. **Needs attention**: codes not added, with their lookup type, CSV lines and the reason.
4. **Next step**: Get Lookup Values to review, or what to fix before loading again.
