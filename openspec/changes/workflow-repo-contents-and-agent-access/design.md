# Design — repository contents and agent access

## 1. Problem shape

Three findings from testing `custom-workflow-repository` against a real provisioned repository, in the order they matter:

1. **The provisioned repository contains no BPMN.** Verified against `WORKFLOW REPO TEMPLATE` as Reltio ships it: four Maven modules, 11 main Java classes, 7 test classes, 4 `pom.xml`, a `pipeline/` directory, `bitbucket-pipelines.yml`, `repository.properties`, `scripts/`, `tests/`. Zero `.bpmn20.xml`. The BPMN files used during Part 3 testing were added by hand. So the row we shipped expands, on a real repository, to `BPMN (0)` — and the Java the customer was actually given is absent from the tree.
2. **Every command in the capability is inert to an agent.** All five are `(node?: WorkflowRepoNode) => { if (!node) return; }` (`extension.ts` 2179, 2257, 2288, 2299, 2315). No node, no effect, no message.
3. **The sync badge can be confidently wrong.** The watcher at `extension.ts:4535` matches `**/Workflows/BPMN/*.bpmn20*.xml`. The connected repository lives at `Workflows/Custom Workflows/`, so no edit inside it ever invalidates the badge.

## 2. Decisions

### D1 — Flat grouped lists, not a folder mirror

**Decision.** The repository row expands to flat groups by file kind — `BPMN (n)`, `Java Classes (n)`, `Java Tests (n)` — and never reproduces the repository's directory structure.

This reverses an earlier draft of this work, which proposed a faithful lazy folder mirror of the repository with single-child folder-chain compaction to keep it navigable. Three things killed it:

- **Depth.** The deepest source path in the provisioned repository is nine levels: `workflow-external-dcr/src/main/java/com/reltio/workflow/external/services/beans/ChangeRequest.java`. A faithful mirror puts eight expansions between the customer and a class. Compaction fixes the clicks but introduces a second, invented tree shape to explain and test.
- **The relationship is many-to-many, so no nesting is both faithful and useful.** `activiti:class` is an unscoped fully-qualified class name: one process references several classes, and one class can be referenced by any number of processes. The provisioned repository is built that way — `workflow-external-dcr` ships `Utils.java` and `RulesApply.java`, which exist to be called from more than one place. Nesting Java under the BPMN that uses it would either duplicate a shared helper under three parents or omit it.
- **It drags in a question with no good answer.** A folder mirror has to decide what to do about `target/` after the customer runs `mvn package` — four noisy generated subtrees in the middle of the thing they are navigating. Honouring `.gitignore` properly means a parser with negation patterns and nested ignore files, whose failure mode is files silently missing from the tree.

**Consequence.** The tree stops claiming to be a file browser. Anything the groups do not show — `pom.xml`, `pipeline/`, `repository.properties` — is reached through VS Code's own Explorer, or by the already-shipped `reltio.openWorkflowRepoFolder`, which reveals the repository root in the OS file manager. That is the honest division: the Reltio tree shows the files that have Reltio-specific meaning, and the Explorer shows the repository.

### D2 — Java discovery by Maven source-root convention

**Decision.** `discoverJavaSources()` globs `**/src/main/java/**/*.java` and `**/src/test/java/**/*.java` beneath the repository root, using the same depth limit and dotfolder skipping as `discoverBpmnFiles()`.

Not a directory walk filtered afterwards, and not content-driven the way BPMN discovery is. BPMN needed content-driven discovery because `custom-workflow-repository` D4 established that a customer's BPMN filenames carry no identity. Java is the opposite: the language and Maven both *require* that a class's location encode its package, so the path is authoritative and parsing the file adds nothing.

The load-bearing side effect is that this glob **cannot** match `target/`, `target/classes/`, `node_modules/`, `.idea/`, or a stray `.jar`. The `.gitignore` question is not answered; it is structurally absent. This is the main reason to prefer the convention glob over a walk-then-filter.

### D3 — Identity and labels come from the path, not from parsing Java

**Decision.** For a discovered path, the segment after `src/main/java/` or `src/test/java/` with separators replaced by `.` and `.java` stripped gives the fully-qualified class name. The label is the simple name; `TreeItem.description` is the package; the tooltip adds the owning Maven module (the nearest ancestor directory containing a `pom.xml`) and the repository-relative path.

No Java parser, no `package` declaration read, no regex over source text. If a file's `package` declaration disagrees with its directory, Maven will not compile it — so the path is not merely a cheap proxy for the truth, it *is* the truth for any file that builds.

### D4 — No BPMN-to-Java reference annotation

**Decision.** A Java row states its package and module. It does not state which BPMN files reference it.

The data to do this honestly does not exist. `bpmnModel.ts` extracts `activiti:class` (and bare `class`) and nothing else — verified, no `delegateExpression` handling anywhere in `src/`. So three categories of genuinely-used class would be reported as referenced by nothing: shared helpers invoked from other Java rather than named in any BPMN; classes bound through `activiti:delegateExpression` or a task/execution listener, both legal Activiti; and every test class. An "unreferenced" marker on `Utils.java` is a wrong answer delivered with the same confidence as a right one.

Revisit only alongside full delegate-binding extraction, which is a `bpmnModel.ts` change with its own diagnostics consequences.

### D5 — Test sources are a peer group, not filtered out

**Decision.** `Java Tests (n)` sits beside `Java Classes (n)` rather than tests being excluded or folded into one list.

`workflow-jar-customization`'s review gate requires 80% coverage. That makes test files something the customer opens and edits on purpose, in direct service of getting a PR merged — not scaffolding to hide. Keeping them in a separate group preserves the main-source list as the answer to "what does this module provide" while leaving the tests one click away.

### D6 — Read-only nodes, one action, no new write paths

**Decision.** Both new file nodes carry `command: vscode.open` and no mutating command. Editing and saving happen in the ordinary editor.

This is the property that makes the change cheap to be confident in: it adds no code that writes, moves, renames, or deletes a file, so the set of things it can break is bounded by the tree rendering. It also mirrors `WorkflowRepoBpmnFileNode`, which shipped days ago under the same constraint and is already covered by `scripts/test-custom-workflow-repository.cjs`.

### D7 — The watcher covers the repository, because a stale badge is worse than none

**Decision.** Add a second watcher pattern covering BPMN under `Workflows/Custom Workflows/`, feeding the same `notifyWorkflowDraftsChanged()` path.

`custom-workflow-repository` D5 deliberately chose not to recompute sync state on every save, and that stands — the badge comparison fetches deployed XML, which is not something to do on a keystroke. What is being fixed is narrower: an edit must *invalidate* the cached badge so it stops asserting `synced`, leaving the row to show no state until the next Refresh Sync. Invalidate on change; do not recompute on change.

### D8 — Agent access extends the shipped pattern rather than inventing one

**Decision.** The five commands take `WorkflowRepoNode | WorkflowCommandArgs`, narrowed by the existing `workflowCommandArgs()` and resolved by the existing `resolveWorkflowTenant()`.

`workflow-agent-command-arguments` already built and tested this for `reltio.newWorkflowDraft`, `reltio.duplicateWorkflowDraft`, and `reltio.deployWorkflow`, including the single-tenant no-prompt behaviour. Nothing about this capability's commands is different in kind. Connect and disconnect keep their own confirmations, which that change's reasoning supports directly: they are the irreversible ones.

### D9 — Skills describe the IDE path first, and always name a next step

**Decision.** `workflow-repo-contribution` is rewritten so the IDE route is the procedure and the manual clone-and-PR route is the documented fallback. `workflow-bpmn-authoring`'s Drafts path is corrected. Both skills end with an explicit next-step instruction. `skillsBundleVersion` goes 7 → 8.

The stale path is a straightforward defect: `workflow-bpmn-authoring` line 35 points at `.reltio/<env>.reltio.environment/<tenantId>.reltio.tenant/workflows/`, which is wrong twice over — `git-ready-tenant-folder-structure` dropped the `.reltio.environment` / `.reltio.tenant` suffixes, and `custom-workflow-repository` moved Drafts from `workflows/` to `Workflows/BPMN/`. An agent following it writes a file where nothing will find it.

The bundle version bump is mandatory, not hygiene: `reltioAgentSync.ts` gates the sync on string equality of `skillsBundleVersion`, so edited skill content does not reach an existing workspace without it.

## 3. Rejected alternatives

- **Faithful folder mirror with compaction** — D1. The shape the user initially asked for; withdrawn by them once the depth and duplication consequences were concrete.
- **Honour `.gitignore` in a mirror** — moot under D1, and independently risky: negation patterns and nested ignore files make "file mysteriously absent from the tree" the failure mode.
- **A pinned `BPMN (n)` summary group above a mirror** — moot under D1. Under flat groups the BPMN group *is* the pinned group.
- **One combined `Java (18)` group** — rejected by D5; conflates "what this module provides" with "what proves it works".
- **Parsing `package` declarations to build the class list** — rejected by D3 as strictly more work for no additional truth.

## 4. Test plan

**Tier A — pure logic, `scripts/test-workflow-repo-java-discovery.cjs`.** `discoverJavaSources()` over a temporary fixture tree: main and test sources separated; a `target/classes/**/*.java` file and a `target/*.jar` both absent from results; dotfolders skipped; the depth limit honoured; fully-qualified name, simple name, package, and owning module derived correctly for a nested package such as `com.reltio.workflow.external.services.beans`; a `.java` file outside any `src/{main,test}/java` root ignored.

**Tier B — structural, extending `scripts/test-custom-workflow-repository.cjs`.** The two group node classes and the Java file node class are exported from `workflowNodes.ts`; the provider handles each in `getChildren` and `getParent`; the new context values appear in `package.json` with the expected menu entries; each of the five commands' handlers references `workflowCommandArgs`; the watcher registration includes a `Custom Workflows` pattern. Extending `scripts/test-workflow-skills-library.cjs`: neither skill contains the string `.reltio.environment`; `workflow-repo-contribution` names `reltio.connectWorkflowRepository`; `skillsBundleVersion` is `"8"`.

**Tier C — manual, against the pushed test repository.** Connect; confirm `Java Classes (11)` and `Java Tests (7)`; open a class and confirm it is editable and saves; run `mvn package` and confirm no `target/` content appears in either group; edit a repository BPMN and confirm the badge clears rather than staying `synced`; ask the agent to connect a repository and to deploy a repository BPMN, confirming neither silently no-ops.

## 5. Resolved during implementation

**Default collapsed state.** `Java Tests` starts collapsed; `BPMN` and `Java Classes` start expanded. Tests are opened when a coverage gate fails, which is a deliberate second step rather than the default view.

**Empty groups are omitted, not rendered as `(0)`.** This was not in the original decision list and turned out to matter: since the provisioned repository has no BPMN, a permanently visible `BPMN (0)` would be the normal case. `WorkflowDraftsFolderNode` already sets this precedent for a tenant with no drafts.

**Java discovery does not share BPMN discovery's depth limit.** `MAX_DEPTH` is 16 rather than 10. The provisioned template's deepest class sits at exactly depth 10, so sharing the constant would have silently dropped classes for any customer one package level deeper — the failure mode being invisible absence, which is the worst shape available.

**The repository watcher has to glob `*.xml`, so it filters by discovery.** D4 forbids treating a filename as identity, so the watcher cannot narrow to `*.bpmn20*.xml`. That makes `pom.xml` match it, so the handler checks the changed path against the files `discoverBpmnFiles()` actually found: a `pom.xml` save must not blank out the badges, and an undiscovered file has no stale badge to clear anyway.
