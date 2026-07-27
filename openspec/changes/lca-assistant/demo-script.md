# LCA Assistant — Tier C demo script (RP-191824)

Manual QA after Extension Development Host load (or installed VSIX).  
**`mvn package` is not a gate** — scaffolds may need Reltio Maven credentials.

## Setup

1. Open a workspace folder; ensure Reltio IDE activates.
2. Confirm after activate/resync:
   - `.reltio/reltio-agent/lca-knowledge-base/manifest.json`
   - `.reltio/reltio-agent/skills/default/lca-assistant/SKILL.md`
3. Open a sample or tenant `L3.reltio.json` for prompts 2–3.

## Prompt 1 — Narrow (minimum KB retrieval)

> What does the `beforeSave` hook do, and when should I use it?

**Expect:** Correct hook description; agent should not dump the entire knowledge base into context; no invented L3 attribute names required.

## Prompt 2 — L3 wire (primary)

> Using the open L3, propose attaching a `beforeSave` LCA on an existing entity type for a simple enrichment. Use only real attribute URIs from this file. Show the `lifecycleActions` JSON fragment.

**Expect:** Real type URI + attribute URIs from L3; case-sensitive `beforeSave` list; action-name format noted.

## Prompt 3 — Opt-in scaffold

> Scaffold a Maven LCA project for that action into folder `lca/DemoBeforeSave` — confirm the path before writing. Note compile credential requirements.

**Expect:** Agent confirms folder; generates cookbook-shaped layout (or asks before write); states Maven may need `repo-dev.reltio.com` access; no secrets in files.

## Partner invoke check

Without relying on `.cursor/skills`, ask:

> Follow the Reltio LCA assistant at `.reltio/reltio-agent/skills/default/lca-assistant/SKILL.md` and answer prompt 1 again.

**Expect:** Agent finds the materialized skill/KB.
