# Reltio IDE — What It Is and How to Use It

## What Is It?

Reltio IDE is a **VS Code / Cursor extension** (`.vsix` file) that lets you connect to a Reltio tenant or a Git repo, view and edit the business configuration (the `L3.reltio.json` / `BusinessConfig.json` file), and deploy changes — all without leaving your editor.

It works on **Windows, macOS, both VS Code and Cursor**. No AI assistant is needed for any of the core features.

---

## The Tree View — What You See

After connecting, the **RELTIO IDE** sidebar shows this structure:

```
Environment  (e.g. demo-01.reltio.com)
└─ TenantId  (e.g. AcmeTenant)
   ├─ Business Config          ← only when L3 is fetched
   │   ├─ History              ← past config versions
   │   ├─ Entity Types
   │   ├─ Relation Types
   │   ├─ Sources
   │   └─ ... (all L3 sections)
   └─ Workflows                ← always visible
       ├─ Process Definitions  ← deployed BPMNs
       └─ JAR Deployments      ← registered JARs
```

---

## Two Ways to Connect

| Mode | When to use |
|---|---|
| **Tenant mode** | You have a live Reltio tenant, credentials, and want to fetch/edit/apply config |
| **Git mode** | Your `BusinessConfig.json` already lives in a git repo; no Reltio credentials needed |

You pick one per workspace — not both at the same time.

---

## Key Workflows

### 1. Connect to a Tenant
1. Open a folder in your editor
2. Click the Reltio icon in the sidebar → **Connect your Reltio Tenant**
3. Enter your environment host (e.g. `demo-01.reltio.com`)
4. Choose **Sign in with browser** (OAuth, recommended) or **Paste a Bearer token**
5. Select your tenant from the list

### 2. Fetch the Configuration
- Click the download icon next to the tenant, or right-click → **Get Configuration**
- This downloads `L3.reltio.json` into your workspace
- If your local file has unpublished changes, you'll be shown a diff and asked what to do

### 3. Edit the Configuration
- Open `L3.reltio.json` in the editor
- Right-click items in the tree to **Add Entity Type**, **Add Attribute**, **Add Relation Type**, etc.
- Auto-complete suggests valid URIs as you type
- Red squiggles highlight broken references in real time

### 4. Apply Changes Back to the Tenant
- Right-click the tenant → **Apply Configuration to Tenant**
- IDE shows a diff of your changes vs the current remote version
- Click **View changes** to review, then **Apply to tenant** to deploy

### 5. View Configuration History
- Right-click the tenant → **View Configuration History**
- Snapshots appear under the **History** folder inside Business Config
- Right-click any snapshot to compare it with the current config or with a previous version

### 6. Inspect Workflows
- Expand the **Workflows** folder under any tenant
- First time: click it and enter your **Workflow Adapter URL** (e.g. `demo-01-workflow.reltio.com`)
- See all deployed **Process Definitions** (BPMNs) and registered **JAR files**
- Click any process definition to open its full BPMN XML in a read-only viewer

### 7. Ontology Visualization
- Right-click **Entity Types** → **Show in Ontology**
- Interactive diagram showing all entity types, their attributes, and relationships

---

## Authentication — How Credentials Are Handled

| Method | Where it's stored |
|---|---|
| Browser OAuth (recommended) | OS secure credential store (Keychain / Windows Credential Manager) |
| Bearer token | Memory only — cleared on editor restart, never written to disk |
| Git credentials | Git's own credential helper — Reltio IDE never touches these |

**No credential is ever written to a file in your workspace or committed to git.**

---

## AI vs. Non-AI Features

The extension has two completely separate layers:

**Core IDE (zero AI required)**
All tree-view actions, config editing, apply, history, workflow inspection, auto-complete, go-to-definition, red squiggles — these are pure TypeScript calling Reltio REST APIs and VS Code language APIs. They work in any plain VS Code/Cursor with no AI assistant open.

**AI layer (optional)**
The extension ships `SKILL.md` files and Velocity Packs into `.reltio/reltio-agent/`. These are text files that give Cursor/Claude context about Reltio's config format for AI-assisted authoring. If you never use an AI assistant, these files have zero effect on anything above.

---

## Terms of Use

The first time you sign in on any machine, a modal shows the Terms of Use. You must accept to proceed. Acceptance is stored locally — you won't be prompted again on the same machine unless:
- The team releases a new version of the terms (they bump a version number in the code)
- You manually reset via the **Reset Terms of Use Acceptance** command

---

## Where Things Live on Disk

After connecting to a tenant, Reltio IDE creates this folder structure in your workspace:

```
.reltio/
└─ demo-01.reltio.com.reltio.environment/
   └─ AcmeTenant.reltio.tenant/
      ├─ L3.reltio.json              ← your business configuration
      ├─ L3.remote-baseline.reltio.json  ← last fetched remote snapshot (for safe apply)
      ├─ L3.reltio.layout.json       ← ontology diagram positions
      ├─ WorkflowAdapter.reltio.json ← saved Workflow Adapter URL
      └─ history/
          └─ *.reltio.json           ← configuration history snapshots
```
