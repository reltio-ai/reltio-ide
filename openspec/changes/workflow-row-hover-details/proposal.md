## Why

A row in the Workflows tree shows a process id and little else. The hover was a plain newline-joined string that led with `Type:`, buried whether the definition is Reltio's or the customer's in a parenthesised afterthought at the bottom, and never showed the display name at all.

That ordering is backwards for the decision the user is actually making. Before acting on a definition, the thing they need first is whether it is a **built-in** or a **custom** workflow — because deploying an id that is already live does not create a new workflow, it replaces a running one, and doing that to a Reltio built-in has a blast radius the row gave no hint of.

Two smaller defects came with it. `new Date(deployTime)` renders the string `Invalid Date` when the Adapter omits the field, which reads like a data problem on the tenant rather than an absent optional value — and only `type` is guaranteed by the row guard, so every other field is genuinely optional at runtime. And a plain string tooltip cannot emphasise anything, so no amount of reordering would have made the classification stand out.

## What Changes

- **The tooltip becomes a `MarkdownString`** whose first line is a bold **Custom workflow** or **Built-in workflow**, followed by Name, Process ID, Deployed by and Deployed time.
- **Absent fields are omitted, not rendered empty.** No `Invalid Date`, no `undefined`. An unnamed definition falls back to its id rather than showing a blank Name.
- **Values are escaped for Markdown**, since a display name is the customer's own `<process name="…">` and an underscore in it would italicise the rest of the line. Escaping is inline-only: a full CommonMark escape set also takes `.`, which renders `jane@acme\.com` and turns an email into something that cannot be copied.
- **The tooltip stays untrusted** — the VS Code default. Every value in it is server-supplied, and a trusted `MarkdownString` renders `command:` links.
- **Registered JARs get the same treatment**, headed **Custom JAR**.

## Capabilities

**Code**
- **Modified files**: `src/tree/workflowNodes.ts` (`escapeMarkdown`, `formatTimestamp`, `buildTooltip`, and both node classes), `scripts/lib/vscode-stub.cjs` (`MarkdownString`, `ThemeColor`), `scripts/test-workflow-inspector.cjs`

**External API**
- None. Every field rendered is already fetched by `listProcessDefinitions` and `listJarDeployments`.

**Tests**
- Extends `scripts/test-workflow-inspector.cjs`: the bold classification leads, each field is present, a sparse row omits rather than empties, Markdown metacharacters are escaped while emails and module paths survive intact, and `isTrusted` stays false.

**Docs**
- None. The hover is self-describing and `ARCHITECTURE.md` does not enumerate tooltip content.

**Not in scope (this change)**
- **Showing the composite definition id** (`review:3:4001`). The version number in it is useful, but `Process ID` is what the API, the filename and the deploy contract all use, and two ids on one hover invites the wrong one being quoted. Recorded as an open question.
- **Hover content for draft rows.** A draft's facts are its filename and its path, both already visible.
