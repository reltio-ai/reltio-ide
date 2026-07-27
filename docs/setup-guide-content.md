# Reltio IDE Setup Guide

Get started with Reltio IDE in just a few minutes. Connect to your Reltio tenant, download your business configuration, and start building business configuration with AI-assisted authoring.

---

## Step 1 — Connect to your Reltio environment

Your **Reltio environment** is the host where your tenant resides (for example, 361.reltio.com).

From the **Reltio** side panel, click **Connect Your Reltio Tenant**. The guided setup walks you through the complete onboarding process—from connecting to your environment to downloading your business configuration.

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

Open L3.reltio.json and start editing.

Reltio IDE enhances the metadata authoring experience with:

* AI-assisted metadata authoring
* Intelligent code completion
* Real-time validation
* Easy navigation across entities, relationships, and attributes
* Ontology visualization

## Step 5 — Apply Your Changes

When you're ready to deploy your updates, right-click the tenant and select **Apply Configuration to Tenant**.

Before applying your changes, Reltio IDE automatically compares your local configuration with the latest version in the tenant. If the remote configuration has changed since you last downloaded it, you'll be shown a comparison view to review the differences before proceeding.

This helps prevent accidental overwrites and ensures you deploy with confidence.

---

**Need Help?**

You can reopen this guide at any time by:

* Opening the **Command Palette** (Cmd+Shift+P (macOS) or Ctrl+Shift+P (Windows/Linux)) and running **Reltio: Open Setup Guide**, or
* Clicking **Open the Setup Guide** from the Reltio side panel.
