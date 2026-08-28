# Quickstart — How to Use Reltio IDE

This guide gets you from install to editing. **Before you connect**, know that Reltio IDE has two options — a **Reltio tenant** or a **Git repository**. Pick one based on how you work. You cannot use both in the same workspace.

After you are connected, continue here from [Edit the Configuration](#7-edit-the-configuration).

Open [README.md](README.md#connect-a-git-repository) for the full Git connect (clone, private repositories, Add Config, Remove Config).

---

## Prerequisites

- **VS Code** (1.85+) or **Cursor**
- **Node.js 18+** and **npm** (only if building from source)
- **If you will connect a tenant:** a Reltio environment host, plus either an **OAuth Client ID and Client secret** (with your SSO routing tenant ID) or a valid **Bearer token**
- **If you will connect a Git repository:** Git on your `PATH`. No Reltio credentials. See [README.md — Connect a Git repository](README.md#connect-a-git-repository) if Git is missing or the repository is private.

---

## 1. Install the Extension

### From a pre-built VSIX

1. Obtain the `.vsix` file from the releases list (or build it — see below).
2. Open VS Code/Cursor → Extensions sidebar (`Ctrl+Shift+X`) → `...` menu → **Install from VSIX…**
3. Select the file and reload when prompted.

Install screenshots for Cursor and VS Code are in [README.md — Install Reltio IDE](README.md#install-reltio-ide).

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

---

## 3. Choose how to connect

Reltio IDE gives you two ways to open business configuration. Pick **one** based on how you work:

| Option | Use when | What you click |
|---|---|---|
| **Reltio tenant** | You want to fetch configuration from a live tenant, edit it, and apply it back | **Add Environment** — then steps 4–6 below |
| **Git repository** | Your business configuration already lives in Git | **Connect your Repository** — full steps in [README.md](README.md#connect-a-git-repository) |

Then continue at [Edit the Configuration](#7-edit-the-configuration). If you chose Git, skip steps 4–6.

---

## 4. Connect to an Environment

*Only if you chose a **Reltio tenant**.*

1. In the Reltio sidebar, click **Add Environment** (or run `Reltio: Add Environment` from the Command Palette).
2. Enter your Reltio host, e.g. `361.reltio.com` — the extension validates the host before creating it.
3. A `.reltio/361.reltio.com.reltio.environment/` directory appears in your workspace.

**Authenticate.** Choose one of two methods.

### Option A: Sign in with Browser (recommended)

One-time setup per environment:

4. Right-click the environment → **Configure OAuth Client…**
5. Provide your **Client ID**, **Client secret**, and **SSO routing tenant ID**. The default routing tenant works for most organizations; change it only if yours runs its own.

Then, to sign in:

6. Right-click the environment → **Login with Browser**.
7. Your default browser opens and you authenticate through single sign-on, exactly as you would for the Reltio web UI.
8. On success the tree refreshes and the environment is ready to use.

> Your Client ID, Client secret, and session are kept in your operating system's secure credential store, never in a plaintext file or in `settings.json`. The extension never sees your username, password, or MFA prompt: those stay inside the browser.

Sessions refresh themselves in the background, so you are not prompted again mid-session, and they are restored automatically the next time you open the workspace. If a session cannot be renewed, you are asked to log in again.

If browser login is unavailable for your tenant (no external identity provider is configured for it), the extension tells you so and points you at the bearer token method below.

To sign in again as a different user, right-click the environment → **Re-Login with Browser**. To change or clear your stored client credentials, use **Reset OAuth Client…**. See [docs/BROWSER_LOGIN.md](docs/BROWSER_LOGIN.md) for the full detail.

### Option B: Paste a Bearer Token

4. Right-click the environment → **Provide Token**.
5. Paste your Bearer token.

> Tokens are stored in memory only and are cleared on restart.

---

## 5. Add a Tenant

1. Right-click the authenticated environment → **Add Tenant**.
2. Choose a tenant from the list fetched from the API.
3. A `{tenantId}.reltio.tenant/` directory is created under the environment.

---

## 6. Fetch the Tenant Configuration (L3)

1. Right-click the tenant → **Get Configuration**.
2. The extension downloads the tenant metadata and saves it as `L3.reltio.json` inside the tenant folder.
3. A `L3.remote-baseline.reltio.json` is also saved alongside it — used later to detect server-side drift before you apply changes.

---

## Connect a Git repository

*Skip this if you chose a **Reltio tenant**.*

In the Reltio sidebar, select **Connect your Repository**. Clone, private-repository sign-in, `BusinessConfig.json` discovery, **Add Config**, **Remove Config**, and **Remove Repository** are documented once in [README.md — Connect a Git repository](README.md#connect-a-git-repository).

When the repository is connected, continue at [Edit the Configuration](#7-edit-the-configuration).

---

## 7. Edit the Configuration

Open `L3.reltio.json` (tenant) or `BusinessConfig.json` (Git). The editor comes alive with the following capabilities:

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

The Reltio sidebar shows the full hierarchy. A tenant workspace looks like this:

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

A Git-connected workspace shows the repository's `BusinessConfig.json` files in the tree, matching the folder layout in Git.

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

## 8. Ontology Preview (Graph View)

1. Right-click **Entity Types** or **Relation Types** in the **RELTIO IDE** view and select **Show in Ontology**.
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

## 9. Apply Changes Back to the Tenant

*Only if you chose a **Reltio tenant**.* If you connected a Git repository, save your edits and commit and push with your editor's **Source Control** view instead.

After editing locally:

1. Right-click the tenant → **Apply Configuration to Tenant**.
2. The extension compares your local file against the remote baseline:
   - **No drift** → choose **Yes**, **View changes**, or **Don't apply**.
   - **Remote has changed** → you must **Review changes** before proceeding (**Skip** cancels).
3. **View changes** opens a side-by-side diff of the remote vs your local file. Confirm with **Apply to tenant** or choose **Don't apply**.
4. Confirm → the extension sends a `PUT` to the Reltio API.
5. On success, the remote baseline is updated automatically.

---

## 10. Configuration History

*Only if you chose a **Reltio tenant**.*

1. Right-click a tenant → **View Configuration History** — downloads the 10 most recent revisions into `{tenant}/history/`.
2. Right-click the **History** folder → **Fetch More Configuration History** to load older revisions.
3. Right-click any snapshot for comparison options:

| Option | What it does |
|---|---|
| Compare with Current L3 | Diffs the snapshot against your live `L3.reltio.json` |
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

If you connected a Git repository instead, none of this applies: your config files stay exactly where the repository puts them. See [README.md — Connect a Git repository](README.md#connect-a-git-repository) for how the tree maps to those folders.
