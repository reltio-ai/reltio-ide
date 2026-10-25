# Design — workflow-row-hover-details

Refines the tree rows introduced by `workflow-inspector`. No new data is fetched.

---

## D1. Classification leads, in bold

**Decision.** The first line is `**Custom workflow**` or `**Built-in workflow**`, above Name, Process ID, Deployed by and Deployed.

**Rationale.** The hover is read at the moment someone is deciding whether to act on a row, and the consequence of acting differs by kind. Deploying an id that already exists produces version N+1 of a *live* workflow, and when that workflow is a Reltio built-in the change lands on behaviour the customer did not write and may not own. Everything else on the hover is identification; this is the part that changes what the user should do, so it goes first and is the only thing emphasised.

The previous ordering led with `Type:` — the process id, which is already the row's own description text and therefore the one fact the hover did not need to repeat first — and closed with `(Reltio built-in)` in parentheses, where it reads as a footnote.

## D2. Absent is absent

**Decision.** `formatTimestamp` returns `undefined` for a missing or non-finite value, and `buildTooltip` drops any field without a value.

**Rationale.** `isProcessDefinition` requires only `type`; every other field is optional at runtime whatever the interface says, because the guard is what the Adapter's rows are actually validated against. Passing a missing timestamp to `new Date()` yields the literal string `Invalid Date`, which a user reasonably reads as corrupt data on their tenant rather than a field the Adapter chose not to send. An omitted line says the same thing truthfully and takes less space.

A missing display name falls back to the process id rather than an empty `Name:`, since an unnamed definition still needs a human-readable handle.

## D3. Inline-only Markdown escaping

**Decision.** `escapeMarkdown` escapes `\`, `` ` ``, `*`, `_`, `[`, `]`, `<`, `>` — and not `.`, `-`, `#`, `+`, `!`, `(`, `)`, `{`, `}`, `|`.

**Rationale.** Escaping is necessary: a `displayName` is the customer's own `<process name="…">`, and an underscore or asterisk in it silently italicises the remainder of the line. The same reasoning as `escapeHtml()` in `src/ontology/inspectorHtml.ts`, for a different sink.

Over-escaping is the trap, and the first version of this change fell into it. The omitted characters are list, heading and table syntax — constructs that only exist at the start of a line — and every value here is preceded by its `Label: `, so none of them ever is at one. Escaping them anyway is not harmless noise: it renders `jane@acme\.com` and `com\.acme:workflow:1\.2\.0`, turning an email address and a module path into strings the user cannot copy out of the hover. A unit test pins both.

## D4. The tooltip stays untrusted

**Decision.** The `MarkdownString` is constructed with the default `isTrusted: false`, and a test asserts it.

**Rationale.** A trusted `MarkdownString` renders `command:` links, which execute extension commands on click. Every string in this tooltip is server-supplied — a display name, a deployer, a JAR description — so trusting it would make a tenant's data able to put a clickable command into the user's tree. Nothing here needs a link, so the safe default is also the sufficient one; the test exists because `isTrusted = true` is a one-line change that would look harmless in review.

## Test plan

**Automated (Tier A — extends `scripts/test-workflow-inspector.cjs`)**

| # | Assertion |
|---|---|
| 1 | The tooltip is a `MarkdownString`, not a plain string |
| 2 | `**Built-in workflow**` / `**Custom workflow**` is the first line, driven by `generic` |
| 3 | Name, Process ID, Deployed by and a rendered timestamp are all present |
| 4 | A row carrying only `type` omits the other fields entirely — no `Invalid Date`, no `undefined` — and falls back to the id for Name |
| 5 | Markdown metacharacters in a display name are escaped |
| 6 | An email address and a Maven module path survive escaping unmodified |
| 7 | `isTrusted` is false |
| 8 | Local-change state is reported below the identity block |
| 9 | A JAR row is headed `**Custom JAR**` and omits an absent description |

**Manual QA (Tier C)**

| # | Step | Expected |
|---|---|---|
| M1 | Hover a Reltio built-in definition | Bold **Built-in workflow** first, then the four fields |
| M2 | Hover a custom definition with local changes | Bold **Custom workflow**, fields, then the local-changes line |
| M3 | Hover a definition on a tenant where the Adapter omits `deployedBy` | The line is absent; nothing reads as an error |
| M4 | Hover a JAR | **Custom JAR** with module and registration details; the module path is copyable |

## Open questions

1. **Should the composite definition id (`review:3:4001`) also appear?** Its embedded version number answers "which version is live", which nothing else on the hover does. Against it: `Process ID` is the id the API, the filename and the deploy contract all use, and showing two ids invites the wrong one being pasted into a support ticket. Left off pending a user asking for it.
