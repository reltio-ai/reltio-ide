## Context

Reltio IDE ships Cursor Agent skills + Velocity Packs via `syncReltioAgentAssets`. [RP-191824](https://reltio.jira.com/browse/RP-191824) adds an **LCA Assistant**: same carrier model for an LCA skill and the upstream 8-doc knowledge base from life-cycle-framework-lambda.

Explore (2026-07-22) clarified partner reality: metadata and LCA **code often live in different folders**; “assistant” means Cursor + skill (not a chat UI); KB content needs **LCA sign-off**; behavioral AC needs a **demo script**.

Upstream KB path: `life-cycle-framework-lambda/.reltio/reltio-agent/lca-knowledge-base/` (v3.0). Stub already points at the not-yet-landed playbook: `.cursor/skills/reltio-lca-assistant/SKILL.md`.

## Goals / Non-Goals

**Goals:**

- Carrier: ship skill + KB + independent sync version (`lcaKnowledgeBaseBundleVersion`).
- L3-first partner value: hook choice, LCA vs DVF, `lifecycleActions` wiring grounded in real L3 URIs.
- Dual-workspace awareness and partner invoke documentation.
- LCA content sign-off before packaging into the partner-facing VSIX.
- Reviewable Tier C demo prompts for agent behavior.

**Non-Goals (v1):**

- In-extension LLM / webview chatbot.
- Runtime pull from Bitbucket.
- Guaranteeing `mvn package` success (credentials / private Maven).
- Cloud deploy automation, Java language server, debugger.
- Deterministic tree “Insert lifecycleActions” command (follow-up).
- Deep TypeScript/JSON Schema typing for `lifecycleActions` (follow-up).

## Decisions

### D1 — Skill + knowledge corpus (not an in-extension chat tool)

**Decision:** Deliver as Cursor Agent skill + bundled KB. No extension-hosted model.

**Rationale:** Matches entity/match skills and Confluence IDE intro (AI in Cursor, plugin as carrier).

### D2 — Canonical paths and partner discovery

| Layer | Path | Audience |
|--------|------|----------|
| Canonical playbook | `skills/reltio-default/lca-assistant/SKILL.md` | Shipped in VSIX |
| Contributor Cursor stub | `.cursor/skills/reltio-lca-assistant/SKILL.md` | **reltio-ide** contributors only |
| Materialized skill | `.reltio/reltio-agent/skills/default/lca-assistant/SKILL.md` | Partner workspaces after sync |
| Materialized KB | `.reltio/reltio-agent/lca-knowledge-base/` | Partner workspaces after sync |
| Team override | `skills/workspace/lca-assistant/SKILL.md` | Never overwritten by sync |

**Partner discovery (resolved):** Partner workspaces do **not** get the `.cursor/skills` stub from this repo. v1 discovery is:

1. Extension syncs skill + KB under `.reltio/reltio-agent/`.
2. `ARCHITECTURE.md` + skill frontmatter document how to invoke (e.g. ask Cursor to use the Reltio LCA assistant / `@` the materialized `SKILL.md` and KB `00_INDEX…`).
3. Include **2–3 sample prompts** in skill and demo script.

No new walkthrough UI in v1 (optional later).

### D3 — Knowledge base packaging + LCA sign-off

**Decision:** Bundle eight docs + `manifest.json` + `README.md` under `resources/lca-knowledge-base/`. Record provenance (upstream version/date). **Before merge to a release branch / VSIX used by partners:** an LCA component owner (or designated reviewer) **SHALL** confirm the snapshot is approved for redistribution. Track sign-off on RP-191824 (comment or checklist).

**Refresh:** Maintainer replace files → bump `lcaKnowledgeBaseBundleVersion` → PR. No runtime Bitbucket sync.

### D4 — Sync extension

**Decision:** Add `lcaKnowledgeBaseBundleVersion` beside skills/packs versions. Copy to `.reltio/reltio-agent/lca-knowledge-base/` on version advance / missing / force Resync. Never touch `skills/workspace/**`. Update Resync command title to mention LCA KB; keep id `reltio.resyncAgentAssets`.

### D5 — L3-first workflow; scaffold is opt-in

**Decision (explore lane A+B, not C):** Primary success = advise + wire L3. Maven scaffold only when the user **explicitly** asks for a project; always **confirm target folder** (no silent default write into unrelated repos). Generated projects may not compile without partner Maven credentials — skill MUST say so.

Preferred session:

```
Partner opens Cursor workspace with Reltio IDE
        │
        ▼
Extension syncs skills + packs + LCA KB
        │
        ▼
Partner: “Add beforeSave enrichment for HCP using our L3”
        │
        ▼
Agent: route KB → inventory L3 → clarify → propose hook + lifecycleActions
        │
        ├── approve → patch L3          ← primary
        └── “also scaffold Maven” → ask folder → KB-02 layout  ← opt-in
```

### D6 — Dual-workspace awareness

**Decision:** Skill MUST detect context and branch:

| Context | Behavior |
|---------|----------|
| `L3.reltio.json` (or `*.reltio.json`) open / in workspace | Full L3-first flow; ground attributes in file |
| Java/Maven LCA project only (no L3) | Advise hooks/code from KB; **ask** for L3 path or attribute URIs before inventing names; do not silently invent L3 |
| Both present | Prefer L3 for naming/wiring; scaffold/edit code in the agreed Java folder |

### D7 — Security

No secrets/tokens/PII in generated code or logs (KB-05). Bundled KB is documentation only.

### D8 — Testing and demo script

- **Tier A:** sync copies KB files on version bump; does not touch `skills/workspace/**`.
- **Packaging:** VSIX contains `resources/lca-knowledge-base/` + `skills/reltio-default/lca-assistant/SKILL.md`.
- **Tier C demo script** (document under change or `docs/` snippet referenced from tasks) — at least three prompts:
  1. Narrow: “What does `beforeSave` do?” → expects minimal KB retrieval / correct hook answer.
  2. L3 wire: with sample L3 open, “Attach a beforeSave action for \<entity\> using existing attributes” → real URIs + `lifecycleActions` proposal.
  3. Opt-in scaffold: “Scaffold a Maven LCA for that action in folder X” → asks/confirm folder; notes compile credentials.

Do **not** fail the story on `mvn package`.

### D9 — Schema typing (unchanged)

No `lifecycleActions` model/schema tightening in v1.

### D10 — Ownership

| Concern | Owner |
|---------|--------|
| KB content truth + redistribution approval | LCA (Jira component) |
| Skill packaging, sync, VSIX, ARCHITECTURE | Reltio IDE |
| Partner invoke docs | Reltio IDE (with LCA review of sample prompts if desired) |

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| KB drift / redistribution | Provenance + LCA sign-off on RP-191824 |
| Agents dump whole KB | Skill + KB-00 minimum retrieval |
| Partner can’t find skill | Invoke docs + sample prompts (D2) |
| Expect deploy-from-IDE / compile | Explicit non-goals; skill wording |
| Two workspaces confuse agent | Dual-workspace branching (D6) |
| Soft behavioral AC | Tier C demo script (D8) |

## Migration Plan

1. Refresh OpenSpec (this revision) → Apply: copy KB, skill, sync, docs, tests, demo script.
2. LCA sign-off comment on RP-191824 before partner VSIX cut.
3. Archive when stable.

**Rollback:** Remove skill folder, KB resources, sync field; leftover workspace copies until Resync/delete.

## Open Questions

- *(Resolved)* Scaffold default folder → **always ask**; no silent default.
- *(Resolved)* Partner discovery → sync paths + invoke docs + sample prompts; no walkthrough UI in v1.
- *(Resolved)* Legal/redistribution → **LCA sign-off** gate on RP-191824 before partner release.
- *(Deferred)* Tree insert for `lifecycleActions`; schema typing; walkthrough tile; maintainer refresh script.
