#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: terms-of-use-gate
 * Tier A: ensureTermsAccepted (no-prior-acceptance prompt/Accept/Decline/dismiss, version-match skip,
 *         version-mismatch re-prompt, read-failure fail-closed, empty/whitespace-only content
 *         fail-closed) and resetTermsAcceptance
 * Tier C (manual): full Extension Development Host flow for all three gated entry points (Provide Token,
 *   Login with Browser, the Setup Wizard), and confirming resources/legal/termsOfUse.txt ships in a
 *   packaged .vsix — see openspec/changes/terms-of-use-gate/design.md Test Plan.
 */
const assert = require('assert');
const { importDist } = require('./lib/import-dist.cjs');
const vscode = require('./lib/vscode-stub.cjs');

const { TERMS_VERSION, ensureTermsAccepted, resetTermsAcceptance } = importDist('ux/termsOfUse');

const ACCEPTED_VERSION_KEY = 'reltio.termsAcceptedVersion';
const ACCEPTED_AT_KEY = 'reltio.termsAcceptedAt';

function makeContext(initialState) {
	const store = new Map(Object.entries(initialState ?? {}));
	return {
		extensionUri: vscode.Uri.file('/ext'),
		globalState: {
			get: (key, def) => (store.has(key) ? store.get(key) : def),
			update: async (key, value) => {
				if (value === undefined) store.delete(key);
				else store.set(key, value);
			},
		},
		store,
	};
}

(async () => {
	const originalReadFile = vscode.workspace.fs.readFile;
	const originalShowWarning = vscode.window.showWarningMessage;
	const originalShowError = vscode.window.showErrorMessage;

	// --- No prior acceptance, user accepts ----------------------------------

	{
		vscode.workspace.fs.readFile = async () => Buffer.from('Terms text');
		vscode.window.showWarningMessage = async () => 'Accept';

		const context = makeContext();
		const result = await ensureTermsAccepted(context);

		assert.strictEqual(result, true);
		assert.strictEqual(context.store.get(ACCEPTED_VERSION_KEY), TERMS_VERSION);
		assert.strictEqual(typeof context.store.get(ACCEPTED_AT_KEY), 'number');
	}

	// --- No prior acceptance, user declines ---------------------------------

	{
		vscode.workspace.fs.readFile = async () => Buffer.from('Terms text');
		vscode.window.showWarningMessage = async () => 'Decline';

		const context = makeContext();
		const result = await ensureTermsAccepted(context);

		assert.strictEqual(result, false);
		assert.strictEqual(context.store.has(ACCEPTED_VERSION_KEY), false, 'declining must not persist any state');
		assert.strictEqual(context.store.has(ACCEPTED_AT_KEY), false);
	}

	// --- No prior acceptance, user dismisses (Escape/close) -----------------

	{
		vscode.workspace.fs.readFile = async () => Buffer.from('Terms text');
		vscode.window.showWarningMessage = async () => undefined;

		const context = makeContext();
		const result = await ensureTermsAccepted(context);

		assert.strictEqual(result, false, 'dismissing the modal must behave the same as declining');
		assert.strictEqual(context.store.has(ACCEPTED_VERSION_KEY), false);
	}

	// --- Prior acceptance at the current version: no re-prompt -------------

	{
		vscode.window.showWarningMessage = async () => {
			throw new Error('showWarningMessage should not be called when already accepted at the current version');
		};

		const context = makeContext({ [ACCEPTED_VERSION_KEY]: TERMS_VERSION });
		const result = await ensureTermsAccepted(context);

		assert.strictEqual(result, true);
	}

	// --- Prior acceptance at a different version: re-prompts ---------------

	{
		vscode.workspace.fs.readFile = async () => Buffer.from('Terms text');
		vscode.window.showWarningMessage = async () => 'Accept';

		const context = makeContext({ [ACCEPTED_VERSION_KEY]: '0' });
		const result = await ensureTermsAccepted(context);

		assert.strictEqual(result, true);
		assert.strictEqual(context.store.get(ACCEPTED_VERSION_KEY), TERMS_VERSION);
	}

	// --- Terms text read failure fails closed -------------------------------

	{
		let warningCalled = false;
		vscode.workspace.fs.readFile = async () => {
			throw new Error('ENOENT: termsOfUse.txt missing');
		};
		vscode.window.showWarningMessage = async () => {
			warningCalled = true;
			return 'Accept';
		};
		let errorShown = false;
		vscode.window.showErrorMessage = async () => {
			errorShown = true;
			return undefined;
		};

		const context = makeContext();
		const result = await ensureTermsAccepted(context);

		assert.strictEqual(result, false, 'a read failure must fail closed, not silently allow login');
		assert.strictEqual(warningCalled, false, 'the accept/decline modal must not appear if the text failed to load');
		assert.strictEqual(errorShown, true, 'an error must be shown explaining the terms could not be loaded');
		assert.strictEqual(context.store.has(ACCEPTED_VERSION_KEY), false);
	}

	// --- Empty/whitespace-only terms text also fails closed -----------------

	{
		for (const emptyContent of ['', '   \n\t  ']) {
			let warningCalled = false;
			vscode.workspace.fs.readFile = async () => Buffer.from(emptyContent);
			vscode.window.showWarningMessage = async () => {
				warningCalled = true;
				return 'Accept';
			};
			let errorShown = false;
			vscode.window.showErrorMessage = async () => {
				errorShown = true;
				return undefined;
			};

			const context = makeContext();
			const result = await ensureTermsAccepted(context);

			assert.strictEqual(result, false, 'empty/whitespace-only terms content must not be accepted');
			assert.strictEqual(warningCalled, false, 'a blank modal must never be shown to the user');
			assert.strictEqual(errorShown, true);
			assert.strictEqual(context.store.has(ACCEPTED_VERSION_KEY), false);
		}
	}

	// --- resetTermsAcceptance clears both keys ------------------------------

	{
		vscode.workspace.fs.readFile = async () => Buffer.from('Terms text');
		vscode.window.showWarningMessage = async () => 'Accept';

		const context = makeContext();
		await ensureTermsAccepted(context);
		assert.strictEqual(context.store.get(ACCEPTED_VERSION_KEY), TERMS_VERSION);

		await resetTermsAcceptance(context);
		assert.strictEqual(context.store.has(ACCEPTED_VERSION_KEY), false);
		assert.strictEqual(context.store.has(ACCEPTED_AT_KEY), false);

		let promptShown = false;
		vscode.window.showWarningMessage = async () => {
			promptShown = true;
			return 'Decline';
		};
		await ensureTermsAccepted(context);
		assert.strictEqual(promptShown, true, 'after resetting, the next call must prompt again');
	}

	vscode.workspace.fs.readFile = originalReadFile;
	vscode.window.showWarningMessage = originalShowWarning;
	vscode.window.showErrorMessage = originalShowError;

	console.log('test-terms-of-use-gate: OK');
})().catch(err => {
	console.error(err);
	process.exit(1);
});
