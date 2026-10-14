## Context

The workflow feature crosses three trust boundaries: the network (workflow adapter), the repository (a user-supplied git URL plus a committed sidecar that teammates and remotes can influence), and the agent (shipped skills that a model follows). The review treated each as hostile input.

## Decisions

### D1 — Credentials in a clone URL are rejected, not stripped

A URL such as `https://user:PAT@host/x.git` is refused with a message that points at SSH or the user's Git credential manager. Stripping would clone as a different identity than the user typed and hide the mistake. The same check runs when the committed sidecar is read: a sidecar whose `repoUrl` carries credentials is treated as invalid and reported, never used. Every URL shown in a message, tooltip or log goes through one `redactUrl()`.

### D2 — The XML is the source of truth for a draft's process id

The engine deploys the `<process id>` inside the XML. Confirmation, the built-in and live collision checks and `replacesLive` all use that id. When it differs from the filename the modal shows both, and when it matches a built-in flow the warning is the strong one. Blocking was rejected: a user who deliberately edited the id should be able to deploy it knowing exactly what happens.

### D3 — The committed sidecar is untrusted input

`WorkflowRepo.reltio.json` is committed, so a cloned tenant repository controls it. On read: `relativePath` must be a relative path with no `..`, no absolute prefix, no control characters or newlines, and is written to `.gitignore` only after validation; `repoUrl` must pass the clone allowlist and, to be opened in a browser, must be `https`. An invalid sidecar is reported once and ignored.

### D4 — Network hardening is at the choke point

`toHttpsBase()` returns the parsed origin and rejects userinfo, path and query. `redirect` is `error` for every adapter call. Response bodies are read through one helper that bounds time (the same timer that bounds headers) and size. `listAvailableJars` reuses `adapterHttpError` so `Retry-After` is not lost.

### D5 — Deploy target follows the tree row, not the cache

A definition row that is repo-tracked deploys the repo file; a downloaded draft deploys the draft. Local and repo states are tracked separately and combined only for the badge, so repo `clean` cannot hide local edits and repo `changed` cannot make Deploy read the wrong file.

### D6 — Tree state is explicit, not seeded

`markWorkflowRepoSync` no longer seeds `definitions: []` / `jars: []`; "not fetched" and "fetched, empty" are different states. Fetch generations are tracked per tenant as well as per kind, so an older combined load cannot overwrite a newer kind-specific result. The repository row's visibility does not depend on a saved adapter URL, and the sync state is refreshed on activation and tenant load.

### D7 — Diagnostics follow what Activiti rejects

A gateway is reported only when it has no outgoing flow, or is a pass-through with one incoming and one outgoing flow (a join with several incoming flows and one outgoing is valid). The type-listener rule is kind-aware: `dataChangeRequestReview` tasks need `DCRTypeTaskListener`; `potentialMatchReview` tasks need `EntityTypeTaskListener`; any other process needs one of the three type listeners.

### D8 — The entity-type gate is "verified only by construction"

It is built from confirmed pieces (the DCR fetch and `changes` structure from an official sample; `ExecutionService.setVariable(executionId, …)`), but has not been run against a tenant. The reference file says so once, plainly. The user-facing reply never carries that caveat (the voice rules forbid internal uncertainty), and no instruction asks the user to verify it.

### D9 — Reply contract precedence

`workflow-assistant` is the single owner of the reply shape. Gate and validation details in the other playbooks are for the agent's own work: reported to the user only when something failed and could not be fixed.

### D10 — Real sample code is embedded

`UpdateDcrReviewerListener` (Reltio's public `samples-custom-workflow`, `dcr-review-loop`) and `CaptureRequestor` (the customer-visible equivalent) are embedded in full in `java-patterns.md`, replacing promises of source that did not exist.

### D11 — Legacy cleanup deletes only what it can prove it wrote

Cleanup removes `.cursor/rules/reltio-workflows.mdc` and `.cursor/skills/reltio-*/SKILL.md` only when the file contains the exact text the extension wrote (`name: reltio-…-pointer` / the rule's `description:` line); the managed block in `AGENTS.md` / `CLAUDE.md` is removed by marker, all blocks, without touching the rest of the file. Cleanup runs on every sync, not only when skills were copied. Sync is serialized (one in-flight run) and failures are surfaced.

### D12 — Skills content is pinned to the bundle version

The test hashes `skills/reltio-default/**` and fails when the hash changes while `skillsBundleVersion` does not.

### D13 — Deploy's confirmation is scoped to the agent path, superseding D1/D2 of `workflow-agent-command-arguments`

**This supersedes a settled decision.** `workflow-agent-command-arguments/design.md` D1 states "the deploy confirmation cannot be bypassed by calling a different entry point, because there is no different entry point," and D2 calls it "the only unconditional prompt added." Live use showed that calibration had a real cost: a user clicking a tree row, the editor title bar, or the palette with nothing selected now gets asked to confirm a click they already made with their own eyes on a row that said "Deploy." `confirmedDeployPlan()` takes a `requireConfirmation` flag so that click can skip the modal.

The flag is derived structurally in `reltio.deployWorkflow`, not passed in by any caller: a `ProcessDefinitionNode`/`WorkflowDraftNode`/`WorkflowRepoBpmnFileNode` instance, a `vscode.Uri` (what the editor title bar actually passes), or no argument at all (palette, falls back to the active editor) all resolve to `false`. A `WorkflowCommandArgs` object naming a tenant and a process id — the one shape `vscode.commands.executeCommand` cannot produce from a human click, and the shape every shipped skill is written to pass (see `workflow-bpmn-authoring/SKILL.md` step 6) — resolves to `true` and still shows the modal unconditionally, with nothing able to suppress it. Validation (`plan.ok === false`) is unaffected either way.

**Known residual risk, accepted for now.** The signal is argument shape, not provable origin: anything able to call `vscode.commands.executeCommand('reltio.deployWorkflow', uri)` or with no arguments — not only a human — gets the same bypass as a real click, because VS Code's command dispatch carries no notion of "a human did this." Today's only agent-facing entry point is the documented `{ environmentName, tenantId, processId }` convention, so this is low-risk in practice. If the agent surface ever grows a generic command-execution tool, this should be revisited — tightening to `instanceof ProcessDefinitionNode | WorkflowDraftNode | WorkflowRepoBpmnFileNode` only (dropping the `vscode.Uri`/no-argument cases back to requiring confirmation) would close the gap at the cost of the editor-title-bar and bare-palette invocations no longer skipping the modal.

## Risks / Trade-offs

- Rejecting credentialed URLs breaks anyone who pasted a PAT-in-URL; the message explains the supported alternatives.
- `redirect: 'error'` fails a request that a legitimate gateway redirects; none is known for the adapter.
- Kind-aware listener rules rely on the process id to know the kind; custom ids fall back to "one of the three".

## Test plan

Behaviour tests per capability (see `specs/`), registered in `scripts/run-unit-tests.cjs`; the full `npm test` must pass; manual QA on a real tenant is listed in `tasks.md`.
