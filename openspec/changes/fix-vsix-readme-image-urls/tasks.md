# Tasks: fix-vsix-readme-image-urls

## 1. Package script

- [x] 1.1 Replace `--no-rewrite-relative-links` with `--baseContentUrl https://github.com/reltio-ai/reltio-ide/blob/main/ --baseImagesUrl https://raw.githubusercontent.com/reltio-ai/reltio-ide/main/` in the `package` npm script in `package.json`.

## 2. Verification

- [x] 2.1 `npm run package`; confirm the `.vsix` builds successfully into `target/`.
- [x] 2.2 Extract the built `.vsix` and inspect `extension/readme.md`: confirm every `<img src>` is rewritten to a `raw.githubusercontent.com` URL and other relative links resolve to `github.com/.../blob/main/...`.
- [x] 2.3 Confirm, via a live HTTP request, that a rewritten image URL actually resolves (`HTTP 200`, correct content type/size).

## 3. Pull request

- [ ] 3.1 Include in this branch's PR.
