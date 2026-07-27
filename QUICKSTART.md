# Quickstart — How to Use the Reltio Metadata Editor

This guide gets you from zero to editing a Reltio tenant configuration in VS Code or Cursor.

---

## Prerequisites

- **VS Code** (1.85+) or **Cursor**
- **Node.js 18+** and **npm** (only if building from source)
- A Reltio environment host and a valid **Bearer token**

---

## 1. Install the Extension

### From a pre-built VSIX

1. Obtain the `.vsix` file from your team (or build it — see below).
2. Open VS Code/Cursor → Extensions sidebar (`Ctrl+Shift+X`) → `...` menu → **Install from VSIX…**
3. Select the file and reload when prompted.

### Build from source

```bash
git clone <repo-url>
cd reltio-ide
npm install
npm run package          # outputs target/reltio-metadata-editor-*.vsix
```

Then install the generated `.vsix` as above, or:

```bash
code --install-extension target/reltio-metadata-editor-0.0.1.vsix
# or
cursor --install-extension target/reltio-metadata-editor-0.0.1.vsix
```

---

## 2. Open the Reltio Sidebar

Click the **Reltio** icon in the Activity Bar (left sidebar). This is your control panel for environments, tenants, and configurations.

> The extension also activates automatically whenever you open a `*.reltio.json` file.

---

## 3. Connect to an Environment

1. In the Reltio sidebar, click **Add Environment** (or run `Reltio: Add Environment` from the Command Palette).
2. Enter your Reltio host, e.g. `361.reltio.com` — the extension validates the host before creating it.
3. A `.reltio/361.reltio.com.reltio.environment/` directory appears in your workspace.

**Authenticate:**

4. Right-click the environment → **Provide Token**.
5. Paste your Bearer token.

> Tokens are stored in memory only and are cleared on restart.

---

## 4. Add a Tenant

1. Right-click the authenticated environment → **Add Tenant**.
2. Choose a tenant from the list fetched from the API.
3. A `{tenantId}.reltio.tenant/` directory is created under the environment.

---

## 5. Fetch the Tenant Configuration (L3)

1. Right-click the tenant → **Fetch Configuration**.
2. The extension downloads the tenant metadata and saves it as `L3.reltio.json` inside the tenant folder.
3. A `L3.remote-baseline.reltio.json` is also saved alongside it — used later to detect server-side drift before you apply changes.

---

## 6. Edit the Configuration

Open `L3.reltio.json`. The editor comes alive with the following capabilities:

### Validation & Diagnostics

- The file is validated against the Reltio JSON schema automatically.
- Broken or unresolved `configuration/...` URI references are underlined with squiggles.
- Adjust severity via the setting `reltio.unresolvedUriSeverity` (`warning` / `error` / `information` / `hint` / `off`).

### Navigation

| Action | How |
|---|---|
| Go to Definition | `Ctrl+Click` (or `Cmd+Click`) on any `configuration/...` URI |
| Find All References | `Shift+F12` on any URI |
| URI IntelliSense | `Ctrl+Space` inside a string value — suggestions are scoped by property type |

### Configuration Tree

The Reltio sidebar shows the full hierarchy:

```
▼ 361.reltio.com
  ▼ householddemo
    ▼ L3 Configuration
      ▼ Entity Types
          Individual
          Organization
      ▶ Relation Types
    ▶ History
```

Click any tree item to jump to that location in the JSON editor.

### Structural Editing (Right-click the Tree)

Use the context menu on any tree node to make structural changes without touching raw JSON:

| Action | Where to right-click |
|---|---|
| Add Entity Type | Entity Types folder |
| Add Relation Type | Relation Types folder |
| Add Simple / Nested / Reference Attribute | Entity type, relation type, or Attributes folder |
| Add Match Group | An entity type row |
| Add Survivorship Group | An entity type or relation type row |
| Rename | Any named node (updates URI references automatically) |
| Delete | Any node |

All edits are AST-aware — commas, nesting, and whitespace are handled correctly.

---

## 7. Ontology Preview (Graph View)

1. With `L3.reltio.json` open, click **Show Ontology Preview** in the editor title bar.
   Alternatively, right-click a tenant in the tree → **Show Ontology Preview**.
2. An interactive graph opens:
   - **Nodes** = entity types
   - **Edges** = inheritance, relationships, and cross-type references
3. Controls:
   - **Pan** — drag on empty canvas space
   - **Zoom** — scroll wheel
   - **Move nodes** — drag any node; positions are saved to a `*.reltio.layout.json` sidecar file
   - **Click a node** — opens an inspector with attributes and type details
   - **Right-click a node** → **Reveal in Tree** or **Reveal in Editor**

---

## 8. Apply Changes Back to the Tenant

After editing locally:

1. Right-click the tenant → **Apply Configuration to Tenant**.
2. The extension compares your local file against the remote baseline:
   - **No drift** → choose **Yes**, **View Changes**, or **Cancel**.
   - **Remote has changed** → you must review the diff before proceeding.
3. **View Changes** opens a side-by-side diff of the remote vs your local file.
4. Confirm → the extension sends a `PUT` to the Reltio API.
5. On success, the remote baseline is updated automatically.

---

## 9. Configuration History

1. Right-click a tenant → **Fetch Configuration History** — downloads the 10 most recent revisions into `{tenant}/history/`.
2. Right-click the **History** folder → **Fetch More** to load older revisions.
3. Right-click any snapshot for comparison options:

| Option | What it does |
|---|---|
| Compare with Current | Diffs the snapshot against your live `L3.reltio.json` |
| Compare with Previous Snapshot | Diffs against the next-older revision |
| Select for Compare → Compare Selected | Arbitrary pairwise diff between any two snapshots |

---

## Settings Reference

| Setting | Default | Description |
|---|---|---|
| `reltio.unresolvedUriSeverity` | `warning` | Severity for unresolved `configuration/...` URI references |
| `reltio.autoSaveOnEditorSwitch` | `true` | Auto-saves `*.reltio.json` when you switch editor tabs |
| `reltio.autoSaveOnWindowBlur` | `false` | Auto-saves when the VS Code window loses focus |
| `reltio.defaultEnvironments` | `[]` | Seed `{ host, tenantId, tokenFile? }` — **tokenFile is a path only; never put tokens in settings** |
| `reltio.applyDefaultsOnActivate` | `false` | Apply `defaultEnvironments` once on activation |
| `reltio.fetchL3AfterApplyDefaults` | `false` | After apply, fetch L3 for seeded tenants that have a token (never auto-PUT) |

---

## Seed from workspace settings (token file)

For workspaces that already keep a local OAuth token file (for example Reltio Forge’s `skills/mcp-reltio/token.json`), seed the RoR host/tenant without pasting a bearer:

```json
{
  "reltio.defaultEnvironments": [
    {
      "host": "prod-usg.reltio.com",
      "tenantId": "16KZuUKjWAraGx5",
      "tokenFile": "skills/mcp-reltio/token.json"
    }
  ],
  "reltio.applyDefaultsOnActivate": true,
  "reltio.fetchL3AfterApplyDefaults": true
}
```

Then run **Reltio: Apply default environments**, or rely on apply-on-activate (requires a trusted workspace).

**Security:**
- Settings must only store the **path** to a gitignored token file. Do not put `access_token`, refresh tokens, or OAuth client secrets in `settings.json`.
- Prefer user/local settings for `applyDefaultsOnActivate` / `fetchL3AfterApplyDefaults`. Do **not** commit those flags together with host/`tokenFile` into shared `.vscode/settings.json` — that enables unattended token reads and outbound calls for every teammate who trusts the folder.
- Apply defaults is blocked in untrusted workspaces (Workspace Trust).

---

## Cursor Agent Integration

On activation, the extension syncs skill playbooks and Velocity Pack reference files into `.reltio/reltio-agent/` in your workspace. Cursor Agent uses these to understand Reltio concepts and guide model element creation.

- Force a re-sync: Command Palette → **Reltio: Resync agent assets**
- Team overrides: place custom playbooks in `skills/workspace/` — the extension never overwrites that folder

---

## Workspace Directory Structure

After setup, your workspace will look like this:

```
workspace/
└── .reltio/
    ├── 361.reltio.com.reltio.environment/
    │   └── householddemo.reltio.tenant/
    │       ├── L3.reltio.json                   ← active config you edit
    │       ├── L3.remote-baseline.reltio.json   ← drift detection baseline
    │       └── history/
    │           ├── L3-admin---2026-04-10T....reltio.json
    │           └── ...
    └── reltio-agent/
        ├── skills/default/                  ← synced agent playbooks
        └── velocity-packs/                  ← synced reference JSON
```

Legacy workspaces may still have `{host}.reltio.environment/` at the workspace root; the extension continues to discover those. New environments are created under `.reltio/`.
