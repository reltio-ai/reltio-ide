## Why

Two complementary ways to work exist, and neither replaces the other.

**VS Code + this plugin** gives authors a strong **metadata-aware editor**: validation, tree navigation, URI tooling, context menus, skeleton inserts, ontology preview, and the rest of the deterministic features—usable as a comfortable editor on `*.reltio.json` and tenant layout **without** any AI.

**Cursor + Cursor Agent** adds a **second lane**: the user opens the agent, plans in natural language, asks follow-ups, and has the agent **apply edits across workspace files**—the same **plan → ask → change** flow as normal AI-assisted development. That works **today** in broad strokes (e.g., “add an entity type”). This change is about making that flow **smarter and more consistent**: **guided skills** for how to introduce entity types, relation types, attributes, match groups, and other elements so the agent **plans and acts** with Reltio-aware conventions and checks against **whatever L3 (or related config) is already in the workspace**.

To support that, the plugin should **prepare and distribute** predefined **skills** into the workspace (for example after the **Reltio** view is opened or the extension is engaged on Reltio metadata)—so authors get Cursor-ready guidance **without** hand-copying skill files. The extension continues to **not** host LLMs; it **ships and installs** the artifacts the agent reads.

**Velocity Packs** are Reltio’s industry-ready configuration libraries (e.g. life sciences, insurance)—real JSON models that exemplify **how** to model domains well. They should be the **primary template and guidance corpus** when suggesting structures and naming for new elements. Canonical excerpts live in-repo / the VSIX; for **Cursor Agent**, the extension **materializes** copies into **`.reltio/reltio-agent/velocity-packs/`** in the workspace (hidden, skills-adjacent)—see `design.md` **D4b**.

In short: we are **not** substituting existing plugin behavior with AI. We are **equipping Cursor Agent**—which already can change files—to follow **better playbooks** and **industry-shaped references** when editing user workspace metadata.

## What Changes

- Define **default skill content** (playbooks by model element: entity type, relation type, attributes, match groups, etc.) and **how the extension provisions** copies or links into **every workspace** that uses Reltio metadata (trigger TBD: e.g. first open of Configuration tree / activation on `*.reltio.json`), so Cursor Agent finds skills **automatically**.
- Introduce **documented layout and conventions** for those skills in the extension repo, plus **optional workspace-local overrides** (per-team conventions) where merge rules are defined in `design.md`.
- Specify **guided-configuration** instructions so the agent analyzes **current workspace models**, reasons about inheritance and relationships, and aligns proposals with existing URIs—building on what users can already ask for in agent chat.
- Define **Velocity Pack** artifacts as the **main reference library** for templates and “how to model” guidance; packs are **added to this repository** by maintainers when ready (no mandatory Bitbucket build step); **materialize** excerpts into the workspace under **`.reltio/reltio-agent/velocity-packs/`** per **design D4b**.
- Separate **artifacts by model element** in the default skill set so routing stays focused (entity vs relation vs match vs attribute).
- **No breaking change** to JSON formats or skeleton-insert commands; this phase is **specification and distribution design** first.

## Capabilities

### New Capabilities

- `reltio-workspace-skills`: Where default skills live in-repo, how workspaces extend them (discovery paths, naming, precedence), and how they relate to Cursor/VS Code agent skill formats already used in the project (e.g. `.cursor/skills`, `.claude/skills`).
- `guided-model-elements`: Agent-oriented workflows to analyze **current model semantics**, propose **inheritance** and **relationships**, suggest **attributes** for a described concept (e.g., Person), and align inserts with **existing URIs and conventions**—with explicit inputs/outputs for orchestration.
- `velocity-packs-reference`: **Velocity Pack** JSON (industry templates) as the **main reference** for structure and modeling idioms; versioning, VSIX packaging, **workspace materialization** at `.reltio/reltio-agent/velocity-packs/`, and how agents use excerpts without loading full tenants into context.

### Modified Capabilities

- *(None — no existing `openspec/specs/` requirements to delta.)*

## Impact

- **Repository layout**: new directories under the extension repo for **default skills** and **bundled pack assets** (exact paths in `design.md`).
- **Documentation**: `ARCHITECTURE.md` and agent-facing docs updated when implementation lands.
- **Build / packaging**: larger `.vsix` if packs are embedded; optional future split (download-on-demand) out of scope for this proposal.
- **Cursor Agent workflows**: the extension **materializes or exposes** predefined skills (and reference pack locations) so the agent can plan edits **without** embedding models in the plugin. Team overrides remain supported where documented.
- **Upstream**: Reltio’s Velocity Pack program may keep canonical definitions in Bitbucket; **this repo** holds **approved excerpts** committed by project maintainers for bundling (no runtime pull).
