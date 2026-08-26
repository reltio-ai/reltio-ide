## Why

`README.md` embeds images with plain relative paths (e.g. `docs/images/reltio_logo.png`). The `package` npm script passes `vsce package --no-rewrite-relative-links`, which tells `vsce` to leave those paths untouched instead of rewriting them to a public host. VS Code's Extension Details page renders the packaged README through a sanitizer that only allows `http:`/`https:` URLs for `<img src>` — a bare relative path has no protocol at all, so every image is stripped regardless of whether the file is bundled inside the `.vsix`. Users installing the extension see alt text or a broken-image placeholder instead of the Reltio logo and setup/ontology screenshots.

## What Changes

- Replace `--no-rewrite-relative-links` with `--baseContentUrl https://github.com/reltio-ai/reltio-ide/blob/main/ --baseImagesUrl https://raw.githubusercontent.com/reltio-ai/reltio-ide/main/` in the `package` npm script.
- `vsce` rewrites every relative `<img src>` in `README.md` to a `raw.githubusercontent.com` URL, and every other relative link to a `github.com/.../blob/main/...` URL, at packaging time. No `README.md` source changes.

## Capabilities

### Modified Capabilities

- `packaging` (introduced in `extension-packaging`): the packaged `.vsix`'s README now resolves image/link URLs against the public GitHub repo instead of leaving them unrewritten.

## Impact

**Code**
- `package.json`: the `package` npm script's `vsce package` invocation.

**External dependency**
- Extension Details page image rendering now requires network access to `raw.githubusercontent.com`/`github.com` at view time, and images are served from `main` rather than pinned to the installed version's tag (a known `vsce` limitation, not introduced by this change).

**Tests**
- None added. `scripts/test-extension-packaging.cjs` (from `extension-packaging`) doesn't currently assert on README URL rewriting.

**Not in scope**
- Pinning rewritten image URLs to a release tag/commit instead of `main`.
- CI verification that rewritten image URLs are live — noted as a follow-up in `design.md`.
