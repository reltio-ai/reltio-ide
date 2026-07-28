# GitHub Actions CI and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two GitHub Actions workflows that run Jenkins-equivalent install/build/test on PRs and `main`, and on each `main` push package a `.vsix`, bump the patch version, commit it, and publish a GitHub Release.

**Architecture:** `.github/workflows/ci.yml` owns PR/`main` verification. `.github/workflows/release.yml` owns the `main`-only package → version-bump commit → GitHub Release path, skipping commits whose message contains `[skip ci]`.

**Tech Stack:** GitHub Actions, Node 22, npm, `@vscode/vsce` (via existing `npm run package`), `softprops/action-gh-release`.

**Spec:** `docs/superpowers/specs/2026-07-28-github-actions-ci-release-design.md`

## Global Constraints

- Node version: `22` (aligned with `devops/Dockerfile`)
- Runner: `ubuntu-latest`
- CI steps: `npm ci` → `npm run build` → `npm run test` (same as `Jenkinsfile`; no Sonar)
- Release packaging: existing `npm run package` (includes `prepackage` → `npm version patch`)
- Version bump commit message must include `[skip ci]`
- Release tag format: `vX.Y.Z` from bumped `package.json`
- Do not overwrite an existing release tag

## File map

| File | Responsibility |
|------|----------------|
| `.github/workflows/ci.yml` | PR + `main` test pipeline |
| `.github/workflows/release.yml` | `main` test + package + bump commit + GitHub Release |

---

### Task 1: Add CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: existing npm scripts `build`, `test`; lockfile `package-lock.json`
- Produces: workflow that fails the GitHub check when install/build/test fail

- [ ] **Step 1: Create the workflows directory and `ci.yml`**

```yaml
name: CI

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Test
        run: npm run test
```

- [ ] **Step 2: Validate YAML parses**

Run: `python3 -c "import pathlib,yaml; yaml.safe_load(pathlib.Path('.github/workflows/ci.yml').read_text()); print('ok')"`

Expected: `ok` (if PyYAML is missing, use `node -e "require('fs').readFileSync('.github/workflows/ci.yml','utf8'); console.log('ok')"` as a smoke check that the file exists and is readable; prefer installing `pyyaml` only if needed)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
Add CI workflow for install, build, and test.

EOF
)"
```

---

### Task 2: Add release workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: same npm scripts as CI, plus `package` / `prepackage`; GitHub `contents: write`
- Produces: GitHub Release `vX.Y.Z` with `target/*.vsix` and a `[skip ci]` version-bump commit on `main`

- [ ] **Step 1: Create `release.yml`**

```yaml
name: Release

on:
  push:
    branches:
      - main

permissions:
  contents: write

jobs:
  release:
    if: ${{ !contains(github.event.head_commit.message, '[skip ci]') }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Test
        run: npm run test

      - name: Package VSIX
        run: npm run package

      - name: Read version
        id: version
        run: |
          VERSION=$(node -p "require('./package.json').version")
          echo "version=$VERSION" >> "$GITHUB_OUTPUT"
          echo "Bumped version: $VERSION"

      - name: Commit version bump
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add package.json package-lock.json
          git commit -m "chore: bump version to ${{ steps.version.outputs.version }} [skip ci]"
          git push origin HEAD:main

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: v${{ steps.version.outputs.version }}
          name: v${{ steps.version.outputs.version }}
          files: target/*.vsix
          fail_on_unmatched_files: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Validate both workflow files exist and look complete**

Run:

```bash
test -f .github/workflows/ci.yml && test -f .github/workflows/release.yml && \
  grep -q "npm run test" .github/workflows/ci.yml && \
  grep -q "npm run package" .github/workflows/release.yml && \
  grep -q "\[skip ci\]" .github/workflows/release.yml && \
  grep -q "softprops/action-gh-release" .github/workflows/release.yml && \
  echo ok
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "$(cat <<'EOF'
Add release workflow for VSIX packaging and GitHub Releases.

EOF
)"
```

---

### Task 3: Sanity-check packaging locally (optional but recommended)

**Files:**
- None created; exercises existing `package` script

**Interfaces:**
- Consumes: `npm run package`
- Produces: confidence that CI packaging step will succeed (do **not** commit a local version bump from this check)

- [ ] **Step 1: Dry-run awareness**

Do **not** run `npm run package` on a dirty tree if you intend to keep the working tree clean — it mutates `package.json` / `package-lock.json` via `prepackage`. Prefer verifying scripts exist:

```bash
node -e "const p=require('./package.json'); console.log(['build','test','package','prepackage'].map(s=>s+':'+(p.scripts[s]?'yes':'NO')).join('\n'))"
```

Expected:

```
build:yes
test:yes
package:yes
prepackage:yes
```

- [ ] **Step 2: If a full local package is needed, use a throwaway worktree or revert afterward**

```bash
git stash push -u -m "pre-package-check" || true
npm run package
ls target/*.vsix
git checkout -- package.json package-lock.json
git clean -fd target
```

Expected: at least one `*.vsix` listed under `target/` before cleanup; `package.json` version restored.

- [ ] **Step 3: No commit** unless Task 1/2 still have uncommitted workflow files.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| CI on PR + push to `main` | Task 1 |
| `npm ci` → `build` → `test` | Task 1, Task 2 |
| Node 22 / ubuntu-latest | Task 1, Task 2 |
| Release on push to `main` | Task 2 |
| Skip `[skip ci]` commits | Task 2 `if:` |
| `npm run package` + patch bump | Task 2 |
| Commit bump to `main` | Task 2 |
| GitHub Release `vX.Y.Z` + VSIX | Task 2 |
| No Sonar / Marketplace | (intentionally omitted) |
| Fail if tag already exists | default `action-gh-release` behavior (no `overwrite` / no force) |
