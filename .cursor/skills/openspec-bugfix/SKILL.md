---
name: openspec-bugfix
description: Iterative bugfix workflow for an existing OpenSpec change. Use when the user wants to report issues, collect them as tasks, and then apply fixes in batches.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
---

Iterative bugfix collection and resolution for an existing OpenSpec change.

**Input**: Optionally specify a change name. If omitted, infer from conversation context or prompt.

---

## Workflow Overview

The bugfix workflow has two alternating phases:

```
┌──────────────────────────────────────────────────────────┐
│                     COLLECT PHASE                        │
│                                                          │
│  User reports issues one per prompt.                     │
│  Agent creates a task in tasks.md for each.              │
│  Agent updates design.md if fix changes a decision.      │
│  No code changes yet.                                    │
│                                                          │
│  Continues until user says "apply" / "implement" / "fix" │
└────────────────────────────┬─────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────┐
│                      APPLY PHASE                         │
│                                                          │
│  Agent implements all pending bugfix tasks.               │
│  Marks each task [x] as completed.                       │
│  Builds and verifies.                                    │
│                                                          │
│  When done, reports status and waits for testing.        │
└────────────────────────────┬─────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────┐
│                      TEST PHASE                          │
│                                                          │
│  User tests the fixes.                                   │
│  If new issues found → back to COLLECT.                  │
│  If satisfied → user says "done" / "finished".           │
│  Agent updates proposal.md if capabilities changed.      │
└──────────────────────────────────────────────────────────┘
```

---

## Steps

### 1. Select the change

If a name is provided, use it. Otherwise:
- Infer from conversation context
- Auto-select if only one active change exists
- If ambiguous, list changes and ask

Announce: "Bugfix mode for change: **<name>**"

### 2. Read existing artifacts

Read the change's artifacts for context:
- `openspec/changes/<name>/proposal.md`
- `openspec/changes/<name>/design.md`
- `openspec/changes/<name>/tasks.md`

Identify the current bugfix round number by scanning tasks.md for existing `## Bugfix Round N` sections. The new round is N+1.

### 3. Enter COLLECT phase

Announce the round:
```
## Bugfix Round N — Collecting Issues

Report issues one per prompt. When ready to fix, say "apply" or "implement".
```

**For each user prompt (one issue per prompt):**

1. Analyze the reported issue — identify root cause if possible
2. Add a task entry to `tasks.md` under the current round section:
   ```markdown
   ## Bugfix Round N
   
   - [ ] N.1 <concise issue title> — <brief root cause or description>
   - [ ] N.2 <next issue> — <description>
   ```
3. If the fix would change a design decision, update `design.md` (add or amend the relevant decision)
4. Acknowledge briefly: "Added as task N.X: <title>"
5. **Do NOT implement yet** — wait for more issues or the "apply" signal

### 4. APPLY phase (triggered by user)

When the user says "apply", "implement", "fix them", or similar:

1. Read the current tasks.md to get all pending tasks for this round
2. Use **TodoWrite** to track implementation progress
3. For each pending task in the round:
   - Announce which task is being worked on
   - Make the code changes
   - Mark the task complete in tasks.md: `- [ ]` → `- [x]`
4. Build and verify (run the build command, check for lint errors)
5. Check `ARCHITECTURE.md` — if any bugfix introduced structural changes (new packages, changed component relationships, new patterns), update the affected sections. Announce the update if made; skip silently if not needed.
6. Report completion:
   ```
   ## Bugfix Round N — Applied
   
   Fixed N tasks. Ready for testing.
   - [x] N.1 <title>
   - [x] N.2 <title>
   ...
   ```

### 5. TEST phase

After applying, wait for user feedback:
- **More issues found** → Start a new COLLECT phase (Round N+1)
- **User says "done" / "finished" / "looks good"** → Finalize:
  - Update `proposal.md` if any new capabilities were added or existing ones changed
  - Show final summary of all rounds

---

## Tasks.md Format

Bugfix tasks go after the original implementation tasks, in numbered rounds:

```markdown
## Bugfix Round 1

- [x] 1.1 Fix inspector close button — pointer capture on header blocks click event
- [x] 1.2 Fix edge clickability — CSS pointer-events: none applies to hit area path
- [ ] 1.3 Fix zoom reset on drag — render() calls fitViewBox() every time

## Bugfix Round 2

- [ ] 2.1 Inspector attribute tree needs indentation — nested details lack padding
- [ ] 2.2 Attribute format should be Name : Type — currently shows only name
```

---

## Design.md Updates

When a bugfix introduces or changes a design decision, add it to design.md:

```markdown
### D12: Edge hit area for click detection (Bugfix Round 1)
**Decision**: Each edge has an invisible 14px-wide path with `pointer-events: stroke` behind the visible 2px path.
**Rationale**: Thin SVG paths are nearly impossible to click. The wide invisible path provides a comfortable click target while the visible path remains thin.
```

---

## Guardrails

- **COLLECT phase**: Never implement code. Only update tasks.md and design.md.
- **APPLY phase**: Implement all pending tasks in the current round, then stop.
- **One issue per task**: Even if the user describes multiple things in one prompt, split into separate tasks if they are distinct fixes.
- **Root cause first**: When adding a task, try to identify the root cause, not just the symptom. This helps during APPLY.
- **Keep tasks.md as source of truth**: All bugfix work is tracked there.
- **Build after apply**: Always build and check for errors after implementing a round.
- **Don't auto-close rounds**: The user decides when testing is done.
