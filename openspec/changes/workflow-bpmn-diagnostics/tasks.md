## 1. What the model has to read

- [x] 1.1 Add `length` to `BpmnFlowNode` and `BpmnSequenceFlow`, and `processTag` to `BpmnProcessModel`, so a finding can cover an opening tag (D2).
- [x] 1.2 Read a gateway's `default` attribute into `defaultFlow` (D2).
- [x] 1.3 Add `readTaskListeners`, scoped to the enclosing task rather than searched globally (D4).
- [x] 1.4 Restructure `extractFlowNodes` to sort candidates into document order **before** claiming ids, and record the rejected ones in `model.duplicates` (D3).
- [x] 1.5 Add `readPlaneElement` to `bpmnDiagram.ts` for the §10.11 plane check.

## 2. The rules

- [x] 2.1 Add `src/workflow/bpmnDiagnostics.ts`, `vscode`-free, returning offset-based findings with a `reltio-bpmn/<rule>` code (D1).
- [x] 2.2 Export the §5 allow-list, split by category and combined, so the skill and the editor cannot drift (D10).
- [x] 2.3 Implement §10.9 and §8: `isExecutable`, a missing process id, and the id against the file name.
- [x] 2.4 Implement §10.1 from `model.duplicates` plus the flows, reporting the later occurrence (D2, D3).
- [x] 2.5 Implement §10.2: missing and unresolvable `sourceRef`/`targetRef`, and a flow with no id.
- [x] 2.6 Implement §10.3 and §10.4, with the default-flow-condition finding on the **flow** (D2), and exclusive-only default checks.
- [x] 2.7 Implement §10.5 over every `userTask`, naming only the listeners actually missing (D4).
- [x] 2.8 Implement §10.6 as a warning, for both delegate and listener classes (D5).
- [x] 2.9 Implement §10.11: no diagram section as a single warning, a plane mismatch as an error, and a per-element warning for a missing shape.
- [x] 2.10 Return nothing at all when there is no `<process>` — a half-typed file is authoring, not eleven violations.

## 3. The editor adapter

- [x] 3.1 Add `src/workflow/bpmnDiagnosticsManager.ts` with its own `reltio-bpmn` collection, modelled on `diagnosticsManager.ts` (D1).
- [x] 3.2 Add `bpmnProcessIdForDocument`, filtering through `processIdFromBpmnFileName` so baselines are excluded (D7).
- [x] 3.3 Implement `resolveSeverity`: the setting moves the advisory findings, the definite ones stay errors (D6).
- [x] 3.4 Declare `reltio.bpmnDiagnosticsSeverity` in `package.json`, default `warning`, with `off` in the enum.
- [x] 3.5 Construct the manager in `extension.ts` and push it to `context.subscriptions`.
- [x] 3.6 Extend the three document listeners: debounced on change as a sibling branch of the JSON one, unconditional on activation, cleared on close (D8).
- [x] 3.7 Report on the already-active editor at activation, so a BPMN open from a previous session is covered.

## 4. The skeleton

- [x] 4.1 Add both `create` listeners to `buildBpmnSkeleton`'s `userTask`, after the `<documentation>` element (D9).

## 5. Tests

- [x] 5.1 Add `Position`, `Range`, `Diagnostic`, `DiagnosticSeverity` and `createDiagnosticCollection` to `scripts/lib/vscode-stub.cjs`, with the collection backed by a readable `Map`.
- [x] 5.2 Make the stub's `getConfiguration().get(key, fallback)` return the fallback, which is the real API's behaviour.
- [x] 5.3 Add `scripts/test-workflow-bpmn-diagnostics.cjs` with Tier A items 1–12, each asserting the covered text as well as the count (D2).
- [x] 5.4 Add Tier B items 13–20.
- [x] 5.5 Register the script in `scripts/run-unit-tests.cjs`.

## 6. Docs

- [x] 6.1 `ARCHITECTURE.md`: both new modules and a Key Design Pattern note on pure rules with a thin adapter.

## 7. Verify

- [x] 7.1 `npm run compile` and `npm test` green.
- [ ] 7.2 Tier C manual QA per design.md's test plan.
