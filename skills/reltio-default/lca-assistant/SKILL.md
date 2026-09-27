---
name: reltio-lca-assistant
description: Advise on and generate Reltio Life Cycle Action code using the bundled LCA knowledge base and the connected tenant L3. Scope project decisions to the working directory plus tenant. For tenant-object queries, require connected L3. Cross-check named types (HCP, HCO, HasAddress, …) and attributes against that L3; if missing, STOP and wait for the actual name. Questions do not start implementation. Before generating or updating LCA code, confirm object type and attributes, print the design, then wait for approval. Deploy and patch lifecycleActions only after separate later confirmations. Run the workflow step gate and obey allowedActions. Never ask for secret values.
---

# LCA assistant

Normative product context: `openspec/changes/lca-assistant/design.md` (D2, D5, D6). Tracking: RP-191824.

## When to use

The user asks about **Life Cycle Actions**: hook choice, architecture, config, troubleshooting, LCA vs DVF, or scaffolding an LCA Java/Maven project. For any question about **tenant objects** (entity, relation, or change-request types such as HCP / HCO / HasAddress, attribute names, existing `lifecycleActions`, generate/scaffold an LCA for a named type), the **connected tenant L3** from the Reltio IDE plugin is required as read-only context.

Do not patch L3 until the user confirms the proposed `lifecycleActions` change. Generate LCA code only after object, attribute, and design confirmation. Document further steps for deploy, connectivity, and verification.

## Workflow phases

Every turn starts with `node scripts/lca-agent.cjs step` (compile first). Pass `workingDirectory`, `tenantId` when known, the user text, and `claimed` facts the user actually stated. Obey `allowedActions`. If an action is absent, do not do it. If `writeFiles` is false, do not create or edit files. Use `facts` from that result for the type, hook, attributes, and cloud; do not substitute names it did not return.

| Phase | When | This turn may | This turn must not |
|---|---|---|---|
| `ASK` | Questions about hooks, connectivity, configuration, syntax, or whether an LCA is appropriate | Answer from the KB | Generate, deploy, edit L3, or treat the question as a build request |
| `REQUIREMENT_GATHERING` | The user asked to build or update an LCA and type, hook, or attributes are missing or unconfirmed | Ask the questions in `questions`, then show object/attribute confirmation and the design | Guess names, write source, deploy, or edit L3 |
| `GENERATE` | Design was approved on an earlier turn | Write Java, tests, Maven, sample payloads, and docs | Deploy, claim tests passed, or edit L3 |
| `DEPLOY_PENDING_APPROVAL` | The user asked to deploy | Show target, configuration, and impact, then ask for approval | Deploy |
| `DEPLOY` | A later message explicitly approved the preview | Run the deploy tool | Claim success unless the tool result says so |
| `TEST` | The user wants invocation or troubleshooting | Give a sample request, expected result, and log checks | Claim the test passed unless a tool result says so |
| `L3_PREVIEW` | The user asked to link or change `lifecycleActions` | Show the current config, the diff, and the impact | Apply it |
| `L3_PENDING_APPROVAL` | The preview was shown and saved | Wait for an explicit yes | Apply it |
| `L3_UPDATE` | A later message approved that preview | Apply only the previewed change | Invent a different patch |
| `COMPLETE` | The approved L3 change was applied | Summarize the tool result | Start a new deploy or L3 edit |

Rules:

- A mention of LCA is not a request to build one. Questions stay in `ASK`.
- Missing or ambiguous type, hook, or attributes: ask. Never invent tenant, hook, attribute, API, or cloud-account details. An omitted cloud **provider** is AWS Lambda and must be visible in the design before code is written. Do not invent regions, account ids, function ARNs, or credentials.
- Generation is not execution. Writing files is not deploying and not an L3 edit.
- A new generate or update request repeats object, attribute, and design confirmation, even when an earlier design was approved. Do not reuse that approval.
- Approval is a direct yes to the pending question. "Yes, but…", a question, or a request to deploy or edit L3 is not approval of the design.
- Deployment requires a later explicit approval. L3 changes require connectivity confirmed on an earlier turn, a preview, and an explicit approval on a later turn. `step` will not return `updateL3` before that.
- If `step` says a type or attribute is not an exact L3 match, the entire reply is that clarification. Do not pick a similar type.
- Do not skip a phase. A new question leaves the pending deploy or L3 approval; do not resume it until the user asks again. A question does not clear a pending object or design confirmation: after the answer, a later yes still applies to that confirmation.
- Never request a secret key, password, access token, API secret, private key, client secret, or credential value. Ask for an environment variable name, a property name, or the name of an already configured credential reference. If a secret is pasted, do not repeat it, store it, log it, or put it in code.
- `context-save` cannot set phase or approvals. Only `step` can.

## Partner invoke (no `.cursor` stub in partner workspaces)

After Reltio IDE activates (or **Resync agent assets**), assets live under the workspace:

- Skill: `.reltio/reltio-agent/skills/default/lca-assistant/SKILL.md`
- Knowledge base: `.reltio/reltio-agent/lca-knowledge-base/` (start at `manifest.json` or `00_INDEX_RAG_RETRIEVAL_MAP.md`)

Ask Cursor to follow this playbook, or `@`-reference those paths. Optional team override: `skills/workspace/lca-assistant/SKILL.md`.

**Sample prompts**

1. What does the `beforeSave` hook do, and when should I use it?
2. Using our connected tenant L3, generate a `beforeSave` LCA for entity type \<Name\> for enrichment — use real attribute URIs only. Confirm the type and attributes with me before writing code. Do not edit L3; include further-steps docs and the suggested `lifecycleActions` JSON.
3. Scaffold a Maven LCA project for that action into folder \<path\> (confirm before writing).
4. Generate an LCA for entity type `CourseTopics` (or `HCP` / relation `HasAddress`). If that name is not an exact L3 match, **stop**, suggest close types, and wait for me to confirm the actual name before writing any LCA.

## Inputs

1. **Connected tenant L3** — `L3.reltio.json` under a `*.reltio.tenant/` directory (read-only). Required for tenant-object queries. This is the L3 fetched by the Reltio IDE plugin (Add Tenant / Get Configuration), not a sample or Velocity Pack.
2. Materialized KB: **`.reltio/reltio-agent/lca-knowledge-base/`** (routing via `manifest.json` / `00_INDEX…`).
3. Optional: existing LCA Java/Maven project in the workspace.

## Dual-workspace branching

| Context | Behavior |
|---------|----------|
| Tenant L3 connected (`*.reltio.tenant/**/L3.reltio.json`) | **L3-first**: inventory types/attributes; resolve names against L3. If a named tenant/type/attribute is **not an exact match**, **stop this turn**: suggest close L3 names, wait for the user to **confirm the actual name**, then continue. Never silently use a similar type. Do not patch L3 until the user confirms the `lifecycleActions` diff. |
| Plugin not connected to any tenant (no `*.reltio.tenant/` or no fetched L3) **and** the query is about tenant objects | **Stop.** Ask the user to connect a tenant in the Reltio IDE plugin (see Tenant L3 gate). Do not invent type or attribute URIs. Do not substitute Velocity Packs or sample JSON for this tenant. |
| Generic LCA knowledge only (hooks, architecture, LCA vs DVF, ops) | Answer from the KB. L3 is optional. |
| Java/Maven only (project present, tenant L3 connected) | Ground in L3. Write Java only in the current working directory. A different folder is opt-in: confirm target folder before writing elsewhere. Do not patch L3 until the L3 confirmation gate. |

## Tenant L3 gate

A query is **tenant-object related** when it names or depends on tenant metadata: an entity/relation/DCR type (e.g. HCP, HCO, HasAddress), attribute names from any object type, existing `lifecycleActions`, “our tenant”, generating or scaffolding an LCA for a type, or troubleshooting a hook on a type.

Before answering those queries:

1. **Detect connection** — Search the workspace for `*.reltio.environment/` (including `.reltio/*.reltio.environment/`) and `*.reltio.tenant/`. Prefer `L3.reltio.json` inside a tenant folder. Also accept a git-connected tenant recorded in `.reltio-config-source.json` whose `l3RelativePath` is `BusinessConfig.json` or `L3.reltio.json`. Ignore `samples/`, Velocity Packs, and other non-tenant JSON as a substitute for a connected tenant.
2. **No environment / not signed in** — **Stop.** Ask the user to connect via **Reltio: Launch Setup Wizard** (`reltio.launchSetupWizard`) or **Sign in to Reltio** (`reltio.signInToFirstEnvironment`).
3. **No tenant added** — **Stop.** Ask the user to **Add Tenant** (`reltio.addTenant`) in the Reltio explorer. Adding a tenant fetches L3 automatically.
4. **Tenant present, L3 missing** — **Stop.** Ask the user to **Get Configuration** (`reltio.fetchL3`) on that tenant, then continue once `L3.reltio.json` exists.
5. **Multiple tenants with L3** — Use the active/open `L3.reltio.json`. If none is open, ask which tenant to use before generating code.
6. **Connected** — Proceed L3-first (read-only). Resolve every named tenant object against this L3 (see Resolve named L3 objects). Never invent L3 names.

Do not continue a tenant-object answer with guessed URIs or pack excerpts as a substitute for connecting the plugin.

## Resolve named L3 objects

After the tenant L3 gate succeeds, match names the user gave against the connected `L3.reltio.json` **before** proposing hooks or generating code.

**Exact match only** (case-insensitive): `label` equals the user token, or the URI local name equals it (`configuration/entityTypes/HCP` matches `HCP`, not `HCPLocation`). Prefix, substring, or “sounds like” is **not** a match.

| User named… | Look up in L3 | If missing, ambiguous, or not exact |
|-------------|---------------|-------------------------------------|
| Tenant id / environment | Folder `*.reltio.tenant/` (and the open L3) | Ask which tenant to use; list connected tenant ids. |
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

After names resolve to exact L3 objects, and **before writing or changing any LCA source**, send a confirmation and **wait**. That reply must not include generated Java/XML.

Show:

| Confirm | Value (from connected L3 only) |
|---------|--------------------------------|
| **Object type** | Entity type **or** relation type (or DCR type): `label` + `uri` |
| **Attributes to read** | Name + URI the LCA will read |
| **Attributes to add/update** | Name + URI the LCA will set, add, or change. Use `none` if read-only. |

Ask, and wait:

```text
Please confirm that the object type and attributes above are correct.

Should I use these values for the LCA implementation?
```

Only after that yes, print the full **LCA Implementation Design** (working directory, tenant, object, hook, **Language: Java**, cloud, attributes, behavior, `com.reltio.lca…` package, cloud function, expected registration). Then ask, and wait:

```text
Please review the design above.

Should I proceed with Java LCA code generation?
```

Do not ask for design approval before that design is in the reply. Proceed with Java generation **only after** an explicit yes to the design (or a corrected list that still exact-matches L3). If the user changes a name, re-run Resolve named L3 objects, show the object and attributes again, then the design again.

Do not skip this because the type already exact-matched. Near-miss confirmation and this generation confirmation are different: missing name → pick the real type; code gen → confirm type + read/write attributes.

## Procedure

1. **Classify intent** — Run `node scripts/lca-agent.cjs step` and follow `allowedActions`. Read `manifest.json` `retrieval_routing` (or `00_INDEX…`). Retrieve the **minimum** doc set only; prefer section chunks. A question does not start implementation.
2. **Tenant L3 gate** — If the query is tenant-object related, apply the gate above before any type/attribute inventory or code generation. If L3 is not available, **stop** and ask to connect; do not invent metadata.
3. **Resolve named L3 objects** — Exact-match tenant / entity type / relation type / DCR type / attribute names against the connected L3. If a name is missing or only a near-miss (e.g. `CourseTopics` vs `Course`, `HasAAddress` vs `HasAddress`), **stop this turn**: suggest L3 options, wait for the user to **confirm the actual name**. Do not generate LCA code until they confirm.
4. **LCA vs DVF** — Resolve via KB-03 internally. Narrate the comparison only if the user asks or the choice is borderline. Answer in one context (LCA-only or DVF-only) otherwise.
5. **Clarify remaining inputs** — Trigger and crosswalk when relevant, only after type and attributes resolve in L3. If the user did not name a hook, ask. Do not infer one from an earlier question. If cloud is omitted, default to AWS Lambda (`LifeCycleActionHandler`) and show that default in the design. Honor an explicit AWS, GCP (`LifeCycleGoogleFunction`), Azure (`LifeCycleAzureFunction`), or Native (`LifeCycleActionBase`) request. Do not stop requirement collection only to ask for a cloud provider. Do not invent regions, accounts, or credentials.
6. **Propose** — After the user names the hook, show the action name format (`MyAction`, `Reltio/…`, `Lambda/BinaryJSON/<function-name>`, `googlefunction/BinaryJSON/…`, Azure HTTPS URL). Do not write `lifecycleActions` into L3 before the L3 confirmation gate. AWS registration uses the deployed function name, never the Java class name.
7. **Code-generation confirmation** — If generating or updating LCA code, show object type name (entity or relation) plus attributes to **read** and attributes to **add/update**. Wait for explicit confirmation. Do not write source in that turn.
8. **Print the design, then wait** — Only after object and attribute confirmation. The design must include Language: Java and the selected cloud (AWS Lambda when the user did not name one). Ask whether to proceed with Java LCA code generation. Do not write source in that turn.
9. **Generate or update code** — Only after design approval, and only when `allowedActions` includes `generate`. Write Java in the current working directory (source, tests, fixtures, Maven, `.env.example` with placeholders, README). Confirm target folder only when the user asks for a different folder; that Maven scaffold is **opt-in**. Follow KB-02 patterns and KB-06 Maven templates. Do not overwrite unrelated repos. State that **compile may require** access to Reltio Maven repos (`repo-dev.reltio.com`). Never embed secrets/tokens/PII (KB-04). Refuse Python, TypeScript, JavaScript, Kotlin, Groovy, and C# for the LCA class. Do not deploy, patch L3, or claim that tests passed in this turn.
10. **Further steps, one gate at a time** — After tests pass, ask before deploy (`Would you like me to deploy this version to <cloud>?`). Do not deploy on generation success. Then verify Reltio-to-cloud connectivity for this tenant (reuse it only when it is already confirmed for this directory and tenant). Then show the current and proposed `lifecycleActions`, preserve existing actions and order, skip duplicates, and reject invalid hooks. Do not patch L3 until the user confirms. Apply only after an explicit yes, reload L3, and refresh the Tree View. Tree View is read-only: one `lifecycleActions` leaf, no hook children, no add/edit/delete from the tree. A new code change, including a new hook, repeats object, design, deploy, and L3 confirmations. Direct registration of an already deployed action skips Java generation. Validation-only rules prefer DVF and do not generate Java.
11. **User-facing answers** — Do not expose internal `KB-LCA-##` / file/line refs unless the user asks for sources. You may cite `docs.reltio.com` via KB-05. Surface known ambiguities (KB-01 §7) instead of guessing.

## Outputs

- Short plan: hook, action name, target L3 type URI, attributes touched, Java package `com.reltio.lca.<customer-or-tenant>.<type>`.
- LCA source and/or agreed Maven scaffold in the current working directory. Do not patch L3 until the user confirms.
- Further-steps documentation: deploy prompt, connectivity for this tenant, and the `lifecycleActions` diff. Apply the diff only after confirmation, then refresh Tree View.
- If the plugin is not connected to a tenant and the query needs tenant objects: a connect request (setup wizard / add tenant / fetch L3) instead of invented metadata.
- If a named tenant, type, or attribute is not an exact L3 match: a **confirmation-only** reply (suggestions + available L3 names). No LCA code until the user confirms the actual name.
- If generating or updating LCA code: a confirmation of object type name and attributes to read vs add/update; print the design; code only after the user confirms.

## Java LCA rules

Generated LCA classes are Java on the selected cloud base class. Null-check `getAttributeValues()`. Use `isOv()` for authoritative values. `validate` returns `data`, never `null`, and uses `ValidationError` factories. Log with `reltioAPI.logInfo()`, `logWarning()`, and `logError()`. Guard `afterSave` write-back against re-entrancy. Never hardcode credentials. Package is `com.reltio.lca.<customer>.<type>`, or the tenant id when the customer name is unknown. Never `com.example.lca`.

## README

When generating a project, the README covers business purpose, working directory, tenant, object type, hook, Java, attributes read and added/updated, package, build, tests, `.env.example` placeholders, manual deploy, `reltio-ide` deploy, connectivity, `lifecycleActions` registration, verification, logs, and rollback.

## Active context

The boundary for project state is `workingDirectory::tenantId`. Do not reuse customer, type, attributes, hooks, package, function name, deployment, connectivity, or approvals from another directory. Same directory with a different tenant reloads L3 and drops tenant-scoped decisions. Same directory and tenant may reuse confirmed context, but a new code change still repeats the confirmation gates. Global default: omitted cloud is AWS.

Package: `com.reltio.lca.<customerName>.<type>`, else `com.reltio.lca.<tenantId>.<type>`. Normalize segments to lowercase Java identifiers. Never use `com.example.lca`.

Validation-only rules prefer DVF. Do not generate Java for a rule that only checks a value.

Deterministic gates live in `src/lca` (`context`, `workflow`, `hooks`, `packageName`, `lifecycleConfig`). Use them instead of chat memory for tenant connection, hook validity, package names, confirmation state, and `lifecycleActions` diffs.
