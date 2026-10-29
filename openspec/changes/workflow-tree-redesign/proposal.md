## Why

The Workflows tree showed one workflow in up to three places (a deployed row, a Drafts row and a repository row), kept the repository behind a dedicated "Custom Workflow Repository" row, and split the customer's files across `Workflows/BPMN/` and `Workflows/Custom Workflows/`. A customer repository already keeps its BPMN under its own `bpmn/` folder, so the extension's drafts folder and the repository's BPMN could never be the same place. The assistant could also write Java with no repository connected, leaving code with nowhere to live.

## What Changes

- **Two default folders.** Workflows shows Process Definitions and JAR Deployments. Java Classes and Java Tests appear only once a repository is connected, as top-level siblings, and are always shown, even at zero. There is no Drafts folder and no repository row; connect, disconnect and status live on the Workflows row.
- **One merged Process Definitions list**, one row per process id, with six states: OOTB, custom clean, custom with local edits, custom that differs from the repository, custom not tracked in the repository, and not deployed (draft).
- **On-disk layout.** Drafts live in `Workflows/bpmn/`. The repository is cloned directly into `{tenant}/Workflows/`, so its own `bpmn/` is the drafts folder. The outside `BPMN/` folder and the JAR metadata folder are gone.
- **Connect adopts existing drafts.** `git clone` refuses a non-empty directory, so connect clones into a staging folder and adopts it into `Workflows/`: the generated placeholder README is replaced, `bpmn/` is merged file by file, and a modal tells the user which drafts became part of the working tree. Any clash refuses the whole adoption and changes nothing.
- **Java needs a connected repository.** The skills tell the user to connect first and write no Java until then.
- **Always group by module** under Java Classes and Java Tests, even for one module.

No migration: there were no earlier users of the old layout. The retired folders are added to the conservative prune list.

## Capabilities

### New Capabilities

- `workflow-tree-layout`: what the Workflows tree shows, where files live on disk, and how connecting a repository adopts them.

### Modified Capabilities
