## Context

`rdm-lookup-value-authoring` added **Add Value** to the lookup values panel: one or more new codes, typed into a form, sent with `POST {serviceUri}/lookups/{rdmTenantId}`, refused if any code exists (posting a code that exists replaces it), and judged afterwards from the response and a re-fetch. Its pure pieces live in `src/rdm/lookupValueDraft.ts` (`validateLookupValues`, `buildLookupValuesCreateBody`, `codesInCreateResponse`, `reconcileSubmittedCodes`) and the call in `postRdmLookupValues`.

Agents already work in the user's workspace through **bundled skills**: `skills/reltio-default/<name>/SKILL.md`, materialized under `.reltio/reltio-agent/skills/default/` and installed by `syncAgentSkills` at `.claude/skills/<name>/` plus the editor's own folder (`.cursor/skills/` in Cursor). A raised `skillsBundleVersion` is what delivers a new skill to existing workspaces.

An agent never holds the user's Reltio session. The **match verification bridge** (`src/workspace/matchVerification.ts`) is the existing answer: the agent writes `.reltio/reltio-agent/match-verification/request.json`; the extension resolves environment and tenant from a workspace path, never from the request, calls the API with its own session, and writes `result.json`. That bridge is read-only. This change adds the first bridge that **writes** to a tenant, so it adds a human approval step the read-only bridge did not need.

The supplied sample, `MaritalStatuses.csv`:

```csv
Code,Source,Value at Source
Single,Reltio,S
Single,BvD,Unmarried
Single,ReltioCleanser,Never married
…
Unknown,BvD,Not disclosed
Unknown,ReltioCleanser,Not specified
```

## Goals / Non-Goals

**Goals:**

- Load a lookup type's codes and source mappings from a CSV, from an agent conversation, in one approved step.
- Never replace an existing code's mappings.
- The user, not the agent, approves every write, in the IDE.
- Report per code what happened, so a partial outcome is visible and a rerun is safe.

**Non-Goals:**

- **A palette command or tree action.** The user asked for an agent-only experience; the panel's Add Value covers manual entry.
- **Updating or merging existing codes.** Skipped and reported (D8). Changing live mappings deserves its own change.
- **Deleting codes**, localizations, parents or attributes.
- **Other file formats** (Excel, JSON). An agent can convert to CSV first.
- **Creating lookup types.** The lookup type must already exist in the tenant's RDM configuration (Add a new Lookup Type, then Apply RDM Configuration).

## Decisions

### D1: One bundled skill, delivered by the existing sync

The skill lives at `skills/reltio-default/rdm-lookup-values-from-csv/SKILL.md` with frontmatter `name: reltio-rdm-lookup-values-from-csv`. The existing sync installs it for Claude Code and Cursor, and the always-on guides list it, so nothing new is needed for discovery. `skillsBundleVersion` is raised from `22` to `23` (and the pinned version and content hash in `scripts/test-workflow-skills-library.cjs` with it), or existing workspaces never receive it. A contributor pointer goes at `.cursor/skills/reltio-rdm-lookup-values-from-csv/SKILL.md`, as for the other playbooks.

The skill holds the procedure and the protocol; it never states a rule the extension does not enforce. Everything that decides what reaches the tenant — parsing, checks, identity, approval — is in the extension, so a skill that drifts, or an agent that ignores it, cannot widen what is written.

**Alternative considered — the agent calls the RDM API itself:** it would need the user's token in the agent's hands, which every other Reltio skill is built to avoid. Rejected.

### D2: A file bridge, `.reltio/reltio-agent/rdm-lookup-load/`

Mirrors the match verification bridge: a watcher on `request.json` (300 ms debounce, one retry on a partial write, requests handled one at a time), and `result.json` written with the same `requestId`. The folder is under `.reltio/`, which every workspace and tenant `.gitignore` already excludes.

```json
{ "requestId": "<new id per request>", "mode": "plan" | "load",
  "csvFile": "<workspace-relative path to the CSV>",
  "rdmConfigFile": "<workspace-relative path to …/RDM/<rdmTenantId>/config.json>" }
```

Any other field is ignored. One request covers one CSV, so one lookup type; an agent loading several files sends one request per file.

### D3: Identity comes from the workspace, never from the request

- `rdmConfigFile` must resolve inside the workspace to a file named `config.json` whose parent's parent is the tenant's `RDM` folder. `EnvironmentManager.locFromPath` (after a rescan) gives the **environment and tenant**; the parent folder's name gives the **RDM tenant**.
- `csvFile` must resolve inside the workspace and end in `.csv`. Its base name, without the extension, is the **lookup type name**, and it must equal the trailing segment of a `lookupTypes[].uri` in that configuration **exactly**. The lookup type's **URI** is taken from the configuration. When the name matches only ignoring case, the request fails and the message names the lookup type it resembles, so the user can rename the file. Nothing is renamed silently.
- Paths with `..` segments, absolute paths outside the workspace, and symbolic links leaving it are refused.

So a request can only choose files in the user's own workspace. The token reaches only the environment those files belong to, and only the RDM tenant and lookup type that tenant's configuration declares.

### D4: CSV format and what each column sets

- **Parsing** follows RFC 4180: comma separator, `"` quoting with `""` escapes, commas and line breaks inside quoted fields, CRLF or LF. A UTF-8 byte-order mark is dropped and blank lines are ignored. The first line is the header.
- **Columns** are matched by name, ignoring case and surrounding spaces, in any order. Required: `Code`, `Source`, `Value at Source`. Optional: `Code at Source`, `Canonical`, `Downstream Default`. Other columns are ignored and reported as a warning.
- **Grouping.** Rows with the same `Code` form one lookup value, in order of first appearance; its mappings keep row order. Every field is trimmed.
- **Value at Source** sets the mapping's `value` **and** its `code`. RDM transcodes source data by the source's code, so `Single,BvD,Unmarried` makes BvD data sending `Unmarried` transcode to `Single`. A non-empty `Code at Source` sets the code instead.
- **Canonical** and **Downstream Default** accept `true` / `false`, `yes` / `no`, `1` / `0` (any case), or blank. Blank or absent takes the default: canonical on the first row of each code only, downstream default on every row — the same defaults as Add Value.
- Every value and mapping is sent `enabled`, with `startDate` / `endDate` 0, exactly as Add Value does; the body is built by `buildLookupValuesCreateBody`.
- **Limits:** at most 2 MB and 10,000 data rows per file, so a stray large file cannot turn into thousands of requests.

### D5: Errors stop a load; warnings do not

Every finding carries the CSV line number (1 = header).

**Errors** — nothing is sent while any remains: a missing required column; an empty `Code`, `Source` or `Value at Source`; a `Code` containing `/`; the same `Code` and `Source` on two rows; an unreadable boolean; unbalanced quotes; no data rows; a limit exceeded. These are the panel's rules (`validateLookupValues`), reported against CSV lines.

**Warnings** — reported, never blocking: a source that is neither declared in the RDM configuration (by `abbreviation`) nor already used by the lookup type, because the configuration on disk may be out of date and the service is the arbiter; an ignored column; a code with no canonical mapping when the `Canonical` column marks none. How many mappings are canonical is otherwise not constrained, as in Add Value.

### D6: Plan, then load

- **`plan`** is read-only. It parses and checks the CSV, fetches the lookup type's current values, and classifies each code as `new` or `existing`. No dialog is shown and nothing is written.
- **`load`** repeats every step of the plan against a **fresh** fetch — it never trusts an earlier plan — and then asks for approval (D7). A load whose CSV has errors fails without a dialog.

The skill always runs a plan first and shows it to the user, but the extension does not require it: the load's own re-plan is what protects the tenant.

### D7: Every write is approved in the IDE

Before anything is posted, the extension shows a **modal** dialog:

> **Load 6 new codes into MaritalStatuses?**
> Tenant `<tenant>` on `<environment>`, RDM tenant `<rdmTenantId>`, from `<csvFile>`. 0 existing codes will be skipped. 1 warning.
> [**Load**] [Cancel]

Only **Load** proceeds. Cancel, closing the dialog or pressing Escape writes a `cancelled` result. The dialog is the extension's, so the agent cannot answer it, and an agent that writes `load` without asking the user still writes nothing. When there are no new codes, no dialog is shown: the result reports every code as skipped.

**Alternative considered — the agent's chat confirmation only:** the chat is the agent's to render, and an agent can misread "yes" or skip asking. Rejected by the user in favour of the dialog.

### D8: Existing codes are skipped and reported

> **Superseded in Bugfix Round 1 by D12.** The user revised the decision: a CSV appends to existing codes instead of skipping them. Nothing stored is ever replaced or removed.

Posting a code that exists replaces its stored value, mappings included. A load therefore sends **only** codes absent from the fresh fetch (exact match, as everywhere else in RDM authoring). Existing codes are listed as `skipped-existing` with their CSV lines. A rerun of the same file after a partial load sends only what is still missing.

**Alternatives considered:** refusing the whole file when any code exists (Add Value's rule) — impractical for a bulk load that is often re-run; merging new mappings into existing codes — useful, but it edits live values and is left to a later change.

### D9: Posting in chunks, and a result per code

New codes are sent in order, in chunks of at most 100 (`MAX_LOOKUP_VALUES_PER_REQUEST`), one request at a time, with `postRdmLookupValues`. A 401 goes through `tryRefresh` and one retry of that chunk. The first chunk that still fails stops the load: later chunks are not sent.

Then the lookup type is fetched again, and each code gets one outcome:

| Outcome | Meaning |
|---|---|
| `added` | The create response lists it, or the re-fetch contains it (`reconcileSubmittedCodes`) |
| `not-stored` | It was sent, and neither the response nor the re-fetch shows it |
| `not-sent` | A previous chunk failed, so it was never sent |
| `skipped-existing` | It already existed (D8) |
| `unconfirmed` | It was sent, the response does not list it, and the re-fetch failed |

### D10: Result protocol

| `status` | When | Carries |
|---|---|---|
| `planned` | a plan ran | lookup type, RDM tenant, codes with classification and CSV lines, `errors`, `warnings` |
| `loaded` | a load ran (possibly partly) | per-code outcomes (D9), counts, the failed chunk's error if any |
| `cancelled` | the user did not click Load | counts that would have been sent |
| `not-run` | the bridge could not act | `reason`: `disabled`, `repository-mode`, `no-tenant`, `signed-out`, `no-rdm-service` |
| `failed` | the request or the service failed before anything was posted | `error.kind`: `invalid-request`, `invalid-csv` (with `errors`), `unknown-lookup-type`, `api-error` (with `httpStatus`, `responseBody`), `untrusted-host`, `network` |

Every result carries the request's `requestId` (or `null` when it could not be read) and a short `message` the agent can show as is.

### D11: What never leaves the extension

The token is never written to `result.json` or the "Reltio RDM Lookup Load" output channel. The output channel logs each request, the counts and each chunk's outcome. Only the codes and mappings being loaded are sent, and only to the RDM service resolved for that tenant, through `toHttpsBase()`'s allowlist. `result.json` holds codes from the user's own tenant, under the git-ignored `.reltio/`.

### D12: A CSV appends to existing codes; nothing stored is replaced or removed (Bugfix Round 1)

**Observed:** the user expects a CSV to add its mappings to lookup types that already hold values — for example a new source's spellings for existing codes — and never to replace or delete anything. D8 skipped every existing code, so such a file loaded nothing.

**Decision:** a load merges each existing code with the CSV's rows for it, using the same pure merge as Add Value (`rdm-lookup-value-authoring` design D9):

- The fetched value is kept whole, with every field and every stored mapping as fetched.
- A row for a new source, or a new code at an existing source, is appended.
- A row whose source and code at the source are already stored with the same value is **already present**; nothing is added for it.
- A row whose source and code at the source are already stored with a **different** value is a **conflict**. The stored value is kept, and the row is reported as a warning with its line. Unlike the panel, a conflict does not stop the file: a bulk load should not fail on one row, and nothing is overwritten either way.
- An appended value is canonical only when the code has no canonical value yet, and downstream default only when its source has none. Otherwise the flag is dropped, and a warning names the row.

**Plan classification** replaces `new` / `existing`:

| Classification | Meaning |
|---|---|
| `new` | The code is not in the lookup type; it is created |
| `append` | The code exists; at least one row adds a mapping |
| `unchanged` | The code exists; every row is already present or a conflict |

**Outcomes** replace D9's `skipped-existing`:

| Outcome | Meaning |
|---|---|
| `added` | A new code, now stored with all its mappings |
| `appended` | An existing code, now stored with every mapping that was appended |
| `unchanged` | An existing code with nothing to append; not sent |
| `not-stored` | Sent, and neither the response nor the re-fetch shows all its requested mappings |
| `not-sent` | A previous chunk failed |
| `unconfirmed` | Sent, not in the response, and the re-fetch failed |

"Stored" is judged per mapping, as in Add Value: the code is present with every requested source and code at the source.

**Dialog (amends D7):**

> **Load into MaritalStatuses?**
> 3 new codes, and 4 new mappings for 2 existing codes. Tenant `<tenant>` on `<environment>`, RDM tenant `<rdmTenantId>`, from `<csvFile>`. 1 warning.

It is shown whenever anything is new or appended. When every code is `unchanged`, no dialog is shown and nothing is sent.

**Rerun safety still holds.** A second load of the same file finds everything already present and sends nothing.

**Risk — lost update** on an appended code, as in Add Value D9: the merge is taken from a fetch made just before the post, the fetched `version` is sent back, and the window is one request per chunk.

## Risks / Trade-offs

- **[Risk]** An agent sends `load` without showing the plan → **Mitigation**: the modal dialog (D7); the load re-plans itself (D6).
- **[Risk]** A lookup type exists in the configuration file but has not been applied to the tenant → **Mitigation**: the service rejects the post; the error detail is reported. The skill tells the agent to suggest **Apply RDM Configuration** first.
- **[Risk]** A misspelled source creates a mapping no data uses → **Mitigation**: unknown-source warnings in the plan and in the dialog's count.
- **[Risk]** A large file, or a chunk that fails halfway → **Mitigation**: row and size limits; sequential chunks that stop at the first failure; per-code outcomes; reruns skip what landed.
- **[Trade-off]** Value at Source sets the source's code as well as its value (D4). That is what makes transcoding work for this CSV shape; a file where they differ uses `Code at Source`.
- **[Trade-off]** The lookup type comes from the file name only (D3). An exact rule is predictable; the near-miss message makes renaming easy.

## Migration Plan

Additive. Existing workspaces receive the skill through the `skillsBundleVersion` bump on their next sync. The setting defaults to on; turning it off makes every request answer `not-run` / `disabled`. Rollback is a revert plus another bundle bump, which removes the skill from workspaces through the existing ownership rules.

## Open Questions

- Does the RDM service reject a mapping whose source is not declared in the RDM configuration, or store it? (Warnings only either way; QA records it.)
- Does `GET …/lookups/{rdmTenantId}/{lookupType}` return an empty list or an error for a lookup type the tenant does not have yet? (Either way the post then fails with the service's detail.)

## Test plan

| Tier | Script / Method | What it covers |
|------|------------------|-----------------|
| A (automated) | `scripts/test-rdm-lookup-csv-load.cjs` | CSV parsing: quoting, `""`, commas and line breaks in quotes, CRLF, BOM, blank lines, header matching by name in any order and case. Conversion: grouping by code in first-appearance order, Value at Source as code and value, `Code at Source` override, canonical and downstream defaults and overrides, every boolean spelling. Checks: each error and warning in D5, with the right line numbers; limits. Lookup type from the file name: exact match, near-miss message. Classification against a fetched response; chunking at 100; per-code outcomes for every row of the D9 table. The sample `MaritalStatuses.csv` (synthetic) round-trips to the expected lookup values |
| B (automated) | same script, bridge with injected dependencies | Identity from `rdmConfigFile` only (request fields naming a tenant or type ignored); paths outside the workspace refused; `plan` never posts and never shows a dialog; `load` posts only after the injected approval returns Load, and `cancelled` posts nothing; no dialog when nothing is new; existing codes never sent; chunks of ≤ 100 in order, stopping at the first failure; 401 refresh and one retry; `not-run` reasons; `failed` kinds; `requestId` echoed; no token in any result. Bundle: skill present with a valid `name` and `description`, no internal-only references, `skillsBundleVersion` raised, pointer present. Manifest: setting contributed, no command added |
| C (manual QA) | Extension Development Host or installed VSIX, live tenant | Ask the agent to load `MaritalStatuses.csv`: plan shown, dialog names the right tenant and lookup type, codes appear in Get Lookup Values. Rerun: everything skipped, no dialog. Cancel the dialog: nothing written. A file with an error: line-numbered errors, no dialog. A misnamed file: near-miss message. Signed out: `not-run` / `signed-out`. Claude Code and Cursor both discover the skill |
