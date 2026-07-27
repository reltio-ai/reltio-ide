import * as vscode from 'vscode';

/** Bump this to force every user to re-accept the terms (e.g. after a wording change). */
export const TERMS_VERSION = '1';

const ACCEPTED_VERSION_KEY = 'reltio.termsAcceptedVersion';
// Not read anywhere yet — local audit trail for support/debugging.
const ACCEPTED_AT_KEY = 'reltio.termsAcceptedAt';

/**
 * Ensures the current user has accepted the Reltio IDE Terms of Use for the
 * current TERMS_VERSION. Prompts with a modal only when needed (never
 * accepted, or accepted an older version). Returns false if the user
 * declines or dismisses the prompt — callers must not proceed with login.
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

/** Clears the stored acceptance so the next login attempt shows the terms again. */
export async function resetTermsAcceptance(context: vscode.ExtensionContext): Promise<void> {
	await context.globalState.update(ACCEPTED_VERSION_KEY, undefined);
	await context.globalState.update(ACCEPTED_AT_KEY, undefined);
}
