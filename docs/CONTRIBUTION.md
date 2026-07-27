# Contributing — feature workflow (OpenSpec)

This project uses **[OpenSpec](https://github.com/fission-ai/openspec)** for **spec-driven** work: new capabilities are captured as **changes** under `openspec/changes/` with **proposal**, **design**, **tasks**, and optional **spec deltas**.

**Prerequisites:** [INSTALLATION.md](INSTALLATION.md). **Architecture:** [ARCHITECTURE.md](../ARCHITECTURE.md) — read it before non-trivial work.

---

## Working in Cursor (how people actually run the workflow)

Most contributors should **not** start by memorizing shell one-liners. Use **Agent chat** in this repository and drive OpenSpec through **slash commands** wired in [`.cursor/commands/`](../.cursor/commands/).

This repo registers **four workflow commands** (names come from each file’s `name:` field):

| Slash command | Purpose |
|----------------|---------|
| **`/opsx-explore`** | Think through the problem: questions, tradeoffs, reading the codebase. **Not** for shipping implementation by default. |
| **`/opsx-propose`** | Create a change and generate **proposal**, **design**, **tasks** (and spec deltas when the schema requires them). |
| **`/opsx-apply`** | Implement **tasks** from `tasks.md` (agent checks boxes as it goes). |
| **`/opsx-archive`** | Optional final step: archive the change and sync main specs when the work is really done. |

**How to use them**

1. Open the **metadata-editor** folder in Cursor (workspace root = repo root).
2. Open **Agent** chat (or the chat mode your team uses with project rules/skills enabled).
3. Type **`/`** and pick the command from the list — search **opsx** if the menu is long.
4. After the command, add either a **kebab-case change name** or a **short natural-language description** of the feature. Examples:
   - **`/opsx-propose multi-tenant-tree-view`** — creates `openspec/changes/multi-tenant-tree-view/` and fills artifacts when the agent runs the workflow.
   - **`/opsx-propose Add quick search to the configuration tree`** — the agent derives a kebab-case id and scaffolds the same layout.

**What you should see after Propose**

Under `openspec/changes/<change-name>/` you typically get:

- `proposal.md` — what and why  
- `design.md` — decisions and constraints  
- `tasks.md` — checkbox implementation steps  
- `specs/` — delta specs when the **spec-driven** schema expects them  
- `.openspec.yaml` — change metadata for OpenSpec  

Then run **`/opsx-apply`** (optionally with the same change name if several changes are active). The agent uses the same instructions as the OpenSpec CLI, but **you stay in chat** — no need to paste `npm run openspec -- instructions apply …` yourself.

**Explore first when useful**

Use **`/opsx-explore …`** when the scope is fuzzy or architectural. When you are ready to lock intent into files, switch to **`/opsx-propose`**.

**Bugfix rounds (no separate slash command)**

There is **no** `/opsx-bugfix` entry in `.cursor/commands/`. For follow-up issues on an **existing** change, stay in Agent chat and:

- Describe that you want **bugfix mode** for change `<name>`, or  
- Rely on the repo skill **`openspec-bugfix`** ([`.cursor/skills/openspec-bugfix/`](../.cursor/skills/openspec-bugfix/)) so the agent follows the **collect → implement → test** loop and adds **Bugfix Round** sections to `tasks.md`.

**If your slash menu says something other than `/opsx-*`**

Cursor shows names from this repo’s command definitions. If you renamed commands locally or use another template (`/openspec …`), align with whatever appears **from this repo** under `.cursor/commands/` — that is what the team and CI expect.

---

## End-to-end flow

Steps are **ordered**; you can revisit earlier steps when you learn more.

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌─────────────────────────┐
│ Explore  │───▶│ Propose  │───▶│  Apply   │───▶│ Bugfix (as needed)      │
│ (think)  │    │ (docs)   │    │ (code)   │    │ collect → implement     │
└──────────┘    └──────────┘    └──────────┘    └───────────┬─────────────┘
                                                            │
                                                            ▼
                                                 ┌──────────────────────┐
                                                 │ Archive (optional)   │
                                                 └──────────────────────┘
```

| Step | What it is | In Cursor |
|------|------------|-----------|
| **1. Explore** | Clarify *what* / *why* / options **without** treating chat as a code dump. | **`/opsx-explore`** + context |
| **2. Propose** | Create `openspec/changes/<name>/` and artifact set. | **`/opsx-propose`** + name or description |
| **3. Apply** | Implement `tasks.md`, check boxes, compile/build. | **`/opsx-apply`** |
| **4. Bugfix** | New issues → new tasks → implement in batches. | Agent + **openspec-bugfix** skill |
| **5. Archive** | Optional: merge deltas, move change to archive. | **`/opsx-archive`** |

---

## Step notes (same workflow, a bit more detail)

### 1. Explore

- Prefer **questions and tradeoffs** over churning files.  
- **Read `ARCHITECTURE.md`** when touching structure or integration points.  
- Explore is **not** a substitute for **Apply** when you already know you want code — use **Propose** then **Apply**.

### 2. Propose

- Use **kebab-case** change ids when you supply a name yourself (e.g. `multi-tenant-tree-view`).  
- One **cohesive feature** per change keeps review and history readable.

### 3. Apply

- After **`/opsx-apply`**, keep **`npm run compile`** (and **`npm run build`** when needed) green locally.  
- Mark tasks **`- [x]`** in `tasks.md` as they complete.  
- If you add modules, commands, or wiring, **update `ARCHITECTURE.md`** in the same effort.

### 4. Bugfix

- Add tasks under **Bugfix Round** headings; update **`design.md`** only when a **decision** changes.  
- See the skill doc for the collect / apply / test rhythm.

### 5. Archive (optional)

- Safe to **merge code** before archiving; archive when you want **canonical specs** under `openspec/specs/` and fewer active changes.  
- **`/opsx-archive`** (or the archive skill) walks confirmations; incomplete tasks usually trigger warnings.

---

## Skills vs slash commands

| Mechanism | Role |
|-----------|------|
| **`.cursor/commands/` (`/opsx-*`)** | What you type in chat — thin wrappers that tell the agent which workflow to run. |
| **Skills** (e.g. under `.cursor/skills/`, `.claude/skills/`) | Deeper instructions the agent loads for **propose / apply / explore / archive / bugfix** behavior. |

Slash commands are the **friendly entrypoint**; skills are the **detailed playbooks**.

---

## General guidelines

- **Focused changes** — one OpenSpec change per feature when possible.  
- **Match existing style** in `src/`.  
- **No secrets** in specs or commits (tokens are in-memory in the app).  
- **Before PR:** `npm run compile`; `npm run build` if bundles or webview changed.  
- **PR description:** what / why, and the **OpenSpec change name**.

---

## OpenSpec CLI (terminal, CI, or when you prefer the shell)

The agent runs these under the hood. You only need them **by hand** for scripting, debugging, or if you are not using Cursor.

```bash
npm run openspec -- list
npm run openspec -- validate --changes
npm run openspec -- archive "<change-name>"   # optional; see --help
```

Scaffolding without the agent: `npm run openspec -- new change "<name>"`. For JSON/machine output, add flags from `npm run openspec -- <command> --help`.

---

## Related docs

| Doc | Role |
|-----|------|
| [INSTALLATION.md](INSTALLATION.md) | Node, npm, OpenSpec install |
| [README](../README.md) | Build, package, F5 debugging |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Structure and conventions |
