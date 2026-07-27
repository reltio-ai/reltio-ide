---
name: architecture-docs
description: Generate and maintain ARCHITECTURE.md files for backend Maven projects. Use when the user wants to create, update, or review architectural documentation for a Maven project or multi-module Maven tree.
license: MIT
compatibility: Any backend Maven project (single-module or multi-module).
metadata:
  author: architecture-docs
  version: "2.0"
---

Generate and maintain ARCHITECTURE.md files for backend Maven projects.

For a multi-module Maven project, produces a root ARCHITECTURE.md (high-level overview with links) and a separate ARCHITECTURE.md for each meaningful module. For a single-module project, produces one ARCHITECTURE.md at the project root.

Each file serves both AI agents and human developers as a reference to what the component actually does.

---

**Input**: The user specifies a Maven project directory. They may ask to generate all ARCHITECTURE.md files from scratch, update a specific one, or review existing docs for staleness.

---

## Rules

**R1. Dual audience.** Every ARCHITECTURE.md must be useful to both AI agents (for context grounding) and human developers (for onboarding and reference). No jargon without explanation, no implicit assumptions, precise package/class references.

**R2. No duplication between root and module files.** In multi-module projects, the root file provides a system-level overview and links. Per-module files go deeper into internals. Never repeat the same content in both places.

**R3. Diagrams are mandatory.** Every ARCHITECTURE.md must include at least one Mermaid component diagram. Diagrams reference actual packages and classes, not abstract boxes.

**R4. Sections are prescriptive.** Each template defines required sections. A section can say "N/A — [reason]" if genuinely not applicable, but it cannot be omitted.

**R5. No endpoint-level API details.** If the module exposes an API, describe categories of endpoints and general URL patterns, not individual routes.

**R6. Configuration is explicit.** Document actual configuration mechanisms (files, environment variables, frameworks) with real file paths, not abstract descriptions.

**R7. Maintenance via suggestion.** When working on other tasks in the project directory, if structural changes are detected (new packages, moved classes, new configuration, changed deployment), suggest an ARCHITECTURE.md update to the user. Never auto-apply updates.

**R8. Keep it concise.** Target 200–400 lines per module file. If a section grows beyond ~60 lines, restructure or link to a separate doc.

**R9. Ground in reality.** Every referenced package, class, file path, and configuration entry must actually exist in the codebase. After generating, cross-check references.

**R10. Mermaid diagram conventions.** Use camelCase or PascalCase for node IDs (no spaces). Wrap labels with special characters in double quotes. Do not use explicit colors or styling — let the renderer theme handle it.

**R11. Domain terms must be verified.** The Domain Concepts glossary in each module doc must contain only terms that are accurate and relevant to that specific module. Do not guess definitions from package/class names alone — abbreviations and domain jargon are frequently misleading (e.g., "OV" means "Operational Value", not "Operational View"). Cross-check definitions against existing documentation, code comments, Javadoc, or ask the user when uncertain. An incorrect glossary entry is worse than a missing one.

**R12. Recipes are about architectural navigation, not implementation details.** Common Modification Recipes answer "where does code go" — not "how to write the code." They provide location guidance, decision criteria between alternatives, anti-patterns, and a reference example. They do not contain code snippets, step-by-step implementation instructions, or feature-specific logic.

---

## Steps

1. **Determine scope**

   Identify the target Maven project directory. Then determine what the user needs:
   - Generate all ARCHITECTURE.md files from scratch
   - Update a specific file (which one?)
   - Review existing files for staleness

   If the user already specified, proceed directly.

2. **Discover project structure**

   Read the root `pom.xml` to understand:
   - Is this a single-module or multi-module project?
   - For multi-module: which modules exist? Which are meaningful (application code, libraries, APIs) vs. auxiliary (coverage aggregators, benchmarks)?
   - What is the packaging type of each module (jar, war, ear, pom)?

   Ask the user which modules should get their own ARCHITECTURE.md if not obvious.

3. **Explore the codebase**

   For each module that needs documentation, investigate:
   - `pom.xml` — dependencies, plugins, profiles, packaging
   - Source tree — top-level packages under `src/main/java` and/or `src/test/java`
   - Entry points — determine module type: application (look for controllers, servlet descriptors, main classes) or library (look for public interfaces, service classes, API surface packages)
   - Configuration — properties/YAML/XML files, configuration model classes, key properties that control core behavior, environment variable references
   - Existing documentation — README, docs/, existing ARCHITECTURE.md
   - Domain terms — collect abbreviations and domain-specific words from package/class names that would be unclear to an outsider. Do not infer definitions from names alone; look for Javadoc, code comments, or existing docs that confirm meaning. Flag uncertain terms for user review.
   - Repeatable change patterns — look for structural patterns in the codebase where the same multi-file/multi-package shape is repeated across features (e.g., multiple controllers following the same layering, multiple SDK services with the same structure). These are candidates for Common Modification Recipes. Verify with the user which patterns are intentional conventions vs. coincidental.

   **Do not assume any specific framework.** Discover what the project actually uses (Spring, Quarkus, Micronaut, plain Java, Vert.x, etc.) by reading the POM and source code.

   **For library modules:** analyze usage across available repos in the workspace.
   Search for the library's artifact ID in other projects' POM files to identify consumers.
   Note how many modules depend on this library and for what purpose. Reflect this in:
   - Module Purpose — state who consumes this library and why
   - Architectural Opportunities — if only one or two consumers exist, flag as a
     consolidation candidate; if usage is widespread, note its importance as shared infrastructure

4. **Select and fill templates**

   Based on what was discovered, use the appropriate template from below. Adapt section content to the actual tech stack — the section headings are stable, but the guidance within each section adjusts to what the project uses.

   Fill every section with real data from the codebase. Every package name, class name, and file path must be verified to exist.

5. **Validate references**

   After writing each file, spot-check that:
   - Referenced packages exist under the expected source roots
   - Referenced classes/files exist at the stated paths
   - Mermaid diagrams reflect actual component relationships
   - Domain Concepts glossary terms are verified (not guessed from names) and scoped to the module

6. **Show summary**

   Display what was created or updated, with a brief diff if updating.

---

## Template: Root ARCHITECTURE.md (Multi-Module Projects Only)

Use this for the root of a multi-module Maven project. Skip for single-module projects.

```markdown
# <Project Name> Architecture

> High-level overview of the project.
> For module internals, see per-module ARCHITECTURE.md files linked below.
>
> Audience: AI agents and human developers.

## Overview

<What this project is, what problem it solves, how it fits in the broader system.
If this project depends on or is depended upon by other projects, describe those relationships.>

## Technology Stack

<Determined by reading pom.xml dependencies and source code. State concisely what the project is built with.
Examples of what to surface:
- Language and version (e.g., Java 17, Kotlin 1.9)
- Project type (web application, library, CLI tool, etc.)
- Framework (Spring Boot, Spring MVC, Quarkus, Micronaut, plain Java / POJO library, etc.)
- Packaging and runtime (WAR on Tomcat, fat JAR, Docker image, etc.)

If modules use different stacks, summarize at the project level and note differences.
Keep this brief — a short list or single paragraph, not an exhaustive dependency catalog.>

## Module Map

| Module | Artifact ID | Packaging | Purpose | Docs |
|--------|-------------|-----------|---------|------|
| `<dir>` | <artifactId> | <packaging> | <one-line purpose> | [ARCHITECTURE.md](<dir>/ARCHITECTURE.md) |

<One row per module. Link to per-module ARCHITECTURE.md for documented modules.
Use "—" in the Docs column for modules without their own doc (auxiliary modules).>

## System Component Diagram

<Mermaid diagram showing the high-level system:
how modules relate to each other, external systems, storage, messaging, etc.
Reference actual module and package names.>

## Shared Dependencies

<Key libraries shared across modules and their roles.
Table format: dependency → role.
Focus on internal/organizational dependencies and significant third-party libraries.

Ownership rule: artifacts under the project's own group ID (e.g., `com.reltio`) are owned
by the organization and can be changed — if a change is needed in one of these libraries,
propose it rather than working around it. All other artifacts are third-party with fixed APIs.>

## Build and Profiles

<Maven build structure: parent POM, module declarations, key profiles,
packaging pipeline, notable plugin configurations.

Include a recipe for how to correctly add a new dependency: where to declare it
(parent dependencyManagement vs. module POM), whether to use project.version alignment
or a BOM import, and any conventions for version properties. This prevents agents
from adding dependencies inconsistently.>

## Deployment Overview

<How the project is deployed: packaging, container/runtime expectations,
environment requirements, infrastructure dependencies.>

## Cross-Cutting Concerns

<Concerns that span multiple modules: logging, metrics, security,
feature flags, configuration management. Brief descriptions with pointers
to where each is configured.

Conventions for how to use these in new code (e.g., how to add logging,
how to gate behind a feature flag, how to emit a metric) belong in the
per-module Common Modification Recipes section.>

## Architectural Opportunities

<Project-wide structural improvements that span modules.
Examples: modules that should be merged, cross-module abstractions that need
simplification, project-level patterns that are outdated.

Per-module opportunities go in the module's own Architectural Opportunities section.
This section is for observations that affect multiple modules or the project structure itself.

If none identified, state "None identified at this time.">

## Supporting Directories

| Directory | Purpose |
|-----------|---------|
| `<dir>` | <one-line purpose> |

<Non-module directories that contain operational, build, or deployment content
(e.g., Docker configs, Helm charts, CI pipelines, code quality configs, local dev setup).
Only include directories that are not Maven modules but are relevant to building,
running, or deploying the project. Skip standard directories like `.git`, `.idea`, `target`.>
```

---

## Template: Module ARCHITECTURE.md

Use this for each documented module (or for the sole module in a single-module project). Adapt section content to the actual tech stack discovered during exploration.

```markdown
# <Module Name> Architecture

> Audience: AI agents and human developers.

## Module Purpose

<What this module does, its responsibility boundaries, what it does NOT do.>

## Domain Concepts

| Term | Definition |
|------|-----------|
| <Term> | <1-2 sentence plain-language definition> |

<Glossary of domain-specific terms that appear in this module's package names, class names,
or configuration and would not be obvious to someone unfamiliar with the product domain.

Scoping rules:
- Only include terms relevant to THIS module — not a global glossary.
- If a term is standard industry jargon (e.g., "REST", "DAO"), omit it.
- If a term is an abbreviation used in code (e.g., "OV", "BCE", "RDM"), always expand and define it.
- Target 5-15 terms per module. If more are needed, the module may be doing too much.
- When uncertain about a definition, ask the user or mark it with "⚠️ unverified" rather than guessing.

This section is critical for AI agent grounding — agents use these definitions to understand
what code is doing when package/class names use domain language.>

## Technology Stack

<Determined by reading pom.xml and source code. State what this module is built with:
- Language and version (e.g., Java 17)
- Module type: application (web app, microservice, CLI) or library (POJO library, SDK, shared utilities)
- Framework, if any (Spring Boot, Spring MVC, Quarkus, Micronaut, Vert.x, or none — plain Java)
- Packaging (JAR, WAR, etc.) and runtime expectations

If no framework — say so explicitly (e.g., "Plain Java POJO library, no framework").
Keep to a short list or single paragraph.>

## Component Diagram

<Mermaid diagram showing major components within this module.
Reference actual packages. Show how they interact with each other
and with external systems or other modules.>

## Package Structure

| Package | Purpose |
|---------|---------|
| `<top-level-package>` | <one-line purpose> |

<Table of all top-level packages with a one-line purpose for each.>

## Application Bootstrap

<**For service/application modules:**
How the application starts up:
- Entry point (main class, servlet descriptor, framework bootstrap, etc.)
- Configuration loading order
- Context/container initialization
Reference actual file paths for each configuration artifact.

**For library modules:** N/A — state "This is a library module with no standalone bootstrap."
If the library requires specific initialization by consumers (factory setup, context
registration, etc.), describe that here instead.>

## Entry Points

<What this module exposes to the outside world. The goal is to tell the reader
WHERE to look, not to catalog everything that exists.

**For applications with REST/HTTP APIs:**
- Core API packages — which packages contain controllers/resources/handlers
- Core API types — base controller classes, common request/response types, error models
- General URL structure and patterns
- API documentation mechanism (Swagger, OpenAPI, etc.)
- Do NOT list individual endpoints — describe where to find them

**For libraries / SDKs:**
- Key public interfaces and abstract classes that form the library's contract
- Main service classes consumers interact with
- Factory or builder classes used for initialization
- Package(s) that constitute the public API surface

**For message consumers / background processors:**
- Listener/consumer entry points
- Message types or topics handled
- Processing pipeline entry classes

In all cases: reference actual packages and classes, point to where they live.>

## Dependencies and Integrations

<How this module relates to other modules and external systems:
- Internal dependencies (other modules in this project, sibling libraries, SDKs)
- External systems (databases, caches, message brokers, cloud services)
- Key third-party libraries and what role they play

Table format: dependency → role.

**Data access layering (if this module consumes data systems):**
If this module accesses data through shared infrastructure libraries rather than directly,
describe the layering convention — which component owns each type of data access and what role
each system plays. Typical categories to address:
- Primary persistence (system of record) — which library/module provides the DAO layer
- Search/indexing — if treated as an index rather than a database, state that explicitly
- Caching/coordination — distributed cache, locks, topics
- Messaging — event bus / queue abstraction
- Analytics/warehouse — export or analytical query systems
- Blob/file storage — object storage abstraction
- Specialized stores (vector DB, graph DB, etc.)

For each category: name the module that owns it, the role it plays, and where new operations
of that type should be added. This tells the agent "don't put database code here — it goes
in the data layer module."

**Important:** Direct access to third-party storage systems (databases, caches, queues, etc.)
from application or business logic modules is not recommended. All data access should go
through the appropriate shared infrastructure library. If a needed operation does not exist
in the data layer, add it there — do not bypass the abstraction.

This subsection is only needed for modules that consume data systems indirectly.
Data layer modules themselves should use the Data Architecture section instead.>

## Data Architecture

<**Include this section only for modules that ARE data layer implementations** — modules that
define storage schemas, table structures, and database abstractions. Skip for modules that
merely consume data through a shared library.

If this module is a data layer, document:

**Storage model:**
- What database engine(s) does this module support or abstract over?
- Table / column-family / collection structure — key tables and their purpose
- Key types and partitioning strategy

**Multi-tenancy:**
- How tenancy is modeled (tenant-per-keyspace, tenant column, tenant-scoped DAO instances, etc.)
- Key tenant-related interfaces and where tenant isolation is enforced

**Abstraction pattern:**
- Interface / implementation split (e.g., interface module vs. backend-specific modules)
- How new backend implementations are added
- How consumers obtain DAO instances

**Schema management:**
- How schema changes are applied (migrations, auto-update hooks, version tracking)

If this module is NOT a data layer implementation, write "N/A — this module accesses data
through [name of data layer module]. See the Data Access Layering subsection in
Dependencies and Integrations."
>

## Configuration

<How this module is configured. Be specific — reference actual files and key properties.

**Configuration mechanisms:**
- Configuration files (properties, YAML, XML) — list actual file paths
- Environment variables that affect behavior
- Framework-specific configuration (annotations, descriptors, context files, etc.)
- Runtime vs. build-time configuration
- Profiles or conditional configuration

**Key configuration properties:**
- List the most important configuration properties/keys that control core behavior
  (e.g., database connection, feature flags, timeouts, external service URLs)
- Not every property — focus on ones a developer would need to understand or change
  when onboarding, debugging, or deploying
- Reference the file where each property is defined

If the module defines its own configuration model (e.g., a @ConfigurationProperties class,
a custom config loader, or a typed config object), reference those classes.>

## Deployment

<**For service/application modules:**
How this module is packaged and deployed:
- Packaging type and build output
- Runtime/container expectations
- Infrastructure dependencies
- Relevant deployment descriptors or scripts

**For library modules:** N/A — state "This is a library module, packaged as a JAR
and consumed as a Maven dependency. No standalone deployment.">

## Logging and Monitoring

<Observability approach:
- Logging framework and conventions (e.g., log4j, SLF4J) — state which is used
  and any project-wide conventions to follow (log levels, logger naming, etc.)
- Metrics collection and exposure
- Health checks / readiness probes
- Tracing integration
- Common practices for adding new observability

This section is relevant for all modules, including libraries. Even if a library
only uses a logging framework, state which one and what conventions to follow
so that new code maintains a consistent logging style across the project.>

## Concurrency Model

<Threading and concurrency approach for this module.

**For library modules:**
- Is this library designed for multi-threaded use? State explicitly whether it is
  thread-safe, partially thread-safe, or single-threaded only.
- Which components are NOT thread-safe? List classes or packages with known
  thread-safety constraints — this is critical for code review and testing.

**For application/service modules:**
- What are the main thread pools and execution contexts?
  (e.g., servlet request threads, scheduled task pools, event processing threads)
- Where are the entry points for each thread pool / runner?
  (e.g., which classes configure or launch background executors)
- What threading model does request processing follow?
  (synchronous on request thread, async dispatch, reactive, etc.)

Keep this at the architectural level — document what an agent needs to know to write
correct code and to review for thread-safety issues. Do not document individual
locks or synchronization blocks — that belongs in code-level Javadoc.

If concurrency is not a concern for this module (e.g., a pure data model library
with no mutable shared state), state "No concurrency concerns — stateless/immutable."
>

## Key Design Patterns

<Architectural patterns in use within this module.
Only document patterns that are structurally significant — not every use of a singleton or factory.
Explain why the pattern is used, not just that it exists.>

## Common Modification Recipes

<Recipes for the most common types of changes in this module.
Each recipe answers: "I want to do X — where does each piece of code go?"

A recipe is warranted when BOTH conditions are met:
1. **Structural pattern** — the change spans multiple files/packages in a repeatable way.
2. **Frequency** — the same pattern has been implemented multiple times already
   (existing examples can be pointed to).

Target 3-7 recipes per module. More are acceptable if genuinely needed, but if the list
grows beyond ~10, consider whether some recipes overlap or whether the module is too broad.

Cross-cutting conventions are good recipe candidates — e.g., "Add logging to a new class",
"Gate a feature behind a flag", "Emit a new metric". These tell the agent how to correctly
use shared infrastructure in new code.

Each recipe should include:
- **Name** — what you are doing (e.g., "Add a new REST endpoint")
- **Where to put things** — which packages/modules receive each layer of the change
- **Decision criteria** — when to choose option A vs B
  (e.g., "business logic goes in reltio-sdk if it is reusable across endpoints;
  stays in server if it is specific to the REST layer")
- **What NOT to do** — anti-patterns to avoid (e.g., "do not put business logic in controllers")
- **Example** — one existing implementation that follows the pattern (actual class/package name)

Format:

### <Recipe Name>

<Steps — ordered list of where to put each piece>

**Decision:** <when to choose between alternatives>

**Anti-pattern:** <what to avoid>

**Example:** `<existing class or package to use as reference>`

>

## Architectural Opportunities

<Forward-looking observations about what could be improved in this module.
This is NOT a backlog or issue tracker — it is actionable context for AI agents
and developers working on future features in this area.

Types of opportunities to document:
- **Consolidation** — module is too small to justify standalone existence,
  could be merged into a larger module (name the candidate)
- **Abstraction improvements** — leaky interfaces, callers depending on
  implementation details, overly coupled components
- **Circular dependencies** — modules or packages that depend on each other,
  creating coupling that makes changes fragile
- **Code duplication** — multiple components or classes implementing the same
  or similar logic, indicating lack of code reuse (name the duplicates)
- **Performance and threading concerns** — potential bottlenecks, thread-safety
  issues, blocking operations on hot paths, inefficient resource usage
- **Outdated patterns** — legacy approaches that should migrate to current standards
- **Structural debt** — code organization that makes changes harder than necessary

When an agent is building a new feature and touches this module, it should check
whether any listed opportunity is relevant to the current work and propose the
improvement alongside the feature — not as a separate effort.

If no opportunities are identified, state "None identified at this time.">
```

---

## Template: Test Module ARCHITECTURE.md

Use this for modules dedicated to testing (integration tests, E2E tests, test infrastructure). Adapt to the actual test stack discovered during exploration.

```markdown
# <Module Name> Architecture

> Audience: AI agents and human developers.

## Module Purpose

<What this test module covers, what it does NOT cover.
Which production modules/components it exercises.>

## Domain Concepts

| Term | Definition |
|------|-----------|
| <Term> | <1-2 sentence plain-language definition> |

<Same rules as the Module template: only terms relevant to this test module,
verified definitions, 5-15 terms max. Often inherits terms from the production
module(s) being tested — include them here if the test code uses them
in class/method names and they wouldn't be obvious.>

## Technology Stack

<Determined by reading pom.xml and source code. State what this test module uses:
- Language and version
- Test frameworks (JUnit 4, JUnit 5, TestNG, etc.)
- Application framework used for test context (Spring Test, Quarkus Test, Arquillian, or none)
- Notable test infrastructure (embedded databases, containers, mocking servers)

Keep to a short list or single paragraph.>

## Component Diagram

<Mermaid diagram showing test infrastructure:
suites, base classes, helpers, test configuration, fixtures,
and their relationship to production code being tested.>

## Test Framework and Tooling

<Testing stack used:
- Test frameworks (JUnit, TestNG, etc.) and versions
- Assertion libraries
- Mocking frameworks
- HTTP/service mocking tools
- Any other testing tools

Explain coexistence of multiple frameworks if applicable.>

## Test Organization

<How tests are organized:
- Package structure and naming conventions
- How test packages relate to production packages
- Naming conventions for test classes
- Where to find tests for a given production feature>

## Test Execution

<How tests are run:
- Maven plugin configuration (Surefire, Failsafe, etc.)
- Test suites and grouping mechanisms
- Tag/category-based inclusion/exclusion
- Parallel execution or partitioning strategy>

## Shared Base Classes and Utilities

<Common test infrastructure:
- Base test classes and what they provide
- Shared helpers and utilities
- Test configuration holders
- Reusable assertion helpers or matchers>

## Test Configuration

<How the test environment is set up:
- Configuration files for test contexts
- In-memory or embedded infrastructure (databases, queues, etc.)
- Test fixtures and test data
- System properties and environment configuration>

## CI/Pipeline Integration

<How tests integrate with CI:
- Maven profiles for test execution
- Coverage collection
- Test partitioning for parallel CI runs
- Post-test cleanup or reporting>
```

---

## Maintenance Protocol

When working on tasks in a project that has ARCHITECTURE.md files (outside of this skill), follow these guidelines:

**Detect structural changes:**
- New top-level packages added
- Configuration classes or entry points created, renamed, or moved
- New Maven profiles or significant dependency changes
- Changes to deployment descriptors or application bootstrap
- New test suites or significant test infrastructure changes
- New domain concepts introduced (new abbreviations in package/class names, new business terms)
- New structural patterns emerging (same multi-file change shape repeated for a third+ time without a recipe)

**When detected, suggest (do not auto-apply):**
> "The [description of change] may affect `<path>/ARCHITECTURE.md` — the [section name] section may need updating. Want me to update it?"

**Never:**
- Silently update ARCHITECTURE.md during unrelated tasks
- Add sections not defined in the templates above
- Remove existing sections even if they seem empty
