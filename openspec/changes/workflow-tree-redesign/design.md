## Context

Stacked on the tenant-menu change (PR #17). The repository sidecar `WorkflowRepo.reltio.json` keeps a `relativePath`; it now points at `Workflows`.

## Decisions

- **Stage, then adopt.** `git clone` refuses a non-empty target. The clone goes to `{tenant}/.reltio-ide/workflow-repo-staging` and `adoptStagedRepository` moves it into `Workflows/`. Planning is pure (`planWorkflowRepoAdoption`, same decide/do split as `planDeploy`); the I/O wrapper rolls back a failed move.
- **Atomic refusal, with one exception.** A clash (a user-written README, a same-named module, compared case-insensitively) refuses the whole adoption and lists every clashing path. Only this extension's generated README is replaceable, and `bpmn/` is the one folder merged. A BPMN in `bpmn/` that the repository also tracks is not a refusal: it is the normal case for a workflow deployed from the repository and downloaded here. The local copy is kept, the staged one dropped, and git shows the file as modified.
- **Baseline snapshots** (`*.bpmn20.baseline.xml`) are excluded through `Workflows/.git/info/exclude`, which is per clone and never committed, so the customer's repository gains no `.gitignore`.
- **One merge.** `mergeProcessDefinitionRows` is pure and generic over the file-location type. Precedence on a deployed custom row is local edits, then differs from repository, then not tracked. OOTB never gets "not tracked". When the repository scan was not run, nothing is judged untracked. A file seen by both scans under different ids keeps the content id (the repository scan trusts content, the local scan trusts the filename).
- **Deploy follows the file.** A row that differs from the repository deploys the repository file; a repository file whose content id differs from its filename is never deployed as a draft under the wrong id.
- **Pruning is case-insensitive.** `Workflows/BPMN` and `Workflows/bpmn` are one directory on Windows and macOS, so the retired-folder prune skips live paths by lower-cased comparison and never removes the `Workflows` leaf or the drafts folder.
- **Java is always grouped by module**, so the layout does not change when a second module appears.

## Risks

- A repository that already has a `bpmn/` file named like a local draft refuses to connect until one is renamed. The message lists the files.
- Screenshots in the README predate the layout and need recapturing by hand.
