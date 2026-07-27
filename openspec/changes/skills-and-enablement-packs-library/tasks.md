## 1. Repository layout and conventions

- [x] 1.1 Create `skills/reltio-default/` skeleton folders (`entity-type-concepts`, `relation-type-concepts`, `attributes-from-concept`, `match-groups-from-concept`, `workspace-merge`) with placeholder `SKILL.md` stubs referencing `design.md`.
- [x] 1.2 Document precedence (`skills/workspace/` overrides) in root `README` or `skills/README.md` for contributors and agents.
- [x] 1.3 Align Cursor discovery: add minimal pointers from `.cursor/skills/` (or documented symlink strategy) to default skills without duplicating full content.
- [x] 1.4 Implement extension logic per **D3b**: ship `reltio-agent-assets.json` with `skillsBundleVersion` / `velocityPacksBundleVersion`; materialize bundled skills (and packs if applicable) under `.reltio/reltio-agent/`; maintain `.sync-state.json`; on activation re-copy when either bundled version is newer than the stamp (never overwrite `skills/workspace/**`); optional “Resync Reltio agent assets” command.

## 2. Velocity Pack bundle infrastructure

**Inventory (repo):** eight packs under `resources/velocity-packs/<packId>/BusinessConfig.json` — `Account360`, `LSCustomer360`, `freetier-identity360-datavalidation`, `Identity360`, `LSProduct360`, `Consumer360`, `Product360`, `Insurance`. Combined `BusinessConfig.json` size is **~3.27 MB** (3269857 bytes) as of Insurance full vertical save; largest single file: **Insurance** (~1.15 MB), then `Account360` (~564 KB). Several packs use `referenceConfigurationURI` while still shipping substantial inlined config; manifest **`bytes`** / **`sizeTier`** must be updated whenever a pack file changes. Several packs ship `README.md` with Apache 2.0 boilerplate. `schemaVersion` in JSON varies (`1`, `1.1`, `2.2.5`, `dp_ins.1.5.0`, and two values with embedded note text on Identity360 / freetier packs — record verbatim in manifest).

- [x] 2.1 Add `resources/velocity-packs/manifest.json` (and optional `manifest.schema.json`) listing every pack: stable `id` (folder slug), `displayName` / `description` (from `BusinessConfig.json` `description`/`label` or folder), `businessConfigPath`, optional `readmePath`, `schemaVersion` (string as in file), optional `referenceConfigurationURI` when present, suggested `industry` or `vertical` tag for agent routing, `sizeTier` or byte length for “grep vs read excerpt” hints, and `packKind` (`full` | `referenceStub`) derived from file shape (e.g. stub = negligible model arrays vs reference + `sources` only).
- [x] 2.2 Add `resources/velocity-packs/README.md`: table mirroring manifest (pack id, one-line purpose, license pointer per pack README if present), redistribution note (aggregate Apache 2.0 where READMEs apply), and guidance that maintainers update manifest when packs are added or replaced.
- [x] 2.3 Normalize optional doc assets: either document accepted `readme.md` vs `README.md` or rename `Account360/readme.md` to `README.md` for consistency with other packs.
- [x] 2.4 Wire bundle version in shipped assets (see 1.4): set initial `velocityPacksBundleVersion` in `reltio-agent-assets.json` when that file exists; bump when manifest or any pack file changes.
- [x] 2.5 *(Optional)* Add a small maintainer script (e.g. under `scripts/`) to validate manifest paths exist, print total bytes, and optionally emit `schemaVersion`/source counts from each `BusinessConfig.json` to reduce manual drift.
- [ ] 2.6 *(Optional / future)* CI or script to refresh `resources/velocity-packs/` from an upstream export; baseline remains **manual** pack drop + manifest edit.

## 3. Guided-configuration skill content

- [x] 3.1 Author `entity-type-concepts/SKILL.md`: steps to inventory L3, evaluate `extendsTypeURI`, propose URIs/labels, tie to ontology commands.
- [x] 3.2 Author `relation-type-concepts/SKILL.md`: endpoints, reuse of existing relation types vs new, validation against `startObject`/`endObject`.
- [x] 3.3 Author `attributes-from-concept/SKILL.md`: suggest attribute sets using pack excerpts + collision rules with existing attributes.
- [x] 3.4 Author `match-groups-from-concept/SKILL.md`: rule placeholders, attribute URI checks, link to match group insert commands.
- [x] 3.5 Author `workspace-merge/SKILL.md`: how to layer `skills/workspace/**` over defaults and avoid silent conflicts.

## 4. Extension packaging and documentation

- [x] 4.1 Update `package.json` / VSCE `files` include list so `skills/**` and `resources/velocity-packs/**` ship in the VSIX (verify with `vsce package` dry run or inspect `.vsix` contents).
- [x] 4.2 Update `ARCHITECTURE.md` with “Agent skills & Velocity Packs” section: paths, manifest, update cadence, and how **Cursor Agent** uses them alongside deterministic extension features (no in-extension LLM).
- [x] 4.3 Add a short “Agent authoring” section linking to the three capabilities and how they map to `SKILL.md` playbooks.

## 5. Verification

- [x] 5.1 Manually verify packaged paths exist in built VSIX and `manifest.json` validates against a JSON schema (optional small schema file under `resources/velocity-packs/`).
- [ ] 5.2 Spot-check: open `L3.reltio.json` sample, follow one SKILL end-to-end in agent mode to confirm grounding steps are actionable. *(Human QA — not automated in this repo.)*
