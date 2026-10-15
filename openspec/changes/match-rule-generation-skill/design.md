## Context

Agent skills ship in `skills/reltio-default/` and are copied to `.reltio/reltio-agent/skills/default/` by `syncReltioAgentAssets`. Reasoning happens in the user's own agent; the extension never calls an LLM (`skills-and-enablement-packs-library`). RP-200851 moved tenant identity out of folder names into marker files, which `EnvironmentManager` indexes on scan (`locFromPath`).

The Bitbucket branch `feature/match-rule-generation-skill` prototyped this feature. Its useful ideas are carried over; its implementation is not (see the proposal for what was dropped and why).

## Goals / Non-Goals

**Goals**

- An agent turns a plain-English requirement into a schema-valid match group, tests it against the tenant before inserting, and reports results honestly labelled.
- The skill is found without an @-mention in Claude Code, VS Code Copilot and Cursor, and an agent that cannot find it says so.
- Nothing the user owns is overwritten, and nothing generated is committed.

**Non-Goals**

- Deployment. **Apply Configuration to Tenant** stays the only path to the tenant.
- An LLM, MCP server or agent-callable command inside the extension.
- Rewriting the other four bundled skills.

## Decisions

### D1. The request names a file; the extension supplies identity

The agent writes `configFile` (the `BusinessConfig.json` it is editing), never an environment or tenant. The bridge rescans and resolves the file through `EnvironmentManager.locFromPath`, and the token is looked up for the environment that resolution returns.

The Bitbucket version parsed `<env>.reltio.environment/<tenant>.reltio.tenant/` from the path, which RP-200851 removed. Taking identity from the request would also let a request choose where the user's token is sent. Resolving it from the scan means the token only reaches its own environment, and `toHttpsBase` still enforces the host allowlist.

### D2. Three result statuses, split by what the agent may do next

| Status | Agent may | Cases |
|---|---|---|
| `verified` | insert | every pair ran |
| `not-verified` | reason statically, labelled **not verified against a tenant**, then insert | `disabled`, `repository-mode`, `no-tenant`, `signed-out` |
| `failed` | troubleshoot and retry; never insert | `invalid-request`, `api-error`, `untrusted-host`, `network` |

The Bitbucket version made "no session" a hard stop. A workspace opened with Connect your Repository never has a session, so its users could not use the skill at all. Here, impossibility is `not-verified` and a genuine failure is `failed`. A 401 that the silent refresh cannot fix counts as `signed-out`: to the user it is the same situation.

### D3. `no-shared-token` is its own outcome

`_verifyMatches` reports `matched` (rule satisfied **and** the pair shares a match token) separately from `matchedByDocuments` (rule satisfied). Rule logic passing with no shared token means real matching would never compare the pair. That is the defect static reasoning misses most, usually a missing token class or an all-`ignoreInToken` rule, so the bridge reports it as `no-shared-token` instead of folding it into `no-match`. Outcomes are ranked `no-match` < `no-shared-token` < `matched` < `suspect` < `auto-merge`, and a pair reports the strongest across candidate rules.

### D4. One skill copy, read by all three agents

Claude Code reads `.claude/skills/` natively, VS Code Copilot lists it among its default skill folders, and Cursor reads it for compatibility. One copy at `.claude/skills/reltio-<playbook>/` therefore covers all three, where per-agent copies would drift. Installed folder name equals the frontmatter `name`, which the Agent Skills rules require.

Risk: Cursor labels `.claude/skills/` a compatibility location. If it stops reading it, adding `.cursor/skills/` is a one-line change to the desired set.

### D5. Missing-skill guides are always-on files, one per agent format

A skill cannot announce its own absence, because it only loads when relevant. A short guide does: it lists the installed skills and says to tell the user and stop, rather than improvise, if one is missing. Each agent family has its own always-on format:

| Agent | File | Mechanism |
|---|---|---|
| Claude Code | `.claude/rules/reltio-skills.md` | unscoped rule, loaded at launch |
| Cursor | `.cursor/rules/reltio-skills.mdc` | `alwaysApply: true` |
| VS Code Copilot | `.github/instructions/reltio-skills.instructions.md` | `applyTo: '**'` |

The guides are regenerated whenever their text differs, so the skill list never goes stale. The user's `CLAUDE.md`, `AGENTS.md` and other rule files are never touched.

### D6. Ownership is recorded, never inferred

Every path the extension writes is recorded in `.sync-state.json` (`ownedAgentFiles`). A desired path that already exists but is not owned is a conflict: left untouched and reported to the user. Paths dropped from the bundle are deleted only if owned. Turning `reltio.installAgentSkills` off deletes exactly the owned set. Each owned path is added to the workspace `.gitignore` individually; `.claude/` or `.cursor/` as a whole is never ignored.

### D7. The knowledge base is grounded in shipped files, and a test keeps it so (extended by D11)

Every class `reference.md` or `SKILL.md` names must occur in a shipped Velocity Pack, and every worked example must validate against the schema's `MatchGroup` definition. Mining the packs corrected several prototype claims: shipped configs use `scope: "ALL"` (not lowercase), `NameDictionaryCleanser` without parameters, `equals` with a `values` array, and nested URIs that vary by tenant. It also dropped classes no shipped config uses (`PhoneNumberMatchToken`, `ProximateGeo*`, `RangeNumeric*`, `CrossMultiComparator`). The test fails if the content drifts from either source.

### D9. Overrides are applied before installing, file by file

RP-201030 requires `skills/workspace/` overrides to be discoverable with their precedence intact. Installing only the defaults would make discovery actively wrong for a team with an override: agents would find and follow the default. So `resolveSkills` builds each installed folder as the default overlaid with the override, file by file. Overlaying rather than replacing keeps companion files the override does not supply, so an override of `SKILL.md` alone still links to the default `reference.md`. A playbook that exists only under `skills/workspace/` is installed as its own skill.

An override must keep its default's `name`: the name is the installed folder, the guides list it, and agents resolve it. An override that changes it, or that agents would reject, is reported and nothing is installed for that playbook. Falling back to the default would hide the problem and ignore the team. The guide then tells the agent the skill is missing, and the user sees the warning saying why.

Because overrides change between bundle versions, managed folders are converged on their resolved content each sync instead of copied on a version bump: only differing files are written, so an unchanged workspace is not rewritten. A watcher on `skills/workspace/**` triggers the sync on edit.

### D10. One layout for every host, and the workspace-root question deferred (superseded by D14 for the layout)

RP-201030 asked for host-aware output. One layout that all three agents read is simpler and serves a user who opens the same workspace in Cursor and in VS Code; host detection would leave one of them without skills. In a host with no skill discovery the files are inert, gitignored, and removed by `reltio.installAgentSkills: false`. RP-201030's criterion was updated to match.

RP-201030 also noted that agent assets land at the workspace folder root, so opening a parent folder puts them above the tenant configuration. That concerns where `.reltio/` lives, not discovery, and is deferred to RP-202988.

### D11. Aligned with Reltio's match-rules knowledge base, which stays out of the repository

Reltio's internal *Match Rules Knowledge Base* (October 2026) was compared with the skill. It added geo proximity, numeric ranges, swapped names (`multi` + `CrossMultiComparator`), partial-value patterns through `CustomMatchToken`/`CustomComparator`, existence checks (`equals`/`notEquals` with only a `uri`), cross-source rules, `nullValues`, Jaro-Winkler, DistinctWords parameters, the 2020 name dictionary, RDM and hosted dictionaries, relevance gaps and nested weights, and the meaning of `scope` and of an omitted `useOvOnly`. The skill now also asks for the entity type, exact-or-fuzzy and the outcome when a request leaves them out, picks `relevance_based` when the user talks about scores, and maps classes explicitly for every attribute, as the knowledge base's expected answers do.

The knowledge base is not committed: this repository is public, and the document is internal and names customers in its dictionary URLs. Its guidance is restated in `reference.md` with placeholders, and the grounding test (D7) now accepts a class used by a Velocity Pack **or** on a short list of class names the knowledge base documents. The test also fails if shipped guidance contains a hosted S3 URL.

Its errors were not carried over: `"rules"` for `rule`, arrays for `matchTokenClasses`, type names `auto`/`relevance`, a mistyped geo class package, a nonexistent `BasicTokenizedOrganizationNameMatchComparator`, and boolean parameter values.

Mining the packs for this comparison also showed that attribute types can declare default token and comparator classes (`PhoneNumber`, `AddressLine`, `Email`, `SimpleName`, `OrganizationName`, `WebsiteURL` in the shipped packs). Neither source mentioned it; the reference now does, and explicit mappings keep a rule independent of those defaults.

### D12. `useOvOnly` is written as a boolean

Decided with the product owner on 2026-10-06. The knowledge base writes `true`; every Velocity Pack writes `"true"`; the schema accepted only strings, so 32 of the knowledge base's 43 examples failed validation. The schema now accepts both (`MatchGroup.useOvOnly`: `boolean | string`, and the model type likewise), so existing configurations stay valid, and the skill writes booleans.

### D13. The knowledge base's examples ship in `examples.md`, vetted and de-identified

At the product owner's request (2026-10-09), every example in the knowledge base was copied into `skills/reltio-default/match-groups-from-concept/examples.md` except those with errors: 46 examples (operator fragments, one group per kind of data, cleansers, relevance, 26 complete scenarios). `reference.md` keeps its nine; `SKILL.md` tells agents to start from the closest example.

Excluded, with the reason:

| KB block | Reason |
|---|---|
| §1 and §2 structure blocks | `"rules"` and array-shaped class mappings: not valid configuration |
| `notExact` fragment | Items are strings; the schema requires `{ "uri" }` objects |
| Nested-operators group | `Middlename` vs `MiddleName`: the `nullValues` entry targets a different attribute |
| Geo section group | Class names `com.reltio.match.comparator..ProximateGeo*` (double dot, wrong package); Example 13 covers geo correctly |
| Multi-word strings group | Boolean parameter values; the schema requires strings |
| `notEquals` operator group, Examples 12 and 20 | `notEquals` without `ignoreInToken`, against the knowledge base's own best practice |
| Example 1 | Not valid JSON (missing opening brace) |
| Example 10 | Inside its `or`, `exact: [FirstName, LastName]` means either name, not both as its text says |

Corrected rather than excluded, because they are the only examples of their pattern: Example 17's label and URI said "Fuzzy" for an exact rule; Example 22's said 80% for a 60% rule.

De-identified: seven hosted dictionary URLs (customer and test S3 paths) replaced by `dictionaries.example.com` placeholders, an RDM lookup type renamed, and a customer programme prefix removed from Example 25's label. `useOvOnly` is normalised to a boolean (D12). The generator ran outside the repository against the internal document; only its output is committed.

The test validates every block (groups against `MatchGroup`, fragments against `MatchRule`), requires boolean `useOvOnly`, unique group URIs, grounded class names, and URLs on `example.com` or `reltio.com` only.

### D14. Each editor also gets its own folder (supersedes D4 and D10 on layout)

Decided with the product owner on 2026-10-12, for future compatibility: Cursor calls `.claude/skills/` a compatibility location, and either editor may stop reading another tool's folder. Every editor still gets `.claude/` (Claude Code reads nothing else and runs in any editor's terminal); the running editor also gets its own skills folder and guide: `.cursor/skills/` + `.cursor/rules/` in Cursor, `.github/skills/` + `.github/instructions/` in VS Code, nothing extra elsewhere. `detectHost` uses `vscode.env.uriScheme`, then `appName`.

Opening the workspace in another editor removes the previous editor's managed copies and any folder that removal empties, so a workspace only carries folders for the editor it is open in. Folders that still hold anything else (a team's `.github/workflows/`) stay. The cost is duplicate skill names in each editor (`.claude/skills` and its own folder hold identical copies), which the product owner accepted; their content is always identical, so behaviour cannot differ.

### D15. The skill ships the match-group schema it validates against

Field testing showed the skill pointed agents at `schemas/reltio-metadata.schema.json`, which exists in this repository but not in a user's workspace; the agent fell back to comparing against examples. `scripts/build-match-group-schema.cjs` now writes `match-group.schema.json` into the skill folder: `MatchGroup` and the 44 definitions it reaches, about 25 KB. It validates every example on its own. The unit test fails if the copy differs from what the generator derives from the full schema.

### D16. Test results show both records, not a summary

Field testing showed results as "what differed", which hides what was actually compared. The report now has one row per pair with Record 1 and Record 2, every attribute in a single cell each, and the expected and actual outcome. Per-attribute scores are added only when the user asks; for that, the bridge now passes each rule's explanation from `_verifyMatches` through unchanged (`explanation`), so verified scores come from the tenant rather than the agent.

### D8. Sync problems reach the user

An agent with no skill improvises, so a silent sync failure is not harmless. Conflicts, rejected skills and exceptions raise a warning with **Resync Agent Assets**. Changing `reltio.installAgentSkills` applies immediately.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| `_verifyMatches` shape or path differs on some tenants | Parsing tolerates missing fields (a rule not reported is `no-match` with `evaluated: false`); the raw verdict per rule is returned; Tier C checks a live tenant |
| Unknown `matchAction` values | Classified as `matched`, with the raw action reported, rather than guessed |
| A request hammers the tenant | One call per pair, at most 10 pairs and 10 groups, stop at the first failure |
| Agent writes `request.json` in chunks | 300 ms debounce, one retry on unparseable JSON, serialized handling |
| Copilot also reads `.claude/rules`, so it may see the guide twice | The guide is idempotent; duplication is harmless |
| Generated files appear in a workspace-root repository | Each owned path is gitignored at the workspace root |

## Migration Plan

`skillsBundleVersion` 1 → 2 re-copies the default skills on next activation and installs the discoverable copies and guides. Rollback: revert the change; owned files are removed by turning the setting off first, or left as harmless ignored files.

## Test plan

| Tier | Script / Method | What it covers |
|------|------------------|-----------------|
| A (automated) | `scripts/test-match-rule-generation-skill.cjs` | Bridge: `disabled` and `repository-mode` answer without calling the tenant; a file outside any tenant is `no-tenant`; a missing token and the git-source sentinel are `signed-out` and never sent; eleven malformed requests (no id, no file, path escaping the workspace, absolute path outside it, no or too many groups, group without `uri`, no or too many pairs, pair missing a side) are `invalid-request` with nothing sent; environment and tenant in the request are ignored in favour of the resolver; one call per pair carrying `first`, `second` and the candidate groups; outcomes `suspect`, `no-shared-token`, `no-match`, strongest-wins across rules, unreported rule is `no-match`; 401 refreshes and retries with the new token, an unrefreshable 401 is `signed-out`; a 400 keeps status and body, stops at the failing pair and keeps earlier results; untrusted host and network errors map to their kinds. Client: URL, method, headers and body; 401 and 400 errors carry status and body; an untrusted host is rejected before any request. Discovery (in-memory filesystem, real bundled skills): every bundled skill passes the naming rules as `reltio-<playbook>`; companion files are copied; an occupied path is reported and untouched; each guide lists every skill and the restore command in its agent's format; every owned path is gitignored and `.claude/`/`.cursor/` are not; a second sync with nothing changed writes nothing; a hand edit, a stray file and a stale guide are put back; a retired skill is deleted; opting out removes exactly the owned set; an invalid skill is reported and not installed. Overrides: an override of a bundled playbook wins while the default `reference.md` stays; an override-only playbook is installed and listed in every guide; editing an override reaches the installed copy; removing it restores the default and retires the override-only skill; an override that renames the skill is reported and neither it nor the default is installed; nothing is written under `skills/workspace/`. |
| B (automated, corpus-derived) | same script | Every worked example in `reference.md` validates against `$defs/MatchGroup`; every class named in the skill occurs in a shipped Velocity Pack; `SKILL.md` documents every status, reason, failure kind and outcome the bridge exports, the request and result paths and the limits; the command titles it cites exist; both settings are declared with default `true`. Each key assertion was mutation-checked (identity from request, sentinel token sent, containment removed, continuing after failure, overwriting user folders, opt-out leaving files, `no-shared-token` folded into `no-match`, an outcome dropped from `SKILL.md`, override not overlaid, renamed override accepted, stray files kept, every file rewritten, overrides not read). |
| C (manual QA) | Extension Development Host or packaged `.vsix` | **Discovery:** open a tenant workspace; confirm `.claude/skills/reltio-*` and the three guides exist and are in `.gitignore`. In Claude Code, Copilot agent mode and Cursor, ask "create a match rule for Individuals on exact email and fuzzy first name" with no @-mention and confirm the skill is used. Delete `.claude/skills/reltio-match-groups-from-concept`, ask again, and confirm the agent reports the missing skill and the resync command. Put a hand-made folder at a managed path, reload, confirm the warning and that it is untouched. Turn `reltio.installAgentSkills` off and confirm only managed files go. **Overrides:** add `skills/workspace/match-groups-from-concept/SKILL.md` with the same `name`, confirm `.claude/skills/reltio-match-groups-from-concept/SKILL.md` updates within a second and `reference.md` stays, and that an agent follows the team version; change its `name` and confirm the warning and that the folder is removed. **Verification:** signed in, run the request end to end and confirm three pairs come back `verified` against the right tenant, that the "Reltio Match Verification" output shows no token, and that nothing changed on the tenant. Sign out and confirm `signed-out` and a labelled static result. Open a Connect your Repository workspace and confirm `repository-mode`. Break a URI and confirm an `api-error` 400 with the server's message and no insertion. Write a rule whose attributes are all in `ignoreInToken` and confirm `no-shared-token`. |

## Open Questions

- Whether `_verifyMatches` needs the `CustomerTenant`/`DataTenant` headers listed in Reltio's documentation on any tenant. The existing client sends neither for any call; Tier C confirms.
