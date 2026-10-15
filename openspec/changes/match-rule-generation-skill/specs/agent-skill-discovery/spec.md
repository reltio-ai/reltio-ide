## ADDED Requirements

### Requirement: Bundled skills are discoverable without an @-mention
The extension SHALL install each bundled skill, with its companion files, at `.claude/skills/<name>/` in the workspace, where `<name>` is the skill's frontmatter `name`, and SHALL install a second copy in the running editor's own folder: `.cursor/skills/<name>/` in Cursor, `.github/skills/<name>/` in VS Code, none in other editors. Managed copies for an editor other than the running one SHALL be removed, together with folders the removal leaves empty. A skill whose `name` or `description` agents would reject SHALL NOT be installed and SHALL be reported.

#### Scenario: A fresh workspace
- **WHEN** agent assets sync in a workspace for the first time
- **THEN** `.claude/skills/reltio-match-groups-from-concept/` holds `SKILL.md` and `reference.md`

#### Scenario: Opened in Cursor after VS Code
- **WHEN** a workspace synced in VS Code is opened in Cursor
- **THEN** `.cursor/skills/` and `.cursor/rules/reltio-skills.mdc` are written
- **AND** the managed `.github/skills/` copies and Copilot guide are removed, while other files under `.github/` stay

### Requirement: Team overrides take precedence in the discoverable copy
A playbook under `skills/workspace/<playbook>/` SHALL be laid over the bundled default of the same playbook, file by file, before installing, so the team's files win and defaults it does not replace remain. An override SHALL keep the default's `name`; otherwise it SHALL be reported and nothing SHALL be installed for that playbook. A playbook only under `skills/workspace/` SHALL be installed as its own skill. The extension SHALL NOT write under `skills/workspace/`.

#### Scenario: An override replaces SKILL.md only
- **WHEN** `skills/workspace/match-groups-from-concept/SKILL.md` exists with the default's name
- **THEN** the installed `SKILL.md` is the team's
- **AND** the installed `reference.md` is the default's

#### Scenario: An override renames the skill
- **WHEN** the override's `name` differs from the default's
- **THEN** the user is warned and no copy of that playbook is installed

#### Scenario: An override is edited
- **WHEN** the team edits an override
- **THEN** the installed copy reflects the edit without a reload

### Requirement: An unchanged workspace is not rewritten
Each sync SHALL write only files whose content differs from what is installed, and SHALL remove files in a managed folder that the resolved skill does not contain.

#### Scenario: Nothing changed
- **WHEN** agent assets sync twice with no change to the bundle or the overrides
- **THEN** the second sync writes no files

### Requirement: Agents are told to report a missing skill instead of guessing
The extension SHALL write an always-on guide for Claude Code (`.claude/rules/reltio-skills.md`) in every editor, plus the running editor's guide: Cursor (`.cursor/rules/reltio-skills.mdc` with `alwaysApply: true`) or VS Code Copilot (`.github/instructions/reltio-skills.instructions.md` with `applyTo: '**'`). Each guide SHALL list every installed skill and SHALL tell the agent, when a needed skill is unavailable, to tell the user and name the command that restores it, rather than write the configuration from general knowledge.

#### Scenario: A skill has been deleted
- **WHEN** a managed skill folder is missing and the user asks for work it covers
- **THEN** the agent's guide instructs it to report the missing skill and the resync command

### Requirement: Only extension-owned paths are changed
The extension SHALL record every path it writes and SHALL never overwrite, delete or ignore a path it did not create. A managed path already occupied by something else SHALL be left untouched and reported to the user. Each owned path SHALL be added to the workspace `.gitignore` individually.

#### Scenario: The user already has a folder at a managed path
- **WHEN** `.claude/skills/reltio-workspace-merge/` exists and was not created by the extension
- **THEN** it is left as is and the user is warned

#### Scenario: Turning the feature off
- **WHEN** `reltio.installAgentSkills` is set to `false`
- **THEN** every owned path is removed
- **AND** every other file under `.claude/`, `.cursor/` and `.github/` is untouched

### Requirement: Sync problems are shown to the user
When agent assets cannot be synced, or a skill is rejected or blocked, the extension SHALL show a warning that offers to resync.

#### Scenario: Sync throws
- **WHEN** the sync fails with an error
- **THEN** a warning names the problem and offers **Resync Agent Assets**
