# LCA assistant — design

Tracking: RP-191824. The extension does not host an LLM. Cursor Agent follows `skills/reltio-default/lca-assistant/SKILL.md` and the gates in `src/lca`. This file is the normative product context cited by that skill (D2, D5, D6).

## Decisions

### D2 — Tenant-object work uses the connected L3

A connected L3 is either:

- `L3.reltio.json` inside a `*.reltio.tenant/` directory, or
- a git-connected `BusinessConfig.json` or `L3.reltio.json` named by `.reltio-config-source.json` in the working directory.

The filename must be exact. `notL3.reltio.json` is not an L3. Sample JSON and Velocity Pack `BusinessConfig.json` files are not a connected tenant. Marker paths that leave the marker directory are ignored.

Advice that only discusses hooks, architecture, LCA vs DVF, or operations does not require L3. Advice that names a tenant object does. That includes any type name (for example `Individual` or `Course`), not only `HCP`, `HCO`, and `HasAddress`. Generate, update, inspect, and register intents are always tenant-aware.

Named types and attributes must exact-match that L3 before confirmation or code. A near-miss stops the turn.

### D5 — Each external action waits for its own later yes

Code generation requires, on earlier turns, object and attribute confirmation and then design approval. Deploy and `lifecycleActions` updates require their own preview and a later explicit yes. "Yes, but…", a question, or "ok deploy to production instead" does not approve the pending preview.

A question is answered in `ASK`. It leaves a pending deploy or L3 approval, so a following yes does not deploy or edit L3. It does not clear a pending object or design confirmation, so a following yes still applies to that confirmation.

"How do I test…?" is a question. An imperative such as "Help me test this" enters `TEST`.

### D6 — Stored facts keep their meaning

`attributesAdded` and `attributesUpdated` are stored separately and reloaded into those same fields. A combined `attributesAddedOrUpdated` list remains only as a legacy fallback.

Context is keyed by the normalized working directory plus tenant id. A trailing slash or equivalent absolute path reopens the same file. `context-save` cannot change phase, approvals, or requirement facts. The `gate` CLI evaluates the persisted workflow for that directory and tenant; it does not accept a caller-supplied workflow.

LCA classes are Java. Secret values in a user message are discarded and are not written into context.

The LCA skill is materialized with the knowledge-base bundle (`lcaKnowledgeBaseBundleVersion`). Shipping it does not advance `skillsBundleVersion`, so existing default skills are not recopied.

## Test plan

### Automated

- Git marker `BusinessConfig.json` is selected; a lookalike `notL3.reltio.json` is not.
- Advice about `Individual` or `Course` is tenant-aware. "What does the beforeSave hook do?" is not.
- "ok deploy to production instead" does not return `deploy`.
- `attributesAdded` survives a context save and reload.
- "How do I test this beforeSave hook?" stays in `ASK` and leaves a pending design approval in place.
- A trailing-slash working directory reloads the same context.

### Manual

- Connect a git-sourced tenant and ask for attributes of a type that is not HCP. The assistant uses that `BusinessConfig.json`.
- Confirm an object and design, ask a hook question, then say yes. Code generation proceeds. A qualified deploy yes shows a new preview instead of deploying.
