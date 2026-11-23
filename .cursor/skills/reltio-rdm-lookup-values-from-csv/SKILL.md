---
name: reltio-rdm-lookup-values-from-csv
description: Load RDM lookup values — codes and their source mappings — into a Reltio tenant from a CSV named after the lookup type, such as MaritalStatuses.csv with columns Code, Source and Value at Source. Creates new codes and appends new source mappings to existing ones, never changing or removing what is stored. Plans first and shows the user what will be added, then asks the Reltio IDE to load it. The user approves every load in an IDE dialog.
---

# RDM lookup values from CSV

Loads a lookup type's codes and source mappings from a CSV into the tenant's RDM. The Reltio IDE makes every call to the tenant with the user's session: you write a request file, and it writes a result file. Nothing reaches the tenant until the user clicks **Load** in a dialog the IDE shows. For a code that already exists, only the mappings it lacks are appended: nothing stored is changed or removed.

## When to use

The user wants to load, import or upload lookup values, reference codes or transcoding mappings from a CSV into RDM. For example: "load MaritalStatuses.csv into RDM", "import these address types into the lookup", "upload the lookup CSVs in this folder".

Not for changing or deleting codes that already exist, and not for creating a lookup type. A lookup type is added to the RDM configuration (**Add a new Lookup Type**, then **Apply RDM Configuration**) before values can be loaded into it.

## Inputs

1. **The CSV**, named after the lookup type exactly: `MaritalStatuses.csv` loads into `MaritalStatuses`. The first line is the header. Column names are matched ignoring case, in any order. Quote a field that contains a comma.

   | Column | Required | Sets |
   |---|---|---|
   | `Code` | yes | The canonical code. Rows with the same code form one value, one source mapping per row. |
   | `Source` | yes | The source, by its abbreviation in the RDM configuration (`Reltio`, `BvD`, …). |
   | `Value at Source` | yes | The source's code **and** its value, so data from that source sending this value transcodes to `Code`. |
   | `Code at Source` | no | The source's code, when it differs from the value. |
   | `Canonical` | no | `true`/`false`, `yes`/`no` or `1`/`0`. Blank: only the code's first row is canonical. An existing code keeps its canonical value. |
   | `Downstream Default` | no | Same values. Blank: true. |

   ```csv
   Code,Source,Value at Source
   Single,Reltio,S
   Single,BvD,Unmarried
   Married,Reltio,M
   Married,BvD,Spouse present
   ```

   At most 10,000 rows and 2 MB per file.
2. **The tenant's RDM configuration**: `<environment>/<tenant>/RDM/<rdmTenantId>/config.json`. It must declare the lookup type. If the workspace has several tenants or RDM tenants and it's unclear which one is meant, ask.
3. **A team override**: `skills/workspace/rdm-lookup-values-from-csv/SKILL.md`, if present, takes precedence over this file.

## Procedure

1. **Find** the CSV and the RDM configuration. If the file name is not a lookup type in that configuration, say which lookup types exist (or which one the name resembles) and stop. Don't rename the file or edit the CSV without asking.
2. **Plan** the load. Write `.reltio/reltio-agent/rdm-lookup-load/request.json`:

   ```json
   {
     "requestId": "<new unique id for every request>",
     "mode": "plan",
     "csvFile": "<workspace-relative path to the CSV>",
     "rdmConfigFile": "<workspace-relative path to RDM/<rdmTenantId>/config.json>"
   }
   ```

   Don't add a tenant, environment or lookup type: the IDE works them out from the two files and ignores anything else. Then wait for `.reltio/reltio-agent/rdm-lookup-load/result.json` to show the same `requestId`, checking every few seconds for up to a minute. A plan never writes anything.
3. **Show** the plan: the lookup type, tenant and RDM tenant; the new codes; the existing codes that get mappings appended, and how many; the codes already fully stored; and every error and warning with its line numbers. If there are errors, stop there: list them and offer to fix the CSV with the user. Warnings don't block a load, but point out unknown sources (usually a misspelled abbreviation) and conflicts: a row whose source and code at the source are already stored with a different value is skipped, and the stored value is kept.
4. **Ask** the user whether to load what the plan shows. Only when they say yes, write the request again with `"mode": "load"` and a new `requestId`. Never send a load the user hasn't asked for.
5. **Tell** the user to approve it in the dialog the IDE now shows ("Load into …?", with the new codes and appended mappings counted). Wait for the result for up to five minutes; the dialog waits for them.
6. **Report** the result as described under Outputs. After a load, suggest **Get Lookup Values** on the lookup type to see the codes.

For several CSVs, take one file at a time: plan, show, ask, load.

Never ask for, read or pass on a token, and never call the RDM API yourself. The request file is the only way to the tenant.

## Outputs

Act on `status` in `result.json`. Every result has a `message` you can show as it is.

| `status` | Meaning | What to do |
|---|---|---|
| `planned` | The plan ran. `codes` lists each code with its `classification` and CSV `lines`: `new` (created), `append` (exists; mappings are added) or `unchanged` (exists; every row is already stored or conflicts). `counts`, `appendMappingCount`, `errors` and `warnings` follow. | Step 3. |
| `loaded` | The load ran. Each code has an `outcome`; `counts` totals them. An `error` means a request failed partway. | Report the counts and list every code that is not `added`, `appended` or `unchanged`. With `error`, show its `message` and `httpStatus`. |
| `cancelled` | The user didn't approve the load in the IDE. Nothing was written. | Say so. Don't retry unless the user asks. |
| `not-run` | The IDE could not act. `reason`: `disabled`, `repository-mode`, `no-tenant`, `signed-out` or `no-rdm-service`. | Tell the user why, using `message`. For `signed-out`, offer to try again after they sign in. For `disabled`, the setting is `reltio.enableRdmLookupLoad`. |
| `failed` | Nothing was sent. `error.kind`: `invalid-request`, `invalid-csv`, `unknown-lookup-type`, `api-error`, `untrusted-host` or `network`. | For `invalid-request`, correct the request and retry with a new `requestId`. For `invalid-csv`, list `errors`. For `unknown-lookup-type`, show `message`, which names the lookup type the file resembles. For `api-error`, report `httpStatus` and `message`. Retry `network` once. |
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

1. **Where**: lookup type, tenant and RDM tenant.
2. **Counts**: added, appended to, unchanged, and anything else.
3. **Needs attention**: codes not added, with their CSV lines and the reason.
4. **Next step**: Get Lookup Values to review, or what to fix before loading again.
