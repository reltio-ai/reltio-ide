# Reltio IDE — Code Guide

## The Folder That Matters

```
reltio-ide-github/
```

This is the entire extension. Everything below is relative to this folder.

---

## Top-Level Layout

```
src/                ← ALL the TypeScript source code (the extension itself)
scripts/            ← unit test scripts (Node .cjs, no test runner needed)
resources/          ← bundled assets (icons, Velocity Packs, legal, setup guide JSON)
skills/             ← default SKILL.md files shipped with the extension
schemas/            ← reltio-metadata.schema.json (JSON schema for L3 validation)
samples/            ← fixture files used by tests
docs/               ← documentation (including this file)
openspec/           ← OpenSpec change proposals and specs (design history)
dist/               ← compiled output (generated, not edited)
target/             ← packaged .vsix (generated, not edited)
package.json        ← extension manifest, commands, menus, settings
tsconfig.json       ← TypeScript config
ARCHITECTURE.md     ← the authoritative code design reference (read this first)
```

---

## Inside `src/` — Module by Module

### `extension.ts`
**The entry point.** Everything starts here.
- Reads VS Code settings and wires up all commands via `vscode.commands.registerCommand`
- Instantiates `MultiTenantTreeProvider`, `EnvironmentManager`, `TokenStore`, etc.
- Contains all command handlers (fetch L3, apply config, workflow fetch, history, etc.)
- ~2,500 lines — large but organized: auth helpers at the top, commands in the middle, git-source commands at the bottom

---

### `src/api/` — Network calls

| File | What it does |
|---|---|
| `reltioClient.ts` | **All** Reltio platform API calls: `listTenants`, `fetchL3Configuration`, `putL3Configuration`, `fetchConfigurationHistory`, `searchEntities`. Also owns the security choke point: `toHttpsBase()` + `isTrustedHost()` — every request goes through this before a token is attached |
| `workflowAdapterClient.ts` | Workflow Adapter API: `listJarDeployments`, `listProcessDefinitions`, `getProcessDefinitionXml`. Uses `toHttpsBase()` from reltioClient for the same host-allowlist enforcement |
| `tokenStore.ts` | In-memory store for bearer tokens, keyed by environment name |
| `sessionStore.ts` | Persists OAuth refresh tokens in VS Code's `SecretStorage` (OS keychain) |
| `oauthCredentialsStore.ts` | Persists OAuth client ID/secret in `SecretStorage` |
| `oauthLogin.ts` | Browser OAuth flow (`runBrowserLogin`, `refreshTokens`) |
| `oauthCredentialsResolve.ts` | Resolves which OAuth credentials to use for a given environment |
| `formatJson.ts` | Pretty-prints JSON (used when writing fetched L3 to disk) |

**Security invariant:** `toHttpsBase()` and `fetchWithTimeout()` are both exported so any new service client (e.g. Workflow Adapter) can reuse the same allowlist check. No bearer token is ever sent to a host that hasn't passed `isTrustedHost()`.

---

### `src/tree/` — The sidebar tree

| File | What it does |
|---|---|
| `multiTenantTreeProvider.ts` | `vscode.TreeDataProvider` implementation. `getChildren()` and `getParent()` define the full tree shape. Holds in-memory workflow cache (`workflowCache`). |
| `multiTenantNodes.ts` | `EnvironmentNode`, `TenantNode`, `GitFolderNode`, `BusinessConfigFolderNode`, `HistoryFolderNode`, `HistorySnapshotNode` |
| `workflowNodes.ts` | `WorkflowsFolderNode`, `WorkflowFetchActionNode`, `ProcessDefinitionsFolderNode`, `JarDeploymentsFolderNode`, `ProcessDefinitionNode`, `JarDeploymentNode` |
| `treeNodes.ts` | `ConfigTreeItem` — the node type for every item inside Business Config (entity types, attributes, relation types, etc.) |
| `configSubtree.ts` | `getConfigRootChildren()` and `getConfigNodeChildren()` — builds the Business Config subtree from a parsed L3 model |

**Tree hierarchy:**
```
EnvironmentNode
└─ TenantNode
   ├─ BusinessConfigFolderNode  (hasL3 only)
   │   ├─ HistoryFolderNode
   │   │   └─ HistorySnapshotNode[]
   │   └─ ConfigTreeItem[]  (entity types, relation types, etc.)
   └─ WorkflowsFolderNode
       ├─ [WorkflowFetchActionNode]  (before first fetch)
       ├─ ProcessDefinitionsFolderNode
       │   └─ ProcessDefinitionNode[]
       └─ JarDeploymentsFolderNode
           └─ JarDeploymentNode[]
```

---

### `src/workspace/` — File system and environment management

| File | What it does |
|---|---|
| `environmentManager.ts` | Knows where every file lives on disk. `getL3Uri()`, `getHistoryDirectoryUri()`, `getWorkflowAdapterConfigUri()`, `getLayoutUri()` etc. Scans the workspace to find existing environment/tenant folders. |
| `workflowAdapterConfig.ts` | Read/write the `WorkflowAdapter.reltio.json` sidecar (stores the Adapter URL — never a token) |
| `configurationHistory.ts` | Reads/writes history snapshot files under `{tenant}/history/` |
| `environmentManager.ts` | Also has `writeL3()`, `writeRemoteBaseline()` — the two writes that happen after a successful fetch |
| `applyDefaultEnvironments.ts` | Reads `.reltio/default-environments.json` if present, auto-connects environments on startup |
| `reltioAgentSync.ts` | Copies bundled skill files + Velocity Packs into `.reltio/reltio-agent/` on first load (AI layer, optional) |
| `reltioAutoSave.ts` | Registers a file-save watcher that triggers a tree refresh when `L3.reltio.json` is saved |
| `gitConfigSource.ts` | Git clone, repo detection, discovery of `BusinessConfig.json` files up to 10 levels deep |
| `gitSourceMarker.ts` | Reads/writes `.reltio/git-sources.json` (remembers which git repos are connected) |
| `l3Discovery.ts` | Finds L3/BusinessConfig files in a git repo |

---

### `src/parser/` — Config parsing

| File | What it does |
|---|---|
| `configParser.ts` | Parses `L3.reltio.json` into a typed `GraphModel` (entity types, relation types, sources, etc.) using `jsonc-parser`. Also exposes `findNodeAtPath()` for AST-based editing. |

The parser is the source of truth for what the tree displays. Every tree refresh re-parses the open/saved file — no separate state.

---

### `src/navigation/` — Editor intelligence

| File | What it does |
|---|---|
| `uriIndex.ts` | Indexes all `objectType` URIs in the current L3 file |
| `uriCompletionProvider.ts` | VS Code `CompletionItemProvider` — suggests valid URIs as you type |
| `definitionProvider.ts` | VS Code `DefinitionProvider` — Cmd+Click on a URI jumps to its definition |
| `referenceProvider.ts` | Finds all usages of a URI |
| `diagnosticsManager.ts` | Red squiggles for unresolved URI references |
| `documentLinkProvider.ts` | Makes URIs clickable links in the editor |

All run locally against the open file. No network calls, no LLM.

---

### `src/model/` — Types

| File | What it does |
|---|---|
| `types.ts` | TypeScript interfaces for the L3 model: `EntityType`, `RelationType`, `AttributeType`, `Source`, etc. |

---

### `src/commands/` — Edit commands

| File | What it does |
|---|---|
| `editCommands.ts` | JSON mutations: `addEntityType`, `addRelationType`, `addSource`, `insertAttribute`, `deleteNode`, `renameNode`. All use `jsonc-parser` AST — never string manipulation. |
| `elementSkeletons.ts` | Default JSON snippets for new entity types, relation types, etc. |
| `revealCommand.ts` | `reltio.revealInEditor` — scrolls the editor to a JSON node |
| `revealInsertion.ts` | After adding a new node, scrolls to it and selects its label |

---

### `src/ontology/` — Visual diagram

| File | What it does |
|---|---|
| `ontologyPanel.ts` | Creates the webview panel and handles host↔webview messaging |
| `modelToGraph.ts` | Converts the parsed L3 model into a graph (nodes + edges) for the diagram |
| `elkLayout.ts` | Auto-layout using ELK (Eclipse Layout Kernel) — runs in the webview |
| `layoutPersistence.ts` | Saves/loads node positions in `L3.reltio.layout.json` |
| `inspectorHtml.ts` | HTML generation for the webview (CSP-hardened, nonce-based) |
| `webviewMessageSafety.ts` | `escapeHtml()`, `createKeyedMap()` — prevent XSS in the webview |

---

### `src/providers/` — Virtual document providers

| File | What it does |
|---|---|
| `bpmnContentProvider.ts` | `vscode.TextDocumentContentProvider` on scheme `reltio-workflow-bpmn://`. Stores BPMN XML in memory and serves it as a read-only virtual document (no dirty flag, no Save-As prompt). |

---

### `src/ux/` — UI helpers

| File | What it does |
|---|---|
| `setupWizard.ts` | Multi-step setup wizard (environment host → auth method → tenant) |
| `setupGuidePanel.ts` | "Getting started" guide webview |
| `termsOfUse.ts` | Modal Terms of Use gate — prompts once per `TERMS_VERSION` per machine |
| `statusBar.ts` | Status bar item showing current tenant/environment |
| `uxState.ts` | Derives and publishes the UI state (`EState`, `TState`) that drives tree icons and descriptions |
| `recents.ts` | Tracks recently opened hosts and L3 files |
| `quickSwitch.ts` | Quick-pick environment switcher |

---

### `src/entityBrowser/` — Entity browsing

| File | What it does |
|---|---|
| `entityDetailPanel.ts` | Webview panel showing entity records for a given entity type filter |

---

### `src/util/` — Shared utilities

| File | What it does |
|---|---|
| `pathTenantLoc.ts` | Parses `*.reltio.environment/*.reltio.tenant/` paths to extract environment + tenant names |
| `fetchConfigurationGuard.ts` | `hasUnpublishedLocalChanges()`, `remoteMatchesBaseline()` — safety checks before fetch/apply |
| `tenantIdFromTreeContext.ts` | Extracts tenant ID from a tree node or command context |
| `jsonDeepEqual.ts` | Structural JSON equality check |

---

## How a Command Flows End to End

**Example: "Fetch L3" (click download icon on a tenant)**

```
1. package.json  →  command "reltio.fetchL3" registered
2. extension.ts  →  registerCommand('reltio.fetchL3', async (node: TenantNode) => {
3.   tokenStore.getToken(node.environmentName)        // get bearer token from memory
4.   fetchL3Configuration(environmentName, tenantId, token)  // reltioClient.ts
5.     toHttpsBase(baseUrl)                          // validate host, add https://
6.     fetchWithTimeout(url, headers, 10_000)        // send request
7.   environmentManager.writeL3(env, tenantId, body) // write to .reltio/.../L3.reltio.json
8.   environmentManager.writeRemoteBaseline(...)     // save baseline for later apply check
9.   treeProvider.invalidate()                       // refresh the tree
10.  uxBus.fire()                                    // update status bar and icons
```

---

## How to Add a New Feature

See `ARCHITECTURE.md` for the full "Common Modification Recipes":
- **New tree section** (config-model or separate service)
- **New Reltio platform API endpoint**
- **New separate service API** (e.g. Workflow Adapter pattern)
- **New command**
- **New webview message type**

The short version:
1. Define types in `src/model/types.ts` or a new API client file
2. Add node classes in `src/tree/`
3. Update `MultiTenantTreeElement` union + `getChildren` / `getParent` in `multiTenantTreeProvider.ts`
4. Register the command in `extension.ts` + declare it in `package.json`
5. Write a `scripts/test-<feature>.cjs` test and register it in `scripts/run-unit-tests.cjs`
6. Run `npm test` (compile + all unit tests)

---

## Scripts and Tests

```bash
npm run compile      # tsc — type-check only (fast)
npm run build        # esbuild full bundle (extension + webview)
npm run package      # clean → build → npx vsce package → target/*.vsix
npm test             # compile + node scripts/run-unit-tests.cjs
```

Tests are plain Node scripts in `scripts/test-*.cjs`. They import compiled modules from `dist/` using `scripts/lib/import-dist.cjs` (which stubs out the `vscode` module). No jest, no mocha — just `node:assert`.

---

## Key Design Decisions to Know

| Decision | Why |
|---|---|
| `toHttpsBase()` is the single host-allowlist enforcement point | No bearer token ever leaves to an untrusted host, even if a user types one in |
| Sidecar files (`.reltio.layout.json`, `WorkflowAdapter.reltio.json`) not `workspaceState` | Portable across machines, visible in the filesystem |
| `TextDocumentContentProvider` for BPMN viewer, not `openTextDocument({content})` | Produces a genuinely read-only tab — no dirty flag |
| `ConfigNodeType` union in `treeNodes.ts` is for L3 config nodes only | Workflow nodes live in `workflowNodes.ts` so the config union stays clean |
| Tokens only in memory (`TokenStore`) | No credential ever written to disk or committed |
