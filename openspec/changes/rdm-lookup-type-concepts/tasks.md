## 1. Skill

- [x] 1.1 `skills/reltio-default/rdm-lookup-type-concepts/SKILL.md`: when to use, name rule, duplicate check under any spelling, the entry Add a new Lookup Type writes, hand-off to Apply RDM Configuration, report
- [x] 1.2 Contributor pointer `.cursor/skills/reltio-rdm-lookup-type-concepts/SKILL.md`
- [x] 1.3 `reltio-rdm-lookup-values-from-csv` points to the new skill for a missing lookup type
- [x] 1.4 Raise `skillsBundleVersion` to `30`; update the pinned version and hash in `scripts/test-workflow-skills-library.cjs`

## 2. Tests and docs

- [x] 2.1 `scripts/test-rdm-lookup-type-concepts.cjs`: frontmatter and sections; the skill's entry equals `buildRdmLookupTypeObject` and validates against the RDM schema; duplicate check; never pushes; named commands and hand-off skills exist; pointer; bundle version. Registered in `scripts/run-unit-tests.cjs`
- [x] 2.2 `ARCHITECTURE.md`: the skill in the RDM authoring section
- [x] 2.3 `npm test`, compile; `npx openspec validate rdm-lookup-type-concepts --strict`

## 3. Manual QA

- [ ] 3.1 In Claude Code and in Cursor, ask "Add lookup type OrganizationStatuses" in a workspace with RDM: the entry is appended, nothing else in the file changes, and the reply says to run Apply RDM Configuration
- [ ] 3.2 Ask again: nothing is added; ask for `organizationstatuses`: the existing one is named and nothing is added
- [ ] 3.3 Apply RDM Configuration, then Get Configuration: the server returns the new lookup type
- [ ] 3.4 Load an export CSV whose type is missing: the CSV skill offers this skill
