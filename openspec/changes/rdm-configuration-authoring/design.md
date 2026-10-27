## Context

Three changes built the RDM sub-tree as a read-only view. That property was not incidental — it is the stated reason the nodes live in a `reltio.rdm.*` namespace instead of reusing `ConfigTreeItem`, because `reltio.deleteNode` and `reltio.renameNode` attach to `/^reltio\.item\./` by regex and edit whichever document `tenantL3Uri` names. Making RDM writable therefore has to be done carefully: the namespace separation must survive, because the danger it guards against is unchanged.

What already exists and can be reused:

- **`RDM.{rdmTenantId}.reltio.json`** on disk, bound to its own schema, which is permissive about unrecognized properties.
- **`RDM.{rdmTenantId}.remote-baseline.reltio.json`**, written on every successful fetch. `rdm-configuration-fetch` D8 recorded it as "not wired into Apply", adding: *should RDM write-back ever be scoped, the oracle it needs is already on disk.* This change is that scoping.
- **The L3 insert machinery** — `nextDefaultLabel(prefix, existingLabels)`, pure `build…Object(label)` builders, `insertIntoArray(documentUri, ast, path, jsonText)` and `revealInsertionInEditor` — which together implement the no-wizard insert pattern.
- **The L3 apply flow** — `hasUnpublishedLocalChanges`, `remoteMatchesBaseline`, `openRemoteVsLocalDiff`, `confirmAfterReview` — and `formatPutConfigurationFailureMessage`, which turns Reltio's error body into something a user can act on.
- **`recallRdmServiceUri` / rediscovery**, added by `rdm-lookup-values`, which already solves "where is the RDM service" at command time.

## Goals / Non-Goals

**Goals:**

- Add a lookup type or a source without leaving the IDE or hand-writing JSON.
- Push the edited configuration back, with the same protection against clobbering a concurrent change that L3 Apply provides.
- Keep every JSON edit AST-based, so commas, nesting and formatting survive.
- Keep the L3 edit commands structurally unable to reach an RDM node, exactly as before.

**Non-Goals:**

- **Delete and rename for RDM entries.** This adds authoring of new blocks. Removing or renaming one is hand-editing the file, as it is today.
- **Editing lookup values.** The values endpoint stays read-only; only the configuration document is writable.
- **A creation wizard.** The repository's `no-create-wizards` capability settled this: insert a named skeleton, let the user edit it in the document.
- **Validating a new entry against the server before Apply.** The RDM schema validates shape locally; semantic rejection is the server's answer to the PUT, surfaced from its error body.
- **Partial or per-entry push.** The endpoint takes the whole configuration; Apply sends the file.

## Decisions

### D1: Reuse the L3 insertion machinery, parameterizing what is L3-specific

`insertIntoArray` is already document-agnostic: it takes a URI, an AST and a path. Only one thing in it is L3-specific — `BOOTSTRAP_ROOT_ARRAY_KEYS`, the allowlist of top-level arrays it is willing to create when the document does not declare them. That set becomes a parameter, and the L3 callers pass their existing set.

**Alternative considered — a separate RDM insertion implementation:** rejected as duplicating subtle, already-tested logic (insertion-point calculation, comma handling, indentation, the missing-array bootstrap) for no benefit. The earlier decision to keep RDM *nodes* out of `ConfigTreeItem` was about menu-command bleed through context values, not about JSON editing, and does not argue for a second insert routine.

There is a trap worth naming: `sources` is already in the L3 allowlist, and is also an RDM section. Reusing the L3 set unchanged would make "Add a new Source" appear to work on an RDM document while `lookupTypes` silently failed. Passing the allowlist in makes each caller declare what it may create.

### D2: Skeletons match the shapes supplied, with a default unique label

```json
{ "uri": "rdm/lookupTypes/LookupType1", "label": "LookupType1",
  "enabled": true, "startDate": 0, "endDate": 0 }

{ "uri": "rdm/sources/Source1", "label": "Source1",
  "abbreviation": "Source1", "canonicalValueProvider": false }
```

The label comes from `nextDefaultLabel('LookupType', existing)` / `nextDefaultLabel('Source', existing)`, so a second insert yields `LookupType2` — the same behaviour as the L3 inserts, and the reason `uri`, `label` and `abbreviation` agree on first insert.

`uri` is the identity an L3 `lookupCode` references and the RDM schema requires it, so it is always written rather than left blank.

### D3: Add commands on the section folder and on the RDM tenant row

Both commands appear on the `{rdmTenantId}` row; each appears additionally on its own section folder.

The folder alone is not sufficient, and the reason is a property of the existing tree: `getRdmRootChildren` omits sections that are absent or empty. A configuration with no `sources` key therefore has no Sources folder, so there would be no way to create the first source through the UI. Offering both commands on the tenant row closes that hole, and D1's parameterized bootstrap is what lets the insert create the array.

**Alternative considered — always render empty section folders:** would also close the hole, but changes the browsing view for every tenant to serve an authoring case, showing `Sources (0)` on tenants that will never have one.

### D4: Apply mirrors the L3 pre-flight rather than pushing directly

**Apply RDM Configuration** on the `{rdmTenantId}` row:

1. save the document if dirty;
2. require a baseline — without one there is no evidence about what the server held, so Apply refuses and asks for a fetch first, exactly as L3 Apply does;
3. re-fetch the remote configuration and compare it against the baseline;
4. if the server still matches the baseline, confirm, with **View changes** available;
5. if it has drifted, require review of a remote-vs-local diff before an explicit confirmation;
6. PUT the local file;
7. on success refresh both the RDM file's baseline and, since the pushed content is now the server's content, leave the file itself untouched.

**Alternative considered — confirm and PUT:** rejected. The whole-document PUT means a colleague's concurrent change to that RDM tenant is replaced wholesale, and without step 3 the user is never told. The baseline needed to detect that is already written on every fetch; not using it would be choosing to discard evidence the extension already has.

**Alternative considered — PUT with no prompt:** rejected outright. A misclick on a tree row would push configuration to a live service.

### D5: The namespace separation survives, and is now load-bearing in both directions

RDM gains commands, but they are scoped to `reltio.rdm.folder.lookupTypes`, `reltio.rdm.folder.sources` and `reltio.rdm.root`, and they edit the RDM document. The L3 `reltio.item.*` commands remain unable to match an RDM context value.

The regression test from `rdm-tree-view` — that no RDM context value matches `/^reltio\.item\./` — stays exactly as it is. It is more important now, not less: previously a leak would have offered a destructive command on read-only data; now the RDM document is writable, so a leak would mean an L3 edit command operating on whichever document `tenantL3Uri` happens to name while the user believes they are editing RDM.

### D6: Apply reuses the Reltio error-body formatter

`putRdmConfiguration` fails through the same `formatPutConfigurationFailureMessage` used by `putL3Configuration`, which extracts `errorMessage` / `errorDetailMessage` / `errorCode` from Reltio's JSON error body and falls back to the raw text.

Whether the RDM service returns that same error envelope is unverified. The formatter already degrades to the trimmed response body when the shape does not match, so reusing it is strictly better than a bare status code, and is not a bet on the shape.

### D7: The PUT body is the file's bytes, not a re-serialization

Apply sends the document text as-is. Re-serializing through `JSON.parse`/`stringify` would silently normalize whatever the user wrote and make the pushed payload differ from the file they are looking at.

## Risks / Trade-offs

- **[Risk]** Exporting `insertIntoArray` and parameterizing its allowlist touches a path every L3 insert command uses → **Mitigation**: the change is mechanical — the existing set is passed by the existing callers — and the L3 insert tests (`no-create-wizards`, `insert-interaction-type`, `attribute-skeleton-mandatory-fields`, `skeleton-fixes-and-ux-polish`) cover those paths and must stay green.
- **[Risk]** Apply pushes the whole configuration, so any unrelated local edit in the file is pushed too → **Mitigation**: inherent to the endpoint, and the same property L3 Apply has. The pre-flight diff shows the user exactly what differs before they confirm.
- **[Risk]** A user adds an entry, never applies, then re-fetches — losing the edit → **Mitigation**: already handled. The fetch drift guard warns when an RDM file differs from its baseline and names the file, which is precisely this situation.
- **[Risk]** The RDM service may reject a schema-valid entry for semantic reasons the IDE cannot know → **Mitigation**: surfaced through the error body (D6) rather than pre-validated; the local schema stays permissive, as decided in `rdm-configuration-fetch` D11.
- **[Trade-off]** No delete or rename for RDM entries, so authoring is additive-only through the UI. Accepted for this change: insertion plus push is the loop the user asked for, and deletion through a tree that has no per-entry AST removal yet is a larger piece of work.

## Migration Plan

Additive apart from the internal `insertIntoArray` signature change, which has no user-visible effect. No file formats or stored state change; a tenant whose RDM files are never edited behaves exactly as before. Rollback is a plain revert — the three commands disappear and the sub-tree returns to browse-only, with any locally added entries still in the file and still valid.

## Open Questions

None blocking. One to confirm from the first live Apply: whether the RDM service returns the same error envelope as the MDM configuration endpoint (D6). The formatter degrades safely either way, so this is an observation to make, not a decision to take first.

## Test plan

| Tier | Script / Method | What it covers |
|------|------------------|-----------------|
| A (automated) | `scripts/test-rdm-configuration-authoring.cjs` | `buildRdmLookupTypeObject('LookupType1')` and `buildRdmSourceObject('Source1')` produce exactly the specified shapes; `uri` is derived from the label; default naming increments past existing labels and skips gaps the same way the L3 helper does; label collection tolerates absent, empty and malformed sections |
| A (automated) | same script | `insertIntoArray` with an explicit allowlist inserts into an existing array and creates an absent one; a key outside the passed allowlist is refused; the L3 callers' behaviour is unchanged when passing their own set |
| B (automated) | same script | `package.json` declares the three commands; Add commands are scoped to `reltio.rdm.folder.lookupTypes` / `reltio.rdm.folder.sources` **and** `reltio.rdm.root`, Apply to `reltio.rdm.root` only; none of the three matches an L3 context value; the `rdm-tree-view` guard that no RDM context value matches `/^reltio\.item\./` still holds |
| C (manual QA) | Extension Development Host against a live tenant | Add a lookup type from the folder and from the tenant row; confirm the block appears in `RDM.{rdmTenantId}.reltio.json`, is revealed in the editor, validates against the RDM schema, and that a second insert yields `LookupType2`; add a source to a tenant whose configuration has no `sources` key and confirm the array is created; edit the label, run **Apply RDM Configuration**, confirm the pre-flight diff appears and the PUT succeeds; re-fetch and confirm the server now returns the added entry; run Apply with no baseline and confirm it asks for a fetch first; change the tenant from another client, then Apply, and confirm the drift warning; confirm Apply on an L3 tenant node is unaffected; with an expired token confirm the 401 reaches the re-login flow |
