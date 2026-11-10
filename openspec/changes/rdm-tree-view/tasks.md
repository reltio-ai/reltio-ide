## 1. RDM parsing

- [x] 1.1 Add `parseRdmDocument(text)` to `src/parser/configParser.ts` returning `{ model, ast, errors }` with `model` typed as `RdmConfiguration`, reusing the same `jsonc-parser` calls as `parseDocument`
- [x] 1.2 Export a `ParsedRdmDocument` type alongside the existing `ParsedDocument`
- [x] 1.3 Confirm the AST is always returned even when `errors` is non-empty, so an unreadable file can still be opened by Show in Editor

## 2. Node classes

- [x] 2.1 Add `RdmRootNode` to `src/tree/multiTenantNodes.ts` carrying `environmentName`, `tenantId`, `rdmTenantId` and the RDM file `vscode.Uri`; label `RDM_{rdmTenantId}`; context value `reltio.rdm.root`
- [x] 2.2 Add `RdmFolderNode` carrying the same locators plus the section key; label `{Section Label} ({count})`; context value `reltio.rdm.folder.{sectionKey}`
- [x] 2.3 Add `RdmItemNode` carrying the same locators plus `jsonPath`; context value `reltio.rdm.item.{sectionKey}`; collapsible state `None`
- [x] 2.4 Give each class a stable `id` derived from the RDM file URI plus `jsonPath`, mirroring how `ConfigTreeItem` builds its id, so expansion state survives refreshes
- [x] 2.5 Assign theme icons — reuse `symbol-enum`-style iconography for lookup types and `database` for sources to stay consistent with the L3 sections
- [x] 2.6 Add an `unreadable` flag on `RdmRootNode` that sets a description and forces collapsible state `None` (design D6)

## 3. Subtree builder

- [x] 3.1 Create `src/tree/rdmSubtree.ts` with an explicit section table mapping `lookupTypes` → "Lookup Types" and `sources` → "Sources", mirroring the shape of `SECTIONS` in `configSubtree.ts`
- [x] 3.2 Implement `getRdmRootChildren(model, …)` returning one folder per non-empty array section, with counts, omitting absent/empty and unrecognized sections (design D4)
- [x] 3.3 Implement `getRdmFolderChildren(model, folder)` returning leaf items labelled by `label` with fallback to the trailing `uri` segment, and the full `uri` as description
- [x] 3.4 Implement `getRdmNodeParent(...)` mapping item → folder → root, for `TreeDataProvider.getParent`
- [x] 3.5 Ensure every emitted node's `jsonPath` addresses a real location in the parsed model, so reveal has a range to target

## 4. Provider wiring

- [x] 4.1 Widen the `MultiTenantTreeElement` union in `src/tree/multiTenantTreeProvider.ts` with the three new node types
- [x] 4.2 In `getChildren(TenantNode)`, enumerate the tenant's RDM tenant ids via `EnvironmentManager.listRdmTenantIds` and append one `RdmRootNode` each, sorted by id, **after** the L3 sections
- [x] 4.3 Move RDM enumeration outside the existing `if (element.hasL3)` guard so RDM roots do not depend on L3 (design D3)
- [x] 4.4 Add `hasRdm` to the `TenantNode` constructor and set its collapsible state from `hasL3 || hasRdm`; pass `t.hasRdm` where `TenantNode` is constructed
- [x] 4.5 Add `getChildren` branches for `RdmRootNode` (parse the file, return sections; return `[]` and mark unreadable on parse failure) and `RdmFolderNode` (return items)
- [x] 4.6 Add `getParent` branches for the three new node types
- [x] 4.7 Confirm `loadParsedFromItem` and the other `tenantL3Uri` consumers are untouched and never receive an RDM node

## 5. Reveal

- [x] 5.1 Widen `revealInEditor`'s first parameter in `src/commands/revealCommand.ts` from `ConfigTreeItem` to `{ jsonPath: (string | number)[] }` — no behavioural change
- [x] 5.2 Extend the `reltio.revealInEditor` handler to accept an RDM node, parsing its own file for the AST and passing that file's URI as the document
- [x] 5.3 Add one `view/item/context` entry in `package.json` for `reltio.revealInEditor` scoped to `viewItem =~ /^reltio\.rdm\./`
- [x] 5.4 Verify no new command is declared in `contributes.commands`

## 6. Tests

- [x] 6.1 Add `scripts/test-rdm-tree-view.cjs` with Tier A coverage of `getRdmRootChildren` over the sanitized fixture: one folder per non-empty array section, labels carry counts derived from the fixture rather than hard-coded numbers
- [x] 6.2 Add Tier A coverage of `getRdmFolderChildren`: label from `label`; fallback to the `uri` tail when `label` is absent; description is the full `uri`; items are leaves
- [x] 6.3 Add Tier A coverage for a constructed configuration with empty and absent sections, asserting those folders are omitted, and for an unrecognized array key, asserting it is omitted rather than rendered
- [x] 6.4 Add Tier A coverage asserting every emitted `jsonPath` resolves in the parsed model, and that item → folder → root parent resolution round-trips
- [x] 6.5 Add Tier B coverage asserting no RDM context value matches `/^reltio\.item\./` or `/^reltio\.folder\./` — this is the regression guard for design D1
- [x] 6.6 Add Tier B coverage asserting `package.json` contributes exactly one RDM-scoped menu entry, adds no new command, and leaves the Delete/Rename `when` clauses unchanged
- [x] 6.7 Register `test-rdm-tree-view.cjs` in the `SCRIPTS` registry in `scripts/run-unit-tests.cjs` (alphabetical position)
- [x] 6.8 Run `npm test` and confirm all scripts pass

## 7. Documentation

- [x] 7.1 Update the tree structure description in `ARCHITECTURE.md` to show RDM roots under the tenant node
- [x] 7.2 Document `src/tree/rdmSubtree.ts` in the package structure section, and note that RDM nodes deliberately sit outside `ConfigTreeItem`
- [x] 7.3 Add a line to the "Add a new tree section" recipe warning that `reltio.item.*` context values inherit Delete and Rename by regex

## 8. Build and verification

- [x] 8.1 `npm run compile` — no TypeScript errors
- [x] 8.2 `npm run build` — extension host and webview bundles succeed
- [x] 8.3 `npm run package` — build a `.vsix` for manual QA
- [ ] 8.4 Manual QA: after Get Configuration, confirm `RDM_{rdmTenantId}` appears under the tenant **below** the L3 sections and expands to Lookup Types and Sources with correct counts
- [ ] 8.5 Manual QA: confirm a lookup type's Show in Editor opens the RDM file at that entry and does not touch `L3.reltio.json`
- [ ] 8.6 Manual QA: right-click an RDM root, a folder and an item — confirm **no** Delete, Rename, Add-a-new-*, or Show in Ontology on any of them
- [ ] 8.7 Manual QA: confirm the L3 sub-tree still renders and behaves exactly as before, including Delete/Rename/Show in Ontology on L3 nodes
- [ ] 8.8 Manual QA: on a tenant with no RDM, confirm no RDM root and an unchanged tenant sub-tree
- [ ] 8.9 Manual QA: corrupt an RDM file, refresh, and confirm a visible unreadable root that expands to nothing and still opens via Show in Editor
- [ ] 8.10 Manual QA: confirm the RDM baseline file does not produce a second root
- [x] 8.11 `npx openspec validate rdm-tree-view --strict`
