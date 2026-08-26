# Reltio IDE Setup Guide

Get started with Reltio IDE in just a few minutes. Connect to a Reltio tenant or to a Git repository that holds your business configuration, then start modeling with AI-assisted authoring.

---

## Step 1 — Connect to your Reltio environment

Your **Reltio environment** is the host where your tenant resides (for example, 361.reltio.com).

From the **Reltio** side panel, click **Connect your Reltio Tenant**. The guided setup walks you through the complete onboarding process—from connecting to your environment to downloading your business configuration.

If you keep business configuration in Git instead, skip this tenant path and use **Connect your Repository** (step 6).

---

## Step 2 — Authenticate

Sign in so Reltio IDE can securely access your business configuration and apply changes back to your tenant.

Choose one of the following authentication methods:

**Browser Sign-In (Recommended)**

Reltio IDE opens **auth.reltio.com** in your default browser, where you authenticate using:

* Your organization's Single Sign-On (Okta, Azure AD, Ping, etc.), or
* Your Reltio credentials.

Your password is entered only in the browser and is never accessible to Reltio IDE.

The first time you use browser sign-in, you'll be prompted to provide your OAuth configuration:

* **Client ID**
* **Client Secret**
* **SSO Routing Tenant**

These credentials are securely stored using your operating system's secure credential store via VS Code SecretStorage.

**Bearer Token**

If you already have a valid Reltio bearer token, you can paste it directly into the setup wizard.

The token is kept in memory for the current session and is never stored on disk.

---

## Step 3 — Select your tenant

After authentication, Reltio IDE retrieves the list of tenants you have access to.

Select the tenant you want to work with. Reltio IDE will automatically:

* Create a local workspace for the tenant.
* Download the latest business configuration (L3.reltio.json).
* Save a remote baseline so future changes can be compared before deployment.

Need to work with additional tenants? Right-click your environment in the Reltio side panel and select **Add Tenant**.

---

## Step 4 — Start Modeling

Open your configuration file and start editing (`L3.reltio.json` for a tenant, or `BusinessConfig.json` when you connected a Git repository).

Reltio IDE enhances the metadata authoring experience with:

* AI-assisted metadata authoring
* Intelligent code completion
* Real-time validation
* Easy navigation across entities, relationships, and attributes
* Ontology visualization

## Step 5 — Apply Your Changes

When you're connected to a tenant and ready to deploy, right-click the tenant and select **Apply Configuration to Tenant**.

Before applying your changes, Reltio IDE automatically compares your local configuration with the latest version in the tenant. If the remote configuration has changed since you last downloaded it, you'll be shown a comparison view to review the differences before proceeding.

This helps prevent accidental overwrites and ensures you deploy with confidence.

When you work from a Git repository, Reltio IDE hides tenant apply and history. Save your edits, then commit and push them with your editor's **Source Control** view.

---

## Step 6 — Connect a Git repository instead

Use this instead of steps 1–3 when your business configuration already lives in Git (GitHub, GitLab, Bitbucket, Azure DevOps, or self-hosted). No Reltio host, token, or OAuth credentials are required. Git must be installed on your PATH.

Open an empty folder (Reltio IDE clones into it), or open a folder that already contains your clone. In the Reltio side panel, select **Connect your Repository**. If the folder is already a clone, Reltio IDE detects it. Otherwise, enter the remote URL (for example `https://github.com/org/repo.git`) and press Enter.

Reltio IDE searches up to 10 folder levels for files named `BusinessConfig.json` (the name is not case-sensitive) and lists them in the RELTIO IDE view. To add a file with a different name, such as `L3.json`, right-click the `.json` file in Explorer and select **Add Config**. The file must be a valid Reltio business configuration.

A public repository does not require extra sign-in. For a private GitHub repository, Git may ask you to **Select an account** — pick an account with access, or select **Add a new account**. Other Git hosts use whatever sign-in Git on your machine already uses.

Right-click a configuration and select **Remove Config** to drop it from the tree (the file stays in the repository). To disconnect, use the trash icon in the RELTIO IDE view title bar, or right-click the repository and select **Remove Repository** — this deletes the folder contents.

A workspace connects to a tenant or to a Git repository, not both.

---

**Need Help?**

You can reopen this guide at any time by:

* Opening the **Command Palette** (Cmd+Shift+P (macOS) or Ctrl+Shift+P (Windows/Linux)) and running **Reltio: Open Setup Guide**, or
* Clicking **Open the Setup Guide** from the Reltio side panel.
