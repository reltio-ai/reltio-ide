# Terms of Usage Acceptance Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate all three entry points that result in a login (`reltio.provideToken`, `reltio.loginWithBrowser`, and the Setup Wizard) behind a one-time Terms of Use acceptance modal, persisted in `globalState` with a version key so future wording changes can force re-acceptance.

**Architecture:** A single new module `src/ux/termsOfUse.ts` exposes `ensureTermsAccepted(context)`, which checks a versioned `globalState` flag, and if unset/stale, reads a bundled plain-text terms file and shows it in a modal warning dialog with Accept/Decline buttons. The gated call sites (`reltio.provideToken` and `reltio.loginWithBrowser` in `src/extension.ts`, and `launchSetupWizard` in `src/ux/setupWizard.ts`) call this function first and bail out (return) if it resolves `false`.

**Tech Stack:** TypeScript, VS Code Extension API (`vscode.window.showWarningMessage` modal, `context.globalState`, `context.extensionUri`, `vscode.workspace.fs`).

**Spec:** `docs/superpowers/specs/2026-07-10-terms-of-usage-design.md`

---

**Update:** the Goal line, Architecture note, and Task 2 code below were revised after CodeRabbit review to match what actually shipped (the Setup Wizard as a third gated entry point, and `vscode.workspace.fs.readFile` with fail-closed empty-content handling instead of the original `fs.readFileSync` sketch). This repo has also since grown an automated test harness (`npm test`); see `openspec/changes/terms-of-use-gate/design.md` for the current, authoritative Test Plan and design decisions (D6, D11, D14).

### Task 1: Bundle the terms text

**Files:**
- Create: `resources/legal/termsOfUse.txt`

- [ ] **Step 1: Create the directory and file with the terms text**

Content (verbatim, from the confirmed source doc — "Copy of Reltio IDE Terms of Use"):

```
Reltio IDE Terms of Use

You may use the code, data, and/or other functionality (the "IDE Materials") solely for your internal business purposes in connection with your use of the Reltio Services pursuant to your agreement with Reltio under which you subscribe to the Reltio Services (the "Agreement").

Your use of the IDE Materials must comply at all times with restrictions and obligations contained in the Agreement and any in accordance with any applicable documentation. You may view, use, and/or copy the IDE Materials solely for the purposes of using IDE Materials within or in conjunction with the Reltio Services.

If you do not agree to these terms, you may not view, use, or copy the IDE Materials.

Permitted use of the IDE Materials will terminate automatically upon your breach of these terms and/or upon the termination of the Agreement. Additionally, Reltio may terminate this license at any time on notice. Upon termination, you must permanently delete the IDE Materials and any and all copies thereof.

DISCLAIMER; LIMITATION OF LIABILITY.

THE IDE MATERIALS ARE PROVIDED "AS IS". RELTIO, ON BEHALF OF ITSELF AND ITS LICENSORS, SPECIFICALLY DISCLAIMS ALL WARRANTIES RELATING TO THE IDE MATERIALS, WHETHER EXPRESS OR IMPLIED, INCLUDING, WITHOUT LIMITATION, ACCURACY, MERCHANTABILITY, QUALITY, AVAILABILITY, OR FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. NOTWITHSTANDING ANYTHING TO THE CONTRARY IN THE AGREEMENT, RELTIO'S AND ITS LICENSORS' TOTAL AGGREGATE LIABILITY RELATING TO OR ARISING OUT OF YOUR USE OF OR RELTIO'S PROVISIONING OF THE IDE MATERIALS SHALL NOT EXCEED ONE THOUSAND ($1,000) DOLLARS. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE IDE MATERIALS OR THE USE OR OTHER DEALINGS IN THE IDE MATERIALS.

The RELTIO® mark is a registered trademark of Reltio, Inc. in the United States and other countries.
```

Note: the source doc has two typos ("terminate automaticall", duplicated "ThThe RELTIO®...United States and other countries e RELTIO®...") — both corrected above since this is a user-facing legal notice, not a verbatim legal document under change control. If exact source fidelity is later required, that's a copy-only follow-up.

- [ ] **Step 2: Verify the file is picked up by packaging**

Run: `grep -c "resources/\*\*" .vscodeignore`
Expected: `1` (confirms the whitelist rule already covers the new subdirectory — no `.vscodeignore` change needed)

- [ ] **Step 3: Commit**

```bash
git add resources/legal/termsOfUse.txt
git commit -m "Add Reltio IDE Terms of Use text (RP-190496)"
```

---

### Task 2: `ensureTermsAccepted` module

**Files:**
- Create: `src/ux/termsOfUse.ts`

- [ ] **Step 1: Write the module**

```typescript
import * as vscode from 'vscode';

/** Bump this to force every user to re-accept the terms (e.g. after a wording change). */
export const TERMS_VERSION = '1';

const ACCEPTED_VERSION_KEY = 'reltio.termsAcceptedVersion';
const ACCEPTED_AT_KEY = 'reltio.termsAcceptedAt';

/**
 * Ensures the current user has accepted the Reltio IDE Terms of Use for the
 * current TERMS_VERSION. Prompts with a modal only when needed (never
 * accepted, or accepted an older version). Returns false if the user
 * declines or dismisses the prompt, or if the terms text can't be loaded or
 * reads as empty — callers must not proceed with login/authentication in any
 * of those cases.
 */
export async function ensureTermsAccepted(context: vscode.ExtensionContext): Promise<boolean> {
	const acceptedVersion = context.globalState.get<string>(ACCEPTED_VERSION_KEY, '');
	if (acceptedVersion === TERMS_VERSION) {
		return true;
	}

	const termsPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'legal', 'termsOfUse.txt');
	let termsText: string;
	try {
		const bytes = await vscode.workspace.fs.readFile(termsPath);
		termsText = new TextDecoder('utf-8').decode(bytes);
		if (!termsText.trim()) {
			throw new Error('Terms of Use file is empty');
		}
	} catch (e) {
		vscode.window.showErrorMessage('Could not load Reltio IDE Terms of Use. Authentication cannot proceed.');
		return false;
	}

	const choice = await vscode.window.showWarningMessage(termsText, { modal: true }, 'Accept', 'Decline');
	if (choice !== 'Accept') {
		return false;
	}

	await context.globalState.update(ACCEPTED_VERSION_KEY, TERMS_VERSION);
	await context.globalState.update(ACCEPTED_AT_KEY, Date.now());
	return true;
}
```

(Updated post-shipping to match the final implementation: `vscode.workspace.fs.readFile` instead of Node's `fs.readFileSync` — works uniformly across local and remote-dev scenarios — plus the fail-closed empty-content check added during CodeRabbit review. See `openspec/changes/terms-of-use-gate/design.md` D6 and D11.)

- [ ] **Step 2: Type-check**

Run: `npm run compile`
Expected: no errors (this file has no callers yet, so it type-checks standalone)

- [ ] **Step 3: Commit**

```bash
git add src/ux/termsOfUse.ts
git commit -m "Add ensureTermsAccepted terms-of-use gate (RP-190496)"
```

---

### Task 3: Wire the gate into both login commands

**Files:**
- Modify: `src/extension.ts:42` (import), `src/extension.ts:931` (`reltio.provideToken`), `src/extension.ts:986` (`reltio.loginWithBrowser`)

- [ ] **Step 1: Add the import**

In `src/extension.ts`, after the existing line 42 (`import { runBrowserLogin, refreshTokens, OAuthLoginError } from './api/oauthLogin';`), add:

```typescript
import { ensureTermsAccepted } from './ux/termsOfUse';
```

- [ ] **Step 2: Gate `reltio.provideToken`**

Current code (`src/extension.ts:931-933`):

```typescript
		vscode.commands.registerCommand('reltio.provideToken', async (node?: EnvironmentNode) => {
			if (!node) return;
			const token = await vscode.window.showInputBox({
```

Change to:

```typescript
		vscode.commands.registerCommand('reltio.provideToken', async (node?: EnvironmentNode) => {
			if (!node) return;
			if (!(await ensureTermsAccepted(context))) return;
			const token = await vscode.window.showInputBox({
```

- [ ] **Step 3: Gate `reltio.loginWithBrowser`**

Current code (`src/extension.ts:986-988`):

```typescript
		vscode.commands.registerCommand('reltio.loginWithBrowser', async (node?: EnvironmentNode) => {
			if (!node || !environmentManager) return;
			const envNames = (await environmentManager.scanEnvironments()).map(e => e.name);
```

Change to:

```typescript
		vscode.commands.registerCommand('reltio.loginWithBrowser', async (node?: EnvironmentNode) => {
			if (!node || !environmentManager) return;
			if (!(await ensureTermsAccepted(context))) return;
			const envNames = (await environmentManager.scanEnvironments()).map(e => e.name);
```

- [ ] **Step 4: Type-check**

Run: `npm run compile`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/extension.ts
git commit -m "Gate login commands behind terms-of-use acceptance (RP-190496)"
```

---

### Task 4: Manual verification in Extension Development Host

**Files:** none (verification only)

- [ ] **Step 1: Build and launch**

Run: `npm run build`
Then launch the Extension Development Host (VS Code: press F5, or `code --extensionDevelopmentPath=.` if using CLI) against this repo.

- [ ] **Step 2: Verify first-time prompt on Provide Token**

In a workspace with at least one configured environment tree node, right-click an environment → **Provide Token**.
Expected: the Terms of Use modal appears before the Bearer token input box.

- [ ] **Step 3: Verify Decline cancels cleanly**

Click **Decline** (or press Escape).
Expected: no input box appears, no token stored, no error message shown.

- [ ] **Step 4: Verify Accept proceeds and persists**

Retry **Provide Token**, click **Accept**.
Expected: the Bearer token input box appears next. Complete or cancel it.

- [ ] **Step 5: Verify no re-prompt on subsequent logins**

Trigger **Provide Token** again (or **Login with Browser**).
Expected: no Terms of Use modal — goes straight to the existing flow.

- [ ] **Step 6: Verify version bump forces re-prompt**

Temporarily edit `TERMS_VERSION` in `src/ux/termsOfUse.ts` to `'2'`, rebuild (`npm run build`), reload the Extension Development Host, trigger login again.
Expected: modal reappears even though terms were previously accepted.
Revert `TERMS_VERSION` back to `'1'` afterward.

- [ ] **Step 7: Verify Login with Browser is also gated**

Repeat steps 2-5 against **Login with Browser** on an environment with OAuth credentials configured (or confirm the modal appears before the credential-resolution error path if none are configured).

---

## Self-Review Notes

- **Spec coverage:** gate location (both commands) → Task 3; modal presentation → Task 2; globalState persistence → Task 2; decline-silently → Task 2/4; versioning → Task 2 (`TERMS_VERSION`) + Task 4 Step 6; bundled text file → Task 1. All spec sections have a corresponding task.
- **No placeholders:** all code blocks are complete; no TBD/TODO.
- **Type consistency:** `ensureTermsAccepted(context: vscode.ExtensionContext): Promise<boolean>` signature is identical between its definition (Task 2) and both call sites (Task 3). `TERMS_VERSION`, `ACCEPTED_VERSION_KEY`, `ACCEPTED_AT_KEY` are only referenced within `termsOfUse.ts`.
