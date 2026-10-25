## 1. The registry module

- [x] 1.1 Add `src/workflow/workflowAdapterRegistry.ts`. No `vscode` import — pure data plus string handling, so `importDist()` can exercise it directly.
- [x] 1.2 Write `SHARED_ADAPTERS` keyed by adapter host with the environments it serves, in the source table's own shape (D2), and `DEDICATED_WORKFLOW_SUFFIX_ENVIRONMENTS` as a flat list for the `{label}-workflow.reltio.com` cases.
- [x] 1.3 Write `DEDICATED_IRREGULAR_ADAPTERS` for the six hosts the naming convention cannot reach — four `-workflow-adapter.reltio.com` and two `reltiocn.cn`.
- [x] 1.4 Write `ENVIRONMENT_ALIASES` (`approd-01` → `ap-360`) and `AMBIGUOUS_ADAPTERS` for the six environments the source answers two ways (D4).
- [x] 1.5 Build `ENVIRONMENT_TO_ADAPTER`, `AMBIGUOUS_BY_ENVIRONMENT` and `ALIAS_BY_ENVIRONMENT` as `Map`s at module load; never index the record literals directly (D3).
- [x] 1.6 Add `environmentLabel(name)`: trim, lowercase, strip scheme, strip path/query/fragment, strip the first matching domain suffix **longest-first** (D6), then apply aliases.
- [x] 1.7 Add `lookupWorkflowAdapterUrl(name)` returning `{ kind: 'url', host } | { kind: 'ambiguous', candidates } | undefined`, checking ambiguity before the index.
- [x] 1.8 Add `knownEnvironmentLabels()` for the test that asserts no label resolves two ways.

## 2. Resolution order

- [x] 2.1 Add `resolveAndSaveAdapterUrl(environmentName, tenantId, configUri)` to `src/extension.ts`, owning the whole order: registry → guess → prompt.
- [x] 2.2 Add `pickAmbiguousAdapterHost(environmentName, candidates)` — a QuickPick, `ignoreFocusOut`.
- [x] 2.3 Pass a registry hit through `toHttpsBase()` before saving (D5). On `UntrustedHostError`, show the message and open the prompt **pre-filled with the bundled host**.
- [x] 2.4 Only fall through to `guessWorkflowAdapterUrl()` when the lookup returned `undefined` — never after a dismissed ambiguity QuickPick (D4).
- [x] 2.5 Replace the inline three-way conditional in `reltio.fetchWorkflows` with the single call. Leave `reltio.refreshWorkflows` and the sidecar precedence untouched.

## 3. Tests

- [x] 3.1 Add `scripts/test-workflow-adapter-registry.cjs` covering Tier A items 1–10 in design.md's test plan.
- [x] 3.2 Use `setTrustedHostSuffixes()` from `reltioClient` for the allowlist assertions, matching `test-harden-reltio-client-base-url.cjs`.
- [x] 3.3 **Register the script in the hardcoded `SCRIPTS` array in `scripts/run-unit-tests.cjs`**, alphabetically. It is not a glob — an unregistered test silently never runs.

## 4. Docs

- [x] 4.1 Update `ARCHITECTURE.md` with the resolution order and the registry's location.
- [x] 4.2 `npm run compile` and `npm test` green.

## 5. Blocked on the source table's owner

- [ ] 5.1 Settle the four open questions in design.md; move any resolved environment out of `AMBIGUOUS_ADAPTERS` and add the `-g` rows.
- [ ] 5.2 Tier C manual QA per design.md's test plan.
