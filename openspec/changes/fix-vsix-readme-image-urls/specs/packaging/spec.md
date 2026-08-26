## ADDED Requirements

### Requirement: README image and link URLs resolve to the public repo

The packaged `.vsix`'s `README.md` SHALL have every relative image reference rewritten to a `raw.githubusercontent.com` URL against the public `reltio-ai/reltio-ide` repository, and every other relative link rewritten to a `github.com/reltio-ai/reltio-ide/blob/main/...` URL, so that images render on VS Code's Extension Details page.

#### Scenario: Packaging rewrites a relative image path

- **WHEN** `npm run package` packages `README.md`, which contains `<img src="docs/images/reltio_logo.png">`
- **THEN** the packaged `readme.md` inside the `.vsix` SHALL contain `<img src="https://raw.githubusercontent.com/reltio-ai/reltio-ide/main/docs/images/reltio_logo.png">`

#### Scenario: Packaging rewrites a relative repo-relative link

- **WHEN** `README.md` contains a relative link such as `[Releases](../../releases)`
- **THEN** the packaged `readme.md` SHALL contain a link that resolves to `https://github.com/reltio-ai/reltio-ide/releases`
