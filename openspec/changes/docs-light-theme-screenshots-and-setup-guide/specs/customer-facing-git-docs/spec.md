## ADDED Requirements

### Requirement: Setup Guide and Walkthrough include Git as step 6

The in-product Setup Guide, its markdown twin, and the VS Code Walkthrough SHALL each include a sixth step that describes **Connect your Repository**, discovery of `BusinessConfig.json`, **Add Config** for other filenames, and tenant-vs-Git mutual exclusivity.

#### Scenario: Setup Guide JSON has six steps including Git

- **WHEN** `resources/setupGuide.json` is read
- **THEN** it SHALL contain six steps
- **AND** the sixth step's `id` SHALL be `connectGit`
- **AND** its body SHALL mention **Connect your Repository** and `BusinessConfig.json`

#### Scenario: Walkthrough mirrors Setup Guide step 6

- **WHEN** `package.json` `contributes.walkthroughs` is read
- **THEN** the `reltio.gettingStarted` walkthrough SHALL contain a step whose `id` is `connectGit`
- **AND** `featuredFor` SHALL include `**/BusinessConfig.json`

### Requirement: Customer docs use live command titles

README, QUICKSTART, and the Setup Guide SHALL use the command titles from `package.json` `contributes.commands` for Git and tenant configuration actions, not the pre-rename labels.

#### Scenario: Git and tenant action titles match package.json

- **WHEN** a customer-facing doc describes connecting a repository, adding or removing a config, fetching or applying configuration, or loading more history
- **THEN** it SHALL use **Connect your Repository**, **Add Config**, **Remove Config**, **Remove Repository**, **Get Configuration**, **Apply Configuration to Tenant**, **View Configuration History**, and **Fetch More Configuration History**

#### Scenario: Apply confirmation buttons match the extension

- **WHEN** README describes the apply-configuration confirmation
- **THEN** it SHALL name **View changes**, **Yes**, and **Don't apply** as they appear in `src/extension.ts`
- **AND** it SHALL NOT name **Keep File** or **Undo File** as Get Configuration choices

### Requirement: README screenshots exist at the packaged paths

Every relative `docs/images/...` path referenced from `README.md` SHALL exist in the repository so `vsce` rewriting against `main` resolves.

#### Scenario: README image files are on disk

- **WHEN** `README.md` contains `<img src="docs/images/....png">`
- **THEN** that file SHALL exist under `docs/images/`
