## Why

Connecting the Workflow Inspector to a tenant currently asks the user for the Workflow Adapter's base URL. Before asking, `guessWorkflowAdapterUrl()` tries one convention — take the environment's first hostname label, append `-workflow`, probe it — and uses it if the probe answers.

That convention is right for a minority of Reltio's environments and wrong, silently, for the rest. Reltio runs **nine shared adapters**, each serving several environments whose names have nothing in common with the adapter's: `gus-training`, `mpe-03` and `test-usg` all use `test-workflow.reltio.com`, and the guess for each of them is a host that does not exist. Six more environments use `-workflow-adapter` rather than `-workflow`, and two are not on `reltio.com` at all. For every one of those, the user is dropped into an input box and left to find a URL that Reltio has already written down.

The mapping is published — the "Workflow Environment to Reltio Environment Mapping" table in IRD / *Enabling Workflow Streaming for DPH*. Shipping it removes the question entirely for roughly sixty environments, and costs a table.

## What Changes

- **A bundled environment → adapter host table**, consulted before the live guess. A hit is instant, needs no token, and survives an environment that is temporarily unreachable — none of which is true of a probe.
- **The resolution order becomes registry → guess → prompt**, behind one function (`resolveAndSaveAdapterUrl`) rather than the three-way conditional that was inline in `reltio.fetchWorkflows`.
- **Environments the source table answers two ways are surfaced as a question, not resolved.** `mpe-01` and the `geu`/`eu-360` group read like a transposed pair of rows, and `tst-04-hf` appears both on a shared adapter and as its own. Both candidate hosts are real and answer like an Adapter, so the probe would confirm whichever it tried first and the user would never learn the other existed. An ambiguous hit shows a QuickPick and **skips the guess entirely**.
- **A bundled host still passes through `toHttpsBase()`.** Shipping a hostname grants it no trust: the two `reltiocn.cn` entries are refused by the default allowlist until an operator extends `reltio.trustedHostSuffixes`, and the prompt then opens pre-filled with that host so the message and the value it refers to are on screen together.

## Capabilities

**Code**
- **New files**: `src/workflow/workflowAdapterRegistry.ts` (pure data plus string handling, no `vscode` import), `scripts/test-workflow-adapter-registry.cjs`
- **Modified files**: `src/extension.ts` (`resolveAndSaveAdapterUrl`, `pickAmbiguousAdapterHost`, and the `reltio.fetchWorkflows` call site), `ARCHITECTURE.md`

**External API**
- None. This change removes network calls rather than adding them: a registry hit skips the probe `guessWorkflowAdapterUrl()` would have made.

**Tests**
- `scripts/test-workflow-adapter-registry.cjs`: label normalisation across scheme/case/path/domain-suffix spellings, every shared and dedicated row, aliases, ambiguity reported rather than resolved, no label resolving two ways, prototype-key misses, and the allowlist interaction for the `reltiocn.cn` entries.

**Docs**
- `ARCHITECTURE.md`: the resolution order and where the table lives.

**Not in scope (this change)**
- **Adding `reltiocn.cn` to the default `trustedHostSuffixes`.** Widening the credential-trust boundary for every user to serve two environments is a security decision, not a convenience one; the setting already exists for an operator who needs it.
- **Fetching the mapping at runtime.** A Confluence page is not an API, needs credentials this extension does not have, and would make first connect depend on a second service being up.
- **Resolving the ambiguous rows.** They need an answer from the source's owner, not a guess from us.
