## Context

`package.json`'s `repository.url` points at the private internal Bitbucket mirror (`bitbucket.org/reltio-ondemand/reltio-ide`), which `vsce` would otherwise auto-detect and rewrite relative links against — resulting in a 404/auth wall for anyone outside Reltio's network. The `package` script pre-empted that by disabling rewriting entirely (`--no-rewrite-relative-links`), but that leaves the relative paths exactly as written in `README.md`, and VS Code's Extension Details page sanitizer strips any `<img src>` that isn't a `http:`/`https:` URL — there is no relative-path or `data:` fallback for that view. Net effect: no README images ever render on the Details page, independent of whether the image files are bundled inside the `.vsix`.

## Decision

Point `vsce`'s rewriting explicitly at the **public** GitHub mirror (`reltio-ai/reltio-ide`) instead of disabling it or letting it auto-detect the private `repository.url`:

- `--baseImagesUrl https://raw.githubusercontent.com/reltio-ai/reltio-ide/main/` for `<img src>` — GitHub's raw-content CDN, confirmed to serve the actual PNGs (`HTTP 200`, correct `Content-Length`).
- `--baseContentUrl https://github.com/reltio-ai/reltio-ide/blob/main/` for other relative links (e.g. the README's `[Releases](../../releases)`, which normalizes correctly through `blob/main/../../releases`).

**Alternatives considered and rejected:**

- **Bundle `docs/images/**` into the `.vsix`.** Doesn't work: the Details page's sanitizer (`domSanitize.ts`) validates `img[src]` by parsing it as a URL and checking the protocol against an allow-list — it has no concept of resolving a path relative to the installed extension folder. A relative path has no protocol at all, so it's rejected whether or not the file exists on disk. Confirmed both by reading VS Code's actual sanitizer source and by building/installing a test package with the images bundled — still broken.
- **Inline images as base64 `data:` URIs.** Doesn't work: the Details page's sanitizer config only overrides `allowedLinkProtocols` (for `<a href>`); `allowedMediaProtocols` (which governs `img src`) falls through to the hard-coded default of `[http, https]`, with no `data:` fallback for this specific view. Confirmed the same way — source trace plus a built/installed test package with base64-inlined images, still broken.

## Risks / Trade-offs

- Images depend on network access to `github.com`/`raw.githubusercontent.com` at Details-page view time, and on `main` still having the same files at the same paths — `vsce` doesn't pin to the release tag. This matches how the majority of Marketplace extensions handle README screenshots, since the Marketplace itself doesn't serve local extension assets either.
- If `docs/images/*` is ever renamed or moved without updating the README references, this would silently ship broken image links again; not caught by any existing test.

## Migration Plan

None — purely a packaging-time behavior change; no runtime code path is affected. Rollback is reverting the one-line `package.json` script change.

## Open Questions

- Optional follow-up: extend `scripts/test-extension-packaging.cjs` with a live HEAD request against each rewritten image URL, to catch a future path mismatch before it ships.
