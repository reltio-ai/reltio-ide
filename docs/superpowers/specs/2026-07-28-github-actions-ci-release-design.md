# GitHub Actions CI and Release Design

## Goal

Replace Jenkins-based CI for this VS Code extension with GitHub Actions:

1. Run the same install/build/test sequence as `Jenkinsfile` on pull requests and on `main`.
2. On every push to `main`, package a `.vsix` and publish it to GitHub Releases, committing the patch version bump back to the repo.

Sonar scan from Jenkins is out of scope.

## Decisions

| Topic | Choice |
|-------|--------|
| Workflow layout | Two workflows: `ci.yml` and `release.yml` |
| Test triggers | PRs + push to `main` (CI); release path also re-runs tests before packaging |
| Release trigger | Every push to `main` |
| Versioning | `npm run package` / `prepackage` (`npm version patch`); CI commits bump to `main` |
| Loop prevention | Version-bump commit message includes `[skip ci]` |
| Node version | 22 (aligned with `devops/Dockerfile`: `node:22.23.1-alpine3.24`) |
| Runner | `ubuntu-latest` |

## Workflow: `.github/workflows/ci.yml`

**Triggers:** `pull_request`, `push` to `main`.

**Job `test`:**

1. `actions/checkout`
2. `actions/setup-node` with Node 22 and npm cache
3. `npm ci`
4. `npm run build`
5. `npm run test`

No special permissions beyond defaults. No VSIX packaging.

## Workflow: `.github/workflows/release.yml`

**Triggers:** `push` to `main`, excluding commits whose message contains `[skip ci]` (so the version-bump commit does not re-trigger release).

**Permissions:** `contents: write` (commit bump + create release).

**Job `release`:**

1. Checkout (`fetch-depth: 0`) with a token that can push to `main`
2. Setup Node 22 + npm cache
3. `npm ci` → `npm run build` → `npm run test`
4. `npm run package` (runs `prepackage` → patch bump, then clean/build/`vsce package` into `target/`)
5. Read new version from `package.json`
6. Commit and push `package.json` and `package-lock.json` (if changed) with message `chore: bump version to X.Y.Z [skip ci]`
7. Create GitHub Release tagged `vX.Y.Z`, attach `target/*.vsix`

Use `GITHUB_TOKEN` (or equivalent) for push and release creation. Configure git `user.name` / `user.email` as a bot identity for the bump commit.

## Error handling

- Failed tests abort the job; no bump commit and no release.
- Failed packaging aborts before commit/release.
- If a release tag `vX.Y.Z` already exists, the release step should fail loudly rather than silently overwrite (default `gh` / action behavior).

## Out of scope

- Sonar analysis
- Publishing to VS Marketplace / Open VSX
- Manual `workflow_dispatch` release
- Tag-based release triggers
