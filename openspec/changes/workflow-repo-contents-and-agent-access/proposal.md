## Why

`custom-workflow-repository` connected the tenant's Reltio-provisioned repository and surfaced the BPMN files inside it. Testing it against a real provisioned repository exposed two gaps that make the connected repository less useful than the connection implies.

**The repository is mostly Java, and none of it is visible.** The provisioned `WORKFLOW REPO TEMPLATE` contains **no BPMN files at all** — four Maven modules, eleven main Java classes, seven test classes, four `pom.xml` files, and a pipeline directory. BPMN is something a customer may add; Java source is what Reltio actually hands them. So on a freshly provisioned repository the connected row expands to `BPMN (0)` and nothing else, while the eleven classes the customer was given — the entire reason the repository exists — have no presence in the tree. The files are fully readable and editable in VS Code's own Explorer, so this is a discoverability failure rather than an access one, but a customer who connected a repository *from the Reltio tree* reasonably expects to find its contents there.

**The feature is unreachable by an agent.** All five commands this capability added are declared as `(node?: WorkflowRepoNode) => { if (!node) return; }`. Invoked without a tree node — which is the only way an agent can invoke them — they return silently, doing nothing and reporting nothing. `workflow-agent-command-arguments` already solved exactly this for three authoring commands via `workflowCommandArgs()`; that pattern was simply not extended to this capability. Alongside it, `workflow-repo-contribution` still documents the pre-IDE manual path — clone by hand, open a PR, register the JAR — and never mentions that connecting, discovering, badge-checking, and deploying from the repository are now commands, so even an agent that could call them has no instruction to.

A third, smaller correctness bug surfaced with them: the Drafts filesystem watcher matches `**/Workflows/BPMN/*.bpmn20*.xml` only, so editing a BPMN **inside** the connected repository never refreshes its sync badge. The badge keeps asserting `synced` against content that has since changed, which is worse than showing no badge, because it is a confident wrong answer about whether the tenant matches the repository.

## What Changes

- **Two new flat groups under the connected repository row** — `Java Classes (n)` and `Java Tests (n)` — listing the repository's Java sources beside the existing `BPMN (n)`. Each row is labelled with the class's simple name and described by its package; clicking it opens the file in the ordinary editor.
- **Deliberately not a folder mirror.** An earlier draft of this work proposed reproducing the repository's directory tree faithfully. It is rejected here — see `design.md` D1. The provisioned repository's deepest source file sits nine levels down (`workflow-external-dcr/src/main/java/com/reltio/workflow/external/services/beans/ChangeRequest.java`), and the BPMN-to-Java relationship is many-to-many, so no nesting arrangement is both faithful and useful.
- **Java discovery follows the Maven source-root convention**, globbing `**/src/main/java/**/*.java` and `**/src/test/java/**/*.java`. Because that pattern structurally cannot match `target/`, `node_modules/`, or `.idea/`, the question of whether to honour the repository's `.gitignore` does not arise at all rather than being answered.
- **Test sources get their own group rather than being filtered out.** `workflow-jar-customization`'s review gate requires 80% coverage, which makes test files something the customer edits deliberately, not incidental scaffolding.
- **The five `custom-workflow-repository` commands accept a plain argument object** as well as a `WorkflowRepoNode`, reusing `workflowCommandArgs()` and `resolveWorkflowTenant()` from `workflow-agent-command-arguments` unchanged. No new argument-narrowing mechanism.
- **The Drafts watcher also covers the connected repository**, so a repository edit invalidates the sync badge instead of leaving a stale one.
- **`workflow-repo-contribution` is rewritten around the IDE path** — connect, discover, check the badge, deploy from the repository, edit the Java, then the PR — with the manual route kept as the fallback it now is. `workflow-bpmn-authoring`'s stale Drafts path (`.reltio/<env>.reltio.environment/<tenantId>.reltio.tenant/workflows/…`, wrong on both the folder suffixes and the folder name) is corrected to `Workflows/BPMN/`. Both skills gain an explicit next-step statement, so the agent ends a turn by naming the next action rather than stopping.
- **No new write paths.** Every node added here is a read-only label whose only action is `vscode.open`. Editing and saving go through VS Code's existing machinery.

## Capabilities

### Modified Capabilities
- `custom-workflow-repository`: the connected repository row gains Java and test groups beside its BPMN group; its five commands become agent-callable; its sync badge is invalidated by repository edits.
- `workflow-skills-library`: `workflow-repo-contribution` documents the IDE path; `workflow-bpmn-authoring`'s Drafts path is corrected; both state their next step.

## Impact

- **New files**: `src/workspace/workflowRepoJavaDiscovery.ts` (`discoverJavaSources()`), `scripts/test-workflow-repo-java-discovery.cjs`, `scripts/lib/memory-fs.cjs` (the in-memory `vscode.workspace.fs` stand-in, promoted out of `test-custom-workflow-repository.cjs` at its third consumer).
- **Modified files**: `src/tree/workflowNodes.ts` (`WorkflowRepoGroupNode`, `WorkflowRepoJavaFileNode`, and `WorkflowRepoNode`'s collapsible state), `src/tree/multiTenantTreeProvider.ts` (children, `getParent`, cache, badge invalidation), `src/extension.ts` (Java discovery, five command signatures, the repository watcher), all four `skills/reltio-default/workflow-*/SKILL.md` playbooks, `resources/reltio-agent-assets.json` (`skillsBundleVersion` 7 → 8), `scripts/test-custom-workflow-repository.cjs`, `scripts/test-workflow-skills-library.cjs`, `scripts/run-unit-tests.cjs`, `ARCHITECTURE.md`, and `openspec/changes/custom-workflow-repository/design.md` (a `SUPERSEDED` note on D7).
- **No `package.json` change.** BPMN rows keep their existing context value and menu entries; by D6 the Java rows carry no menu commands at all.
- **No new outbound API calls.** Nothing here talks to Reltio; it reads local files already on disk.
- **Dependencies**: `custom-workflow-repository` (the row, the sidecar, discovery, the badge), `workflow-agent-command-arguments` (`workflowCommandArgs()`, `resolveWorkflowTenant()`), `workflow-skills-library` (skill layout and the sync gate).

## Not in scope (this change)

- **A faithful folder mirror of the repository, and folder-chain compaction to make one navigable.** Rejected on design grounds, not deferred — D1.
- **Annotating a Java class with the BPMN files that reference it.** The extension parses `activiti:class` only, so shared helpers (`Utils`, `RulesApply`), classes bound via `activiti:delegateExpression` or a task listener, and every test class would read as referenced by nothing. A confident "unreferenced" label on a class central to its module is worse than no label — D4.
- **In-IDE Maven build or test execution with the review gate surfaced.** Explicitly parked: it is the largest piece of the original plan, it depends on a correctly configured local JDK 17 and Maven that the extension does not control, and a terminal already does it. Revisit when the Java loop has real usage.
- **Compare-with-deployed as a side-by-side diff**, and jumping between an `activiti:class` attribute and its Java file. Both plausible, neither needed to make the repository's contents usable.
- **Decoupling BPMN diagnostics from the filename.** `bpmnProcessIdForDocument()` still requires the filename stem to be a valid process id, so a customer file named `delete_review_v2.bpmn20.xml` gets no diagnostics despite `custom-workflow-repository` D4 having established that filenames carry no identity. A real inconsistency, carried knowingly: fixing it changes diagnostic behaviour for existing Drafts files and deserves its own change rather than riding along here.
