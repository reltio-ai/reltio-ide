#!/usr/bin/env node
'use strict';
/**
 * OpenSpec change: browser-oauth-login
 * Tier A: credential resolve matrix, buildAuthorizationUrl, TokenStore aliases
 * Tier C (manual): browser login, SSO check, token refresh — docs/browser-oauth-login.md
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { importDist } = require('./lib/import-dist.cjs');

const {
	uniqueCredentialPairs,
	computeBrowserLoginEligibility,
	resolveOAuthCredentials,
} = importDist('api/oauthCredentialsResolve');
const { buildAuthorizationUrl, buildCallbackSuccessHtml } = importDist('api/oauthLogin');
const { TokenStore } = importDist('api/tokenStore');

const credA = { clientId: 'id-a', clientSecret: 'sec-a' };
const credB = { clientId: 'id-b', clientSecret: 'sec-b' };

assert.strictEqual(uniqueCredentialPairs([{ credentials: credA }, { credentials: credA }]).length, 1);
assert.strictEqual(uniqueCredentialPairs([{ credentials: credA }, { credentials: credB }]).length, 2);

const store = {
	async loadClientCredentials(env) {
		if (env === 'e1') return credA;
		if (env === 'e2') return credB;
		return undefined;
	},
};

(async () => {
	const multi = await computeBrowserLoginEligibility(store, ['e1', 'e2', 'e3']);
	assert.strictEqual(multi.get('e1'), true);
	assert.strictEqual(multi.get('e3'), false);

	const sharedStore = {
		async loadClientCredentials(env) {
			return env === 'only' ? credA : undefined;
		},
	};
	const shared = await computeBrowserLoginEligibility(sharedStore, ['only', 'other']);
	assert.strictEqual(shared.get('only'), true);
	assert.strictEqual(shared.get('other'), true);

	const resolved = await resolveOAuthCredentials(
		{ loadClientCredentials: async () => credA },
		'x',
		['x'],
	);
	assert.deepStrictEqual(resolved, credA);

	const url = buildAuthorizationUrl(credA, 'sso-tenant', 'state123');
	assert.ok(url.includes('client_id=id-a'));
	assert.ok(url.includes('tenant_id=sso-tenant'));
	assert.ok(url.includes('state=state123'));

	const tokens = new TokenStore();
	tokens.setToken('src', 'token-value');
	tokens.useTokenFrom('dst', 'src');
	assert.strictEqual(tokens.getToken('dst'), 'token-value');
	tokens.clearToken('src');
	assert.strictEqual(tokens.getToken('dst'), undefined);

	// RP-190109: callback success page is the Reltio logo plus the message to its right.
	const successHtml = buildCallbackSuccessHtml();
	assert.ok(successHtml.includes('<h1>Login Successful!</h1>'));
	assert.ok(
		successHtml.includes('You are signed into Reltio IDE. You can now close this browser tab.'),
	);

	// The logo must be inlined: the callback server closes after its single response,
	// so a separate request for an image file could never be served.
	const logoBase64 = fs
		.readFileSync(path.join(__dirname, '..', 'resources', 'icons', 'reltio-icon.png'))
		.toString('base64');
	assert.ok(
		successHtml.includes(`src="data:image/png;base64,${logoBase64}"`),
		'inlined logo must match resources/icons/reltio-icon.png',
	);
	assert.ok(/<img[^>]*alt="Reltio"/.test(successHtml));

	// Logo left, text right — the img precedes the heading in document order.
	assert.ok(successHtml.indexOf('<img') < successHtml.indexOf('<h1>'));

	// The retired editor deep links must not come back.
	assert.ok(!successHtml.includes('vscode://'));
	assert.ok(!successHtml.includes('cursor://'));

	console.log('test-browser-oauth-login: OK');
})().catch(err => {
	console.error(err);
	process.exit(1);
});
