# Tasks

Three items deviate from how they were first written; each says so in place, with the reason.

## 1. Java discovery (Tier A logic first)

- [x] 1.1 Add `src/workspace/workflowRepoJavaDiscovery.ts` exporting `discoverJavaSources(repoRoot: vscode.Uri): Promise<DiscoveredJavaSource[]>`, where `DiscoveredJavaSource` carries `fileUri`, `fullyQualifiedName`, `simpleName`, `packageName`, `moduleName`, `relativePath`, and `kind: 'main' | 'test'`.
- [x] 1.2 Match only paths beneath a `src/main/java` or `src/test/java` root (D2), skipping dotfolders as `discoverBpmnFiles()` does. **Deviation — the depth limit is not shared.** `workflowRepoDiscovery.ts` uses `MAX_DEPTH = 10`, borrowed from `l3Discovery.ts`; the provisioned template's deepest class (`workflow-external-dcr/.../services/beans/ChangeRequest.java`) already sits at exactly depth 10, so reusing that constant would silently drop classes for any customer one package level deeper. Java discovery uses 16, with the arithmetic recorded at the constant.
- [x] 1.3 Derive identity from the path only (D3): segments below the source root joined with `.` for the package, filename stem for the simple name. Do not read the file's contents.
- [x] 1.4 Resolve `moduleName` as the nearest ancestor directory containing a `pom.xml`, seeded with the repository folder name so a single-module repository with sources at its root still reports something.
- [x] 1.5 Skip `target/`, `node_modules/`, `build/`, `out/` outright. Not in the original plan: it makes "no build output in the tree" a guarantee rather than a near-certainty (a `target/generated-sources/.../src/main/java/` path would otherwise match), and avoids walking thousands of class files to find nothing.
- [x] 1.6 Add `scripts/test-workflow-repo-java-discovery.cjs` covering the Tier A cases in `design.md` §4. Registered in `scripts/run-unit-tests.cjs`.
- [x] 1.7 Extract the in-memory `vscode.workspace.fs` stand-in into `scripts/lib/memory-fs.cjs` and repoint `test-custom-workflow-repository.cjs` at it. Not in the original plan: that file's own comment flagged it as a generic helper "not (yet) promoted to `scripts/lib/`", and this change would have been its third copy. The existing test passing unchanged is the evidence the extraction is faithful.

## 2. Tree nodes

- [x] 2.1 **Deviation — one group class, three kinds, not a Java-only folder node.** The original plan named `WorkflowRepoJavaFolderNode`, which would have left BPMN as direct children of the repository row and Java behind folders: a mixed, lopsided row. `WorkflowRepoGroupNode` with `kind: 'bpmn' | 'javaMain' | 'javaTest'` gives the three peer groups `design.md` D1 describes, from one class.
- [x] 2.2 Add `WorkflowRepoJavaFileNode` following `WorkflowRepoBpmnFileNode`: label is the simple name, `description` is the package (or `(default package)`), `resourceUri` is the file, `command` is `vscode.open`, context value `reltio.workflows.customRepo.javaFile`, no mutating command (D6).
- [x] 2.3 Tooltip names the fully-qualified class, the owning Maven module, and the repository-relative path, via the existing `buildTooltip()`.
- [x] 2.4 Widen `WorkflowRepoNode`'s collapsible state to any discovered content — `trackedBpmnCount + javaMainCount + javaTestCount > 0` — since a Java-only repository is the provisioned default and previously rendered as a leaf. Its `description` and tooltip now report Java counts too.
- [x] 2.5 Resolve `design.md` §5: `Java Tests` starts collapsed, `BPMN` and `Java Classes` start expanded. Tests are opened when a coverage gate fails — a deliberate second step, not the default view.
- [x] 2.6 Omit an empty group entirely rather than render `(0)`, matching how `WorkflowDraftsFolderNode` is omitted on a tenant with no drafts. Without this, the provisioned repository would permanently show `BPMN (0)`.

## 3. Provider and cache

- [x] 3.1 Extend the node union in `src/tree/multiTenantTreeProvider.ts` with both new node types.
- [x] 3.2 Add `repoJavaSources?: DiscoveredJavaSource[]` to the per-tenant cache entry, preserved by each `mark*Loaded` method the way `repoFiles` already is. Both kinds live in one array and are split at render time, since one walk writes them together.
- [x] 3.3 Extend `markWorkflowRepoSync` with a sixth argument, and add `getCachedWorkflowRepoJava(environmentName, tenantId, kind)`.
- [x] 3.4 `getChildren` returns the non-empty groups from `WorkflowRepoNode`, and the file rows from each group.
- [x] 3.5 `getParent` maps a file row to its group and a group to the repository row — one level deeper than before, or `reveal()` on a file breaks.
- [x] 3.6 Add `invalidateWorkflowRepoSync()`, which drops cached badges while keeping the discovered file lists, and recomputes nothing.

## 4. Wiring and commands

- [x] 4.1 Call `discoverJavaSources()` alongside `discoverBpmnFiles()` in `refreshWorkflowRepoSyncState()`, both before `workflowCallContext()` — so the Java groups populate even on a tenant with no token or Adapter URL, where no badge can be computed at all.
- [x] 4.2 **Deviation — no `package.json` change was needed.** BPMN rows keep the `reltio.workflows.customRepo.file` context value and its existing menu entries. The group and Java rows need no menu at all: by D6 a Java row's entire contract is "open the file", and adding a command the spec does not call for would be scope the change did not agree to. (A read-only "Copy Class Name", for pasting an FQCN into `activiti:class`, is the obvious future candidate.)
- [x] 4.3 Widen all five repository command signatures to `WorkflowRepoNode | WorkflowCommandArgs`, narrowing through the existing `workflowCommandArgs()` and resolving through `resolveWorkflowTenant()` (D8): `reltio.connectWorkflowRepository`, `reltio.disconnectWorkflowRepository`, `reltio.openWorkflowRepoFolder`, `reltio.openWorkflowRepoInBrowser`, `reltio.refreshWorkflowRepoSync`.
- [x] 4.4 Keep the existing confirmations on connect and disconnect intact on the argument-object path.
- [x] 4.5 Add a watcher on `**/Workflows/Custom Workflows/**/*.xml` that invalidates cached sync state without fetching deployed XML (D7). It must glob `*.xml` rather than `*.bpmn20*.xml` because D4 forbids trusting filenames, so the handler filters against the files discovery actually found — otherwise saving a `pom.xml` would blank out the BPMN badges.

## 5. Skills

- [x] 5.1 Correct the Drafts path in `workflow-bpmn-authoring/SKILL.md` to `.reltio/<environment>/<tenantId>/Workflows/BPMN/<processId>.bpmn20.xml` — bare folder names, capitalised `Workflows/BPMN/`.
- [x] 5.2 Rewrite `workflow-repo-contribution/SKILL.md` around the in-IDE route: connect, what each group shows, edit Java in place, deploy a repository BPMN, re-check the badge. Every command named with its argument object. The manual clone-and-PR route is retained as a documented fallback.
- [x] 5.3 State up front that the IDE does not shorten Reltio's review, so the connected repository does not read as a way around the pipeline. Also records that the provisioned repository normally has no BPMN, so `BPMN` being absent is not a failed connection.
- [x] 5.4 Add an explicit next-step statement to **all four** workflow playbooks, not just the two being edited — the spec delta requires it of every workflow skill, and `workflow-jar-customization` and `workflow-local-adapter-setup` lacked one.
- [x] 5.5 No `.cursor/skills/` change needed: the pointers name canonical and materialized paths only, no new skill folder was added, and no path moved.
- [x] 5.6 Bump `skillsBundleVersion` to `"8"` — without this, `reltioAgentSync.ts`'s string-equality gate means the edits never reach an existing workspace.

## 6. Tests and docs

- [x] 6.1 Extend `scripts/test-custom-workflow-repository.cjs`: both node classes exported; the collapsible-state expression; a Java row carrying no mutating command; `getCachedWorkflowRepoJava`, `invalidateWorkflowRepoSync`, and the new `getChildren`/`getParent` branches in the provider; all five handlers referencing `workflowCommandArgs` **and** `resolveWorkflowTenant`; the repository watcher glob and its filtering handler.
- [x] 6.2 Extend `scripts/test-workflow-skills-library.cjs`: no playbook mentions `.reltio.environment` or `.reltio.tenant` or the lowercase drafts path; every playbook states a next step in Outputs; `workflow-repo-contribution` names three of the repository commands and describes both Java groups; `skillsBundleVersion` is `"8"`.
- [x] 6.3 Fix a Part 3 assertion the refactor broke: `markWorkflowRepoSync(...)` is now a wrapped six-argument call, so the single-line regex no longer described correct code.
- [x] 6.4 Update `ARCHITECTURE.md` — the `Workflows/Custom Workflows/` bullets now cover the groups, why a folder mirror was rejected, path-driven Java discovery and its distinct depth limit, the read-only no-reference-claims rule, and the second watcher.
- [x] 6.5 Add a `SUPERSEDED` note to `custom-workflow-repository`'s D7, since this replaces the node shape that change shipped days ago.
- [x] 6.6 `npm run compile` clean, `npm test` green — 35 scripts.
- [x] 6.7 `npx openspec validate workflow-repo-contents-and-agent-access --strict` clean.

## 7. Manual QA

- [ ] 7.1 Against the pushed test repository: connect, confirm `Java Classes (11)` and `Java Tests (7)`.
- [ ] 7.2 Open a class; confirm it is editable and saves normally.
- [ ] 7.3 Run `mvn package` in the repository; confirm no `target/` content appears in either group.
- [ ] 7.4 Edit a repository BPMN; confirm the badge clears rather than remaining `synced`, and that saving a `pom.xml` does **not** clear it.
- [ ] 7.5 Ask the agent to connect a repository and to deploy a repository BPMN; confirm neither silently no-ops.
- [ ] 7.6 Confirm a Java-only repository (no BPMN committed) still expands, since this is the provisioned default.
- [ ] 7.7 Confirm `Java Tests` starts collapsed and the other two groups start expanded.
