## 1. Tooltip helpers

- [x] 1.1 Add `escapeMarkdown(value)` to `src/tree/workflowNodes.ts` covering the inline constructs only — not `.`, `-` or `#`, which are line-start syntax and would mangle emails and module paths (D3).
- [x] 1.2 Add `formatTimestamp(epochMs)` returning `undefined` for a missing or non-finite value instead of the string `Invalid Date` (D2).
- [x] 1.3 Add `buildTooltip(heading, fields, footer?)` emitting a bold heading, then `Label: value` lines joined with a two-space Markdown line break, skipping any field without a value. Leave `isTrusted` at its default (D4).

## 2. Node classes

- [x] 2.1 Rewrite `ProcessDefinitionNode`'s tooltip: bold Custom/Built-in, then Name (falling back to the process id), Process ID, Deployed by, Deployed (D1).
- [x] 2.2 Keep the local-state sentence as the footer, below the identity block rather than inside it.
- [x] 2.3 Rewrite `JarDeploymentNode`'s tooltip the same way, headed **Custom JAR**, with Description omitted when absent.

## 3. Tests

- [x] 3.1 Add `MarkdownString` to `scripts/lib/vscode-stub.cjs` with `isTrusted` defaulting to false, so the security property is assertable.
- [x] 3.2 Add `ThemeColor` to the stub — `ProcessDefinitionNode` constructs one for the changed state, so the node could not be instantiated in a test without it.
- [x] 3.3 Extend `scripts/test-workflow-inspector.cjs` with Tier A items 1–9 in design.md's test plan.
- [x] 3.4 Include the over-escaping regression explicitly: an email address and a Maven module path must survive unmodified.

## 4. Verify

- [x] 4.1 `npm run compile` and `npm test` green.
- [ ] 4.2 Tier C manual QA per design.md's test plan.
