# Regression test proposals

Dev-only documentation tool. It is not part of CI, the unit-test gate or the VSIX. It generates no test code.

Per-area JSON files (one per product area) hold proposed regression tests. `build-workbook.py` validates them and writes one XLSX that developers review and edit.

## Regenerate

```
python docs/test-proposals/build-workbook.py
```

Options: `--dir DIR` (JSON folder, default `docs/test-proposals`), `--out FILE` (default `docs/test-proposals/regression-test-proposals.xlsx`), `--allow-missing` (skip area files that do not exist and skip the per-category minimum check). Requires Python 3 and `openpyxl`.

Validation collects every violation, prints them and exits non-zero without writing the workbook. Without `--allow-missing`, all 8 files must exist and each needs at least one Technical, one Functional and one Non-functional row. An area may opt out of a category with the object form:

```json
{"not_applicable": {"Non-functional": "reason"}, "rows": [ ... ]}
```

The reason must be non-empty. A plain array of rows is also accepted.

## Areas

| Area | File | ID prefix |
|---|---|---|
| Setup & Authentication | `setup-authentication.json` | `SETUP` |
| Business Configuration | `business-configuration.json` | `BIZCFG` |
| Tenant Explorer & UX | `tenant-explorer-ux.json` | `TREE` |
| Git Integration | `git-integration.json` | `GIT` |
| Workflows | `workflows.json` | `WF` |
| LCA | `lca.json` | `LCA` |
| Common Utils | `common-utils.json` | `UTIL` |
| Extension Activation | `extension-activation.json` | `ACT` |

## Row schema

Each row is an object with exactly these keys, all non-empty strings.

| Key | Meaning |
|---|---|
| `id` | `<PREFIX>-NNN` (3 digits), unique across all files, prefix matches the area |
| `module` | The area name, equal to the file's area |
| `source` | Source file path(s) under `src/` and function or behaviour area |
| `title` | Test title |
| `category` | Technical, Functional or Non-functional |
| `subtype` | Must belong to the category (below) |
| `scenario` | What is exercised |
| `expected` | Pass condition |
| `priority` | P1, P2 or P3 |
| `existing_coverage` | None, Partial or Covered |
| `target_script` | Proposed `scripts/test-<name>.cjs` |
| `status` | Proposed, Approved, Rejected or Implemented (new rows are `Proposed`) |

## Enums

- `category` / `subtype`: Technical -> Unit, Contract, Integration. Functional -> Feature, Workflow, Error handling. Non-functional -> Performance, Security, Reliability, Compatibility, Scalability.
- `priority`: P1 guards behaviour users depend on or a known coverage gap; P2 important; P3 nice to have.
- `existing_coverage`: None, Partial, Covered.
- `status`: Proposed, Approved, Rejected, Implemented.

## Stable IDs

IDs are the key used later to convert proposals into tests. Never renumber or reuse an ID; add new rows with the next free number.

## Source of truth

The XLSX is generated from the JSON files, and the JSON is the source of truth for regeneration. Edits made in Excel (status, comments, new rows) must be carried back into the JSON, or the XLSX becomes the new source by agreement. Regenerating overwrites the XLSX.

The Summary sheet reads source patterns, floors and the target from `scripts/module-coverage.config.json` and baseline line coverage from `coverage-baseline.json`. Its counts are live formulas over the area sheets.

## Priority rubric

- **P1**: security-sensitive (tokens, secrets, path traversal, untrusted input, injection), guards against data loss or overwriting user work, or is a core user flow or invariant, and existing coverage is None or Partial. A `Covered` row is P1 only if it is Security or data-safety.
- **P2**: important behavior or edge case, partially covered non-core flows, reliability and performance guards, contract checks between modules.
- **P3**: pins behavior an existing test already asserts (`Covered`, not security/data-safety), polish, rare edge cases, speculative or environment-dependent performance budgets.

Reviewers can re-rank by editing the `priority` column.
