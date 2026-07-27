# Architecture Docs Skill — Improvement Tasks

Tracking file for skill improvements identified by applying the skill to `server` and `reltio-sdk`.

---

## Task 1: Domain Glossary Section (P0)

**Status:** done  
**Change:** Added "Domain Concepts" glossary section to both Module and Test Module templates. Added R11 rule about verifying definitions. Added domain term discovery to exploration step and validation step. Added domain concept detection to maintenance protocol. Glossary is scoped per module (5-15 terms), Term+Definition only, with "unverified" marking for uncertain entries.

---

## Task 2: Cross-Repo Workspace Document (P0)

**Status:** cancelled  
**Reason:** Forward dependencies are already declared in `pom.xml` (AI can read them). Backward references aren't needed — AI either works full-stack with all context or scoped to a component where consumers are irrelevant. The existing "Shared Dependencies" root section + Task 5 (3-tier dependency split) cover the remaining gap. No new template needed.

---

## Task 3: Common Modification Recipes (P0)

**Status:** done  
**Change:** Added "Common Modification Recipes" section to module template (after Key Design Patterns). Two qualification conditions: structural pattern + frequency. Recipes provide location guidance, decision criteria, anti-patterns, and reference example. Added R12 rule (recipes are about architectural navigation, not implementation). 3-7 target per module, more acceptable if needed. Added exploration and maintenance protocol guidance.

---

## Task 4: Large Module Guidance (P1)

**Status:** cancelled  
**Reason:** Two-level package tables produce 55+ rows for large modules — too big for ARCHITECTURE.md and duplicates what an AI agent can discover via directory listing. The flat table + Domain Concepts (Task 1) + Recipes (Task 3) + Component Diagram already provide sufficient navigation for large modules.

---

## Task 5: External Org-Artifact Map (P1)

**Status:** done  
**Change:** Added ownership rule to the "Shared Dependencies" section in the root template. Simple rule: artifacts under the project's own group ID are owned by the organization and changeable (propose changes rather than work around); everything else is third-party with fixed APIs. Three-tier table was overkill — the group ID is sufficient to distinguish.

---

## Task 6: Data Architecture Section (P1)

**Status:** done  
**Change:** Two-part approach. (1) Added "Data access layering" subsection to Dependencies and Integrations for consuming modules — describes which component owns each data access category (primary DB, search index, cache, messaging, analytics, blob, vector). Tells agent where to put new data operations. (2) Added "Data Architecture" section for data layer modules themselves — storage model, multi-tenancy, abstraction pattern, schema management. Non-data-layer modules mark this N/A.

---

## Task 7: Library Module Guidance (P1)

**Status:** done  
**Change:** Instead of a separate lightweight template, adjusted existing template sections with service vs library guidance. Application Bootstrap and Deployment are N/A for libraries (with one-liner explanation). Logging section clarified as relevant for all modules including libraries. No sections removed — all remain applicable but with type-appropriate content. New tasks 13 and 14 created for Architectural Opportunities section and small library usage analysis.

---

## Task 8: Non-Module Directory Documentation (P2)

**Status:** done  
**Change:** Added "Supporting Directories" section to root template (after Module Map, before System Component Diagram). Simple table of non-module directories with one-line purpose. Covers Docker, Helm, CI, code quality configs, local dev setup. Excludes standard dirs like .git, .idea, target.

---

## Task 9: Naming Anomalies and Conventions (P2)

**Status:** cancelled  
**Reason:** AI agents can read pom.xml for actual artifact IDs and the root POM's `<modules>` for reactor membership. No need to duplicate this information in a table column.

---

## Task 10: Concurrency Model Section (P2)

**Status:** done  
**Change:** Added "Concurrency Model" section to module template (after Logging, before Key Design Patterns). For libraries: thread-safety stance, non-thread-safe components. For applications: main thread pools with entry points, request processing threading model. Architectural level only — no individual locks/syncs. Allows "no concurrency concerns" for stateless modules.

---

## Task 11: Version / Compatibility Strategy (P2)

**Status:** done  
**Change:** No standalone section. Added guidance to Build and Profiles section in root template to include a recipe for how to correctly add a new dependency (where to declare, version alignment, BOM conventions). Agents can read POM for the rest.

---

## Task 12: Feature Flag Documentation (P2)

**Status:** done  
**Change:** No flag-specific section. Feature flags are just one cross-cutting concern like logging or metrics. Expanded Cross-Cutting Concerns guidance in root template: for each concern, describe the framework/tool used, where it's configured, and what conventions new code should follow. This covers flags, logging, metrics, security uniformly.

---

## Task 13: Architectural Opportunities Section (P1)

**Status:** done  
**Change:** Added "Architectural Opportunities" section to both module template (after Recipes) and root template (after Cross-Cutting Concerns). Covers consolidation candidates, abstraction improvements, outdated patterns, structural debt. Designed as actionable context for agents working on future features — not a backlog. Defaults to "None identified" when clean.

---

## Task 14: Small Library Usage Analysis Guidance (P1)

**Status:** done  
**Change:** Added guidance to Step 3 (Explore): for library modules, search across workspace repos for consumers by artifact ID. Reflect consumer count and purpose in Module Purpose section and Architectural Opportunities (consolidation candidate if few consumers, shared infrastructure note if many). No new section — feeds into existing ones.
