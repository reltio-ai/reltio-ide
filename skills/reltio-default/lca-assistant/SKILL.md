---
name: reltio-lca-assistant
description: Advise on and generate Reltio Life Cycle Action code using the bundled LCA knowledge base and the connected tenant L3. Scope project decisions to the working directory plus tenant. For tenant-object queries, require connected L3. Cross-check named types (HCP, HCO, HasAddress, …) and attributes against that L3; if missing, STOP and wait for the actual name. Questions do not start implementation. When the type, hook, and attributes already exact-match L3, generate without asking. Check .env and tenant physical configuration instead of asking the user to confirm them. After code is written, ask only whether to deploy. On yes, deploy with the .env credentials. After a successful deploy, update lifecycleActions without another confirmation. Run the workflow step gate and obey allowedActions. Never ask for secret values.
---

# LCA assistant

## When to use

The user asks about **Life Cycle Actions**: hook choice, architecture, config, troubleshooting, LCA vs DVF, or scaffolding an LCA Java/Maven project. For any question about **tenant objects** (entity, relation, or change-request types such as HCP / HCO / HasAddress, attribute names, existing `lifecycleActions`, generate/scaffold an LCA for a named type), the **connected tenant L3** from the Reltio IDE plugin is required as read-only context.

Do not patch L3 until the cloud function deploy succeeds. When the type, hook, and attributes already exact-match L3, generate without a confirmation question. After a successful deploy, apply `lifecycleActions` and then tell the user what changed. Document further steps for verification.

## Workflow phases

Every turn starts with `node scripts/lca-agent.cjs step` (compile first). Pass `workingDirectory`, `tenantId` when known, the user text, and `claimed` facts the user actually stated. Obey `allowedActions`. If an action is absent, do not do it. Do not call `gate` to override that result. If `writeFiles` is false, do not create or edit files. Use `facts` from that result for the type, hook, attributes, cloud, and `projectDirectory`; do not substitute names it did not return. When `projectDirectory` is present, that directory is where this LCA's files belong.

| Phase | When | This turn may | This turn must not |
|---|---|---|---|
| `ASK` | Questions about hooks, connectivity, configuration, syntax, or whether an LCA is appropriate | Answer from the KB | Generate, deploy, edit L3, or treat the question as a build request |
| `REQUIREMENT_GATHERING` | The user asked to build or update an LCA and the type, hook, or attributes are missing or not an exact L3 match | Ask only for the missing fact | Guess names, write source, deploy, or edit L3 |
| `GENERATE` | The type, hook, and attributes are already known | Write the Maven project under `projectDirectory` (`<tenant>/LifeCycle Actions/<type>-<hook>-<name>-lca`), then ask whether to deploy | Deploy, claim tests passed, edit L3, or write outside that directory |
| `DEPLOY_PENDING_APPROVAL` | Code exists and deploy has not been accepted | Ask once whether to deploy. If `.env` is missing details, name the missing keys instead | Deploy, or ask the user to confirm credentials that are already in `.env` |
| `DEPLOY` | The user said yes to deploy and `.env` has the cloud access details | Deploy with those credentials. If the tool fails, show the error and the next action. If it succeeds, update L3 | Claim success unless the tool result says so, or update L3 after a failed deploy |
| `TEST` | The user wants invocation or troubleshooting | Give a sample request, expected result, and log checks | Claim the test passed unless a tool result says so |
| `L3_PREVIEW` | A direct registration was requested and physical configuration is still missing | Show the console fields to add | Apply L3, or ask whether connectivity is already configured |
| `L3_PENDING_APPROVAL` | An older session was left on this phase | Re-check physical configuration. If the details exist, apply L3 | Ask for another yes when the details are already present |
| `L3_UPDATE` | Deploy succeeded, or a direct registration has physical configuration already | Apply the `lifecycleActions` change, then say what was registered | Invent a different patch, or ask for confirmation first |
| `COMPLETE` | The L3 change was applied | Summarize what was registered. Mention physical configuration only when its cloud access details are missing | Start a new deploy or L3 edit |

Rules:

- A mention of LCA is not a request to build one. Questions stay in `ASK`.
- Missing or ambiguous type, hook, or attributes: ask. Never invent tenant, hook, attribute, API, or cloud-account details. An omitted cloud **provider** is AWS Lambda and must be visible in the design before code is written. Do not invent regions, account ids, function ARNs, or credentials.
- Generation is not execution. Writing files is not deploying and not an L3 edit.
- A new generate or update request checks L3 again. If the type, hook, and attributes are already an exact match, generate. Ask only for what is missing.
- Approval is a direct yes to the pending deploy question. "Yes, but…", a question, or a change of target is not approval.
- Deploy only after an explicit yes. Before deploying, read `.env`. If the file exists and the cloud access details are filled in, do not ask the user to confirm them. If the file or a required key is missing, name the missing keys and stop. Do not deploy, and do not paste or repeat secret values.
- If `step` returns `deploy` and `updateL3` together, run deploy first. Apply `updateL3` only when the deploy tool succeeds. On failure, show `deployFailureGuidance`: the redacted error and one next action (refresh expired credentials, replace rejected credentials, grant the missing permission, or create the missing function). Do not update L3 after a failed deploy.
- After a successful deploy, apply `lifecycleActions` immediately. Then tell the user the tenant, object type, hook, and action value that was added. Preserve existing actions and order, skip duplicates, and reject invalid hooks. Do not ask for permission to write L3.
- Check the tenant physical configuration for this cloud's access details. If they are present, do not mention the check and do not ask the user to confirm connectivity. If they are missing, include `consoleUpdate` in the summary: the Reltio Console fields to set. That is not a question.
- If `step` says a type or attribute is not an exact L3 match, the entire reply is that clarification. Do not pick a similar type.
- Do not ask a second question in the same turn. One missing fact, the deploy yes/no, or the console steps — whichever single gap is actually blocking. A new question leaves the pending deploy; do not resume it until the user asks again. A question does not clear a pending object or design confirmation: after the answer, a later yes still applies to that confirmation.
- Never request a secret key, password, access token, API secret, private key, client secret, or credential value. Ask for an environment variable name, a property name, or the name of an already configured credential reference. If a secret is pasted, do not repeat it, store it, log it, or put it in code.
- `context-save` cannot set phase or approvals. Only `step` can.

## Partner invoke (no `.cursor` stub in partner workspaces)

After Reltio IDE activates (or **Reltio: Resync agent assets (skills, Velocity Packs & LCA knowledge base)**), the skill is installed where agents find it:

- `.claude/skills/reltio-lca-assistant/SKILL.md`
- `.cursor/skills/reltio-lca-assistant/SKILL.md` in Cursor, or `.github/skills/reltio-lca-assistant/SKILL.md` in VS Code

The same playbook is also at `.reltio/reltio-agent/skills/default/lca-assistant/SKILL.md`. Knowledge base: `.reltio/reltio-agent/lca-knowledge-base/` (start at `manifest.json` or `00_INDEX_RAG_RETRIEVAL_MAP.md`).

Optional team override: `skills/workspace/lca-assistant/SKILL.md`. A contributor checkout of this repository keeps a thin pointer under `.cursor/skills/`; that pointer is not what a partner workspace receives.

**Sample prompts**

1. What does the `beforeSave` hook do, and when should I use it?
2. Using our connected tenant L3, generate a `beforeSave` LCA for entity type \<Name\> for enrichment — use real attribute URIs only. If the type and attributes match L3, write the code and ask only whether to deploy. Do not patch L3 until the deploy succeeds.
3. Scaffold a Maven LCA project for that action into folder \<path\> (confirm before writing).
4. Generate an LCA for entity type `CourseTopics` (or `HCP` / relation `HasAddress`). If that name is not an exact L3 match, **stop**, suggest close types, and wait for me to confirm the actual name before writing any LCA.

## Inputs

1. **Connected tenant L3** (read-only). Required for tenant-object queries. This is the configuration fetched by the Reltio IDE plugin (Add Tenant / Get Configuration), not a sample or Velocity Pack.

   | Workspace | File |
   |---|---|
   | Connected tenant | `<environment>/<tenantId>/Business Config/BusinessConfig.json` (tenant id is in `.reltio-config-source.json`, `kind: "tenant"`) |
   | Tenant not yet migrated | `…/<tenantId>.reltio.tenant/L3.reltio.json` |
   | Opened with Connect your Repository | The `BusinessConfig.json` or `L3.reltio.json` named by `.reltio-config-source.json` |
2. Materialized KB: **`.reltio/reltio-agent/lca-knowledge-base/`** (routing via `manifest.json` / `00_INDEX…`).
3. Optional: existing LCA Java/Maven project in the workspace.

## Dual-workspace branching

| Context | Behavior |
|---------|----------|
| Tenant L3 connected (`Business Config/BusinessConfig.json`, or legacy `*.reltio.tenant/**/L3.reltio.json`) | **L3-first**: inventory types/attributes; resolve names against L3. If a named tenant/type/attribute is **not an exact match**, **stop this turn**: suggest close L3 names, wait for the user to **confirm the actual name**, then continue. Never silently use a similar type. Do not patch L3 until the cloud function deploy succeeds. |
| Plugin not connected to any tenant (no tenant folder and no fetched L3) **and** the query is about tenant objects | **Stop.** Ask the user to connect a tenant in the Reltio IDE plugin (see Tenant L3 gate). Do not invent type or attribute URIs. Do not substitute Velocity Packs or sample JSON for this tenant. |
| Generic LCA knowledge only (hooks, architecture, LCA vs DVF, ops) | Answer from the KB. L3 is optional. |
| Java/Maven only (project present, tenant L3 connected) | Ground in L3. Write the Maven project under `<tenant folder>/LifeCycle Actions/<type>-<hook>-<name>-lca`. Confirm target folder before writing anywhere else. Do not patch L3 until the cloud function deploy succeeds. |

## Tenant L3 gate

A query is **tenant-object related** when it names or depends on tenant metadata: an entity/relation/DCR type (e.g. HCP, HCO, HasAddress), attribute names from any object type, existing `lifecycleActions`, “our tenant”, generating or scaffolding an LCA for a type, or troubleshooting a hook on a type.

Before answering those queries:

1. **Detect connection** — Search the workspace for a connected configuration. Current layout: `<environment>/<tenantId>/Business Config/BusinessConfig.json`, with the tenant id in that folder's `.reltio-config-source.json` (`kind: "tenant"`) and the environment host in `.reltio-environment.json`. Not yet migrated: `L3.reltio.json` inside `*.reltio.tenant/` (including `.reltio/*.reltio.environment/`). Git repository: a `BusinessConfig.json` or `L3.reltio.json` named by `.reltio-config-source.json` `l3RelativePath`. Ignore `samples/`, Velocity Packs, and other non-tenant JSON as a substitute for a connected tenant.
2. **No environment / not signed in** — **Stop.** Ask the user to connect via **Reltio: Launch Setup Wizard** (`reltio.launchSetupWizard`) or **Sign in to Reltio** (`reltio.signInToFirstEnvironment`).
3. **No tenant added** — **Stop.** Ask the user to **Add Tenant** (`reltio.addTenant`) in the Reltio explorer. Adding a tenant fetches L3 automatically.
4. **Tenant present, L3 missing** — **Stop.** Ask the user to **Get Configuration** (`reltio.fetchL3`) on that tenant, then continue once `Business Config/BusinessConfig.json` (or legacy `L3.reltio.json`) exists.
5. **Multiple tenants with L3** — Use the active/open configuration file. If none is open, ask which tenant to use before generating code.
6. **Connected** — Proceed L3-first (read-only). Resolve every named tenant object against this L3 (see Resolve named L3 objects). Never invent L3 names.

Do not continue a tenant-object answer with guessed URIs or pack excerpts as a substitute for connecting the plugin.

## Resolve named L3 objects

After the tenant L3 gate succeeds, match names the user gave against the connected configuration **before** proposing hooks or generating code.

**Exact match only** (case-insensitive): `label` equals the user token, or the URI local name equals it (`configuration/entityTypes/HCP` matches `HCP`, not `HCPLocation`). Prefix, substring, or “sounds like” is **not** a match.

| User named… | Look up in L3 | If missing, ambiguous, or not exact |
|-------------|---------------|-------------------------------------|
| Tenant id / environment | Tenant identity marker (or legacy `*.reltio.tenant/` folder) and the open L3 | Ask which tenant to use; list connected tenant ids. |
| Entity type (e.g. `HCP`, `HCO`) | `entityTypes[]` `uri` / `label` | **Hard stop.** Ask the user to confirm the actual name; list suggestions + available **uri + label**. |
| Relation type (e.g. `HasAddress`, `HasAAddress`) | `relationTypes[]` `uri` / `label` | **Hard stop.** Same as entity type. |
| Change-request / DCR type | `changeRequestTypes[]` (or equivalent) `uri` / `label` | **Hard stop.** Same as entity type. |
| Attribute (or nested path) on any object type | Attributes on the **already confirmed** type (`uri` / `name` / `label`) | **Hard stop.** Ask for the correct attribute; list attributes on that type. If the type is not confirmed yet, list types first. |

### Hard stop — wait for confirmation (same turn)

When lookup fails, the **entire reply** is the clarification. Do **not** generate LCA source, Maven files, `lifecycleActions` snippets, or “I’ll use \<similar type\>” in that turn.

1. State that the named value is **not in this tenant L3**.
2. Suggest close L3 names (substring / shared prefix, e.g. user said `CourseTopics`, L3 has `Course`; user said `HasAAddress`, L3 has `HasAddress`) as **options to confirm**, ranked first. Then list other types (cap **25**, then `…and N more`).
3. Ask: **Which actual name should I use?** Wait for the user to type or pick one that exists in this L3.
4. Only **after** that confirmation, continue (code-generation confirmation, then code).

**Forbidden (this is the failure we must not repeat)**

- Auto-selecting a similar type: *“CourseTopics is not in L3—only Course is. I’ll use Course.”*
- Using a workspace type spec, design doc, Velocity Pack, sample JSON, or “official AWS/GCP templates” as a stand-in for the missing type.
- Generating an LCA for `Course` when the user asked for `CourseTopics` (or any other near-miss) without an explicit “yes, use Course” (or the exact L3 uri/label) in a later message.

If the user omitted a required name (e.g. “generate a beforeSave LCA” with no type), ask them to enter the type and show available types from this L3 — still no code until they pick.

## Code-generation confirmation

This gate applies **only** when the user asks to **generate or update LCA code** (new class, edit existing LCA Java, or opt-in Maven scaffold). Conceptual answers (what a hook does, LCA vs DVF, troubleshooting without code) skip this step.

If the object type, hook, and attributes already exact-match the connected L3, do not ask. Print the design as information and write the Java in that turn. The design includes:

| Shown | Value (from connected L3 only) |
|---------|--------------------------------|
| **Object type** | Entity type **or** relation type (or DCR type): `label` + `uri` |
| **Attributes to read** | Name + URI the LCA will read |
| **Attributes to add/update** | Name + URI the LCA will set, add, or change. Use `none` if read-only. |

The design also includes working directory (`projectDirectory`), tenant, hook, **Language: Java**, cloud, behavior, `com.reltio.lca…` package, cloud function, and expected registration. After the files are written, ask only whether to deploy.

Ask before writing code only when a required name is missing or not an exact L3 match. Near-miss confirmation and generation are different: missing name → pick the real type; known names → write the code.

## Procedure

1. **Classify intent** — Run `node scripts/lca-agent.cjs step` and follow `allowedActions`. Read `manifest.json` `retrieval_routing` (or `00_INDEX…`). Retrieve the **minimum** doc set only; prefer section chunks. A question does not start implementation.
2. **Tenant L3 gate** — If the query is tenant-object related, apply the gate above before any type/attribute inventory or code generation. If L3 is not available, **stop** and ask to connect; do not invent metadata.
3. **Resolve named L3 objects** — Exact-match tenant / entity type / relation type / DCR type / attribute names against the connected L3. If a name is missing or only a near-miss (e.g. `CourseTopics` vs `Course`, `HasAAddress` vs `HasAddress`), **stop this turn**: suggest L3 options, wait for the user to **confirm the actual name**. Do not generate LCA code until they confirm.
4. **LCA vs DVF** — Resolve via KB-03 internally. Narrate the comparison only if the user asks or the choice is borderline. Answer in one context (LCA-only or DVF-only) otherwise.
5. **Clarify remaining inputs** — Trigger and crosswalk when relevant, only after type and attributes resolve in L3. If the user did not name a hook, ask. Do not infer one from an earlier question. If cloud is omitted, default to AWS Lambda (`LifeCycleActionHandler`) and show that default in the design. Honor an explicit AWS, GCP (`LifeCycleGoogleFunction`), Azure (`LifeCycleAzureFunction`), or Native (`LifeCycleActionBase`) request. Do not stop requirement collection only to ask for a cloud provider. Do not invent regions, accounts, or credentials.
6. **Propose** — When the hook is known, use the action name format (`MyAction`, `Reltio/…`, `Lambda/BinaryJSON/<function-name>`, `googlefunction/BinaryJSON/…`, Azure HTTPS URL). Do not write `lifecycleActions` into L3 before the deploy succeeds. AWS registration uses the deployed function name, never the Java class name.
7. **Code-generation confirmation** — If the object type and the attributes to **read** and to **add/update** are already an exact L3 match, do not ask. Ask only for a missing type, hook, or attribute.
8. **Print the design with the code** — The design must include Language: Java and the selected cloud (AWS Lambda when the user did not name one). Do not wait for a second approval before writing source.
9. **Generate or update code** — When `allowedActions` includes `generate`. The tenant folder already has `LifeCycle Actions/README.md`, created with the same tree as `RDM` and `Workflows`. Write one Maven project under that folder, at `projectDirectory` from `step`: `<tenant folder>/LifeCycle Actions/<type>-<hook>-<name>-lca/` (source, tests, fixtures, Maven, `.env.example` with placeholders, README). `<name>` is the action name, the same name used for the cloud function. When that name is not known yet, the folder is `<type>-<hook>-lca`. Do not create a folder named `LCA`. Do not replace `LifeCycle Actions/README.md`. The same type, hook, and name reuse that project. A different hook or a different name is a different project. Confirm target folder only when the user asks for a different folder; writing outside `LifeCycle Actions` is **opt-in**. Follow KB-02 patterns and KB-06 Maven templates. Do not overwrite unrelated repos or another project's directory. On later turns for this LCA, pass `projectDirectory` as `workingDirectory`. State that **compile may require** access to Reltio Maven repos (`repo-dev.reltio.com`). Never embed secrets/tokens/PII (KB-04). Refuse Python, TypeScript, JavaScript, Kotlin, Groovy, and C# for the LCA class. Do not deploy or patch L3 in this turn. End by asking whether to deploy.
10. **Deploy, then L3** — Ask once: `Would you like me to deploy this version to <cloud>?`. On yes, read `.env` for that cloud (`AWS_REGION` plus `AWS_PROFILE` or `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`; GCP project and region; Azure function app and resource group). Placeholder values such as `your-profile` count as missing. A temporary AWS access key also needs `AWS_SESSION_TOKEN`. If the details are present, deploy with them and do not ask the user to confirm the file. If deploy fails, give the error and the next action (expired credentials, rejected credentials, missing permission, or missing function) and stop. If deploy succeeds, apply `lifecycleActions`, reload L3, and refresh the Tree View. Tree View is read-only: one `lifecycleActions` leaf, no hook children, no add/edit/delete from the tree. Then say what was registered. Check physical configuration (`physical.json` or `physicalConfig.json` under the tenant folder). AWS needs account id, role ARN, region, and external id. GCP needs project id and service account email. Azure needs Entra ids or an https token URL plus client id. If those details are present, do not mention them. If they are missing, add the console steps to the summary and do not ask a yes/no. Direct registration of an already deployed action skips Java generation and applies L3 when the physical details exist. Validation-only rules prefer DVF and do not generate Java.
11. **User-facing answers** — Do not expose internal `KB-LCA-##` / file/line refs unless the user asks for sources. You may cite `docs.reltio.com` via KB-05. Surface known ambiguities (KB-01 §7) instead of guessing.

## Outputs

- Short plan: hook, action name, target L3 type URI, attributes touched, Java package `com.reltio.lca.<customer-or-tenant>.<type>`.
- LCA Maven project at `<tenant folder>/LifeCycle Actions/<type>-<hook>-<name>-lca/` (`projectDirectory`). Do not patch L3 until the cloud function deploy succeeds.
- Further-steps documentation: the deploy question, and after success the `lifecycleActions` registration that was applied. Refresh Tree View. Include console steps only when physical configuration is missing.
- If the plugin is not connected to a tenant and the query needs tenant objects: a connect request (setup wizard / add tenant / fetch L3) instead of invented metadata.
- If a named tenant, type, or attribute is not an exact L3 match: a **confirmation-only** reply (suggestions + available L3 names). No LCA code until the user confirms the actual name.
- If generating or updating LCA code and the names already match: the design, the Java, and one deploy question. No extra confirmation.

## Java LCA rules

Generated LCA classes are Java on the selected cloud base class. Null-check `getAttributeValues()`. Use `isOv()` for authoritative values. `validate` returns `data`, never `null`, and uses `ValidationError` factories. Log with `reltioAPI.logInfo()`, `logWarning()`, and `logError()`. Guard `afterSave` write-back against re-entrancy. Never hardcode credentials. Package is `com.reltio.lca.<customer>.<type>`, or the tenant id when the customer name is unknown. Never `com.example.lca`.

## README

When generating a project, the README covers business purpose, working directory, tenant, object type, hook, Java, attributes read and added/updated, package, build, tests, `.env.example` placeholders, manual deploy, `reltio-ide` deploy, physical configuration, `lifecycleActions` registration, verification, logs, and rollback. Do not tell the reader to confirm credentials that are already in `.env`.

## Active context

The boundary for project state is `workingDirectory::tenantId`. After code is written, that directory is `projectDirectory` (`<tenant folder>/LifeCycle Actions/<type>-<hook>-<name>-lca`). Do not reuse customer, type, attributes, hooks, package, function name, deployment, connectivity, or approvals from another directory. Same directory with a different tenant reloads L3 and drops tenant-scoped decisions. Same directory and tenant may reuse known context. A new code change still resolves names against L3, and it asks only when a name is missing. Global default: omitted cloud is AWS.

Package: `com.reltio.lca.<customerName>.<type>`, else `com.reltio.lca.<tenantId>.<type>`. Normalize segments to lowercase Java identifiers. Never use `com.example.lca`.

Validation-only rules prefer DVF. Do not generate Java for a rule that only checks a value.

Use `node scripts/lca-agent.cjs env`, `physical`, and `deploy-error` for tenant connection, hook validity, package names, `.env` keys, physical configuration, and `lifecycleActions` diffs, instead of chat memory. They never print secret values.
