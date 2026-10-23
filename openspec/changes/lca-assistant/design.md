# LCA assistant — design

Tracking: RP-191824. The extension does not host an LLM. Cursor Agent follows `skills/reltio-default/lca-assistant/SKILL.md` and the gates in `src/lca`. This file is the normative product context cited by that skill (D2, D5, D6).

## Decisions

### D2 — Tenant-object work uses the connected L3

A connected L3 is any of:

- `Business Config/BusinessConfig.json` inside a tenant folder whose `.reltio-config-source.json` has `kind: "tenant"` (the current component tree; the tenant id is in that marker, not the folder name), or
- `L3.reltio.json` inside a legacy `*.reltio.tenant/` directory, or
- a git-connected `BusinessConfig.json` or `L3.reltio.json` named by `.reltio-config-source.json` in the working directory.

The filename must be exact. `notL3.reltio.json` is not an L3. Sample JSON and Velocity Pack `BusinessConfig.json` files are not a connected tenant. Marker paths that leave the marker directory are ignored.

Advice that only discusses hooks, architecture, LCA vs DVF, or operations does not require L3. Advice that names a tenant object does. That includes any type name (for example `Individual` or `Course`), not only `HCP`, `HCO`, and `HasAddress`. Generate, update, inspect, and register intents are always tenant-aware.

Named types and attributes must exact-match that L3 before code is written. A near-miss stops the turn and asks for the actual name.

### D5 — Known facts are written in the same turn. Deploy waits for its own later yes

`step` is the turn authority. The agent obeys `allowedActions` from that result. The `gate` command checks a stored workflow and is not a second approval after `step`.

When the type, hook, and attributes already exact-match the connected L3, `step` returns `generate` in that turn. It records the object and design approval itself. The agent prints the design with the Java and asks only whether to deploy. It does not wait for a separate design yes.

The tenant tree includes `LifeCycle Actions/` beside `RDM/` and `Workflows/`, with a generated `README.md` that describes the folder. The Java is one Maven project at `<tenant folder>/LifeCycle Actions/<type>-<hook>-<name>-lca/`. `<name>` is the action name. When it is not known yet, the folder is `<type>-<hook>-lca`. `step` returns that absolute path as `projectDirectory` when the type and hook are known. The agent writes only there and does not replace `LifeCycle Actions/README.md`. The same type, hook, and name reuse that project. Another hook or another name is another project. A different folder is used only after the user names it and confirms it. Later turns for that project pass `projectDirectory` as `workingDirectory`. A project directory still finds the tenant configuration by walking up to the tenant folder.

A missing or non-exact type, hook, or attribute stays in `REQUIREMENT_GATHERING`. The reply asks only for that fact. A near-miss does not generate.

Deploy runs only after an explicit yes to the pending deploy question, and only when `.env` has the cloud access details. "Yes, but…", a question, or "ok deploy to production instead" does not deploy. On an approved deploy, `step` also allows `updateL3`. The agent runs deploy first and applies `lifecycleActions` only when the deploy tool succeeds. It does not ask for a second yes. A failed deploy does not edit L3.

A question is answered in `ASK`. It clears a pending deploy or L3 approval, so a following yes does not deploy or edit L3. It does not clear a pending object or design confirmation left by an older session, so a following yes still applies to that confirmation.

"How do I test…?" is a question. An imperative such as "Help me test this" enters `TEST`.

### D6 — Stored facts keep their meaning

`attributesAdded` and `attributesUpdated` are stored separately and reloaded into those same fields. A combined `attributesAddedOrUpdated` list remains only as a legacy fallback.

Context is keyed by the normalized working directory plus tenant id. A trailing slash or equivalent absolute path reopens the same file. `context-save` cannot change phase, approvals, or requirement facts. The `gate` CLI evaluates the persisted workflow for that directory and tenant; it does not accept a caller-supplied workflow.

LCA classes are Java. Secret values in a user message are discarded and are not written into context.

The LCA skill is materialized with the knowledge-base bundle (`lcaKnowledgeBaseBundleVersion`). Shipping it does not advance `skillsBundleVersion`, so existing default skills are not recopied.

## Test plan

### Automated

- Git marker `BusinessConfig.json` is selected; a lookalike `notL3.reltio.json` is not.
- A component-tree tenant (`Business Config/BusinessConfig.json` plus a `kind: "tenant"` marker) is selected. A Velocity Pack `BusinessConfig.json` is not.
- Advice about `Individual` or `Course` is tenant-aware. "What does the beforeSave hook do?" is not.
- "ok deploy to production instead" does not return `deploy`.
- `attributesAdded` survives a context save and reload.
- "How do I test this beforeSave hook?" stays in `ASK` and leaves a pending design approval in place.
- A trailing-slash working directory reloads the same context.
- HCP + `beforeSave` + `CustomerId` resolves to `<tenant folder>/LifeCycle Actions/hcp-beforesave-customerid-lca`. Discovery starting inside that project still selects the tenant.

### Manual

- Connect a git-sourced or component-tree tenant and ask for attributes of a type that is not HCP. The assistant uses that configuration file.
- Ask to generate a `beforeSave` LCA whose type, hook, and attributes exact-match L3. Code is written in that turn, and the only question is whether to deploy.
- Ask a hook question, then say yes. Nothing deploys. "ok deploy to production instead" while deploy is pending shows a new preview and does not deploy.
