## 1. SKILL.md

- [x] 1.1 Rewrite procedure step 7 to read the diagnostics, quote them and fix every finding, and to forbid restating the checklist as a self-assessment (D1).
- [x] 1.2 Name §10.7 and §10.10 in that step, each with the reason nothing in the file can answer it (D2).
- [x] 1.3 Replace the Outputs bullet "passes every item in §10, with the checklist reported item by item" with an empty report quoted as such, plus explicit answers to those two items (D2).
- [x] 1.4 Extend the `bpmn-rules.md` Inputs entry to say most of §10 is now enforced as you type, so it is what you write from rather than grade yourself against (D1).
- [x] 1.5 Keep the four H2 sections and the front matter exactly as they are — `test-workflow-skills-library.cjs` enforces both (D4).

## 2. bpmn-rules.md

- [x] 2.1 Add the §10 preamble: what **(checked)** and **(yours)** mean, and that a tool saying the file is clean is worth more than a claim that it is (D3).
- [x] 2.2 Mark each of the eleven items, keeping the numbering intact because `SKILL.md`, the test suite and the code comments all reference it (D3).
- [x] 2.3 Note on item 3 that the default must also be one of the gateway's *own* outgoing flows, which the rules now check.
- [x] 2.4 Note on item 6 that the class rule is a warning because the editor cannot see a customer JAR (D3).
- [x] 2.5 Split item 8: the id-versus-file-name half is checked, the intended-`processType` and DCR-id judgements remain the agent's (D3).
- [x] 2.6 Close with `reltio.bpmnDiagnosticsSeverity` and the fact that it cannot demote the hard failures (D3).

## 3. Bundle

- [x] 3.1 Bump `skillsBundleVersion` in `resources/reltio-agent-assets.json` from 3 to 4, so existing workspaces re-sync.

## 4. Verify

- [x] 4.1 `npm test` green — in particular `test-workflow-skills-library.cjs`, `test-skills-and-enablement-packs-library.cjs` and the §5 cross-check in `test-workflow-bpmn-diagnostics.cjs`.
- [ ] 4.2 Tier C manual QA per design.md's test plan.
